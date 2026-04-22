import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleGroundTypeAt } from '../src/game/terrain.js';

const baseState = {
  cornerHeights: new Map(),
  infraOccupied: { '1,1': 'grass', '2,2': 'concrete' },
};

test('returns grass for tile (1,1) given worldX=2, worldZ=2', () => {
  assert.equal(sampleGroundTypeAt(baseState, 2, 2), 'grass');
});

test('returns concrete for tile (2,2) given worldX=4, worldZ=4', () => {
  assert.equal(sampleGroundTypeAt(baseState, 4, 4), 'concrete');
});

test('returns null for tile with no entry', () => {
  assert.equal(sampleGroundTypeAt(baseState, 10, 10), null);
});

test('returns null when state has no infraOccupied', () => {
  assert.equal(sampleGroundTypeAt({}, 2, 2), null);
});
