// Far pipe-attachment geometry retains catalogue dimensions, broad shape, and
// color while replacing tiny authored detail with one instance per type.

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

test('zoomed-out attachment views keep catalogue silhouettes', () => {
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
    assert.equal(farMesh(parent, id)?.geometry.type, 'CylinderGeometry');
    assert.equal(farMesh(parent, id)?.visible, true);
  }
  assert.equal(COMPONENTS.fastKicker.geometryType, 'box');
  assert.equal(farMesh(parent, 'fastKicker')?.geometry.type, 'BoxGeometry');
  assert.ok(builder.getBatchStats().farBatches > 0);
  assert.ok(builder.getBatchStats().nearBatches > 0);

  builder.dispose(parent);
});

test('far LOD preserves authored width, height, and beam-axis length', () => {
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
