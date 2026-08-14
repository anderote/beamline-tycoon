// test/test-light-pool-suppression.js
//
// The pool half of the two-lighting-system LOD handshake (lighting-builder.js):
// painted floor pools are the cheap default for every fixture, and a fixture
// that has been given a real shadow-casting spot by light-rig.js must have its
// painted pool faded out — or the same floor is lit twice and that lamp reads
// as double-bright.
//
// The highest-value thing here is the QUAD INDEX MAP. buildLightPools merges
// every pool into ONE mesh and SKIPS fixtures that have no `light` block or a
// degenerate (rx/rz <= 0) footprint. Any attempt to address a fixture's quad
// by its position in the input list is therefore off by one for every fixture
// that follows a skipped one — and the symptom is not a crash, it is the
// WRONG lamp's pool silently going dark. So: a fixture list with skips in the
// middle, and an assertion that suppressing the last fixture fades the last
// fixture.
//
// THREE is a CDN global (see lighting-builder.js's header); stubbed here in
// the same spirit as test/test-light-rig.js, with only the classes
// buildLightPools actually touches. `document` is stubbed too because the
// shared radial-gradient glow texture is baked on a 2D canvas.

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

// Enough of THREE.Color for buildLightPools: parse a #rrggbb string into
// linear-ish 0..1 floats. Exact colour management is irrelevant here — these
// tests only ever read the ALPHA lane.
class ColorStub {
  constructor(c) { this.r = 1; this.g = 1; this.b = 1; if (c !== undefined) this.set(c); }
  set(c) {
    if (typeof c === 'string' && c[0] === '#') {
      const n = parseInt(c.slice(1), 16);
      this.r = ((n >> 16) & 255) / 255; this.g = ((n >> 8) & 255) / 255; this.b = (n & 255) / 255;
    }
    return this;
  }
}

class BufferAttribute {
  constructor(array, itemSize) {
    this.array = new Float32Array(array);
    this.itemSize = itemSize;
    this.count = this.array.length / itemSize;
    this.needsUpdate = false;
  }
}

class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  setIndex(idx) { this.index = idx; return this; }
  dispose() {}
}

class Obj3 {
  constructor() {
    this.children = []; this.parent = null; this.userData = {};
    this.position = new V3();
    this.rotation = { x: 0, y: 0, z: 0 };
    this.visible = true;
  }
  add(c) { c.parent = this; this.children.push(c); return this; }
}
class Group extends Obj3 {}
class Mesh extends Obj3 {
  constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; }
}
class MeshBasicMaterial { constructor(opts = {}) { Object.assign(this, opts); this.userData = {}; } dispose() {} }
class CanvasTexture { constructor(canvas) { this.image = canvas; } dispose() {} }

globalThis.THREE = {
  Vector3: V3,
  Color: ColorStub,
  Group,
  Object3D: Obj3,
  Mesh,
  MeshBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute: BufferAttribute,
  CanvasTexture,
  AdditiveBlending: 2,
};

// The glow texture bakes a radial gradient on a 2D canvas at module scope the
// first time a pool or halo is built.
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

const { buildLightPools, applyPoolSuppression } = await import('../src/renderer3d/lighting-builder.js');

function fixture(id, def, x = 0, z = 0) {
  const group = new Group();
  group.position.set(x, 0, z);
  return { id, def, group };
}

const POINT_DEF = { id: 'lamppost', mount: 'ground', light: { color: '#ffa64d', intensity: 1, radius: 6, shape: 'point', emitterY: 2.7 } };
const NO_LIGHT_DEF = { id: 'bench', mount: 'ground' };
const ZERO_RADIUS_DEF = { id: 'brokenLamp', mount: 'ground', light: { color: '#ffffff', intensity: 1, radius: 0, shape: 'point', emitterY: 1 } };

// ---------------------------------------------------------------------------
console.log('\n=== the quad index map survives skipped fixtures ===\n');

// Deliberately interleaved: two paintable fixtures with BOTH kinds of skip
// sandwiched between them. A naive "index of the fixture in this list" would
// give D quad 3; the real answer is 1.
const fixtures = [
  fixture('A', POINT_DEF, 0, 0),
  fixture('B', NO_LIGHT_DEF, 4, 0),      // skipped: no `light` block
  fixture('C', ZERO_RADIUS_DEF, 8, 0),   // skipped: degenerate footprint
  fixture('D', POINT_DEF, 12, 0),
];
const mesh = buildLightPools(fixtures);

