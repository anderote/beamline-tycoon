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
const { fixtureLightTag } = await import('../src/renderer3d/lighting-builder.js');
const { LIGHTING_DEFS } = await import('../src/data/placeables/lighting.js');
const DEFS_BY_ID = Object.fromEntries(LIGHTING_DEFS.map((d) => [d.id, d]));

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

// --- LOD: hysteresis, crossfade, suppression handshake ---------------------
//
// Painted pools (lighting-builder.js) are the cheap default for every
// fixture; only the nearest few get a real spot, and a fixture holding a real
// spot must have its painted pool suppressed. The failure mode being designed
// against is FLICKER at that boundary — two fixtures at nearly equal distance
// trading the same slot every frame, each trade a visible pop between "real
// shadow" and "painted pool".

/** A fixture group carrying the same tag decoration-builder.js stamps. */
function placeFixture(scene, id, def, x, z = 0, dir = 0) {
  const g = new Group();
  g.position.set(x, 0, z);
  g.userData.lightFixture = fixtureLightTag(def, { id, dir });
  scene.add(g);
  return g;
}

test('a held fixture does not thrash its slot as the camera oscillates across the LOD boundary', () => {
  const scene = new SceneStub();
  const lamp = DEFS_BY_ID.lamppost;
  // Five fixtures, ONE slot: rank can run all the way to 4, well past the
  // pool size plus its slack, so the hysteresis is actually load-bearing here
  // rather than trivially satisfied.
  const fx = [0, 10, 20, 30, 40].map((x, i) => placeFixture(scene, `L${i}`, lamp, x));
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 2 });
  const camera = { position: new V3(0, 0, 0) };

  rig.update(camera, 1, 0.05);
  assert.equal(rig._spotSlots[0].assignedRef, fx[0], 'the nearest fixture claims the only slot');

  // Park the camera exactly on the boundary between fx[0] and fx[1] and jitter
  // across it. Without hysteresis the #1 rank flips every frame and the slot
  // would follow it.
  let swaps = 0;
  let prev = rig._spotSlots[0].assignedRef;
  for (let i = 0; i < 120; i++) {
    camera.position.set(i % 2 === 0 ? 5.1 : 4.9, 0, 0);
    rig.update(camera, 1, 0.05); // 6 seconds of frames — well past SPOT_MIN_HOLD_MS
    if (rig._spotSlots[0].assignedRef !== prev) { swaps++; prev = rig._spotSlots[0].assignedRef; }
  }
  assert.equal(swaps, 0,
    `the incumbent kept its slot across 120 boundary-crossing frames (saw ${swaps} swaps)`);
  assert.equal(rig._spotSlots[0].assignedRef, fx[0], 'and it is still the original fixture');
  assert.equal(rig._spotSlots[0].weight, 1, 'its crossfade weight is saturated, so its pool is fully suppressed');
});

test('a fixture that decisively loses the ranking does hand its slot over, via a fade, not a cut', () => {
  const scene = new SceneStub();
  const lamp = DEFS_BY_ID.lamppost;
  const fx = [0, 10, 20, 30, 40].map((x, i) => placeFixture(scene, `L${i}`, lamp, x));
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 2 });
  const camera = { position: new V3(0, 0, 0) };

  rig.update(camera, 1, 0.05);
  assert.equal(rig._spotSlots[0].assignedRef, fx[0], 'fx[0] holds the slot to begin with');

  // Jump the camera to the far end: fx[0] is now rank 4, past the pool size
  // (1) plus SPOT_RANK_SLACK (2). It still may not be dropped until
  // SPOT_MIN_HOLD_MS has elapsed.
  camera.position.set(40, 0, 0);
  rig.update(camera, 1, 0.05);
  assert.equal(rig._spotSlots[0].assignedRef, fx[0],
    'the minimum hold time keeps the outgoing fixture even after it has clearly lost the ranking');

  // 1200ms of hold + 250ms of fade, with a margin.
  for (let i = 0; i < 40; i++) rig.update(camera, 1, 0.05);
  assert.equal(rig._spotSlots[0].assignedRef, fx[4], 'the nearest fixture eventually takes the slot over');
  assert.equal(rig.getFixtureSuppression().has('L0'), false, 'the outgoing fixture is no longer suppressing its pool');
});

test('the crossfade weight ramps to 1 and back to 0 over the expected dt budget', () => {
  const scene = new SceneStub();
  const g = placeFixture(scene, 'L1', DEFS_BY_ID.lamppost, 0);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 2 });
  const camera = { position: new V3(0, 0, 0) };
  const slot = rig._spotSlots[0];

  // SPOT_CROSSFADE_MS is 250; 50ms frames means five steps of 0.2.
  rig.update(camera, 1, 0.05);
  assert.ok(Math.abs(slot.weight - 0.2) < 1e-9, `one 50ms frame is one fifth of the ramp (got ${slot.weight})`);
  assert.equal(rig.getFixtureSuppression().get('L1'), slot.weight,
    'the published suppression weight is the same number the spot is scaled by — they must sum to constant');

  rig.update(camera, 1, 0.05);
  rig.update(camera, 1, 0.05);
  assert.ok(slot.weight > 0 && slot.weight < 1, `mid-fade the weight is strictly between 0 and 1 (got ${slot.weight})`);

  rig.update(camera, 1, 0.05);
  rig.update(camera, 1, 0.05);
  assert.equal(slot.weight, 1, 'five 50ms frames saturate the 250ms crossfade');
  rig.update(camera, 1, 0.05);
  assert.equal(slot.weight, 1, 'and it does not overshoot');
  assert.equal(rig.getFixtureSuppression().get('L1'), 1, 'a fully-faded-in spot fully suppresses its painted pool');

  // Now take the fixture away entirely. The slot must fade DOWN, not cut —
  // and must keep its fixture until the weight reaches 0, or the outgoing
  // fixture would be lit by neither system for the length of the fade.
  scene.remove(g);
  rig.markDirty();
  rig.update(camera, 1, 0.05);
  assert.ok(slot.weight > 0 && slot.weight < 1, `the released slot fades rather than cutting (got ${slot.weight})`);
  assert.equal(slot.assignedRef, g, 'and holds onto its outgoing fixture while it fades');

  for (let i = 0; i < 5; i++) rig.update(camera, 1, 0.05);
  assert.equal(slot.weight, 0, 'the weight reaches 0 within the same 250ms budget');
  assert.equal(slot.assignedRef, null, 'only then is the slot free again');
  assert.equal(slot.light.intensity, 0, 'and its light is off');
  assert.equal(rig.getFixtureSuppression().size, 0, 'nothing is suppressed, so every painted pool is back');
});

