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

function farType(group, type) {
  for (const batch of group.children.filter(child => child.userData.batchedComponents)) {
    const metadata = batch.userData.farMetadataByType?.[type];
    if (!metadata) continue;
    const batchIds = batch.userData.types
      .flatMap((candidate, index) => candidate === type ? [index] : []);
    return { batch, metadata, batchIds };
  }
  return null;
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
  assert.ok(far?.isMesh && !far.isBatchedMesh,
    'far geometry uses an ordinary merged mesh, avoiding the multi-draw GPU path');
  assert.equal(far.userData.componentIds.length, components.length);
  assert.equal(far.visible, false);

  builder.setDetailLevel(false);
  assert.equal(far.visible, true);
  assert.equal(builder.getGroup('beam-0').visible, false);
  const beamFace = far.userData.farTriangleRanges[17].start;
  assert.equal(builder.resolveBatchHit({ object: far, faceIndex: beamFace }).nodeId, 'beam-17');

  builder.setDetailLevel(true);
  assert.equal(far.visible, false);
  assert.equal(builder.getGroup('beam-0').visible, true);
  builder.dispose(parent);
});

test('authored far geometry stays local when its first live source is off-origin', () => {
  const localCenterAt = (col) => {
    const parent = new THREE.Group();
    const beamline = new THREE.Group();
    parent.add(beamline);
    const builder = new ComponentBuilder();
    builder.build([
      component(`source-${col}`, 'beamline', col, 'thermionicGun'),
    ], parent, { categoryGroups: { beamline } });
    const center = farType(beamline, 'thermionicGun').metadata.localBounds
      .getCenter(new THREE.Vector3());
    builder.dispose(parent);
    return center;
  };

  const origin = localCenterAt(0);
  const translated = localCenterAt(18);
  assert.ok(origin.distanceTo(translated) < 1e-6,
    'the cached silhouette excludes the first source instance world transform');
});

