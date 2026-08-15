import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { BEAMLINE_TYPES } from '../../src/data/beamline-types.js';
import { PhysicsWorkerClient } from '../../src/beamline/physics.js';
import { buildWorldSnapshot } from '../../src/renderer3d/world-snapshot.js';
import { designToPayload } from '../eval-design.mjs';
import { buildHeadlessBeamlineScene } from './headless-render-metrics.mjs';
import { createLargeBeamlineBenchmarkGame } from './ten-large-beamline-fixture.mjs';

export const TEN_LARGE_PERFORMANCE_TARGETS = Object.freeze({
  tickP95Ms: 8,
  partialSnapshotP95Ms: 8,
  warmFullSnapshotP95Ms: 50,
  headlessBuildMs: 100,
  nearDrawCalls: 750,
  farDrawCalls: 400,
  farRenderedTriangles: 750_000,
  shadowDrawCalls: 500,
  pipeDrawCalls: 4,
  physicsScheduleMs: 16,
});

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] || 0;
}

export function measure(fn, { iterations, warmup = 3 } = {}) {
  for (let i = 0; i < warmup; i++) fn();
  const values = [];
  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    fn();
    values.push(performance.now() - started);
  }
  return {
    iterations,
    meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50Ms: percentile(values, 0.50),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.max(...values),
  };
}

/**
 * Count the detailed objects the current beam-pipe presentation asks for.
 * This is a demand metric rather than a duplicate geometry builder: one long
 * run requests a tube, support roughly every 2 m, and interior flange roughly
 * every 2 m. Future batching should make the draw count much smaller than this
 * authored-detail count without removing the detail itself.
 */
export function estimateBeamPipeDetailDemand(beamPipes = []) {
  const result = {
    runs: 0,
    metres: 0,
    supportSlots: 0,
    flangeSlots: 0,
    renderObjects: 0,
    renderedTriangles: 0,
    shadowDrawCalls: 0,
  };
  for (const pipe of beamPipes) {
    const path = pipe.path || [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const metres = Math.hypot((b.col - a.col) * 2, (b.row - a.row) * 2);
      if (metres < 0.01) continue;
      result.runs++;
      result.metres += metres;
      result.supportSlots += Math.max(1, Math.round(metres / 2));
      // The benchmark pipes terminate on module faces. Production suppresses
      // both endpoint flanges there and emits only the 2 m interior cadence.
      result.flangeSlots += Math.floor(metres / 2 - 1e-3);
    }
  }
  result.renderObjects = result.runs + result.supportSlots + result.flangeSlots;
  result.shadowDrawCalls = result.renderObjects; // every visible pipe mesh casts
  // Current production geometry: 8-segment capped cylinders for pipes and
  // flanges (32 triangles each), BoxGeometry stands (12 each).
  result.renderedTriangles = (result.runs + result.flangeSlots) * 32
    + result.supportSlots * 12;
  return result;
}

function nativePhysicsBenchmark(design, beamlineCount) {
  const type = BEAMLINE_TYPES[design.typeId];
  const request = {
    payload: designToPayload(design),
    effects: { machineType: type?.machineType || 'linac' },
    requestedCalls: beamlineCount,
    calls: 1, // identical lattices are coalesced into one background worker job
  };
  const python = String.raw`
import json, sys, time
from beam_physics.gameplay import compute_beam_for_game
request = json.load(sys.stdin)
payload = json.dumps(request['payload'], separators=(',', ':'))
effects = json.dumps(request['effects'], separators=(',', ':'))
compute_beam_for_game(payload, effects)
started = time.perf_counter()
result = None
for _ in range(request['calls']):
    result = compute_beam_for_game(payload, effects)
elapsed = (time.perf_counter() - started) * 1000
print(json.dumps({
    'requestedCalls': request['requestedCalls'],
    'workerJobs': request['calls'],
    'calls': request['calls'],
    'totalMs': elapsed,
    'meanMs': elapsed / request['calls'],
    'resultBytes': len(result or ''),
}))
`;
  const result = spawnSync('python3', ['-c', python], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    input: JSON.stringify(request),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return { error: String(result.stderr || result.error?.message || 'python benchmark failed').trim() };
  }
  return JSON.parse(result.stdout);
}

