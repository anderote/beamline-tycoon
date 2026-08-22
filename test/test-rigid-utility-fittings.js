// test/test-rigid-utility-fittings.js — formed elbows and service hardware.

import * as THREE_NS from 'three';

globalThis.THREE = THREE_NS;

const { COMPONENTS } = await import('../src/data/components.js');
const { portWorldPosition } = await import('../src/utility/ports.js');
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
  const copperGaskets = collect(parent, object => object.userData?.isVacuumCopperGasket);
  const bolts = collect(parent, object => object.userData?.utilityFlangePart === 'bolt');
  assert(elbows.length === 1 && elbows[0].geometry instanceof THREE_NS.TubeGeometry,
    `one continuous round sweep replaces the corner ball (got ${elbows.length})`);
  assert(fittings.length >= 2 && fittings.every(fitting => fitting instanceof THREE_NS.Group),
    `${fittings.length} complete CF flange assemblies bracket the elbow and long run`);
  assert(copperGaskets.length === fittings.length && bolts.length === fittings.length * 8,
    `${copperGaskets.length} copper gaskets and ${bolts.length} bolts make every CF joint explicit`);
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
  const teeFlanges = tees.flatMap(tee => collect(tee,
    object => object.userData?.fittingStyle === 'vacuumFlange'));
  const teeGaskets = tees.flatMap(tee => collect(tee,
    object => object.userData?.isVacuumCopperGasket));
  assert(tees.length === 1 && teeFlanges.length === 3 && teeGaskets.length === 3,
    'the joined endpoint becomes one three-arm CF tee with a copper gasket on every arm');
  assert(caps.length === 1, 'only the genuinely open far end receives an open cap');
}

console.log('\n--- 4b. Opposed branches fabricate one four-way vacuum cross ---');
{
  const parent = build([
    {
      id: 'cross-trunk', utilityType: 'vacuumPipe', start: null, end: null,
      path: [{ col: 0, row: -3 }, { col: 0, row: 3 }],
    },
    {
      id: 'cross-left', utilityType: 'vacuumPipe', start: null, end: null,
      tapLineIds: { start: 'cross-trunk', end: null },
      path: [{ col: 0, row: 0 }, { col: -3, row: 0 }],
    },
    {
      id: 'cross-right', utilityType: 'vacuumPipe', start: null, end: null,
      tapLineIds: { start: 'cross-trunk', end: null },
      path: [{ col: 0, row: 0 }, { col: 3, row: 0 }],
    },
  ]);
  const crosses = collect(parent, object => object.userData?.isUtilityCrossFitting);
  const crossFlanges = crosses.flatMap(cross => collect(cross,
    object => object.userData?.fittingStyle === 'vacuumFlange'));
  const crossGaskets = crosses.flatMap(cross => collect(cross,
    object => object.userData?.isVacuumCopperGasket));
  assert(crosses.length === 1 && crossFlanges.length === 4,
    `opposed branches share one four-arm cross (${crosses.length} cross, ${crossFlanges.length} flanges)`);
  assert(crossGaskets.length === 4,
    'the vacuum cross exposes one copper gasket at each demountable arm');
}

console.log('\n--- 4c. Compact equipment transitions use corrugated vacuum bellows ---');
{
  const pump = {
    id: 'pump', type: 'roughingPump',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const logical = portWorldPosition(pump, COMPONENTS[pump.type], 'vac_out');
  const parent = build([{
    id: 'vac-drop', utilityType: 'vacuumPipe',
    start: { placeableId: pump.id, portName: 'vac_out' }, end: null,
    path: [
      { col: logical.x / 2, row: logical.z / 2 },
      { col: logical.x / 2 + 2, row: logical.z / 2 },
    ],
  }], new Map([[pump.id, pump]]));
  const bellows = collect(parent, object => object.userData?.isVacuumBellows);
  const corrugations = bellows.flatMap(bellowsGroup => collect(bellowsGroup,
    object => object.userData?.utilityBellowsPart === 'corrugation'));
  assert(bellows.length > 0,
    `the short vertical-to-service transition receives bellows (${bellows.length})`);
  assert(corrugations.length === bellows.length * 7,
    `${corrugations.length} formed corrugations make the flexible section readable`);
}

console.log('\n--- 4d. A run peeling off a shared header is a tee, not an elbow ---');
{
  const parent = build([
    {
      id: 'shared-header', utilityType: 'vacuumPipe', start: null, end: null,
      path: [{ col: 0, row: 0 }, { col: 3, row: 0 }, { col: 6, row: 0 }],
    },
    {
      id: 'drop-leg', utilityType: 'vacuumPipe', start: null, end: null,
      path: [{ col: 0, row: 0 }, { col: 3, row: 0 }, { col: 3, row: 3 }],
    },
  ]);
  const tees = collect(parent, object => object.userData?.isUtilityTeeFitting);
  const elbows = collect(parent, object => object.userData?.isUtilitySweepElbow);
  const teeFlanges = tees.flatMap(tee => collect(tee,
    object => object.userData?.fittingStyle === 'vacuumFlange'));
  assert(tees.length === 1 && teeFlanges.length === 3,
    'the shared-header divergence fabricates one three-flange tee');
  assert(elbows.length === 0,
    `the diverging leg no longer curves tangentially out of the header (${elbows.length} elbows)`);
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