test('far beamline presentation is derived from a bounded set of authored primitives', () => {
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
  const byType = new Map(components.map(({ type }) => [type, farType(beamline, type)]));

  for (const [type, presentation] of byType) {
    const { batch, metadata } = presentation;
    assert.equal(metadata.farSilhouetteKind, 'authored-largest-parts');
    assert.ok(metadata.farPartCount >= 1 && metadata.farPartCount <= 8,
      `${type} keeps a bounded footprint-scaled assembly silhouette`);
    assert.ok(metadata.farSourcePartCount > metadata.farPrimitiveCount,
      `${type} drops smaller authored geometry`);
    assert.equal(metadata.farSelectedPartNames.length, metadata.farPrimitiveCount);
    assert.equal(metadata.farSelectedGroupNames.length, metadata.farPartCount);
    assert.equal(batch.material.vertexColors, true,
      `${type} carries its selected primitives' authored role colours`);
    assert.equal(batch.castShadow, false);
  }
  assert.ok(batches.length <= 2,
    'all selected beamline geometry is packed into at most two index-compatible batches');
  assert.equal(new Set(batches.map(batch => batch.material)).size, 1,
    'authored component types reuse one opaque far material pipeline');
  assert.ok(byType.get('halfWaveResonator').metadata.farSelectedPartNames
    .includes('pipe-1'), 'the HWR retains its exact main cryostat primitive');
  assert.ok(byType.get('spokeCavity').metadata.farSelectedPartNames
    .includes('pipe-1'), 'the spoke cavity retains its exact main cryostat primitive');
  assert.ok(byType.get('quadrupole').metadata.farPartRoles.includes('copper')
    && byType.get('quadrupole').metadata.farPrimitiveCount >= 16,
  'the quadrupole retains its complete symmetric yoke, poles, and coil bars');
  assert.ok(byType.get('spokeCavity').metadata.farPrimitiveCount > 5,
    'the spoke cavity keeps its repeated stiffener assembly');
  assert.ok(byType.get('spokeCavity').metadata.farPartRoles.includes('accent'),
    'the spoke cavity keeps a characteristic red RF-coupler assembly');
  assert.deepEqual(byType.get('quadrupole').metadata.farSelectedGroupNames, [
    'quadrupole-yoke',
    'quadrupole-poles',
    'quadrupole-coils',
    'quadrupole-beam-pipe',
  ], 'the quad far mesh copies its four defining authored assemblies');
  assert.deepEqual(byType.get('spokeCavity').metadata.farSelectedGroupNames, [
    'spoke-cryostat',
    'spoke-ridges',
    'spoke-rf-couplers',
    'spoke-cryo-ports',
    'spoke-beam-line',
    'spoke-base',
  ], 'the spoke far mesh copies its defining authored assemblies');
  const expectedAccent = new THREE.Color(0xc62828);
  assert.ok(byType.get('quadrupole').metadata.farColorTriples
    .some(([r, g, b]) => Math.abs(r - expectedAccent.r) < 1e-6
      && Math.abs(g - expectedAccent.g) < 1e-6
      && Math.abs(b - expectedAccent.b) < 1e-6),
  'the far quadrupole uses the same default red accent as its near model');
  assert.ok(byType.get('ellipticalSrfCavity').metadata.vertexCount / 3 > 300,
    'the elliptical cavity retains original curved cells instead of replacement boxes');
  assert.ok(byType.get('cyclotron30').metadata.vertexCount / 3 > 500,
    'the cyclotron retains its large authored curved body geometry');
  const target = byType.get('target');
  const targetFace = target.batch.userData.farTriangleRanges[target.batchIds[0]].start;
  assert.equal(builder.resolveBatchHit({ object: target.batch, faceIndex: targetFace }).nodeId,
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
  assert.ok(batches.length < types.length / 10,
    'the beamline catalogue shares a bounded number of GPU batches');
  for (const type of types) {
    const metadata = farType(beamline, type)?.metadata;
    assert.equal(metadata?.farSilhouetteKind, 'authored-largest-parts',
      `${type} is selected from the detailed model`);
    assert.ok(metadata.farPartCount <= 8,
      `${type} stays inside the footprint-scaled assembly budget`);
    assert.ok(metadata.farPrimitiveCount >= 1,
      `${type} keeps at least its dominant authored primitive`);
    assert.ok(metadata.farSourcePartCount >= metadata.farPrimitiveCount);
    assert.ok(metadata.farPrimitiveCount <= 36);
    assert.equal(metadata.hasVertexColors, true,
      `${type} publishes merged per-part color geometry`);
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
  assert.ok(batches.length < types.length / 10,
    'the infrastructure catalogue shares a bounded number of GPU batches');
  for (const type of types) {
    const presentation = farType(infrastructure, type);
    const { batch, metadata } = presentation;
    assert.equal(metadata.farSilhouetteKind, 'authored-largest-parts',
      `${type} is selected from the detailed model`);
    assert.ok(metadata.farPartCount <= 8,
      `${type} stays inside the footprint-scaled assembly budget`);
    assert.ok(metadata.farPrimitiveCount >= 1,
      `${type} keeps at least its dominant authored primitive`);
    assert.ok(metadata.farSourcePartCount >= metadata.farPrimitiveCount);
    assert.ok(metadata.farPrimitiveCount <= 36);
    assert.equal(metadata.hasVertexColors, true,
      `${type} publishes merged per-part color geometry`);
    assert.equal(batch.material.vertexColors, true);
    assert.equal(batch.castShadow, false);
  }

  const elevatedTray = farType(infrastructure, 'elevatedWireTray');
  assert.equal(elevatedTray?.metadata.farSourcePartCount, 7);
  assert.equal(elevatedTray?.metadata.farPrimitiveCount, 5,
    'the overhead data rack keeps its authored foot, upright, crossbar, saddle, and bracket');
  const traySize = new THREE.Vector3();
  elevatedTray.metadata.localBounds.getSize(traySize);
  assert.ok(traySize.y > 1.5 && traySize.z > 0.8,
    'the far overhead rack retains the authored L-frame proportions');

  for (const [type, minimumPrimitives] of [
    ['coolingTower', 8],
    ['waterTank', 5],
    ['bulkWaterTank', 5],
    ['facilityWaterSupply', 4],
  ]) {
    const presentation = farType(infrastructure, type);
    assert.ok(presentation?.metadata.farPrimitiveCount >= minimumPrimitives,
      `${type} retains its vessel/tank assembly rather than a footprint proxy`);
  }

  builder.dispose(parent);
});
