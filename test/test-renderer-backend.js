import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestedRendererMode } from '../src/renderer3d/renderer-backend.js';

const locationWith = (search = '') => ({ search });
const storageWith = (value = null) => ({ getItem: () => value });

test('renderer query explicitly selects native/default or forced WebGL 2 paths', () => {
  assert.equal(requestedRendererMode(locationWith('?renderer=modern'), storageWith('legacy')), 'modern');
  assert.equal(requestedRendererMode(locationWith('?renderer=webgpu'), storageWith('legacy')), 'modern');
  assert.equal(requestedRendererMode(locationWith('?renderer=legacy'), storageWith(null)), 'legacy');
  assert.equal(requestedRendererMode(locationWith('?renderer=webgl'), storageWith(null)), 'legacy');
});

test('stored rollback preference applies only without an explicit renderer query', () => {
  assert.equal(requestedRendererMode(locationWith(''), storageWith('legacy')), 'legacy');
  assert.equal(requestedRendererMode(locationWith(''), storageWith('webgl')), 'legacy');
  assert.equal(requestedRendererMode(locationWith(''), storageWith('modern')), 'modern');
  assert.equal(requestedRendererMode(locationWith('?unrelated=1'), storageWith(null)), 'modern');
});