test('a spot is aimed, angled and thrown from the fixture def, not from module defaults', () => {
  const scene = new SceneStub();
  const flood = DEFS_BY_ID.floodLight;
  // dir 0 aims along +x (lighting-builder.js's authoring convention).
  const g = placeFixture(scene, 'F1', flood, 0, 0, 0);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 2 });
  rig.update({ position: new V3(0, 0, 0) }, 1, 0.05);

  const slot = rig._spotSlots[0];
  assert.equal(slot.light.distance, flood.light.radius,
    'throw distance comes from the def radius, so the real cone covers the patch of floor its painted pool would have');
  assert.ok(Math.abs(slot.light.angle - (flood.light.coneDeg * Math.PI / 180) / 2) < 1e-9,
    `the spot half-angle is half the def's full coneDeg (got ${slot.light.angle})`);
  assert.equal(slot.light.color.getHex(), flood.light.color, 'the def colour string is applied verbatim');
  assert.ok(slot.light.position.y > 0, 'the light sits at the emitter height above the group origin');

  // Aimed: tilted off vertical toward +x, so the target is BELOW and IN FRONT.
  assert.ok(slot.target.position.y < slot.light.position.y, 'an aimed flood still points downward overall');
  assert.ok(slot.target.position.x > slot.light.position.x,
    `and forward along its aim, matching the forward-pushed pool ellipse (target x ${slot.target.position.x})`);
  assert.ok(Math.abs(slot.target.position.z - slot.light.position.z) < 1e-9, 'with no sideways component at dir 0');

  // An overhead cone is a cone but NOT aimed — it must point straight down.
  const scene2 = new SceneStub();
  placeFixture(scene2, 'B1', DEFS_BY_ID.highBay, 3, 5, 1);
  const rig2 = new LightRig(scene2, { shadowSpotCount: 1, pointCount: 2 });
  rig2.update({ position: new V3(0, 0, 0) }, 1, 0.05);
  const s2 = rig2._spotSlots[0];
  assert.ok(Math.abs(s2.target.position.x - s2.light.position.x) < 1e-9
    && Math.abs(s2.target.position.z - s2.light.position.z) < 1e-9,
    'highBay (cone, but not aimed) points straight down regardless of the dir it was placed at');
});

// --- Task 5: the flash reserve --------------------------------------------

test('flash() claims a reserved point slot instead of stealing one from ambient glow', () => {
  const scene = new SceneStub();
  // Saturate ambient: more glow candidates than there are point slots.
  for (let i = 0; i < 10; i++) {
    const m = new Mesh(null, new MeshStandardMaterial({ emissive: new ColorStub(0x40e0ff) }));
    m.userData.role = 'glow';
    m.position.set(i, 0, 0);
    scene.add(m);
  }
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 8, flashReserve: 2 });
  const camera = { position: new V3(0, 0, 0) };
  rig.update(camera, 1, 0.016);

  const assignedBefore = rig._pointSlots.map((s) => s.assignedRef);
  assert.equal(assignedBefore.filter(Boolean).length, 6,
    'ambient glow fills pointCount - flashReserve slots and no more, even with candidates to spare');
  assert.ok(assignedBefore.slice(6).every((r) => r === null), 'the reserved tail is left idle for flashes');

  const light = rig.flash(new V3(0, 1, 0), 0xff8844, 30, 500);
  const slotIdx = rig._pointSlots.findIndex((s) => s.light === light);
  assert.ok(slotIdx >= 6, `the flash landed in the reserved tail (slot ${slotIdx})`);
  assert.equal(assignedBefore[slotIdx], null, 'the slot it took was not serving an ambient glow mesh — nothing was stolen');
  assert.equal(rig._pointSlots.slice(0, 6).filter((s) => s.assignedRef).length, 6,
    'every ambient light is still lit; an explosion did not darken the scene it is lighting');

  // The reserve is a floor, not a cap: enough simultaneous flashes still get
  // to outrank console glow.
  rig.flash(new V3(1, 1, 0), 0xff8844, 30, 500);
  const third = rig.flash(new V3(2, 1, 0), 0xff8844, 30, 500);
  assert.ok(third, 'a third concurrent flash still gets a light rather than being dropped');
  assert.equal(rig._pointSlots.filter((s) => s.flash).length, 3, 'three flashes are in flight, all in pre-allocated slots');
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
