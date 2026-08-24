import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Three from 'three';

globalThis.THREE = Three;

const { BeamBuilder } = await import('../src/renderer3d/beam-builder.js');
const {
  resetParticleEffectProfile,
  setParticleEffectProfile,
} = await import('../src/renderer3d/particle-effect-tuning.js');

test('live beam motion uses glowing pixel instances without allocating lights', () => {
  const parent = new Three.Group();
  const builder = new BeamBuilder();
  builder.build([{
    beamlineId: 'bl-1',
    worldPoints: [{ col: 0, row: 0 }, { col: 6, row: 0 }],
    visualMode: 'bunched',
    visualProfile: [
      { u: 0, beta: 0.05, speed: 1.5, bunch: 0 },
      { u: 0.45, beta: 0.2, speed: 2.2, bunch: 0 },
      { u: 0.55, beta: 0.3, speed: 2.55, bunch: 1 },
      { u: 1, beta: 0.9, speed: 3.84, bunch: 1 },
    ],
    radiationEvents: [
      { kind: 'synchrotron', elementId: 'bend', u: 0.55, strength: 0.8, beta: 0.9 },
      { kind: 'impact', elementId: 'stop', endpointType: 'target', u: 1, strength: 0.9 },
    ],
    sourceEffect: {
      kind: 'cyclotronSpiral', elementId: 'source', radius: 0.9, sourceLength: 2,
    },
    color: 0x44ff88,
  }], parent);

  const dc = parent.getObjectByName('beam-dc-pixel');
  const bunch = parent.getObjectByName('beam-bunch-pixel');
  assert.ok(dc?.isInstancedMesh && bunch?.isInstancedMesh);
  assert.equal(dc.geometry.type, 'BoxGeometry');
  assert.equal(bunch.geometry.type, 'BoxGeometry');
  assert.ok(bunch.count % 4 === 0, 'bunched beam pixels are emitted in compact groups of four');
  assert.equal(dc.material.depthTest, false,
    'beam pixels remain visible through beamline equipment');
  assert.equal(bunch.material.depthTest, false,
    'bunched pixels remain visible through beamline equipment');
  assert.ok(parent.getObjectByName('beam-synchrotron-streak')?.isInstancedMesh);
  assert.ok(parent.getObjectByName('beam-secondary-radiation')?.isInstancedMesh);
  assert.ok(parent.getObjectByName('beam-cyclotron-flow')?.isInstancedMesh);
  let lights = 0;
  parent.traverse(object => { if (object.isLight) lights++; });
  assert.equal(lights, 0, 'beam glow is emissive colour/bloom, not a physical light source');

  const before = new Three.Matrix4();
  const after = new Three.Matrix4();
  bunch.getMatrixAt(bunch.count - 1, before);
  builder.update(0.1);
  bunch.getMatrixAt(bunch.count - 1, after);
  assert.notDeepEqual(after.elements, before.elements, 'published beta drives moving beam pixels');
  builder.dispose(parent);
});

test('live beam meshes consume workshop density, size, and bunch controls', () => {
  setParticleEffectProfile('beamline', {
    density: 2,
    size: 0.05,
    speed: 2,
    coreOpacity: 0.32,
    pixelOpacity: 0.4,
    bunchSize: 6,
    slosh: 0,
  });
  const parent = new Three.Group();
  const builder = new BeamBuilder();
  builder.build([{
    worldPoints: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
    visualMode: 'bunched',
    visualProfile: [
      { u: 0, beta: 0.4, speed: 2.8, bunch: 0 },
      { u: 1, beta: 0.8, speed: 3.6, bunch: 1 },
    ],
    color: 0x44ff88,
  }], parent);
  const dc = parent.getObjectByName('beam-dc-pixel');
  const bunch = parent.getObjectByName('beam-bunch-pixel');
  assert.ok(dc.count > 30, 'density slider increases the looping pixel population');
  assert.equal(bunch.count % 6, 0, 'bunch slider controls pixels per compact packet');
  assert.equal(dc.geometry.parameters.width, 0.1, 'pixel-size slider reaches beam geometry');
  assert.equal(dc.material.opacity, 0.4, 'pixel-glow slider reaches live beam material');
  assert.equal(parent.getObjectByName('beam-core').material.opacity, 0.15,
    'core-glow slider reaches the live continuous beam core');
  const before = new Three.Matrix4();
  const after = new Three.Matrix4();
  dc.getMatrixAt(0, before);
  builder.update(0.1);
  dc.getMatrixAt(0, after);
  assert.ok(after.elements[12] - before.elements[12] > 0.5,
    'speed scale advances actual live-beam instances');
  builder.dispose(parent);
  resetParticleEffectProfile('beamline');
});

test('cyclotron pane independently tunes live spiral particles', () => {
  setParticleEffectProfile('cyclotron', {
    density: 2,
    size: 0.06,
    speed: 2.5,
    turns: 4,
    orbitScale: 1.4,
    extraction: 0.65,
    slosh: 1.2,
    brightness: 0.4,
  });
  setParticleEffectProfile('sourceFlow', {
    density: 0.25,
    size: 0.02,
    brightness: 0.75,
  });
  const parent = new Three.Group();
  const builder = new BeamBuilder();
  builder.build([
    {
      beamlineId: 'cyclotron-beam',
      worldPoints: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
      visualMode: 'continuous',
      sourceEffect: {
        kind: 'cyclotronSpiral', elementId: 'cyclotron', radius: 0.9, sourceLength: 2,
      },
      color: 0x44ff88,
    },
    {
      beamlineId: 'ecr-beam',
      worldPoints: [{ col: 0, row: 2 }, { col: 4, row: 2 }],
      visualMode: 'continuous',
      sourceEffect: {
        kind: 'plasmaVortex', elementId: 'ecr', radius: 0.5, sourceLength: 1.5,
      },
      color: 0x44ff88,
    },
  ], parent);

  const cyclotron = parent.getObjectByName('beam-cyclotron-flow');
  const ecr = parent.getObjectByName('beam-ecr-plasma-flow');
  assert.equal(cyclotron.count, 76, 'cyclotron density controls the live spiral population');
  assert.equal(cyclotron.geometry.parameters.width, 0.06,
    'cyclotron particle size reaches the live spiral geometry');
  assert.equal(cyclotron.material.opacity, 0.4,
    'cyclotron brightness reaches the live spiral material');
  assert.equal(ecr.count, 8, 'ECR density remains on its independent source pane');
  assert.equal(ecr.geometry.parameters.width, 0.02,
    'ECR particle size is not overwritten by cyclotron tuning');

  const before = new Three.Matrix4();
  const after = new Three.Matrix4();
  cyclotron.getMatrixAt(0, before);
  builder.update(0.1);
  cyclotron.getMatrixAt(0, after);
  assert.notDeepEqual(after.elements, before.elements,
    'cyclotron speed, turns, radius, extraction, and wobble feed live animation state');

  builder.dispose(parent);
  resetParticleEffectProfile('cyclotron');
  resetParticleEffectProfile('sourceFlow');
});
