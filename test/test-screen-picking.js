// test/test-screen-picking.js — forgiving object clicks without ambiguity.

import {
  isVisiblePickObject,
  pickWithScreenTolerance,
} from '../src/renderer3d/screen-picking.js';
import { utilityLinePickFromIntersections } from '../src/renderer3d/utility-line-picking.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  PASS:', message);
  } else {
    failed++;
    console.error('  FAIL:', message);
  }
}

console.log('\n--- Screen-space object picking ---');

{
  const calls = [];
  const exact = { id: 'exact', distance: 20 };
  const got = pickWithScreenTolerance(100, 80, 12, (x, y) => {
    calls.push([x, y]);
    return exact;
  });
  assert(got === exact, 'an exact pointer hit always wins');
  assert(calls.length === 1, 'nearby samples are skipped after an exact hit');
}

{
  const near = { id: 'near', distance: 20 };
  const got = pickWithScreenTolerance(100, 80, 12, (x, y) => (
    x === 106 && y === 80 ? near : null
  ));
  assert(got === near, 'an object just beside the pointer is still recognized');
}

{
  const closeRing = { id: 'close-ring', distance: 100 };
  const farRing = { id: 'far-ring', distance: 1 };
  const got = pickWithScreenTolerance(0, 0, 12, (x, y) => {
    if (x === -6 && y === 0) return closeRing;
    if (x === -12 && y === 0) return farRing;
    return null;
  });
  assert(got === closeRing, 'the closest screen-space target wins before a farther ring');
}

{
  const behind = { id: 'behind', distance: 30 };
  const inFront = { id: 'front', distance: 10 };
  const got = pickWithScreenTolerance(0, 0, 12, (x, y) => {
    if (x === -6 && y === 0) return behind;
    if (x === 6 && y === 0) return inFront;
    return null;
  });
  assert(got === inFront, 'overlapping candidates in one ring keep front-to-back ordering');
}

{
  let calls = 0;
  const got = pickWithScreenTolerance(10, 20, 0, () => {
    calls++;
    return null;
  });
  assert(got === null, 'a disabled tolerance preserves an exact miss');
  assert(calls === 1, 'disabled tolerance performs only the exact raycast');
}

{
  const visibleMesh = { visible: true, material: { visible: true }, parent: null };
  const hiddenProxy = { visible: true, material: { visible: false }, parent: null };
  assert(isVisiblePickObject(visibleMesh), 'rendered geometry participates in picking');
  assert(!isVisiblePickObject(hiddenProxy), 'an invisible proxy cannot capture a ground click');
}

{
  const hiddenGroup = { visible: false, parent: null };
  const child = { visible: true, material: { visible: true }, parent: hiddenGroup };
  assert(!isVisiblePickObject(child), 'geometry below a hidden parent is not pickable');
}

console.log('\n--- Utility line and Universal Utility Bus picking ---');

{
  const root = { parent: null, userData: {} };
  const carrier = {
    parent: root,
    userData: { isUniversalUtilityBus: true, busId: 'bus_1' },
  };
  const carrierMesh = { parent: carrier, userData: {} };
  const channel = {
    parent: root,
    userData: {
      lineId: 'line_power', utilityType: 'powerCable',
      isUniversalUtilityBus: true, busId: 'bus_1', channelSlot: 3,
    },
  };
  const channelMesh = { parent: channel, userData: {} };
  const got = utilityLinePickFromIntersections([
    { object: carrierMesh, distance: 2, point: { x: 1, z: 2 } },
    { object: channelMesh, distance: 3, point: { x: 1.1, z: 2.1 } },
  ], root);
  assert(got?.lineId === 'line_power',
    'a populated bus lane wins over the closer neutral carrier mesh');
  assert(got?.busId === 'bus_1' && got?.channelSlot === 3,
    'a populated lane preserves its bus metadata for bus-aware tools');
}

{
  const root = { parent: null, userData: {} };
  const carrier = {
    parent: root,
    userData: { isUniversalUtilityBus: true, busId: 'bus_empty' },
  };
  const got = utilityLinePickFromIntersections([
    { object: { parent: carrier, userData: {} }, distance: 4, point: { x: 5, z: 6 } },
  ], root);
  assert(got?.busId === 'bus_empty' && !got?.lineId,
    'an unpopulated carrier remains pickable as a bus');
}

{
  const root = { parent: null, userData: {} };
  const line = {
    parent: root,
    userData: { lineId: 'ordinary_line', utilityType: 'vacuumPipe' },
  };
  const got = utilityLinePickFromIntersections([
    { object: { parent: line, userData: {} }, distance: 1, point: { x: 0, z: 0 } },
  ], root);
  assert(got?.lineId === 'ordinary_line' && got?.utilityType === 'vacuumPipe',
    'ordinary utility lines retain their line identity');
}

{
  const root = { parent: null, userData: {} };
  const merged = {
    parent: root,
    userData: {
      isUtilityFarRouteBatch: true,
      lineIds: ['far_power', 'far_water'],
      utilityTypes: ['powerCable', 'waterSupplyPipe'],
      farTriangleRanges: [
        { start: 0, end: 12, instanceIndex: 0 },
        { start: 12, end: 30, instanceIndex: 1 },
      ],
    },
  };
  const got = utilityLinePickFromIntersections([
    { object: merged, faceIndex: 20, distance: 2, point: { x: 4, z: 8 } },
  ], root);
  assert(got?.lineId === 'far_water' && got?.utilityType === 'waterSupplyPipe',
    'facility-wide far route meshes preserve per-line picking by triangle range');
}

{
  const root = { parent: null, userData: {} };
  const merged = {
    parent: root,
    userData: {
      isUtilityNearDetailBatch: true,
      lineIds: ['near_power', 'near_bus_lane'],
      utilityTypes: ['powerCable', 'rfWaveguide'],
      busIds: [null, 'bus_near'],
      channelSlots: [null, 2],
      farTriangleRanges: [
        { start: 0, end: 18, instanceIndex: 0 },
        { start: 18, end: 42, instanceIndex: 1 },
      ],
    },
  };
  const got = utilityLinePickFromIntersections([
    { object: merged, faceIndex: 24, distance: 1, point: { x: 3, z: 7 } },
  ], root);
  assert(got?.lineId === 'near_bus_lane' && got?.utilityType === 'rfWaveguide',
    'spatial near-detail packages preserve per-line picking by triangle range');
  assert(got?.busId === 'bus_near' && got?.channelSlot === 2,
    'near-detail packages preserve Universal Utility Bus lane metadata');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
