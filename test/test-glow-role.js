// test/test-glow-role.js
//
// Guards the 'glow' role introduced in Task 3 (dynamic lighting/glow):
// emissive screens and indicator lamps that (a) share a material cache
// keyed like getAccentMaterial, (b) all answer to one day/night dial with
// no material left behind, and (c) actually land on the bloom layer when a
// real component is built — proven headlessly rather than by eye.
//
// component-builder.js pulls in materials/tiled.js and materials/decals.js,
// which construct THREE.TextureLoader/CanvasTexture instances at module
// load — real browser APIs (Image loading, a 2D canvas context) that don't
// exist under plain Node. Rather than hand-roll a THREE stub deep enough to
// replicate THREE's real BufferGeometry internals (the hand-written
// _mergeGeometries and applyTiledBoxUVs/applyTiledCylinderUVs in
// component-builder.js/uv-utils.js both operate directly on real attribute
// arrays), this test uses the REAL three.js package — already an npm
// dependency since Task 1 — for every class, swapping in a no-op
// TextureLoader and a minimal `document.createElement('canvas')` stub so
// the two browser-only call sites don't throw. Everything else (geometry
// math, merging, Object3D.layers, userData) is the genuine
// three.js/production code path, exercised through the same
// ComponentBuilder entry point the live renderer uses.
//
// THREE/document must be installed on globalThis *before*
// component-builder.js is evaluated — it touches THREE.MeshStandardMaterial
// and THREE.TextureLoader at module top level (SHARED_MATERIALS, MATERIALS,
// DECALS). A static `import` would be hoisted ahead of that setup, so the
// component-builder/data modules are loaded with a dynamic `import()` after
// the globals are in place (mirrors the `globalThis.THREE` stub pattern in
// test/test-staff-builder.js, which gets away with a static import only
// because staff-builder.js never touches THREE at module scope).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };

// Only materials/decals.js's one procedural texture (gen_radialDot) touches
// `document` — a 2D canvas used to bake a radial-gradient dot. Stub just
// enough of the canvas API for it to run without throwing; the pixels
// themselves are never read by anything this test exercises.
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return {};
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          createRadialGradient() { return { addColorStop() {} }; },
          fillRect() {},
          fillStyle: null,
        };
      },
    };
  },
};

const { ComponentBuilder, getGlowMaterial, setGlowNightFactor } =
  await import('../src/renderer3d/component-builder.js');
const { COMPONENTS } = await import('../src/data/components.js');
const { BLOOM_LAYER } = await import('../src/renderer3d/glow-pipeline.js');

function findGlowMeshes(obj) {
  const out = [];
  obj.traverse((child) => {
    if (child.isMesh && child.userData.role === 'glow') out.push(child);
  });
  return out;
}

// --- getGlowMaterial: cache shape (mirrors getAccentMaterial) ----------

test('getGlowMaterial caches by (compType, colorHex) and does not leak on repeat calls', () => {
  const a1 = getGlowMaterial('llrfController', 0x40e0ff);
  const a2 = getGlowMaterial('llrfController', 0x40e0ff);
  assert.equal(a1, a2, 'same compType+color must return the same material instance');

  const b = getGlowMaterial('negPump', 0x40e0ff);
  assert.notEqual(a1, b, 'different compType must not share an instance, even at the same color');

  const c = getGlowMaterial('llrfController', 0xff6633);
  assert.notEqual(a1, c, 'different color must not share an instance, even for the same compType');

  const before = new Set([a1, b, c]);
  for (let i = 0; i < 25; i++) {
    getGlowMaterial('llrfController', 0x40e0ff);
    getGlowMaterial('negPump', 0x40e0ff);
    getGlowMaterial('llrfController', 0xff6633);
  }
  const after = new Set([
    getGlowMaterial('llrfController', 0x40e0ff),
    getGlowMaterial('negPump', 0x40e0ff),
    getGlowMaterial('llrfController', 0xff6633),
  ]);
  assert.deepEqual([...after], [...before], 'repeat calls must not allocate new materials');
});

test('getGlowMaterial produces an emissive material with no map by default', () => {
  const m = getGlowMaterial('ionSource', 0xff6633);
  assert.equal(m.map, null, 'glow materials have no albedo map by default');
  assert.equal(m.emissive.getHex(), 0xff6633);
  assert.ok(m.emissiveIntensity > 0, 'material should be lit by default, before any setGlowNightFactor call');
});

// --- setGlowNightFactor: reaches every registered material --------------

test('setGlowNightFactor scales every material getGlowMaterial has ever created, in lockstep', () => {
  const mats = [
    getGlowMaterial('llrfController', 0x40e0ff),
    getGlowMaterial('negPump', 0x44ff66),
    getGlowMaterial('ionSource', 0xff6633),
    getGlowMaterial('someFutureType', 0x123456), // proves the registry isn't a hard-coded compType list
  ];

  setGlowNightFactor(1);
  const atNight = mats.map(m => m.emissiveIntensity);
  assert.ok(atNight.every(v => v > 0), 'every material must be lit at full night factor');

  setGlowNightFactor(0.25);
  const dimmed = mats.map(m => m.emissiveIntensity);
  for (let i = 0; i < mats.length; i++) {
    assert.ok(dimmed[i] < atNight[i], `material ${i} did not dim when the night factor dropped`);
  }

  // All glow materials share one base intensity, so a given factor scales
  // every material by the same ratio.
  const ratios = dimmed.map((v, i) => v / atNight[i]);
  for (const r of ratios) {
    assert.ok(Math.abs(r - ratios[0]) < 1e-9, 'every material must scale by the same ratio');
  }

  setGlowNightFactor(1); // restore full brightness for later tests in this file
});

