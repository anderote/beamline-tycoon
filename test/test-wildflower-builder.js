// test/test-wildflower-builder.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeFlowerInstancesForCell } from '../src/renderer3d/wildflower-builder.js';

test('dark cells produce fewer flowers than bright cells', () => {
  let darkTotal = 0, brightTotal = 0;
  for (let i = 0; i < 500; i++) {
    darkTotal   += computeFlowerInstancesForCell(i, 0, i * 2654435761 | 0, -0.9).length;
    brightTotal += computeFlowerInstancesForCell(i, 0, i * 2654435761 | 0, +0.9).length;
  }
  assert.ok(brightTotal > darkTotal * 2, `bright=${brightTotal}, dark=${darkTotal}`);
});

test('instances fall within their source cell bounds', () => {
  const cell = computeFlowerInstancesForCell(10, 20, 0xdeadbeef, 0.5);
  for (const f of cell) {
    // cell is at world (col, row) = (10, 20), flowers should be within ±0.5
    assert.ok(Math.abs(f.x - 10) <= 0.5);
    assert.ok(Math.abs(f.z - 20) <= 0.5);
    assert.ok(f.scale >= 0.8 && f.scale <= 1.3);
    assert.ok(f.rotY >= 0 && f.rotY <= 2 * Math.PI);
  }
});

test('deterministic for fixed hash', () => {
  const a = computeFlowerInstancesForCell(5, 5, 0xcafef00d, 0.3);
  const b = computeFlowerInstancesForCell(5, 5, 0xcafef00d, 0.3);
  assert.deepEqual(a, b);
});

test('color comes from 8-entry palette', () => {
  const palette = new Set([0xffe14d, 0xf2f2f2, 0xff8fa3, 0xc58df5, 0xe84a4a, 0x7db9ff]);
  let nonPalette = 0;
  for (let i = 0; i < 500; i++) {
    const cell = computeFlowerInstancesForCell(i, 0, i * 2654435761 | 0, +0.8);
    for (const f of cell) if (!palette.has(f.colorHex)) nonPalette++;
  }
  assert.equal(nonPalette, 0);
});