assert(!!mesh, 'a list with two paintable fixtures produces a merged pool mesh');
const map = mesh.userData.poolQuadByFixtureId;
assert(map instanceof Map, 'the mesh carries a fixture-id -> quad-index map');
assert(map.size === 2, `only the two paintable fixtures are in the map (got ${map.size})`);
assert(map.get('A') === 0, `the first paintable fixture is quad 0 (got ${map.get('A')})`);
assert(map.get('D') === 1,
  `the fixture AFTER two skips is quad 1, not quad 3 — an off-by-one here would silently fade the wrong lamp (got ${map.get('D')})`);
assert(!map.has('B'), 'a fixture with no light block has no quad');
assert(!map.has('C'), 'a fixture with a zero-radius (degenerate) footprint has no quad');

const color = mesh.geometry.attributes.color;
assert(color.itemSize === 4,
  `the colour attribute is RGBA (itemSize 4) — that is what turns on three's USE_COLOR_ALPHA and gives each quad an independent fade (got ${color.itemSize})`);
assert(color.array.length === 2 * 4 * 4, `two quads * four verts * four components (got ${color.array.length})`);
assert(mesh.userData.poolQuadAlpha.length === 2, 'one cached alpha per quad');
assert([...mesh.userData.poolQuadAlpha].every(a => a === 1), 'every quad starts fully unsuppressed');
for (let v = 0; v < 8; v++) {
  if (color.array[v * 4 + 3] !== 1) { assert(false, `vertex ${v} starts at alpha 1`); break; }
}
assert(true, 'every vertex starts at alpha 1');

// ---------------------------------------------------------------------------
console.log('\n=== applyPoolSuppression fades exactly the addressed quad ===\n');
{
  const changed = applyPoolSuppression(mesh, new Map([['D', 0.4]]));
  assert(changed === true, 'a weight change reports that the buffer moved');
  assert(color.needsUpdate === true, 'and flags the attribute for upload');

  const alphaOf = (quad) => [0, 1, 2, 3].map(v => color.array[quad * 16 + v * 4 + 3]);
  assert(alphaOf(1).every(a => Math.abs(a - 0.6) < 1e-6),
    `all four of D's verts drop to 1 - weight = 0.6 (got ${alphaOf(1)})`);
  assert(alphaOf(0).every(a => a === 1),
    `A's quad is untouched — suppression is per fixture, not global (got ${alphaOf(0)})`);

  // RGB must survive: the pool's colour is baked per vertex, and clobbering
  // it while writing alpha would repaint every suppressed lamp white. A and D
  // share a def, so their RGB lanes must still be identical afterwards.
  const rgbOf = (quad) => [0, 1, 2].map(c => color.array[quad * 16 + c]);
  assert(rgbOf(1).every(v => v > 0) && rgbOf(1).every((v, i) => Math.abs(v - rgbOf(0)[i]) < 1e-6),
    `the RGB lanes are left alone while alpha is written (D: ${rgbOf(1)}, A: ${rgbOf(0)})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== the buffer is uploaded only when a weight actually moved ===\n');
{
  color.needsUpdate = false;
  const again = applyPoolSuppression(mesh, new Map([['D', 0.4]]));
  assert(again === false, 're-applying the SAME weights is a no-op');
  assert(color.needsUpdate === false,
    'and does not flag an upload — this runs every rAF, so a static scene must cost zero GPU traffic');

  const back = applyPoolSuppression(mesh, new Map());
  assert(back === true, 'dropping a fixture out of the suppression map is a change');
  assert(mesh.userData.poolQuadAlpha[1] === 1, 'an id absent from the map means weight 0 — the pool comes back to full');
}

// ---------------------------------------------------------------------------
console.log('\n=== degenerate inputs ===\n');
{
  assert(applyPoolSuppression(mesh, new Map([['nosuchfixture', 1]])) === false,
    'a suppression entry for an unknown fixture id is ignored, not a crash');
  assert(applyPoolSuppression(mesh, null) === false, 'a null suppression map leaves an already-unsuppressed mesh alone');
  assert(applyPoolSuppression(null, new Map()) === false, 'a null mesh is a no-op');
  assert(applyPoolSuppression({ userData: {}, geometry: {} }, new Map()) === false,
    'a mesh that is not a pool mesh is a no-op');

  // Weights are clamped, not trusted.
  applyPoolSuppression(mesh, new Map([['A', 5], ['D', -3]]));
  assert(mesh.userData.poolQuadAlpha[0] === 0, 'a weight above 1 clamps to a fully suppressed pool');
  assert(mesh.userData.poolQuadAlpha[1] === 1, 'a negative weight clamps to fully unsuppressed');

  assert(buildLightPools([fixture('X', NO_LIGHT_DEF)]) === null, 'a list with nothing paintable builds no mesh at all');
  assert(buildLightPools([]) === null, 'an empty list builds no mesh');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
