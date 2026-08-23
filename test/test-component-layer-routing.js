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

test('far component presentation batches instances without losing picking ids', () => {
  const parent = new THREE.Group();
  const beamline = new THREE.Group();
  parent.add(beamline);
  const builder = new ComponentBuilder();
  const components = Array.from({ length: 40 }, (_, index) =>
    component(`beam-${index}`, 'beamline', index));

  builder.build(components, parent, { categoryGroups: { beamline } });
  const far = beamline.children.find(child => child.userData.batchedComponents);
  assert.ok(far?.isInstancedMesh);
  assert.equal(far.count, components.length);
  assert.equal(far.visible, false);

  builder.setDetailLevel(false);
  assert.equal(far.visible, true);
  assert.equal(builder.getGroup('beam-0').visible, false);
  assert.equal(builder.resolveBatchHit({ object: far, instanceId: 17 }).nodeId, 'beam-17');

  builder.setDetailLevel(true);
  assert.equal(far.visible, false);
  assert.equal(builder.getGroup('beam-0').visible, true);
  builder.dispose(parent);
});
