// Regression coverage for the solenoid and collimator beam-axis visuals.
// Both components used to take the generic fallback path, whose 1 m-tall
// shape stopped at the shared 1 m beam height and therefore sat below its
// carrier pipe.

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
  componentPose,
  isDetailedComponent,
} = await import('../src/renderer3d/component-builder.js');

function visualFor(id) {
  const def = COMPONENTS[id];
  const wrapper = new ComponentBuilder().createObject(def, def.accentColor);
  return wrapper.children[0];
}

function role(visual, name) {
  return visual.children.find(child => child.isMesh && child.userData.role === name);
}

test('solenoid and collimator use floor-origin role builders on the beam axis', () => {
  for (const id of ['solenoid', 'collimator']) {
    const def = COMPONENTS[id];
    assert.equal(isDetailedComponent(id, def), true,
      `${id} must bypass the low generic fallback`);

    const pose = componentPose(def, {
      col: 0,
      row: 0,
      subCol: null,
      subRow: null,
      direction: 0,
    }, isDetailedComponent(id, def));
    assert.equal(pose.y, 0, `${id} geometry owns its beam-height offset`);

    const pipe = role(visualFor(id), 'pipe');
    assert.ok(pipe, `${id} must carry a visible beam tube`);
    pipe.geometry.computeBoundingBox();
    const pipeBox = pipe.geometry.boundingBox;
    assert.ok(pipeBox.min.y < 1 && pipeBox.max.y > 1,
      `${id} pipe must straddle the shared 1 m beam axis`);
    assert.ok(pipeBox.min.z <= -0.5 && pipeBox.max.z >= 0.5,
      `${id} pipe must reach both footprint edges`);
  }
});

test('both optics models have distinct multi-material mechanical silhouettes', () => {
  for (const id of ['solenoid', 'collimator']) {
    const roles = visualFor(id).children
      .filter(child => child.isMesh && child.userData.role)
      .map(child => child.userData.role)
      .sort();
    assert.deepEqual(roles, ['accent', 'copper', 'detail', 'iron', 'pipe', 'stand'],
      `${id} needs painted structure, working hardware, beam tube, and supports`);
  }

  const solenoidCopper = role(visualFor('solenoid'), 'copper');
  solenoidCopper.geometry.computeBoundingBox();
  const solenoidWindings = solenoidCopper.geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(solenoidWindings.x > 0.5 && solenoidWindings.y > 0.5,
    'solenoid copper must wrap visibly around the beam instead of filling the bore');

  const collimatorCopper = role(visualFor('collimator'), 'copper');
  collimatorCopper.geometry.computeBoundingBox();
  const collimatorJaws = collimatorCopper.geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(collimatorJaws.x > 0.4 && collimatorJaws.y > 0.4 && collimatorJaws.z > 0.4,
    'collimator must expose four substantial adjustable jaws around the beam');
});

test('the corrected models sit on the floor and stay inside their attachment footprint', () => {
  for (const id of ['solenoid', 'collimator']) {
    const def = COMPONENTS[id];
    const box = new THREE.Box3().setFromObject(visualFor(id));
    const size = box.getSize(new THREE.Vector3());
    assert.ok(box.min.y >= -1e-6, `${id} supports must not sink below the floor`);
    assert.ok(size.x <= def.subW * 0.5 + 1e-6,
      `${id} must stay within its ${def.subW * 0.5} m width`);
    assert.ok(size.z <= def.subL * 0.5 + 0.05,
      `${id} end flanges may only overhang the attachment by their own thickness`);
  }
});
