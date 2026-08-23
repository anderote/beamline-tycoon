import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DYNAMIC_POINT_LIGHT_FLASH_RESERVE, LIGHTING_QUALITY_PRESETS,
  MAX_DYNAMIC_POINT_LIGHTS, MAX_FIXTURE_LIGHTS, MAX_FIXTURE_SHADOWS,
  MAX_SHADOW_TEXTURE_BUDGET_BYTES, estimateShadowTextureBytes, fixtureShadowTopologyLimit,
  normalizeLightingQuality, resolveLightingQuality,
} from '../src/renderer3d/lighting-quality.js';
import { ShadowScheduler } from '../src/renderer3d/shadow-scheduler.js';
import { LIGHTING_DEFS, validateLightingDef } from '../src/data/placeables/lighting.js';
import { fixtureDynamicFactor } from '../src/renderer3d/light-dynamics.js';

test('lighting presets are immutable, bounded, and normalize unknown values to auto', () => {
  assert.equal(MAX_FIXTURE_LIGHTS, 64);
  assert.equal(MAX_FIXTURE_SHADOWS, 12);
  assert.equal(MAX_DYNAMIC_POINT_LIGHTS, 32);
  assert.equal(DYNAMIC_POINT_LIGHT_FLASH_RESERVE, 2);
  assert.equal(MAX_DYNAMIC_POINT_LIGHTS - DYNAMIC_POINT_LIGHT_FLASH_RESERVE, 30);
  assert.equal(Object.isFrozen(LIGHTING_QUALITY_PRESETS), true);
  assert.equal(Object.isFrozen(LIGHTING_QUALITY_PRESETS.high), true);
  assert.equal(normalizeLightingQuality('ULTRA'), 'ultra');
  assert.equal(normalizeLightingQuality('potato'), 'auto');
  assert.equal(resolveLightingQuality('low').fixtureShadowCount, 0);
  assert.equal(resolveLightingQuality('ultra').fixtureShadowCount, MAX_FIXTURE_SHADOWS);
  assert.equal(resolveLightingQuality('ultra').fixtureLightCount, MAX_FIXTURE_LIGHTS);
  assert.ok(resolveLightingQuality('high').fixtureLightCount
    > resolveLightingQuality('high').fixtureShadowCount);
  assert.equal(resolveLightingQuality('high').fixtureShadowUpdatesPerFrame, 1);
  assert.equal(resolveLightingQuality('ultra').fixtureShadowMapSize, 768);
  assert.equal(resolveLightingQuality('ultra').sunShadowMapSize, 2048);
  assert.equal(resolveLightingQuality('low').contactAOStrength, 0);
  assert.ok(resolveLightingQuality('high').contactAOSamples > resolveLightingQuality('medium').contactAOSamples);
  assert.ok(resolveLightingQuality('ultra').contactAOScale <= 1);
});

test('every lighting preset stays inside the persistent shadow texture budget', () => {
  for (const quality of Object.values(LIGHTING_QUALITY_PRESETS)) {
    assert.ok(
      estimateShadowTextureBytes(quality) <= MAX_SHADOW_TEXTURE_BUDGET_BYTES,
      `${quality.name} shadow textures exceed the 64 MiB startup budget`,
    );
  }
});

test('auto lighting quality uses conservative capability thresholds', () => {
  assert.equal(resolveLightingQuality('auto', { hardwareConcurrency: 2, deviceMemory: 2 }).name, 'low');
  assert.equal(resolveLightingQuality('auto', { hardwareConcurrency: 4, deviceMemory: 4 }).name, 'medium');
  assert.equal(resolveLightingQuality('auto', { hardwareConcurrency: 8, deviceMemory: 8 }).name, 'high');
  assert.equal(resolveLightingQuality('auto', { hardwareConcurrency: 16, deviceMemory: 16, maxTextureSize: 8192 }).name, 'ultra');
  assert.equal(resolveLightingQuality('auto', { hardwareConcurrency: 16, deviceMemory: 16, maxTextureSize: 8192, backend: 'webgl2' }).name, 'medium');
});

test('fixture shadow topology stays inside the fragment texture-unit budget', () => {
  assert.equal(fixtureShadowTopologyLimit(16), 5,
    'a common 16-unit GPU retains five units for material textures');
  assert.equal(fixtureShadowTopologyLimit(32), MAX_FIXTURE_SHADOWS,
    'the global shadow-memory cap wins once the sampler budget is sufficient');
  assert.equal(fixtureShadowTopologyLimit(64), MAX_FIXTURE_SHADOWS,
    'a sufficiently large legacy sampler budget can allocate the full pool');
  assert.equal(fixtureShadowTopologyLimit(8), 1,
    'small sampler budgets degrade without exceeding the limit');
  assert.equal(fixtureShadowTopologyLimit(undefined), 5,
    'missing capability data uses the conservative WebGL baseline');
});

