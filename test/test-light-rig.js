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
// THREE is a CDN global in the browser; stubbed here (pattern lifted from
// test/test-utility-flow.js, which stubs the same two geometry classes
// LightRig needs — Vector3 and BoxGeometry — for the same reason: no browser,
// no real WebGL, just the proxy/light allocation math). LightRig itself
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
  multiplyScalar(s) { this._scale = s; return this; }
  getHex() { return this._raw; }
}

// lighting-builder.js's fixture builders (_buildLamppost etc.) only need
// these to not crash — the discovery test below builds a REAL fixture group,
// but never inspects a lamppost's vertex data, only its group transform.
class SimpleGeometry {
  constructor(...args) { this.args = args; }
  dispose() {}
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
    this.layers = { mask: 1, enable(n) { this.mask |= (1 << n); } };
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
class MeshBasicMaterial extends MeshStandardMaterial {}

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
  MeshBasicMaterial,
  BoxGeometry,
  CylinderGeometry: SimpleGeometry,
  ConeGeometry: SimpleGeometry,
  TorusGeometry: SimpleGeometry,
  SpotLight,
  PointLight,
  AdditiveBlending: 2,
};

const { LightRig } = await import('../src/renderer3d/light-rig.js');
const { fixtureLightTag } = await import('../src/renderer3d/lighting-builder.js');
const { fixtureLightProjection, aimYaw } = await import('../src/renderer3d/fixture-light-math.js');
const { fixtureDynamicFactor } = await import('../src/renderer3d/light-dynamics.js');
const { LIGHTING_DEFS } = await import('../src/data/placeables/lighting.js');
const DEF = Object.fromEntries(LIGHTING_DEFS.map((d) => [d.id, d]));

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

test('quality changes park fixed slots and shadow refreshes obey the configured frame budget', () => {
  const scene = new SceneStub();
  for (let i = 0; i < 6; i++) placeFixture(scene, `Q${i}`, DEF.lamppost, i, 0);
  const rig = new LightRig(scene, {
    shadowSpotCount: 6, activeShadowSpotCount: 4, pointCount: 1, shadowHz: 30,
  });
  const additions = scene.addCalls;
  const camera = { position: new V3(0, 0, 0) };

  rig.update(camera, 1, 1);
  assert.equal(rig._spotSlots.filter((s) => s.light.shadow.needsUpdate).length, 1,
    'new assignments refresh at most one fixture shadow map per frame');
  assert.equal(rig.getStats().activeFixtureShadows, 4);

  rig.setQuality({ fixtureShadowCount: 2, fixtureShadowMapSize: 512, fixtureShadowHz: 10 });
  rig.update(camera, 1, 0.016);
  assert.equal(scene.addCalls, additions, 'changing quality never changes scene light topology');
  assert.equal(rig._spotSlots.slice(2).every((s) => s.light.intensity === 0 && s.assignedRef === null), true,
    'slots above the preset budget are fully parked');
  assert.equal(rig._spotSlots.every((s) => s.light.shadow.mapSize.width === 512), true,
    'the preset shadow-map resolution is applied to every pooled slot');
  assert.equal(rig._spotSlots.slice(0, 2).every((s) => s.light.shadow.intensity === 1), true,
    'the active shadow subset retains full shadow contribution');
  assert.equal(rig._spotSlots.slice(2).every((s) => s.light.shadow.intensity === 0), true,
    'parked shadow-capable slots cannot sample stale shadow layers');

  rig.setQuality({ fixtureShadowCount: 0, fixtureShadowHz: 0 });
  rig.update(camera, 1, 1);
  assert.equal(rig._spotSlots.some((s) => s.light.shadow.needsUpdate), false,
    'low quality performs no local shadow refreshes');
  assert.equal(rig.getFixtureSuppression().size, 0,
    'painted pools return when all real fixture slots are parked');
});

test('camera motion defers fixture shadow renders without discarding the queue', () => {
  const scene = new SceneStub();
  placeFixture(scene, 'motion-shadow', DEF.lamppost, 0, 0);
  const rig = new LightRig(scene, {
    shadowSpotCount: 1, activeShadowSpotCount: 1, pointCount: 1, shadowHz: 30,
  });
  const camera = { position: new V3(0, 0, 0) };

  rig.update(camera, 1, 1, null, null, {
    freezeAssignment: true,
    deferShadows: true,
  });
  assert.equal(rig.getStats().shadowUpdatesLastFrame, 0,
    'camera motion schedules no facility shadow render');
  assert.equal(rig._spotSlots[0].light.shadow.needsUpdate, false);

  rig.update(camera, 1, 1);
  assert.equal(rig.getStats().shadowUpdatesLastFrame, 1,
    'the deferred dirty shadow refreshes after the camera settles');
  assert.equal(rig._spotSlots[0].light.shadow.needsUpdate, true);
});

