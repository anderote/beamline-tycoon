import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LARGE_WORLD_ATTACHMENT_THRESHOLD,
  worldDetailForZoom,
} from '../src/renderer3d/world-lod.js';

test('ordinary facilities retain authored detail at every zoom', () => {
  const count = LARGE_WORLD_ATTACHMENT_THRESHOLD - 1;
  assert.equal(worldDetailForZoom(0.2, count, true), true);
  assert.equal(worldDetailForZoom(0.2, count, false), true);
});

test('large facilities use hysteretic detail bands', () => {
  const count = LARGE_WORLD_ATTACHMENT_THRESHOLD;
  assert.equal(worldDetailForZoom(1, count, true), false);
  assert.equal(worldDetailForZoom(2, count, true), true);
  assert.equal(worldDetailForZoom(2, count, false), false,
    'stays in far detail inside the hysteresis band');
  assert.equal(worldDetailForZoom(2.2, count, false), true);
});
