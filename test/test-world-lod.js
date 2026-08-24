import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LARGE_WORLD_OBJECT_THRESHOLD,
  modeledWorldObjectCount,
  worldDetailForZoom,
} from '../src/renderer3d/world-lod.js';

test('ordinary facilities retain authored detail at every zoom', () => {
  const count = LARGE_WORLD_OBJECT_THRESHOLD - 1;
  assert.equal(worldDetailForZoom(0.2, count, true), true);
  assert.equal(worldDetailForZoom(0.2, count, false), true);
});

test('large facilities use hysteretic detail bands', () => {
  const count = LARGE_WORLD_OBJECT_THRESHOLD;
  assert.equal(worldDetailForZoom(1, count, true), false);
  assert.equal(worldDetailForZoom(2, count, true), true);
  assert.equal(worldDetailForZoom(2, count, false), false,
    'stays in far detail inside the hysteresis band');
  assert.equal(worldDetailForZoom(2.2, count, false), true);
});

test('world size includes all modeled placeables instead of pipe attachments alone', () => {
  const snapshot = {
    components: Array(82),
    pipeAttachments: Array(12),
    equipment: Array(10),
    furnishings: Array(110),
    decorations: Array(1237),
  };
  const count = modeledWorldObjectCount(snapshot);
  assert.equal(count, 1451);
  assert.equal(worldDetailForZoom(1, count), false,
    'a decoration-heavy lab activates far LOD despite having few pipe attachments');
});