test('real-light and shadow budgets remain independent at every quality tier', () => {
  const scene = new SceneStub();
  for (let i = 0; i < 40; i++) placeFixture(scene, `tier-${i}`, DEF.ceilingPanel, i, 0);
  const rig = new LightRig(scene, {
    fixtureLightCount: 64,
    activeFixtureLightCount: 16,
    shadowSpotCount: 24,
    activeShadowSpotCount: 0,
    pointCount: 1,
  });
  const camera = { position: new V3(0, 8, 0) };
  rig.update(camera, 1, 1);
  assert.equal(rig.getStats().assignedFixtureLights, 16,
    'low quality does not inherit the larger immutable shadow topology');
  assert.equal(rig.getStats().assignedFixtureShadows, 0);
  assert.equal(rig._spotSlots.slice(0, 16).every((s) => s.light.shadow.intensity === 0), true);

  rig.setQuality({ fixtureLightCount: 32, fixtureShadowCount: 6 });
  rig.update(camera, 1, 1);
  assert.equal(rig.getStats().assignedFixtureLights, 32);
  assert.equal(rig.getStats().assignedFixtureShadows, 6);
  assert.equal(rig._spotSlots.slice(0, 6).every((s) => s.light.shadow.intensity === 1), true);
  assert.equal(rig._spotSlots.slice(6, 24).every((s) => s.light.shadow.intensity === 0), true);
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

test('production fixture registry drives real spots without a legacy scene tag', () => {
  const scene = new SceneStub();
  const group = new Group();
  group.position.set(6, 0, 2);
  group.rotation.y = -Math.PI / 2;
  scene.add(group);

  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 1 });
  rig.setFixtureRegistry([{ id: 'registry-flood', def: DEF.floodLight, group }]);
  rig.update({ position: new V3(0, 0, 0) }, 1, 1);

  const slot = rig._spotSlots[0];
  assert.equal(slot.assignedRef.id, 'registry-flood', 'the untagged registry fixture receives the real spot');
  assert.equal(rig.getFixtureSuppression().get('registry-flood'), 1,
    'the same fixture id suppresses its painted pool');
  assert.ok(slot.target.position.z > slot.light.position.z,
    'the spot follows the rendered group rotation instead of assuming dir=0');
});

test('stationary fixture ranking and settled pool suppression stay cached', () => {
  const scene = new SceneStub();
  const group = new Group();
  group.position.set(4, 0, 3);
  scene.add(group);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 1 });
  rig.setFixtureRegistry([{ id: 'cached-flood', def: DEF.floodLight, group }]);
  const camera = { position: new V3(0, 0, 0) };

  rig.update(camera, 1, 1);
  const ranked = rig._fixtureRankCache;
  const suppressionRevision = rig.getFixtureSuppressionRevision();
  rig.update(camera, 1, 0.016);

  assert.equal(rig._fixtureRankCache, ranked,
    'an unchanged camera/focus reuses the ranked fixture array');
  assert.equal(rig.getFixtureSuppressionRevision(), suppressionRevision,
    'a settled suppression map does not publish a false change every frame');

  camera.position.x = 2;
  rig.update(camera, 1, 0.016);
  assert.notEqual(rig._fixtureRankCache, ranked,
    'moving the focus invalidates the ranking cache immediately');
});

test('a large many-light pool selects 64 real fixtures and shadows its nearest 24', () => {
  const scene = new SceneStub();
  const fixtures = [];
  for (let i = 0; i < 80; i++) {
    const group = new Group();
    group.position.set(i % 10, 4, Math.floor(i / 10));
    scene.add(group);
    fixtures.push({ id: `dense-${i}`, def: DEF.ceilingPanel, group });
  }

  const rig = new LightRig(scene, {
    fixtureLightCount: 64,
    activeFixtureLightCount: 64,
    shadowSpotCount: 24,
    activeShadowSpotCount: 24,
    pointCount: 16,
  });
  const topologyAdds = scene.addCalls;
  rig.setFixtureRegistry(fixtures);
  rig.update({ position: new V3(0, 8, 0) }, 1, 1, new V3(0, 0, 0));

  const stats = rig.getStats();
  assert.equal(stats.assignedFixtureLights, 64);
  assert.equal(stats.assignedFixtureShadows, 24);
  assert.equal(rig.getFixtureSuppression().size, 64,
    'all selected analytic lights suppress their corresponding painted fallback');
  assert.equal(scene.addCalls, topologyAdds,
    'dense selection only rewrites pooled GPU data; it never changes scene topology');
  assert.equal(rig._spotSlots.slice(24).every((slot) => !slot.light.castShadow), true,
    'the batched tail remains real PBR lighting without multiplying shadow passes');
});

