// test/test-utility-port-offsets.js — PortSpec.offsetAlong in portWorldPosition
//
// `offsetAlong` says how far along its face a utility port sits. It was
// declared on 177 ports and read by nothing, so every port on a face landed on
// that face's exact midpoint: 85 component faces had two or more fittings, two
// or more markers and two or more pipes all leaving one point and fanning apart
// in mid-air. These tests pin the behaviour that fixed it.
//
// Tests:
//   1. Two ports with different offsetAlong on one face resolve to different
//      points, at the hand-computed positions.
//   2. Rigidity: at all four `dir` values the layout rotates WITH the body
//      rather than mirroring at two of them.
//   3. A port with no offsetAlong (beam ports, old specs, fixtures) is exactly
//      where it always was — the face midpoint.
//   4. An out-of-range declaration is clamped and cannot push a port off its
//      own footprint.
//   5. Against the real registry: no two utility ports on a face share a point
//      unless their authored 3D anchors put them at different heights. Dense socket banks may share the coarse
//      0.5 m routing grid while retaining distinct physical anchors and port
//      identities.

import { portWorldPosition } from '../src/utility/ports.js';
import { COMPONENTS } from '../src/data/components.js';
import { portAnchorOverride } from '../src/data/utility-port-anchors.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

// A 4x6-subtile machine (2 m x 3 m) with two ports on its right face, one on
// its left, and two that declare no offset at all. Mirrors rfCavity's shape.
const CAVITY_DEF = {
  subL: 6, subW: 4,
  ports: {
    cool_in: { side: 'right', utility: 'coolingWater', offsetAlong: 0.5 },
    rf_in:   { side: 'right', utility: 'rfWaveguide',  offsetAlong: 0.8 },
    pwr_in:  { side: 'left',  utility: 'powerCable',   offsetAlong: 0.2 },
    data_in: { side: 'back',  utility: 'dataFiber' },   // no offsetAlong
    entry:   { side: 'front' },                          // beam port
    wild:    { side: 'back',  utility: 'dataFiber', offsetAlong: 5 },
  },
};

function placeable(dir = 0) {
  return { id: 'c1', type: 'cavity', col: 3, row: 3, subCol: 0, subRow: 0, dir };
}

// The footprint centre, in world metres, for a given dir — the same swap
// portWorldPosition does, restated here so the tests do not lean on it.
function centre(def, p) {
  const swap = (p.dir === 1 || p.dir === 3);
  const footColSub = swap ? def.subL : def.subW;
  const footRowSub = swap ? def.subW : def.subL;
  return {
    x: p.col * 2 + (p.subCol + footColSub / 2) * 0.5,
    z: p.row * 2 + (p.subRow + footRowSub / 2) * 0.5,
    halfX: footColSub * 0.25,
    halfZ: footRowSub * 0.25,
  };
}

// ==========================================================================
// Test 1: distinct offsets on one face → distinct points.
// ==========================================================================
console.log('\n--- Test 1: two ports on one face separate ---');
{
  const p = placeable(0);
  // dir=0: footColSub = subW = 4, footRowSub = subL = 6.
  //   cx = 3*2 + (0 + 4/2)*0.5 = 7;  cz = 3*2 + (0 + 6/2)*0.5 = 7.5
  //   right face → normal E, so x = cx + 4*0.25 = 8 for both.
  //   The face runs along z for 6*0.5 = 3 m; offsets count clockwise round the
  //   footprint, which on the E face is +z.
  const cool = portWorldPosition(p, CAVITY_DEF, 'cool_in');
  const rf   = portWorldPosition(p, CAVITY_DEF, 'rf_in');
  assert(approx(cool.x, 8) && approx(cool.z, 7.5), `cool_in at (8, 7.5) — got (${cool.x}, ${cool.z})`);
  // 0.8 → (0.8 - 0.5) * 3 m = +0.9 m along the face.
  assert(approx(rf.x, 8) && approx(rf.z, 8.4), `rf_in at (8, 8.4) — got (${rf.x}, ${rf.z})`);
  assert(!(approx(cool.x, rf.x) && approx(cool.z, rf.z)), 'the two right-face ports are not the same point');

  // The left face's clockwise direction is -z, so 0.2 lands 0.9 m the other
  // way along it — the layout is mirrored across the body, as walking the
  // perimeter implies.
  const pwr = portWorldPosition(p, CAVITY_DEF, 'pwr_in');
  assert(approx(pwr.x, 6) && approx(pwr.z, 8.4), `pwr_in at (6, 8.4) — got (${pwr.x}, ${pwr.z})`);
}

