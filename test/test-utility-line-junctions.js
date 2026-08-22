// Pure utility-boundary coverage for tee/cross fabrication topology.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utilityLineJunctions } from '../src/utility/line-junctions.js';

function vacuum(id, path, tapLineIds = null) {
  return {
    id, utilityType: 'vacuumPipe', path,
    ...(tapLineIds ? { tapLineIds } : {}),
  };
}

test('one perpendicular branch classifies as a three-port tee', () => {
  const lines = new Map([
    ['trunk', vacuum('trunk', [{ col: 0, row: 0 }, { col: 6, row: 0 }])],
    ['branch', vacuum('branch', [{ col: 3, row: 0 }, { col: 3, row: 3 }],
      { start: 'trunk', end: null })],
  ]);
  const junction = utilityLineJunctions(lines).get('branch').start;
  assert.equal(junction.kind, 'tee');
  assert.equal(junction.degree, 3);
  assert.equal(junction.renderHardware, true);
  assert.deepEqual(junction.directions, ['-1,0', '0,1', '1,0']);
});

test('opposed branches at one station classify as one owned four-way cross', () => {
  const lines = new Map([
    ['trunk', vacuum('trunk', [{ col: 2, row: -3 }, { col: 2, row: 3 }])],
    ['z-branch', vacuum('z-branch', [{ col: 2, row: 0 }, { col: 5, row: 0 }],
      { start: 'trunk', end: null })],
    ['a-branch', vacuum('a-branch', [{ col: 2, row: 0 }, { col: -1, row: 0 }],
      { start: 'trunk', end: null })],
  ]);
  const junctions = utilityLineJunctions(lines);
  const left = junctions.get('a-branch').start;
  const right = junctions.get('z-branch').start;
  assert.equal(left.kind, 'cross');
  assert.equal(left.degree, 4);
  assert.equal(left.ownerLineId, 'a-branch');
  assert.equal(left.renderHardware, true);
  assert.equal(right.renderHardware, false);
  assert.equal(left.signature, right.signature);
});

test('missing and cross-utility tap targets do not fabricate false fittings', () => {
  const records = [
    vacuum('missing', [{ col: 0, row: 0 }, { col: 0, row: 2 }],
      { start: 'absent', end: null }),
    { id: 'water', utilityType: 'waterSupplyPipe', path: [{ col: 0, row: 0 }, { col: 2, row: 0 }] },
    vacuum('wrong-type', [{ col: 1, row: 0 }, { col: 1, row: 2 }],
      { start: 'water', end: null }),
  ];
  assert.equal(utilityLineJunctions(records).size, 0);
});

test('a target endpoint contributes only its installed arm', () => {
  const lines = [
    vacuum('host', [{ col: 0, row: 0 }, { col: 3, row: 0 }]),
    vacuum('continuation', [{ col: 3, row: 0 }, { col: 6, row: 0 }],
      { start: 'host', end: null }),
  ];
  const junction = utilityLineJunctions(lines).get('continuation').start;
  assert.equal(junction.kind, 'coupling');
  assert.equal(junction.degree, 2);
  assert.deepEqual(junction.directions, ['-1,0', '1,0']);
});

test('two perpendicular endpoint arms classify as an elbow rather than a coupling', () => {
  const lines = [
    vacuum('host', [{ col: 0, row: 0 }, { col: 3, row: 0 }]),
    vacuum('turn', [{ col: 3, row: 0 }, { col: 3, row: 3 }],
      { start: 'host', end: null }),
  ];
  const junction = utilityLineJunctions(lines).get('turn').start;
  assert.equal(junction.kind, 'elbow');
  assert.equal(junction.degree, 2);
});

test('legacy contact-joining vacuum branches receive tee topology without saved tap ids', () => {
  const lines = [
    vacuum('legacy-trunk', [{ col: 0, row: 0 }, { col: 6, row: 0 }]),
    vacuum('legacy-branch', [{ col: 3, row: 0 }, { col: 3, row: 3 }]),
  ];
  const junction = utilityLineJunctions(lines, {
    joinsOnContactTypes: new Set(['vacuumPipe']),
  }).get('legacy-branch').start;
  assert.equal(junction.kind, 'tee');
  assert.equal(junction.degree, 3);
  assert.equal(junction.renderHardware, true);
});

test('a run peeling away from a shared header becomes an interior tee node', () => {
  const lines = [
    vacuum('shared-header', [
      { col: 0, row: 0 }, { col: 3, row: 0 }, { col: 6, row: 0 },
    ]),
    vacuum('drop-leg', [
      { col: 0, row: 0 }, { col: 3, row: 0 }, { col: 3, row: 3 },
    ]),
  ];
  const junctions = utilityLineJunctions(lines, {
    joinsOnContactTypes: new Set(['vacuumPipe']),
  });
  const tee = junctions.get('drop-leg').junctions
    .find(junction => junction.point.col === 3 && junction.point.row === 0);
  assert.equal(tee.kind, 'tee');
  assert.equal(tee.degree, 3);
  assert.deepEqual(tee.directions, ['-1,0', '0,1', '1,0']);
});
