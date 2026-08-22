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

test('zoomed-out attachment views keep authored geometry', () => {
  const parent = new THREE.Group();
  const builder = new PipeAttachmentBuilder();
  builder.build([
    attachment('rfCavity', 0),
    attachment('quadrupole', 1),
    attachment('bpm', 2),
    attachment('fastKicker', 3),
  ], parent);
  builder.setDetailLevel(false);

  assert.equal(builder.getBatchStats().farBatches, 0,
    'the low-resolution attachment batch is disabled');
  assert.equal(parent.children.some(child => child.name?.startsWith('attachment-far-')), false,
    'zoomed-out views must not add far attachment meshes');
  assert.ok(builder.getBatchStats().nearBatches > 0,
    'authored attachment geometry remains live');

  builder.dispose(parent);
});

test('disabled far LOD does not discard the component catalogue geometry', () => {
  const parent = new THREE.Group();
  const builder = new PipeAttachmentBuilder();
  builder.build([attachment('rfCavity', 0)], parent);

  assert.equal(COMPONENTS.rfCavity.geometryType, 'cylinder');
  assert.equal(builder.getBatchStats().farBatches, 0);
  assert.ok(builder.getBatchStats().authoredParts > 0);

  builder.dispose(parent);
});
