// test/test-wildflower-builder.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeFlowerInstancesForCell,
  computeWildflowerCacheKey,
  WildflowerBuilder,
} from '../src/renderer3d/wildflower-builder.js';
import { computeGrassTuftCacheKey } from '../src/renderer3d/grass-tuft-builder.js';
import { contentKey } from '../src/renderer3d/content-hash.js';

test('dark cells get no flowers regardless of elevation', () => {
  let total = 0;
  for (let i = 0; i < 500; i++) {
    // Sample every combination of flat / hollow / hilltop at dark brightness.
    total += computeFlowerInstancesForCell(i, 0, i * 2654435761 | 0, -0.3, {nw:0, ne:0, se:0, sw:0}).length;
    total += computeFlowerInstancesForCell(i, 1, i * 2654435761 | 0, -0.3, {nw:-1.2, ne:-1.2, se:-1.2, sw:-1.2}).length;
    total += computeFlowerInstancesForCell(i, 2, i * 2654435761 | 0, -0.3, {nw:1.5, ne:1.5, se:1.5, sw:1.5}).length;
  }
  assert.equal(total, 0, `dark cells should never flower, got ${total}`);
});

test('bright flat meadows produce flowers', () => {
  let total = 0;
  for (let i = 0; i < 500; i++) {
    total += computeFlowerInstancesForCell(i, 0, i * 2654435761 | 0, +0.8, {nw:0, ne:0, se:0, sw:0}).length;
  }
  assert.ok(total > 50, `expected bright meadows to bloom, got ${total}`);
});

test('bright hollows produce more flowers than dark hollows', () => {
  let darkHollow = 0, brightHollow = 0;
  for (let i = 0; i < 500; i++) {
    darkHollow   += computeFlowerInstancesForCell(i, 0, i * 2654435761 | 0, -0.5, {nw:-1.2, ne:-1.2, se:-1.2, sw:-1.2}).length;
    brightHollow += computeFlowerInstancesForCell(i, 0, i * 2654435761 | 0, +0.8, {nw:-1.2, ne:-1.2, se:-1.2, sw:-1.2}).length;
  }
  assert.ok(brightHollow > darkHollow * 2, `bright=${brightHollow}, dark=${darkHollow}`);
});

test('instances fall within their source cell bounds', () => {
  const cell = computeFlowerInstancesForCell(10, 20, 0xdeadbeef, 0.8, {nw:-1.0, ne:-1.0, se:-1.0, sw:-1.0});
  for (const f of cell) {
    // cell is at world (col, row) = (10, 20), flowers should be within ±0.5
    assert.ok(Math.abs(f.x - 10) <= 0.5);
    assert.ok(Math.abs(f.z - 20) <= 0.5);
    assert.ok(f.scale >= 0.8 && f.scale <= 1.3);
    assert.ok(f.rotY >= 0 && f.rotY <= 2 * Math.PI);
    // All corners equal -1.0, so every interpolated y must equal -1.0 exactly.
    assert.equal(f.y, -1.0);
  }
});

test('flat zero corners produce y=0 for every instance', () => {
  const cell = computeFlowerInstancesForCell(10, 20, 0xdeadbeef, 0.8, {nw:0, ne:0, se:0, sw:0});
  assert.ok(cell.length > 0, 'expected some flowers');
  for (const f of cell) {
    assert.equal(f.y, 0);
  }
});

test('deterministic for fixed hash', () => {
  const a = computeFlowerInstancesForCell(5, 5, 0xcafef00d, 0.7, {nw:-1.0, ne:-1.0, se:-1.0, sw:-1.0});
  const b = computeFlowerInstancesForCell(5, 5, 0xcafef00d, 0.7, {nw:-1.0, ne:-1.0, se:-1.0, sw:-1.0});
  assert.deepEqual(a, b);
});

