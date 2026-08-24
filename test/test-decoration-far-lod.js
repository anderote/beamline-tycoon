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
          fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {},
          stroke() {}, moveTo() {}, lineTo() {}, fillText() {}, strokeRect() {},
          set fillStyle(_value) {}, set strokeStyle(_value) {},
          set lineWidth(_value) {}, set font(_value) {}, set textAlign(_value) {},
          set textBaseline(_value) {},
        };
      },
    };
  },
};

const { DECORATIONS_RAW } = await import('../src/data/decorations.raw.js');
const { LIGHTING_DEFS } = await import('../src/data/placeables/lighting.js');
const { DecorationBuilder, decorationFarPresentation } =
  await import('../src/renderer3d/decoration-builder.js');

function item(def, index) {
  return {
    id: `catalogue-${def.id}`,
    type: def.id,
    category: def.category,
    col: index * 12,
    row: 0,
    subCol: 0,
    subRow: 0,
    subW: def.subW ?? 2,
    subL: def.subL ?? 2,
    subH: def.subH ?? 2,
    dir: 0,
    y: 0,
    placeY: 0,
    indoors: false,
    overheadMountY: def.mount === 'overhead' ? 3 : undefined,
    wallMount: def.mount === 'wall'
      ? { col: index * 12, row: 0, edge: 'n', off: 0 }
      : undefined,
  };
}

test('all decoration and lighting types use an explicit distant-view policy', () => {
  const definitions = [
    ...Object.values(DECORATIONS_RAW),
    ...LIGHTING_DEFS,
  ];
  const decorations = definitions.map(item);
  const parent = new THREE.Group();
  const builder = new DecorationBuilder();
  builder.build(decorations, parent);
  builder.setDetailLevel(false);

  const ordinaryBatches = new Map(parent.children
    .filter(child => child.userData.batchedDecorations)
    .map(batch => [batch.name.replace('decoration-far-', ''), batch]));
  const farPlantIds = new Set(parent.children
    .filter(child => child.userData.lod === 'plant-far')
    .flatMap(batch => batch.userData.batchNodeIds));

  for (const [index, def] of definitions.entries()) {
    const policy = decorationFarPresentation(def.id);
    if (policy === 'plant-silhouette') {
      assert.ok(farPlantIds.has(decorations[index].id),
        `${def.id} uses the shared low-poly vegetation presentation`);
      continue;
    }
    const batch = ordinaryBatches.get(def.id);
    if (policy === 'hidden') {
      assert.equal(batch, undefined, `${def.id} intentionally disappears at facility scale`);
      continue;
    }
    assert.ok(batch, `${def.id} has a type-specific grounds silhouette`);
    assert.ok(batch.userData.farPartRoles.length >= 2);
    assert.ok(batch.geometry.attributes.color?.count > 0);
    assert.equal(batch.castShadow, false);
  }

  assert.ok([...builder._ordinaryGroupsById.values()].every(group => group.visible === false),
    'authored ordinary decoration meshes are absent from the far render');
  const bench = ordinaryBatches.get('parkBench');
  assert.equal(builder.resolveBatchHit({ object: bench, instanceId: 0 }).nodeId,
    'catalogue-parkBench', 'ordinary far batches retain placeable identity');

  builder.setDetailLevel(true);
  assert.ok([...ordinaryBatches.values()].every(batch => batch.visible === false));
  assert.ok([...builder._ordinaryGroupsById.values()].every(group => group.visible === true));
  builder.dispose(parent);
});
