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

const { COMPONENTS } = await import('../src/data/components.js');
const { ComponentBuilder } = await import('../src/renderer3d/component-builder.js');

test('LCW manifold model has distinct blue supply and red return headers', () => {
  const def = COMPONENTS.coolingManifold;
  const wrapper = new ComponentBuilder().createObject(def, def.accentColor);
  const visual = wrapper.children[0];
  const roles = new Map(visual.children
    .filter(child => child.isMesh && child.userData.role)
    .map(child => [child.userData.role, child]));

  assert.equal(roles.get('coldWater')?.material.color.getHex(), 0x287fc4);
  assert.equal(roles.get('hotWater')?.material.color.getHex(), 0xc45b42);
  assert.ok(roles.get('coldWater').geometry.attributes.position.count > 0);
  assert.ok(roles.get('hotWater').geometry.attributes.position.count > 0);
});