test('color comes from one of the elevation palettes', () => {
  // Union of meadow + hollow + hilltop palettes; any emitted color must be
  // drawn from this set regardless of which band the cell falls into.
  const palette = new Set([
    0xffe14d, 0xf2f2f2, 0xff8fa3, 0xc58df5, 0xe84a4a, 0x7db9ff,
    0x8ecfff, 0xbb8bff, 0xc8b4ff, 0x9abaf5,
    0xe5b4ff, 0xffd17a,
  ]);
  let nonPalette = 0;
  for (let i = 0; i < 500; i++) {
    // Mix cell types so every palette gets exercised.
    const cells = [
      computeFlowerInstancesForCell(i, 0, i * 2654435761 | 0, +0.8, {nw:-1.2, ne:-1.2, se:-1.2, sw:-1.2}), // hollow
      computeFlowerInstancesForCell(i, 1, i * 2654435761 | 0, +0.8, {nw:0, ne:0, se:0, sw:0}),             // meadow
      computeFlowerInstancesForCell(i, 2, i * 2654435761 | 0, +0.8, {nw:2.0, ne:2.0, se:2.0, sw:2.0}),     // hilltop
    ];
    for (const cell of cells) {
      for (const f of cell) if (!palette.has(f.colorHex)) nonPalette++;
    }
  }
  assert.equal(nonPalette, 0);
});

// --- Builder cache keys (content-hash) --------------------------------------
// TerrainBuilder/CliffBuilder key directly on contentKey(<section array>);
// WildflowerBuilder/GrassTuftBuilder wrap it via the compute*CacheKey
// helpers below. The old length+revision key was blind to brightness-only
// and same-count topology changes — these tests pin the fix.

function makeTerrain(n = 50) {
  const tiles = [];
  for (let i = 0; i < n; i++) {
    tiles.push({
      col: i % 10, row: (i / 10) | 0,
      hash: (i * 2654435761) | 0,
      brightness: 0.5,
      cornersY: { nw: 0, ne: 0, se: 0, sw: 0 },
    });
  }
  return tiles;
}

// Deep-clone via JSON round trip — structurally equal, no shared references.
const clone = (v) => JSON.parse(JSON.stringify(v));

test('cache key: structurally equal terrain produces the same key', () => {
  const terrain = makeTerrain();
  assert.equal(contentKey(terrain), contentKey(clone(terrain)));
  assert.equal(
    computeWildflowerCacheKey({ terrain }),
    computeWildflowerCacheKey({ terrain: clone(terrain) })
  );
});

test('cache key: brightness-only change flips the key (old key blind spot)', () => {
  const terrain = makeTerrain();
  const changed = clone(terrain);
  changed[7].brightness = 0.6; // same tile count, same heights — brightness only
  assert.notEqual(contentKey(terrain), contentKey(changed));
  assert.notEqual(
    computeWildflowerCacheKey({ terrain }),
    computeWildflowerCacheKey({ terrain: changed })
  );
});

test('cache key: same-count cornersY change flips the key (old key blind spot)', () => {
  const terrain = makeTerrain();
  const changed = clone(terrain);
  changed[3].cornersY.se = 0.5; // topology change, tile count unchanged
  assert.notEqual(contentKey(terrain), contentKey(changed));
});

test('cache key: removing one tile (e.g. floor painted over it) flips the key', () => {
  const terrain = makeTerrain();
  const changed = clone(terrain).slice(1);
  assert.notEqual(computeWildflowerCacheKey({ terrain }),
                  computeWildflowerCacheKey({ terrain: changed }));
});

test('cache key: grass tuft key covers terrain + grassSurfaces (incl. kind)', () => {
  const terrain = makeTerrain();
  const grassSurfaces = [{
    col: 1, row: 2, kind: 'wildgrass', hash: 42, brightness: 0.3,
    cornersY: { nw: 0, ne: 0, se: 0, sw: 0 },
  }];
  const base = computeGrassTuftCacheKey({ terrain, grassSurfaces });
  assert.equal(base,
    computeGrassTuftCacheKey(clone({ terrain, grassSurfaces })));

  const kindChanged = clone(grassSurfaces);
  kindChanged[0].kind = 'tallgrass';
  assert.notEqual(base,
    computeGrassTuftCacheKey({ terrain, grassSurfaces: kindChanged }));

  const brightnessChanged = clone(terrain);
  brightnessChanged[0].brightness = -0.2;
  assert.notEqual(base,
    computeGrassTuftCacheKey({ terrain: brightnessChanged, grassSurfaces }));
});

