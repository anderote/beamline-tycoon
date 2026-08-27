import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DENSE_POST_PROCESSING_OBJECT_LIMIT,
  postProcessingObjectCount,
  shouldSuppressDensePostProcessing,
} from '../src/renderer3d/post-processing-budget.js';

test('dense post-processing budget counts authored presentation records', () => {
  const snapshot = {
    components: Array(10),
    equipment: Array(20),
    furnishings: Array(30),
    decorations: Array(40),
    utilityLines: Array(50),
    pipeAttachments: Array(60),
    terrain: Array(10_000),
  };
  assert.equal(postProcessingObjectCount(snapshot), 210);
  assert.equal(shouldSuppressDensePostProcessing(snapshot), false);
  assert.equal(shouldSuppressDensePostProcessing(snapshot, { limit: 210 }), true);
});

test('Minor-Lab-scale content parks finishing effects at the inclusive boundary', () => {
  const snapshot = { decorations: Array(DENSE_POST_PROCESSING_OBJECT_LIMIT) };
  assert.equal(shouldSuppressDensePostProcessing(snapshot), true);
  snapshot.decorations.pop();
  assert.equal(shouldSuppressDensePostProcessing(snapshot), false);
});
