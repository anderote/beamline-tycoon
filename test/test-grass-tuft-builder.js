// test/test-grass-tuft-builder.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeGrassTuftsForCell,
  computeTallGrassBladesForCell,
  GRASS_DENSITY_MUL,
} from '../src/renderer3d/grass-tuft-builder.js';

test('bright grass produces more tufts than dark grass', () => {
  let dark = 0, bright = 0;
  for (let i = 0; i < 500; i++) {
    dark   += computeGrassTuftsForCell(i, 0, i * 2654435761 | 0, -0.9).length;
    bright += computeGrassTuftsForCell(i, 0, i * 2654435761 | 0, +0.9).length;
  }
  assert.ok(bright > dark * 1.5, `bright=${bright}, dark=${dark}`);
});

test('tufts fall within their source cell bounds', () => {
  const tufts = computeGrassTuftsForCell(10, 20, 0xdeadbeef, 0.5);
  for (const t of tufts) {
    assert.ok(Math.abs(t.x - 10) <= 0.5);
    assert.ok(Math.abs(t.z - 20) <= 0.5);
    assert.ok(t.scale >= 0.7 && t.scale <= 1.3);
    assert.ok(t.rotY >= 0 && t.rotY <= 2 * Math.PI);
  }
});

test('deterministic for fixed hash', () => {
  const a = computeGrassTuftsForCell(5, 5, 0xcafef00d, 0.3);
  const b = computeGrassTuftsForCell(5, 5, 0xcafef00d, 0.3);
  assert.deepEqual(a, b);
});

test('color comes from 8-entry grass palette', () => {
  const palette = new Set([
    0x1e4410, 0x28501c, 0x36681f, 0x4a8c2e,
    0x5f9b2e, 0x7ab03c, 0x8ec23e, 0xa3cd52,
  ]);
  let nonPalette = 0;
  for (let i = 0; i < 200; i++) {
    const tufts = computeGrassTuftsForCell(i, 0, i * 2654435761 | 0, +0.5);
    for (const t of tufts) if (!palette.has(t.colorHex)) nonPalette++;
  }
  assert.equal(nonPalette, 0);
});

test('density multiplier scales tuft count', () => {
  let base = 0, dense = 0;
  for (let i = 0; i < 300; i++) {
    base  += computeGrassTuftsForCell(i, 0, i * 2654435761 | 0, +0.5, 1).length;
    dense += computeGrassTuftsForCell(i, 0, i * 2654435761 | 0, +0.5, 3).length;
  }
  assert.ok(dense > base * 2, `base=${base}, dense=${dense}`);
});

test('clump-style kinds have density multipliers, wildgrass denser', () => {
  assert.ok(typeof GRASS_DENSITY_MUL.grass === 'number');
  assert.ok(typeof GRASS_DENSITY_MUL.wildgrass === 'number');
  assert.ok(GRASS_DENSITY_MUL.wildgrass > GRASS_DENSITY_MUL.grass);
});

test('tall grass produces dense single-blade fields (60+ per tile)', () => {
  for (let i = 0; i < 50; i++) {
    const blades = computeTallGrassBladesForCell(i, 0, i * 2654435761 | 0, 0);
    assert.ok(blades.length >= 60 && blades.length <= 91, `got ${blades.length}`);
  }
});

test('tall grass blades are deterministic and inside cell bounds', () => {
  const a = computeTallGrassBladesForCell(7, 3, 0xf00dcafe, 0.2);
  const b = computeTallGrassBladesForCell(7, 3, 0xf00dcafe, 0.2);
  assert.deepEqual(a, b);
  for (const blade of a) {
    assert.ok(Math.abs(blade.x - 7) <= 0.5);
    assert.ok(Math.abs(blade.z - 3) <= 0.5);
    assert.ok(blade.tilt >= 0 && blade.tilt <= 0.21);
  }
});

test('even dim grass has baseline coverage', () => {
  // Baseline density is non-zero even at moderate negative brightness —
  // grass should blanket the whole map, not just sunlit patches.
  let total = 0;
  for (let i = 0; i < 500; i++) {
    total += computeGrassTuftsForCell(i, 0, i * 2654435761 | 0, -0.2).length;
  }
  assert.ok(total > 100, `expected broad coverage, got ${total}`);
});
