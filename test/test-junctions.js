// test/test-junctions.js — tests for src/beamline/junctions.js
//
// Pure helpers for reasoning about junction ports:
//   - availablePorts(placeable, beamPipes): ports not yet connected
//   - portWorldPosition(placeable, portName): world-space {x, z} at port center
//   - portSide(placeable, portName): rotated compass side 'N'|'E'|'S'|'W'
//   - isJunctionType(type): true iff COMPONENTS[type]?.role === 'junction'

import {
  availablePorts,
  portWorldPosition,
  portSide,
  isJunctionType,
} from '../src/beamline/junctions.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

// ==========================================================================
// Test 1: availablePorts — returns ports not already connected.
// ==========================================================================
console.log('\n--- Test 1: availablePorts ---');
{
  // injectionSeptum has ports linacEntry, ringEntry, ringExit.
  const septum = {
    id: 'sep_1', type: 'injectionSeptum',
    col: 2, row: 2, subCol: 0, subRow: 0, dir: 0,
    category: 'beamline',
  };

  // No pipes: all ports free.
  {
    const free = availablePorts(septum, []);
    assert(Array.isArray(free), 'returns an array');
    assert(free.length === 3, `all 3 ports free (got ${free.length})`);
    assert(free.includes('linacEntry') && free.includes('ringEntry') && free.includes('ringExit'),
      'all port names present');
  }

  // One pipe connected to linacEntry via start.
  {
    const pipes = [
      { id: 'bp_1',
        start: { junctionId: 'sep_1', portName: 'linacEntry' },
        end:   { junctionId: 'other', portName: 'exit' },
        path: [], subL: 4, placements: [] },
    ];
    const free = availablePorts(septum, pipes);
    assert(free.length === 2, `2 ports free (got ${free.length})`);
    assert(!free.includes('linacEntry'), 'linacEntry connected, excluded');
    assert(free.includes('ringEntry') && free.includes('ringExit'), 'ringEntry/ringExit free');
  }

  // A pipe connected to ringExit via end.
  {
    const pipes = [
      { id: 'bp_2',
        start: { junctionId: 'other', portName: 'exit' },
        end:   { junctionId: 'sep_1', portName: 'ringExit' },
        path: [], subL: 4, placements: [] },
    ];
    const free = availablePorts(septum, pipes);
    assert(free.length === 2, `2 ports free (got ${free.length})`);
    assert(!free.includes('ringExit'), 'ringExit connected via end, excluded');
  }

  // Two pipes covering linacEntry and ringExit.
  {
    const pipes = [
      { id: 'bp_1',
        start: { junctionId: 'sep_1', portName: 'linacEntry' },
        end:   null,
        path: [], subL: 4, placements: [] },
      { id: 'bp_2',
        start: null,
        end:   { junctionId: 'sep_1', portName: 'ringExit' },
        path: [], subL: 4, placements: [] },
    ];
    const free = availablePorts(septum, pipes);
    assert(free.length === 1, `1 port free (got ${free.length})`);
    assert(free[0] === 'ringEntry', `only ringEntry free (got ${free[0]})`);
  }

  // Pipe connected to a DIFFERENT junction does not affect this one.
  {
    const pipes = [
      { id: 'bp_3',
        start: { junctionId: 'other', portName: 'linacEntry' },
        end:   null,
        path: [], subL: 4, placements: [] },
    ];
    const free = availablePorts(septum, pipes);
    assert(free.length === 3, 'other junction pipe ignored');
  }

  // Unknown/no-port-def placeable returns [].
  {
    const mystery = { id: 'm1', type: '__nonexistent__', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 };
    const free = availablePorts(mystery, []);
    assert(Array.isArray(free) && free.length === 0, 'unknown type → []');
  }
}

