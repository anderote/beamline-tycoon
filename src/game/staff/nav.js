// src/game/staff/nav.js — subtile navigation grid and A* for staff pawns.
//
// Task 2 of the staff-professions-2 (nav-and-stations) plan. Builds a grid at
// SUBTILE resolution (1 subtile = 0.5 world units, 4x4 subtiles per tile) so
// pawns can walk around furniture and through doors instead of ambling in
// straight lines through walls. Nothing consumes this yet — a later task
// drives pawns with findPath and adds work stations.
//
// Coordinate model: a subtile node is { col, row, subCol, subRow } — col/row
// identify the tile (as everywhere else in the game), subCol/subRow in
// [0,3] identify the subtile within it. Tile (col,row) spans world
// [col*2, col*2+2) on both axes (col -> world X, row -> world Z, per
// src/data/directions.js's DIR_DELTA table), so subtile (col,row,subCol,subRow)
// spans [col*2 + subCol*0.5, col*2 + subCol*0.5 + 0.5) on each axis.
//
// Movement is 4-directional only, at subtile granularity. A step that stays
// within one tile is never wall-blocked (walls only live on tile edges).
// A step that crosses into a different tile is blocked exactly when
// isBlocked(fromCol, fromRow, edge, state) says so, reusing the wall/door
// test rooms.js already owns rather than growing a second one.

import { isBlocked } from '../../networks/rooms.js';
import { PLACEABLES } from '../../data/placeables/index.js';
import { FLOORS } from '../../data/structure.js';

// Fallback margin added around the content bounding box when a state has no
// mapHalfExtent (hand-built states, mostly in tests). Real Game states
// always set mapHalfExtent (see buildNavGrid's bounds computation below) —
// this only exists so nav.js stays usable against a minimal state shape
// without requiring every caller to fabricate a map size.
const BOUNDS_INFLATE_TILES = 8;

// Margin added around the BUILT content bbox (floors ∪ walls ∪ doors ∪
// placeable footprints) for the connected-component labelling — see
// buildLabels' doc comment. 2 tiles is enough to cover a boundary step
// (the labelling only needs to see one ring of subtiles past whatever a
// pawn could actually be adjacent to) without dragging in bare map area
// nobody has touched.
const BUILT_LABEL_MARGIN_TILES = 2;

// Sentinels returned by a label lookup's get(), guaranteed to never equal a
// real (non-negative) component id: OUTDOOR is the one implicit component
// covering all bare ground outside the labelled bbox (see buildLabels'
// doc comment); OUT_OF_MAP is a node outside the grid's own `bounds`
// entirely — callers already bounds-check before reaching here, so this is
// pure defense, but it must never collide with OUTDOOR or a real id.
const OUTDOOR = -2;
const OUT_OF_MAP = -1;

/**
 * The object returned by a label lookup — deliberately a MODULE-LEVEL
 * factory, not a closure created inside buildLabels(). buildLabels() builds
 * a union-find scratch (`parent`/`rank`, several MB on a large map) to
 * produce `componentId`, then has no further use for that scratch — but a
 * closure created *inside* buildLabels would share its entire function
 * scope (including `parent`/`rank`) whether or not it actually reads them,
 * because V8 heap-allocates one "context" per scope that has an escaping
 * closure, not one per variable. Building the lookup as a call to a
 * function declared OUTSIDE buildLabels makes that lexically impossible:
 * this closure's scope is exactly its own parameter list, so `parent`/
 * `rank` become collectible as soon as buildLabels() returns. Measured
 * effect: retained size at mapHalfExtent 120 dropped from 8.0 MB to the
 * 3.5 MB `componentId` actually needs.
 */
function makeLabelLookup(componentId, w, minColSub, minRowSub, maxColSub, maxRowSub,
                          mapMinColSub, mapMinRowSub, mapMaxColSub, mapMaxRowSub) {
  return {
    get(node) {
      const absCol = node.col * 4 + node.subCol;
      const absRow = node.row * 4 + node.subRow;
      if (absCol < mapMinColSub || absCol > mapMaxColSub || absRow < mapMinRowSub || absRow > mapMaxRowSub) {
        return OUT_OF_MAP;
      }
      if (absCol < minColSub || absCol > maxColSub || absRow < minRowSub || absRow > maxRowSub) {
        return OUTDOOR;
      }
      return componentId[(absRow - minRowSub) * w + (absCol - minColSub)];
    },
  };
}

// Movement cost multipliers. Floored tiles are cheap; bare ground (no floor)
// is walkable but expensive, so pawns cross grass to reach a detached
// building without ever preferring it over an available floor route.
const FLOOR_COST = 1;
const GRASS_COST = 2.5;

