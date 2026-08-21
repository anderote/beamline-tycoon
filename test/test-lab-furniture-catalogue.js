import assert from 'node:assert/strict';
import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return {};
    return {
      width: 0, height: 0,
      getContext() {
        return {
          createRadialGradient() { return { addColorStop() {} }; },
          fillRect() {}, fillStyle: null,
        };
      },
    };
  },
};

const { PLACEABLES } = await import('../src/data/placeables/index.js');
const { itemMatchesZone } = await import('../src/data/facility.js');
const {
  EquipmentBuilder,
  createEquipmentPartGeometry,
} = await import('../src/renderer3d/equipment-builder.js');

const ALL_LABS = [
  'rfLab', 'coolingLab', 'vacuumLab', 'opticsLab',
  'diagnosticsLab', 'machineShop', 'maintenance',
];

const GENERAL_FURNITURE = [
  'labTable', 'labStool', 'labStorageCabinet', 'mobileLabCart',
  'labSink', 'safetyStation', 'labWasteBin', 'labShelving',
  'labComputerDesk', 'ruggedLabLaptop', 'labLabelPrinter', 'sampleOrganizer',
];

const RF_FURNITURE = [
  'rfTestRack', 'coaxCableRack', 'waveguideWorkstand', 'solderingStation',
  'frequencyCounter', 'rfPowerMeter', 'rfDummyLoad', 'rfShieldBox',
  'teslaCoil', 'vanDeGraaffGenerator', 'jacobsLadder', 'faradayCage',
  'hornAntennaStand', 'antennaTurntable', 'helmholtzCoilStand', 'rfAnechoicChamber',
];

const EXPERIMENTAL_RF = [
  'teslaCoil', 'vanDeGraaffGenerator', 'jacobsLadder', 'faradayCage',
  'hornAntennaStand', 'antennaTurntable', 'helmholtzCoilStand', 'rfAnechoicChamber',
];

const LAB_BENCHES = {
  rfElectronicsBench: 'rfLab',
  coolingServiceBench: 'coolingLab',
  vacuumAssemblyBench: 'vacuumLab',
  opticsAlignmentBench: 'opticsLab',
  diagnosticsBench: 'diagnosticsLab',
  fabricationWorkbench: 'machineShop',
  maintenanceWorkbench: 'maintenance',
};

const BENCH_SIGNATURE_PARTS = {
  rfElectronicsBench: 'solderSpool',
  coolingServiceBench: 'hoseBlue',
  vacuumAssemblyBench: 'chamber',
  opticsAlignmentBench: 'mirror1',
  diagnosticsBench: 'daqModule',
  fabricationWorkbench: 'builtInViseBody',
  maintenanceWorkbench: 'socketRail',
};

const SMALL_LAB_ITEMS = {
  coolingLab: ['pressureGaugeSet', 'thermalCamera', 'coolantSampleKit'],
  vacuumLab: ['vacuumGaugeController', 'flangePartsTray', 'ionGaugeTube'],
  opticsLab: ['lensTray', 'alignmentCamera', 'fiberSpool'],
  diagnosticsLab: ['logicAnalyzer', 'calibrationPulser', 'detectorModule'],
  machineShop: ['benchVise', 'precisionScale', 'colletSet'],
  maintenance: ['digitalMultimeter', 'powerToolCharger', 'portableToolCase'],
};

const LAB_EXPANSION = [
  ...Object.keys(LAB_BENCHES),
  ...Object.values(SMALL_LAB_ITEMS).flat(),
];

const TESTED_FURNITURE = [...GENERAL_FURNITURE, ...RF_FURNITURE, ...LAB_EXPANSION];

for (const id of TESTED_FURNITURE) {
  const def = PLACEABLES[id];
  assert.ok(def, `${id} is registered as a placeable`);
  assert.equal(def.kind, 'equipment', `${id} stays in the lab-equipment family`);
  assert.ok(def.desc, `${id} has a palette description`);
  assert.ok(def.parts?.length >= 4, `${id} has authored multi-part geometry`);
}

