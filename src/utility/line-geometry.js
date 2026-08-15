// src/utility/line-geometry.js
//
// Pure geometry helpers for utility lines. Unlike beam pipes, utility lines
// support 90° Manhattan bends. Paths are stored as corner-only waypoints;
// expansion walks them at sub-tile (0.25) resolution for hit-testing and mesh
// generation.
//
// One tile = 4 sub-units. A sub-unit = 0.5 world meters.

const STEP = 0.25;
const SUB_PER_TILE = 4;
const EPS = 1e-6;

// Height in world metres at which utility lines run. Geometric rather than
// cosmetic: the renderer draws at this height AND the input tool has to pick
// against a plane at this height, or the drawing lands up-screen of the cursor
// (iso projection turns half a metre of elevation into 15-25 px of offset).
export const UTILITY_LINE_Y = 0.5;

export function buildManhattanPath(start, end, opts = {}) {
  if (!start || !end) return null;
  const dc = end.col - start.col;
  const dr = end.row - start.row;
  if (Math.abs(dc) < EPS && Math.abs(dr) < EPS) return null;

  if (Math.abs(dc) < EPS || Math.abs(dr) < EPS) {
    return [{ col: start.col, row: start.row }, { col: end.col, row: end.row }];
  }

  const corner = opts.preferVerticalFirst
    ? { col: start.col, row: end.row }
    : { col: end.col, row: start.row };
  return [
    { col: start.col, row: start.row },
    corner,
    { col: end.col, row: end.row },
  ];
}

// Every port owns one fixed horizontal tail before a utility run may bend.
// One sub-unit = 0.25 tiles = 0.5 world metres. The tail is part of the line's
// stored polyline so validation, cost, overlap and rendering all agree on the
// same physical clearance.
export const PORT_TAIL_TILES = 0.25;

// How far a detour lane sits off the straight line between the two stubs, in
// tiles. Two sub-tiles: far enough that a route wrapping around a port cannot
// land back on the port's own subtile, small enough that the wrap reads as a
// tidy jog rather than a scenic tour.
const LANE_TILES = 0.5;

/** Snap to the 0.25 sub-tile grid every stored path coordinate lives on. */
function snapQ(v) { return Math.round(v * SUB_PER_TILE) / SUB_PER_TILE; }

/**
 * Unit direction of a→b, or null when the segment is degenerate or diagonal.
 * Deliberately the same shape as line-drawing's segmentDirection — the two have
 * to agree about what "the first segment runs along the port normal" means.
 */
function unitDir(a, b) {
  const dc = b.col - a.col;
  const dr = b.row - a.row;
  const hasC = Math.abs(dc) > EPS;
  const hasR = Math.abs(dr) > EPS;
  if (hasC && hasR) return null;
  if (hasC) return { dCol: Math.sign(dc), dRow: 0 };
  if (hasR) return { dCol: 0, dRow: Math.sign(dr) };
  return null;
}

/** The grid point immediately outside a port's fixed horizontal tail. */
export function portTailPoint(port, vec) {
  if (!port) return null;
  if (!vec) return { col: port.col, row: port.row };
  return {
    col: snapQ(port.col + vec.dCol * PORT_TAIL_TILES),
    row: snapQ(port.row + vec.dRow * PORT_TAIL_TILES),
  };
}

/**
 * Drop the vertices that carry no information: ones coincident with their
 * predecessor, and ones whose two segments run the same way (a 0° turn).
 *
 * This is what lets the router think in terms of mandatory 0.25 stubs without
 * paying for them. A stub that happens to point the same way as the leg after
 * it is not a corner, it is the first quarter tile of that leg — but left in
 * the waypoint list it reads as one to everything downstream: the renderer
 * emits a seam and a corner fitting there, pathLengthSubUnits is unaffected but
 * the mesh is not, and every "how many bends does this route have" judgement
 * (including this file's own scoring) counts it.
 *
 * Collinear merging cannot change the direction of the first or last segment —
 * it only ever extends a segment backwards or forwards along its own axis — so
 * a path that satisfied validateDrawLine's port-approach checks before still
 * does after.
 */
export function simplifyPath(path) {
  if (!Array.isArray(path)) return [];
  const out = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.col - p.col) < EPS && Math.abs(last.row - p.row) < EPS) continue;
    out.push({ col: p.col, row: p.row });
  }
  let i = 1;
  while (i < out.length - 1) {
    const d1 = unitDir(out[i - 1], out[i]);
    const d2 = unitDir(out[i], out[i + 1]);
    if (d1 && d2 && d1.dCol === d2.dCol && d1.dRow === d2.dRow) out.splice(i, 1);
    else i++;
  }
  return out;
}

/**
 * How many 180° turns the path makes — places where it doubles back along the
 * axis it just travelled. Zero is the only acceptable answer for a route we
 * would show a player: a hairpin is never the shortest way anywhere, it is
 * always the router failing to reconcile two constraints.
 */
