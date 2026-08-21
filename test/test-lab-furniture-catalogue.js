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
const { EquipmentBuilder } = await import('../src/renderer3d/equipment-builder.js');

const ALL_LABS = [
  'rfLab', 'coolingLab', 'vacuumLab', 'opticsLab',
  'diagnosticsLab', 'machineShop', 'maintenance',
];

const GENERAL_FURNITURE = [
  'labTable', 'labStool', 'labStorageCabinet', 'mobileLabCart',
  'labSink', 'safetyStation', 'labWasteBin', 'labShelving',
];

const RF_FURNITURE = [
  'rfTestRack', 'coaxCableRack', 'waveguideWorkstand', 'solderingStation',
  'frequencyCounter', 'rfPowerMeter', 'rfDummyLoad', 'rfShieldBox',
];

for (const id of [...GENERAL_FURNITURE, ...RF_FURNITURE]) {
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

const parent = new THREE.Group();
const builder = new EquipmentBuilder();
builder.build(
  [...GENERAL_FURNITURE, ...RF_FURNITURE].map((type, index) => ({
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
assert.equal(parent.children.length, GENERAL_FURNITURE.length + RF_FURNITURE.length,
  'every new lab furnishing builds through the production equipment renderer');
for (const object of parent.children) {
  let meshes = 0;
  object.traverse(child => { if (child.isMesh) meshes++; });
  assert.ok(meshes >= 4, `${object.userData.placeableType} renders as a detailed multi-mesh object`);
}
builder.dispose(parent);

console.log(`Lab furniture catalogue tests passed (${GENERAL_FURNITURE.length} general + ${RF_FURNITURE.length} RF items).`);
