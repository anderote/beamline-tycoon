import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };
globalThis.document = {
  createElement() {
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
const { EquipmentBuilder, equipmentFarPresentation } =
  await import('../src/renderer3d/equipment-builder.js');

function farType(parent, type) {
  for (const batch of parent.children.filter(child => child.userData.batchedEquipment)) {
    const metadata = batch.userData.farMetadataByType?.[type];
    if (!metadata) continue;
    const batchIds = batch.userData.types
      .flatMap((candidate, index) => candidate === type ? [index] : []);
    return { batch, metadata, batchIds };
  }
  return null;
}

test('facility equipment batches recognizable silhouettes and culls tabletop detail', () => {
  const parent = new THREE.Group();
  const builder = new EquipmentBuilder();
  const equipment = [
    { id: 'table', type: 'labTable', col: 0, row: 0 },
    { id: 'scope', type: 'oscilloscope', col: 0, row: 0, placeY: 1.52 },
  ];
  const furnishings = [
    { id: 'chair-a', type: 'cafeteriaChair', col: 2, row: 0 },
    { id: 'chair-b', type: 'cafeteriaChair', col: 3, row: 0 },
    { id: 'console', type: 'operatorConsole', col: 4, row: 0 },
    { id: 'paper', type: 'toiletPaperRoll', col: 5, row: 0,
      wallMount: { col: 5, row: 0, edge: 'n', off: 0 } },
    { id: 'pump-cart', type: 'pumpCart', col: 7, row: 0 },
  ];

  builder.build(equipment, furnishings, parent);
  assert.equal(parent.children.length, equipment.length + furnishings.length,
    'far geometry is allocated lazily and adds no near-view scene cost');
  builder.setDetailLevel(false);

  const batches = parent.children.filter(child => child.userData.batchedEquipment);
  assert.equal(batches.length, 1,
    'all compatible facility silhouettes share one GPU allocation and draw');
  assert.equal(farType(parent, 'cafeteriaChair')?.batchIds.length, 2,
    'repeated chairs share one geometry inside the batch');
  assert.equal(farType(parent, 'labTable')?.metadata.farSilhouetteKind,
    'authored-largest-parts');
  assert.equal(farType(parent, 'operatorConsole')?.metadata.farSilhouetteKind,
    'authored-largest-parts');
  assert.equal(farType(parent, 'pumpCart')?.metadata.farSilhouetteKind,
    'authored-largest-parts');
  assert.ok(farType(parent, 'pumpCart')?.metadata.farPrimitiveCount >= 5
    && farType(parent, 'pumpCart')?.metadata.farSourcePartCount >= 8,
  'the pump cart is selected from its authored housing, vessel, running gear, and handle');
  assert.equal(farType(parent, 'oscilloscope'), null, 'tabletop instruments disappear at far zoom');
  assert.equal(farType(parent, 'toiletPaperRoll'), null, 'tiny wall fittings disappear at far zoom');
  assert.ok([...builder._objectsById.values()].every(object => object.visible === false));
  const chair = farType(parent, 'cafeteriaChair');
  const chairB = chair.batch.userData.nodeIds.indexOf('chair-b');
  const chairFace = chair.batch.userData.farTriangleRanges[chairB].start;
  assert.equal(builder.resolveBatchHit({ object: chair.batch, faceIndex: chairFace }).nodeId,
    'chair-b', 'batched furnishings remain individually pickable');
  assert.ok(batches.every(batch => batch.castShadow === false
    && batch.material.vertexColors === true));
  assert.equal(new Set(batches.map(batch => batch.material)).size, 1,
    'all authored furnishing batches share one warmed far material');

  const roots = [...builder._objectsById.values()];
  const traversals = roots.map(root => root.traverse);
  for (const root of roots) {
    root.traverse = () => { throw new Error('LOD transition rescanned equipment descendants'); };
  }
  builder.setDetailLevel(true);
  for (let index = 0; index < roots.length; index++) roots[index].traverse = traversals[index];
  assert.ok(batches.every(batch => batch.visible === false));
  assert.ok([...builder._objectsById.values()].every(object => object.visible === true));
  builder.dispose(parent);
});

test('every facility catalogue item has an explicit far silhouette or hidden policy', () => {
  const definitions = Object.values(PLACEABLES)
    .filter(def => def.kind === 'equipment' || def.kind === 'furnishing')
    .sort((a, b) => a.id.localeCompare(b.id));
  const equipment = [];
  const furnishings = [];
  for (const [index, def] of definitions.entries()) {
    const item = {
      id: `catalogue-${def.id}`,
      type: def.id,
      col: index * 4,
      row: 0,
      wallMount: def.mount === 'wall'
        ? { col: index * 4, row: 0, edge: 'n', off: 0 }
        : undefined,
    };
    (def.kind === 'furnishing' ? furnishings : equipment).push(item);
  }

  const parent = new THREE.Group();
  const builder = new EquipmentBuilder();
  builder.build(equipment, furnishings, parent);
  builder.setDetailLevel(false);
  const batches = parent.children.filter(child => child.userData.batchedEquipment);
  assert.ok(batches.length < definitions.length / 10,
    'the catalogue is packaged into a bounded number of GPU batches');

  for (const def of definitions) {
    const item = (def.kind === 'furnishing' ? furnishings : equipment)
      .find(candidate => candidate.type === def.id);
    const policy = equipmentFarPresentation(item, def.kind === 'furnishing');
    const presentation = farType(parent, def.id);
    if (policy === 'hidden') {
      assert.equal(presentation, null, `${def.id} is intentionally culled at facility scale`);
      continue;
    }
    assert.ok(presentation, `${def.id} has a facility-scale silhouette`);
    const { batch, metadata } = presentation;
    assert.notEqual(metadata.farSilhouetteKind, 'footprint');
    assert.ok(metadata.farPartRoles.length >= 1);
    assert.equal(metadata.farSilhouetteKind, 'authored-largest-parts',
      `${def.id} must be exported from its authored geometry instead of a regex proxy`);
    assert.ok(metadata.farSourcePartCount >= metadata.farPrimitiveCount);
    assert.ok(metadata.farSelectedPartNames.length > 0);
    assert.equal(metadata.hasVertexColors, true);
    assert.equal(batch.castShadow, false);
  }

  builder.dispose(parent);
});

test('far furnishing geometry can be prepared while near detail remains selected', () => {
  const parent = new THREE.Group();
  const builder = new EquipmentBuilder();
  builder.build([], [{ id: 'desk', type: 'workstation', col: 0, row: 0 }], parent);
  const near = builder.getGroup('desk');
  assert.equal(near.visible, true);
  assert.equal(parent.children.some(child => child.userData.batchedEquipment), false);

  builder.prepareFarPresentation();
  const far = parent.children.find(child => child.userData.batchedEquipment);
  assert.ok(far, 'idle preparation builds the dormant authored batch');
  assert.equal(far.visible, false);
  assert.equal(near.visible, true, 'preparation does not change the current LOD');
  builder.dispose(parent);
});
