import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EffectPreviewTool } from '../src/input/effect-preview-tool.js';
import {
  electricalSparkProfile,
  particleEffectDefinitions,
  particleEffectProfile,
  previewParticleDescriptors,
  resetParticleEffectProfile,
  setParticleEffectProfile,
} from '../src/renderer3d/particle-effect-tuning.js';

test('workshop exposes independent slider contracts for all requested effects', () => {
  const defs = particleEffectDefinitions();
  assert.deepEqual(Object.keys(defs), [
    'hvConnection', 'powerConnection', 'explosion', 'beamline',
    'targetRadiation', 'synchrotronRadiation', 'sourceFlow',
  ]);
  assert.ok(Object.keys(defs.hvConnection.fields).length >= 6);
  assert.ok(Object.keys(defs.beamline.fields).includes('density'));
  assert.ok(Object.keys(defs.targetRadiation.fields).includes('spread'));
  assert.ok(Object.keys(defs.synchrotronRadiation.fields).includes('streakLength'));
  assert.ok(Object.keys(defs.sourceFlow.fields).includes('slosh'));
});

test('electrical defaults produce small, slow, numerous, long-lived falling pixels', () => {
  const hv = electricalSparkProfile('hvConnection');
  const power = electricalSparkProfile('powerConnection');
  assert.ok(hv.count >= 50 && power.count >= 18);
  assert.ok(hv.size < 0.04 && power.size < 0.03);
  assert.ok(hv.speedMax < 4 && power.speedMax < 2.2);
  assert.ok(hv.lifetimeMax > 2 && power.lifetimeMax > 1.4);
  assert.ok(hv.gravity > 0 && hv.restitution > 0.5);
});

test('workshop values clamp to their authored slider range and reset cleanly', () => {
  const changed = setParticleEffectProfile('hvConnection', { count: 999, size: -1 });
  assert.equal(changed.count, 160);
  assert.equal(changed.size, 0.014);
  const reset = resetParticleEffectProfile('hvConnection');
  assert.equal(reset.count, 56);
  assert.equal(particleEffectProfile('hvConnection').size, 0.034);
});

test('beam preview is a directed zero-gravity pixel stream', () => {
  const [descriptor] = previewParticleDescriptors('beamline', { x: 1, y: 2, z: 3 });
  assert.equal(descriptor.kind, 'particleBurst');
  assert.equal(descriptor.gravity, 0);
  assert.equal(descriptor.upwardBias, 0);
  assert.deepEqual(descriptor.normal, { x: 1, y: 0, z: 0 });
});

test('radiation previews are directed zero-gravity particle showers', () => {
  for (const id of ['targetRadiation', 'synchrotronRadiation', 'sourceFlow']) {
    const [descriptor] = previewParticleDescriptors(id, { x: 1, y: 2, z: 3 });
    assert.equal(descriptor.kind, 'particleBurst');
    assert.equal(descriptor.gravity, 0);
    assert.ok(descriptor.count > 0);
  }
});

test('effect preview tool consumes clicks through public renderer commands', () => {
  const calls = [];
  const renderer = {
    effectPointAtScreen: (x, y) => ({ x, y: 0.5, z: y }),
    previewParticleEffect: (...args) => calls.push(args),
  };
  const tool = new EffectPreviewTool('explosion');
  assert.equal(tool.onClick({ clientX: 4, clientY: 9 }, { renderer }), true);
  assert.deepEqual(calls, [['explosion', { x: 4, y: 0.5, z: 9 }]]);
});
