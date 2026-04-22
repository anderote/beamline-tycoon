// src/game/terrain.js — per-corner terrain heightmap accessors.
//
// Each tile owns its own 4 corner heights (RCT2-style). Storage is sparse:
// `state.cornerHeights` is a `Map<"col,row", Int8Array(4)>`. A tile absent
// from the map is implicitly flat at all zeros. Heights are integer "steps";
// one step = HEIGHT_STEP_METERS in world space.
//
// Within-tile invariant: `max(corners) − min(corners) ≤ 1 step`. Mutations
// cascade the three other corners of the same tile to maintain this; no
// cross-tile cascade.
//
// `state.cornerHeightsRevision` is a monotonic counter; every mutation
// increments it so renderer caches can skip rebuilds by comparing.

export const HEIGHT_STEP_METERS = 0.5;
export const HEIGHT_MIN = -4;
export const HEIGHT_MAX = 6;

export const NW = 0;
export const NE = 1;
export const SE = 2;
export const SW = 3;

function key(col, row) { return col + ',' + row; }

function clampValue(v) {
  if (v < HEIGHT_MIN) return HEIGHT_MIN;
  if (v > HEIGHT_MAX) return HEIGHT_MAX;
  return v | 0; // ensure integer
}

function getOrCreate(state, col, row) {
  const k = key(col, row);
  let arr = state.cornerHeights.get(k);
  if (!arr) {
    arr = new Int8Array(4);
    state.cornerHeights.set(k, arr);
  }
  return arr;
}

// Enforce the per-tile invariant by clamping the THREE other corners of the
// same tile toward `anchorValue` until max − min ≤ 1.
//
// Policy: find the corner (among those other than `anchorIdx`) whose value is
// furthest from `anchorValue`; clamp it by one step toward `anchorValue`.
// Repeat until invariant holds. Terminates because each step strictly shrinks
// the distance between at least one corner and `anchorValue`, so within a
// bounded range the loop converges.
function enforceInvariant(arr, anchorIdx, anchorValue) {
  // Hard safety cap — should never trip; the finite value range + monotonic
  // clamping guarantees convergence well within this many passes.
  const MAX_PASSES = 64;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let mn = arr[0], mx = arr[0];
    for (let i = 1; i < 4; i++) {
      const v = arr[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mx - mn <= 1) return;
    // Find furthest-from-anchor among the 3 non-anchor corners.
    let worstIdx = -1, worstDist = -1;
    for (let i = 0; i < 4; i++) {
      if (i === anchorIdx) continue;
      const d = Math.abs(arr[i] - anchorValue);
      if (d > worstDist) { worstDist = d; worstIdx = i; }
    }
    if (worstIdx < 0) return; // defensive
    // Invariant (pigeonhole): since max − min > 1 and arr[anchorIdx] ===
    // anchorValue, at least one non-anchor corner must differ from the
    // anchor by more than 1 — so arr[worstIdx] !== anchorValue here. If
    // a future change to the caller contract ever breaks this assumption,
    // fail loudly rather than silently spinning to MAX_PASSES.
    if (arr[worstIdx] === anchorValue) {
      throw new Error(
        `[terrain] enforceInvariant: unreachable state — worst non-anchor corner equals anchor ` +
        `(anchorIdx=${anchorIdx}, anchorValue=${anchorValue}, arr=[${arr[0]},${arr[1]},${arr[2]},${arr[3]}])`
      );
    }
    // Step one toward anchor.
    if (arr[worstIdx] < anchorValue) arr[worstIdx] += 1;
    else arr[worstIdx] -= 1;
  }
}

function removeIfAllZero(state, col, row, arr) {
  if (arr[0] === 0 && arr[1] === 0 && arr[2] === 0 && arr[3] === 0) {
    state.cornerHeights.delete(key(col, row));
  }
}

/**
 * Returns { nw, ne, se, sw } integer step values for the tile. Absent tile
 * returns all zeros (no allocation into the sparse map).
 */
export function getTileCorners(state, col, row) {
  const arr = state.cornerHeights.get(key(col, row));
  if (!arr) return { nw: 0, ne: 0, se: 0, sw: 0 };
  return { nw: arr[NW], ne: arr[NE], se: arr[SE], sw: arr[SW] };
}

/**
 * Same as getTileCorners but multiplied by HEIGHT_STEP_METERS (world meters).
 */
export function getTileCornersY(state, col, row) {
  const c = getTileCorners(state, col, row);
  return {
    nw: c.nw * HEIGHT_STEP_METERS,
    ne: c.ne * HEIGHT_STEP_METERS,
    se: c.se * HEIGHT_STEP_METERS,
    sw: c.sw * HEIGHT_STEP_METERS,
  };
}

/**
 * Bilinearly interpolate a height within a tile from its 4 corner values.
 * `corners` is `{ nw, ne, se, sw }` (any numeric units — steps or meters).
 * `(u, v)` are local tile coords in `[0, 1]`, where `(0, 0)` = NW and
 * `(1, 1)` = SE. Pure function; caller supplies corners.
 */
export function sampleCornersAt(corners, u, v) {
  const iu = 1 - u;
  const iv = 1 - v;
  return iu * iv * corners.nw
       +  u * iv * corners.ne
       +  u *  v * corners.se
       + iu *  v * corners.sw;
}

/**
 * Triangulated sample at sub-tile coords (u, v) ∈ [0, 1] using the SAME
 * diagonal split (SW→NE) as `terrain-builder`. Matches the rendered mesh
 * exactly. Pure function — caller supplies corners; useful when you want
 * to sample inside ONE specific tile and never reach into a neighbour
 * (e.g. footprint corners at u=1 or v=1).
 *
 * Triangle 1 (NW, SW, NE) covers u+v ≤ 1.
 * Triangle 2 (NE, SW, SE) covers u+v > 1.
 */