export function pathReversals(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  const dirs = [];
  for (let i = 0; i < path.length - 1; i++) {
    const d = unitDir(path[i], path[i + 1]);
    if (d) dirs.push(d);
  }
  let count = 0;
  for (let i = 0; i < dirs.length - 1; i++) {
    if (dirs[i].dCol === -dirs[i + 1].dCol && dirs[i].dRow === -dirs[i + 1].dRow) count++;
  }
  return count;
}

function isManhattan(path) {
  for (let i = 0; i < path.length - 1; i++) {
    const dc = path[i + 1].col - path[i].col;
    const dr = path[i + 1].row - path[i].row;
    if (Math.abs(dc) > EPS && Math.abs(dr) > EPS) return false;
  }
  return true;
}

// A line may cross another line of the same utility under the policy in
// line-drawing.js, but it must never cross or revisit itself. The old fallback
// could do exactly that when two fixed port tails landed on each other's base
// point, producing a loop that looked like an inexplicable failed connection.
function selfIntersects(path) {
  const seen = new Set();
  for (const point of expandPath(path)) {
    const key = `${Math.round(point.col * SUB_PER_TILE)},${Math.round(point.row * SUB_PER_TILE)}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/** Unique, grid-snapped cross-coordinates a detour leg is allowed to sit on. */
function laneCandidates(v1, v2) {
  const raw = [
    v1, v2, (v1 + v2) / 2,
    v1 - LANE_TILES, v1 + LANE_TILES,
    v2 - LANE_TILES, v2 + LANE_TILES,
  ];
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const q = snapQ(v);
    if (seen.has(q)) continue;
    seen.add(q);
    out.push(q);
  }
  return out;
}

/**
 * A Manhattan path that also satisfies the approach constraint of whichever of
 * its two ends is anchored on a port: it leaves the start along that port's
 * outward normal and arrives at the end against the end port's outward normal
 * (what line-drawing's portMatchesApproach demands of the first and last
 * segment). Ends with no port — an open-ended draw — take no lead-out.
 *
 * A plain start→end Manhattan L only satisfies those constraints by luck: with
 * one bend the first leg is horizontal and the last vertical (or vice versa),
 * so every drag between two ports whose sides don't happen to match that shape
 * was rejected. The lead-outs make the shape a property of the ports instead.
 *
 * But lead-outs plus ONE interior corner is still only one shape, and one shape
 * cannot serve every pair of port normals. When the two stubs point the wrong
 * way for each other — two ports facing the same direction, or facing away from
 * each other across the gap between them — the single L has nowhere to put the
 * reconciliation, so it hairpins: pokes out along the start normal, reverses,
 * overshoots the sink, reverses back. Half of all normal/offset combinations
 * did that, and a quarter of them did it whichever bend order you asked for.
 *
 * Nothing downstream caught it, either, because the stubs guarantee the FIRST
 * and LAST segment directions are right no matter how ugly the middle is, and
 * the first and last segments are all validateDrawLine looks at.
 *
 * So this enumerates a candidate SET rather than emitting a fixed shape: the
 * straight run, both single-corner Ls, and every two-corner route through a
 * candidate cross-coordinate — the stubs' own rows/cols, their midpoint, and a
 * lane half a tile to either side. The ±lane entries are the ones that make
 * "outside" U-shaped routes reachable, which is the only way to serve two ports
 * that face the same way. Candidates that double back are thrown out, and the
 * survivors are RANKED: fewest corners first, then shortest, then
 * preferVerticalFirst to choose between genuinely equivalent routes so the R
 * key still does something.
 *
 * The ranking is returned rather than just its winner because geometry is only
 * half of what makes a route usable — the other half is the rest of the board,
 * which this function cannot see. A caller with a board (the drag controller)
 * walks the list and takes the best one the validator accepts, so a preferred
 * route lying on top of an existing run of the same utility means the drag
 * takes the next shape down instead of refusing. A caller without one
 * (run-wiring, planning stubs against a hypothetical future board) just takes
 * the head.
 *
 * @param {{col,row}} start
 * @param {{dCol,dRow}|null} startVec  outward normal of the start port
 * @param {{col,row}} end
 * @param {{dCol,dRow}|null} endVec    outward normal of the end port
 * @returns {Array<Array<{col,row}>>} distinct routes, best first; may be empty
 */
export function buildPortRoutedPaths(start, startVec, end, endVec, opts = {}) {
  if (!start || !end) return [];

  // Cables can join two fittings that occupy the same routing point (for
  // example a compact distribution unit mounted directly against its load).
  // Keep two waypoints so every downstream line consumer still sees a normal
  // path, but deliberately give it zero physical length. Other services keep
  // their minimum run/clearance rule.
  if (opts.allowZeroLength
    && Math.abs(start.col - end.col) < EPS
    && Math.abs(start.row - end.row) < EPS) {
    return [[
      { col: start.col, row: start.row },
      { col: end.col, row: end.row },
    ]];
  }

  // `a1` and `b1` are the routing anchors: the free-form Manhattan section
  // starts only AFTER the one-subtile port tails. That section may turn on any
  // grid subtile; only the first and final tail segments are directional.
  const a1 = portTailPoint(start, startVec);
  const b1 = portTailPoint(end, endVec);

  // Mid-routes are the interior waypoints between the two stub tips: [] is the
  // straight shot, one point is an L, two points is a jog through a lane.
  const mids = [[]];
  mids.push([{ col: b1.col, row: a1.row }]);
  mids.push([{ col: a1.col, row: b1.row }]);
  for (const mx of laneCandidates(a1.col, b1.col)) {
    mids.push([{ col: mx, row: a1.row }, { col: mx, row: b1.row }]);
  }
  for (const my of laneCandidates(a1.row, b1.row)) {
    mids.push([{ col: a1.col, row: my }, { col: b1.col, row: my }]);
  }

  const preferVertical = !!opts.preferVerticalFirst;
  const scored = [];
  const seen = new Set();

  // If the ports already face each other on one grid line, the direct run is
  // not merely legal — it is the only sensible shape. The ordinary lead-outs
  // are each one subtile long, so for ports one subtile apart they meet (or
  // pass each other) and turn a 0.25-tile cable into a self-crossing loop.
  // Keep it in the candidate set rather than returning early: if a trunk
  // occupies the direct route, the board-aware caller can still select a
  // longer clear detour below.
  const direct = buildManhattanPath(start, end, opts);
  if (direct && direct.length === 2) {
    const direction = unitDir(direct[0], direct[1]);
    const leavesStart = !startVec
      || (direction.dCol === startVec.dCol && direction.dRow === startVec.dRow);
    const entersEnd = !endVec
      || (-direction.dCol === endVec.dCol && -direction.dRow === endVec.dRow);
    if (leavesStart && entersEnd) {
      const length = Math.abs(end.col - start.col) + Math.abs(end.row - start.row);
      scored.push({ path: direct, corners: 0, length, axisPenalty: 0, order: -1 });
      seen.add(direct.map(p => `${p.col},${p.row}`).join(';'));
    }
  }

  // Different mid-routes collapse onto the same geometry all the time — the
  // lane through b1's own column IS the horizontal-first L once the stubs
  // merge. Deduping here is what stops a caller from running the validator
  // repeatedly on one shape while it walks the list.
  for (const mid of mids) {
    const raw = [start, a1, ...mid, b1, end]
      .map(p => ({ col: snapQ(p.col), row: snapQ(p.row) }));
    const full = simplifyPath(raw);
    if (full.length < 2) continue;
    if (!isManhattan(full)) continue;
    if (pathReversals(full) > 0) continue;
    if (selfIntersects(full)) continue;

    const key = full.map(p => `${p.col},${p.row}`).join(';');
    if (seen.has(key)) continue;
    seen.add(key);

    // Which way the route leaves the start stub, for the R-key tie-break. Read
    // off the mid-route rather than the simplified path so that a stub which
    // merged into its leg still reports the axis the player would call "first".
    let axis = null;
    const legs = [a1, ...mid, b1];
    for (let i = 0; i < legs.length - 1 && !axis; i++) {
      const d = unitDir(legs[i], legs[i + 1]);
      if (d) axis = d.dRow !== 0 ? 'v' : 'h';
    }
    const axisPenalty = axis === null ? 1 : ((axis === 'v') === preferVertical ? 0 : 1);

    let length = 0;
    for (let i = 0; i < full.length - 1; i++) {
      length += Math.abs(full[i + 1].col - full[i].col) + Math.abs(full[i + 1].row - full[i].row);
    }
    scored.push({ path: full, corners: full.length - 2, length, axisPenalty, order: scored.length });
  }

  if (scored.length === 0) {
    // No legal path means the fixed port tails have consumed the available
    // clearance. Do not hand a self-looping fallback to the caller; it cannot
    // become valid at commit and only hides the real placement problem.
    return [];
  }

  scored.sort((x, y) => (
    x.corners - y.corners
    || x.length - y.length
    || x.axisPenalty - y.axisPenalty
    || x.order - y.order
  ));
  return scored.map(s => s.path);
}

/**
 * The single best route by the ranking above, or null. See
 * buildPortRoutedPaths — this is its head, and exists because most callers
 * have no board to check candidates against.
 *
 * @returns {Array<{col,row}>|null}
 */
export function buildPortRoutedPath(start, startVec, end, endVec, opts = {}) {
  const all = buildPortRoutedPaths(start, startVec, end, endVec, opts);
  return all.length > 0 ? all[0] : null;
}

export function pathLengthSubUnits(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    total += Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
  }
  return Math.round(total * SUB_PER_TILE);
}

export function expandPath(path) {
  if (!Array.isArray(path) || path.length === 0) return [];
  if (path.length === 1) return [{ col: path[0].col, row: path[0].row }];
  const out = [{ col: path[0].col, row: path[0].row }];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dist = Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
    if (dist < EPS) continue;
    const steps = Math.max(1, Math.round(dist / STEP));
    const dcStep = (b.col - a.col) / steps;
    const drStep = (b.row - a.row) / steps;
    for (let s = 1; s <= steps; s++) {
      out.push({ col: a.col + dcStep * s, row: a.row + drStep * s });
    }
  }
  return out;
}

export const SUBTILE_STEP = STEP;
export const SUB_PER_TILE_CONST = SUB_PER_TILE;
