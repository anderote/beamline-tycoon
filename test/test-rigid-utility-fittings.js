// test/test-rigid-utility-fittings.js — continuous elbows and service hardware.

import * as THREE_NS from 'three';

globalThis.THREE = THREE_NS;

const { UtilityLineBuilderV2 } =
  await import('../src/renderer3d/utility-line-builder-v2.js');

let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

function build(lines) {
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE_NS.Group();
  builder.build(new Map(lines.map(line => [line.id, line])), new Map(), parent, { state: {} });
  return parent;
}

function collect(root, predicate) {
  const out = [];
  root.traverse(object => { if (predicate(object)) out.push(object); });
  return out;
}

console.log('\n--- 1. Vacuum uses swept elbows and CF-style flange rings ---');
{
  const parent = build([{
    id: 'vac', utilityType: 'vacuumPipe', start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 3, row: 0 }, { col: 3, row: 3 }],
  }]);
  const elbows = collect(parent, object => object.userData?.isUtilitySweepElbow);
  const fittings = collect(parent, object => object.userData?.fittingStyle === 'vacuumFlange');
  assert(elbows.length === 1 && elbows[0].geometry instanceof THREE_NS.TubeGeometry,
    `one continuous round sweep replaces the corner ball (got ${elbows.length})`);
  assert(fittings.length >= 2 && fittings.every(mesh => mesh.geometry instanceof THREE_NS.TorusGeometry),
    `${fittings.length} stainless flange rings bracket the elbow and long run`);
}

console.log('\n--- 2. RF uses a broad rectangular sweep and guide collars ---');
{
  const parent = build([{
    id: 'rf', utilityType: 'rfWaveguide', start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 3, row: 0 }, { col: 3, row: 3 }],
  }]);
  const elbows = collect(parent, object => object.userData?.isUtilitySweepElbow);
  const fittings = collect(parent, object => object.userData?.fittingStyle === 'waveguideFlange');
  assert(elbows.length === 1 && elbows[0].geometry instanceof THREE_NS.BufferGeometry,
    `one swept rectangular elbow replaces the cube joint (got ${elbows.length})`);
  assert(elbows[0]?.userData?.bendRadius >= 0.4,
    `the visible RF bend radius is broad (${elbows[0]?.userData?.bendRadius})`);
  assert(fittings.length >= 2 && fittings.every(mesh => mesh.geometry instanceof THREE_NS.BoxGeometry),
    `${fittings.length} oversized rectangular collars identify guide sections`);
}

console.log('\n--- 3. A tapped branch renders as a tee, not a dangling cap ---');
{
  const parent = build([
    {
      id: 'trunk', utilityType: 'vacuumPipe', start: null, end: null,
      path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
    },
    {
      id: 'branch', utilityType: 'vacuumPipe', start: null, end: null,
      tapLineIds: { start: 'trunk', end: null },
      path: [{ col: 2, row: 0 }, { col: 2, row: 2 }],
    },
  ]);
  const branch = parent.children.find(group => group.userData?.lineId === 'branch');
  const tees = collect(branch, object => object.userData?.isUtilityTeeFitting);
  const caps = collect(branch, object => object.userData?.isUtilityOpenCap);
  assert(tees.length === 1, 'the joined endpoint receives one tee collar');
  assert(caps.length === 1, 'only the genuinely open far end receives an open cap');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