// --- Spot handover: hysteresis, crossfade, and pool suppression ------------
//
// There are far more fixtures than shadow spots, so the spots are an LOD over
// the painted floor pools every fixture already has. Everything below guards
// the two ways that LOD can look broken to a player: STROBING (a spot swapping
// back and forth between two fixtures at nearly equal camera distance, each
// swap popping a painted pool off and another on) and a DARK GAP (a fixture
// suppressed while its real light hasn't faded in yet, or vice versa).
//
// All of it runs on the rig's internal _clockMs, advanced by the dt handed to
// update() — never performance.now(). That's what makes a 1200 ms minimum hold
// and a 250 ms crossfade assertable in a unit test with no timers at all.

function placeFixture(scene, id, def, x, z, dir = 0) {
  const g = new Group();
  g.position.set(x, 0, z);
  g.userData.lightFixture = fixtureLightTag(def, { id, dir });
  scene.add(g);
  return g;
}

test('hidden LOD owners do not retain real fixture or glow lights', () => {
  const scene = new SceneStub();
  const detailOwner = new Group();
  const fixture = new Group();
  const glow = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshStandardMaterial());
  glow.userData.role = 'glow';
  glow.userData.ambientLight = { intensity: 1, distance: 2 };
  detailOwner.add(fixture);
  detailOwner.add(glow);
  scene.add(detailOwner);
  detailOwner.visible = false;

  const rig = new LightRig(scene, {
    shadowSpotCount: 1, pointCount: 1, flashReserve: 0,
  });
  rig.setFixtureRegistry([{ id: 'hidden-fixture', def: DEF.lamppost, group: fixture }]);
  rig.update({ position: new V3(0, 0, 0) }, 1, 0.25);
  assert.equal(rig._spotSlots[0].assignedRef, null,
    'a registry fixture beneath a hidden detailed group cannot claim a shadow spot');
  assert.equal(rig._pointSlots[0].assignedRef, null,
    'a glow mesh beneath a hidden detailed group cannot claim a point light');

  detailOwner.visible = true;
  rig.markDirty();
  rig.update({ position: new V3(0, 0, 0) }, 1, 0.25);
  assert.ok(rig._spotSlots[0].assignedRef,
    'the authored fixture becomes eligible again when detail returns');
  assert.ok(rig._pointSlots[0].assignedRef,
    'the authored glow becomes eligible again when detail returns');
  rig.dispose();
});

test('a fixture at the rank boundary never strobes: no slot swap across 120 oscillating frames', () => {
  const scene = new SceneStub();
  // Two fixtures a hair apart, and one spot to fight over.
  const a = placeFixture(scene, 'A', DEF.lamppost, 0, 0);
  const b = placeFixture(scene, 'B', DEF.lamppost, 0.2, 0);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 2 });

  const camera = { position: new V3(-5, 0, 0) };
  rig.update(camera, 1, 0.016);
  const first = rig._spotSlots[0].assignedRef;
  assert.ok(first === a || first === b, 'one of the two fixtures takes the only spot');

  // Oscillate the camera across the midpoint every frame — naive
  // nearest-N ranking would flip the winner on literally every frame. 120
  // frames at 16 ms is ~1.9 s, comfortably past SPOT_MIN_HOLD_MS, so this is
  // not the min-hold timer doing the work: it's the rank slack.
  let swaps = 0;
  let prev = first;
  for (let i = 0; i < 120; i++) {
    camera.position.set(i % 2 === 0 ? 5 : -5, 0, 0);
    rig.update(camera, 1, 0.016);
    if (rig._spotSlots[0].assignedRef !== prev) swaps++;
    prev = rig._spotSlots[0].assignedRef;
  }
  assert.equal(swaps, 0, 'the incumbent keeps the spot for all 120 frames — ordering jitter inside the slack band is not a demotion');
  assert.ok(rig._clockMs > 1200, 'sanity: the run really did outlast the minimum hold, so slack (not tenure) is what held the spot');

  // And the pool it suppresses is exactly the fixture it holds — never both.
  const supp = rig.getFixtureSuppression();
  const heldId = prev.userData.lightFixture.id;
  assert.equal(supp.size, 1, 'exactly one fixture is suppressed — the one holding the real spot');
  assert.equal(supp.get(heldId), 1, 'a fully faded-in spot suppresses its own pool completely');
  const otherId = prev === a ? 'B' : 'A';
  assert.equal(supp.get(otherId), undefined, 'the fixture WITHOUT a spot keeps its painted pool at full strength');
});

