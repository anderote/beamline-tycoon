import { expect, test } from '@playwright/test';
import {
  blockRemoteDrive,
  expectRendererLive,
  waitForBoot,
} from './helpers.mjs';

test('saved startup builds once and defers hidden GPU frames until Continue', async ({ page }) => {
  await blockRemoteDrive(page);
  await page.addInitScript(() => {
    const probe = { refreshes: [], suspensionChanges: [] };
    let renderer = null;
    window.__startupProbe = probe;
    Object.defineProperty(window, '_renderer', {
      configurable: true,
      get() { return renderer; },
      set(value) {
        renderer = value;
        const refresh = value.refresh.bind(value);
        value.refresh = (...args) => {
          probe.refreshes.push(performance.now());
          return refresh(...args);
        };
        const setRenderingSuspended = value.setRenderingSuspended.bind(value);
        value.setRenderingSuspended = (suspended) => {
          const result = setRenderingSuspended(suspended);
          probe.suspensionChanges.push(result);
          return result;
        };
      },
    });
  });

  // Make a real active-slot save through the production serializer, then
  // reload onto the title path that previously rebuilt the complete world
  // from init(), the loaded event, and main.js finalization.
  await page.goto('/');
  await page.mouse.click(720, 450);
  await waitForBoot(page, 300_000);
  await expect(page.getByRole('button', { name: 'New Game', exact: true })).toBeVisible();
  await page.evaluate(() => window.game.save());
  await page.reload();
  await page.mouse.click(720, 450);
  await waitForBoot(page, 300_000);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await page.waitForFunction(() => (
    window._renderer.usesNativeWebGPU() || !window._renderer.renderingSuspended
  ));

  const covered = await page.evaluate(() => ({
    refreshes: window.__startupProbe.refreshes.length,
    renderingSuspended: window._renderer.renderingSuspended,
    nativeWebGPU: window._renderer.usesNativeWebGPU(),
    drawCalls: window._renderer.renderer.info.render.calls,
  }));
  expect(covered.refreshes, 'init + one final loaded-world build').toBe(2);
  if (covered.nativeWebGPU) {
    expect(covered.renderingSuspended, 'opaque title owns the display').toBe(true);
    expect(covered.drawCalls, 'one prepared final-world frame is available').toBeGreaterThan(0);
  } else {
    expect(covered.renderingSuspended, 'WebGL amortizes synchronous compilation after boot').toBe(false);
  }

  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window._renderer.renderingSuspended)).toBe(false);
  await expectRendererLive(page);

  const transition = await page.evaluate(() => window.__startupProbe.suspensionChanges);
  expect(transition).toContain(false);
});
