// Regression coverage for the visual-detail audit.  A fallback housing may
// still supply its texture/decal face, but it must no longer be the whole 3D
// model for any reviewed placeable.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
      width: 0, height: 0,
      getContext() {
        return {
          createRadialGradient() { return { addColorStop() {} }; },
          fillRect() {}, fillStyle: null,
        };
      },
    };
  },
};

const { PLACEABLES } = await import('../src/data/placeables/index.js');
const { ComponentBuilder } = await import('../src/renderer3d/component-builder.js');
const { EquipmentBuilder } = await import('../src/renderer3d/equipment-builder.js');
const {
  PLACEABLE_VISUAL_PROFILES,
  buildPlaceableVisualDetails,
} = await import('../src/renderer3d/placeable-visual-details.js');

function meshCount(object) {
  let count = 0;
  object.traverse(child => { if (child.isMesh) count++; });
  return count;
}

test('every actual generic placeable fallback is covered by the visual-detail audit', () => {
  // ROLE_BUILDERS register as direct assignments.  The small legacy map is
  // intentionally explicit, making additions to either renderer path visible
  // in this coverage test without exporting renderer internals just for tests.
  const source = readFileSync(new URL('../src/renderer3d/component-builder.js', import.meta.url), 'utf8');
  const detailed = new Set([
    ...[...source.matchAll(/ROLE_BUILDERS\.([A-Za-z0-9_]+)/g)].map(m => m[1]),
    'source', 'ionSource', 'ecrIonSource', 'drift',
  ]);
  const missingComponentProfiles = Object.values(PLACEABLES)
    .filter(def => (def.kind === 'beamline' || def.kind === 'infrastructure') && !detailed.has(def.id))
    .filter(def => !PLACEABLE_VISUAL_PROFILES[def.id])
    .map(def => def.id);
  assert.deepEqual(missingComponentProfiles, [],
    `component fallback(s) missing a reviewed profile: ${missingComponentProfiles.join(', ')}`);

  const missingFacilityProfiles = Object.values(PLACEABLES)
    .filter(def => (def.kind === 'furnishing' || def.kind === 'equipment') && !(def.parts?.length))
    .filter(def => !PLACEABLE_VISUAL_PROFILES[def.id])
    .map(def => def.id);
  assert.deepEqual(missingFacilityProfiles, [],
    `facility fallback(s) missing a reviewed profile: ${missingFacilityProfiles.join(', ')}`);
});

test('every reviewed profile creates physical geometry beyond the fallback housing', () => {
  for (const id of Object.keys(PLACEABLE_VISUAL_PROFILES)) {
    const def = PLACEABLES[id];
    assert.ok(def, `${id} must stay a real placeable`);
    const width = (def.visualSubW ?? def.subW) * 0.5 - 0.06;
    const height = (def.visualSubH ?? def.subH) * 0.5;
    const length = (def.visualSubL ?? def.subL) * 0.5 - 0.06;
    const details = buildPlaceableVisualDetails(def, {
      width, height, length, color: def.spriteColor,
    });
    assert.ok(details, `${id} must produce its ${PLACEABLE_VISUAL_PROFILES[id]} profile`);
    assert.ok(meshCount(details) >= 2, `${id} needs more than one decorative mesh`);
  }
});

test('component and facility render paths both retain their housing and add detail meshes', () => {
  const component = new ComponentBuilder()._createFallbackMesh(PLACEABLES.cyclotron30);
  assert.ok(meshCount(component) > 2, 'cyclotron fallback gains a body, rings, and support details');

  const parent = new THREE.Group();
  const equipment = new EquipmentBuilder();
  equipment.build([{ type: 'oscilloscope', col: 0, row: 0 }], [], parent);
  assert.equal(parent.children.length, 1);
  assert.ok(meshCount(parent.children[0]) > 2,
    'equipment fallback retains its decal housing and adds bezel, display, controls, and feet');
  equipment.dispose(parent);
});
