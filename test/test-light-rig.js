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

// Not full color math, but enough of it: r/g/b (0..1) are needed by
// lighting-builder.js's buildLightPools, which reads them directly off a
// THREE.Color to bake vertex colors. getHex() keeps returning whatever was
// last passed to set() (numeric or CSS-string) unconverted — existing tests
// below assert against that raw value, never a real RGB conversion.
class ColorStub {
  constructor(c) { this._raw = undefined; this.r = 0; this.g = 0; this.b = 0; if (c !== undefined) this.set(c); }
  set(c) {
    this._raw = c;
    const hex = typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : c;
    this.r = ((hex >> 16) & 0xff) / 255;
    this.g = ((hex >> 8) & 0xff) / 255;
    this.b = (hex & 0xff) / 255;
    return this;
  }
  copy(o) { this._raw = o._raw; this.r = o.r; this.g = o.g; this.b = o.b; return this; }
  getHex() { return this._raw; }
}

// lighting-builder.js's fixture builders (_buildLamppost etc.) only need
// these to not crash — no vertex data is ever inspected for a lamppost's
// geometry in this suite, just group.position/rotation.
class SimpleGeometry {
  constructor(...args) { this.args = args; }
  dispose() {}
}

// buildLightPools' merged mesh — real enough to exercise applyPoolSuppression
// against actual attribute arrays, not a hand-rolled stand-in.
class BufferGeometryStub {
  constructor() { this.attributes = {}; this.index = null; }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  setIndex(idx) { this.index = idx; return this; }
  dispose() {}
}
class Float32BufferAttributeStub {
  constructor(arr, itemSize) {
    this.array = arr instanceof Float32Array ? arr : new Float32Array(arr);
    this.itemSize = itemSize;
    this.needsUpdate = false;
  }
}
class MeshBasicMaterial {
  constructor(opts = {}) { Object.assign(this, opts); this.userData = {}; }
  dispose() {}
}
class CanvasTexture {
  constructor(canvas) { this.canvas = canvas; }
  dispose() {}
}

// _glowTexture() (lighting-builder.js) calls document.createElement('canvas')
// once, module-lifetime-cached — a minimal fake 2D context is enough since
// nothing here ever inspects the drawn gradient.
globalThis.document = globalThis.document || {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error(`unstubbed document.createElement(${tag})`);
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        fillStyle: null,
      }),
    };
  },
};

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
  MeshBasicMaterial,
  BoxGeometry,
  CylinderGeometry: SimpleGeometry,
  ConeGeometry: SimpleGeometry,
  TorusGeometry: SimpleGeometry,
  BufferGeometry: BufferGeometryStub,
  Float32BufferAttribute: Float32BufferAttributeStub,
  CanvasTexture,
  SpotLight,
  PointLight,
  AdditiveBlending: 2,
};

const { LightRig } = await import('../src/renderer3d/light-rig.js');
const { buildLightFixture, buildLightPools, applyPoolSuppression } =
  await import('../src/renderer3d/lighting-builder.js');
const { LIGHTING_DEFS } = await import('../src/data/placeables/lighting.js');
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

// --- Real fixture discovery -------------------------------------------------
//
// This is the regression guard the bug report asked for: light-rig.js used
// to discover fixtures by scanning the scene for `userData.lightFixture`, a
// tag decoration-builder.js's old lamppost builder set and lighting-
// builder.js's replacement never carried forward — so the lookup was a
// silent no-op (132/132 green with the feature entirely dead). Discovery now
// reads ThreeRenderer.lightingGroup — an [{id, def, group}, ...] array — via
// setFixtureRegistry(), fed a REAL group built by lighting-builder.js's
// buildLightFixture(), not a synthetic stub with hand-set userData. If the
// tag contract regresses (or setFixtureRegistry stops being wired to
// discovery), this fixture is invisible to the rig and every assertion below
// fails.

const lamppostDef = LIGHTING_DEFS.find((d) => d.id === 'lamppost');
const floodLightDef = LIGHTING_DEFS.find((d) => d.id === 'floodLight');

function makeFixtureEntry(def, id, x, z, dir = 0) {
  const group = buildLightFixture(def, { dir });
  group.position.set(x, 0, z); // ground mount: origin sits at floor height
  return { id, def, group };
}