// ==========================================================================
// Test 2: portSide — compass side rotated by dir.
// ==========================================================================
console.log('\n--- Test 2: portSide ---');
{
  // Source has ports.exit.side === 'front'
  const src = { id: 's1', type: 'source', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 };

  assert(portSide({ ...src, dir: 0 }, 'exit') === 'S', 'source.exit dir=0 → S');
  assert(portSide({ ...src, dir: 1 }, 'exit') === 'W', 'source.exit dir=1 → W');
  assert(portSide({ ...src, dir: 2 }, 'exit') === 'N', 'source.exit dir=2 → N');
  assert(portSide({ ...src, dir: 3 }, 'exit') === 'E', 'source.exit dir=3 → E');

  // Dipole: entry=back, exit=left
  const dip = { id: 'd1', type: 'dipole', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 };

  assert(portSide({ ...dip, dir: 0 }, 'entry') === 'N', 'dipole.entry dir=0 → N');
  assert(portSide({ ...dip, dir: 0 }, 'exit')  === 'W', 'dipole.exit  dir=0 → W');
  assert(portSide({ ...dip, dir: 1 }, 'entry') === 'E', 'dipole.entry dir=1 → E (N rotated CW)');
  assert(portSide({ ...dip, dir: 1 }, 'exit')  === 'N', 'dipole.exit  dir=1 → N (W rotated CW)');
  assert(portSide({ ...dip, dir: 2 }, 'entry') === 'S', 'dipole.entry dir=2 → S');
  assert(portSide({ ...dip, dir: 2 }, 'exit')  === 'E', 'dipole.exit  dir=2 → E');
  assert(portSide({ ...dip, dir: 3 }, 'entry') === 'W', 'dipole.entry dir=3 → W');
  assert(portSide({ ...dip, dir: 3 }, 'exit')  === 'S', 'dipole.exit  dir=3 → S');

  // injectionSeptum: linacEntry=back, ringEntry=left, ringExit=right
  const sep = { id: 'sp', type: 'injectionSeptum', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 };
  assert(portSide(sep, 'ringEntry') === 'W', 'septum.ringEntry dir=0 → W');
  assert(portSide(sep, 'ringExit')  === 'E', 'septum.ringExit  dir=0 → E');
  assert(portSide({ ...sep, dir: 1 }, 'ringEntry') === 'N', 'septum.ringEntry dir=1 → N');
  assert(portSide({ ...sep, dir: 1 }, 'ringExit')  === 'S', 'septum.ringExit  dir=1 → S');

  // Unknown port returns null.
  assert(portSide(src, 'doesNotExist') === null, 'unknown port → null');
}