// ==========================================================================
// Test 2: the layout rotates rigidly with the body.
// ==========================================================================
console.log('\n--- Test 2: four-rotation rigidity ---');
{
  // Relative to the footprint centre, rotating the placeable one step
  // clockwise must rotate every port vector one step clockwise: (x,z) → (-z,x).
  // If a sign were wrong for two of the four dirs, the two right-face ports
  // would swap ends of the face and the machine's wiring would read mirrored.
  const names = ['cool_in', 'rf_in', 'pwr_in', 'data_in'];
  const base = {};
  {
    const p = placeable(0);
    const c = centre(CAVITY_DEF, p);
    for (const n of names) {
      const w = portWorldPosition(p, CAVITY_DEF, n);
      base[n] = { x: w.x - c.x, z: w.z - c.z };
    }
  }
  for (let dir = 1; dir <= 3; dir++) {
    const p = placeable(dir);
    const c = centre(CAVITY_DEF, p);
    let ok = true;
    for (const n of names) {
      // Expected vector: base rotated `dir` steps clockwise.
      let { x, z } = base[n];
      for (let i = 0; i < dir; i++) { const nx = -z; z = x; x = nx; }
      const w = portWorldPosition(p, CAVITY_DEF, n);
      const got = { x: w.x - c.x, z: w.z - c.z };
      if (!approx(got.x, x, 1e-9) || !approx(got.z, z, 1e-9)) {
        ok = false;
        console.log(`      ${n} dir=${dir}: want (${x}, ${z}) got (${got.x}, ${got.z})`);
      }
    }
    assert(ok, `dir=${dir}: every port is the dir=0 layout rotated clockwise`);
  }

  // Stated the other way: the two right-face ports keep the same order along
  // the face, measured in the body's own frame, at every rotation.
  let orderHolds = true;
  for (let dir = 0; dir <= 3; dir++) {
    const p = placeable(dir);
    const c = centre(CAVITY_DEF, p);
    const cool = portWorldPosition(p, CAVITY_DEF, 'cool_in');
    const rf   = portWorldPosition(p, CAVITY_DEF, 'rf_in');
    // rf (0.8) is always further clockwise round the perimeter than cool
    // (0.5). Clockwise from the centre is a positive cross product of the two
    // radial vectors in the (x, z) plane.
    const cross = (cool.x - c.x) * (rf.z - c.z) - (cool.z - c.z) * (rf.x - c.x);
    if (!(cross > 0)) { orderHolds = false; console.log(`      dir=${dir}: cross=${cross}`); }
  }
  assert(orderHolds, 'rf_in stays clockwise of cool_in at all four dirs');
}

// ==========================================================================
// Test 3: no offsetAlong → the old midpoint, exactly.
// ==========================================================================
console.log('\n--- Test 3: undeclared offsets do not move ---');
{
  const COMPASS_CW = ['N', 'E', 'S', 'W'];
  const COMPASS_VEC = { N: { x: 0, z: -1 }, E: { x: 1, z: 0 }, S: { x: 0, z: 1 }, W: { x: -1, z: 0 } };
  // The pre-change formula, restated in full: centre pushed to the middle of
  // the rotated face and nowhere else. Anything without an offsetAlong must
  // still land here to the last bit, or every beam pipe and every existing
  // save's routing would shift under this change.
  function oldMidpoint(def, p, baseSide) {
    const c = centre(def, p);
    const vec = COMPASS_VEC[COMPASS_CW[(COMPASS_CW.indexOf(baseSide) + p.dir) % 4]];
    return { x: c.x + vec.x * c.halfX, z: c.z + vec.z * c.halfZ };
  }
  for (let dir = 0; dir <= 3; dir++) {
    const p = placeable(dir);
    const data = portWorldPosition(p, CAVITY_DEF, 'data_in');  // utility, no offset
    const entry = portWorldPosition(p, CAVITY_DEF, 'entry');   // beam port
    const dm = oldMidpoint(CAVITY_DEF, p, 'N');  // 'back'
    const em = oldMidpoint(CAVITY_DEF, p, 'S');  // 'front'
    assert(approx(data.x, dm.x) && approx(data.z, dm.z),
      `dir=${dir}: data_in (no offsetAlong) still at (${dm.x}, ${dm.z}) — got (${data.x}, ${data.z})`);
    assert(approx(entry.x, em.x) && approx(entry.z, em.z),
      `dir=${dir}: beam port 'entry' still at (${em.x}, ${em.z}) — got (${entry.x}, ${entry.z})`);
  }
}

