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
  const byType = new Map(batches.map(batch => [
    batch.name.replace('equipment-far-', ''), batch,
  ]));
  assert.equal(byType.get('cafeteriaChair')?.count, 2,
    'repeated chairs share one instanced draw');
  assert.equal(byType.get('labTable')?.userData.farSilhouetteKind, 'authored-largest-parts');
  assert.equal(byType.get('operatorConsole')?.userData.farSilhouetteKind,
    'authored-largest-parts');
  assert.equal(byType.get('pumpCart')?.userData.farSilhouetteKind,
    'authored-largest-parts');
  assert.ok(byType.get('pumpCart')?.userData.farPrimitiveCount >= 5
    && byType.get('pumpCart')?.userData.farSourcePartCount >= 8,
  'the pump cart is selected from its authored housing, vessel, running gear, and handle');
  assert.equal(byType.has('oscilloscope'), false, 'tabletop instruments disappear at far zoom');
  assert.equal(byType.has('toiletPaperRoll'), false, 'tiny wall fittings disappear at far zoom');
  assert.ok([...builder._objectsById.values()].every(object => object.visible === false));
  assert.equal(builder.resolveBatchHit({ object: byType.get('cafeteriaChair'), instanceId: 1 }).nodeId,
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
  const batches = new Map(parent.children
    .filter(child => child.userData.batchedEquipment)
    .map(batch => [batch.name.replace('equipment-far-', ''), batch]));

  for (const def of definitions) {
    const item = (def.kind === 'furnishing' ? furnishings : equipment)
      .find(candidate => candidate.type === def.id);
    const policy = equipmentFarPresentation(item, def.kind === 'furnishing');
    const batch = batches.get(def.id);
    if (policy === 'hidden') {
      assert.equal(batch, undefined, `${def.id} is intentionally culled at facility scale`);
      continue;
    }
    assert.ok(batch, `${def.id} has a facility-scale silhouette`);
    assert.notEqual(batch.userData.farSilhouetteKind, 'footprint');
    assert.ok(batch.userData.farPartRoles.length >= 1);
    assert.equal(batch.userData.farSilhouetteKind, 'authored-largest-parts',
      `${def.id} must be exported from its authored geometry instead of a regex proxy`);
    assert.ok(batch.userData.farSourcePartCount >= batch.userData.farPrimitiveCount);
    assert.ok(batch.userData.farSelectedPartNames.length > 0);
    assert.ok(batch.geometry.attributes.color?.count > 0);
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
