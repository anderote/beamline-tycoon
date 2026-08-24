// test/test-light-pool-suppression.js
//
// The merged light-pool mesh (lighting-builder.js's buildLightPools) is ONE
// draw call covering every fixture in the facility. light-rig.js hands its 4
// real shadow spots to the nearest fixtures, and each of those must hide
// its own painted pool or it reads double-bright — so the pool mesh carries a
// per-quad alpha lane, and applyPoolSuppression writes into it by FIXTURE ID.
//
// THE BUG THIS FILE EXISTS FOR: quad index is NOT fixture index. buildLightPools
// skips fixtures two different ways (a def with no `light` block; a light with
// a degenerate radius), so any code that recovers "which quad is fixture N"
// by counting fixtures is off by one for everything after the first skip —
// and the symptom is that some OTHER lamp's pool goes dark, which looks like a
// rendering glitch rather than an indexing bug. The map is therefore built
// inline with the skips, and asserted here with BOTH skip kinds interleaved.
//
// THREE is a CDN global (see lighting-builder.js's header) and buildLightPools
// also touches `document` for its cached glow texture, so both are stubbed
// below — same pattern as test/test-light-rig.js. The stubs only need to be
// faithful about buffer layout (itemSize, array packing); nothing here renders.

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// --- THREE / document stubs -------------------------------------------------

class ColorStub {
  constructor(c) { this.r = 1; this.g = 1; this.b = 1; if (c !== undefined) this.set(c); }
  set(css) {
    // Only ever fed '#rrggbb' by the builder; parse it for real so the RGB
    // lanes carry distinguishable values and a suppression write that
    // clobbered them would be visible.
    const m = /^#([0-9a-f]{6})$/i.exec(String(css));
    if (m) {
      const n = parseInt(m[1], 16);
      this.r = ((n >> 16) & 255) / 255;
      this.g = ((n >> 8) & 255) / 255;
      this.b = (n & 255) / 255;
    }
    return this;
  }
}

class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array instanceof Float32Array ? array : new Float32Array(array);
    this.itemSize = itemSize;
    this.count = this.array.length / itemSize;
    this.needsUpdate = false;
  }
}
class Float32BufferAttribute extends BufferAttribute {}

class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  setIndex(arr) { this.index = arr; return this; }
  dispose() {}
}

class MaterialStub {
  constructor(opts = {}) { Object.assign(this, opts); this.userData = {}; }
  dispose() {}
}

class MeshStub {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material;
    this.userData = {}; this.name = ''; this.renderOrder = 0; this.frustumCulled = true;
  }
}

class CanvasTexture {
  constructor(c) { this.image = c; this.disposeCount = 0; }
  dispose() { this.disposeCount++; }
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  multiplyScalar(n) { return this.set(this.x * n, this.y * n, this.z * n); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  addScaledVector(v, n) { return this.set(this.x + v.x * n, this.y + v.y * n, this.z + v.z * n); }
}
class Raycaster {
  set(_origin, direction) { this.direction = direction; }
  intersectObjects(objects) {
    // A solid wall one unit east of the lamp. Only rays aimed east see it.
    if (objects[0]?.wall?.material?.side === 2) raycastsSawDoubleSide++;
    return this.direction.x > 0.1
      ? [{ point: { x: 1, y: 0, z: 0 }, object: { castShadow: true, material: { transparent: false } } }]
      : [];
  }
}

let raycastsSawDoubleSide = 0;

globalThis.THREE = {
  Color: ColorStub,
  BufferGeometry,
  BufferAttribute,
  Float32BufferAttribute,
  MeshBasicMaterial: MaterialStub,
  Mesh: MeshStub,
  CanvasTexture,
  Vector3,
  Raycaster,
  DoubleSide: 2,
  AdditiveBlending: 2,
};

globalThis.document = {
  createElement() {
    return {
      width: 0, height: 0,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        set fillStyle(_v) {},
      }),
    };
  },
};