// Two-pass search budget — see the comment on heuristic()/search() for why
// there are two passes instead of one weight.
const PASS1_WEIGHT = FLOOR_COST;   // admissible: optimal path when it lands
const PASS1_MAX_EXPANDED = 6000;   // small budget — most routing is local
const PASS2_WEIGHT = 3.0;          // inadmissible: guarantees termination
const MAX_EXPANDED_NODES = 20000;  // pass 2's full cap

function subtileKey(col, row, subCol, subRow) {
  return col + ',' + row + ',' + subCol + ',' + subRow;
}

function nodeKey(n) {
  return subtileKey(n.col, n.row, n.subCol, n.subRow);
}

function normalizeNode(n) {
  return { col: n.col, row: n.row, subCol: n.subCol, subRow: n.subRow };
}

// --- Coordinate bridge -----------------------------------------------------

/**
 * World (x,z) -> the subtile node containing that point.
 */
export function worldToSubtile(x, z) {
  const absCol = Math.floor(x / 0.5);
  const absRow = Math.floor(z / 0.5);
  const col = Math.floor(absCol / 4);
  const row = Math.floor(absRow / 4);
  return {
    col,
    row,
    subCol: absCol - col * 4,
    subRow: absRow - row * 4,
  };
}

/**
 * Subtile node -> its world-space CENTER (x,z).
 */
export function subtileToWorld(node) {
  return {
    x: node.col * 2 + node.subCol * 0.5 + 0.25,
    z: node.row * 2 + node.subRow * 0.5 + 0.25,
  };
}

// --- Grid construction -------------------------------------------------
//
// Storing one passable/cost entry per SUBTILE across the whole bounded area
// was the original approach here, but the starter map scatters meadow
// (wildgrass/tallgrass) floor tiles across the entire site (see
// placeMeadowGrass in src/game/map-generator.js), so infraOccupied's bbox —
// and therefore `bounds` — IS the map from turn 1. Materializing every
// subtile in it is ~99% redundant: bare/grass ground is uniformly passable
// at one cost, so only the EXCEPTIONS need storing. `flooredTiles` (below)
// holds just the tiles with a true (non-outdoor) floor, at TILE
// granularity; `blockedSubtiles` holds just the subtiles an occupant
// actually blocks. Everything else is derived on the fly by the closures
// `passable`/`cost` return — same public shape (`.has()`/`.get()` by
// subtile key) as a real Set/Map, an order of magnitude less memory, and a
// build cost proportional to what's actually placed rather than to the
// bounded area.

/**
 * Build a fresh NavGrid from the current state. `bounds` is the map's own
 * play area (state.mapHalfExtent — "the site is |col| <= mapHalfExtent,
 * |row| <= mapHalfExtent", per Game.js) so every in-map tile is addressable,
 * regardless of where infraOccupied happens to have entries. `passable`/
 * `cost` answer per-subtile queries by consulting the sparse exception sets
 * above rather than a precomputed entry for every subtile.
 */