test('fixture allocation ranks around the viewed focus, not the offset isometric camera', () => {
  const scene = new SceneStub();
  const centered = placeFixture(scene, 'CENTER', DEF.lamppost, 0, 0);
  placeFixture(scene, 'BEHIND_CAMERA', DEF.lamppost, 50, 50);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 1 });
  const camera = { position: new V3(50, 40, 50) };

  rig.update(camera, 1, 1, new V3(0, 0, 0));
  assert.equal(rig._spotSlots[0].assignedRef, centered,
    'the fixture at screen center wins even though another fixture is much closer to camera.position');
});

test('a decisive demotion does hand the spot over, once the minimum hold and the crossfade have both elapsed', () => {
  const scene = new SceneStub();
  const near = placeFixture(scene, 'A', DEF.lamppost, 0, 0);
  placeFixture(scene, 'B', DEF.lamppost, 10, 0);
  placeFixture(scene, 'C', DEF.lamppost, 20, 0);
  placeFixture(scene, 'D', DEF.lamppost, 30, 0);
  const far = placeFixture(scene, 'E', DEF.lamppost, 40, 0);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 2 });

  const camera = { position: new V3(0, 0, 0) };
  rig.update(camera, 1, 0.05);
  assert.equal(rig._spotSlots[0].assignedRef, near, 'the nearest fixture takes the spot');

  // Jump the camera to the far end. `near` is now 5th of 5 — well outside
  // the top 1 + slack 2 band — but its tenure is only 50 ms so far.
  camera.position.set(40, 0, 0);
  rig.update(camera, 1, 0.05);
  assert.equal(rig._spotSlots[0].assignedRef, near,
    'a genuine demotion still waits out the minimum hold — a fixture cannot be picked up and dropped inside one gesture');

  // Run out the hold (1200 ms), then the outgoing 250 ms fade, then the
  // incoming one.
  for (let i = 0; i < 45; i++) rig.update(camera, 1, 0.05); // +2250 ms
  assert.equal(rig._spotSlots[0].assignedRef, far,
    'once the hold expired and the outgoing fade finished, the spot really does move to the fixture that deserves it');
  assert.ok(rig._spotSlots[0].weight > 0.99, 'and the new holder has faded back in');

  const supp = rig.getFixtureSuppression();
  assert.equal(supp.get('E'), rig._spotSlots[0].weight, 'suppression tracks the winner');
  assert.equal(supp.get('A'), undefined, 'the demoted fixture\'s painted pool is fully back — it is no longer lit for real');
});

test('a demolished fixture releases its spot immediately, without serving out the minimum hold', () => {
  // The minimum hold damps churn in the RANKING. It must not apply to a
  // fixture that has left the scene: waiting it out would hang a lit spot in
  // the air at a demolished lamppost's last position for over a second.
  const scene = new SceneStub();
  const lamp = placeFixture(scene, 'A', DEF.lamppost, 0, 0);
  const spare = placeFixture(scene, 'B', DEF.lamppost, 30, 0);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 2 });

  const camera = { position: new V3(0, 0, 0) };
  rig.update(camera, 1, 0.05);
  assert.equal(rig._spotSlots[0].assignedRef, lamp, 'the near lamppost holds the spot');
  assert.ok(rig.getFixtureSuppression().get('A') > 0, 'and its painted pool is suppressed');

  // Demolish it: out of the scene, and tell the rig the world changed. Only
  // 50 ms of its 1200 ms tenure has elapsed.
  scene.remove(lamp);
  rig.markDirty();
  rig.update(camera, 1, 0.05);
  assert.equal(rig._spotSlots[0].releasing, true,
    'the slot starts releasing on the very next frame, not after SPOT_MIN_HOLD_MS');

  // Let only the 250 ms crossfade run — far short of the 1200 ms hold.
  for (let i = 0; i < 6; i++) rig.update(camera, 1, 0.05);   // +300 ms
  assert.equal(rig._spotSlots[0].assignedRef, spare,
    'the freed slot moves to the surviving fixture well inside the minimum hold');
  assert.equal(rig.getFixtureSuppression().get('A'), undefined,
    'and the demolished fixture no longer suppresses anything');
});

