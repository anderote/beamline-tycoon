import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';
import {
  estimateBeamPipeDetailDemand,
  evaluateTenLargeTargets,
  runTenLargeBenchmark,
} from '../scripts/perf/ten-large-benchmark.mjs';
import {
  createLargeBeamlineBenchmarkGame,
  TEN_LARGE_BEAMLINE_COUNT,
} from '../scripts/perf/ten-large-beamline-fixture.mjs';

test('ten-large fixture contains ten complete copies of the flagship design', async () => {
  const fixture = await createLargeBeamlineBenchmarkGame();
  const { game, registry, design, expectedHardware } = fixture;
  const snapshot = buildWorldSnapshot(game, {
    only: ['components', 'pipeAttachments', 'beamPaths', 'beamPipes'],
  });

  assert.equal(registry.getAll().length, TEN_LARGE_BEAMLINE_COUNT);
  assert.equal(expectedHardware, design.components.length * TEN_LARGE_BEAMLINE_COUNT);
  assert.equal(snapshot.components.length + snapshot.pipeAttachments.length, expectedHardware);
  assert.equal(snapshot.beamPipes.length, TEN_LARGE_BEAMLINE_COUNT);
  assert.equal(snapshot.beamPaths.length, TEN_LARGE_BEAMLINE_COUNT);
  assert.ok(snapshot.beamPaths.every(path => path.worldPoints.length === 2));
  assert.ok(registry.getAll().every(entry => entry.status === 'running'));
});

test('pipe-detail demand scales from the real sparse stock-design paths', async () => {
  const { game } = await createLargeBeamlineBenchmarkGame();
  const snapshot = buildWorldSnapshot(game, { only: ['beamPipes'] });
  const demand = estimateBeamPipeDetailDemand(snapshot.beamPipes);

  assert.equal(demand.runs, TEN_LARGE_BEAMLINE_COUNT);
  assert.ok(demand.metres > 4_000, 'ten flagship pipes should span more than 4 km total');
  assert.ok(demand.renderObjects > 4_000,
    'current support/flange density should remain visible to the benchmark');
  assert.ok(demand.renderedTriangles > 0);
});

test('target evaluator reports measurements without embedding timing in tests', () => {
  const report = {
    timings: {
      tick: { p95Ms: 1 },
      partialSnapshot: { p95Ms: 1 },
      warmFullSnapshot: { p95Ms: 1 },
    },
    render: {
      buildMs: 1,
      near: { drawCalls: 1, shadowDrawCalls: 1 },
      far: { drawCalls: 1, renderedTriangles: 1 },
    },
    pipeDetailDemand: { renderObjects: 1 },
    physics: { totalMs: 1 },
  };
  const checks = evaluateTenLargeTargets(report);
  assert.equal(checks.length, 10);
  assert.ok(checks.every(check => check.pass));
});

test('ten-large runner reports each measured subsystem without timing assertions', async () => {
  const report = await runTenLargeBenchmark({
    tickIterations: 2,
    snapshotIterations: 2,
    quiet: true,
    includePhysics: false,
  });

  assert.equal(report.scenario.beamlines, TEN_LARGE_BEAMLINE_COUNT);
  assert.ok(report.timings.tick.p95Ms >= 0);
  assert.ok(report.render.near.drawCalls > 0);
  assert.ok(report.render.near.drawCalls >= report.render.far.drawCalls);
  assert.ok(report.render.breakdown.near.pipeAttachments.drawCalls > 0);
  assert.equal(report.render.near.lights, 0,
    'beamline geometry should not create one real light per component');
  assert.ok(report.pipeDetailDemand.renderObjects > 4_000);
  assert.equal(report.physics.skipped, true);
});