export function buildNavGrid(state) {
  const infraOccupied = state.infraOccupied || {};
  const subgridOccupied = state.subgridOccupied || {};
  const wallOccupied = state.wallOccupied || {};
  const doorOccupied = state.doorOccupied || {};
  const placeableIndex = state.placeableIndex || {};
  const placeables = state.placeables || [];

  // Union of every tile touched by floors, walls, doors, or a placeable
  // footprint — "built" content in the broadest sense. Walls and doors
  // matter here even with no floor nearby: a fence built on bare ground
  // must still shrink/shape the labelling region (see buildLabels below),
  // or the region on either side of it gets treated as trivially connected
  // bare ground and the fence does nothing.
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  function extendContent(c, r) {
    if (c < minCol) minCol = c;
    if (c > maxCol) maxCol = c;
    if (r < minRow) minRow = r;
    if (r > maxRow) maxRow = r;
  }
  // Tiles with a true floor (not an outdoor grounds surface like grass/
  // dirt/pavement — those are walkable ground, not flooring, and must cost
  // the same as unpaved bare ground or a pawn will detour onto a meadow to
  // avoid grass it is already standing on). Critically, a groundsSurface
  // tile must NOT feed the content bbox either: map-generator.js's
  // placeMeadowGrass scatters these across essentially the WHOLE site at
  // world generation (see this file's own header comment — "infraOccupied's
  // bbox ... IS the map from turn 1"), so a real Game state's infraOccupied
  // spans nearly the entire map from the first tick regardless of what the
  // player has actually built. Feeding the bbox from every infraOccupied
  // key indiscriminately would make the labelling region ~always the whole
  // map in practice, silently defeating the point of scoping it to what's
  // built at all.
  const flooredTiles = new Set();
  for (const key of Object.keys(infraOccupied)) {
    const type = infraOccupied[key];
    const def = FLOORS[type];
    if (!def || def.groundsSurface !== true) {
      flooredTiles.add(key);
      const [c, r] = key.split(',').map(Number);
      extendContent(c, r);
    }
  }
  for (const key of Object.keys(wallOccupied)) {
    const [c, r] = key.split(',');
    extendContent(+c, +r);
  }
  for (const key of Object.keys(doorOccupied)) {
    const [c, r] = key.split(',');
    extendContent(+c, +r);
  }
  for (const entry of placeables) {
    // Decorations (kind: 'decoration' — trees, rocks, flowerbeds, ...) are
    // excluded from the content bbox, though they still block their own
    // subtile exactly as before (see blockedSubtiles below, computed
    // independently from subgridOccupied). generateStartingMap/
    // generateAnnulus scatter LONELY_TREE_DENSITY trees roughly uniformly
    // across the whole site (map-generator.js) — every seed checked (1, 7,
    // 42, 100, 2026, 31337) puts a tree within a tile or two of every edge
    // of the map, so a real new game's decoration bbox is ~the entire map
    // on turn one, the same "world-gen scatters something map-wide" trap
    // groundsSurface tiles were above. A scattered tree doesn't create
    // connectivity structure worth partitioning the map for — it's a
    // 1-subtile obstacle, not a room boundary — so it shouldn't widen the
    // labelled region just because a stray specimen landed near mapHalfExtent.
    //
    // Known limitation this accepts: a CLOSED RING of decorations sitting
    // entirely outside the built bbox encloses a pocket that the labelling
    // has no way to see, so that pocket gets folded into OUTDOOR and
    // reported reachable even though it's actually walled off by trees. At
    // LONELY_TREE_DENSITY = 0.007 with 1-subtile trees this is essentially
    // impossible from generation (needs adjacent trees forming a closed
    // loop), but a player COULD deliberately plant a ring. The failure is
    // bounded and safe rather than silently wrong: isReachable says yes,
    // but findPath still runs real A* against blockedSubtiles and correctly
    // returns null, so a pawn sent there goes idle with "no path found"
    // instead of walking into a tree. See test-staff-nav.js's
    // "decoration ring" test for the explicit, documented behavior.
    if (entry.kind === 'decoration') continue;
    if (Array.isArray(entry.cells) && entry.cells.length) {
      for (const cell of entry.cells) extendContent(cell.col, cell.row);
    } else if (Number.isFinite(entry.col) && Number.isFinite(entry.row)) {
      extendContent(entry.col, entry.row);
    }
  }

  let bounds;
  if (Number.isFinite(state.mapHalfExtent)) {
    // The real, common case: bound to the map itself, not to wherever
    // infraOccupied happens to have entries. An inflated CONTENT bbox put
    // real map tiles out of bounds by construction whenever the built area
    // was lopsided (a starter map's floor bbox is rarely centered on the
    // origin) — e.g. at one measured seed, the bbox spanned rows -29..18,
    // so row 20 (well inside a halfExtent-30 map) was rejected by
    // findPath's bounds check before the search ever ran.
    const h = state.mapHalfExtent;
    bounds = { minCol: -h, maxCol: h, minRow: -h, maxRow: h };
  } else {
    // Fallback for hand-built states without mapHalfExtent (see the
    // BOUNDS_INFLATE_TILES comment above) — derive from the content bbox
    // instead, inflated so a small hand-built floor patch still has room to
    // path across surrounding bare ground.
    if (!Number.isFinite(minCol)) {
      // No content anywhere yet — bound a small area around the origin
      // rather than leaving the grid empty.
      minCol = maxCol = minRow = maxRow = 0;
    }
    bounds = {
      minCol: minCol - BOUNDS_INFLATE_TILES, maxCol: maxCol + BOUNDS_INFLATE_TILES,
      minRow: minRow - BOUNDS_INFLATE_TILES, maxRow: maxRow + BOUNDS_INFLATE_TILES,
    };
  }

  // The region the connected-component labelling actually materializes:
  // the content bbox plus a small margin, clamped to the map's own
  // `bounds` (never wider than the map, and collapses to a single point
  // rather than an inverted range on the pathological empty-content-outside-
  // bounds case). See buildLabels' doc comment for why this must stay
  // proportional to what's built rather than to the whole map.
  let labelMinCol = Number.isFinite(minCol) ? minCol : 0;
  let labelMaxCol = Number.isFinite(maxCol) ? maxCol : 0;
  let labelMinRow = Number.isFinite(minRow) ? minRow : 0;
  let labelMaxRow = Number.isFinite(maxRow) ? maxRow : 0;
  labelMinCol -= BUILT_LABEL_MARGIN_TILES; labelMaxCol += BUILT_LABEL_MARGIN_TILES;
  labelMinRow -= BUILT_LABEL_MARGIN_TILES; labelMaxRow += BUILT_LABEL_MARGIN_TILES;
  labelMinCol = Math.max(labelMinCol, bounds.minCol);
  labelMaxCol = Math.min(labelMaxCol, bounds.maxCol);
  labelMinRow = Math.max(labelMinRow, bounds.minRow);
  labelMaxRow = Math.min(labelMaxRow, bounds.maxRow);
  if (labelMinCol > labelMaxCol) { labelMinCol = labelMaxCol = bounds.minCol; }
  if (labelMinRow > labelMaxRow) { labelMinRow = labelMaxRow = bounds.minRow; }

  // Subtiles an occupant actually blocks (see the passability rule below).
  // Proportional to placed-item footprints, not to the bounded area.
  const blockedSubtiles = new Set();
  for (const key of Object.keys(subgridOccupied)) {
    const occ = subgridOccupied[key];
    const idx = placeableIndex[occ.id];
    const entry = idx !== undefined ? placeables[idx] : undefined;
    const def = entry ? PLACEABLES[entry.type] : undefined;
    // Passable only when we can positively identify the occupant as
    // something a pawn walks past/into rather than around: a small
    // stackable desktop item, anything short enough to step over, or —
    // load-bearing, not a detail — anything carrying a `seat` block. Every
    // chair in the repo is subH: 2, so the subH check alone would make
    // chairs solid, and a seated pawn's path destination IS the chair's
    // tile. An unresolvable occupant (missing index/def entry) is treated
    // as blocking, not passable.
    const passableThrough = !!def
      && (def.stackable || (def.subH ?? 1) <= 1 || !!def.seat);
    if (!passableThrough) blockedSubtiles.add(key);
  }

  const passable = {
    // Runs on every A* edge test, so this is written to avoid allocating an
    // intermediate array/object per call (a prior version's key.split(',')
    // + destructure measured as most of an ~11% per-query regression versus
    // the old dense-Set grid) — plain locals and string slices only. Also
    // range-checks subCol/subRow: a caller-supplied `from`/`to` node with an
    // out-of-[0,3] subCol/subRow (e.g. a bug upstream) must come back
    // false, the same as the old dense Set did by simply never having that
    // key — nothing here inferred bounds.min/max for subCol/subRow, so
    // without an explicit check a key like "0,0,9,9" silently read as
    // in-bounds-and-unblocked.
    has(key) {
      let i = key.indexOf(',');
      const col = +key.slice(0, i);
      if (col < bounds.minCol || col > bounds.maxCol) return false;
      let j = key.indexOf(',', i + 1);
      const row = +key.slice(i + 1, j);
      if (row < bounds.minRow || row > bounds.maxRow) return false;
      let k = key.indexOf(',', j + 1);
      const subCol = +key.slice(j + 1, k);
      if (subCol < 0 || subCol > 3) return false;
      const subRow = +key.slice(k + 1);
      if (subRow < 0 || subRow > 3) return false;
      return !blockedSubtiles.has(key);
    },
  };
  const cost = {
    get(key) {
      const comma = key.indexOf(',', key.indexOf(',') + 1);
      const tileKey = key.slice(0, comma);
      return flooredTiles.has(tileKey) ? FLOOR_COST : GRASS_COST;
    },
  };

  // Connected-component labelling, built lazily on first use (see
  // getComponentLabels() below the A* section) and cached on the returned
  // nav object for its lifetime — i.e. once per navRevision, same as the
  // grid itself.
  //
  // Only the BUILT region (labelMinCol/labelMaxCol/labelMinRow/labelMaxRow,
  // computed above as the content bbox + BUILT_LABEL_MARGIN_TILES, clamped
  // to `bounds`) is actually materialized into union-find cells. Labelling
  // the WHOLE map (an earlier version of this function did) reintroduces
  // exactly the area-proportional blowup `899f6e31` removed from the sparse
  // grid: bare ground is uniformly passable, so there is nothing to
  // partition out there — every outdoor subtile is trivially connected to
  // every other. Everything outside the built bbox is instead one implicit
  // OUTDOOR pseudo-component (an extra union-find slot, OUTDOOR_NODE below,
  // that never gets its own row in `componentId`): a built-region cell on
  // the bbox's outer rim joins it whenever the cell itself is passable
  // (guaranteed by the loop's own blockedSubtiles skip) and its outward
  // step isn't wall-blocked. This is also why walls/doors/placeables (not
  // just floors) had to feed the content bbox above — a fence built on bare
  // ground with no floor anywhere must still shrink/shape this region, or
  // both sides of it get labelled as the same trivially-connected outdoors
  // and the fence does nothing.
  function buildLabels() {
    const minColSub = labelMinCol * 4, minRowSub = labelMinRow * 4;
    const maxColSub = labelMaxCol * 4 + 3, maxRowSub = labelMaxRow * 4 + 3;
    const mapMinColSub = bounds.minCol * 4, mapMinRowSub = bounds.minRow * 4;
    const mapMaxColSub = bounds.maxCol * 4 + 3, mapMaxRowSub = bounds.maxRow * 4 + 3;
    const w = maxColSub - minColSub + 1;
    const h = maxRowSub - minRowSub + 1;
    const n = w * h;
    const OUTDOOR_NODE = n; // one extra slot, not a real grid cell

    // Union-find over a flat Int32Array of subtile indices (plus the one
    // extra OUTDOOR_NODE slot) — see the component-labelling comment above
    // search() for why this replaces a per-query A* reachability check with
    // one pass over the built region per world edit.
    const parent = new Int32Array(n + 1);
    const rank = new Uint8Array(n + 1);
    for (let i = 0; i <= n; i++) parent[i] = i;
    function find(x) {
      let root = x;
      while (parent[root] !== root) root = parent[root];
      while (parent[x] !== root) { const next = parent[x]; parent[x] = root; x = next; }
      return root;
    }
    function union(a, b) {
      let ra = find(a), rb = find(b);
      if (ra === rb) return;
      if (rank[ra] < rank[rb]) { const t = ra; ra = rb; rb = t; }
      parent[rb] = ra;
      if (rank[ra] === rank[rb]) rank[ra]++;
    }
    const idxAt = (absCol, absRow) => (absRow - minRowSub) * w + (absCol - minColSub);

    // Union every passable subtile with its west and north neighbor (when
    // that neighbor is itself passable and, for a tile-crossing step, not
    // wall-blocked) — every undirected adjacency edge exactly once, since
    // "west of A" and "north of A" together cover the same edges "east of
    // A's west neighbor" / "south of A's north neighbor" would from the
    // other side (isBlocked is symmetric regardless of which side asks —
    // see neighborsOf()'s comment). Boundary cells (on the built bbox's
    // outer rim) ALSO union with OUTDOOR_NODE on whichever side(s) actually
    // face outward — skipped on any side that is also the map's own hard
    // edge (`bounds`), since there is no "outdoor" beyond the map itself.
    // The outward side's own passability needs no check: everything outside
    // the built bbox is guaranteed unblocked (every blocked subtile comes
    // from a placeable footprint, and every placeable footprint fed the
    // content bbox this region was built around).
    for (let absRow = minRowSub; absRow <= maxRowSub; absRow++) {
      const row = Math.floor(absRow / 4);
      const subRow = absRow - row * 4;
      for (let absCol = minColSub; absCol <= maxColSub; absCol++) {
        const col = Math.floor(absCol / 4);
        const subCol = absCol - col * 4;
        if (blockedSubtiles.has(subtileKey(col, row, subCol, subRow))) continue;
        const i = idxAt(absCol, absRow);

        if (subCol > 0) {
          if (!blockedSubtiles.has(subtileKey(col, row, subCol - 1, subRow))) {
            union(i, idxAt(absCol - 1, absRow));
          }
        } else if (absCol > minColSub) {
          if (!blockedSubtiles.has(subtileKey(col - 1, row, 3, subRow)) && !isBlocked(col, row, 'w', state)) {
            union(i, idxAt(absCol - 1, absRow));
          }
        } else if (minColSub > mapMinColSub && !isBlocked(col, row, 'w', state)) {
          union(i, OUTDOOR_NODE);
        }

        if (subRow > 0) {
          if (!blockedSubtiles.has(subtileKey(col, row, subCol, subRow - 1))) {
            union(i, idxAt(absCol, absRow - 1));
          }
        } else if (absRow > minRowSub) {
          if (!blockedSubtiles.has(subtileKey(col, row - 1, subCol, 3)) && !isBlocked(col, row, 'n', state)) {
            union(i, idxAt(absCol, absRow - 1));
          }
        } else if (minRowSub > mapMinRowSub && !isBlocked(col, row, 'n', state)) {
          union(i, OUTDOOR_NODE);
        }

        if (absCol === maxColSub && maxColSub < mapMaxColSub && !isBlocked(col, row, 'e', state)) {
          union(i, OUTDOOR_NODE);
        }
        if (absRow === maxRowSub && maxRowSub < mapMaxRowSub && !isBlocked(col, row, 's', state)) {
          union(i, OUTDOOR_NODE);
        }
      }
    }

    // Flatten every real cell to its final root once, remapping anything
    // that landed in OUTDOOR_NODE's component to the fixed OUTDOOR sentinel
    // so get()'s equality check works the same way whether a query lands
    // inside the built bbox (via this array) or outside it entirely (via
    // makeLabelLookup's own bbox check, below) — both cases return the
    // identical OUTDOOR value.
    const outdoorRoot = find(OUTDOOR_NODE);
    const componentId = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const root = find(i);
      componentId[i] = (root === outdoorRoot) ? OUTDOOR : root;
    }

    // See makeLabelLookup's doc comment for why this is a call to a
    // function declared outside buildLabels rather than an object literal
    // built right here.
    return makeLabelLookup(componentId, w, minColSub, minRowSub, maxColSub, maxRowSub,
      mapMinColSub, mapMinRowSub, mapMaxColSub, mapMaxRowSub);
  }

  return {
    revision: state.navRevision || 0,
    passable,
    cost,
    bounds,
    // Not part of the documented shape — carried along so findPath/
    // isReachable can run isBlocked() against the same state the grid was
    // built from without every caller having to pass state back in.
    _state: state,
    // Internal, lazy — see getComponentLabels() below. `_labels` starts
    // unbuilt so a nav grid built and never reachability-queried (e.g. most
    // hand-built test grids) never pays the labelling cost. `_buildLabels`
    // itself (a closure over buildNavGrid's locals — `bounds`,
    // `blockedSubtiles`, `state`, the label bbox — not huge, but not
    // nothing) is dropped by getComponentLabels() once `_labels` exists, so
    // it isn't kept alive on the nav object for the rest of its lifetime
    // after the one call that needed it.
    _buildLabels: buildLabels,
    _labels: null,
  };
}

