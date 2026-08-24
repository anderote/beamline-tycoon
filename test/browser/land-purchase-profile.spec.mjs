import { test, expect } from '@playwright/test';
import { waitForBoot } from './helpers.mjs';

const ENABLED = process.env.BT_PERF === '1';

test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    channel: 'chrome',
    args: ['--enable-unsafe-webgpu'],
    ignoreDefaultArgs: ['--disable-gpu'],
  },
});

test.describe('land purchase profile', () => {
  test.skip(!ENABLED, 'measurement lane — set BT_PERF=1 to run');
  test.setTimeout(300_000);

  test('attributes every expansion stall', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('beamlineTycoon.skipTitle', '1');
    });
    await page.goto('/#game');
    await waitForBoot(page);
    await page.waitForTimeout(8000);

    const backend = await page.evaluate(() => ({
      webgpu: window._renderer.renderer.backend?.isWebGPUBackend === true,
      extent: window.game.state.mapHalfExtent,
      placeables: window.game.state.placeables.length,
    }));
    expect(backend.webgpu).toBe(true);
    expect(backend.extent).toBe(30);

    await page.evaluate(() => {
      const game = window.game;
      const renderer = window._renderer;
      game.state.resources.funding = 1e12;
      const profile = {
        active: false,
        calls: [],
        frames: [],
        longTasks: [],
        gpu: [],
      };
      window.__landProfile = profile;

      const wrap = (owner, name, label = name) => {
        const original = owner[name].bind(owner);
        owner[name] = (...args) => {
          const start = performance.now();
          const result = original(...args);
          if (profile.active) profile.calls.push({ label, ms: performance.now() - start });
          return result;
        };
      };
      wrap(game, '_snapshot', 'game snapshot');
      wrap(game, '_rebuildPlaceableIndex', 'placeable index');
      wrap(renderer._worldInvalidationScheduler, 'flush', 'scheduler flush');
      wrap(renderer, '_applyWorldRefreshPlan', 'apply refresh plan');
      wrap(renderer, '_refreshTerrain', 'refresh terrain');
      wrap(renderer, '_refreshDecorations', 'refresh decorations');
      wrap(renderer, '_updateSnapshot', 'update snapshot');
      wrap(renderer, '_syncPhysicsTerrain', 'physics terrain sync');
      wrap(renderer, '_syncParticleCollisionWorld', 'particle collision sync');
      wrap(renderer.terrainBuilder, 'build', 'terrain geometry');
      wrap(renderer.cliffBuilder, 'build', 'cliff geometry');
      wrap(renderer.wildflowerBuilder, 'rebuild', 'wildflower geometry');
      wrap(renderer.grassTuftBuilder, 'rebuild', 'grass tuft geometry');
      wrap(renderer.decorationBuilder, 'build', 'decoration geometry');
      const realRender = renderer.renderer.render.bind(renderer.renderer);
      renderer.renderer.render = (scene, camera, ...args) => {
        const target = renderer.renderer.getRenderTarget?.();
        const start = performance.now();
        const result = realRender(scene, camera, ...args);
        if (profile.active) profile.calls.push({
          label: 'renderer render',
          ms: performance.now() - start,
          target: target?.texture?.name || target?.texture?.format || 'screen',
          draws: renderer.renderer.info?.render?.calls || 0,
          triangles: renderer.renderer.info?.render?.triangles || 0,
        });
        return result;
      };

      const device = renderer.renderer.backend?.device;
      for (const name of ['createShaderModule', 'createRenderPipeline', 'createBuffer']) {
        if (typeof device?.[name] !== 'function') continue;
        const original = device[name].bind(device);
        device[name] = descriptor => {
          const start = performance.now();
          const result = original(descriptor);
          if (profile.active) profile.gpu.push({
            name,
            ms: performance.now() - start,
            label: descriptor?.label || '',
            code: descriptor?.code?.length || 0,
            size: descriptor?.size || 0,
          });
          return result;
        };
      }

      let lastFrame = performance.now();
      const frame = () => {
        const now = performance.now();
        if (profile.active) profile.frames.push(now - lastFrame);
        lastFrame = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      if (typeof PerformanceObserver === 'function') {
        try {
          const observer = new PerformanceObserver(list => {
            if (!profile.active) return;
            for (const entry of list.getEntries()) {
              profile.longTasks.push({ start: entry.startTime, ms: entry.duration });
            }
          });
          observer.observe({ type: 'longtask', buffered: false });
        } catch { /* longtask is optional */ }
      }
    });

    const results = [];
    for (let purchase = 1; purchase <= 3; purchase++) {
      const command = await page.evaluate(() => {
        const p = window.__landProfile;
        p.calls.length = 0;
        p.frames.length = 0;
        p.longTasks.length = 0;
        p.gpu.length = 0;
        p.active = true;
        const start = performance.now();
        const result = window._renderer.landPurchaseMarkers.purchase();
        return { result, commandMs: performance.now() - start };
      });
      expect(command.result.ok).toBe(true);
      await page.waitForTimeout(5000);
      results.push(await page.evaluate(({ purchase, commandMs }) => {
        const p = window.__landProfile;
        p.active = false;
        const byLabel = {};
        for (const call of p.calls) {
          const row = byLabel[call.label] || { calls: 0, total: 0, max: 0 };
          row.calls += 1;
          row.total += call.ms;
          if (call.ms > row.max) {
            row.max = call.ms;
            row.maxDetail = call.target ? {
              target: call.target,
              draws: call.draws,
              triangles: call.triangles,
            } : null;
          }
          byLabel[call.label] = row;
        }
        const gpu = {};
        for (const call of p.gpu) {
          const row = gpu[call.name] || {
            calls: 0, totalMs: 0, totalBytes: 0, maxBytes: 0,
            maxCode: 0, labels: [],
          };
          row.calls += 1;
          row.totalMs += call.ms;
          row.totalBytes += call.size;
          row.maxBytes = Math.max(row.maxBytes, call.size);
          row.maxCode = Math.max(row.maxCode, call.code);
          if (call.label && row.labels.length < 12 && !row.labels.includes(call.label)) {
            row.labels.push(call.label);
          }
          gpu[call.name] = row;
        }
        const frames = [...p.frames].sort((a, b) => a - b);
        const quantile = q => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] || 0;
        return {
          purchase,
          commandMs: +commandMs.toFixed(2),
          extent: window.game.state.mapHalfExtent,
          placeables: window.game.state.placeables.length,
          frames: {
            count: frames.length,
            p50: +quantile(0.5).toFixed(2),
            p95: +quantile(0.95).toFixed(2),
            max: +(frames.at(-1) || 0).toFixed(2),
          },
          longTasks: p.longTasks.map(row => ({ ...row, ms: +row.ms.toFixed(2) })),
          gpu: Object.fromEntries(Object.entries(gpu).map(([name, row]) => [name, {
            ...row,
            totalMs: +row.totalMs.toFixed(2),
          }])),
          calls: Object.fromEntries(Object.entries(byLabel).map(([label, row]) => [label, {
            calls: row.calls,
            total: +row.total.toFixed(2),
            max: +row.max.toFixed(2),
            maxDetail: row.maxDetail,
          }])),
        };
      }, { purchase, commandMs: command.commandMs }));
    }

    console.log('\n=== LAND PURCHASE PROFILE ===\n' + JSON.stringify({ backend, results }, null, 2));
  });
});