const {
  buildLightPools, applyPoolSuppression, disposeLightGlowTexture, REAL_LIGHT_POOL_REMAINDER,
} =
  await import('../src/renderer3d/lighting-builder.js');

// --- fixture helpers --------------------------------------------------------

function fixture(id, light, extra = {}) {
  return {
    id,
    def: { id: `def_${id}`, mount: 'ground', light, ...extra },
    group: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
  };
}

const RED = { color: '#ff0000', intensity: 1, radius: 4, shape: 'point' };
const GREEN = { color: '#00ff00', intensity: 1, radius: 5, shape: 'point' };
const BLUE = { color: '#0000ff', intensity: 1, radius: 6, shape: 'point' };

// Alpha of quad `q`'s first vertex.
function alphaOf(mesh, q) { return mesh.geometry.attributes.color.array[q * 16 + 3]; }
// All four alphas of quad `q`.
function quadAlphas(mesh, q) {
  const a = mesh.geometry.attributes.color.array;
  return [0, 1, 2, 3].map((v) => a[(q * 4 + v) * 4 + 3]);
}
function expectedAlpha(weight) {
  const w = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
  return Math.fround(1 - w * (1 - REAL_LIGHT_POOL_REMAINDER));
}

// ---------------------------------------------------------------------------
console.log('\n=== the quad map skips BOTH kinds of skipped fixture ===\n');
{
  // A gets a quad. B has no light block at all. C has a light but radius 0
  // (poolFootprint collapses it, so buildLightPools `continue`s on rx<=0).
  // D therefore lives at quad 1, NOT quad 3.
  const mesh = buildLightPools([
    fixture('A', RED),
    fixture('B', null),
    fixture('C', { ...GREEN, radius: 0 }),
    fixture('D', BLUE),
  ]);
  assert(!!mesh, 'a mesh is built when at least one fixture has a drawable pool');

  const map = mesh.userData.poolQuadByFixtureId;
  assert(map instanceof Map, 'the mesh publishes a fixture-id -> quad-index Map');
  assert(map.get('A') === 0, `A is quad 0 (got ${map.get('A')})`);
  assert(map.get('D') === 1,
    `D is quad 1 — the two skipped fixtures consumed NO quad. A naive index-by-fixture-position would say 3. (got ${map.get('D')})`);
  assert(map.get('D') !== 3, 'and specifically not 3, which is what the off-by-one bug produces');
  assert(!map.has('B'), 'a fixture with no light block is absent from the map (it has no pool to suppress)');
  assert(!map.has('C'), 'a zero-radius fixture is absent too');
  assert(map.size === 2, `exactly two quads exist, so exactly two map entries (got ${map.size})`);

  const attr = mesh.geometry.attributes.color;
  assert(attr.itemSize === 4, `the color attribute is RGBA, not RGB — the alpha lane IS the suppression channel (got itemSize ${attr.itemSize})`);
  assert(attr.array.length === 2 * 4 * 4, `two quads x four verts x RGBA = 32 floats (got ${attr.array.length})`);
  assert(mesh.userData.poolQuadAlpha instanceof Float64Array,
    'the change-detection cache is Float64: comparing against the Float32 buffer would report a change every frame for any weight not exactly representable, defeating the cache entirely');
  assert(mesh.userData.poolQuadAlpha.length === 2, 'one cache entry per quad');
  assert([...mesh.userData.poolQuadAlpha].every((a) => a === 1), 'every quad starts fully unsuppressed (alpha 1)');
}

