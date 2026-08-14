// test/test-light-rig.js
//
// Guards the governing constraint of Task 5 (dynamic lighting): LightRig
// (src/renderer3d/light-rig.js) allocates its ENTIRE pool once, at
// construction, and never adds/removes a light from the scene again — not on
// update(), not on flash(), not on setEnabled() toggles. Adding/removing a
// light forces a shader recompile across every lit material in the game, so
// this is the one invariant the whole feature depends on; it's asserted here
// by counting scene.add()/remove() calls rather than trusting the render
// loop not to hitch, since nothing in this suite can see a real frame.
//
// Also covers floor-glow.js's buildFloorGlowStrip: it must refuse to paint a
// pool under vacuumPipe (FLOW_PARAMS.vacuumPipe is null — no flow to paint)
// or a hard-faulted run (the pipe above goes dark; so does the pool), and
// whatever it does build must not be tagged __shared, since — unlike the
// cached line/jacket materials in utility-line-builder-v2.js — its geometry
// is unique to one line's polyline and cannot be reused by another.
//
// THREE is a CDN global in the browser; stubbed here (pattern lifted from
// test/test-utility-flow.js, which stubs the same two geometry classes
// floor-glow.js needs — Vector3 and BoxGeometry — for the same reason: no
// browser, no real WebGL, just the geometry/uniform math). LightRig itself
// needs a few more stub classes (SpotLight, PointLight, a Scene that counts
// add/remove calls) that utility-flow's test didn't need.

import assert from 'node:assert/strict';
import { test } from 'node:test';

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new V3(this.x, this.y, this.z); }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  addVectors(a, b) { return this.set(a.x + b.x, a.y + b.y, a.z + b.z); }
  multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}

// Deliberately not real color math — tests only ever check "was this color
// value applied", never an actual RGB conversion.
class ColorStub {
  constructor(c) { this._raw = undefined; if (c !== undefined) this.set(c); }
  set(c) { this._raw = c; return this; }
  copy(o) { this._raw = o._raw; return this; }
  getHex() { return this._raw; }
}

// Reproduces three's actual generateTorso()/BoxGeometry uv/position layout
// closely enough to exercise the real bake functions — see
// test/test-utility-flow.js's identical stub for the verification notes.
class BoxGeometry {
  constructor(width, height, depth) {
    this.parameters = { width, height, depth, widthSegments: 1, heightSegments: 1, depthSegments: 1 };
    const halfLen = depth / 2;
    const position = [];
    const uv = [];
    for (let i = 0; i < 24; i++) {
      const z = (i % 2 === 0) ? -halfLen : halfLen;
      position.push(0, 0, z);
      uv.push(0, 0);
    }
    this.attributes = {
      position: { array: new Float32Array(position), needsUpdate: false },
      uv: { array: new Float32Array(uv), needsUpdate: false },
    };
  }
  dispose() {}
}

// Minimal Object3D: position + a parent chain deep enough for
// getWorldPosition to sum through nested groups (no rotation/scale
// composition — none of these tests rotate a parent group, so a straight
// position sum is exact, not just an approximation).
class Obj3 {
  constructor() {
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.visible = true;
    this.position = new V3();
    this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.scale = new V3(1, 1, 1);
    this.matrixAutoUpdate = true;
  }
  add(c) { c.parent = this; this.children.push(c); return this; }
  remove(c) {
    const i = this.children.indexOf(c);
    if (i !== -1) this.children.splice(i, 1);
    return this;
  }
  traverse(fn) {
    fn(this);
    for (const c of this.children) (c.traverse ? c.traverse(fn) : fn(c));
  }
  updateMatrix() {}
  updateMatrixWorld() {}
  getWorldPosition(target) {
    let x = this.position.x, y = this.position.y, z = this.position.z;
    let p = this.parent;
    while (p) { x += p.position.x; y += p.position.y; z += p.position.z; p = p.parent; }
    return target.set(x, y, z);
  }
}

class Group extends Obj3 {}
class Mesh extends Obj3 { constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; } }

class Light extends Obj3 {
  constructor(color, intensity) {
    super();
    this.color = new ColorStub(color);
    this.intensity = intensity || 0;
  }
}
class SpotLight extends Light {
  constructor(color, intensity, distance, angle, penumbra, decay) {
    super(color, intensity);
    this.isSpotLight = true;
    this.distance = distance; this.angle = angle; this.penumbra = penumbra; this.decay = decay;
    this.castShadow = false;
    this.shadow = {
      mapSize: { width: 0, height: 0, set(w, h) { this.width = w; this.height = h; } },
      camera: {}, bias: 0, normalBias: 0, map: null,
    };
    this.target = null;
  }
}
class PointLight extends Light {
  constructor(color, intensity, distance, decay) {
    super(color, intensity);
    this.isPointLight = true;
    this.distance = distance; this.decay = decay;
  }
}

