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

// How far a detour lane sits off the straight line between the two endpoints, in
// tiles. Two sub-tiles: far enough that a route wrapping around a port cannot
// land back on the port's own subtile, small enough that the wrap reads as a
// tidy jog rather than a scenic tour.
const LANE_TILES = 0.5;

/** Snap to the 0.25 sub-tile grid every stored path coordinate lives on. */
function snapQ(v) { return Math.round(v * SUB_PER_TILE) / SUB_PER_TILE; }

/**
 * Unit direction of a→b, or null when the segment is degenerate or diagonal.
 * Deliberately the same shape as line-drawing's segmentDirection.
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

/**
 * Drop the vertices that carry no information: ones coincident with their
 * predecessor, and ones whose two segments run the same way (a 0° turn).
 *
 * Collinear merging cannot change the direction of the first or last segment —
 * it only ever extends a segment backwards or forwards along its own axis — so
 * a path that satisfied validation before still
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

/** Length in tiles of one Manhattan segment, or 0 for a degenerate one. */
function segmentLengthTiles(a, b) {
  return Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
}

/**
 * Whether every leg touching a real corner has enough straight length for the
 * service's physical elbow. A direct run has no corner and is always valid.
 *
 * This is deliberately a centreline rule, not a renderer clamp. A rectangular
 * RF guide cannot hide a 500 mm bend inside a 250 mm leg just because the mesh
 * builder is capable of shrinking the curve until it fits.
 */
export function hasMinimumBendClearance(path, minimumTiles = 0) {
  if (!(minimumTiles > EPS) || !Array.isArray(path) || path.length < 3) return true;
  const simple = simplifyPath(path);
  for (let i = 1; i < simple.length - 1; i++) {
    const before = unitDir(simple[i - 1], simple[i]);
    const after = unitDir(simple[i], simple[i + 1]);
    if (!before || !after) return false;
    if (before.dCol === after.dCol && before.dRow === after.dRow) continue;
    if (segmentLengthTiles(simple[i - 1], simple[i]) + EPS < minimumTiles
      || segmentLengthTiles(simple[i], simple[i + 1]) + EPS < minimumTiles) return false;
  }
  return true;
}

// A line may cross another line of the same utility under the policy in
// line-drawing.js, but it must never cross or revisit itself.
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
 * A ranked set of Manhattan paths between two utility endpoints. Utility
 * routes may turn immediately at every fitting; port normals are geometry hints
 * for ranking equivalent routes and never impose a minimum straight segment.
 *
 * This enumerates a candidate SET rather than emitting a fixed shape: the
 * straight run, both single-corner Ls, and every two-corner route through a
 * candidate cross-coordinate — the endpoints' own rows/cols, their midpoint,
 * and a lane half a tile to either side. Candidates that double back are thrown
 * out, and the survivors are RANKED: fewest corners first, then shortest, then
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
  // their non-zero physical-run rule.
  if (opts.allowZeroLength
    && Math.abs(start.col - end.col) < EPS
    && Math.abs(start.row - end.row) < EPS) {
    return [[
      { col: start.col, row: start.row },
      { col: end.col, row: end.row },
    ]];
  }

  // Mid-routes are the interior waypoints between the endpoints: [] is the
  // straight shot, one point is an L, two points is a jog through a lane.
  const mids = [[]];
  mids.push([{ col: end.col, row: start.row }]);
  mids.push([{ col: start.col, row: end.row }]);
  for (const mx of laneCandidates(start.col, end.col)) {
    mids.push([{ col: mx, row: start.row }, { col: mx, row: end.row }]);
  }
  for (const my of laneCandidates(start.row, end.row)) {
    mids.push([{ col: start.col, row: my }, { col: end.col, row: my }]);
  }

  const preferVertical = !!opts.preferVerticalFirst;
  const scored = [];
  const seen = new Set();

  // An endpoint-facing hint can rank an already-aligned direct run first. The
  // same direct geometry is still generated below when either fitting faces
  // elsewhere, because facing never creates a clearance requirement.
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
  // lane through the endpoint's own column is the horizontal-first L.
  // Deduping here is what stops a caller from running the validator
  // repeatedly on one shape while it walks the list.
  for (const mid of mids) {
    const raw = [start, ...mid, end]
      .map(p => ({ col: snapQ(p.col), row: snapQ(p.row) }));
    const full = simplifyPath(raw);
    if (full.length < 2) continue;
    if (!isManhattan(full)) continue;
    if (pathReversals(full) > 0) continue;
    if (selfIntersects(full)) continue;
    if (!hasMinimumBendClearance(full, opts.minStraightTiles || 0)) continue;

    const key = full.map(p => `${p.col},${p.row}`).join(';');
    if (seen.has(key)) continue;
    seen.add(key);

    // Which way the route leaves the start, for the R-key tie-break.
    let axis = null;
    const legs = [start, ...mid, end];
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
    // Do not hand a self-looping fallback to the caller; it cannot become valid
    // at commit and only hides the real placement problem.
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

// ---------------------------------------------------------------------------
// Board-aware orthogonal routing.
// ---------------------------------------------------------------------------

const CARDINALS = Object.freeze([
  { dCol: 1, dRow: 0, axis: 'h' },
  { dCol: -1, dRow: 0, axis: 'h' },
  { dCol: 0, dRow: 1, axis: 'v' },
  { dCol: 0, dRow: -1, axis: 'v' },
]);

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].priority <= item.priority) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items;
    if (a.length === 0) return null;
    const root = a[0];
    const tail = a.pop();
    if (a.length > 0) {
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        if (l >= a.length) break;
        const r = l + 1;
        const child = r < a.length && a[r].priority < a[l].priority ? r : l;
        if (a[child].priority >= tail.priority) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = tail;
    }
    return root;
  }
  get size() { return this.items.length; }
}

