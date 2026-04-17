// test/test-terrain-heightmap.js — unit tests for the per-corner terrain heightmap API.
import {
  HEIGHT_STEP_METERS,
  HEIGHT_MIN,
  HEIGHT_MAX,
  NW, NE, SE, SW,
  getTileCorners,
  getTileCornersY,
  getCornerHeight,
  setCornerHeight,
  setTileCorners,
  isTileFlat,
  serializeCornerHeights,
  deserializeCornerHeights,
} from '../src/game/terrain.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeState() {
  return { cornerHeights: new Map(), cornerHeightsRevision: 0 };
}

// --- Constants sanity ---
assert(HEIGHT_STEP_METERS === 0.5, 'HEIGHT_STEP_METERS = 0.5');
assert(HEIGHT_MIN === -4, 'HEIGHT_MIN = -4');
assert(HEIGHT_MAX === 6, 'HEIGHT_MAX = 6');
assert(NW === 0 && NE === 1 && SE === 2 && SW === 3, 'corner indices NW=0, NE=1, SE=2, SW=3');

// --- all-zeros default ---
{
  const s = makeState();
  const c = getTileCorners(s, 3, 4);
  assert(c.nw === 0 && c.ne === 0 && c.se === 0 && c.sw === 0,
    'getTileCorners on absent tile returns all zeros');
  assert(s.cornerHeights.size === 0, 'getTileCorners does not allocate on absent tile');
  assert(getCornerHeight(s, 3, 4, NW) === 0, 'getCornerHeight returns 0 for absent tile');
  assert(isTileFlat(s, 3, 4) === true, 'isTileFlat true for absent tile');
}

// --- setCornerHeight writes + bumps revision ---
{
  const s = makeState();
  const rev0 = s.cornerHeightsRevision;
  setCornerHeight(s, 5, 6, NW, 1);
  assert(s.cornerHeightsRevision === rev0 + 1, 'setCornerHeight bumps revision by 1');
  const c = getTileCorners(s, 5, 6);
  assert(c.nw === 1, 'setCornerHeight writes NW=1');
  // Invariant holds — other corners all 0, NW=1, max-min=1.
  const vals = [c.nw, c.ne, c.se, c.sw];
  const mn = Math.min(...vals), mx = Math.max(...vals);
  assert(mx - mn <= 1, `per-tile invariant max-min ≤ 1 (got ${mx - mn})`);
}

// --- Invariant cascade: setting NW=3 on all-zero tile must converge ---
{
  const s = makeState();
  setCornerHeight(s, 0, 0, NW, 3);
  const c = getTileCorners(s, 0, 0);
  assert(c.nw === 3, 'cascade: NW preserved at set value 3');
  const vals = [c.nw, c.ne, c.se, c.sw];
  const mn = Math.min(...vals), mx = Math.max(...vals);
  assert(mx - mn <= 1, `cascade: invariant holds (nw=${c.nw} ne=${c.ne} se=${c.se} sw=${c.sw}, diff=${mx - mn})`);
  // Since NW=3 is the written value and invariant max-min≤1, the other three must be >= 2.
  assert(c.ne >= 2 && c.se >= 2 && c.sw >= 2,
    `cascade: other corners clamped toward 3 (ne=${c.ne}, se=${c.se}, sw=${c.sw})`);
}

// --- Invariant cascade: another direction (negative value) ---
{
  const s = makeState();
  setCornerHeight(s, 2, 2, SE, -2);
  const c = getTileCorners(s, 2, 2);
  assert(c.se === -2, 'cascade: SE preserved at -2');
  const vals = [c.nw, c.ne, c.se, c.sw];
  const mn = Math.min(...vals), mx = Math.max(...vals);
  assert(mx - mn <= 1, `cascade (down): invariant holds (diff=${mx - mn})`);
  assert(c.nw <= -1 && c.ne <= -1 && c.sw <= -1,
    `cascade (down): other corners clamped toward -2 (nw=${c.nw}, ne=${c.ne}, sw=${c.sw})`);
}

