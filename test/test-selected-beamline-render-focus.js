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
const { ThreeRenderer } = await import('../src/renderer3d/ThreeRenderer.js');

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

test('selected utility topology takes focus and outlines every connected endpoint', () => {
  const renderer = Object.create(ThreeRenderer.prototype);
  const endpointRoots = new Map([
    ['source', new THREE.Group()],
    ['load', new THREE.Group()],
  ]);
  let componentFocus = null;
  let lineFocus = null;
  renderer.componentBuilder = {
    setFocus(ids) { componentFocus = ids; },
    getGroup(id) { return endpointRoots.get(id) || null; },
  };
  renderer.utilityLineBuilderV2 = { setFocus(ids) { lineFocus = ids; } };
  renderer.pipeAttachmentBuilder = { getGroup() { return null; } };
  renderer.equipmentBuilder = { getGroup() { return null; } };
  renderer.decorationBuilder = { getGroup() { return null; } };
  renderer.utilitySelectionGroup = new THREE.Group();
  renderer._selectedBeamlineFocus = {
    focusedComponentIds: new Set(['beam']),
    utilityLineIds: new Set(['beam_service']),
  };
  renderer._selectedUtilityNetworkFocus = null;
  renderer._outlineObject = (root, color, target) => {
    const marker = new THREE.Group();
    marker.userData = { root, color };
    target.add(marker);
  };

  const model = {
    utilityType: 'powerCable',
    utilityLineIds: new Set(['trunk', 'branch']),
    connectedEndpointIds: new Set(['source', 'load']),
  };
  renderer.setSelectedUtilityNetworkFocus(model);

  assert.equal(componentFocus, model.connectedEndpointIds);
  assert.equal(lineFocus, model.utilityLineIds);
  assert.equal(renderer.utilitySelectionGroup.children.length, 2);
  assert.deepEqual(
    new Set(renderer.utilitySelectionGroup.children.map(child => child.userData.root)),
    new Set(endpointRoots.values()),
  );

  renderer.setSelectedUtilityNetworkFocus(null);
  assert.equal(componentFocus, renderer._selectedBeamlineFocus.focusedComponentIds,
    'clearing utility selection restores the underlying beamline focus');
  assert.equal(lineFocus, renderer._selectedBeamlineFocus.utilityLineIds);
  assert.equal(renderer.utilitySelectionGroup.children.length, 0);
});