// ---------------------------------------------------------------------------
console.log('\n=== suppressing one fixture touches only that fixture\'s quad ===\n');
{
  const mesh = buildLightPools([
    fixture('A', RED),
    fixture('B', null),        // skipped
    fixture('C', BLUE),
    fixture('D', { ...GREEN, radius: 0 }), // skipped
    fixture('E', GREEN),
  ]);
  const map = mesh.userData.poolQuadByFixtureId;
  assert(map.get('A') === 0 && map.get('C') === 1 && map.get('E') === 2,
    `interleaved skips still map contiguously: A=0, C=1, E=2 (got ${map.get('A')}, ${map.get('C')}, ${map.get('E')})`);

  // Snapshot the RGB lanes so we can prove the alpha write never disturbs them.
  const rgbBefore = [...mesh.geometry.attributes.color.array].filter((_, i) => i % 4 !== 3);

  applyPoolSuppression(mesh, new Map([['C', 0.25]]));
  assert(alphaOf(mesh, 1) === expectedAlpha(0.25), `the addressed quad keeps calibrated indirect spill (got ${alphaOf(mesh, 1)})`);
  assert(quadAlphas(mesh, 1).every((a) => a === expectedAlpha(0.25)), 'all FOUR of the quad\'s vertices move together, not just the first');
  assert(alphaOf(mesh, 0) === 1 && alphaOf(mesh, 2) === 1,
    'neighbouring quads are untouched — this is the whole point of the id-keyed map');

  const rgbAfter = [...mesh.geometry.attributes.color.array].filter((_, i) => i % 4 !== 3);
  assert(rgbAfter.every((v, i) => v === rgbBefore[i]),
    'the RGB lanes survive a suppression write intact (colour is the def\'s, suppression is the rig\'s — separate channels)');
  assert(rgbBefore.some((v) => v !== 0), 'sanity: the RGB lanes carried real per-fixture colour to begin with');

  // Restoring: a fixture that drops out of the suppression map goes back to
  // full brightness — otherwise a pool stays dark forever after its spot
  // moves on, which is the "fixture lit by neither system" failure.
  applyPoolSuppression(mesh, new Map());
  assert(alphaOf(mesh, 1) === 1, 'dropping out of the suppression map restores the pool to alpha 1');
  applyPoolSuppression(mesh, null);
  assert(alphaOf(mesh, 1) === 1, 'a null suppression map means "suppress nothing", not "leave it as it was"');
}

// ---------------------------------------------------------------------------
console.log('\n=== wall-aware pools trace and clip their own ground polygon ===\n');
{
  const wall = { castShadow: true, material: { transparent: false, side: 0 } };
  const occluders = { wall, traverse(visitor) { visitor(wall); } };
  const mesh = buildLightPools([fixture('A', RED)], { occluders });
  const positions = mesh.geometry.attributes.position.array;
  const ranges = mesh.userData.poolVertexRanges;
  assert(positions.length === 33 * 3, 'occluded pool uses a centre plus a 32-ray fan, rather than one wall-blind quad');
  assert(ranges.get('A').count === 33, 'suppression tracks the complete fan vertex range for the fixture');
  assert(positions[3] < 4, 'an east-facing rim ray is clipped before the 4m pool boundary by the wall hit');
  assert(raycastsSawDoubleSide > 0,
    'wall collision is traced double-sided, so a lamp outside the wall cannot leak through its back face');
  assert(wall.material.side === 0,
    'the temporary double-sided collision setup restores the wall render material afterwards');

  applyPoolSuppression(mesh, new Map([['A', 1]]));
  const alphas = mesh.geometry.attributes.color.array;
  assert([...Array(33).keys()].every((v) => alphas[v * 4 + 3] === expectedAlpha(1)),
    'real-light handoff suppresses every fan vertex together, not just the centre');
}

