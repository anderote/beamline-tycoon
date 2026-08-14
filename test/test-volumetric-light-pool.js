import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as ThreeModule from 'three';

globalThis.THREE = ThreeModule;
const { VolumetricLightPool } = await import('../src/renderer3d/volumetric-light-pool.js');

function candidate(id = 'beam') {
  return {
    id,
    color: '#ffe0a0',
    weight: 1,
    volumeProfile: 'downlight',
    projection: {
      emitter: { x: 1, y: 4, z: 2 },
      target: { x: 1, y: 0, z: 2 },
      halfAngle: Math.PI / 8,
    },
  };
}

test('volumetric pool allocates once, aligns a beam, and fully parks low quality', () => {
  const scene = new THREE.Scene();
  const pool = new VolumetricLightPool(scene, { maxCount: 6, activeCount: 3 });
  const group = pool.group;
  assert.equal(group.children.length, 6, 'Ultra maximum is allocated exactly once');
  const rig = { _clockMs: 1000, getVolumeCandidates: () => [candidate()] };
  pool.update(rig, 1, 1);
  assert.equal(pool.getStats().visibleVolumes, 1);
  const beam = group.children[0];
  assert.deepEqual(beam.position.toArray(), [1, 2, 2], 'beam is centered between shared emitter and target');
  assert.equal(beam.material.depthWrite, false);
  assert.equal(beam.material.depthTest, true);

  pool.setQuality({ volumetricCount: 0 });
  pool.update(rig, 1, 1);
  assert.equal(pool.getStats().visibleVolumes, 0);
  assert.equal(group.children.length, 6, 'preset changes never add or remove proxy meshes');
  pool.dispose();
  assert.equal(scene.children.includes(group), false);
});
