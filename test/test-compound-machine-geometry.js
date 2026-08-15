// Regression coverage for the two electrostatic compound-machine models.
// These ids previously shared the same generic `tower` fallback, which made
// two very different accelerators visually indistinguishable.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return {};
    return {
      width: 0, height: 0,
      getContext() {
        return {
          createRadialGradient() { return { addColorStop() {} }; },
          fillRect() {}, fillStyle: null,
        };
      },
    };
  },
};

const { ComponentBuilder, isDetailedComponent } =
  await import('../src/renderer3d/component-builder.js');
const { PLACEABLES } = await import('../src/data/placeables/index.js');
const { PLACEABLE_VISUAL_PROFILES } =
  await import('../src/renderer3d/placeable-visual-details.js');

function visualFor(id) {
  const def = PLACEABLES[id];
  const wrapper = new ComponentBuilder()._createObject(def, def.accentColor);
  return wrapper.children[0];
}

function roleMeshes(visual) {
  return visual.children.filter(child => child.isMesh && child.userData.role);
}

function role(visual, name) {
  return roleMeshes(visual).find(mesh => mesh.userData.role === name);
}

test('both electrostatic compound machines use bespoke role geometry', () => {
  for (const id of ['vanDeGraaff', 'cockcroftWalton']) {
    const def = PLACEABLES[id];
    assert.equal(isDetailedComponent(id, def), true, `${id} must bypass fallback geometry`);
    assert.equal(PLACEABLE_VISUAL_PROFILES[id], undefined,
      `${id} must not retain the shared generic tower profile`);

    const roles = roleMeshes(visualFor(id)).map(mesh => mesh.userData.role).sort();
    assert.deepEqual(roles, ['accent', 'copper', 'detail', 'iron', 'pipe', 'stand'],
      `${id} needs the full mechanical material vocabulary`);
  }
});

test('the models have distinct silhouettes that stay inside their footprints', () => {
  const van = visualFor('vanDeGraaff');
  const cw = visualFor('cockcroftWalton');
  const vanBox = new THREE.Box3().setFromObject(van);
  const cwBox = new THREE.Box3().setFromObject(cw);
  const vanSize = vanBox.getSize(new THREE.Vector3());
  const cwSize = cwBox.getSize(new THREE.Vector3());

  assert.ok(vanSize.x <= PLACEABLES.vanDeGraaff.subW * 0.5 + 1e-6);
  assert.ok(vanSize.z <= PLACEABLES.vanDeGraaff.subL * 0.5 + 1e-6);
  assert.ok(cwSize.x <= PLACEABLES.cockcroftWalton.subW * 0.5 + 1e-6);
  assert.ok(cwSize.z <= PLACEABLES.cockcroftWalton.subL * 0.5 + 1e-6);
  assert.ok(vanBox.min.y >= -1e-6 && cwBox.min.y >= -1e-6,
    'both machines must sit on, not below, the floor');
  assert.ok(vanBox.max.y <= PLACEABLES.vanDeGraaff.subH * 0.5 + 1e-6);
  assert.ok(cwBox.max.y <= 3.0 + 1e-6,
    'the multiplier stack must stay inside its renderer click volume');

  assert.ok(cwSize.x > vanSize.x + 0.8,
    'Cockcroft-Walton must read as a broad open stack, not the Van de Graaff tank again');
  assert.ok(cwSize.y > vanSize.y + 0.4,
    'Cockcroft-Walton must remain the visibly taller accelerator');
});

test('each machine carries its beam tube to the authored +Z exit port', () => {
  for (const id of ['vanDeGraaff', 'cockcroftWalton']) {
    const pipe = role(visualFor(id), 'pipe');
    assert.ok(pipe, `${id} needs visible extraction pipe geometry`);
    pipe.geometry.computeBoundingBox();
    const box = pipe.geometry.boundingBox;
    const footprintFront = PLACEABLES[id].subL * 0.25;
    assert.ok(Math.abs(box.max.z - footprintFront) < 1e-5,
      `${id} pipe must terminate at the front footprint edge (${box.max.z} vs ${footprintFront})`);
    assert.ok(box.min.y <= 1.0 && box.max.y >= 1.0,
      `${id} pipe must cross the shared 1 m beam height`);
  }
});

test('role templates are cached and shared between placements', () => {
  for (const id of ['vanDeGraaff', 'cockcroftWalton']) {
    const a = visualFor(id);
    const b = visualFor(id);
    for (const meshA of roleMeshes(a)) {
      const meshB = role(b, meshA.userData.role);
      assert.equal(meshA.geometry, meshB.geometry,
        `${id} ${meshA.userData.role} geometry should be shared by all placements`);
    }
  }
});
