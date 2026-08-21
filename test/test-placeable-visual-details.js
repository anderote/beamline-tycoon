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
const { BEAMLINE_COMPONENTS_RAW } = await import('../src/data/beamline-components.raw.js');
const { COMPONENTS } = await import('../src/data/components.js');
const { ComponentBuilder, isDetailedComponent } =
  await import('../src/renderer3d/component-builder.js');
const { EquipmentBuilder, equipmentPartGlowSpec } =
  await import('../src/renderer3d/equipment-builder.js');
const { BLOOM_LAYER } = await import('../src/renderer3d/glow-pipeline.js');
const {
  PLACEABLE_VISUAL_PROFILES,
  buildPlaceableVisualDetails,
} = await import('../src/renderer3d/placeable-visual-details.js');

function meshCount(object) {
  let count = 0;
  object.traverse(child => { if (child.isMesh) count++; });
  return count;
}

function glowMeshes(object) {
  const meshes = [];
  object.traverse(child => {
    if (child.isMesh && child.userData.role === 'glow') meshes.push(child);
  });
  return meshes;
}

test('every beamline component has dedicated geometry and every actual generic fallback is audited', () => {
  // ROLE_BUILDERS register as direct assignments.  The small legacy map is
  // intentionally explicit, making additions to either renderer path visible
  // in this coverage test without exporting renderer internals just for tests.
  const source = readFileSync(new URL('../src/renderer3d/component-builder.js', import.meta.url), 'utf8');
  const detailed = new Set([
    ...[...source.matchAll(/ROLE_BUILDERS\.([A-Za-z0-9_]+)/g)].map(m => m[1]),
    'source', 'dcPhotoGun', 'ncRfGun', 'srfGun',
    'penningIonSource', 'ionSource', 'ecrIonSource', 'drift',
  ]);
  const missingBeamlineBuilders = Object.values(BEAMLINE_COMPONENTS_RAW)
    .filter(def => !detailed.has(def.id))
    .map(def => def.id);
  assert.deepEqual(missingBeamlineBuilders, [],
    `beamline component(s) missing dedicated geometry: ${missingBeamlineBuilders.join(', ')}`);

  const obsoleteBeamlineProfiles = Object.keys(PLACEABLE_VISUAL_PROFILES)
    .filter(id => BEAMLINE_COMPONENTS_RAW[id]);
  assert.deepEqual(obsoleteBeamlineProfiles, [],
    `dedicated beamline component(s) must not retain fallback profiles: ${obsoleteBeamlineProfiles.join(', ')}`);

  const missingComponentProfiles = Object.values(PLACEABLES)
    .filter(def => def.kind === 'infrastructure' && !detailed.has(def.id))
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
  const component = new ComponentBuilder()._createFallbackMesh(PLACEABLES.bakeoutSystem);
  assert.ok(meshCount(component) > 2,
    'infrastructure fallback retains its housing and gains reviewed mechanical details');

  const parent = new THREE.Group();
  const equipment = new EquipmentBuilder();
  equipment.build([{ type: 'oscilloscope', col: 0, row: 0 }], [], parent);
  assert.equal(parent.children.length, 1);
  assert.ok(meshCount(parent.children[0]) > 2,
    'equipment fallback retains its decal housing and adds bezel, display, controls, and feet');
  equipment.dispose(parent);
});

test('equipment reconciliation preserves unchanged geometry by stable id', () => {
  const parent = new THREE.Group();
  const builder = new EquipmentBuilder();
  const first = { id: 'eq_1', type: 'oscilloscope', col: 0, row: 0 };
  const second = { id: 'eq_2', type: 'flowMeter', col: 2, row: 0 };
  builder.build([first, second], [], parent);
  const firstObject = builder._objectsById.get('equipment:eq_1');
  const secondObject = builder._objectsById.get('equipment:eq_2');

  builder.build([first, { ...second, col: 3 }], [], parent, {
    changes: new Map([['eq_2', { id: 'eq_2', kind: 'equipment', action: 'updated' }]]),
  });
  assert.strictEqual(builder._objectsById.get('equipment:eq_1'), firstObject,
    'unchanged detailed equipment remains attached');
  assert.notStrictEqual(builder._objectsById.get('equipment:eq_2'), secondObject,
    'only the moved equipment is replaced');
  assert.equal(parent.children.length, 2);

  builder.build([first], [], parent, {
    changes: new Map([['eq_2', { id: 'eq_2', kind: 'equipment', action: 'removed' }]]),
  });
  assert.strictEqual(builder._objectsById.get('equipment:eq_1'), firstObject);
  assert.equal(parent.children.length, 1, 'removed equipment alone is detached');
  builder.dispose(parent);
});

test('reviewed electronic profiles expose emissive screens, dials, and indicators to bloom', () => {
  for (const id of ['oscilloscope', 'flowMeter', 'rackIoc', 'areaMonitor', 'projector']) {
    const def = PLACEABLES[id];
    const details = buildPlaceableVisualDetails(def, {
      width: (def.visualSubW ?? def.subW) * 0.5,
      height: (def.visualSubH ?? def.subH) * 0.5,
      length: (def.visualSubL ?? def.subL) * 0.5,
      color: def.spriteColor,
    });
    const glows = glowMeshes(details);
    assert.ok(glows.length > 0, `${id} should publish at least one emissive detail`);
    assert.ok(glows.every(mesh => mesh.layers.isEnabled(BLOOM_LAYER)),
      `${id} emissive details must all reach selective bloom`);
    assert.ok(glows.every(mesh => mesh.castShadow === false && mesh.material.emissive),
      `${id} lit glass and lamps should emit rather than cast shadows`);
    assert.equal(glows.filter(mesh => mesh.userData.ambientLight !== false).length, 1,
      `${id} should nominate one bounded real-light representative`);
  }
});