function gridPoint(point) {
  return {
    x: Math.round(point.col * SUB_PER_TILE),
    y: Math.round(point.row * SUB_PER_TILE),
  };
}

function directionIndex(vec) {
  if (!vec) return -1;
  return CARDINALS.findIndex(d => d.dCol === vec.dCol && d.dRow === vec.dRow);
}

function stateKey(x, y, dir, run, runCap) {
  return `${x}:${y}:${dir}:${Math.min(run, runCap)}`;
}

function reconstructRoute(node, records) {
  const points = [];
  let current = node;
  while (current) {
    points.push({ col: current.x / SUB_PER_TILE, row: current.y / SUB_PER_TILE });
    current = current.parent ? records.get(current.parent) : null;
  }
  points.reverse();
  return simplifyPath(points);
}

/**
 * Find a short, low-bend Manhattan path around a board-aware obstacle map.
 *
 * The ordinary candidate generator above remains the fast path. This search is
 * the recovery path for real halls: once an L or U would hit equipment or an
 * installed rigid service, A* walks the quarter-tile service grid instead of
 * asking the player to hand-author a scenic detour. Direction and straight-run
 * length are part of the state, so a waveguide can require roomy elbows while
 * vacuum plumbing may turn on the next sub-tile.
 *
 * `blocked(col,row)` answers whether the centreline may occupy a grid point.
 * Start and goal are always admitted; endpoint fittings own those positions.
 */
export function findObstacleAwareRoute(start, startVec, end, endVec, opts = {}) {
  if (!start || !end) return null;
  const s = gridPoint(start), goal = gridPoint(end);
  const minRunSteps = Math.max(1, Math.ceil((opts.minStraightTiles || 0) * SUB_PER_TILE));
  const startDir = -1;
  const startRun = minRunSteps;
  const bendPenalty = Number.isFinite(opts.bendPenalty) ? Math.max(0, opts.bendPenalty) : 3;
  const maxExpanded = Number.isFinite(opts.maxExpanded) ? Math.max(100, opts.maxExpanded) : 12000;
  const directSteps = Math.abs(goal.x - s.x) + Math.abs(goal.y - s.y);
  const marginSteps = Math.max(
    Math.ceil((opts.searchMarginTiles || 5) * SUB_PER_TILE),
    Math.ceil(directSteps * 0.35),
  );
  const minX = Math.min(s.x, goal.x) - marginSteps;
  const maxX = Math.max(s.x, goal.x) + marginSteps;
  const minY = Math.min(s.y, goal.y) - marginSteps;
  const maxY = Math.max(s.y, goal.y) + marginSteps;
  const isBlocked = typeof opts.blocked === 'function' ? opts.blocked : () => false;
  const preferVertical = !!opts.preferVerticalFirst;
  const directions = CARDINALS.slice().sort((a, b) => {
    const ap = (a.axis === 'v') === preferVertical ? 0 : 1;
    const bp = (b.axis === 'v') === preferVertical ? 0 : 1;
    return ap - bp;
  });

  const records = new Map();
  const best = new Map();
  const heap = new MinHeap();
  const firstKey = stateKey(s.x, s.y, startDir, startRun, minRunSteps);
  const first = {
    x: s.x, y: s.y, dir: startDir, run: startRun,
    cost: 0, priority: directSteps, parent: null, key: firstKey,
  };
  records.set(firstKey, first);
  best.set(firstKey, 0);
  heap.push(first);

  let expanded = 0;
  let winner = null;
  while (heap.size > 0 && expanded < maxExpanded) {
    const current = heap.pop();
    if (!current || current.cost !== best.get(current.key)) continue;
    expanded++;
    if (current.x === goal.x && current.y === goal.y) {
      winner = current;
      break;
    }
    for (const d of directions) {
      const nextDir = directionIndex(d);
      const reversing = current.dir >= 0
        && CARDINALS[current.dir].dCol === -d.dCol
        && CARDINALS[current.dir].dRow === -d.dRow;
      if (reversing) continue;
      const turning = current.dir >= 0 && nextDir !== current.dir;
      if (turning && current.run < minRunSteps) continue;
      const nx = current.x + d.dCol;
      const ny = current.y + d.dRow;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      const atGoal = nx === goal.x && ny === goal.y;
      if (!atGoal && isBlocked(nx / SUB_PER_TILE, ny / SUB_PER_TILE)) continue;
      const run = turning ? 1 : current.run + 1;
      const cost = current.cost + 1 + (turning ? bendPenalty : 0);
      const key = stateKey(nx, ny, nextDir, run, minRunSteps);
      if (best.has(key) && best.get(key) <= cost) continue;
      const heuristic = Math.abs(goal.x - nx) + Math.abs(goal.y - ny);
      // A tiny preferred-axis tie break changes equal routes without ever
      // outranking a shorter or lower-bend path; this keeps the R key useful.
      const axisNudge = ((d.axis === 'v') === preferVertical) ? 0 : 0.01;
      const node = {
        x: nx, y: ny, dir: nextDir, run, cost,
        priority: cost + heuristic + axisNudge,
        parent: current.key, key,
      };
      records.set(key, node);
      best.set(key, cost);
      heap.push(node);
    }
  }
  if (!winner) return null;
  const middle = reconstructRoute(winner, records);
  const full = simplifyPath([start, ...middle.slice(1, -1), end]);
  if (full.length < 2 || !isManhattan(full) || pathReversals(full) > 0
    || selfIntersects(full)
    || !hasMinimumBendClearance(full, opts.minStraightTiles || 0)) return null;
  return full;
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