test('a material created between two setGlowNightFactor calls still answers to the next one', () => {
  setGlowNightFactor(0.5);
  const late = getGlowMaterial('lateType', 0xabcdef);
  setGlowNightFactor(0.1);
  const at01 = late.emissiveIntensity;
  setGlowNightFactor(0.9);
  const at09 = late.emissiveIntensity;
  assert.ok(at09 > at01, 'registration happens at creation time, not at the first setGlowNightFactor call — later calls must still reach it');
  setGlowNightFactor(1);
});

test('getGlowMaterial applies the currently active night factor at creation, not always full base intensity', () => {
  // Fix round 1, Minor 2: a material created mid-cycle must start at the
  // factor already in effect (e.g. a component placed at night should not
  // render as noon-dim for one frame before the next sun-cycle tick).
  setGlowNightFactor(0.2);
  const dim = getGlowMaterial('midCycleTypeA', 0x112233);
  assert.ok(Math.abs(dim.emissiveIntensity - 4.0 * 0.2) < 1e-9,
    `material created at factor 0.2 should start at 0.8, got ${dim.emissiveIntensity}`);

  setGlowNightFactor(0.9);
  const bright = getGlowMaterial('midCycleTypeB', 0x445566);
  assert.ok(Math.abs(bright.emissiveIntensity - 4.0 * 0.9) < 1e-9,
    `material created at factor 0.9 should start at 3.6, got ${bright.emissiveIntensity}`);

  setGlowNightFactor(1);
});

// --- Real component build: proves BLOOM_LAYER lands on an actual mesh --
// (rather than trusting it "by eye" against the bloom pass in a browser)

test('a placed LLRF controller has a glow-role screen mesh on BLOOM_LAYER that does not cast a shadow', () => {
  const cb = new ComponentBuilder();
  const wrapper = cb._createObject(COMPONENTS.llrfController, 0xc62828);
  const glowMeshes = findGlowMeshes(wrapper);
  assert.equal(glowMeshes.length, 1, 'the LLRF console should bucket exactly one surface into glow (the screen)');
  const [mesh] = glowMeshes;
  assert.equal(mesh.layers.isEnabled(BLOOM_LAYER), true, 'a glow mesh must opt into the bloom layer');
  assert.equal(mesh.castShadow, false, 'a lit screen must not cast a shadow');
  assert.equal(mesh.receiveShadow, true);
  assert.equal(mesh.material.emissive.getHex(), 0x40e0ff);
});

test('a placed NEG pump has a glow-role indicator strip on BLOOM_LAYER', () => {
  const cb = new ComponentBuilder();
  const wrapper = cb._createObject(COMPONENTS.negPump, 0xc62828);
  const glowMeshes = findGlowMeshes(wrapper);
  assert.equal(glowMeshes.length, 1, 'the NEG pump controller should bucket exactly one surface into glow (the indicator strip)');
  assert.equal(glowMeshes[0].layers.isEnabled(BLOOM_LAYER), true);
  assert.equal(glowMeshes[0].castShadow, false);
});

test('the ion source hot cathode (legacy DETAIL_BUILDERS path) is folded into the glow role', () => {
  // _buildDuoplasmatron builds a THREE.Group directly rather than role
  // buckets, so it never passes through _instantiateRoleTemplate's
  // per-placement loop — this proves the role tag, BLOOM_LAYER, and
  // castShadow=false were applied by hand at the mesh creation site and
  // weren't silently dropped along that path.
  const cb = new ComponentBuilder();
  const wrapper = cb._createObject(COMPONENTS.ionSource, 0xc62828);
  const glowMeshes = findGlowMeshes(wrapper);
  assert.equal(glowMeshes.length, 1, 'the hot-cathode cap should be the only glow surface');
  assert.equal(glowMeshes[0].layers.isEnabled(BLOOM_LAYER), true);
  assert.equal(glowMeshes[0].castShadow, false);
  assert.equal(glowMeshes[0].material.emissive.getHex(), 0xff6633,
    'cathode color must be unchanged from the old hand-rolled material (0xff6633)');
});

test('the glow role survives the template cache: two placements of the same type share one material and geometry', () => {
  const cb = new ComponentBuilder();
  const a = cb._createObject(COMPONENTS.llrfController, 0xc62828);
  const b = cb._createObject(COMPONENTS.llrfController, 0x2e7d32); // different accent (paint) color
  const [meshA] = findGlowMeshes(a);
  const [meshB] = findGlowMeshes(b);
  assert.equal(meshA.material, meshB.material,
    'glow color is not the beamline accent paint — both placements must share one material regardless of accent color');
  assert.equal(meshA.geometry, meshB.geometry, 'template geometry must be shared, not rebuilt per placement');
});