test('LightRig discovers a real lighting-builder.js fixture via setFixtureRegistry, not a userData tag', () => {
  const scene = new SceneStub();
  const lamp = makeFixtureEntry(lamppostDef, 'lamp-1', 4, 4);
  // Deliberately NOT scene.add(lamp.group) and NOT tagged userData.lightFixture
  // — proves discovery no longer depends on either the old tag or even the
  // fixture being part of the THREE scene graph, only on the registry.
  assert.equal(lamp.group.userData.lightFixture, undefined, 'sanity: the dead tag is not set on a real fixture group');

  const rig = new LightRig(scene, { shadowSpotCount: 4, pointCount: 8 });
  const camera = { position: new V3(0, 0, 0) };

  // Before registration: nothing to find.
  rig.update(camera, 1, 0.016);
  assert.equal(rig._spotSlots[0].assignedRef, null, 'no fixture is assigned before setFixtureRegistry() is called');

  rig.setFixtureRegistry([lamp]);
  rig.update(camera, 1, 0.016); // full night
  const spot = rig._spotSlots[0];
  assert.equal(spot.assignedRef, lamp, 'the real fixture is discovered and assigned to the nearest spot slot');
  assert.ok(spot.light.intensity > 0, 'a discovered fixture actually lights up at night');
});

// --- Position/aim/radius derivation -----------------------------------------
//
// The brief: derive these from the fixture's own def.light block via
// isAimedFixture/dirFromYaw/poolFootprint/mountFloorY — the exact math the
// painted pool uses — so the real spotlight agrees with the pool it
// replaces, not a second invented aiming model.

test('an unaimed (point) fixture: spotlight sits at emitterY above its base, points straight down, throws to its own radius', () => {
  const scene = new SceneStub();
  const lamp = makeFixtureEntry(lamppostDef, 'lamp-1', 4, 0);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 1 });
  rig.setFixtureRegistry([lamp]);
  rig.update({ position: new V3(0, 0, 0) }, 1, 0.016);

  const slot = rig._spotSlots[0];
  assert.equal(slot.assignedRef, lamp);
  assert.equal(slot.light.position.x, 4, 'x carries straight from the fixture group position');
  assert.equal(slot.light.position.z, 0);
  assert.equal(slot.light.position.y, lamppostDef.light.emitterY,
    `ground mount: emitter height = group.position.y (0) + def.light.emitterY (got ${slot.light.position.y})`);
  assert.equal(slot.target.position.x, 4, 'an unaimed fixture points straight down: target.x === fixture x');
  assert.equal(slot.target.position.z, 0, 'an unaimed fixture points straight down: target.z === fixture z');
  assert.equal(slot.target.position.y, 0, 'target sits on the floor (ground mount floor height = 0)');
  assert.equal(slot.light.distance, lamppostDef.light.radius,
    `throw distance derives from the fixture's own pool radius, not the shared fallback constant (got ${slot.light.distance})`);
  assert.equal(slot.light.color.getHex(), lamppostDef.light.color, 'color comes from def.light.color');
});

test('an aimed (cone) fixture: spotlight target leans toward the same forward offset the painted pool uses', () => {
  const scene = new SceneStub();
  // dir=0 aims along local +x, per lighting-builder.js's authoring convention
  // (see test-flood-aim.js) — the pool ellipse (and now the spot target)
  // should push out along +x, not sit straight below the fixture.
  const flood = makeFixtureEntry(floodLightDef, 'flood-1', 2, 2, 0);
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 1 });
  rig.setFixtureRegistry([flood]);
  rig.update({ position: new V3(0, 0, 0) }, 1, 0.016);

  const slot = rig._spotSlots[0];
  assert.equal(slot.assignedRef, flood);
  assert.ok(slot.target.position.x > 2, `an aimed fixture's target is pushed forward along its aim, not straight down (got x=${slot.target.position.x})`);
  assert.equal(slot.target.position.z, 2, 'dir=0 aims purely along x, so z is untouched');
});

// --- nightFactor: fixtures fade to zero, flashes ignore it -----------------

