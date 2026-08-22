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
const {
  ComponentBuilder,
  getModelBounds,
  measureShellSurfaces,
} = await import('../src/renderer3d/component-builder.js');
const {
  portAnchor3D,
  setModelBoundsProvider,
  setShellMeasureProvider,
} = await import('../src/utility/port-anchors.js');

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

test('LCW manifold rendered ports stay distinct on the open header frame', () => {
  setModelBoundsProvider(getModelBounds);
  setShellMeasureProvider(measureShellSurfaces);
  try {
    const def = COMPONENTS.coolingManifold;
    const placed = {
      id: 'manifold', type: 'coolingManifold',
      col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
    };
    const anchors = Object.fromEntries(Object.keys(def.ports)
      .map(name => [name, portAnchor3D(placed, def, name)]));
    const branchAnchors = Object.entries(anchors)
      .filter(([name]) => name.startsWith('cold_') || name.startsWith('hot_'))
      .map(([, anchor]) => anchor)
      .sort((a, b) => a.z - b.z);
    const minimumBranchSpacing = Math.min(...branchAnchors.slice(1)
      .map((anchor, index) => anchor.z - branchAnchors[index].z));

    assert.equal(new Set(branchAnchors.map(anchor =>
      `${anchor.x.toFixed(6)},${anchor.y.toFixed(6)},${anchor.z.toFixed(6)}`)).size, 8);
    assert.ok(minimumBranchSpacing > 0.22,
      `rendered branch fittings clear placement markers (${minimumBranchSpacing} m)`);
    assert.notDeepEqual(
      [anchors.supply_cold.x, anchors.supply_cold.y, anchors.supply_cold.z],
      [anchors.supply_hot.x, anchors.supply_hot.y, anchors.supply_hot.z],
      'rigid cold and hot fittings do not collapse onto one shell mount',
    );
    assert.ok(Object.values(anchors).every(anchor => anchor.y === 0.68),
      'all generated fittings meet the visible header centreline');
  } finally {
    setModelBoundsProvider(null);
    setShellMeasureProvider(null);
  }
});