// ---------------------------------------------------------------------------
console.log('\n=== change detection: a no-op re-apply uploads nothing ===\n');
{
  const mesh = buildLightPools([fixture('A', RED), fixture('B', BLUE)]);
  const attr = mesh.geometry.attributes.color;

  applyPoolSuppression(mesh, new Map([['A', 0.6]]));
  assert(attr.needsUpdate === true, 'a real change flags the attribute for upload');

  attr.needsUpdate = false;
  applyPoolSuppression(mesh, new Map([['A', 0.6]]));
  assert(attr.needsUpdate === false,
    'the identical weight re-applied does NOT re-flag the buffer — a static night with four steady spots costs zero uploads per frame');
  assert(alphaOf(mesh, 0) === expectedAlpha(0.6), 'and the value is still correct after the skipped write');

  // 0.4 is deliberately not exactly representable in float32. If the cache
  // compared against the Float32 buffer instead of its own Float64 copy, the
  // assertion above would fail every single frame.
  assert(expectedAlpha(0.6) !== 1 - 0.6 * (1 - REAL_LIGHT_POOL_REMAINDER),
    'sanity: the written alpha really does change under float32 rounding, which is what makes the Float64 cache load-bearing');

  attr.needsUpdate = false;
  applyPoolSuppression(mesh, new Map([['A', 0.6], ['B', 0.1]]));
  assert(attr.needsUpdate === true, 'a change to any single quad re-flags the whole attribute');
  assert(alphaOf(mesh, 1) === expectedAlpha(0.1), `and B moves while A stays put (got B alpha ${alphaOf(mesh, 1)})`);
  assert(alphaOf(mesh, 0) === expectedAlpha(0.6), 'A is unchanged');
}

// ---------------------------------------------------------------------------
console.log('\n=== room activation and real-light suppression share the same alpha lane ===\n');
{
  const mesh = buildLightPools([fixture('A', RED), fixture('B', BLUE)]);
  applyPoolSuppression(mesh, new Map([['A', 0.5]]), new Map([['A', 0.8], ['B', 0]]));
  assert(alphaOf(mesh, 0) === Math.fround(0.8 * expectedAlpha(0.5)),
    'an active room pool combines activation with real-light handoff');
  assert(alphaOf(mesh, 1) === 0, 'an inactive outdoor pool is fully dark in daylight');
}

// ---------------------------------------------------------------------------
console.log('\n=== clamping and degenerate inputs ===\n');
{
  const mesh = buildLightPools([fixture('A', RED)]);

  applyPoolSuppression(mesh, new Map([['A', 1]]));
  assert(alphaOf(mesh, 0) === expectedAlpha(1), 'weight 1 retains the calibrated low-frequency spill');

  applyPoolSuppression(mesh, new Map([['A', 4]]));
  assert(alphaOf(mesh, 0) === expectedAlpha(1), 'an out-of-range weight clamps at the configured spill remainder');

  applyPoolSuppression(mesh, new Map([['A', -3]]));
  assert(alphaOf(mesh, 0) === 1, 'a negative weight clamps to no suppression, not alpha > 1');

  applyPoolSuppression(mesh, new Map([['A', NaN]]));
  assert(alphaOf(mesh, 0) === 1, 'a NaN weight is treated as no suppression, never written into the buffer');

  applyPoolSuppression(mesh, new Map([['nobody', 1]]));
  assert(alphaOf(mesh, 0) === 1, 'a suppression entry for a fixture with no quad is ignored silently');

  // Callers hand this every child of the pool group, which may include things
  // that aren't pool meshes at all.
  applyPoolSuppression(null, new Map([['A', 1]]));
  applyPoolSuppression(undefined, null);
  applyPoolSuppression({}, new Map([['A', 1]]));
  applyPoolSuppression({ geometry: { attributes: {} }, userData: {} }, new Map([['A', 1]]));
  assert(true, 'a null / non-pool / half-built mesh is ignored without throwing');

  assert(buildLightPools([]) === null, 'no fixtures builds no mesh');
  assert(buildLightPools([fixture('A', null)]) === null, 'fixtures with nothing drawable build no mesh at all');
}

// ---------------------------------------------------------------------------
console.log('\n=== shared glow texture lifecycle ===\n');
{
  const first = buildLightPools([fixture('A', RED)]).material.map;
  disposeLightGlowTexture();
  assert(first.disposeCount === 1,
    'full renderer teardown disposes the module-owned glow texture');

  const second = buildLightPools([fixture('B', BLUE)]).material.map;
  assert(second !== first,
    'a later renderer gets a fresh texture instead of a disposed cached object');
  disposeLightGlowTexture();
  assert(second.disposeCount === 1, 'the replacement texture is independently disposable');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
