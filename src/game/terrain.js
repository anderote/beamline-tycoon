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
export const HEIGHT_MIN = -2;
export const HEIGHT_MAX = 8;

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
    // Step one toward anchor.
    if (arr[worstIdx] < anchorValue) arr[worstIdx] += 1;
    else if (arr[worstIdx] > anchorValue) arr[worstIdx] -= 1;
    else {
      // Equal to anchor but invariant still violated — means some other
      // corner is the offender. Pick furthest-from-anchor among non-equal.
      let altIdx = -1, altDist = -1;
      for (let i = 0; i < 4; i++) {
        if (i === anchorIdx) continue;
        if (arr[i] === anchorValue) continue;
        const d = Math.abs(arr[i] - anchorValue);
        if (d > altDist) { altDist = d; altIdx = i; }
      }
      if (altIdx < 0) return;
      if (arr[altIdx] < anchorValue) arr[altIdx] += 1;
      else arr[altIdx] -= 1;
    }
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
 * Bulk-sets all 4 corners of a tile. Each value is clamped to the height
 * range. After writing, the invariant is enforced (anchored on the NW
 * corner — arbitrary but deterministic). Bumps revision. If the final
 * state is all zeros, removes the entry.
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
 */
export function deserializeCornerHeights(array) {
  const map = new Map();
  if (!array || !array.length) return map;
  for (const entry of array) {
    const [col, row, nw, ne, se, sw] = entry;
    const arr = new Int8Array(4);
    arr[NW] = nw; arr[NE] = ne; arr[SE] = se; arr[SW] = sw;
    map.set(col + ',' + row, arr);
  }
  return map;
}
