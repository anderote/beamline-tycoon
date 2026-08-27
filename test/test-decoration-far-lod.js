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

function farType(parent, type) {
  for (const batch of parent.children.filter(child => child.userData.batchedDecorations)) {
    const metadata = batch.userData.farMetadataByType?.[type];
    if (!metadata) continue;
    const batchIds = batch.userData.types
      .flatMap((candidate, index) => candidate === type ? [index] : []);
    return { batch, metadata, batchIds };
  }
  return null;
}

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

  const ordinaryBatches = parent.children
    .filter(child => child.userData.batchedDecorations);
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
    const presentation = farType(parent, def.id);
    if (policy === 'hidden') {
      assert.equal(presentation, null, `${def.id} intentionally disappears at facility scale`);
      continue;
    }
    assert.ok(presentation, `${def.id} has a type-specific grounds silhouette`);
    const { batch, metadata } = presentation;
    assert.equal(metadata.farSilhouetteKind, 'authored-largest-parts',
      `${def.id} must retain original decoration geometry instead of a regex proxy`);
    assert.ok(metadata.farPartRoles.length >= 1);
    assert.ok(metadata.farSourcePartCount >= metadata.farPrimitiveCount);
    assert.ok(metadata.farSelectedPartNames.length > 0);
    assert.equal(metadata.hasVertexColors, true);
    assert.equal(batch.castShadow, false);
  }

  assert.ok([...builder._ordinaryGroupsById.values()].every(group => group.visible === false),
    'authored ordinary decoration meshes are absent from the far render');
  assert.equal(new Set(ordinaryBatches.map(batch => batch.material)).size, 1,
    'ordinary grounds silhouettes share one warmed far material');
  assert.ok(ordinaryBatches.length < 4,
    'ordinary grounds silhouettes share a bounded number of GPU batches');
  const bench = farType(parent, 'parkBench');
  const benchFace = bench.batch.userData.farTriangleRanges[bench.batchIds[0]].start;
  assert.equal(builder.resolveBatchHit({ object: bench.batch, faceIndex: benchFace }).nodeId,
    'catalogue-parkBench', 'ordinary far batches retain placeable identity');
  const overhead = farType(parent, 'overheadPowerSpan');
  const overheadSize = overhead.metadata.localBounds.getSize(new THREE.Vector3());
  assert.ok(overheadSize.x > overheadSize.z * 3,
    'the unrotated power-span wires run between poles while crossarms run across them');

  const roots = [...builder._ordinaryGroupsById.values()];
  const traversals = roots.map(root => root.traverse);
  for (const root of roots) {
    root.traverse = () => { throw new Error('LOD transition rescanned decoration descendants'); };
  }
  builder.setDetailLevel(true);
  for (let index = 0; index < roots.length; index++) roots[index].traverse = traversals[index];
  assert.ok(ordinaryBatches.every(batch => batch.visible === false));
  assert.ok([...builder._ordinaryGroupsById.values()].every(group => group.visible === true));
  builder.dispose(parent);
});

test('the legacy overhead span far model preserves wire and crossarm axes in both rotations', () => {
  const def = DECORATIONS_RAW.overheadPowerSpan;
  const first = item(def, 0);
  first.id = 'span-x';
  const second = item(def, 1);
  second.id = 'span-z';
  second.dir = 1;
  const parent = new THREE.Group();
  const builder = new DecorationBuilder();
  builder.build([first, second], parent);
  builder.setDetailLevel(false);
  const presentation = farType(parent, 'overheadPowerSpan');
  const { batch, batchIds } = presentation;
  assert.equal(batchIds.length, 2);
  const localBounds = presentation.metadata.localBounds;
  const matrix = new THREE.Matrix4();
  const sizes = [];
  for (const batchId of batchIds) {
    matrix.copy(batch.userData.farMatrices[batchId]);
    sizes.push(localBounds.clone().applyMatrix4(matrix).getSize(new THREE.Vector3()));
  }
  assert.ok(sizes[0].x > sizes[0].z * 3,
    'direction 0 runs its conductors along world X');
  assert.ok(sizes[1].z > sizes[1].x * 3,
    'direction 1 rotates the complete span once and runs conductors along world Z');
  builder.dispose(parent);
});
