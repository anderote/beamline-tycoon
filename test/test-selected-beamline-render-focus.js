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
const { UtilityLineBuilderV2 } = await import('../src/renderer3d/utility-line-builder-v2.js');

function component(id, category, col) {
  return {
    id, type: 'quadrupole', category, col, row: 0,
    subCol: 0, subRow: 0, direction: 0,
  };
}

function firstVisibleMaterial(group) {
  let found = null;
  group.traverse(object => {
    if (!found && object.isMesh && object.material?.visible !== false) found = object.material;
  });
  return found;
}

test('component focus fades unrelated machine layers and restores their materials', () => {
  const builder = new ComponentBuilder();
  const parent = new THREE.Group();
  builder.build([
    component('beam', 'beamline', 0),
    component('plant', 'infrastructure', 1),
    component('other', 'infrastructure', 2),
  ], parent);

  const selectedMaterial = firstVisibleMaterial(builder.getGroup('beam'));
  const otherMaterial = firstVisibleMaterial(builder.getGroup('other'));
  builder.setFocus(new Set(['beam', 'plant']));

  assert.equal(firstVisibleMaterial(builder.getGroup('beam')), selectedMaterial);
  const dimMaterial = firstVisibleMaterial(builder.getGroup('other'));
  assert.notEqual(dimMaterial, otherMaterial, 'shared machine material is cloned per faded wrapper');
  assert.equal(dimMaterial.opacity, 0.12);
  assert.equal(dimMaterial.transparent, true);
  assert.equal(dimMaterial.depthWrite, false);

  builder.setFocus(null);
  assert.equal(firstVisibleMaterial(builder.getGroup('other')), otherMaterial);
});

test('utility focus fades unrelated runs and restores their shared materials', () => {
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE.Group();
  const lines = new Map([
    ['serving', {
      id: 'serving', utilityType: 'vacuumPipe', start: null, end: null,
      path: [{ col: 0, row: 0 }, { col: 2, row: 0 }],
    }],
    ['other', {
      id: 'other', utilityType: 'vacuumPipe', start: null, end: null,
      path: [{ col: 0, row: 2 }, { col: 2, row: 2 }],
    }],
  ]);
  builder.build(lines, new Map(), parent);
  const serving = parent.children.find(group => group.userData.lineId === 'serving');
  const other = parent.children.find(group => group.userData.lineId === 'other');
  const servingMaterial = firstVisibleMaterial(serving);
  const otherMaterial = firstVisibleMaterial(other);

  builder.setFocus(new Set(['serving']));
  assert.equal(firstVisibleMaterial(serving), servingMaterial);
  const dimMaterial = firstVisibleMaterial(other);
  assert.notEqual(dimMaterial, otherMaterial);
  assert.equal(dimMaterial.opacity, 0.12);
  assert.equal(dimMaterial.transparent, true);
  assert.equal(dimMaterial.depthWrite, false);

  builder.setFocus(null);
  assert.equal(firstVisibleMaterial(other), otherMaterial);
});
