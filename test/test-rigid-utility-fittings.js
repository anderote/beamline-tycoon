// test/test-rigid-utility-fittings.js — formed elbows and service hardware.

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

function buildPreview(preview) {
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE_NS.Group();
  builder.setPreview(preview, parent);
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

console.log('\n--- 2. RF uses compact mitered elbows and guide collars ---');
{
  const parent = build([{
    id: 'rf', utilityType: 'rfWaveguide', start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 3, row: 0 }, { col: 3, row: 3 }],
  }]);
  const elbows = collect(parent, object => object.userData?.isUtilityMiterElbow);
  const sweeps = collect(parent, object => object.userData?.isUtilitySweepElbow);
  const fittings = collect(parent, object => object.userData?.fittingStyle === 'waveguideFlange');
  assert(elbows.length === 1 && elbows[0].geometry instanceof THREE_NS.BufferGeometry,
    `one fabricated rectangular miter replaces the rounded sweep (got ${elbows.length})`);
  assert(elbows[0]?.userData?.miterAngle === 45 && sweeps.length === 0,
    'the RF elbow has a sharp 45-degree miter face, not a curved bend');
  const normals = elbows[0]?.geometry?.attributes?.normal?.array || [];
  let hasDiagonalFace = false;
  for (let i = 0; i < normals.length; i += 3) {
    const x = Math.abs(normals[i]), y = Math.abs(normals[i + 1]), z = Math.abs(normals[i + 2]);
    if (y < 0.05 && x > 0.65 && z > 0.65 && Math.abs(x - z) < 0.05) {
      hasDiagonalFace = true;
      break;
    }
  }
  assert(hasDiagonalFace, 'the elbow mesh exposes the diagonal miter wall');
  assert(fittings.length >= 2 && fittings.every(mesh => mesh.geometry instanceof THREE_NS.BoxGeometry),
    `${fittings.length} oversized rectangular collars identify guide sections`);
}

console.log('\n--- 3. RF preview matches installed miter hardware ---');
{
  const parent = buildPreview({
    utilityType: 'rfWaveguide', valid: true,
    path: [{ col: 0, row: 0 }, { col: 3, row: 0 }, { col: 3, row: 3 }],
  });
  const elbows = collect(parent, object => object.userData?.isUtilityMiterElbow);
  const waypointBeads = collect(parent, object => object.geometry instanceof THREE_NS.SphereGeometry);
  assert(elbows.length === 1, 'the live draw preview uses the same miter elbow geometry');
  assert(waypointBeads.length === 2,
    `only the two preview endpoints use markers; the elbow stays visible (${waypointBeads.length})`);
}

console.log('\n--- 4. A tapped branch renders as a tee, not a dangling cap ---');
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

console.log('\n--- 5. Cryo preserves its jacket through formed bends and tees ---');
{
  const parent = build([
    {
      id: 'cryo-trunk', utilityType: 'cryoTransfer', start: null, end: null,
      path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
    },
    {
      id: 'cryo-branch', utilityType: 'cryoTransfer', start: null, end: null,
      tapLineIds: { start: 'cryo-trunk', end: null },
      path: [
        { col: 2, row: 0 }, { col: 2, row: 2 }, { col: 4, row: 2 },
      ],
    },
  ]);
  const branch = parent.children.find(group => group.userData?.lineId === 'cryo-branch');
  const elbows = collect(branch, object => object.userData?.isUtilitySweepElbow);
  const fittings = collect(branch, object => object.userData?.fittingStyle === 'cryoBayonet');
  const tees = collect(branch, object => object.userData?.isUtilityTeeFitting);
  const caps = collect(branch, object => object.userData?.isUtilityOpenCap);
  assert(elbows.length === 2
      && elbows.every(mesh => mesh.geometry instanceof THREE_NS.TubeGeometry),
    `the core and outer jacket both sweep continuously through the bend (${elbows.length})`);
  assert(fittings.length >= 3
      && fittings.every(mesh => mesh.geometry instanceof THREE_NS.TorusGeometry),
    `${fittings.length} round bayonet collars mark the bend and tee`);
  assert(tees.length === 1 && caps.length === 1,
    'the joined cryo end receives a bayonet tee while only the open end is capped');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
