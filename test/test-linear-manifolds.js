import assert from 'node:assert/strict';
import {
  manifoldTapCoordinates,
  planLinearManifold,
  linearManifoldPortSpec,
  snapLinearManifoldPath,
} from '../src/utility/linear-manifolds.js';

const def = {
  linearManifold: {
    utility: 'powerCable',
    tapSpacingSubtiles: 4,
    minLengthSubtiles: 4,
    maxLengthSubtiles: 32,
    costPerSubtile: 10,
    serviceRadius: 10,
  },
};

const start = { col: 2, row: 3, subCol: 0, subRow: 0 };
const end = { col: 4, row: 5, subCol: 3, subRow: 0 };

const snapped = snapLinearManifoldPath(start, end);
assert.equal(snapped.axis, 'x', 'diagonal tie chooses the horizontal run');
assert.deepEqual(snapped.end, { col: 4, row: 3, subCol: 3, subRow: 0 });

const geometry = manifoldTapCoordinates(start, end, { tapSpacingSubtiles: 4 });
assert.deepEqual(geometry.points.map(p => [p.col, p.row, p.subCol, p.subRow]), [
  [2, 3, 0, 0], [3, 3, 0, 0], [4, 3, 0, 0], [4, 3, 3, 0],
], 'taps are evenly spaced and include the terminal fitting');

const plan = planLinearManifold({ type: 'powerBus', def, start, end });
assert.equal(plan.valid, true);
assert.equal(plan.utility, 'powerCable');
assert.equal(plan.lengthSubtiles, 11);
assert.equal(plan.taps.length, 4);
assert.equal(plan.cost.funding, 110);
assert.equal(plan.taps[0].branchPort, 'tap_000');
assert.equal(plan.taps[3].backbonePort, 'backbone_003');
assert.equal(planLinearManifold({ type: 'powerBus', def,
  start, end: { ...start, subCol: 1 } }).reason, 'too_short');

const instance = { linearManifold: plan };
assert.equal(linearManifoldPortSpec(instance, def, 'tap_002').utility, 'powerCable');
assert.equal(linearManifoldPortSpec(instance, def, 'backbone').through, true);
assert.equal(linearManifoldPortSpec(instance, def, 'missing'), null);

console.log('linear manifold tests passed');