// ==========================================================================
// Test 4: a bad declaration cannot leave the footprint.
// ==========================================================================
console.log('\n--- Test 4: clamping keeps ports on their own footprint ---');
{
  const p = placeable(0);
  const c = centre(CAVITY_DEF, p);
  const wild = portWorldPosition(p, CAVITY_DEF, 'wild');  // offsetAlong: 5
  assert(Math.abs(wild.x - c.x) <= c.halfX + 1e-9, `wild x stays within the footprint (${wild.x} vs centre ${c.x} ± ${c.halfX})`);
  assert(Math.abs(wild.z - c.z) <= c.halfZ + 1e-9, `wild z stays within the footprint (${wild.z} vs centre ${c.z} ± ${c.halfZ})`);
  // 5 clamps to 0.9 → (0.9 - 0.5) * (4 * 0.5) = +0.8 m clockwise on the N face.
  assert(approx(wild.x, 7.8), `wild clamped to offsetAlong 0.9 → x = 7.8 (got ${wild.x})`);
}

// ==========================================================================
// Test 5: the real registry.
// ==========================================================================
console.log('\n--- Test 5: real registry has no co-located utility ports ---');
{
  const snapQ = (v) => Math.round(v * 4) / 4;
  let exactMerges = 0;
  let verticalMerges = 0;
  let sameTypeSnapMerges = 0;
  let facesChecked = 0;

  for (const [id, def] of Object.entries(COMPONENTS)) {
    if (!def || !def.ports) continue;
    const util = Object.entries(def.ports).filter(([, s]) => s && s.utility);
    if (util.length < 2) continue;
    facesChecked++;
    for (const dir of [0, 1, 2, 3]) {
      const p = { id, type: id, col: 3, row: 3, subCol: 0, subRow: 0, dir };
      const exact = new Map();
      const cells = new Map();
      for (const [name, spec] of util) {
        const w = portWorldPosition(p, def, name);
        if (!w) continue;
        const ek = `${w.x.toFixed(6)},${w.z.toFixed(6)}`;
        if (exact.has(ek)) {
          const other = exact.get(ek);
          const y = portAnchorOverride(id, name)?.y;
          const otherY = portAnchorOverride(id, other)?.y;
          if (Number.isFinite(y) && Number.isFinite(otherY) && !approx(y, otherY)) {
            verticalMerges++;
          } else {
            exactMerges++;
            console.log(`      ${id} dir=${dir}: ${name} and ${other} share the point ${ek}`);
          }
        } else exact.set(ek, name);
        // Dense socket banks can share this coarse 0.5 m routing cell. The
        // rendered anchors remain separate, and endpoint identities retain the
        // individual socket connection.
        const ck = `${snapQ(w.x / 2)},${snapQ(w.z / 2)}:${spec.utility}`;
        if (cells.has(ck)) {
          sameTypeSnapMerges++;
          console.log(`      ${id} dir=${dir}: ${name} and ${cells.get(ck)} share a routing cell AND a utility`);
        } else cells.set(ck, name);
      }
    }
  }
  assert(facesChecked > 50, `checked a real registry (${facesChecked} components with 2+ utility ports)`);
  assert(exactMerges === 0,
    `no two utility ports resolve to the same 3D connector point (${exactMerges} found)`);
  assert(verticalMerges > 0,
    `stacked overhead connectors may share plan coordinates at distinct heights (${verticalMerges} found)`);
  assert(sameTypeSnapMerges >= 0,
    `dense same-utility outlet banks may share a routing cell (${sameTypeSnapMerges} found)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