const navCache = new WeakMap();

/**
 * Memoised buildNavGrid: rebuilds only when state.navRevision has moved past
 * the cached grid's revision (see Game._markNavDirty).
 */
export function getNavGrid(state) {
  const cached = navCache.get(state);
  const revision = state.navRevision || 0;
  if (cached && cached.revision === revision) return cached;
  const grid = buildNavGrid(state);
  navCache.set(state, grid);
  return grid;
}

// --- A* ----------------------------------------------------------------

// Minimal binary min-heap keyed by an external priority. A 25-pawn facility
// re-paths often enough that an array-scan open set would show up in a
// profile; this keeps push/pop at O(log n).
class MinHeap {
  constructor() { this._items = []; }

  get size() { return this._items.length; }

  push(item, priority) {
    const items = this._items;
    items.push({ item, priority });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].priority <= items[i].priority) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this._items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const n = items.length;
      for (;;) {
        const left = i * 2 + 1;
        const right = i * 2 + 2;
        let smallest = i;
        if (left < n && items[left].priority < items[smallest].priority) smallest = left;
        if (right < n && items[right].priority < items[smallest].priority) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top.item;
  }
}

function inBounds(bounds, n) {
  return n.col >= bounds.minCol && n.col <= bounds.maxCol
      && n.row >= bounds.minRow && n.row <= bounds.maxRow;
}

