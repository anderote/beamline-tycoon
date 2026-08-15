#!/usr/bin/env node

import { runTenLargeBenchmark } from './perf/ten-large-benchmark.mjs';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const gate = args.has('--gate');
const includePhysics = !args.has('--no-physics');

const report = await runTenLargeBenchmark({ quiet: json, includePhysics });

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const round = value => Number.isFinite(value) ? Number(value.toFixed(2)) : value;
  console.log('\n=== Ten Large Beamlines ===\n');
  console.table({
    beamlines: report.scenario.beamlines,
    hardware: report.scenario.hardware,
    physicsGraphElements: report.scenario.flattenedElements,
    mapHalfExtent: report.scenario.mapHalfExtent,
  });
  console.log('\nCPU timings');
  console.table({
    tick: { meanMs: round(report.timings.tick.meanMs), p95Ms: round(report.timings.tick.p95Ms), totalMs: '' },
    recalcFallback: { meanMs: round(report.timings.recalcFallback.meanMs), p95Ms: round(report.timings.recalcFallback.p95Ms), totalMs: '' },
    partialSnapshot: { meanMs: round(report.timings.partialSnapshot.meanMs), p95Ms: round(report.timings.partialSnapshot.p95Ms), totalMs: '' },
    warmFullSnapshot: { meanMs: round(report.timings.warmFullSnapshot.meanMs), p95Ms: round(report.timings.warmFullSnapshot.p95Ms), totalMs: '' },
    coldFullSnapshot: { meanMs: round(report.timings.coldFullSnapshotMs), p95Ms: '', totalMs: round(report.timings.coldFullSnapshotMs) },
    [`physicsSchedule (${report.physics.scheduling.requests} requests)`]: {
      meanMs: round(report.physics.scheduling.mainThreadScheduleMs), p95Ms: '', totalMs: '',
    },
    [`backgroundNativePhysics (${report.physics.native.workerJobs} job)`]: {
      meanMs: round(report.physics.native.meanMs), p95Ms: '', totalMs: round(report.physics.native.totalMs),
    },
  });
  console.log('\nHeadless render structure');
  console.table({
    near: {
      meshes: report.render.near.visibleMeshes,
      drawCalls: report.render.near.drawCalls,
      triangles: report.render.near.renderedTriangles,
      shadowCalls: report.render.near.shadowDrawCalls,
      lights: report.render.near.lights,
    },
    far: {
      meshes: report.render.far.visibleMeshes,
      drawCalls: report.render.far.drawCalls,
      triangles: report.render.far.renderedTriangles,
      shadowCalls: report.render.far.shadowDrawCalls,
      lights: report.render.far.lights,
    },
    batchedBeamPipes: {
      meshes: report.render.breakdown.near.beamPipes.visibleMeshes,
      drawCalls: report.render.breakdown.near.beamPipes.drawCalls,
      triangles: report.render.breakdown.near.beamPipes.renderedTriangles,
      shadowCalls: report.render.breakdown.near.beamPipes.shadowDrawCalls,
      lights: 0,
    },
    authoredPipeDetail: {
      meshes: report.pipeDetailDemand.renderObjects,
      drawCalls: '',
      triangles: report.pipeDetailDemand.renderedTriangles,
      shadowCalls: '',
      lights: 0,
    },
  });
  console.log('\nNear scene by subsystem');
  console.table(Object.fromEntries(Object.entries(report.render.breakdown.near).map(([name, metrics]) => [name, {
    meshes: metrics.visibleMeshes,
    drawCalls: metrics.drawCalls,
    triangles: metrics.renderedTriangles,
    shadowCalls: metrics.shadowDrawCalls,
    glowMeshes: metrics.glowMeshes,
    lights: metrics.lights,
  }])));
  console.log('\nTargets');
  console.table(Object.fromEntries(report.targets.map(target => [target.name, {
    result: target.skipped ? 'SKIP' : (target.pass ? 'PASS' : 'FAIL'),
    actual: round(target.actual),
    target: target.target,
    unit: target.unit,
  }])));
  console.log(`\nPhysics coalescing: ${report.physics.scheduling.requests} requests -> ${report.physics.scheduling.workerJobs} worker job(s).`);
  console.log('Structural/headless benchmark only; native CPython is a lower-bound proxy for worker-hosted Pyodide.');
  console.log('Exact FPS and GPU/shadow-map time require the owner-enabled browser lane.');
}

if (gate && !report.pass) process.exitCode = 1;
