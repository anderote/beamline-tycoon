// Generated forests should not submit every trunk and canopy puff as a
// separate scene mesh. The live builder keeps individual placeable identity
// while batching the visible geometry and reusing a bounded silhouette set.

import assert from 'node:assert/strict';
import '../src/three-global.js';

const { DecorationBuilder, PLANT_BATCH_CHUNK_TILES, TREE_VISUAL_VARIANTS, treeVisualSeed } =
  await import('../src/renderer3d/decoration-builder.js');
const { DECORATIONS_RAW } = await import('../src/data/decorations.raw.js');

function decoration(id, type, col, row) {
  const def = DECORATIONS_RAW[type];
  return {
    id, type, kind: 'decoration', category: def.category,
    col, row, subCol: 0, subRow: 0, dir: 0,
    subW: def.subW ?? 4, subL: def.subL ?? 4, subH: def.subH ?? 4,
    y: 0, placeY: 0,
  };
}

const trees = [];
for (let i = 0; i < 40; i++) trees.push(decoration(`tree_${i}`, 'oakTree', i % 10, Math.floor(i / 10)));
const bench = decoration('bench', 'parkBench', 12, 0);

const parent = new THREE.Group();
const builder = new DecorationBuilder();
builder.build([...trees, bench], parent);

const stats = builder.getBatchStats();
assert.equal(stats.plantCount, trees.length);
assert.ok(stats.partCount > trees.length * 5, `expected many authored tree parts, got ${stats.partCount}`);
assert.ok(stats.batchCount > 0 && stats.batchCount < 8,
  `tree parts collapse into a few material batches (got ${stats.batchCount})`);
assert.ok(stats.prototypeCount <= TREE_VISUAL_VARIANTS,
  `one species uses at most ${TREE_VISUAL_VARIANTS} silhouettes (got ${stats.prototypeCount})`);
assert.ok(stats.geometryCount < stats.partCount / 2,
  `repeated prototype parts reuse batch geometry (${stats.geometryCount}/${stats.partCount})`);
assert.ok(stats.farBatchCount > 0,
  'a low-poly forest presentation is ready before the camera crosses the LOD boundary');
assert.ok(stats.farTriangleCount < stats.nearTriangleCount / 5,
  `far forest triangles are materially lower (${stats.farTriangleCount}/${stats.nearTriangleCount})`);
assert.ok(parent.children.length <= stats.batchCount + stats.farBatchCount + 1,
  'the scene contains near/far batches plus the ordinary bench, not one group per tree');

const batches = parent.children.filter(child => child.isBatchedMesh);
assert.equal(batches.length, stats.batchCount);
const mappedIds = new Set(batches.flatMap(batch => batch.userData.batchNodeIds));
for (const tree of trees) assert.ok(mappedIds.has(tree.id), `${tree.id} remains ray-pickable from a batch id`);

const root = builder.getGroup('tree_17');
assert.equal(root?.userData.nodeId, 'tree_17');
assert.ok(root?.userData.batchedPlantRoot);
assert.ok(root?.userData.outlineBounds?.height > 0,
  'each tree keeps a lightweight selection/outline root');
assert.equal(builder.getGroup('bench')?.parent, parent,
  'non-plant decorations stay on the ordinary rendering path');

const variants = new Set();
for (let seed = 1; seed <= 1000; seed++) variants.add(treeVisualSeed('oakTree', seed));
assert.equal(variants.size, TREE_VISUAL_VARIANTS,
  'coordinate seeds distribute across the complete bounded silhouette set');

builder.build(trees.slice(0, 2), parent);
assert.equal(builder.getBatchStats().plantCount, 2);
assert.equal(parent.children.filter(child => child.isBatchedMesh).length, builder.getBatchStats().batchCount,
  'a rebuild removes stale batches before adding the replacement forest');

const ray = new THREE.Raycaster(
  new THREE.Vector3(1, 20, 1),
  new THREE.Vector3(0, -1, 0),
);
const hit = ray.intersectObjects(parent.children, true)
  .find(intersection => intersection.object.userData?.lod === 'plant-near');
assert.ok(hit && Number.isInteger(hit.batchId), 'batched tree geometry remains ray-pickable');
assert.equal(hit.object.userData.batchNodeIds[hit.batchId], 'tree_0',
  'the batch intersection resolves to the individual tree id');
const identified = builder.resolveBatchHit(hit);
assert.equal(identified?.nodeId, 'tree_0');
assert.equal(identified?.rootObj, builder.getGroup('tree_0'),
  'renderer picking returns the lightweight root for just that tree');

builder.setDetailLevel(false);
assert.ok(parent.children.filter(child => child.userData?.lod === 'plant-near')
  .every(child => child.visible === false), 'authored tree batches hide at far zoom');
const farBatches = parent.children.filter(child => child.userData?.lod === 'plant-far');
assert.ok(farBatches.length > 0 && farBatches.every(child => child.visible === true),
  'low-poly forest batches replace them at far zoom');
assert.ok(farBatches.every(child => child.castShadow === false),
  'far forests do not multiply camera-pan shadow work');
const farHit = new THREE.Raycaster(
  new THREE.Vector3(1, 20, 1),
  new THREE.Vector3(0, -1, 0),
).intersectObjects(farBatches, true).find(intersection => intersection.object.userData?.batchedPlants);
assert.ok(farHit && Number.isInteger(farHit.instanceId),
  'far tree silhouettes remain ray-pickable');
assert.equal(builder.resolveBatchHit(farHit)?.nodeId, 'tree_0',
  'far silhouette picking resolves the original tree id');
builder.setDetailLevel(true);

const remoteTrees = [
  decoration('west_tree', 'oakTree', -PLANT_BATCH_CHUNK_TILES - 2, 0),
  decoration('center_tree', 'oakTree', 0, 0),
  decoration('east_tree', 'oakTree', PLANT_BATCH_CHUNK_TILES + 2, 0),
];
builder.build(remoteTrees, parent);
const chunkedBatches = parent.children.filter(child => child.isBatchedMesh);
assert.equal(builder.getBatchStats().chunkCount, 3,
  'a forest spanning distant land parcels is divided into spatial chunks');
assert.deepEqual(
  new Set(chunkedBatches.map(batch => `${batch.userData.plantChunk.col},${batch.userData.plantChunk.row}`)),
  new Set(['-2,0', '0,0', '1,0']),
  'each plant batch publishes the tile chunk covered by its bounds',
);
for (const batch of chunkedBatches) {
  assert.equal(batch.frustumCulled, true, 'spatial plant batches remain frustum-cullable');
  assert.ok(batch.boundingBox || batch.geometry.boundingBox,
    'each spatial batch has bounds for camera and shadow culling');
}

console.log('Tree batching tests passed.');