// --- Connected components (O(1) reachability) ---------------------------
//
// isReachable used to share A*'s search() with findPath, differing only in
// whether the path gets reconstructed — cheap to call once, ruinous to call
// in a loop. That is exactly what findStation (stations.js) does: it
// reachability-tests candidate stations in distance order until one passes,
// so a pawn with no reachable station anywhere (a sealed-off wing, a
// facility mid-construction with two disconnected floor islands) pays the
// FULL two-pass search cost for every candidate, every scan, forever —
// measured on a 61x61 map at ~27ms for a single doomed probe and ~1.4s for
// 48 of them in one findStation call, long enough to block the main thread
// for one idle pawn.
//
// buildLabels() (see buildNavGrid above) flood-fills the BUILT region —
// content bbox plus a small margin, NOT the whole map — into union-find
// components once per navRevision, treating everything outside that region
// as one implicit OUTDOOR component. Grass is passable everywhere, so
// there is nothing to partition out there — an earlier version of this
// function labelled the whole `bounds` instead, which reintroduced an
// area-proportional cost on a large, mostly-empty map (measured ~184ms at
// mapHalfExtent 120 even with only a 21x21 area actually built), the exact
// blowup the sparse `passable`/`cost` closures above exist to avoid. This
// version costs proportional to what's built (once per world edit) rather
// than to the map size, independent of how many pawns or stations query it
// afterward. Two subtiles are reachable from each other iff they land in
// the same component (or both land in OUTDOOR) — isReachable becomes a
// single array-read comparison.
function getComponentLabels(nav) {
  if (!nav._labels) {
    nav._labels = nav._buildLabels();
    // The closure that produced `_labels` (and everything IT closed over —
    // bounds, blockedSubtiles, state, the label bbox) has no further use
    // once the lookup exists; drop the reference so it doesn't outlive the
    // one call that needed it.
    nav._buildLabels = null;
  }
  return nav._labels;
}