test('semantic authored parts light screens and LEDs without multiplying real-light candidates', () => {
  const cases = [
    { equipment: [], furnishings: [{ type: 'workstation', col: 0, row: 0 }] },
    { equipment: [], furnishings: [{ type: 'monitorBank', col: 0, row: 0 }] },
    { equipment: [], furnishings: [{ type: 'alarmPanel', col: 0, row: 0 }] },
    { equipment: [{ type: 'daqRack', col: 0, row: 0 }], furnishings: [] },
    { equipment: [{ type: 'cncMill', col: 0, row: 0 }], furnishings: [] },
  ];
  const parent = new THREE.Group();
  const builder = new EquipmentBuilder();
  for (const entry of cases) {
    builder.build(entry.equipment, entry.furnishings, parent);
    const [wrapper] = parent.children;
    const glows = glowMeshes(wrapper);
    assert.ok(glows.length > 0, `${entry.equipment[0]?.type || entry.furnishings[0]?.type} needs live displays or indicators`);
    assert.ok(glows.every(mesh => mesh.layers.isEnabled(BLOOM_LAYER)));
    assert.equal(glows.filter(mesh => mesh.userData.ambientLight !== false).length, 1,
      'one machine can own many emissive pixels but only one pooled point-light candidate');
  }
  builder.dispose(parent);
});

test('part-light classification is semantic and leaves ordinary structure unlit', () => {
  assert.equal(equipmentPartGlowSpec(PLACEABLES.workstation, { name: 'monScreen', color: 0x224466 }).profile, 'screen');
  assert.equal(equipmentPartGlowSpec(PLACEABLES.serverRack, { name: 's3a', color: 0x44ff66 }).profile, 'statusBlink');
  assert.equal(equipmentPartGlowSpec(PLACEABLES.alarmPanel, { name: 'c2', color: 0xffaa40 }).profile, 'statusBlink');
  assert.equal(equipmentPartGlowSpec(PLACEABLES.desk, { name: 'top', color: 0x886644 }), null);
});

test('every source family has bespoke, mechanically detailed 3D geometry', () => {
  const builder = new ComponentBuilder();
  const sourceIds = [
    'source', 'dcPhotoGun', 'ncRfGun', 'srfGun',
    'penningIonSource', 'ionSource', 'ecrIonSource',
  ];
  for (const id of sourceIds) {
    const object = builder._createObject(PLACEABLES[id], PLACEABLES[id].accentColor);
    assert.ok(meshCount(object) >= 8, `${id} has a multi-part source-machine silhouette`);
  }
});

test('early RF driver supplies reuse the matching dedicated machine geometry', () => {
  const builder = new ComponentBuilder();
  for (const [id, family] of [
    ['widebandDriverAmp', 'travelling-wave-tube'],
    ['lowBandBuncherAmp', 'solid-state amplifier'],
  ]) {
    const def = PLACEABLES[id];
    assert.equal(isDetailedComponent(id, def), true,
      `${id} must use its ${family} role builder instead of a plain fallback box`);
    assert.equal(PLACEABLE_VISUAL_PROFILES[id], undefined,
      `${id} should not be papered over with a generic visual profile`);
    const object = builder._createObject(def, def.accentColor);
    assert.ok(meshCount(object) >= 6,
      `${id} needs the mechanically detailed ${family} silhouette`);
  }
});

test('X-ray converter has a purpose-built target, collimator, and detector silhouette', () => {
  const def = PLACEABLES.xRayConverterStation;
  assert.equal(isDetailedComponent(def.id, def), true,
    'the station must bypass generic endpoint geometry');
  const object = new ComponentBuilder()._createObject(def, def.accentColor);
  assert.ok(meshCount(object) >= 6,
    'all six material roles expose the shield cabinet, converter line, fixture, detector, and services');
});

test('NC RF cavity leaves the external waveguide run to its utility port', () => {
  const object = new ComponentBuilder()._createObject(
    PLACEABLES.rfCavity,
    PLACEABLES.rfCavity.accentColor,
  );
  const visual = object.children[0];
  const size = new THREE.Box3().setFromObject(visual).getSize(new THREE.Vector3());
  assert.ok(size.x <= 1.05,
    `rfCavity geometry stays on the 1 m cavity body instead of growing a waveguide stub (${size.x} m)`);
});

test('inline bellows uses a compact visual envelope around its point slot', () => {
  const def = COMPONENTS.bellows;
  const object = new ComponentBuilder()._createObject(def, def.accentColor);
  const visual = object.children[0];
  const size = new THREE.Box3().setFromObject(visual).getSize(new THREE.Vector3());
  assert.ok(size.z <= 0.26,
    `bellows should stay near 0.25 m long instead of filling a 0.5 m subtile (${size.z} m)`);
});
