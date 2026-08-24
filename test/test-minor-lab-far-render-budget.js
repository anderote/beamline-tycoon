// Structural (non-browser) budget for the stock save that motivated the
// facility-wide LOD pass. This counts production-builder submissions; it does
// not claim GPU timing or FPS.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runMinorLabBenchmark } from '../scripts/perf/minor-lab-benchmark.mjs';

test('Minor Lab far presentation stays within the whole-facility render budget', async () => {
  const benchmark = await runMinorLabBenchmark({
    iterations: 1,
    snapshotIterations: 1,
    quiet: true,
  });
  const report = benchmark.render;

  assert.ok(report.near.drawCalls > 7000,
    'fixture still exercises the expensive authored scene that prompted the LOD');
  assert.ok(report.far.drawCalls <= 550,
    `far facility stays at or below 550 draws (got ${report.far.drawCalls})`);
  assert.ok(report.far.renderedTriangles <= 125000,
    `far facility stays at or below 125k triangles (got ${report.far.renderedTriangles})`);
  assert.ok(report.far.shadowDrawCalls <= 60,
    `only structural walls retain far shadows (got ${report.far.shadowDrawCalls})`);
  assert.equal(report.far.detailMeshes, 0, 'no detail-tagged geometry leaks into far zoom');
  assert.equal(report.far.glowMeshes, 0, 'hidden machine and fixture glows leave the far render');

  const far = report.breakdown.far;
  assert.ok(far.components.drawCalls <= 40);
  assert.ok(far.equipment.drawCalls <= 40);
  assert.ok(far.decorations.drawCalls <= 60);
  assert.ok(far.utilities.drawCalls <= 320);
  assert.ok(report.far.drawCalls < report.near.drawCalls / 10,
    `far LOD removes over 90% of authored draws (${report.near.drawCalls} -> ${report.far.drawCalls})`);
  assert.ok(benchmark.timings.sceneBuild.meanMs > 0,
    'the reusable benchmark reports production scene construction time');
  assert.ok(benchmark.timings.lodTransition.firstFarMs.meanMs > 0,
    'the reusable benchmark reports first-transition CPU time');
  assert.equal(benchmark.pass, true, 'the benchmark structural gate passes');
});
