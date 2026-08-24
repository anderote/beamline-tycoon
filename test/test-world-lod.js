import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  worldDetailForZoom,
} from '../src/renderer3d/world-lod.js';

test('enabled world LOD uses hysteretic detail bands at every facility size', () => {
  assert.equal(worldDetailForZoom(1, true), false);
  assert.equal(worldDetailForZoom(2, true), true);
  assert.equal(worldDetailForZoom(2, false), false,
    'stays in far detail inside the hysteresis band');
  assert.equal(worldDetailForZoom(2.2, false), true);
});

test('invalid zoom falls back to the normal zoomed-out policy', () => {
  assert.equal(worldDetailForZoom(Number.NaN, true), false);
});