class BenchmarkPhysicsWorker {
  constructor() { this.messages = []; this.onmessage = null; }
  postMessage(message) {
    this.messages.push(message);
    if (message.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
  }
  finish() {
    for (const message of this.messages.filter(item => item.type === 'compute')) {
      this.onmessage?.({
        data: { type: 'result', requestId: message.requestId, result: { beamEnergy: 1 } },
      });
    }
  }
}

async function physicsSchedulingBenchmark(design, beamlineCount) {
  const worker = new BenchmarkPhysicsWorker();
  const client = new PhysicsWorkerClient({ workerFactory: () => worker });
  await client.init();
  const payload = designToPayload(design);
  const effects = { machineType: BEAMLINE_TYPES[design.typeId]?.machineType || 'linac' };
  const started = performance.now();
  const promises = [];
  for (let i = 0; i < beamlineCount; i++) {
    const instancePayload = payload.map(element => ({ ...element, id: `${element.id || 'node'}-${i}` }));
    promises.push(client.computeAsync(instancePayload, effects));
  }
  const mainThreadScheduleMs = performance.now() - started;
  const stats = client.getStats();
  worker.finish();
  await Promise.all(promises);
  return {
    requests: beamlineCount,
    mainThreadScheduleMs,
    workerJobs: stats.workerJobs,
    deduplicated: stats.deduplicated,
  };
}

export function evaluateTenLargeTargets(report, targets = TEN_LARGE_PERFORMANCE_TARGETS) {
  const checks = [
    ['tick p95', report.timings.tick.p95Ms, targets.tickP95Ms, 'ms'],
    ['partial snapshot p95', report.timings.partialSnapshot.p95Ms, targets.partialSnapshotP95Ms, 'ms'],
    ['warm full snapshot p95', report.timings.warmFullSnapshot.p95Ms, targets.warmFullSnapshotP95Ms, 'ms'],
    ['headless scene build', report.render.buildMs, targets.headlessBuildMs, 'ms'],
    ['near draw calls', report.render.near.drawCalls, targets.nearDrawCalls, 'calls'],
    ['far draw calls', report.render.far.drawCalls, targets.farDrawCalls, 'calls'],
    ['far rendered triangles', report.render.far.renderedTriangles, targets.farRenderedTriangles, 'triangles'],
    ['shadow draw calls', report.render.near.shadowDrawCalls, targets.shadowDrawCalls, 'calls'],
    ['beam-pipe near draw calls', report.render.pipeStats.nearDrawCalls, targets.pipeDrawCalls, 'calls'],
    ['physics main-thread scheduling', report.physics.scheduling.mainThreadScheduleMs, targets.physicsScheduleMs, 'ms'],
    ['native physics job completed', report.physics.native.error ? 1 : 0, 0, 'errors', report.physics.native.skipped === true],
  ];
  return checks.map(([name, actual, target, unit, skipped = false]) => ({
    name, actual, target, unit, skipped,
    pass: skipped || (Number.isFinite(actual) && actual <= target),
  }));
}

export async function runTenLargeBenchmark({
  count = 10,
  designId = 'blackhole-pev',
  tickIterations = 300,
  snapshotIterations = 80,
  quiet = false,
  includePhysics = true,
} = {}) {
  const fixture = await createLargeBeamlineBenchmarkGame({ count, designId });
  const { game, design, registry, expectedHardware } = fixture;
  const partialSections = [
    'components', 'pipeAttachments', 'beamPaths', 'beamPipes', 'moduleSubTiles',
  ];

  const partial = buildWorldSnapshot(game, { only: partialSections });
  const coldFullStarted = performance.now();
  buildWorldSnapshot(game);
  const coldFullSnapshotMs = performance.now() - coldFullStarted;

  const timings = {
    tick: measure(() => game.tick(), { iterations: tickIterations, warmup: 10 }),
    recalcFallback: measure(() => game.recalcAllBeamlines(), { iterations: 40, warmup: 3 }),
    partialSnapshot: measure(
      () => buildWorldSnapshot(game, { only: partialSections }),
      { iterations: snapshotIterations, warmup: 5 },
    ),
    coldFullSnapshotMs,
    warmFullSnapshot: measure(() => buildWorldSnapshot(game), { iterations: 12, warmup: 2 }),
  };

  const render = await buildHeadlessBeamlineScene(partial, { quiet });
  const pipeDetailDemand = estimateBeamPipeDetailDemand(partial.beamPipes);
  const scheduling = await physicsSchedulingBenchmark(design, registry.getAll().length);
  const native = includePhysics
    ? nativePhysicsBenchmark(design, registry.getAll().length)
    : { calls: 0, requestedCalls: registry.getAll().length, workerJobs: 0,
      totalMs: 0, meanMs: 0, resultBytes: 0, skipped: true };
  const report = {
    scenario: {
      designId: design.id,
      beamlines: registry.getAll().length,
      hardware: expectedHardware,
      placedModules: partial.components.length,
      pipeAttachments: partial.pipeAttachments.length,
      flattenedElements: game.state.beamline.length,
      mapHalfExtent: game.state.mapHalfExtent,
    },
    timings,
    render: {
      buildMs: render.buildMs,
      near: render.near,
      far: render.far,
      breakdown: render.breakdown,
      pipeStats: render.pipeStats,
    },
    pipeDetailDemand,
    physics: { scheduling, native },
    scope: {
      included: ['Game tick', 'fallback recalc', 'world snapshots', 'components', 'pipe attachments', 'beam pipes', 'beam effect', 'main-thread physics scheduling', 'coalesced CPython physics workload'],
      excluded: ['GPU frame time', 'post-processing', 'utility support plant', 'browser-only shadow rendering'],
    },
  };
  report.targets = evaluateTenLargeTargets(report);
  report.pass = report.targets.every(target => target.pass);
  return report;
}
