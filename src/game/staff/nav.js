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

// Tiles of margin added around infraOccupied's bounding box, in every
// direction. Staff need to path across bare ground to reach a detached
// building; this bounds that without turning an open-grass path search into
// an unbounded walk (see MAX_EXPANDED_NODES below, the other half of the
// same guard).
const BOUNDS_INFLATE_TILES = 8;

// Movement cost multipliers. Floored tiles are cheap; bare ground (no floor)
// is walkable but expensive, so pawns cross grass to reach a detached
// building without ever preferring it over an available floor route.
const FLOOR_COST = 1;
const GRASS_COST = 2.5;

// Hard cap on nodes actually expanded by one findPath/isReachable call.
// Grass is walkable everywhere in bounds, so without a cap an unreachable
// goal on an open map would walk the entire bounded area every time.
const MAX_EXPANDED_NODES = 20000;

function subtileKey(col, row, subCol, subRow) {
  return col + ',' + row + ',' + subCol + ',' + subRow;
}

function nodeKey(n) {
  return subtileKey(n.col, n.row, n.subCol, n.subRow);
}

function normalizeNode(n) {
  return { col: n.col, row: n.row, subCol: n.subCol, subRow: n.subRow };
}

function parseSubtileKey(key) {
  const p = key.split(',');
  return { col: +p[0], row: +p[1], subCol: +p[2], subRow: +p[3] };
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
 * Build a fresh NavGrid from the current state. `bounds` is infraOccupied's
 * bounding box inflated by BOUNDS_INFLATE_TILES; `passable`/`cost` answer
 * per-subtile queries by consulting the sparse exception sets above rather
 * than a precomputed entry for every subtile.
 */
export function buildNavGrid(state) {
  const infraOccupied = state.infraOccupied || {};
  const subgridOccupied = state.subgridOccupied || {};
  const placeableIndex = state.placeableIndex || {};
  const placeables = state.placeables || [];

  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  // Tiles with a true floor (not an outdoor grounds surface like grass/
  // dirt/pavement — those are walkable ground, not flooring, and must cost
  // the same as unpaved bare ground or a pawn will detour onto a meadow to
  // avoid grass it is already standing on).
  const flooredTiles = new Set();
  for (const key of Object.keys(infraOccupied)) {
    const [c, r] = key.split(',').map(Number);
    if (c < minCol) minCol = c;
    if (c > maxCol) maxCol = c;
    if (r < minRow) minRow = r;
    if (r > maxRow) maxRow = r;
    const type = infraOccupied[key];
    const def = FLOORS[type];
    if (!def || def.groundsSurface !== true) flooredTiles.add(key);
  }
  if (!Number.isFinite(minCol)) {
    // No floor anywhere yet — bound a small area around the origin rather
    // than leaving the grid empty.
    minCol = maxCol = minRow = maxRow = 0;
  }
  minCol -= BOUNDS_INFLATE_TILES;
  maxCol += BOUNDS_INFLATE_TILES;
  minRow -= BOUNDS_INFLATE_TILES;
  maxRow += BOUNDS_INFLATE_TILES;
  const bounds = { minCol, maxCol, minRow, maxRow };

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
    has(key) {
      const { col, row } = parseSubtileKey(key);
      if (col < bounds.minCol || col > bounds.maxCol) return false;
      if (row < bounds.minRow || row > bounds.maxRow) return false;
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

  return {
    revision: state.navRevision || 0,
    passable,
    cost,
    bounds,
    // Not part of the documented shape — carried along so findPath/
    // isReachable can run isBlocked() against the same state the grid was
    // built from without every caller having to pass state back in.
    _state: state,
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

// Weighted (deliberately INADMISSIBLE) heuristic: Manhattan distance in
// subtiles, scaled by GRASS_COST rather than the cheapest possible per-step
// cost (FLOOR_COST). A true admissible heuristic (scaled by FLOOR_COST) can
// overestimate nothing, but it can underestimate a grass-heavy route by up
// to GRASS_COST/FLOOR_COST — and on this game's default map (mostly bare/
// meadow ground; DEFAULT_MAP_HALF_EXTENT = 30, so routine crossings run
// 30-60 tiles), that underestimate is severe enough that A* degrades
// towards Dijkstra's uniform-cost search (effective weight
// FLOOR_COST/GRASS_COST = 0.4) and expands O(d^2) nodes. That blew through
// MAX_EXPANDED_NODES on perfectly reachable goals — a 30-tile diagonal
// grass crossing returned null — which presents downstream as "no staffer
// will take this job", not as a pathfinding bug.
//
// Scaling by GRASS_COST instead trades bounded suboptimality for actually
// terminating: a path this returns is not guaranteed to be the cheapest
// possible (a floor detour that only marginally beats a grass-heavier
// route could be missed), but it always returns SOME reachable path
// quickly rather than hitting the node cap and returning null. For a game
// where "pawn takes a slightly less than optimal route" is invisible and
// "pawn refuses the job" is a visible bug, that's the right trade.
function heuristic(a, b) {
  const dCol = (a.col * 4 + a.subCol) - (b.col * 4 + b.subCol);
  const dRow = (a.row * 4 + a.subRow) - (b.row * 4 + b.subRow);
  return (Math.abs(dCol) + Math.abs(dRow)) * GRASS_COST;
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

// Shared A* core. `wantPath` controls whether the goal's predecessor chain is
// walked back into an array (findPath) or the caller only cares that the
// goal was reached (isReachable) — either way the search itself is
// identical, so isReachable is not meaningfully cheaper, just simpler to
// call.
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

  const open = new MinHeap();
  const gScore = new Map([[fromKey, 0]]);
  const cameFrom = new Map();
  const closed = new Set();

  open.push({ node: normalizeNode(from), key: fromKey }, heuristic(from, to));

  let expanded = 0;
  while (open.size > 0) {
    const current = open.pop();
    if (closed.has(current.key)) continue;
    closed.add(current.key);

    // Test the goal BEFORE charging this expansion against the cap: a goal
    // popped as the (MAX_EXPANDED_NODES + 1)th node is still a real answer,
    // and discarding it there would convert an actually-cheap search into a
    // spurious null right at the threshold.
    if (current.key === toKey) {
      return {
        reached: true,
        path: wantPath ? reconstructPath(cameFrom, current) : null,
      };
    }

    expanded++;
    if (expanded > MAX_EXPANDED_NODES) return { reached: false, path: null };

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
        open.push({ node: step.node, key: nbKey }, tentativeG + heuristic(step.node, to));
      }
    }
  }
  return { reached: false, path: null };
}

/**
 * A* from `from` to `to` (subtile nodes). Returns an array of subtile nodes
 * from `from` to `to` inclusive, or null when unreachable (including start/
 * goal outside bounds, or the node-expansion cap was hit).
 */
export function findPath(nav, from, to) {
  return search(nav, from, to, true).path;
}

/**
 * Like findPath, but only reports reachability — may skip reconstructing the
 * path once the goal is popped.
 */
export function isReachable(nav, from, to) {
  return search(nav, from, to, false).reached;
}
