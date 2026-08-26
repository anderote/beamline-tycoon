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
  const byType = new Map(batches.map(batch => [
    batch.name.replace('component-far-', ''), batch,
  ]));

  for (const batch of batches) {
    assert.equal(batch.userData.farSilhouetteKind, 'authored-largest-parts');
    assert.ok(batch.userData.farPartCount >= 3 && batch.userData.farPartCount <= 5,
      `${batch.name} keeps a bounded three-to-five-part silhouette`);
    assert.ok(batch.userData.farSourcePartCount > batch.userData.farPartCount,
      `${batch.name} drops smaller authored geometry`);
    assert.equal(batch.userData.farSelectedPartNames.length,
      batch.userData.farPartCount);
    assert.equal(batch.material.vertexColors, true,
      `${batch.name} carries its selected primitives' authored role colours`);
    assert.equal(batch.castShadow, false);
  }
  assert.ok(byType.get('halfWaveResonator').userData.farSelectedPartNames
    .includes('pipe-1'), 'the HWR retains its exact main cryostat primitive');
  assert.ok(byType.get('spokeCavity').userData.farSelectedPartNames
    .includes('pipe-1'), 'the spoke cavity retains its exact main cryostat primitive');
  assert.ok(byType.get('ellipticalSrfCavity').geometry.attributes.position.count / 3 > 300,
    'the elliptical cavity retains original curved cells instead of replacement boxes');
  assert.ok(byType.get('cyclotron30').geometry.attributes.position.count / 3 > 500,
    'the cyclotron retains its large authored curved body geometry');
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
    assert.equal(batch.userData.farSilhouetteKind, 'authored-largest-parts',
      `${batch.name} is selected from the detailed model`);
    assert.ok(batch.userData.farPartCount <= 5,
      `${batch.name} stays inside the authored-part budget`);
    assert.ok(batch.userData.farPartCount >= Math.min(3, batch.userData.farSourcePartCount),
      `${batch.name} keeps three primitives when its source has them`);
    assert.ok(batch.userData.farSourcePartCount >= batch.userData.farPartCount);
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
    assert.equal(batch.userData.farSilhouetteKind, 'authored-largest-parts',
      `${batch.name} is selected from the detailed model`);
    assert.ok(batch.userData.farPartCount <= 5,
      `${batch.name} stays inside the authored-part budget`);
    assert.ok(batch.userData.farPartCount >= Math.min(3, batch.userData.farSourcePartCount),
      `${batch.name} keeps three primitives when its source has them`);
    assert.ok(batch.userData.farSourcePartCount >= batch.userData.farPartCount);
    assert.ok(batch.geometry.attributes.color?.count > 0,
      `${batch.name} publishes merged per-part color geometry`);
    assert.equal(batch.material.vertexColors, true);
    assert.equal(batch.castShadow, false);
  }

  const elevatedTray = batches.find(batch => batch.name === 'component-far-elevatedWireTray');
  assert.equal(elevatedTray?.userData.farSourcePartCount, 7);
  assert.equal(elevatedTray?.userData.farPartCount, 5,
    'the overhead data rack keeps its authored foot, upright, crossbar, saddle, and bracket');
  const traySize = new THREE.Vector3();
  elevatedTray.geometry.boundingBox.getSize(traySize);
  assert.ok(traySize.y > 1.5 && traySize.z > 0.8,
    'the far overhead rack retains the authored L-frame proportions');

  builder.dispose(parent);
});