test('the crossfade takes exactly five 50 ms frames each way, and the slot holds its fixture for the whole fade-out', () => {
  const scene = new SceneStub();
  const lamp = placeFixture(scene, 'A', DEF.lamppost, 0, 0);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 2 });
  const camera = { position: new V3(0, 0, 0) };
  const slot = () => rig._spotSlots[0];

  // Fade IN: SPOT_CROSSFADE_MS is 250, so 50 ms frames land on 0.2 steps.
  for (let i = 1; i <= 5; i++) {
    rig.update(camera, 1, 0.05);
    if (i < 5) {
      assert.ok(slot().weight > 0 && slot().weight < 1,
        `frame ${i} of the fade-in is partway (got ${slot().weight}) — the handover is a ramp, not a pop`);
      assert.equal(rig.getFixtureSuppression().get('A'), slot().weight,
        'the pool is suppressed by EXACTLY the weight the real light is faded in by — the two are complementary at every instant, so the fixture is never double-lit and never dark');
    }
  }
  assert.equal(slot().weight, 1, 'five 50 ms frames reach exactly 1, not 0.9999');

  // Run out the minimum hold, then take the fixture out of the world so the
  // slot has to let go.
  for (let i = 0; i < 30; i++) rig.update(camera, 1, 0.05);
  assert.equal(slot().weight, 1, 'a steady incumbent stays pinned at full weight');
  scene.remove(lamp);
  rig.markDirty();

  // Fade OUT: the slot must keep holding `lamp` the whole way down. If it
  // dropped the reference at the moment of eviction, the fixture would have
  // no real light AND (for one frame) a suppressed pool — a visible dropout.
  const seen = [];
  for (let i = 1; i <= 5; i++) {
    rig.update(camera, 1, 0.05);
    seen.push(slot().weight);
    assert.equal(slot().assignedRef, lamp, `frame ${i} of the fade-out still holds the outgoing fixture`);
  }
  assert.ok(seen.slice(0, 4).every((w, i) => w > 0 && w < (i === 0 ? 1.0001 : seen[i - 1] + 1e-9)),
    `the fade-out is monotonically decreasing and stays positive until the end (got ${seen.join(', ')})`);
  assert.equal(seen[4], 0, 'and lands on exactly 0 after five frames — float dust is snapped off, or the slot would never free');
  assert.equal(slot().light.intensity, 0, 'a zero-weight spot contributes no light');

  rig.update(camera, 1, 0.05);
  assert.equal(slot().assignedRef, null, 'the frame after the fade completes, the slot is genuinely free for someone else');
  assert.equal(rig.getFixtureSuppression().size, 0, 'and nothing is suppressed — every pool is painted again');
});

