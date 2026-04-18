// test/test-utility-ports.js — tests for src/utility/ports.js
//
// Port helpers for utility lines: parallel to junctions.js but parameterized
// on (placeable, def, ...) so tests can inject fake component defs without
// touching src/data/components.js.
//
// Tests:
//   1. availablePorts returns names of ports whose utility === type (no claims).
//   2. availablePorts excludes ports claimed by existing lines.
//   3. portMatchesApproach: start port's rotated compass side vs approach dir.
//   4. portMatchesApproach: end port's rotated compass side vs NEGATIVE approach.
//   5. getPortSpec returns the spec object or null.
//   6. isUtilityPort true iff the spec has `utility`.
//   7. portWorldPosition matches the junctions.js formula.

import {
  availablePorts,
  portMatchesApproach,
  getPortSpec,
  isUtilityPort,
  portWorldPosition,
} from '../src/utility/ports.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

// ---------------------------------------------------------------------------
// Fixtures: fake component defs for tests (mirror structure of real defs).
// ---------------------------------------------------------------------------

const RACK_DEF = {
  subL: 2, subW: 2,
  ports: {
    // Two power-cable ports on opposite sides, one data-port, one no-utility port.
    powerIn:   { side: 'left',  utility: 'powerCable' },
    powerOut:  { side: 'right', utility: 'powerCable' },
    dataLink:  { side: 'back',  utility: 'dataCable'  },
    structural:{ side: 'front' }, // no utility — should never appear in power lists
  },
};

function placeable(id, col, row, dir = 0, opts = {}) {
  return {
    id,
    type: 'rack',
    category: 'beamline',
    col, row, subCol: 0, subRow: 0, dir,
    ...opts,
  };
}

// ==========================================================================
// Test 1: availablePorts by utility type, no existing lines.
// ==========================================================================
console.log('\n--- Test 1: availablePorts no claims ---');
{
  const p = placeable('r1', 0, 0);
  const free = availablePorts(p, RACK_DEF, 'powerCable', []);
  assert(Array.isArray(free), 'returns array');
  assert(free.length === 2, `2 power ports free (got ${free.length})`);
  assert(free.includes('powerIn') && free.includes('powerOut'), 'both power port names present');
  // Data and structural ports must not be returned.
  assert(!free.includes('dataLink'), 'data port excluded');
  assert(!free.includes('structural'), 'no-utility port excluded');
}

// ==========================================================================
// Test 2: availablePorts excludes ports claimed by existing lines.
// ==========================================================================
console.log('\n--- Test 2: availablePorts with claims ---');
{
  const p = placeable('r1', 0, 0);
  const lines = [
    { id: 'ul_1',
      utilityType: 'powerCable',
      start: { placeableId: 'r1', portName: 'powerIn' },
      end: null,
      path: [] },
  ];
  const free = availablePorts(p, RACK_DEF, 'powerCable', lines);
  assert(free.length === 1, `1 power port free (got ${free.length})`);
  assert(free[0] === 'powerOut', `only powerOut free (got ${free[0]})`);
}

// ==========================================================================
// Test 3: portMatchesApproach — start port.
// ==========================================================================
console.log('\n--- Test 3: portMatchesApproach start ---');
{
  // powerOut is on 'right' (E). dir=0: port faces E.
  // For a start port, first-segment approach dir should equal port vec: {dCol:1,dRow:0}.
  const p = placeable('r1', 0, 0, 0);
  assert(
    portMatchesApproach(p, RACK_DEF, 'powerOut', { dCol: 1, dRow: 0 }, false) === true,
    'start port E aligns with +col approach',
  );
  assert(
    portMatchesApproach(p, RACK_DEF, 'powerOut', { dCol: -1, dRow: 0 }, false) === false,
    'start port E does NOT align with -col approach',
  );
  assert(
    portMatchesApproach(p, RACK_DEF, 'powerOut', { dCol: 0, dRow: 1 }, false) === false,
    'start port E does NOT align with +row approach',
  );
  // powerIn on 'left' (W). dir=0: port faces W.
  assert(
    portMatchesApproach(p, RACK_DEF, 'powerIn', { dCol: -1, dRow: 0 }, false) === true,
    'start port W aligns with -col approach',
  );
}

