// Component wrappers must stay independently pickable while renderer-owned
// category groups provide efficient world-layer visibility boundaries.

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

const { ComponentBuilder } = await import('../src/renderer3d/component-builder.js');
const { COMPONENTS } = await import('../src/data/components.js');

function component(id, category, col, type = 'quadrupole') {
  return {
    id,
    type,
    category,
    col,
    row: 0,
    subCol: 0,
    subRow: 0,
    direction: 0,
  };
}

test('component builder routes and reparents wrappers by presentation category', () => {
  const parent = new THREE.Group();
  const beamline = new THREE.Group();
  const infrastructure = new THREE.Group();
  parent.add(beamline, infrastructure);
  const categoryGroups = { beamline, infrastructure };
  const builder = new ComponentBuilder();

  builder.build([
    component('beam-1', 'beamline', 0),
    component('infra-1', 'infrastructure', 1),
  ], parent, { categoryGroups });

  assert.equal(builder.getGroup('beam-1').parent, beamline);
  assert.equal(builder.getGroup('infra-1').parent, infrastructure);
  assert.equal(builder.getGroup('beam-1').userData.presentationCategory, 'beamline');

  builder.build([component('beam-1', 'infrastructure', 0)], parent, { categoryGroups });
  assert.equal(builder.getGroup('beam-1').parent, infrastructure,
    'a live category change reparents an existing wrapper');
  assert.equal(builder.getGroup('infra-1'), null, 'stale wrappers are removed from nested groups');

  builder.dispose(parent);
  assert.equal(infrastructure.children.length, 0);
});

test('far component presentation batches instances without losing picking ids', () => {
  const parent = new THREE.Group();
  const beamline = new THREE.Group();
  parent.add(beamline);
  const builder = new ComponentBuilder();
  const components = Array.from({ length: 40 }, (_, index) =>
    component(`beam-${index}`, 'beamline', index));

  builder.build(components, parent, { categoryGroups: { beamline } });
  const far = beamline.children.find(child => child.userData.batchedComponents);
  assert.ok(far?.isInstancedMesh);
  assert.equal(far.count, components.length);
  assert.equal(far.visible, false);

  builder.setDetailLevel(false);
  assert.equal(far.visible, true);
  assert.equal(builder.getGroup('beam-0').visible, false);
  assert.equal(builder.resolveBatchHit({ object: far, instanceId: 17 }).nodeId, 'beam-17');

  builder.setDetailLevel(true);
  assert.equal(far.visible, false);
  assert.equal(builder.getGroup('beam-0').visible, true);
  builder.dispose(parent);
});

test('far beamline presentation keeps type identity without full-footprint color blocks', () => {
  const parent = new THREE.Group();
  const beamline = new THREE.Group();
  parent.add(beamline);
  const builder = new ComponentBuilder();
  const components = [
    component('drift-far', 'beamline', 0, 'drift'),
    component('quad-far', 'beamline', 2, 'quadrupole'),
    component('cyclotron-far', 'beamline', 4, 'cyclotron30'),
    component('target-far', 'beamline', 8, 'target'),
    component('hwr-far', 'beamline', 10, 'halfWaveResonator'),
    component('spoke-far', 'beamline', 12, 'spokeCavity'),
    component('elliptical-far', 'beamline', 15, 'ellipticalSrfCavity'),
  ];

  builder.build(components, parent, { categoryGroups: { beamline } });
  builder.setDetailLevel(false);
  const batches = beamline.children.filter(child => child.userData.batchedComponents);
  const byType = new Map(batches.map(batch => [
    batch.name.replace('component-far-', ''), batch,
  ]));

  assert.equal(byType.get('drift')?.userData.farSilhouetteKind, 'beam-pipe');
  assert.equal(byType.get('quadrupole')?.userData.farSilhouetteKind, 'quadrupole-magnet');
  assert.equal(byType.get('cyclotron30')?.userData.farSilhouetteKind, 'cyclotron');
  assert.equal(byType.get('target')?.userData.farSilhouetteKind, 'beam-target');
  assert.equal(byType.get('halfWaveResonator')?.userData.farSilhouetteKind,
    'half-wave-resonator');
  assert.equal(byType.get('spokeCavity')?.userData.farSilhouetteKind, 'spoke-cavity');
  assert.equal(byType.get('ellipticalSrfCavity')?.userData.farSilhouetteKind,
    'elliptical-srf-cavity');
  assert.deepEqual(new Set(byType.get('drift').userData.farPartRoles),
    new Set(['pipe', 'stand']),
  'a drift stays a thin pipe on supports rather than becoming a footprint box');
  assert.ok(['stand', 'body', 'accent', 'pipe'].every(role =>
    byType.get('cyclotron30').userData.farPartRoles.includes(role)),
  'the cyclotron retains a base, squat body, identifying band, and extraction pipe');
  assert.ok(['pipe', 'target', 'accent'].every(role =>
    byType.get('target').userData.farPartRoles.includes(role)),
  'the target retains its incoming beam tube and a restrained target body');
  assert.ok(['accent', 'darkBody', 'copper', 'pipe', 'stand'].every(role =>
    byType.get('quadrupole').userData.farPartRoles.includes(role)),
  'the quadrupole retains its hollow diamond yoke, poles, coils, pipe, and stand');
  assert.ok(['cryostat', 'darkBody', 'accent', 'pipe', 'stand'].every(role =>
    byType.get('halfWaveResonator').userData.farPartRoles.includes(role)),
  'the half-wave resonator remains an upright ribbed cryostat with a side coupler');
  assert.ok(byType.get('spokeCavity').userData.farPartCount
    > byType.get('halfWaveResonator').userData.farPartCount,
  'the spoke cavity keeps its paired couplers and cryogenic ports');
  assert.ok(byType.get('ellipticalSrfCavity').userData.farPartCount >= 12,
    'the elliptical SRF cavity keeps a readable multi-cell profile');

  for (const batch of batches) {
    assert.equal(batch.material.vertexColors, true,
      `${batch.name} uses merged per-part colors in one draw`);
    const colors = batch.geometry.attributes.color;
    const distinct = new Set();
    for (let index = 0; index < colors.count; index++) {
      distinct.add(`${colors.getX(index).toFixed(3)}:${colors.getY(index).toFixed(3)}:${colors.getZ(index).toFixed(3)}`);
    }
    assert.ok(distinct.size >= 2,
      `${batch.name} is not one solid beamline-accent block`);
    assert.equal(batch.castShadow, false);
  }
  assert.equal(builder.resolveBatchHit({ object: byType.get('target'), instanceId: 0 }).nodeId,
    'target-far', 'every simplified silhouette remains pickable');

  builder.dispose(parent);
});