test('a spot is aimed, angled, throttled and tinted by the fixture def itself, not by generic constants', () => {
  // --- floodLight: a ground-mounted AIMED cone ---
  const scene = new SceneStub();
  placeFixture(scene, 'F1', DEF.floodLight, 2, 3, 0); // dir 0 => aim along +x
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 1 });
  rig.update({ position: new V3(0, 0, 0) }, 1, 1); // dt 1 s: straight to full weight

  const spot = rig._spotSlots[0];
  const light = spot.light;
  const expectedFlood = fixtureLightProjection(DEF.floodLight, {
    origin: { x: 2, y: 0, z: 3 }, yaw: aimYaw(0),
  });
  assert.equal(spot.weight, 1, 'a long frame clamps the crossfade at 1 rather than overshooting');
  assert.equal(light.distance, expectedFlood.distance,
    'throw reaches the farthest point in the shared cone/ground projection');
  assert.ok(Math.abs(light.angle - expectedFlood.halfAngle) < 1e-9,
    `SpotLight.angle comes from the shared projection packet (got ${light.angle})`);
  assert.equal(light.color.getHex(), DEF.floodLight.light.color, 'the light is tinted with the def\'s own colour string');
  const dynamic = fixtureDynamicFactor('arcStable', 'F1', 1000, 1);
  assert.ok(Math.abs(light.intensity - 6 * DEF.floodLight.light.intensity * dynamic) < 1e-9,
    `intensity includes the fixture's deterministic dynamic profile (got ${light.intensity})`);
  assert.ok(Math.abs(light.position.y - DEF.floodLight.light.emitterY) < 1e-9,
    'the light sits at the emitter height above the fixture group\'s origin');

  // Aim: down AND forward along +x. Forward matters because poolFootprint
  // pushes the painted ellipse forward too — a spot that pointed straight
  // down would light a different patch of floor than the pool it suppresses.
  assert.ok(spot.target.position.y < light.position.y, 'an aimed flood still points downward overall');
  assert.ok(spot.target.position.x > light.position.x, 'and forward along its aim, matching where its pool ellipse is painted');
  assert.ok(Math.abs(spot.target.position.z - light.position.z) < 1e-9, 'with no sideways drift for dir=0');

  // Rotating the fixture rotates the aim with it.
  const scene2 = new SceneStub();
  // dir 1 => yaw -90°, which lighting-builder.js's _aimVector reads as +z
  // (x = cos(yaw) = 0, z = -sin(yaw) = +1). The rig must agree with THAT
  // convention, not with intuition, or the cone and the painted ellipse end
  // up on opposite sides of the fixture.
  placeFixture(scene2, 'F2', DEF.floodLight, 0, 0, 1);
  const rig2 = new LightRig(scene2, { shadowSpotCount: 1, pointCount: 1 });
  rig2.update({ position: new V3(0, 0, 0) }, 1, 1);
  const t2 = rig2._spotSlots[0].target.position;
  assert.ok(Math.abs(t2.x) < 1e-9 && t2.z > 0,
    `dir=1 swings the aim onto +z, matching poolFootprint's own aim vector (got x=${t2.x}, z=${t2.z})`);

  // --- highBay: a cone that is NOT aimed (overhead, points straight down) ---
  const scene3 = new SceneStub();
  placeFixture(scene3, 'H1', DEF.highBay, 5, 5, 2);
  const rig3 = new LightRig(scene3, { shadowSpotCount: 1, pointCount: 1 });
  rig3.update({ position: new V3(0, 0, 0) }, 1, 1);
  const bay = rig3._spotSlots[0];
  const expectedBay = fixtureLightProjection(DEF.highBay, {
    origin: { x: 5, y: 0, z: 5 }, yaw: aimYaw(2),
  });
  assert.ok(Math.abs(bay.light.angle - expectedBay.halfAngle) < 1e-9,
    'highBay angle is derived from emitter height and desired floor radius');
  assert.ok(Math.abs(bay.target.position.x - bay.light.position.x) < 1e-9
    && Math.abs(bay.target.position.z - bay.light.position.z) < 1e-9,
    'an overhead cone points STRAIGHT down regardless of dir — it has no aim to follow');
  assert.ok(bay.target.position.y < bay.light.position.y, 'down, not up');
  assert.ok(Math.abs(bay.light.position.y - DEF.highBay.light.sourceOffsetY) < 1e-9,
    'an overhead fixture emits from its visible diffuser below the ceiling attachment');
});

test('the flash reserve keeps idle point slots back, so an explosion never has to darken a lit console', () => {
  const scene = new SceneStub();
  // Eight glow meshes for eight point lights: without a reserve, the ambient
  // pass would claim every slot and a flash would have to steal a lit one.
  for (let i = 0; i < 8; i++) {
    const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ emissive: new ColorStub(0x00ff00) }));
    m.position.set(i, 0, 0);
    m.userData.role = 'glow';
    scene.add(m);
  }
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 8, flashReserve: 2 });
  rig.update({ position: new V3(0, 0, 0) }, 1, 0.016);

  const lit = rig._pointSlots.filter((s) => s.light.intensity > 0);
  assert.equal(lit.length, 6, 'ambient glow claims pointCount - flashReserve slots and no more');
  const pointStats = rig.getStats();
  assert.equal(pointStats.allocatedPointLights, 8);
  assert.equal(pointStats.ambientPointLightCapacity, 6);
  assert.equal(pointStats.assignedAmbientPointLights, 6);
  assert.equal(pointStats.activePointFlashes, 0);
  const litBefore = rig._pointSlots.map((s) => s.light.intensity);

  const flashed = rig.flash(new V3(0, 0, 0), 0xff8844, 30, 500);
  const flashIdx = rig._pointSlots.findIndex((s) => s.light === flashed);
  assert.ok(flashIdx >= 6, `the flash claimed a RESERVED slot (index ${flashIdx}), not one of the six ambient ones`);
  for (let i = 0; i < 6; i++) {
    assert.equal(rig._pointSlots[i].light.intensity, litBefore[i],
      `ambient slot ${i} is completely undisturbed by the flash`);
  }
  assert.equal(flashed.intensity, 30, 'and the flash itself is lit');
  assert.equal(rig.getStats().activePointFlashes, 1,
    'runtime lighting stats expose reserved flash utilization');

  // Saturating the reserve is the only thing that lets a flash spill into the
  // ambient band — at which point stealing a console is the correct trade.
  rig.flash(new V3(1, 0, 0), 0xff8844, 30, 500);
  const third = rig.flash(new V3(2, 0, 0), 0xff8844, 30, 500);
  const thirdIdx = rig._pointSlots.findIndex((s) => s.light === third);
  assert.ok(thirdIdx < 6, `with the reserve saturated the third flash spills into the ambient band (index ${thirdIdx})`);
});

