// Component wrappers must stay independently pickable while renderer-owned
// category groups provide efficient world-layer visibility boundaries.

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

const { ComponentBuilder } = await import('../src/renderer3d/component-builder.js');

function component(id, category, col) {
  return {
    id,
    type: 'quadrupole',
    category,
    col,
    row: 0,
    subCol: 0,
    subRow: 0,
    direction: 0,
  };
}

test('component builder routes and reparents wrappers by presentation category', () => {
  const parent = new THREE.Group();
  const beamline = new THREE.Group();
  const infrastructure = new THREE.Group();
  parent.add(beamline, infrastructure);
  const categoryGroups = { beamline, infrastructure };
  const builder = new ComponentBuilder();

  builder.build([
    component('beam-1', 'beamline', 0),
    component('infra-1', 'infrastructure', 1),
  ], parent, { categoryGroups });

  assert.equal(builder.getGroup('beam-1').parent, beamline);
  assert.equal(builder.getGroup('infra-1').parent, infrastructure);
  assert.equal(builder.getGroup('beam-1').userData.presentationCategory, 'beamline');

  builder.build([component('beam-1', 'infrastructure', 0)], parent, { categoryGroups });
  assert.equal(builder.getGroup('beam-1').parent, infrastructure,
    'a live category change reparents an existing wrapper');
  assert.equal(builder.getGroup('infra-1'), null, 'stale wrappers are removed from nested groups');

  builder.dispose(parent);
  assert.equal(infrastructure.children.length, 0);
});
