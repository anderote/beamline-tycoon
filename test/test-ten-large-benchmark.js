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
      pipeStats: { nearDrawCalls: 1 },
    },
    pipeDetailDemand: { renderObjects: 1 },
    physics: { scheduling: { mainThreadScheduleMs: 1 }, native: {} },
  };
  const checks = evaluateTenLargeTargets(report);
  assert.equal(checks.length, 11);
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
  assert.ok(report.render.breakdown.far.components.drawCalls
    < report.render.breakdown.near.components.drawCalls / 10,
  'far component silhouettes should batch repeated hardware by type');
  assert.ok(report.render.breakdown.near.pipeAttachments.drawCalls > 0);
  assert.ok(report.render.breakdown.near.pipeAttachments.drawCalls <= 12,
    'attachment geometry should be batched by material');
  assert.ok(report.render.breakdown.far.pipeAttachments.renderedTriangles > 0,
    'far views keep visible attachment silhouettes');
  assert.ok(report.render.breakdown.far.pipeAttachments.renderedTriangles
    < report.render.breakdown.near.pipeAttachments.renderedTriangles / 10,
  'far attachment silhouettes should remove most authored surface detail');
  assert.ok(report.render.breakdown.near.beamPipes.drawCalls <= 4,
    'thousands of authored pipe fittings should share a few instanced draws');
  assert.ok(report.render.breakdown.far.beamPipes.drawCalls > 0,
    'far views keep a visible beam-pipe presentation');
  assert.ok(report.render.breakdown.far.beamPipes.drawCalls
    <= report.render.breakdown.near.beamPipes.drawCalls,
  'far beam-pipe presentation should not add draw calls');
  assert.ok(report.render.breakdown.near.beamEffects.drawCalls <= 8,
    'beam segments should be instanced across paths and colors');
  assert.ok(report.render.far.shadowDrawCalls < report.render.near.shadowDrawCalls / 10,
    'far views should omit most per-object shadow draws');
  assert.equal(report.render.near.lights, 0,
    'beamline geometry should not create one real light per component');
  assert.ok(report.pipeDetailDemand.renderObjects > 4_000);
  assert.equal(report.physics.native.skipped, true);
  assert.equal(report.physics.scheduling.requests, TEN_LARGE_BEAMLINE_COUNT);
  assert.equal(report.physics.scheduling.workerJobs, 1);
  assert.equal(report.physics.scheduling.deduplicated, TEN_LARGE_BEAMLINE_COUNT - 1);
});
