// Regression coverage for the S-band structure's RF handoff. The component
// owns one rf_in port, and its authored launcher must meet the standard routed
// waveguide instead of drawing a pair of oversized decorative red ducts.

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

const { COMPONENTS } = await import('../src/data/components.js');
const { ComponentBuilder, getModelBounds, measureShellSurfaces } =
  await import('../src/renderer3d/component-builder.js');
const {
  portAnchor3D,
  setModelBoundsProvider,
  setShellMeasureProvider,
} = await import('../src/utility/port-anchors.js');
const rfWaveguide = (await import('../src/utility/types/rfWaveguide.js')).default;

function visual() {
  const def = COMPONENTS.sbandStructure;
  return new ComponentBuilder().createObject(def, def.accentColor).children[0];
}

function role(model, name) {
  return model.children.find(child => child.isMesh && child.userData.role === name);
}

test('S-band exposes one compact launcher with the routed waveguide section', () => {
  const launcher = role(visual(), 'accent');
  assert.ok(launcher, 'the S-band structure needs a visible RF launcher');
  launcher.geometry.computeBoundingBox();
  const box = launcher.geometry.boundingBox;
  const size = box.getSize(new THREE.Vector3());
  const expectedWidth = rfWaveguide.pipeRadiusMeters * 2;
  const expectedHeight = rfWaveguide.pipeRadiusMeters * 1.4;

  assert.ok(Math.abs(size.z - expectedWidth) < 1e-6,
    `launcher width matches the routed guide (${size.z} vs ${expectedWidth})`);
  assert.ok(Math.abs(size.y - expectedHeight) < 1e-6,
    `launcher height matches the routed guide (${size.y} vs ${expectedHeight})`);
  assert.ok(size.x <= 0.30 + 1e-6 && box.min.x > 0,
    'one short launcher replaces the two opposing oversized ducts');
});

test('the real rf_in fitting lands on the launcher outer face', () => {
  setModelBoundsProvider(getModelBounds);
  setShellMeasureProvider(measureShellSurfaces);

  const def = COMPONENTS.sbandStructure;
  const launcher = role(visual(), 'accent');
  launcher.geometry.computeBoundingBox();
  const box = launcher.geometry.boundingBox;
  const anchor = portAnchor3D({
    id: 'sband', type: 'sbandStructure', worldX: 0, worldZ: 0, dir: 0,
  }, def, 'rf_in');

  assert.ok(anchor, 'rf_in resolves to a rendered connector anchor');
  assert.ok(Math.abs(anchor.x - box.max.x) < 1e-5,
    `rf_in meets the launcher end (${anchor.x} vs ${box.max.x})`);
  assert.ok(anchor.y >= box.min.y - 1e-6 && anchor.y <= box.max.y + 1e-6,
    'rf_in stays inside the launcher height');
  assert.ok(anchor.z >= box.min.z - 1e-6 && anchor.z <= box.max.z + 1e-6,
    'rf_in stays inside the launcher width');
});
