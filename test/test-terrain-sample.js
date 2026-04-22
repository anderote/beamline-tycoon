// test/test-terrain-sample.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleCornersAt } from '../src/game/terrain.js';

test('flat tile returns the uniform height for any (u,v)', () => {
  const corners = { nw: 1.5, ne: 1.5, se: 1.5, sw: 1.5 };
  const samples = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0.37, 0.82],
  ];
  for (const [u, v] of samples) {
    assert.equal(sampleCornersAt(corners, u, v), 1.5);
  }
});

test('corner exactness: each corner at (u,v) = its canonical coord', () => {
  const corners = { nw: 1, ne: 2, se: 3, sw: 4 };
  assert.equal(sampleCornersAt(corners, 0, 0), 1); // NW
  assert.equal(sampleCornersAt(corners, 1, 0), 2); // NE
  assert.equal(sampleCornersAt(corners, 1, 1), 3); // SE
  assert.equal(sampleCornersAt(corners, 0, 1), 4); // SW
});

test('edge midpoints average the two adjacent corners', () => {
  const corners = { nw: 1, ne: 2, se: 3, sw: 4 };
  assert.equal(sampleCornersAt(corners, 0.5, 0), 1.5);   // NW <-> NE
  assert.equal(sampleCornersAt(corners, 0.5, 1), 3.5);   // SW <-> SE
  assert.equal(sampleCornersAt(corners, 0, 0.5), 2.5);   // NW <-> SW
  assert.equal(sampleCornersAt(corners, 1, 0.5), 2.5);   // NE <-> SE
});

test('center (0.5, 0.5) returns the 4-corner average', () => {
  const corners = { nw: 1, ne: 2, se: 3, sw: 4 };
  assert.equal(sampleCornersAt(corners, 0.5, 0.5), 2.5);
});

test('realistic 1-step slope: south edge raised', () => {
  // nw/ne flat at 0, sw/se raised to 0.5m — center should be halfway.
  const corners = { nw: 0, ne: 0, se: 0.5, sw: 0.5 };
  const y = sampleCornersAt(corners, 0.5, 0.5);
  assert.ok(Math.abs(y - 0.25) < 1e-9, `expected ~0.25, got ${y}`);
});

test('off-center sample (east-rising slope)', () => {
  // East edge raised: nw/sw=0, ne/se=1. At (u=0.25, v=0.25) bilinear gives:
  // (1-0.25)(1-0.25)*0 + 0.25*(1-0.25)*1 + 0.25*0.25*1 + (1-0.25)*0.25*0
  // = 0 + 0.1875 + 0.0625 + 0 = 0.25
  const corners = { nw: 0, ne: 1, se: 1, sw: 0 };
  const y = sampleCornersAt(corners, 0.25, 0.25);
  assert.ok(Math.abs(y - 0.25) < 1e-9, `expected 0.25, got ${y}`);
});