for (const id of GENERAL_FURNITURE) {
  for (const zoneType of ALL_LABS) {
    assert.equal(itemMatchesZone(PLACEABLES[id], zoneType), true,
      `${id} is available in ${zoneType}`);
  }
}

for (const id of RF_FURNITURE.filter(id => id !== 'solderingStation')) {
  assert.equal(itemMatchesZone(PLACEABLES[id], 'rfLab'), true,
    `${id} is available in the RF lab`);
  assert.equal(itemMatchesZone(PLACEABLES[id], 'coolingLab'), false,
    `${id} does not clutter unrelated lab palettes`);
}

for (const [id, zoneType] of Object.entries(LAB_BENCHES)) {
  assert.equal(itemMatchesZone(PLACEABLES[id], zoneType), true,
    `${id} is available in its ${zoneType} palette`);
  assert.equal(PLACEABLES[id].station?.slots, 2,
    `${id} provides two authored work positions`);
  assert.equal(PLACEABLES[id].hasSurface, false,
    `${id} reserves its top for built-in lab-specific equipment`);
  assert.ok(PLACEABLES[id].parts.some(part => part.name === BENCH_SIGNATURE_PARTS[id]),
    `${id} carries its lab-specific ${BENCH_SIGNATURE_PARTS[id]} geometry`);
  for (const otherZone of ALL_LABS.filter(zone => zone !== zoneType)) {
    assert.equal(itemMatchesZone(PLACEABLES[id], otherZone), false,
      `${id} stays out of the ${otherZone} palette`);
  }
}

for (const [zoneType, ids] of Object.entries(SMALL_LAB_ITEMS)) {
  for (const id of ids) {
    assert.equal(itemMatchesZone(PLACEABLES[id], zoneType), true,
      `${id} is available in its ${zoneType} palette`);
    assert.equal(PLACEABLES[id].stackable, true, `${id} is a benchtop placeable`);
    assert.equal(PLACEABLES[id].portable, true, `${id} has portable drop presentation`);
    assert.equal(PLACEABLES[id].station, undefined,
      `${id} delegates work positions to its host bench or table`);
  }
}

for (const id of ['ruggedLabLaptop', 'labLabelPrinter', 'sampleOrganizer']) {
  assert.equal(PLACEABLES[id].stackable, true, `${id} can be arranged on any lab surface`);
  assert.equal(PLACEABLES[id].portable, true, `${id} remains individually movable`);
}

assert.deepEqual(new Set(PLACEABLES.labComputerDesk.station.jobs),
  new Set(['labWork', 'analyze', 'paperwork']),
  'the Lab Computer Desk supports lab work, analysis, and documentation');
assert.equal(PLACEABLES.labComputerDesk.station.seated, 'preferred',
  'the Lab Computer Desk uses adjacent lab seating when available');
assert.equal(PLACEABLES.labComputerDesk.parts.filter(part => /^screen[LR]$/.test(part.name)).length, 2,
  'the Lab Computer Desk visibly carries two computer displays');

const table = PLACEABLES.labTable;
const bench = PLACEABLES.labBench;
assert.equal(table.hasSurface, true, 'the Lab Table accepts benchtop instruments');
assert.equal(table.surfaceY, 1.52, 'the Lab Table publishes its exact working height');
assert.equal(table.subW, bench.subW, 'the table and bench have comparable capacity');
assert.equal(table.subL, bench.subL, 'the table and bench have comparable depth');
assert.equal(table.parts.some(part => part.name === 'backsplash'), false,
  'the standard table stays visually distinct from the backed lab bench');
assert.deepEqual(table.variants, ['White Laminate', 'Maple', 'Stainless'],
  'the standard table offers three ordinary finish options');

for (const id of ['solderingStation', 'frequencyCounter', 'rfPowerMeter', 'rfDummyLoad', 'rfShieldBox']) {
  assert.equal(PLACEABLES[id].stackable, true, `${id} can sit on a table, bench, or cart`);
  assert.equal(PLACEABLES[id].portable, true, `${id} participates in portable drop presentation`);
  assert.equal(PLACEABLES[id].station, undefined, `${id} leaves staffing anchors to its host surface`);
}