test('moving effect proxies use the fixed point pool without pan-induced reassignment', () => {
  const scene = new SceneStub();
  const rig = new LightRig(scene, {
    shadowSpotCount: 0, pointCount: 5, flashReserve: 2,
  });
  const proxies = [];
  for (let i = 0; i < 10; i++) {
    const proxy = new Group();
    proxy.position.set(i * 2, 0.2, 0);
    proxy.userData.effectLightEmitter = {
      color: '#4488ff', intensity: 0.5, distance: 3, preScaled: true,
    };
    proxies.push(proxy);
  }
  rig.setEffectEmitterRegistry(proxies);
  const additions = scene.addCalls;
  const camera = { position: new V3(0, 4, 0) };

  rig.update(camera, 0, 0.016, new V3(4, 0, 0));
  const assigned = rig._pointSlots.slice(0, 3).map((slot) => slot.assignedRef);
  assert.ok(assigned.every(Boolean), 'all non-reserved slots claim moving effect emitters');
  assert.ok(rig._pointSlots.slice(0, 3).every((slot) => slot.light.intensity > 0),
    'pre-scaled effect lights remain visible during daylight');

  rig.update(camera, 0, 0.016, new V3(5, 0, 0));
  assert.deepEqual(rig._pointSlots.slice(0, 3).map((slot) => slot.assignedRef), assigned,
    'a small pan stays inside the rank slack instead of swapping lights');
  assert.equal(scene.addCalls, additions, 'animation and panning never allocate another THREE light');
});

test('a camera animation holds the fixture assignment, and releasing it re-ranks immediately', () => {
  // Ranking reads the camera frustum, so a Q/E rotation reshuffles it on every
  // frame of the sweep. Each reshuffle starts crossfades and churns the shadow
  // assignment keys, which forces fixture shadow refreshes on back-to-back
  // frames — cost spent on a view the player is not looking at yet, landing on
  // the frames least able to afford it. ThreeRenderer passes freezeAssignment
  // while _viewRotating / _snapping / _freeOrbiting is set.
  const scene = new SceneStub();
  // Five fixtures, as in the demotion test above: with only two, the loser
  // never leaves the top-1 + slack-2 band and no handover would happen even
  // without a hold, so the test would prove nothing.
  const near = placeFixture(scene, 'A', DEF.lamppost, 0, 0);
  placeFixture(scene, 'B', DEF.lamppost, 10, 0);
  placeFixture(scene, 'C', DEF.lamppost, 20, 0);
  placeFixture(scene, 'D', DEF.lamppost, 30, 0);
  const far = placeFixture(scene, 'E', DEF.lamppost, 40, 0);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 2 });

  const camera = { position: new V3(0, 0, 0) };
  for (let i = 0; i < 40; i++) rig.update(camera, 1, 0.05);  // settle past the hold
  assert.equal(rig._spotSlots[0].assignedRef, near, 'the nearest fixture holds the spot');

  // Sweep the camera the way a rotation does, but with the hold applied.
  camera.position.set(40, 0, 0);
  for (let i = 0; i < 60; i++) {
    rig.update(camera, 1, 0.05, null, null, { freezeAssignment: true });
  }
  assert.equal(rig._spotSlots[0].assignedRef, near,
    'three seconds of camera motion cannot move the assignment while the hold is on');
  assert.equal(rig._spotSlots[0].releasing, false, 'and no handover was even started');

  // Releasing the hold — an animation ending, or being interrupted — must
  // re-rank on the very next frame. Nothing latches.
  for (let i = 0; i < 45; i++) rig.update(camera, 1, 0.05);
  assert.equal(rig._spotSlots[0].assignedRef, far,
    'the ranking catches up as soon as the camera settles');
});

test('a held assignment still tracks its fixture and still finishes an in-flight crossfade', () => {
  // The hold skips RANKING, not the crossfade: freezing the fade instead would
  // leave the rig visibly mid-handover for the length of the animation.
  const scene = new SceneStub();
  const lamp = placeFixture(scene, 'A', DEF.lamppost, 0, 0);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 2 });
  const camera = { position: new V3(0, 0, 0) };

  rig.update(camera, 1, 0.05);
  const partway = rig._spotSlots[0].weight;
  assert.ok(partway > 0 && partway < 1, 'the fade is in flight');

  for (let i = 0; i < 6; i++) {
    rig.update(camera, 1, 0.05, null, null, { freezeAssignment: true });
  }
  assert.ok(rig._spotSlots[0].weight > 0.99, 'the crossfade completed under the hold');
  assert.equal(rig._spotSlots[0].assignedRef, lamp);
  assert.ok(rig.getFixtureSuppression().get('A') > 0.99,
    'and the paired pool suppression was published, so the fixture is not double-bright');
});

