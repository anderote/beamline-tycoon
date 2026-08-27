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

function farType(parent, type) {
  for (const batch of parent.children.filter(child => child.userData.batchedAttachments
      && child.userData.lod === 'attachment-far')) {
    const metadata = batch.userData.farMetadataByType?.[type];
    if (!metadata) continue;
    const batchIds = batch.userData.types
      .flatMap((candidate, index) => candidate === type ? [index] : []);
    return { batch, metadata, batchIds };
  }
  return null;
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
    const far = farType(parent, id);
    assert.equal(far?.metadata.farSilhouetteKind, 'authored-largest-parts');
    assert.equal(far?.batch.material.vertexColors, true);
    assert.ok(far?.metadata.farPrimitiveCount >= 1);
    assert.equal(far?.batch.visible, true);
  }
  assert.ok(farType(parent, 'quadrupole').metadata.farSelectedGroupNames
    .includes('quadrupole-yoke'));
  assert.equal(new Set(['rfCavity', 'quadrupole', 'bpm', 'fastKicker']
    .map(id => farType(parent, id).batch.material)).size, 1,
  'all authored pipe attachments share one warmed far material pipeline');
  assert.equal(builder.getBatchStats().farBatches, 1,
    'compatible attachment silhouettes share one GPU allocation');
  assert.ok(builder.getBatchStats().farBatches > 0);
  assert.ok(builder.getBatchStats().nearBatches > 0);
  const quad = farType(parent, 'quadrupole');
  const quadFace = quad.batch.userData.farTriangleRanges[quad.batchIds[0]].start;
  assert.equal(builder.resolveBatchHit({ object: quad.batch, faceIndex: quadFace }).attachmentId,
    'quadrupole-1', 'merged far geometry retains attachment picking identity');

  builder.dispose(parent);
});

test('far attachment LOD preserves the authored model bounds', () => {
  const parent = new THREE.Group();
  const builder = new PipeAttachmentBuilder();
  builder.build([attachment('spokeCavity', 0)], parent);

  const far = farType(parent, 'spokeCavity');
  const size = far.metadata.localBounds.getSize(new THREE.Vector3());
  assert.ok(size.x > 1.2 && size.x < 1.4,
    'side couplers extend the authored cryostat width');
  assert.ok(size.y > 2.4 && size.y < 2.5,
    'top cryogenic ports retain the authored height');
  assert.ok(size.z > 2 && size.z < 2.1,
    'beam flanges retain the authored beam-axis length');
  assert.ok(far.metadata.farSelectedPartNames
    .includes('pipe-1'), 'the main grey cryostat is present');

  builder.dispose(parent);
});
