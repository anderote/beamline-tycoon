// Native-Chrome/WebGPU profile for the Minor Lab cold and warm object-LOD
// boundary. Opt-in because it launches the installed Chrome and reports real
// hardware timings rather than portable CI numbers:
//
//   BT_PERF=1 npx playwright test lod-transition-profile --reporter=list

import { expect, test } from '@playwright/test';
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

test.describe('Minor Lab native WebGPU LOD transition', () => {
  test.skip(!ENABLED, 'measurement lane — set BT_PERF=1 to run');
  test.setTimeout(600_000);

  test('profiles startup, the cold boundary, and warm crossings', async ({ page }) => {
    const navigationStart = Date.now();
    await page.goto('/');
    await page.mouse.click(720, 450);
    await waitForBoot(page, 300_000);

    await page.getByRole('button', { name: 'New Game', exact: true }).click();
    const confirmation = new Promise((resolve, reject) => {
      page.once('dialog', dialog => dialog.accept().then(resolve, reject));
    });
    const scenarioStart = Date.now();
    await page.locator('.scenario-card[data-id="minorLab"]').click();
    await confirmation;
    await expect(page.locator('#title-screen')).toHaveCount(0, { timeout: 300_000 });
    await page.waitForFunction(() => (
      window.game?.state?.placeables?.length > 1000
      && window._renderer?.renderingSuspended === false
    ), null, { timeout: 300_000 });
    const scenarioMs = Date.now() - scenarioStart;

    // Give the CPU-only idle preparation scheduler time to build dormant far
    // geometry without forcing any renderer.compile/compileAsync operation.
    await page.waitForTimeout(3000);
    const profile = await page.evaluate(async () => {
      const renderer = window._renderer;
      const nextPaint = () => new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      const queueSettled = async () => {
        const queue = renderer.renderer?.backend?.device?.queue;
        if (!queue?.onSubmittedWorkDone) return null;
        const start = performance.now();
        await Promise.race([
          queue.onSubmittedWorkDone(),
          new Promise(resolve => setTimeout(resolve, 10000)),
        ]);
        return performance.now() - start;
      };
      const lights = () => {
        let active = 0;
        renderer.scene.traverse(object => {
          if (object.isLight && object.intensity > 0) active++;
        });
        return active;
      };
      const meshes = () => {
        let visible = 0;
        let mergedFar = 0;
        renderer.scene.traverse(object => {
          if (object.isMesh && object.visible) visible++;
          if (object.userData?.farTriangleRanges) mergedFar++;
        });
        return { visible, mergedFar };
      };
      const cross = async (zoom) => {
        const activeLightsBefore = lights();
        const start = performance.now();
        renderer.zoom = zoom;
        renderer._updateLOD();
        const jsMs = performance.now() - start;
        await nextPaint();
        const paintedMs = performance.now() - start;
        return {
          zoom,
          jsMs,
          paintedMs,
          queueMs: await queueSettled(),
          activeLightsBefore,
          activeLightsAfter: lights(),
          meshes: meshes(),
        };
      };

      renderer.zoom = 2.3;
      renderer._updateLOD();
      await nextPaint();
      const coldFar = await cross(1.7);
      const restoreNear = await cross(2.3);
      const warmFar = await cross(1.7);
      const warmNear = await cross(2.3);
      return {
        backend: renderer.usesNativeWebGPU?.() ? 'webgpu' : 'webgl',
        coldFar,
        restoreNear,
        warmFar,
        warmNear,
      };
    });

    console.log('  native LOD profile: ' + JSON.stringify({
      navigationMs: Date.now() - navigationStart,
      scenarioMs,
      ...profile,
    }));
    expect(profile.backend).toBe('webgpu');
    expect(scenarioMs, 'Minor Lab becomes interactive without a prolonged startup stall')
      .toBeLessThan(15_000);
    expect(profile.coldFar.jsMs, 'visibility swap stays out of JavaScript').toBeLessThan(20);
    expect(profile.coldFar.paintedMs, 'first far transition avoids a visible GPU stall')
      .toBeLessThan(300);
    expect(profile.warmFar.paintedMs, 'warm far transition avoids a visible stall').toBeLessThan(500);
    expect(profile.warmNear.paintedMs, 'warm near transition avoids a visible stall').toBeLessThan(500);
    expect(profile.coldFar.activeLightsAfter,
      'equipment/screen lights remain stable across the far boundary')
      .toBe(profile.coldFar.activeLightsBefore);
    expect(profile.restoreNear.activeLightsAfter,
      'lights remain stable when authored detail returns')
      .toBe(profile.restoreNear.activeLightsBefore);
  });
});