test('fixture intensity scales to zero at nightFactor=0; an in-flight flash does not', () => {
  const scene = new SceneStub();
  const lamp = makeFixtureEntry(lamppostDef, 'lamp-1', 4, 4);

  const rig = new LightRig(scene, { shadowSpotCount: 4, pointCount: 8 });
  rig.setFixtureRegistry([lamp]);
  const camera = { position: new V3(0, 0, 0) };

  rig.update(camera, 0, 0.016); // full daylight
  const spotAtNoon = rig._spotSlots[0];
  assert.equal(spotAtNoon.assignedRef, lamp, 'the only fixture in the registry is assigned to the nearest spot slot');
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

// --- Pool suppression: real spot slot <-> painted pool visibility ----------

test('a fixture holding a real spot slot has its painted pool quad zeroed; releasing the slot restores it', () => {
  const scene = new SceneStub();
  const near = makeFixtureEntry(lamppostDef, 'near', 1, 0);
  const far = makeFixtureEntry(lamppostDef, 'far', 500, 0);
  const fixtures = [near, far];

  const poolMesh = buildLightPools(fixtures);
  assert.ok(poolMesh, 'a merged pool mesh is built for both fixtures');
  const ranges = poolMesh.userData.fixtureRanges;
  assert.ok(ranges.has('near') && ranges.has('far'), 'both fixtures got a quad in the merged mesh');
  const colorArr = poolMesh.geometry.attributes.color.array;
  const nearRange = ranges.get('near');
  const originalNearColor = [
    colorArr[nearRange.vertStart * 3], colorArr[nearRange.vertStart * 3 + 1], colorArr[nearRange.vertStart * 3 + 2],
  ];
  assert.ok(originalNearColor.some((c) => c > 0), 'sanity: the pool quad starts out with a real (non-zero) color');

  // Only one shadow-spot slot: the rig can only light the nearest of the two
  // — `far` never gets a real light and must keep its painted pool.
  const rig = new LightRig(scene, { shadowSpotCount: 1, pointCount: 1 });
  rig.setFixtureRegistry(fixtures);
  rig.update({ position: new V3(0, 0, 0) }, 1, 0.016);

  const activeIds = rig.getActiveFixtureIds();
  assert.ok(activeIds.has('near') && !activeIds.has('far'), 'only the nearest fixture holds a real spot slot');

  applyPoolSuppression(poolMesh, activeIds);
  const nearAfterSuppress = [
    colorArr[nearRange.vertStart * 3], colorArr[nearRange.vertStart * 3 + 1], colorArr[nearRange.vertStart * 3 + 2],
  ];
  assert.deepEqual(nearAfterSuppress, [0, 0, 0], 'the fixture holding a real spot slot has its pool quad zeroed');
  const farRange = ranges.get('far');
  const farAfterSuppress = [
    colorArr[farRange.vertStart * 3], colorArr[farRange.vertStart * 3 + 1], colorArr[farRange.vertStart * 3 + 2],
  ];
  assert.notDeepEqual(farAfterSuppress, [0, 0, 0], 'the fixture with no real light keeps its painted pool');
  assert.equal(poolMesh.geometry.attributes.color.needsUpdate, true, 'the color attribute is flagged for re-upload');

  // Releasing the slot (e.g. the camera pans away and `far` ranks nearer
  // instead) must restore the original pool color — reversible, not a
  // one-way suppression.
  poolMesh.geometry.attributes.color.needsUpdate = false;
  applyPoolSuppression(poolMesh, new Set()); // nobody holds a slot any more
  const nearAfterRelease = [
    colorArr[nearRange.vertStart * 3], colorArr[nearRange.vertStart * 3 + 1], colorArr[nearRange.vertStart * 3 + 2],
  ];
  assert.deepEqual(nearAfterRelease, originalNearColor, 'releasing the slot restores the pool quad\'s original color');
  assert.equal(poolMesh.geometry.attributes.color.needsUpdate, true, 'restoring also flags the attribute for re-upload');

  // And calling again with the SAME active set must be a true no-op (no
  // redundant attribute upload) — the cost guarantee the brief asks for.
  poolMesh.geometry.attributes.color.needsUpdate = false;
  applyPoolSuppression(poolMesh, new Set());
  assert.equal(poolMesh.geometry.attributes.color.needsUpdate, false,
    'calling applyPoolSuppression again with an unchanged active set does not re-touch the attribute');
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

// A bollard marker and a floodlight must not cast the same light. lighting.js
// gives each fixture its own `light.intensity` (0.5 for an ankle-height
// bollard, 2.2 for a 7.5 m floodlight) and the rig already reads that def's
// colour and radius — so a flat intensity constant would have made the two
// agree on brightness while disagreeing on everything else. This pins the
// ratio to the data rather than to a magic number, so retuning lighting.js
// moves the lights with it.
test('fixture spot intensity scales with the fixture def, not a flat constant', () => {
  const lampI = lamppostDef.light.intensity;
  const floodI = floodLightDef.light.intensity;
  assert.ok(floodI > lampI, `sanity: the catalogue really does rate a floodlight above a lamppost (${floodI} vs ${lampI})`);

  const read = (def, id) => {
    const rig = new LightRig(new SceneStub(), { shadowSpotCount: 1, pointCount: 1 });
    rig.setFixtureRegistry([makeFixtureEntry(def, id, 2, 2)]);
    rig.update({ position: new V3(0, 0, 0) }, 1, 0.016);
    return rig._spotSlots[0].light.intensity;
  };

  const lampLit = read(lamppostDef, 'lamp-i');
  const floodLit = read(floodLightDef, 'flood-i');
  assert.ok(lampLit > 0 && floodLit > 0, 'both fixtures are actually lit at full night');
  assert.ok(
    Math.abs(floodLit / lampLit - floodI / lampI) < 1e-6,
    `spot intensity tracks the def ratio (expected ${floodI / lampI}x, got ${floodLit / lampLit}x)`,
  );
});
