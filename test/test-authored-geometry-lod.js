import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

globalThis.THREE = THREE;

const {
  buildAuthoredGeometryLod,
  selectLargestAuthoredPartGroups,
  selectLargestAuthoredParts,
} =
  await import('../src/renderer3d/authored-geometry-lod.js');

function box(name, dimensions, position, color = 0x778899, importance = 1) {
  const geometry = new THREE.BoxGeometry(...dimensions);
  geometry.translate(...position);
  return { name, role: name, geometry, color: new THREE.Color(color), importance };
}

test('authored LOD selects exact large primitives with a footprint-scaled group cap', () => {
  const parts = [
    box('main-body', [4, 2, 3], [0, 1, 0]),
    box('top-plate', [3.8, 0.2, 2.8], [0, 2.1, 0]),
    box('side-body', [1.4, 1.4, 2.6], [2.6, 0.8, 0]),
    box('crossbar', [3.2, 0.25, 0.3], [0, 2.5, 0]),
    box('pedestal', [0.5, 2.2, 0.5], [-1.5, 1.1, 0], 0x444444, 0.35),
    box('tiny-bolt-a', [0.05, 0.05, 0.05], [1.9, 2.2, 1.4]),
    box('tiny-bolt-b', [0.04, 0.04, 0.04], [-1.9, 2.2, -1.4]),
  ];

  const selected = selectLargestAuthoredParts(parts, { footprintArea: 12 });
  assert.deepEqual(selected.map(part => part.name),
    ['main-body', 'top-plate', 'side-body', 'crossbar'],
    'selection is based on the authored primitive bounds, not replacement geometry');

  const geometry = buildAuthoredGeometryLod(parts, { footprintArea: 12 });
  assert.equal(geometry.userData.farSilhouetteKind, 'authored-largest-parts');
  assert.equal(geometry.userData.farPartCount, 4);
  assert.equal(geometry.userData.farPrimitiveCount, 4);
  assert.equal(geometry.userData.farSourcePartCount, parts.length);
  assert.deepEqual(geometry.userData.farSelectedPartNames,
    ['main-body', 'top-plate', 'side-body', 'crossbar']);
  assert.equal(geometry.attributes.position.count, 4 * 36,
    'the merged output contains the selected original boxes exactly');

  geometry.dispose();
  for (const part of parts) part.geometry.dispose();
});

test('large footprints receive a larger minimum assembly budget below the cutoff', () => {
  const parts = Array.from({ length: 8 }, (_, index) =>
    box(`small-${index}`, [0.08, 0.08, 0.08], [index * 0.1, 0, 0]));
  const selected = selectLargestAuthoredParts(parts, { footprintArea: 100 });
  assert.equal(selected.length, 5);
  for (const part of parts) part.geometry.dispose();
});

test('rotated and repeated authored primitives remain together as one logical assembly', () => {
  const parts = [];
  for (const [index, x] of [-1.5, -0.5, 0.5, 1.5].entries()) {
    const rib = box(`rib-${index + 1}`, [0.12, 1.6, 2.4], [x, 0.8, 0], 0x666666);
    rib.role = 'detail';
    parts.push(rib);
  }
  parts.push(box('vessel', [3.8, 2, 2.8], [0, 1, 0], 0xaaaaaa));
  parts.push(box('tiny-bolt', [0.04, 0.04, 0.04], [1.8, 2, 1.2]));
  const groups = selectLargestAuthoredPartGroups(parts, {
    footprintArea: 12, minParts: 2, maxParts: 2,
  });
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.parts.map(part => part.name)), [
    ['vessel'], ['rib-1', 'rib-2', 'rib-3', 'rib-4'],
  ]);
  const geometry = buildAuthoredGeometryLod(parts, {
    footprintArea: 12, minParts: 2, maxParts: 2,
  });
  assert.equal(geometry.userData.farPartCount, 2);
  assert.equal(geometry.userData.farPrimitiveCount, 5);
  assert.equal(geometry.attributes.position.count, 5 * 36);
  geometry.dispose();
  for (const part of parts) part.geometry.dispose();
});
