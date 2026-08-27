// Far pipe-attachment geometry is exported from the authored model rather than
// replacing magnets and cavities with catalogue cylinders and boxes.

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

test('zoomed-out attachments keep authored silhouettes and role colors', () => {
  const parent = new THREE.Group();
  const builder = new PipeAttachmentBuilder();
  builder.build([
    attachment('rfCavity', 0),
    attachment('quadrupole', 1),
    attachment('bpm', 2),
    attachment('fastKicker', 3),
  ], parent);
  builder.setDetailLevel(false);

  for (const id of ['rfCavity', 'quadrupole', 'bpm', 'fastKicker']) {
    const far = farMesh(parent, id);
    assert.equal(far?.userData.farSilhouetteKind, 'authored-largest-parts');
    assert.equal(far?.material.vertexColors, true);
    assert.ok(far?.userData.farPrimitiveCount >= 1);
    assert.equal(far?.visible, true);
  }
  assert.ok(farMesh(parent, 'quadrupole').userData.farSelectedGroupNames
    .includes('quadrupole-yoke'));
  assert.equal(new Set(['rfCavity', 'quadrupole', 'bpm', 'fastKicker']
    .map(id => farMesh(parent, id).material)).size, 1,
  'all authored pipe attachments share one warmed far material pipeline');
  assert.ok(builder.getBatchStats().farBatches > 0);
  assert.ok(builder.getBatchStats().nearBatches > 0);

  builder.dispose(parent);
});

test('far attachment LOD preserves the authored model bounds', () => {
  const parent = new THREE.Group();
  const builder = new PipeAttachmentBuilder();
  builder.build([attachment('spokeCavity', 0)], parent);

  const geometry = farMesh(parent, 'spokeCavity').geometry;
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(size.x > 1.2 && size.x < 1.4,
    'side couplers extend the authored cryostat width');
  assert.ok(size.y > 2.4 && size.y < 2.5,
    'top cryogenic ports retain the authored height');
  assert.ok(size.z > 2 && size.z < 2.1,
    'beam flanges retain the authored beam-axis length');
  assert.ok(farMesh(parent, 'spokeCavity').userData.farSelectedPartNames
    .includes('pipe-1'), 'the main grey cryostat is present');

  builder.dispose(parent);
});