// Minimal THREE stub — just enough surface for WildflowerBuilder.rebuild's
// mesh-construction path, so the cache gate can be exercised behaviorally
// under plain Node (headless WebGL is unavailable in CI).
function makeThreeStub() {
  class Geo {
    translate() { return this; }
    scale() { return this; }
    dispose() {}
  }
  class Mat { constructor(opts) { Object.assign(this, opts); } dispose() {} }
  class Vec { set() {} }
  class Object3D {
    constructor() {
      this.position = new Vec(); this.rotation = new Vec();
      this.scale = new Vec(); this.matrix = {};
    }
    updateMatrix() {}
  }
  class InstancedMesh {
    constructor(geometry, material, count) {
      this.geometry = geometry; this.material = material; this.count = count;
      this.instanceMatrix = { needsUpdate: false };
      this.instanceColor = null;
      this.matrixAutoUpdate = true;
    }
    setMatrixAt() {}
    setColorAt() {}
  }
  class InstancedBufferAttribute {
    constructor(array, itemSize) {
      this.array = array; this.itemSize = itemSize; this.needsUpdate = false;
    }
  }
  class Color { setHex() {} }
  return {
    CylinderGeometry: Geo, SphereGeometry: Geo,
    MeshStandardMaterial: Mat,
    InstancedMesh, InstancedBufferAttribute,
    Object3D, Color,
  };
}

test('WildflowerBuilder.rebuild skips when content unchanged, rebuilds on brightness change', () => {
  global.THREE = makeThreeStub();
  try {
    const parent = {
      children: [],
      add(m) { this.children.push(m); },
      remove(m) { this.children = this.children.filter(c => c !== m); },
    };
    const builder = new WildflowerBuilder();
    builder.add(parent);

    const terrain = makeTerrain();
    terrain.forEach(t => { t.brightness = 0.8; }); // bright => flowers spawn
    builder.rebuild({ terrain });
    assert.equal(parent.children.length, 2, 'stem + bloom meshes added');
    const firstMeshes = parent.children.slice();

    // Structurally identical snapshot (fresh objects) — must NOT rebuild.
    builder.rebuild({ terrain: clone(terrain) });
    assert.deepEqual(parent.children, firstMeshes,
      'unchanged content must keep the same mesh instances');

    // Brightness-only change — must rebuild with new mesh instances.
    const changed = clone(terrain);
    changed[0].brightness = 0.2;
    builder.rebuild({ terrain: changed });
    assert.equal(parent.children.length, 2);
    assert.notEqual(parent.children[0], firstMeshes[0],
      'brightness change must trigger a rebuild');
  } finally {
    delete global.THREE;
  }
});

test('sloped tile produces per-instance terrain Y', () => {
  const corners = { nw: 0, ne: 0, se: 0.5, sw: 0.5 }; // south side raised 1 step
  const cell = computeFlowerInstancesForCell(10, 20, 0xfeed, 0.8, corners);
  assert.ok(cell.length > 0, 'expected some flowers on bright meadow');
  for (const f of cell) {
    const offX = f.x - 10;
    const offZ = f.z - 20;
    const u = offX + 0.5;
    const v = offZ + 0.5;
    // Expected: y = 0*(1-v) + 0.5*v = 0.5 * v (since nw=ne=0, se=sw=0.5)
    const expected = 0.5 * v;
    assert.ok(Math.abs(f.y - expected) < 1e-9,
      `flower y=${f.y} expected≈${expected} (offZ=${offZ}, v=${v})`);
  }
});
