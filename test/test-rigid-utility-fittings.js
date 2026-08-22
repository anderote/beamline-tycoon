// test/test-rigid-utility-fittings.js — formed elbows and service hardware.

import * as THREE_NS from 'three';

globalThis.THREE = THREE_NS;

const { COMPONENTS } = await import('../src/data/components.js');
const { portWorldPosition } = await import('../src/utility/ports.js');
const { UTILITY_TYPES } = await import('../src/utility/registry.js');
const { buildWorldPoints, UtilityLineBuilderV2 } =
  await import('../src/renderer3d/utility-line-builder-v2.js');

let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

function build(lines, placeables = new Map()) {
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE_NS.Group();
  builder.build(new Map(lines.map(line => [line.id, line])), placeables, parent, { state: {} });
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

console.log('\n--- 3b. Sloped RF transitions remain physically continuous ---');
{
  const source = {
    id: 'rf-source', type: 'pulsedKlystron',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const logical = portWorldPosition(source, COMPONENTS[source.type], 'rf_out');
  const line = {
    id: 'rf-drop', utilityType: 'rfWaveguide',
    start: { placeableId: source.id, portName: 'rf_out' }, end: null,
    path: [
      { col: logical.x / 2, row: logical.z / 2 },
      { col: logical.x / 2 + 1, row: logical.z / 2 },
    ],
  };
  const placeables = new Map([[source.id, source]]);
  const points = buildWorldPoints(line, placeables);
  const parent = build([line], placeables);
  const segments = collect(parent, object => object.userData?.isUtilityLineSegment);
  const fittings = collect(parent, object => object.userData?.fittingStyle === 'waveguideFlange');
  assert(segments.length === points.length - 1
      && segments.every((segment, index) => Math.abs(
        segment.geometry.parameters.depth - points[index].distanceTo(points[index + 1]),
      ) < 1e-6),
  'unsupported 3D turns keep full-length guide sections meeting at their butt joints');
  assert(fittings.length === 0,
    `sloped butt joints do not leave detached elbow collars behind (${fittings.length})`);
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

console.log('\n--- 5. Cryo renders as an opaque fabricated cryostat ---');
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
  const jackets = collect(branch, object => object.userData?.isCryostatVacuumJacket);
  const fittings = collect(branch, object => object.userData?.isCryostatBayonet);
  const bellows = collect(branch, object => object.userData?.cryostatPart === 'bellows-convolution');
  const bands = collect(branch, object => object.userData?.cryostatPart === 'identification-band');
  const tees = collect(branch, object => object.userData?.isUtilityTeeFitting);
  const caps = collect(branch, object => object.userData?.isUtilityOpenCap);
  assert(UTILITY_TYPES.cryoTransfer.geometryStyle === 'jacketedCylinder'
      && UTILITY_TYPES.cryoTransfer.presentationStyle === 'cryostatLine',
    'cryo keeps its physical jacket envelope and publishes a presentation-only cryostat style');
  assert(jackets.length === 2 && jackets.every(mesh =>
    mesh.material.transparent !== true && mesh.material.metalness >= 0.8),
  `${jackets.length} opaque stainless vacuum-jacket segments replace the translucent sleeve`);
  assert(elbows.length === 1 && elbows[0].geometry instanceof THREE_NS.TubeGeometry,
    `one continuous outer vacuum vessel sweeps through the bend (${elbows.length})`);
  assert(fittings.length >= 3 && fittings.every(fitting =>
    collect(fitting, object => object.userData?.cryostatPart === 'bellows-convolution').length === 5
      && collect(fitting, object => object.userData?.cryostatPart === 'bayonet-collar').length === 2),
  `${fittings.length} fabricated bayonet cans carry double collars and five-part bellows`);
  assert(bellows.length === fittings.length * 5 && bands.length > fittings.length,
    'bellows convolutions and recurring cyan identification bands give the run a cryostat silhouette');
  assert(tees.length === 1 && caps.length === 1,
    'the joined cryo end receives a bayonet tee while only the open end is capped');
}

console.log('\n--- 6. Cryogenic ports terminate in demountable bayonet cans ---');
{
  const source = {
    id: 'cold-box', type: 'coldBox4K',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const logical = portWorldPosition(source, COMPONENTS[source.type], 'cryo_out');
  const line = {
    id: 'cryo-terminal', utilityType: 'cryoTransfer',
    start: { placeableId: source.id, portName: 'cryo_out' }, end: null,
    path: [
      { col: logical.x / 2, row: logical.z / 2 },
      { col: logical.x / 2 + 2, row: logical.z / 2 },
    ],
  };
  const parent = build([line], new Map([[source.id, source]]));
  const terminals = collect(parent, object => object.userData?.isCryostatTerminalFitting);
  assert(terminals.length === 1 && terminals[0].userData.isCryostatBayonet,
    'the connected cold-box port receives one purpose-built terminal bayonet');
}

console.log('\n--- 7. Cryostat preview exposes the installed jacket and coupling vocabulary ---');
{
  const parent = buildPreview({
    utilityType: 'cryoTransfer', valid: true,
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }, { col: 4, row: 3 }],
  });
  const jackets = collect(parent, object => object.userData?.isCryostatVacuumJacket);
  const fittings = collect(parent, object => object.userData?.isCryostatBayonet);
  assert(jackets.length === 2 && fittings.length >= 3,
    'the live draw preview shows the broad jacket, expansion cans, and elbow bayonets');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
