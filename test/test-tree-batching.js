// Generated forests should not submit every trunk and canopy puff as a
// separate scene mesh. The live builder keeps individual placeable identity
// while batching the visible geometry and reusing a bounded silhouette set.

import assert from 'node:assert/strict';
import '../src/three-global.js';

const { DecorationBuilder, TREE_VISUAL_VARIANTS, treeVisualSeed } =
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
assert.ok(parent.children.length <= stats.batchCount + 1,
  'the scene contains batches plus the ordinary bench, not one group per tree');

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
  .find(intersection => intersection.object.userData?.batchedPlants);
assert.ok(hit && Number.isInteger(hit.batchId), 'batched tree geometry remains ray-pickable');
assert.equal(hit.object.userData.batchNodeIds[hit.batchId], 'tree_0',
  'the batch intersection resolves to the individual tree id');
const identified = builder.resolveBatchHit(hit);
assert.equal(identified?.nodeId, 'tree_0');
assert.equal(identified?.rootObj, builder.getGroup('tree_0'),
  'renderer picking returns the lightweight root for just that tree');

console.log('Tree batching tests passed.');