class MeshStandardMaterial {
  constructor(opts = {}) { Object.assign(this, opts); this.userData = {}; }
  dispose() {}
}

// Scene stand-in that counts add()/remove() calls — the thing this whole
// suite exists to police. A real THREE.Scene doesn't count anything; this is
// the test harness's own instrumentation, not a fidelity concern.
class SceneStub extends Obj3 {
  constructor() { super(); this.addCalls = 0; this.removeCalls = 0; }
  add(c) { this.addCalls++; return super.add(c); }
  remove(c) { this.removeCalls++; return super.remove(c); }
}

globalThis.THREE = {
  Vector3: V3,
  Color: ColorStub,
  Group,
  Object3D: Obj3,
  Mesh,
  MeshStandardMaterial,
  BoxGeometry,
  SpotLight,
  PointLight,
  AdditiveBlending: 2,
};

const { LightRig } = await import('../src/renderer3d/light-rig.js');
const { buildFloorGlowStrip } = await import('../src/renderer3d/floor-glow.js');
const { FLOW_PARAMS } = await import('../src/renderer3d/utility-flow.js');

function countLights(scene) {
  let spots = 0, points = 0;
  scene.traverse((o) => {
    if (o.isSpotLight) spots++;
    if (o.isPointLight) points++;
  });
  return { spots, points };
}

// --- Governing constraint: allocate once, never again ----------------------

test('LightRig allocates its full pool at construction; light count never changes across update/flash/setEnabled', () => {
  const scene = new SceneStub();
  const rig = new LightRig(scene, { shadowSpotCount: 4, pointCount: 8, shadowMapSize: 1024 });

  const { spots, points } = countLights(scene);
  assert.equal(spots, 4, 'exactly the configured shadow-spot pool exists after construction');
  assert.equal(points, 8, 'exactly the configured non-shadow point pool exists after construction');
  // Each spot also carries one target Object3D (scene.add(target) +
  // scene.add(light)) — 4*2 + 8 = 16 total scene.add() calls, all at
  // construction.
  const addCallsAfterConstruction = scene.addCalls;
  assert.equal(addCallsAfterConstruction, 16, 'construction adds exactly the fixture-target pairs plus the point pool, nothing more');

  const camera = { position: new V3(10, 10, 10) };
  for (let i = 0; i < 30; i++) {
    rig.update(camera, i % 2 === 0 ? 1 : 0, 0.016);
    if (i % 5 === 0) rig.flash(new V3(i, 0, i), 0xff8844, 20, 200);
    if (i % 7 === 0) rig.setEnabled(i % 14 === 0);
  }
  rig.setEnabled(true);
  rig.update(camera, 0.5, 0.016);

  assert.equal(scene.addCalls, addCallsAfterConstruction, 'no scene.add() call happened after construction, across 30 update/flash/toggle cycles');
  assert.equal(scene.removeCalls, 0, 'no scene.remove() call happened either — lights are parked, never torn down, until dispose()');
  const after = countLights(scene);
  assert.deepEqual(after, { spots: 4, points: 8 }, 'the pool itself is exactly the same size it started as');

  rig.dispose();
  assert.equal(scene.removeCalls, 16, 'dispose() is the ONLY place that removes lights, and it removes exactly what construction added');
});

// --- flash(): reuse, never allocate; steal the dimmest when saturated -----

test('flash reuses idle point-light slots and steals the dimmest one when every slot is busy', () => {
  const scene = new SceneStub();
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 2 });
  const addCallsAfterConstruction = scene.addCalls;

  const originalLights = rig._pointSlots.map((s) => s.light);
  assert.equal(new Set(originalLights).size, 2, 'two distinct PointLight instances exist to begin with');

  const l1 = rig.flash(new V3(1, 0, 1), 0x111111, 10, 1000);
  const l2 = rig.flash(new V3(2, 0, 2), 0x222222, 5, 1000);
  assert.ok(originalLights.includes(l1) && originalLights.includes(l2) && l1 !== l2,
    'the first two flashes claim the two distinct pre-allocated slots, not new lights');
  assert.equal(scene.addCalls, addCallsAfterConstruction, 'claiming a slot never calls scene.add()');

  // Both slots are now mid-flash (saturated) — the third flash must steal
  // rather than allocate. l2 was set to intensity 5 (dimmer than l1's 10),
  // and no time has passed (no update() call), so l2 is unambiguously the
  // dimmest.
  const l3 = rig.flash(new V3(3, 0, 3), 0x333333, 20, 1000);
  assert.ok(originalLights.includes(l3), 'the third (stolen) flash still reuses one of the two original lights');
  assert.equal(l3, l2, 'the dimmest currently-flashing slot (intensity 5) is the one stolen, not l1 (intensity 10)');
  assert.equal(l3.intensity, 20, 'the stolen slot now carries the new flash\'s intensity');
  assert.equal(l3.color.getHex(), 0x333333, 'and the new flash\'s color');
  assert.equal(l1.intensity, 10, 'the untouched slot (l1) keeps its own flash exactly as set');

  assert.equal(scene.addCalls, addCallsAfterConstruction, 'stealing a slot never calls scene.add() either');
  assert.equal(countLights(scene).points, 2, 'still exactly two point lights in the scene throughout');
});

