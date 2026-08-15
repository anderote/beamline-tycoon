import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LIGHTING_QUALITY_PRESETS, MAX_FIXTURE_SHADOWS,
  normalizeLightingQuality, resolveLightingQuality,
} from '../src/renderer3d/lighting-quality.js';
import { ShadowScheduler } from '../src/renderer3d/shadow-scheduler.js';
import { LIGHTING_DEFS, validateLightingDef } from '../src/data/placeables/lighting.js';
import { fixtureDynamicFactor } from '../src/renderer3d/light-dynamics.js';

test('lighting presets are immutable, bounded, and normalize unknown values to auto', () => {
  assert.equal(MAX_FIXTURE_SHADOWS, 6);
  assert.equal(Object.isFrozen(LIGHTING_QUALITY_PRESETS), true);
  assert.equal(Object.isFrozen(LIGHTING_QUALITY_PRESETS.high), true);
  assert.equal(normalizeLightingQuality('ULTRA'), 'ultra');
  assert.equal(normalizeLightingQuality('potato'), 'auto');
  assert.equal(resolveLightingQuality('low').fixtureShadowCount, 0);
  assert.equal(resolveLightingQuality('ultra').fixtureShadowCount, MAX_FIXTURE_SHADOWS);
});

test('auto lighting quality uses conservative capability thresholds', () => {
  assert.equal(resolveLightingQuality('auto', { hardwareConcurrency: 2, deviceMemory: 2 }).name, 'low');
  assert.equal(resolveLightingQuality('auto', { hardwareConcurrency: 4, deviceMemory: 4 }).name, 'medium');
  assert.equal(resolveLightingQuality('auto', { hardwareConcurrency: 8, deviceMemory: 8 }).name, 'high');
  assert.equal(resolveLightingQuality('auto', { hardwareConcurrency: 16, deviceMemory: 16, maxTextureSize: 8192 }).name, 'ultra');
});

test('shadow scheduler immediately refreshes new assignments and staggers them', () => {
  const s = new ShadowScheduler(4, { hz: 10, maxUpdatesPerFrame: 1 });
  const args = { activeCount: 4, enabled: true, dtMs: 16, assignmentKeys: ['a', 'b', 'c', 'd'] };
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(...s.step(args));
  assert.deepEqual(seen.sort(), [0, 1, 2, 3]);
  assert.equal(s.step(args).length, 0, 'no map refresh occurs before its interval');
  assert.equal(s.step({ ...args, dtMs: 100 }).length, 1, 'periodic refresh remains staggered');
});

test('shadow scheduler parks disabled, daylight, and inactive slots', () => {
  const s = new ShadowScheduler(3, { hz: 15 });
  assert.deepEqual(s.step({ activeCount: 3, enabled: false, dtMs: 1000, assignmentKeys: ['a', 'b', 'c'] }), []);
  assert.deepEqual(s.step({ activeCount: 0, enabled: true, dtMs: 1000, assignmentKeys: [] }), []);
  const first = s.step({ activeCount: 1, enabled: true, dtMs: 1, assignmentKeys: ['a'] });
  assert.deepEqual(first, [0]);
});

test('every fixture exposes a complete finite lighting profile', () => {
  assert.equal(LIGHTING_DEFS.length, 15);
  for (const def of LIGHTING_DEFS) {
    assert.deepEqual(validateLightingDef(def), [], `${def.id} profile is valid`);
    assert.ok(def.light.sourceRadius > 0, `${def.id} has an apparent source size`);
    assert.ok(def.light.bloomProfile && def.light.volumeProfile && def.light.dynamicProfile);
  }
});

test('fixture dynamics are deterministic, bounded, and identity-phased', () => {
  const a = fixtureDynamicFactor('fluorescent', 'fixture-a', 12345, 0.2);
  assert.equal(a, fixtureDynamicFactor('fluorescent', 'fixture-a', 12345, 0.2));
  assert.notEqual(a, fixtureDynamicFactor('fluorescent', 'fixture-b', 12345, 0.2));
  for (const profile of ['warmSteady', 'arcStable', 'fluorescent']) {
    for (let t = 0; t < 10000; t += 137) {
      const factor = fixtureDynamicFactor(profile, 'stable-id', t, 0.5);
      assert.ok(factor >= 0.75 && factor <= 1.05, `${profile} stays subtle and non-negative`);
    }
  }
  const emergencySamples = Array.from({ length: 240 }, (_, i) =>
    fixtureDynamicFactor('statusBlink', 'emergency-a', i * 20, 1));
  assert.ok(Math.min(...emergencySamples) < Math.max(...emergencySamples),
    'status blink produces visible pulses instead of falling back to steady');
  assert.ok(emergencySamples.every(factor => factor >= 0.7 && factor <= 1.3),
    'status blink stays bounded and never turns the fixture fully off');
  assert.equal(fixtureDynamicFactor('steady', 'x', 99, 1), 1);
});