export function sampleCornersTriangulated(corners, u, v) {
  if (u + v <= 1) {
    return (1 - u - v) * corners.nw + u * corners.ne + v * corners.sw;
  }
  return (1 - v) * corners.ne + (1 - u) * corners.sw + (u + v - 1) * corners.se;
}

/**
 * Sample the terrain surface Y (world meters) at any world (x, z).
 * Resolves the containing tile and triangulates with the same diagonal
 * as the rendered mesh. Tile size = 2 world units.
 *
 * Note: at exact tile boundaries (worldX = col*2), this returns the
 * sample from the EAST tile (the tile starting at that x). For footprint
 * corners that should stay within a known tile, use
 * `sampleCornersTriangulated` directly with that tile's corners instead.
 */
export function sampleSurfaceYAt(state, worldX, worldZ) {
  const col = Math.floor(worldX / 2);
  const row = Math.floor(worldZ / 2);
  const u = (worldX - col * 2) / 2;
  const v = (worldZ - row * 2) / 2;
  return sampleCornersTriangulated(getTileCornersY(state, col, row), u, v);
}

export function sampleGroundTypeAt(state, x, z) {
  const col = Math.floor(x / 2);
  const row = Math.floor(z / 2);
  const infra = state.infraOccupied?.[col + ',' + row];
  return infra ?? null;
}

export function getCornerHeight(state, col, row, cornerIdx) {
  const arr = state.cornerHeights.get(key(col, row));
  if (!arr) return 0;
  return arr[cornerIdx];
}

/**
 * Writes one corner height for a tile, creating the entry if needed. Clamps
 * `value` to [HEIGHT_MIN, HEIGHT_MAX]. Enforces the per-tile invariant by
 * cascading the three other corners toward the new value. Bumps
 * `state.cornerHeightsRevision`. Removes the entry if all 4 corners end up
 * at zero.
 */
export function setCornerHeight(state, col, row, cornerIdx, value) {
  const v = clampValue(value);
  const arr = getOrCreate(state, col, row);
  arr[cornerIdx] = v;
  enforceInvariant(arr, cornerIdx, v);
  state.cornerHeightsRevision = (state.cornerHeightsRevision | 0) + 1;
  removeIfAllZero(state, col, row, arr);
}

/**
 * Bulk-sets all 4 corners of a tile.
 *
 * Semantics:
 *  1. Each input value (nw, ne, se, sw) is first clamped to
 *     `[HEIGHT_MIN, HEIGHT_MAX]`.
 *  2. If the post-clamp set violates the per-tile invariant
 *     (max − min > 1 step), the invariant is enforced by cascading the
 *     OTHER THREE corners toward the NW value. **NW is the anchor — its
 *     value wins in any conflict**, and the other three are clamped
 *     (one step at a time, furthest-from-anchor first) until the
 *     invariant holds.
 *
 * Landmine: if a caller passes e.g. `{nw: 0, ne: 0, se: 0, sw: 3}`, SW is
 * silently clamped DOWN to 1 — the caller's SW=3 is discarded because NW
 * is the anchor. Callers that need a different anchor (e.g. "SW wins")
 * must pre-resolve conflicts themselves before calling, or use
 * `setCornerHeight` with the desired anchor corner.
 *
 * After enforcement the revision counter is bumped and, if the final
 * state is all zeros, the sparse-map entry is removed.
 */
export function setTileCorners(state, col, row, { nw, ne, se, sw }) {
  const arr = getOrCreate(state, col, row);
  arr[NW] = clampValue(nw);
  arr[NE] = clampValue(ne);
  arr[SE] = clampValue(se);
  arr[SW] = clampValue(sw);
  enforceInvariant(arr, NW, arr[NW]);
  state.cornerHeightsRevision = (state.cornerHeightsRevision | 0) + 1;
  removeIfAllZero(state, col, row, arr);
}

/**
 * True when the tile entry is absent, or when all 4 corners are equal.
 */
export function isTileFlat(state, col, row) {
  const arr = state.cornerHeights.get(key(col, row));
  if (!arr) return true;
  const v = arr[0];
  return arr[1] === v && arr[2] === v && arr[3] === v;
}

/**
 * Serialize the sparse map to an array of [col, row, nw, ne, se, sw] entries.
 * By sparsity invariant, every entry is non-trivial (all-zeros entries get
 * removed on mutation), so this is just an Array.from walk.
 */
export function serializeCornerHeights(map) {
  const out = [];
  for (const [k, arr] of map) {
    const comma = k.indexOf(',');
    const col = Number(k.slice(0, comma));
    const row = Number(k.slice(comma + 1));
    out.push([col, row, arr[NW], arr[NE], arr[SE], arr[SW]]);
  }
  return out;
}

/**
 * Inverse of serializeCornerHeights. Returns a fresh Map.
 *
 * Defensive against malformed entries (old/corrupted saves): any entry
 * that is not a length-≥6 array is skipped with a console warning rather
 * than thrown — old-save leniency matches the project's Game.load
 * backward-compat pattern.
 */
export function deserializeCornerHeights(array) {
  const map = new Map();
  if (!array || !array.length) return map;
  for (const entry of array) {
    if (!Array.isArray(entry) || entry.length < 6) {
      console.warn('[terrain] skipping malformed cornerHeights entry', entry);
      continue;
    }
    const [col, row, nw, ne, se, sw] = entry;
    const arr = new Int8Array(4);
    arr[NW] = nw; arr[NE] = ne; arr[SE] = se; arr[SW] = sw;
    map.set(col + ',' + row, arr);
  }
  return map;
}