// Manhattan distance in subtiles, scaled by `weight`. `weight` is what makes
// this admissible or not — see the two-pass explanation on search() below
// for why both a weight of FLOOR_COST (admissible) and one of PASS2_WEIGHT
// (deliberately inadmissible) are used, at different times, rather than one
// fixed value.
function heuristic(a, b, weight) {
  const dCol = (a.col * 4 + a.subCol) - (b.col * 4 + b.subCol);
  const dRow = (a.row * 4 + a.subRow) - (b.row * 4 + b.subRow);
  return (Math.abs(dCol) + Math.abs(dRow)) * weight;
}

// The four cardinal neighbours of a subtile node. Steps that stay inside the
// same tile carry no edge to test; steps that cross into a different tile
// carry the edge isBlocked() should be asked about, tested from the CURRENT
// tile's side (matching the dir/edge correspondence in src/data/directions.js
// and src/networks/rooms.js's EDGE_DELTAS).
function neighborsOf(n) {
  const out = [];
  if (n.subCol > 0) {
    out.push({ node: { col: n.col, row: n.row, subCol: n.subCol - 1, subRow: n.subRow } });
  } else {
    out.push({ node: { col: n.col - 1, row: n.row, subCol: 3, subRow: n.subRow }, edge: 'w' });
  }
  if (n.subCol < 3) {
    out.push({ node: { col: n.col, row: n.row, subCol: n.subCol + 1, subRow: n.subRow } });
  } else {
    out.push({ node: { col: n.col + 1, row: n.row, subCol: 0, subRow: n.subRow }, edge: 'e' });
  }
  if (n.subRow > 0) {
    out.push({ node: { col: n.col, row: n.row, subCol: n.subCol, subRow: n.subRow - 1 } });
  } else {
    out.push({ node: { col: n.col, row: n.row - 1, subCol: n.subCol, subRow: 3 }, edge: 'n' });
  }
  if (n.subRow < 3) {
    out.push({ node: { col: n.col, row: n.row, subCol: n.subCol, subRow: n.subRow + 1 } });
  } else {
    out.push({ node: { col: n.col, row: n.row + 1, subCol: n.subCol, subRow: 0 }, edge: 's' });
  }
  return out;
}

