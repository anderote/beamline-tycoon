import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

globalThis.THREE = THREE;

const { buildAuthoredGeometryLod, selectLargestAuthoredParts } =
  await import('../src/renderer3d/authored-geometry-lod.js');

function box(name, dimensions, position, color = 0x778899, importance = 1) {
  const geometry = new THREE.BoxGeometry(...dimensions);
  geometry.translate(...position);
  return { name, role: name, geometry, color: new THREE.Color(color), importance };
}

test('authored LOD selects exact large primitives with a three-to-five part cap', () => {
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
    ['main-body', 'top-plate', 'side-body'],
    'selection is based on the authored primitive bounds, not replacement geometry');

  const geometry = buildAuthoredGeometryLod(parts, { footprintArea: 12 });
  assert.equal(geometry.userData.farSilhouetteKind, 'authored-largest-parts');
  assert.equal(geometry.userData.farPartCount, 3);
  assert.equal(geometry.userData.farSourcePartCount, parts.length);
  assert.deepEqual(geometry.userData.farSelectedPartNames,
    ['main-body', 'top-plate', 'side-body']);
  assert.equal(geometry.attributes.position.count, 3 * 36,
    'the merged output contains the selected original boxes exactly');

  geometry.dispose();
  for (const part of parts) part.geometry.dispose();
});

test('authored LOD keeps three source parts when every primitive is below cutoff', () => {
  const parts = Array.from({ length: 8 }, (_, index) =>
    box(`small-${index}`, [0.08, 0.08, 0.08], [index * 0.1, 0, 0]));
  const selected = selectLargestAuthoredParts(parts, { footprintArea: 100 });
  assert.equal(selected.length, 3);
  for (const part of parts) part.geometry.dispose();
});