test('a fixture leaving the world overrides the camera-animation hold', () => {
  // A hold must never outlast a demolition: a light burning over a lamppost
  // the player just knocked down is worse than any amount of ranking churn.
  const scene = new SceneStub();
  const lamp = placeFixture(scene, 'A', DEF.lamppost, 0, 0);
  const spare = placeFixture(scene, 'B', DEF.lamppost, 30, 0);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 2 });
  const camera = { position: new V3(0, 0, 0) };

  rig.update(camera, 1, 0.05);
  assert.equal(rig._spotSlots[0].assignedRef, lamp);

  scene.remove(lamp);
  rig.markDirty();
  rig.update(camera, 1, 0.05, null, null, { freezeAssignment: true });
  assert.equal(rig._spotSlots[0].releasing, true,
    'the demolished fixture releases its spot mid-rotation, hold or no hold');

  // The release fades out under the hold, so nothing is left burning in the
  // air over the demolished lamppost — which is the property that matters.
  for (let i = 0; i < 6; i++) {
    rig.update(camera, 1, 0.05, null, null, { freezeAssignment: true });
  }
  assert.equal(rig._spotSlots[0].light.intensity, 0, 'the orphaned light is dark');
  assert.ok(!(rig.getFixtureSuppression().get('A') > 0),
    'and it no longer suppresses a painted pool (the slot publishes weight 0 until it is reassigned)');

  // Refilling the freed slot is ranking work, so it waits for the camera to
  // settle — one animation's worth of latency, not a stuck state.
  rig.update(camera, 1, 0.05);
  assert.equal(rig._spotSlots[0].assignedRef, spare,
    'the slot is reassigned on the first frame after the animation ends');
});

test('one dirty fixture refreshes one shadow layer, not every live layer', () => {
  // The shared fixture shadow array used to collapse onto a single scheduler
  // slot, so any reassignment marked all twelve layers dirty and the array
  // re-rendered the facility once per layer. Each layer owns its own slot now.
  const scene = new SceneStub();
  for (let i = 0; i < 8; i++) placeFixture(scene, `F${i}`, DEF.lamppost, i * 3, 0);
  const rig = new LightRig(scene, {
    shadowSpotCount: 6,
    pointCount: 2,
    shadowHz: 1000,                 // every slot is always due
    shadowUpdatesPerFrame: 2,
  });
  const camera = { position: new V3(0, 0, 0) };

  let sawOverBudget = 0;
  for (let i = 0; i < 40; i++) {
    rig.update(camera, 1, 0.05);
    const dirty = rig._spotSlots
      .slice(0, 6)
      .filter((slot) => slot.light.shadow.needsUpdate).length;
    if (dirty > 2) sawOverBudget++;
  }
  assert.equal(sawOverBudget, 0,
    'no frame ever schedules more shadow layers than fixtureShadowUpdatesPerFrame allows');
});

test('dusk does not turn the daylight shadow backlog into consecutive render passes', () => {
  const scene = new SceneStub();
  for (let i = 0; i < 12; i++) placeFixture(scene, `dusk-${i}`, DEF.lamppost, i * 2, 0);
  const rig = new LightRig(scene, {
    shadowSpotCount: 12,
    activeShadowSpotCount: 12,
    pointCount: 1,
    shadowHz: 15,
    shadowUpdatesPerFrame: 1,
  });
  const camera = { position: new V3(0, 0, 0) };

  rig.update(camera, 0, 1);
  assert.equal(rig.getStats().fixtureShadowQueuePending, 0,
    'daylight keeps dark fixture slots out of the active shadow queue');

  const scheduledFrames = [];
  for (let frame = 0; frame < 80; frame++) {
    rig.update(camera, 0.2, 0.016);
    if (rig.getStats().shadowUpdatesLastFrame) scheduledFrames.push(frame);
    if (rig.getStats().fixtureShadowQueuePending === 0 && scheduledFrames.length >= 12) break;
  }

  assert.equal(scheduledFrames[0], 0, 'dusk refreshes one shadow promptly');
  assert.equal(scheduledFrames.length, 12, 'every newly lit fixture shadow eventually refreshes');
  assert.ok(scheduledFrames.slice(1).every((frame, index) =>
    frame - scheduledFrames[index] >= 4),
    'the remaining full-scene passes obey the 15 Hz queue cadence');
});
