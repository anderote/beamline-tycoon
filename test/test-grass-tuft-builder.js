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
  assert.ok(typeof GRASS_DENSITY_MUL.tallgrass === 'number');
  assert.ok(GRASS_DENSITY_MUL.wildgrass > GRASS_DENSITY_MUL.grass);
  // Tallgrass layers rough clumps under the tall single blades, so it
  // should be at least as dense as wildgrass on the clump layer.
  assert.ok(GRASS_DENSITY_MUL.tallgrass >= GRASS_DENSITY_MUL.wildgrass);
});

test('tall grass produces tufted fields (100+ blades per tile)', () => {
  // Tufts are 7..10, each 14/18/22 blades depending on height class.
  // Lower bound: 7 tufts × 14 blades (all short) = 98.
  // Upper bound: 10 tufts × 22 blades (all tall) = 220.
  for (let i = 0; i < 50; i++) {
    const blades = computeTallGrassBladesForCell(i, 0, i * 2654435761 | 0, 0);
    assert.ok(blades.length >= 98 && blades.length <= 220, `got ${blades.length}`);
  }
});

test('tall grass has short/medium/tall/reed height classes', () => {
  // Sample many cells; each tuft's blades share a height-class base scale.
  // Expect all four bands to appear across a broad sample. Class scales
  // (with ±10% jitter):
  //   short  0.30 → 0.27..0.33
  //   medium 0.55 → 0.50..0.61
  //   tall   0.85 → 0.77..0.94
  //   reed   1.08 → 0.97..1.19
  const classes = new Set();
  for (let i = 0; i < 300; i++) {
    const blades = computeTallGrassBladesForCell(i, 0, i * 2654435761 | 0, 0);
    for (const b of blades) {
      if (b.scale < 0.40)      classes.add('short');
      else if (b.scale < 0.70) classes.add('medium');
      else if (b.scale < 0.96) classes.add('tall');
      else                     classes.add('reed');
    }
  }
  assert.ok(classes.has('short'), 'short tufts missing');
  assert.ok(classes.has('medium'), 'medium tufts missing');
  assert.ok(classes.has('tall'), 'tall tufts missing');
  assert.ok(classes.has('reed'), 'reed tufts missing');
});

test('reed blades use straw palette and bend gently', () => {
  // Reeds are the tallest class (≥0.96 m with jitter) and wear the
  // REED_COLORS palette; they still lean so the field never looks rigid.
  const reedPalette = new Set([
    0xbca05a, 0xa89040, 0xc8b060, 0x8e7a30,
    0x9a8540, 0x6a7028, 0xa89a50, 0x585020,
  ]);
  let reedsSeen = 0;
  for (let i = 0; i < 300; i++) {
    const blades = computeTallGrassBladesForCell(i, 0, i * 2654435761 | 0, 0);
    for (const b of blades) {
      if (b.scale >= 0.96) {
        reedsSeen++;
        assert.ok(b.tilt >= 0.10 && b.tilt <= 0.36, `reed tilt ${b.tilt} out of range`);
        assert.ok(reedPalette.has(b.colorHex), `reed color 0x${b.colorHex.toString(16)} not in reed palette`);
      }
    }
  }
  assert.ok(reedsSeen > 0, 'no reeds seen across 300 cells');
});

test('tall grass blades are deterministic and inside cell bounds', () => {
  const a = computeTallGrassBladesForCell(7, 3, 0xf00dcafe, 0.2);
  const b = computeTallGrassBladesForCell(7, 3, 0xf00dcafe, 0.2);
  assert.deepEqual(a, b);
  for (const blade of a) {
    assert.ok(Math.abs(blade.x - 7) <= 0.5);
    assert.ok(Math.abs(blade.z - 3) <= 0.5);
    // Reeds arc gently (0.10..0.35 rad); grass blades bend harder (0.12..0.55).
    if (blade.scale >= 0.96) {
      assert.ok(blade.tilt >= 0.10 && blade.tilt <= 0.36, `reed tilt ${blade.tilt}`);
    } else {
      assert.ok(blade.tilt >= 0.12 && blade.tilt <= 0.56, `grass tilt ${blade.tilt}`);
    }
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