test('shadow scheduler refreshes one new assignment immediately and rate-limits the backlog', () => {
  const s = new ShadowScheduler(4, { hz: 10, maxUpdatesPerFrame: 1 });
  const args = { activeCount: 4, enabled: true, dtMs: 16, assignmentKeys: ['a', 'b', 'c', 'd'] };
  assert.deepEqual(s.step(args), [0], 'the first new assignment refreshes promptly');
  assert.equal(s.step(args).length, 0,
    'the remaining dirty assignments do not become one shadow pass per frame');
  assert.deepEqual(s.step({ ...args, dtMs: 100 }), [1],
    'the backlog resumes at the configured aggregate cadence');
  assert.deepEqual(s.step({ ...args, dtMs: 100 }), [2]);
  assert.deepEqual(s.step({ ...args, dtMs: 100 }), [3]);
});

test('fixture shadow Hz is a queue-wide budget, not a per-light multiplier', () => {
  const s = new ShadowScheduler(4, { hz: 10, maxUpdatesPerFrame: 1 });
  const args = { activeCount: 4, enabled: true, dtMs: 0, assignmentKeys: ['a', 'b', 'c', 'd'] };

  // Drain the four newly assigned layers first. One is prompt; the remaining
  // backlog consumes the same aggregate cadence as steady-state refreshes.
  assert.equal(s.step(args).length, 1);
  for (let i = 0; i < 3; i++) {
    assert.equal(s.step({ ...args, dtMs: 100 }).length, 1);
  }
  assert.equal(s.pendingCount, 0);

  let refreshes = 0;
  for (let i = 0; i < 100; i++) {
    refreshes += s.step({ ...args, dtMs: 10 }).length;
  }
  assert.equal(refreshes, 10,
    'four active slots share ten refreshes per second instead of each receiving ten');
});

test('a large daylight backlog drains at the aggregate shadow rate after dusk', () => {
  const s = new ShadowScheduler(12, { hz: 15, maxUpdatesPerFrame: 1 });
  const keys = Array.from({ length: 12 }, (_, i) => `fixture-${i}`);

  assert.deepEqual(s.step({
    activeCount: 12, enabled: false, dtMs: 1000, assignmentKeys: keys,
  }), []);
  assert.equal(s.pendingCount, 12, 'daylight retains dirty assignments without rendering them');

  const scheduledFrames = [];
  for (let frame = 0; frame < 80; frame++) {
    const updates = s.step({
      activeCount: 12, enabled: true, dtMs: 16, assignmentKeys: keys,
    });
    if (updates.length) scheduledFrames.push(frame);
    if (s.pendingCount === 0) break;
  }
  assert.equal(scheduledFrames[0], 0, 'one first layer is available immediately at dusk');
  assert.equal(scheduledFrames.length, 12, 'all stale layers drain within the test window');
  assert.ok(scheduledFrames.slice(1).every((frame, index) =>
    frame - scheduledFrames[index] >= 4),
    'later layers are separated by the 15 Hz cadence instead of consecutive frames');
  assert.equal(s.pendingCount, 0, 'the full night set drains without an all-at-once frame');
});

test('shadow scheduler parks disabled, daylight, and inactive slots', () => {
  const s = new ShadowScheduler(3, { hz: 15 });
  assert.deepEqual(s.step({ activeCount: 3, enabled: false, dtMs: 1000, assignmentKeys: ['a', 'b', 'c'] }), []);
  assert.deepEqual(s.step({ activeCount: 0, enabled: true, dtMs: 1000, assignmentKeys: [] }), []);
  const first = s.step({ activeCount: 1, enabled: true, dtMs: 1, assignmentKeys: ['a'] });
  assert.deepEqual(first, [0]);
});

test('every fixture exposes a complete finite lighting profile', () => {
  assert.equal(LIGHTING_DEFS.length, 28);
  for (const def of LIGHTING_DEFS) {
    assert.deepEqual(validateLightingDef(def), [], `${def.id} profile is valid`);
    assert.ok(def.light.sourceRadius > 0, `${def.id} has an apparent source size`);
    assert.ok(def.light.bloomProfile && def.light.dynamicProfile);
    assert.equal('volumeProfile' in def.light, false,
      `${def.id} does not opt into removed cone geometry`);
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
