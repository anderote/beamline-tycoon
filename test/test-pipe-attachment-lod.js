// Far pipe-attachment geometry should retain the broad silhouette authored in
// the component catalogue instead of reducing every item to the same box.

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
const { PipeAttachmentBuilder } =
  await import('../src/renderer3d/pipe-attachment-builder.js');

function attachment(id, index) {
  return {
    id: `${id}-${index}`,
    type: id,
    col: index * 2,
    row: 0,
    subCol: null,
    subRow: null,
    direction: 0,
    pipeId: 'pipe-1',
  };
}

function farMesh(parent, id) {
  return parent.getObjectByName(`attachment-far-${id}`);
}

test('far attachment LOD honors cylindrical and box catalogue silhouettes', () => {
  const parent = new THREE.Group();
  const builder = new PipeAttachmentBuilder();
  builder.build([
    attachment('rfCavity', 0),
    attachment('quadrupole', 1),
    attachment('bpm', 2),
    attachment('fastKicker', 3),
  ], parent);
  builder.setDetailLevel(false);

  for (const id of ['rfCavity', 'quadrupole', 'bpm']) {
    assert.equal(COMPONENTS[id].geometryType, 'cylinder');
    const mesh = farMesh(parent, id);
    assert.ok(mesh, `${id} needs a far-LOD batch`);
    assert.equal(mesh.geometry.type, 'CylinderGeometry',
      `${id} should stay cylindrical when zoomed out`);
    assert.equal(mesh.visible, true);
  }

  assert.equal(COMPONENTS.fastKicker.geometryType, 'box');
  assert.equal(farMesh(parent, 'fastKicker').geometry.type, 'BoxGeometry',
    'cabinet-shaped beam hardware should retain a box silhouette');

  builder.dispose(parent);
});

test('cylindrical far LOD preserves authored width, height and beam-axis length', () => {
  const parent = new THREE.Group();
  const builder = new PipeAttachmentBuilder();
  builder.build([attachment('rfCavity', 0)], parent);

  const geometry = farMesh(parent, 'rfCavity').geometry;
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const def = COMPONENTS.rfCavity;
  assert.ok(Math.abs(size.x - def.subW * 0.5) < 1e-6);
  assert.ok(Math.abs(size.y - def.subH * 0.5) < 1e-6);
  assert.ok(Math.abs(size.z - def.subL * 0.5) < 1e-6);

  builder.dispose(parent);
});
