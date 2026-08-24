import { test, expect } from '@playwright/test';
import { dismissWelcome, waitForBoot } from './helpers.mjs';

const ENABLED = process.env.BT_PERF === '1';

test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    channel: 'chrome',
    args: ['--enable-unsafe-webgpu'],
    ignoreDefaultArgs: ['--disable-gpu'],
  },
});

test.describe('land-purchase UI', () => {
  test.skip(!ENABLED, 'native-GPU validation lane — set BT_PERF=1 to run');

  test('buys land through a visible world marker', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('beamlineTycoon.skipTitle', '1');
    });
    await page.goto('/#game');
    await waitForBoot(page);
    await dismissWelcome(page);

    const point = await page.evaluate(() => {
      const r = window._renderer;
      window.game.state.resources.funding = 1e12;
      window.game.emit('resourcesChanged');
      const marker = r.landPurchaseMarkers.group.children[1];
      r._panX = marker.position.x;
      r._panY = marker.position.z;
      r.zoom = 1.4;
      r._updateCameraLookAt();
      r._syncOverlayFromPan();
      const world = marker.localToWorld(new THREE.Vector3(0, 0, 0));
      const screen = r.worldToScreen(world.x, world.y, world.z);
      return screen;
    });

    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(1440);
    expect(point.y).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(900);
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y);

    await expect.poll(() => page.evaluate(() => window.game.state.mapHalfExtent))
      .toBe(60);
    await page.waitForFunction(() => (
      !window._renderer._worldInvalidationScheduler.pending
      && !window._renderer._worldExpansionContinuationPending
      && !window._renderer._worldPipelineCompilePending
    ));
    await expect.poll(() => page.evaluate(() => ({
      markerCount: window._renderer.landPurchaseMarkers.group.children.length,
      decorationCount: window._renderer._snapshot.decorations.length,
      renderedPlants: window._renderer.decorationBuilder.getBatchStats().plantCount,
    }))).toMatchObject({ markerCount: 4 });
    const counts = await page.evaluate(() => ({
      decorationCount: window._renderer._snapshot.decorations.length,
      renderedPlants: window._renderer.decorationBuilder.getBatchStats().plantCount,
    }));
    expect(counts.renderedPlants).toBe(counts.decorationCount);
  });
});