test('every beamline catalogue type has a merged facility-scale silhouette', () => {
  const catalogueCategories = new Set(['source', 'rf', 'optics', 'diagnostic', 'endpoint']);
  const types = Object.values(COMPONENTS)
    .filter(def => catalogueCategories.has(def.category))
    .map(def => def.id)
    .sort();
  const parent = new THREE.Group();
  const beamline = new THREE.Group();
  parent.add(beamline);
  const builder = new ComponentBuilder();
  const components = types.map((type, index) =>
    component(`catalogue-far-${type}`, 'beamline', index * 8, type));

  builder.build(components, parent, { categoryGroups: { beamline } });
  builder.setDetailLevel(false);
  const batches = beamline.children.filter(child => child.userData.batchedComponents);
  assert.equal(batches.length, types.length,
    'every catalogue type contributes one batched silhouette draw');
  for (const batch of batches) {
    assert.ok(batch.userData.farSilhouetteKind !== 'footprint',
      `${batch.name} uses a type-aware silhouette`);
    assert.ok(batch.userData.farPartRoles.includes('pipe'),
      `${batch.name} preserves the common beam tube`);
    assert.ok(batch.geometry.attributes.color?.count > 0,
      `${batch.name} publishes merged per-part color geometry`);
  }

  builder.dispose(parent);
});

test('every infrastructure catalogue type has a merged facility-scale silhouette', () => {
  const catalogueCategories = new Set([
    'power', 'rfPower', 'cooling', 'vacuum', 'dataControls', 'ops',
    'experimentalSystems',
  ]);
  const types = Object.values(COMPONENTS)
    .filter(def => catalogueCategories.has(def.category))
    .map(def => def.id)
    .sort();
  const parent = new THREE.Group();
  const infrastructure = new THREE.Group();
  parent.add(infrastructure);
  const builder = new ComponentBuilder();
  const components = types.map((type, index) =>
    component(`catalogue-far-${type}`, 'infrastructure', index * 8, type));

  builder.build(components, parent, { categoryGroups: { infrastructure } });
  builder.setDetailLevel(false);
  const batches = infrastructure.children.filter(child => child.userData.batchedComponents);
  assert.equal(batches.length, types.length,
    'every infrastructure type contributes one batched silhouette draw');
  for (const batch of batches) {
    assert.notEqual(batch.userData.farSilhouetteKind, 'footprint',
      `${batch.name} uses a type-aware silhouette`);
    assert.ok(batch.userData.farPartRoles.length >= 2,
      `${batch.name} retains at least two visually distinct structural roles`);
    assert.ok(batch.geometry.attributes.color?.count > 0,
      `${batch.name} publishes merged per-part color geometry`);
    assert.equal(batch.material.vertexColors, true);
    assert.equal(batch.castShadow, false);
  }

  builder.dispose(parent);
});