// --- nightFactor: fixtures fade to zero, flashes ignore it -----------------

test('fixture intensity scales to zero at nightFactor=0; an in-flight flash does not', () => {
  const scene = new SceneStub();
  const lampGroup = new Group();
  lampGroup.position.set(4, 0, 4);
  lampGroup.userData.lightFixture = { offsetY: 3, color: 0xffc864 };
  scene.add(lampGroup);

  const rig = new LightRig(scene, { shadowSpotCount: 4, pointCount: 8 });
  const camera = { position: new V3(0, 0, 0) };

  rig.update(camera, 0, 0.016); // full daylight
  const spotAtNoon = rig._spotSlots[0];
  assert.equal(spotAtNoon.assignedRef, lampGroup, 'the only fixture in the scene is assigned to the nearest spot slot');
  assert.equal(spotAtNoon.light.intensity, 0, 'a fixture at nightFactor=0 (full day) is fully off, not just dim');

  rig.update(camera, 1, 0.016); // full night
  assert.ok(rig._spotSlots[0].light.intensity > 0, 'the same fixture lights up once nightFactor rises');

  // Now fire a flash while nightFactor is back at 0, and advance a small dt.
  rig.flash(new V3(1, 0, 1), 0xffaa33, 50, 1000);
  const flashingSlot = rig._pointSlots.find((s) => s.flash);
  assert.ok(flashingSlot, 'the flash claimed a point-light slot');
  rig.update(camera, 0, 0.01); // 10ms of a 1000ms flash, at full daylight
  assert.ok(flashingSlot.light.intensity > 45,
    `a flash barely into its decay should still be near its starting intensity regardless of nightFactor=0 (got ${flashingSlot.light.intensity})`);
});

// --- buildFloorGlowStrip -----------------------------------------------

function makePoints() {
  return [new V3(0, 0.5, 0), new V3(4, 0.5, 0), new V3(4, 0.5, 6)];
}

test('buildFloorGlowStrip refuses to paint a pool under vacuumPipe (no flow) or a hard-faulted run', () => {
  assert.equal(FLOW_PARAMS.vacuumPipe, null, 'sanity: vacuumPipe really has no FLOW_PARAMS entry');
  assert.equal(buildFloorGlowStrip(makePoints(), 'vacuumPipe', 'ok'), null,
    'no flow to paint, regardless of flow state');
  assert.equal(buildFloorGlowStrip(makePoints(), 'coolingWater', 'hard'), null,
    'a dead network paints nothing, same as the pipe above it going dark');
});

test('buildFloorGlowStrip builds a strip for a healthy flowing run, and its material is never tagged __shared', () => {
  const strip = buildFloorGlowStrip(makePoints(), 'coolingWater', 'ok');
  assert.ok(strip, 'a healthy coolingWater run gets a floor-glow strip');
  assert.equal(strip.userData.isFloorGlowStrip, true, 'tagged so ThreeRenderer can find/toggle it by traversal');
  assert.ok(strip.children.length >= 2, 'one segment per waypoint pair (3 points -> 2 segments)');
  for (const seg of strip.children) {
    assert.ok(seg.isMesh, 'each segment is a mesh');
    assert.ok(!seg.material.userData.__shared,
      'the strip\'s material is per-line, unlike getLineMaterial/getJacketMaterial — it must never be tagged __shared, ' +
      'or one line\'s group disposing would free a material another line\'s strip still depends on');
  }

  const soft = buildFloorGlowStrip(makePoints(), 'coolingWater', 'soft');
  assert.ok(soft, 'a soft-faulted (over-capacity, still delivering) run still paints a pool, just dimmer per FLOW_STATE_MODS.soft');
});
