// test/test-screen-picking.js — forgiving object clicks without ambiguity.

import {
  isVisiblePickObject,
  pickWithScreenTolerance,
} from '../src/renderer3d/screen-picking.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
