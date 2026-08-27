import { performance } from 'node:perf_hooks';

import { BeamlineRegistry } from '../../src/beamline/BeamlineRegistry.js';
import { generateMinorLab, setupMinorLab } from '../../src/data/scenarios/minorLab.js';
import { Game } from '../../src/game/Game.js';
import { buildWorldSnapshot } from '../../src/renderer3d/world-snapshot.js';
import { makeUtilityEndpointIndex } from '../../src/utility/utility-endpoints.js';
import { buildHeadlessFacilityScene } from './headless-render-metrics.mjs';

export const MINOR_LAB_PERFORMANCE_TARGETS = Object.freeze({
  nearDrawCalls: 2100,
  nearUtilityDrawCalls: 300,
  farDrawCalls: 220,
  // Exporting the original major pieces for on-pipe components, furnishings,
  // and grounds objects costs ~13.5k triangles versus the former synthetic
  // proxies. Keep the complete catalogue-fidelity pass bounded at 140k while
  // retaining roughly 90% triangle savings from the authored near scene.
  farRenderedTriangles: 140_000,
  farShadowDrawCalls: 60,
  maximumFarDrawRatio: 0.10,
  farDetailMeshes: 0,
  farGlowMeshes: 0,
});

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] || 0;
}

function summarize(values) {
  return {
    iterations: values.length,
    meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50Ms: percentile(values, 0.50),
    p95Ms: percentile(values, 0.95),
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
  };
}

function withoutConsoleNoise(operation) {
  const methods = ['log', 'info', 'warn', 'error'];
  const prior = Object.fromEntries(methods.map(name => [name, console[name]]));
  for (const name of methods) console[name] = () => {};
  try {
    return operation();
  } finally {
    for (const name of methods) console[name] = prior[name];
  }
}

function evaluateTargets(render, targets = MINOR_LAB_PERFORMANCE_TARGETS) {
  const checks = [
    ['near draw calls', render.near.drawCalls, targets.nearDrawCalls, 'calls'],
    ['near utility draw calls', render.breakdown.near.utilities.drawCalls,
      targets.nearUtilityDrawCalls, 'calls'],
    ['far draw calls', render.far.drawCalls, targets.farDrawCalls, 'calls'],
    ['far rendered triangles', render.far.renderedTriangles, targets.farRenderedTriangles, 'triangles'],
    ['far shadow draw calls', render.far.shadowDrawCalls, targets.farShadowDrawCalls, 'calls'],
    ['far/near draw ratio', render.far.drawCalls / render.near.drawCalls,
      targets.maximumFarDrawRatio, 'ratio'],
    ['far detail meshes', render.far.detailMeshes, targets.farDetailMeshes, 'meshes'],
    ['far glow meshes', render.far.glowMeshes, targets.farGlowMeshes, 'meshes'],
  ];
  return checks.map(([name, actual, target, unit]) => ({
    name, actual, target, unit,
    pass: Number.isFinite(actual) && actual <= target,
  }));
}

/**
 * Exercise the complete saved Minor Lab through production snapshot and scene
 * builders. Timings are CPU-side construction/swap costs, never FPS or GPU
 * timings. Structural targets remain stable enough to gate in CI; timings are
 * reported diagnostically because they vary with the host machine.
 */
export async function runMinorLabBenchmark({
  iterations = 3,
  snapshotIterations = 10,
  quiet = false,
} = {}) {
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('iterations must be a positive integer');
  }
  if (!Number.isInteger(snapshotIterations) || snapshotIterations < 1) {
    throw new Error('snapshotIterations must be a positive integer');
  }

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
  });

  const game = withoutConsoleNoise(() => {
    const created = new Game(new BeamlineRegistry(), { seed: 1234 });
    created.applyScenario(generateMinorLab());
    setupMinorLab(created);
    return created;
  });

  const coldSnapshotStarted = performance.now();
  let snapshot = buildWorldSnapshot(game);
  const coldSnapshotMs = performance.now() - coldSnapshotStarted;
  const warmSnapshotSamples = [];
  for (let i = 0; i < snapshotIterations; i++) {
    const started = performance.now();
    snapshot = buildWorldSnapshot(game);
    warmSnapshotSamples.push(performance.now() - started);
  }

  const endpointIndex = makeUtilityEndpointIndex(game.state);
  const sceneBuildSamples = [];
  const transitionSamples = { firstFarMs: [], restoreNearMs: [], warmFarMs: [] };
  const builderSamples = {};
  let canonical = null;
  for (let i = 0; i < iterations; i++) {
    const scene = await buildHeadlessFacilityScene(snapshot, {
      state: game.state,
      endpointIndex,
      quiet,
    });
    canonical ??= scene;
    sceneBuildSamples.push(scene.buildMs);
    for (const [name, value] of Object.entries(scene.builderMs)) {
      (builderSamples[name] ??= []).push(value);
    }
    for (const [name, value] of Object.entries(scene.lodTransitionMs)) {
      transitionSamples[name].push(value);
    }
  }

  const render = {
    near: canonical.near,
    far: canonical.far,
    farRoofOverview: canonical.farRoofOverview,
    breakdown: canonical.breakdown,
  };
  const targets = evaluateTargets(render);
  const percentageSaved = (near, far) => near > 0 ? (1 - far / near) * 100 : 0;
  return {
    scenario: {
      id: 'minorLab',
      name: 'Minor Lab',
      placeables: game.state.placeables?.length || 0,
      components: snapshot.components?.length || 0,
      equipment: snapshot.equipment?.length || 0,
      furnishings: snapshot.furnishings?.length || 0,
      decorations: snapshot.decorations?.length || 0,
      utilityLines: snapshot.utilityLines?.length || 0,
      beamPipes: snapshot.beamPipes?.length || 0,
    },
    timings: {
      coldSnapshotMs,
      warmSnapshot: summarize(warmSnapshotSamples),
      sceneBuild: summarize(sceneBuildSamples),
      builders: Object.fromEntries(Object.entries(builderSamples)
        .map(([name, values]) => [name, summarize(values)])),
      lodTransition: Object.fromEntries(Object.entries(transitionSamples)
        .map(([name, values]) => [name, summarize(values)])),
    },
    render,
    savings: {
      drawCallsPercent: percentageSaved(render.near.drawCalls, render.far.drawCalls),
      trianglesPercent: percentageSaved(
        render.near.renderedTriangles, render.far.renderedTriangles,
      ),
      shadowDrawCallsPercent: percentageSaved(
        render.near.shadowDrawCalls, render.far.shadowDrawCalls,
      ),
    },
    targets,
    pass: targets.every(target => target.pass),
    scope: {
      included: [
        'saved Minor Lab scenario', 'full world snapshot', 'production facility builders',
        'near/far scene structure', 'first and warm LOD swaps',
      ],
      excluded: [
        'GPU frame time', 'post-processing', 'driver submission', 'browser FPS',
        'visual quality judgment',
      ],
    },
  };
}
