import assert from 'node:assert/strict';
import {
  LOWER_STOREY_OPACITY, applyStoreyGhost, restoreStoreyGhost,
} from '../src/renderer3d/storey-ghost-material.js';

function material(overrides = {}) {
  return {
    opacity: 1,
    transparent: false,
    depthWrite: true,
    alphaTest: 0,
    emissiveIntensity: 2,
    visible: true,
    userData: {},
    disposed: false,
    clone() {
      return { ...this, userData: { ...this.userData }, disposed: false };
    },
    dispose() { this.disposed = true; },
    ...overrides,
  };
}

const opaque = material({ alphaTest: 0.5 });
const glass = material({ opacity: 0.12, transparent: true });
const invisible = material({ visible: false });
const mesh = {
  material: [opaque, glass, invisible],
  castShadow: true,
  receiveShadow: true,
  userData: {},
  layers: { mask: 3, set(value) { this.mask = 1 << value; } },
};
const root = { traverse(visitor) { visitor(mesh); } };

applyStoreyGhost(root);
assert.notEqual(mesh.material[0], opaque, 'ghosting clones shared opaque materials');
assert.equal(mesh.material[0].opacity, LOWER_STOREY_OPACITY);
assert.equal(mesh.material[0].transparent, true);
assert.equal(mesh.material[0].depthWrite, false);
assert.ok(mesh.material[0].alphaTest < LOWER_STOREY_OPACITY,
  'cutout alpha thresholds stay below ghost opacity');
assert.equal(mesh.material[0].emissiveIntensity, 0, 'lower floors do not retain active glows');
assert.equal(mesh.material[1].opacity, 0.12, 'authored glass never becomes more opaque');
assert.equal(mesh.material[2], invisible, 'invisible hit-test materials remain untouched');
assert.equal(mesh.castShadow, false);
assert.equal(mesh.receiveShadow, false);
assert.equal(mesh.layers.mask, 1, 'ghosts leave bloom-only layers');

const ghost = mesh.material[0];
restoreStoreyGhost(root);
assert.deepEqual(mesh.material, [opaque, glass, invisible], 'restore reinstates shared base materials');
assert.equal(ghost.disposed, true, 'restore disposes the per-ghost material clone');
assert.equal(mesh.castShadow, true);
assert.equal(mesh.receiveShadow, true);
assert.equal(mesh.layers.mask, 3);

console.log('lower-storey ghost material tests passed');