// ==========================================================================
// Test 3: portWorldPosition — world {x,z} on edge along port's side.
// ==========================================================================
console.log('\n--- Test 3: portWorldPosition ---');
{
  // Source: subL=4, subW=4. Full footprint = 2×2 world units.
  // At col=2,row=2,subCol=0,subRow=0,dir=0:
  //   center = (col*2 + subW/2*0.5, row*2 + subL/2*0.5) = (4+1, 4+1) = (5, 5)
  //   exit (front=+z): edge at z = 5 + subL/2 * 0.5 = 5 + 1 = 6
  //   → (5, 6)
  {
    const src = { id: 's1', type: 'source', col: 2, row: 2, subCol: 0, subRow: 0, dir: 0 };
    const p = portWorldPosition(src, 'exit');
    assert(p != null, 'source exit position returned');
    assert(approx(p.x, 5), `source dir=0 exit.x = 5 (got ${p.x})`);
    assert(approx(p.z, 6), `source dir=0 exit.z = 6 (got ${p.z})`);
  }

  // Same source rotated dir=1 (front → W / -x):
  //   subL/subW both 4; center stays at (5, 5) because footprint is square.
  //   exit edge at x = 5 - 1 = 4 (along -x)
  //   → (4, 5)
  {
    const src = { id: 's1', type: 'source', col: 2, row: 2, subCol: 0, subRow: 0, dir: 1 };
    const p = portWorldPosition(src, 'exit');
    assert(approx(p.x, 4), `source dir=1 exit.x = 4 (got ${p.x})`);
    assert(approx(p.z, 5), `source dir=1 exit.z = 5 (got ${p.z})`);
  }

  // Dipole: subL=2, subW=2 (square → same center after rotation)
  // At col=3, row=5, subCol=0, subRow=0, dir=0:
  //   center = (6 + (0 + 1)*0.5, 10 + (0 + 1)*0.5) = (6.5, 10.5)
  //   entry (back=-z): z = 10.5 - subL/2 * 0.5 = 10.5 - 0.5 = 10 → (6.5, 10)
  //   exit  (left=-x): x = 6.5 - subW/2 * 0.5 = 6.5 - 0.5 = 6   → (6, 10.5)
  {
    const dip = { id: 'd1', type: 'dipole', col: 3, row: 5, subCol: 0, subRow: 0, dir: 0 };
    const e = portWorldPosition(dip, 'entry');
    assert(approx(e.x, 6.5), `dipole dir=0 entry.x = 6.5 (got ${e.x})`);
    assert(approx(e.z, 10),  `dipole dir=0 entry.z = 10 (got ${e.z})`);

    const x = portWorldPosition(dip, 'exit');
    assert(approx(x.x, 6),    `dipole dir=0 exit.x = 6 (got ${x.x})`);
    assert(approx(x.z, 10.5), `dipole dir=0 exit.z = 10.5 (got ${x.z})`);
  }

  // Dipole rotated dir=1: back → E (+x), left → N (-z).
  // subL=subW=2 so center same.
  {
    const dip = { id: 'd1', type: 'dipole', col: 3, row: 5, subCol: 0, subRow: 0, dir: 1 };
    // center (6.5, 10.5)
    const e = portWorldPosition(dip, 'entry');  // now east = +x
    assert(approx(e.x, 7),    `dipole dir=1 entry.x = 7 (got ${e.x})`);
    assert(approx(e.z, 10.5), `dipole dir=1 entry.z = 10.5 (got ${e.z})`);
    const x = portWorldPosition(dip, 'exit');   // now north = -z
    assert(approx(x.x, 6.5), `dipole dir=1 exit.x = 6.5 (got ${x.x})`);
    assert(approx(x.z, 10),  `dipole dir=1 exit.z = 10 (got ${x.z})`);
  }

  // Non-square subtile offset: cryomodule subL=16, subW=4. Test with dir=0.
  // col=0, row=0, subCol=0, subRow=0:
  //   center = (0 + (0 + 4/2)*0.5, 0 + (0 + 16/2)*0.5) = (1, 4)
  //   entry (back=-z): z = 4 - 16/2 * 0.5 = 4 - 4 = 0 → (1, 0)
  //   exit  (front=+z): z = 4 + 4 = 8 → (1, 8)
  {
    const cm = { id: 'cm', type: 'cryomodule', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 };
    const e = portWorldPosition(cm, 'entry');
    assert(approx(e.x, 1), `cryomodule entry.x = 1 (got ${e.x})`);
    assert(approx(e.z, 0), `cryomodule entry.z = 0 (got ${e.z})`);
    const x = portWorldPosition(cm, 'exit');
    assert(approx(x.x, 1), `cryomodule exit.x = 1 (got ${x.x})`);
    assert(approx(x.z, 8), `cryomodule exit.z = 8 (got ${x.z})`);
  }

  // Subtile offset: source at col=1, row=1, subCol=1, subRow=2, dir=0.
  //   subW=subL=4
  //   wx = 2 + (1 + 2)*0.5 = 3.5
  //   wz = 2 + (2 + 2)*0.5 = 4
  //   exit (front=+z): z = 4 + 4/2 * 0.5 = 5 → (3.5, 5)
  {
    const s = { id: 's2', type: 'source', col: 1, row: 1, subCol: 1, subRow: 2, dir: 0 };
    const p = portWorldPosition(s, 'exit');
    assert(approx(p.x, 3.5), `source(subOffset) exit.x = 3.5 (got ${p.x})`);
    assert(approx(p.z, 5),   `source(subOffset) exit.z = 5 (got ${p.z})`);
  }

  // Unknown port → null.
  {
    const s = { id: 's3', type: 'source', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 };
    assert(portWorldPosition(s, 'nope') === null, 'unknown port → null');
  }
}

// ==========================================================================
// Test 4: isJunctionType.
// ==========================================================================
console.log('\n--- Test 4: isJunctionType ---');
{
  assert(isJunctionType('source')          === true,  'source is junction');
  assert(isJunctionType('faradayCup')      === true,  'faradayCup is junction');
  assert(isJunctionType('dipole')          === true,  'dipole is junction');
  assert(isJunctionType('injectionSeptum') === true,  'injectionSeptum is junction');
  assert(isJunctionType('collisionPoint')  === true,  'collisionPoint is junction');
  assert(isJunctionType('beamStop')        === true,  'beamStop is junction');
  assert(isJunctionType('detector')        === true,  'detector is junction');
  assert(isJunctionType('target')          === true,  'target is junction');

  assert(isJunctionType('drift')         === false, 'drift is NOT junction');
  assert(isJunctionType('buncher')       === false, 'buncher is NOT junction (role=placement)');
  assert(isJunctionType('rfCavity')      === false, 'rfCavity is NOT junction');
  assert(isJunctionType('quadrupole')    === false, 'quadrupole is NOT junction');
  assert(isJunctionType('bpm')           === false, 'bpm is NOT junction');

  assert(isJunctionType('__nonexistent__') === false, 'unknown type is NOT junction');
  assert(isJunctionType(null)     === false, 'null → false');
  assert(isJunctionType(undefined) === false, 'undefined → false');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
