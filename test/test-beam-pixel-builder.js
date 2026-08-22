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
    color: 0x44ff88,
  }], parent);

  const dc = parent.getObjectByName('beam-dc-pixel');
  const bunch = parent.getObjectByName('beam-bunch-pixel');
  assert.ok(dc?.isInstancedMesh && bunch?.isInstancedMesh);
  assert.equal(dc.geometry.type, 'BoxGeometry');
  assert.equal(bunch.geometry.type, 'BoxGeometry');
  assert.ok(bunch.count % 4 === 0, 'bunched beam pixels are emitted in compact groups of four');
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
    bunchSize: 6,
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
  builder.dispose(parent);
  resetParticleEffectProfile('beamline');
});