// ==========================================================================
// Test 4: portMatchesApproach — end port (inverse of last-segment dir).
// ==========================================================================
console.log('\n--- Test 4: portMatchesApproach end ---');
{
  // powerOut on E. At end port, last-segment dir's NEGATIVE must equal port vec.
  // Port vec = {dCol:1,dRow:0}. -approachDir must equal {1,0} → approachDir = {-1,0}.
  const p = placeable('r1', 0, 0, 0);
  assert(
    portMatchesApproach(p, RACK_DEF, 'powerOut', { dCol: -1, dRow: 0 }, true) === true,
    'end port E aligns with -col last-segment dir (i.e. approaching from east)',
  );
  assert(
    portMatchesApproach(p, RACK_DEF, 'powerOut', { dCol: 1, dRow: 0 }, true) === false,
    'end port E does NOT align with +col last-segment dir',
  );
}

// ==========================================================================
// Test 5: getPortSpec.
// ==========================================================================
console.log('\n--- Test 5: getPortSpec ---');
{
  assert(getPortSpec(RACK_DEF, 'powerIn') === RACK_DEF.ports.powerIn, 'returns spec');
  assert(getPortSpec(RACK_DEF, 'doesNotExist') === null, 'unknown → null');
  assert(getPortSpec(null, 'powerIn') === null, 'null def → null');
}

// ==========================================================================
// Test 6: isUtilityPort.
// ==========================================================================
console.log('\n--- Test 6: isUtilityPort ---');
{
  assert(isUtilityPort(RACK_DEF, 'powerIn') === true, 'powerIn has utility');
  assert(isUtilityPort(RACK_DEF, 'dataLink') === true, 'dataLink has utility');
  assert(isUtilityPort(RACK_DEF, 'structural') === false, 'structural has no utility');
  assert(isUtilityPort(RACK_DEF, 'nope') === false, 'unknown port → false');
}

// ==========================================================================
// Test 7: portWorldPosition matches formula from src/beamline/junctions.js.
// ==========================================================================
console.log('\n--- Test 7: portWorldPosition ---');
{
  // Placeable at col=3, row=4, subCol=0, subRow=0, dir=0, with a port on 'right' (E).
  // def.subL=2, subW=2 → footprint 1x1 world units.
  //   cx = 3*2 + (0 + 2/2)*0.5 = 6 + 0.5 = 6.5
  //   cz = 4*2 + (0 + 2/2)*0.5 = 8 + 0.5 = 8.5
  //   halfAlongX = 2 * 0.25 = 0.5; worldSide=E → vec=(1,0)
  //   x = 6.5 + 1*0.5 = 7, z = 8.5 + 0 = 8.5
  const p = placeable('r1', 3, 4, 0);
  const pos = portWorldPosition(p, RACK_DEF, 'powerOut'); // 'right' side
  assert(pos !== null, 'position returned');
  assert(approx(pos.x, 7),   `x = 7 (got ${pos.x})`);
  assert(approx(pos.z, 8.5), `z = 8.5 (got ${pos.z})`);

  // Same placeable, powerIn is 'left' (W) → x = 6.5 - 0.5 = 6, z = 8.5.
  const pos2 = portWorldPosition(p, RACK_DEF, 'powerIn');
  assert(approx(pos2.x, 6),   `powerIn x = 6 (got ${pos2.x})`);
  assert(approx(pos2.z, 8.5), `powerIn z = 8.5 (got ${pos2.z})`);

  // Unknown port → null.
  assert(portWorldPosition(p, RACK_DEF, 'nope') === null, 'unknown port → null');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