function reconstructPath(cameFrom, goalEntry) {
  const path = [];
  let cur = goalEntry;
  while (cur) {
    path.push(cur.node);
    cur = cameFrom.get(cur.key);
  }
  path.reverse();
  return path;
}

// One weighted-A* run: expand up to `maxExpanded` nodes with heuristic
// weight `weight`, from `fromKey`/`from` to `toKey`. Returns `capped: true`
// when the expansion budget ran out without resolving the goal either way —
// the caller (search(), below) needs that distinct from "definitively
// unreachable" (the open set drained on its own) to know whether a second
// pass is worth running.
function runAStar(nav, from, to, fromKey, toKey, wantPath, weight, maxExpanded) {
  const open = new MinHeap();
  const gScore = new Map([[fromKey, 0]]);
  const cameFrom = new Map();
  const closed = new Set();

  open.push({ node: normalizeNode(from), key: fromKey }, heuristic(from, to, weight));

  let expanded = 0;
  while (open.size > 0) {
    const current = open.pop();
    if (closed.has(current.key)) continue;
    closed.add(current.key);

    // Test the goal BEFORE charging this expansion against the cap: a goal
    // popped as the (maxExpanded + 1)th node is still a real answer, and
    // discarding it there would convert an actually-cheap search into a
    // spurious cap-out right at the threshold.
    if (current.key === toKey) {
      return {
        reached: true,
        path: wantPath ? reconstructPath(cameFrom, current) : null,
        capped: false,
      };
    }

    expanded++;
    if (expanded > maxExpanded) return { reached: false, path: null, capped: true };

    for (const step of neighborsOf(current.node)) {
      const nbKey = nodeKey(step.node);
      if (closed.has(nbKey)) continue;
      if (!nav.passable.has(nbKey)) continue;
      if (step.edge && isBlocked(current.node.col, current.node.row, step.edge, nav._state)) continue;

      const stepCost = nav.cost.get(nbKey);
      const tentativeG = gScore.get(current.key) + stepCost;
      const prevG = gScore.get(nbKey);
      if (prevG === undefined || tentativeG < prevG) {
        gScore.set(nbKey, tentativeG);
        cameFrom.set(nbKey, current);
        open.push({ node: step.node, key: nbKey }, tentativeG + heuristic(step.node, to, weight));
      }
    }
  }
  // Open set drained without ever reaching the goal: definitively
  // unreachable within `bounds`, not just within this pass's budget.
  return { reached: false, path: null, capped: false };
}