// --- Value clamping to [HEIGHT_MIN, HEIGHT_MAX] ---
{
  const s = makeState();
  setCornerHeight(s, 1, 1, NW, 999);
  assert(getCornerHeight(s, 1, 1, NW) === HEIGHT_MAX, `value clamped to HEIGHT_MAX (${HEIGHT_MAX})`);
  const s2 = makeState();
  setCornerHeight(s2, 1, 1, SW, -999);
  assert(getCornerHeight(s2, 1, 1, SW) === HEIGHT_MIN, `value clamped to HEIGHT_MIN (${HEIGHT_MIN})`);
}

// --- setTileCorners bulk-sets and validates invariant ---
{
  const s = makeState();
  setTileCorners(s, 7, 8, { nw: 2, ne: 2, se: 1, sw: 1 });
  const c = getTileCorners(s, 7, 8);
  assert(c.nw === 2 && c.ne === 2 && c.se === 1 && c.sw === 1,
    'setTileCorners bulk-sets all 4 corners when input is already valid');
  assert(s.cornerHeightsRevision >= 1, 'setTileCorners bumps revision');
}

// --- setTileCorners with invariant-violating input: clamps to satisfy invariant ---
{
  const s = makeState();
  setTileCorners(s, 9, 9, { nw: 3, ne: 0, se: 0, sw: 0 });
  const c = getTileCorners(s, 9, 9);
  const vals = [c.nw, c.ne, c.se, c.sw];
  const mn = Math.min(...vals), mx = Math.max(...vals);
  assert(mx - mn <= 1, `setTileCorners invariant cascade keeps diff ≤ 1 (got ${mx - mn})`);
}

// --- setTileCorners with MAX-SPREAD input must converge (NW-anchored) ---
// Worst legal input: corners alternate HEIGHT_MAX/HEIGHT_MIN. Full spread is
// HEIGHT_MAX − HEIGHT_MIN = 10 steps. Cascading the 3 non-anchor corners
// toward NW must converge without hitting the MAX_PASSES fuse (64).
{
  const s = makeState();
  setTileCorners(s, 0, 0, {
    nw: HEIGHT_MAX,
    ne: HEIGHT_MIN,
    se: HEIGHT_MAX,
    sw: HEIGHT_MIN,
  });
  const c = getTileCorners(s, 0, 0);
  const vals = [c.nw, c.ne, c.se, c.sw];
  const mn = Math.min(...vals), mx = Math.max(...vals);
  assert(mx - mn <= 1,
    `max-spread cascade: invariant holds after convergence (nw=${c.nw} ne=${c.ne} se=${c.se} sw=${c.sw}, diff=${mx - mn})`);
  assert(c.nw === HEIGHT_MAX,
    `max-spread cascade: NW retains anchor value HEIGHT_MAX (got ${c.nw})`);
}

// --- all-zeros setTileCorners removes map entry (sparsity) ---
{
  const s = makeState();
  setCornerHeight(s, 4, 4, NW, 1); // create an entry
  assert(s.cornerHeights.has('4,4'), 'map entry created');
  setTileCorners(s, 4, 4, { nw: 0, ne: 0, se: 0, sw: 0 });
  assert(!s.cornerHeights.has('4,4'), 'all-zeros setTileCorners removes entry (sparsity)');
  assert(isTileFlat(s, 4, 4) === true, 'isTileFlat after removal');
}

// --- setCornerHeight that produces all-zeros removes entry ---
{
  const s = makeState();
  setTileCorners(s, 1, 1, { nw: 1, ne: 1, se: 1, sw: 1 });
  assert(s.cornerHeights.has('1,1'), 'entry exists after uniform non-zero set');
  // Bring NW back to 0 — invariant cascade should clamp others down to 0 too, then entry removed.
  setCornerHeight(s, 1, 1, NW, 0);
  // After cascade: other corners clamped toward 0 until diff ≤ 1; since NW=0 and others=1, diff=1 OK.
  // So the entry stays. Now lower all corners:
  setCornerHeight(s, 1, 1, NE, 0);
  setCornerHeight(s, 1, 1, SE, 0);
  setCornerHeight(s, 1, 1, SW, 0);
  assert(!s.cornerHeights.has('1,1'), 'entry removed once all 4 corners are zero');
}