for (const primitive of [
  { shape: 'cylinder', axis: 'x' },
  { shape: 'cylinder', axis: 'z' },
  { shape: 'sphere' },
  { shape: 'torus', axis: 'x' },
  { shape: 'torus', axis: 'y' },
  { shape: 'cone', axis: 'z', topScale: 0.25 },
]) {
  const expected = new THREE.Vector3(1.25, 2.5, 0.75);
  const geometry = createEquipmentPartGeometry(primitive, expected.x, expected.y, expected.z);
  geometry.computeBoundingBox();
  const actual = geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(actual.distanceTo(expected) < 1e-6,
    `${primitive.shape} axis ${primitive.axis || 'default'} honors its exact authored bounds`);
  geometry.dispose();
}

const parent = new THREE.Group();
const builder = new EquipmentBuilder();
builder.build(
  TESTED_FURNITURE.map((type, index) => ({
    id: `lab-furniture-${index}`,
    type,
    col: index * 3,
    row: 0,
    subCol: 0,
    subRow: 0,
  })),
  [],
  parent,
);
assert.equal(parent.children.length, TESTED_FURNITURE.length,
  'every new lab furnishing builds through the production equipment renderer');
// EquipmentBuilder bakes the static parts of a placeable into one merged
// geometry per surface, so "detailed" is a count of the authored parts that
// went into the object (userData.parts), not a count of meshes.
const authoredParts = (object) => {
  const parts = [];
  object.traverse(child => {
    if (child.isMesh && Array.isArray(child.userData.parts)) parts.push(...child.userData.parts);
  });
  return parts;
};
for (const object of parent.children) {
  assert.ok(authoredParts(object).length >= 4,
    `${object.userData.placeableType} renders as a detailed multi-part object`);
}

const experimentalObjects = parent.children.filter(object =>
  EXPERIMENTAL_RF.includes(object.userData.placeableType));
const primitiveShapes = new Set();
for (const object of experimentalObjects) {
  for (const part of authoredParts(object)) primitiveShapes.add(part.shape);
}
assert.deepEqual([...primitiveShapes].sort(), ['box', 'cone', 'cylinder', 'sphere', 'torus'],
  'experimental RF apparatus exercises the complete authored primitive vocabulary');

const teslaObject = parent.children.find(object => object.userData.placeableType === 'teslaCoil');
const teslaShapes = new Map(authoredParts(teslaObject).map(part => [part.name, part.shape]));
// Glow parts are never merged — light-rig and the effect system need them as
// individual objects — so the arc is still findable as its own mesh.
const teslaMeshes = new Map();
teslaObject.traverse(child => {
  if (child.isMesh && child.userData.partName) teslaMeshes.set(child.userData.partName, child);
});
assert.equal(teslaShapes.get('topToroid'), 'torus',
  'the Tesla coil terminates in a real toroidal mesh');
assert.ok(teslaMeshes.get('arcGlow1')?.userData.role === 'glow',
  'the Tesla coil arc reaches the shared emissive-effects pipeline');
assert.ok(Math.abs(teslaMeshes.get('arcGlow1')?.rotation.z) > 0.5,
  'the Tesla coil arc preserves its authored diagonal rotation');

const vanDeGraaffObject = parent.children.find(object =>
  object.userData.placeableType === 'vanDeGraaffGenerator');
const hasSphericalDome = authoredParts(vanDeGraaffObject)
  .some(part => part.name === 'dome' && part.shape === 'sphere');
assert.equal(hasSphericalDome, true, 'the Van de Graaff uses a spherical terminal dome');

const computerDesk = parent.children.find(object =>
  object.userData.placeableType === 'labComputerDesk');
let glowingComputerScreens = 0;
computerDesk.traverse(child => {
  if (/^screen[LR]$/.test(child.userData.partName) && child.userData.role === 'glow') {
    glowingComputerScreens++;
  }
});
assert.equal(glowingComputerScreens, 2,
  'both Lab Computer Desk displays use the shared emissive screen pipeline');
builder.dispose(parent);

console.log(`Lab furniture catalogue tests passed (${GENERAL_FURNITURE.length} general + ${RF_FURNITURE.length} RF + ${LAB_EXPANSION.length} other lab items).`);
