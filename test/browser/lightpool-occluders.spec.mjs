// test/browser/lightpool-occluders.spec.mjs — guards the light-pool tracer
// against the batched-occluder performance trap.
//
//   BT_PERF=1 npx playwright test lightpool-occluders --reporter=list
//
// buildLightPools fires 32 rays per fixture and reruns on EVERY wall rebuild
// (_refreshWalls -> _rebuildLightPools({ invalidateOcclusion: true }), which a
// camera rotation triggers via _applyWallVisibility). What it raycasts against
// therefore has to stay cheap.
//
// Raycasting the wall GROUP is not cheap once walls are batched: a
// BatchedMesh's bounding sphere covers every instance it holds — the whole
// facility — so no ray is ever rejected by the cheap sphere test and each one
// descends into hundreds of per-instance intersections. Before batching the
// group held ~1,000 small meshes with tight spheres and a ray near one lamp
// rejected nearly all of them outright.
//
// This spec measures both target sets on the same map and fails if tracing
// against the group is not dramatically worse — i.e. if someone "simplifies"
// WallBuilder.occluderMeshes() back to the wall group, this goes red.

import { test, expect } from '@playwright/test';
import { waitForBoot } from './helpers.mjs';

const SCENARIO_URL = '/rescue/majorLab.scenario.json';
const ENABLED = process.env.BT_PERF === '1';

test.describe('light pool occluders', () => {
  test.skip(!ENABLED, 'measurement lane — set BT_PERF=1 to run');
  test.setTimeout(900_000);

  test('tracing uses tight-bounded per-wall sources, not the batched group', async ({ page, baseURL }) => {
    const res = await page.request.get(`${baseURL}${SCENARIO_URL}`);
    expect(res.ok()).toBe(true);
    const exported = await res.json();

    await page.addInitScript((exp) => {
      localStorage.setItem('beamlineTycoon.customScenarios.' + exp.id, JSON.stringify({
        id: exp.id, name: exp.name, desc: '', data: exp.data, sandbox: true, updatedAt: 1,
      }));
      localStorage.setItem('beamlineTycoon.customScenarioIndex', JSON.stringify([
        { id: exp.id, name: exp.name, desc: '', sandbox: true, updatedAt: 1 },
      ]));
      localStorage.setItem('beamlineTycoon.pendingScenario', '__custom__:' + exp.id);
    }, exported);

    await page.goto('/');
    await waitForBoot(page);
    await page.waitForTimeout(4000);

    const result = await page.evaluate(async () => {
      const r = window._renderer;
      const wb = r.wallBuilder;

      // Cost model that mirrors what the tracer actually does: fire rays from
      // fixture-like origins and intersect each candidate target set.
      const sources = wb.occluderMeshes();
      const batches = r.wallGroup.children.filter(c => c.isBatchedMesh);

      const walls = window.game.state.walls;
      const origins = [];
      for (let i = 0; i < 12 && i < walls.length; i++) {
        const w = walls[Math.floor((i / 12) * walls.length)];
        origins.push(new THREE.Vector3(w.col * 2, 1.6, w.row * 2));
      }

      const trace = (targets) => {
        const raycaster = new THREE.Raycaster();
        const dir = new THREE.Vector3();
        const t0 = performance.now();
        let hits = 0;
        for (const origin of origins) {
          for (let i = 0; i < 32; i++) {
            const a = (i / 32) * Math.PI * 2;
            dir.set(Math.cos(a), 0, Math.sin(a)).normalize();
            raycaster.set(origin, dir);
            raycaster.near = 0.04;
            raycaster.far = 6;
            if (raycaster.intersectObjects(targets, true).length) hits++;
          }
        }
        return { ms: +(performance.now() - t0).toFixed(1), hits };
      };

      // Warm both paths so neither pays one-off bounding-volume computation.
      trace(sources); trace(batches);

      const viaSources = trace(sources);
      const viaBatches = trace(batches);

      // The real thing, end to end: what a wall rebuild actually costs now.
      const t0 = performance.now();
      r._rebuildLightPools({ invalidateOcclusion: true });
      const rebuildMs = +(performance.now() - t0).toFixed(1);

      return {
        sourceMeshes: sources.length,
        batchedMeshes: batches.length,
        rays: origins.length * 32,
        viaSources,
        viaBatches,
        rebuildMs,
        fixtures: (r.lightingGroup?.length ?? r._lastLightingGroup?.length ?? -1),
      };
    });

    console.log(`
=== LIGHT POOL OCCLUDER COST ===
  per-wall source meshes   ${result.sourceMeshes}
  batched meshes           ${result.batchedMeshes}
  rays fired               ${result.rays}

  trace via sources        ${result.viaSources.ms} ms   (${result.viaSources.hits} hits)
  trace via batched group  ${result.viaBatches.ms} ms   (${result.viaBatches.hits} hits)
  ratio                    ${(result.viaBatches.ms / Math.max(result.viaSources.ms, 0.01)).toFixed(1)}x

  _rebuildLightPools()     ${result.rebuildMs} ms   (fixtures: ${result.fixtures})
`);

    // Both target sets must SEE the same walls — this is a cost difference,
    // never a correctness one. Allow a small margin for instance-level
    // precision differences at grazing angles.
    expect(Math.abs(result.viaSources.hits - result.viaBatches.hits),
      'both occluder sets block the same rays').toBeLessThanOrEqual(result.rays * 0.02);

    // The point of the guard: sources must be materially cheaper.
    expect(result.viaSources.ms, 'tracing per-wall sources is cheaper than tracing batches')
      .toBeLessThan(result.viaBatches.ms);

    // And a full rebuild must stay interactive. Headless SwiftShader is far
    // slower than the player's GPU, so this is a generous ceiling that still
    // catches an order-of-magnitude regression.
    expect(result.rebuildMs, '_rebuildLightPools stays off the multi-second path')
      .toBeLessThan(2000);
  });
});