// --- isTileFlat ---
{
  const s = makeState();
  setTileCorners(s, 10, 10, { nw: 2, ne: 2, se: 2, sw: 2 });
  assert(isTileFlat(s, 10, 10) === true, 'isTileFlat true for uniform non-zero tile');
  setCornerHeight(s, 10, 10, NW, 3);
  assert(isTileFlat(s, 10, 10) === false, 'isTileFlat false after introducing variation');
}

// --- getTileCornersY multiplies by HEIGHT_STEP_METERS (=0.5) ---
{
  const s = makeState();
  setTileCorners(s, 0, 0, { nw: 2, ne: 2, se: 1, sw: 1 });
  const y = getTileCornersY(s, 0, 0);
  assert(y.nw === 1.0, `getTileCornersY nw = 2 * 0.5 = 1.0 (got ${y.nw})`);
  assert(y.ne === 1.0, `getTileCornersY ne = 1.0 (got ${y.ne})`);
  assert(y.se === 0.5, `getTileCornersY se = 1 * 0.5 = 0.5 (got ${y.se})`);
  assert(y.sw === 0.5, `getTileCornersY sw = 0.5 (got ${y.sw})`);
  // Absent tile
  const yAbsent = getTileCornersY(s, 99, 99);
  assert(yAbsent.nw === 0 && yAbsent.ne === 0 && yAbsent.se === 0 && yAbsent.sw === 0,
    'getTileCornersY on absent tile returns all zeros');
}

// --- Serialize + deserialize round-trip on 3 non-trivial tiles ---
{
  const s = makeState();
  setTileCorners(s, 1, 2, { nw: 2, ne: 2, se: 1, sw: 1 });
  setTileCorners(s, 5, 7, { nw: 0, ne: 1, se: 1, sw: 0 });
  setTileCorners(s, -3, 4, { nw: -1, ne: 0, se: 0, sw: -1 });

  const arr = serializeCornerHeights(s.cornerHeights);
  assert(Array.isArray(arr), 'serializeCornerHeights returns an Array');
  assert(arr.length === 3, `serialize has 3 entries (got ${arr.length})`);
  // Each entry is [col, row, nw, ne, se, sw].
  for (const entry of arr) {
    assert(Array.isArray(entry) && entry.length === 6,
      `serialized entry is length-6 array (got ${JSON.stringify(entry)})`);
  }

  const map2 = deserializeCornerHeights(arr);
  const s2 = { cornerHeights: map2, cornerHeightsRevision: 0 };
  const c1 = getTileCorners(s2, 1, 2);
  assert(c1.nw === 2 && c1.ne === 2 && c1.se === 1 && c1.sw === 1,
    'round-trip: tile (1,2) preserved');
  const c2 = getTileCorners(s2, 5, 7);
  assert(c2.nw === 0 && c2.ne === 1 && c2.se === 1 && c2.sw === 0,
    'round-trip: tile (5,7) preserved');
  const c3 = getTileCorners(s2, -3, 4);
  assert(c3.nw === -1 && c3.ne === 0 && c3.se === 0 && c3.sw === -1,
    'round-trip: tile (-3,4) preserved (negative coord)');
  // Absent tiles still return zeros.
  const cAbs = getTileCorners(s2, 42, 42);
  assert(cAbs.nw === 0 && cAbs.ne === 0 && cAbs.se === 0 && cAbs.sw === 0,
    'round-trip: absent tile still all zeros');
}

// --- deserialize of empty array yields empty map ---
{
  const m = deserializeCornerHeights([]);
  assert(m instanceof Map, 'deserializeCornerHeights([]) returns a Map');
  assert(m.size === 0, 'deserializeCornerHeights([]) is empty');
}

// --- JSON.stringify round-trip (matches save/load path) ---
{
  const s = makeState();
  setTileCorners(s, 2, 3, { nw: 1, ne: 0, se: 0, sw: 1 });
  const json = JSON.stringify(serializeCornerHeights(s.cornerHeights));
  const map2 = deserializeCornerHeights(JSON.parse(json));
  const s2 = { cornerHeights: map2, cornerHeightsRevision: 0 };
  const c = getTileCorners(s2, 2, 3);
  assert(c.nw === 1 && c.ne === 0 && c.se === 0 && c.sw === 1,
    'JSON round-trip preserves tile corners');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
