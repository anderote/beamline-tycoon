#!/usr/bin/env node

import { runMinorLabBenchmark } from './perf/minor-lab-benchmark.mjs';

const argv = process.argv.slice(2);
const args = new Set(argv);
const json = args.has('--json');
const gate = args.has('--gate');
const iterationsArg = argv.find(arg => arg.startsWith('--iterations='));
const iterations = iterationsArg == null
  ? undefined
  : Number.parseInt(iterationsArg.slice('--iterations='.length), 10);
if (iterationsArg != null && (!Number.isInteger(iterations) || iterations < 1)) {
  throw new Error('--iterations must be a positive integer');
}

const report = await runMinorLabBenchmark({ iterations, quiet: json });
const round = value => Number.isFinite(value) ? Number(value.toFixed(2)) : value;

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log('\n=== Minor Lab saved scenario ===\n');
  console.table(report.scenario);
  console.log('\nCPU construction timings');
  console.table({
    coldSnapshot: { meanMs: round(report.timings.coldSnapshotMs), p50Ms: '', p95Ms: '' },
    warmSnapshot: {
      meanMs: round(report.timings.warmSnapshot.meanMs),
      p50Ms: round(report.timings.warmSnapshot.p50Ms),
      p95Ms: round(report.timings.warmSnapshot.p95Ms),
    },
    sceneBuild: {
      meanMs: round(report.timings.sceneBuild.meanMs),
      p50Ms: round(report.timings.sceneBuild.p50Ms),
      p95Ms: round(report.timings.sceneBuild.p95Ms),
    },
  });
  console.log('\nScene build by subsystem');
  console.table(Object.fromEntries(Object.entries(report.timings.builders)
    .map(([name, timing]) => [name, {
      meanMs: round(timing.meanMs),
      p50Ms: round(timing.p50Ms),
      p95Ms: round(timing.p95Ms),
    }])));
  console.log('\nLOD transition CPU timings');
  console.table(Object.fromEntries(Object.entries(report.timings.lodTransition)
    .map(([name, timing]) => [name, {
      meanMs: round(timing.meanMs),
      p50Ms: round(timing.p50Ms),
      p95Ms: round(timing.p95Ms),
    }])));
  console.log('\nHeadless render structure');
  console.table({
    near: {
      meshes: report.render.near.visibleMeshes,
      drawCalls: report.render.near.drawCalls,
      triangles: report.render.near.renderedTriangles,
      shadowCalls: report.render.near.shadowDrawCalls,
    },
    far: {
      meshes: report.render.far.visibleMeshes,
      drawCalls: report.render.far.drawCalls,
      triangles: report.render.far.renderedTriangles,
      shadowCalls: report.render.far.shadowDrawCalls,
    },
    savingsPercent: {
      meshes: '',
      drawCalls: round(report.savings.drawCallsPercent),
      triangles: round(report.savings.trianglesPercent),
      shadowCalls: round(report.savings.shadowDrawCallsPercent),
    },
  });
  console.log('\nNear → far by subsystem');
  console.table(Object.fromEntries(Object.keys(report.render.breakdown.near).map(name => {
    const near = report.render.breakdown.near[name];
    const far = report.render.breakdown.far[name];
    return [name, {
      nearDraws: near.drawCalls,
      farDraws: far.drawCalls,
      nearTriangles: near.renderedTriangles,
      farTriangles: far.renderedTriangles,
    }];
  })));
  console.log('\nStructural targets');
  console.table(Object.fromEntries(report.targets.map(target => [target.name, {
    result: target.pass ? 'PASS' : 'FAIL',
    actual: round(target.actual),
    target: target.target,
    unit: target.unit,
  }])));
  console.log('\nHeadless CPU/scene benchmark only; browser FPS and GPU timings remain owner-run checks.');
}

if (gate && !report.pass) process.exitCode = 1;