// Two-pass search, used by findPath. `wantPath` controls whether the goal's
// predecessor chain is walked back into an array — kept as a parameter
// rather than hard-coded mostly for history (isReachable no longer calls
// this at all, so `wantPath` is always true from findPath's one caller
// today), and so a future caller wanting "reached, no path needed, but via
// full A* rather than the labelling" (no such caller exists yet) doesn't
// have to fork the function to get it.
//
// Why two passes instead of one fixed weight (this replaces an earlier,
// single-weight version of this file — see the fix-round writeup in
// .superpowers/sdd/.../task-1-2-report.md for the full history):
//
// Pass 1 runs plain, ADMISSIBLE A* (weight = FLOOR_COST = 1, so h never
// overestimates) capped at a small budget (PASS1_MAX_EXPANDED). When it
// resolves — reaches the goal, or drains its open set and proves the goal
// unreachable — that result is exact and final: the genuinely cheapest
// path, including a floor detour that requires backtracking away from the
// goal first. This covers essentially all facility-interior and short/
// medium-range pathing, which is the overwhelming majority of what a
// 25-pawn facility actually does, and it is the case that matters
// visually: a floored corridor whose entrance is two tiles behind the pawn
// is exactly the kind of shortcut a player notices being skipped in favor
// of cutting across the lawn.
//
// A single fixed weight can't have both properties. Admissible (weight =
// FLOOR_COST) finds every detour but is a plain uniform-cost search on open
// grass — O(d^2) expansions — and degrades to spurious "unreachable" results
// on this game's normal map scale (DEFAULT_MAP_HALF_EXTENT = 30, so a
// corner-to-corner crossing is a routine 60-tile diagonal). The obvious fix,
// weighting h by GRASS_COST so it's exact on a pure-grass route, is in fact
// the worst possible choice: at that weight every node on the direct
// straight-grass path shares the SAME f-score as the goal, so A* must drain
// the entire rectangle between start and goal before it can finish — still
// O(d^2), still NULL on a routine 60-tile crossing (measured; see the
// report). Nor does turning the weight up further alone fix it: at weight
// >= ~2, ordinary facility layouts start skipping real, nearby floor
// detours — measured at 1.75x optimal cost, ~73% grass, for a corridor
// entrance just two tiles behind the pawn.
//
// So: pass 1 gets the optimality that matters for the common, local case,
// budgeted small because on a long open crossing it can't help anyway and
// its own budget is a few wasted ms. Pass 2 only runs when pass 1's budget
// ran out inconclusively (not when pass 1 proves the goal unreachable),
// at PASS2_WEIGHT (3.0 — chosen from a weight sweep as the smallest value
// that reliably terminates within MAX_EXPANDED_NODES at map-scale spans),
// with the FULL node budget, purely to guarantee SOME path is found on a
// long cross-site walk rather than returning null.
function search(nav, from, to, wantPath) {
  if (!inBounds(nav.bounds, from) || !inBounds(nav.bounds, to)) {
    return { reached: false, path: null };
  }
  const fromKey = nodeKey(from);
  const toKey = nodeKey(to);
  if (!nav.passable.has(fromKey) || !nav.passable.has(toKey)) {
    return { reached: false, path: null };
  }
  if (fromKey === toKey) {
    return { reached: true, path: wantPath ? [normalizeNode(from)] : null };
  }

  // O(1) short-circuit before spending any A* budget: two subtiles in
  // different connected components can never have a path between them, full
  // stop — see the connected-components section above inBounds(). Lets a
  // doomed findPath call (target in a sealed-off wing, a disconnected floor
  // island) fail immediately instead of burning up to PASS1_MAX_EXPANDED +
  // MAX_EXPANDED_NODES expansions to rediscover what the labelling already
  // knows.
  const labels = getComponentLabels(nav);
  if (labels.get(from) !== labels.get(to)) {
    return { reached: false, path: null };
  }

  const pass1 = runAStar(nav, from, to, fromKey, toKey, wantPath, PASS1_WEIGHT, PASS1_MAX_EXPANDED);
  if (pass1.reached || !pass1.capped) return pass1;

  const pass2 = runAStar(nav, from, to, fromKey, toKey, wantPath, PASS2_WEIGHT, MAX_EXPANDED_NODES);
  return pass2;
}

/**
 * Two-pass A* from `from` to `to` (subtile nodes) — see the comment on
 * search() for why two passes. Returns an array of subtile nodes from
 * `from` to `to` inclusive, optimal when pass 1 resolves it (the common
 * case), possibly suboptimal when pass 2 had to run, or null when
 * unreachable (including start/goal outside `bounds`, or pass 2's node cap
 * was hit).
 */
export function findPath(nav, from, to) {
  return search(nav, from, to, true).path;
}

/**
 * Whether `to` is reachable from `from` — an O(1) connected-component label
 * comparison (see getComponentLabels() above), NOT a cut-down A* search.
 * Unlike findPath, this has no node-expansion budget to exhaust and no
 * suboptimality/termination trade-off to make: the labelling is an
 * exhaustive flood-fill of the whole bounded grid, so the answer is always
 * exact. Safe to call in a loop over many candidates (see stations.js's
 * findStation) — the one expensive part (the flood-fill itself) happens at
 * most once per navRevision, lazily, on whichever of findPath/isReachable
 * asks for it first.
 */
export function isReachable(nav, from, to) {
  if (!inBounds(nav.bounds, from) || !inBounds(nav.bounds, to)) return false;
  const fromKey = nodeKey(from);
  const toKey = nodeKey(to);
  if (!nav.passable.has(fromKey) || !nav.passable.has(toKey)) return false;
  const labels = getComponentLabels(nav);
  return labels.get(from) === labels.get(to);
}
