// test/test-map-generator-trees.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateStartingMap } from '../src/game/map-generator.js';

// A blob at (cx, cy) with brightness b, radius r (sx = sy = r), no rotation.
function blob(cx, cy, b, r) {
  return { cx, cy, sx: r, sy: r, angle: 0, brightness: b };
}

test('tree clumps land inside dark blobs', () => {
  // Blob centers on the NE–SW axis so both fall inside the oblique map.
  // Dark blob in the SW half, bright blob in the NE half.
  const blobs = [blob(-20, 20, -0.8, 6), blob(20, -20, +0.6, 6)];
  const { placeables } = generateStartingMap(42, blobs);
  const trees = placeables.filter(p => p.kind === 'decoration');
  // Trees in the dark blob's area
  const inDark = trees.filter(t =>
    Math.hypot(t.col - (-20), t.row - 20) <= 7
  ).length;
  const inBright = trees.filter(t =>
    Math.hypot(t.col - 20, t.row - (-20)) <= 7
  ).length;
  // The blanket pass places trees across the whole map, so both blob areas
  // fill up. The dark blob additionally gets the clump pass (~15+ extra
  // trees); assert that bonus is visible as an absolute gap.
  assert.ok(inDark >= 8, `expected >=8 trees in dark blob, got ${inDark}`);
  assert.ok(inDark > inBright + 10, `expected dark blob to have >10 more trees than bright (dark=${inDark}, bright=${inBright})`);
});

test('conifers dominate darkest cells', () => {
  // Big, very-dark blob so the ring just outside the origin clearing still
  // samples deep into the b < -0.6 species bin (where conifers dominate).
  const blobs = [blob(0, 0, -0.95, 12)];
  const { placeables } = generateStartingMap(42, blobs);
  const trees = placeables.filter(p => p.kind === 'decoration');
  const conifers = ['pineTree', 'cedarTree'];
  // Trees just outside the 12x12 clearing — the darkest reachable region.
  const nearCenter = trees.filter(t => Math.hypot(t.col, t.row) <= 10);
  assert.ok(nearCenter.length > 0, 'expected at least some trees near center');
  const coniferFrac =
    nearCenter.filter(t => conifers.includes(t.type)).length / nearCenter.length;
  assert.ok(coniferFrac >= 0.5, `expected >=50% conifers near dark center, got ${coniferFrac}`);
});

test('origin clearing has no trees', () => {
  const blobs = [blob(0, 0, -0.8, 6)]; // dark blob exactly on origin
  const { placeables } = generateStartingMap(42, blobs);
  const trees = placeables.filter(p => p.kind === 'decoration');
  const inClearing = trees.filter(t => Math.abs(t.col) <= 6 && Math.abs(t.row) <= 6);
  assert.equal(inClearing.length, 0);
});

test('deterministic output for fixed seed and blobs', () => {
  const blobs = [blob(-10, -10, -0.7, 5), blob(10, 10, -0.5, 4)];
  const a = generateStartingMap(42, blobs);
  const b = generateStartingMap(42, blobs);
  assert.equal(a.placeables.length, b.placeables.length);
  for (let i = 0; i < a.placeables.length; i++) {
    assert.equal(a.placeables[i].type, b.placeables[i].type);
    assert.equal(a.placeables[i].col, b.placeables[i].col);
    assert.equal(a.placeables[i].row, b.placeables[i].row);
  }
});

test('returns empty arrays for floors/zones/walls/doors', () => {
  const { floors, zones, walls, doors } = generateStartingMap(42, []);
  assert.equal(floors.length, 0);
  assert.equal(zones.length, 0);
  assert.equal(walls.length, 0);
  assert.equal(doors.length, 0);
});

test('empty blob list produces no trees', () => {
  const { placeables } = generateStartingMap(42, []);
  assert.equal(placeables.length, 0);
});
