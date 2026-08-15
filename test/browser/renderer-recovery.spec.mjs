import { test, expect } from '@playwright/test';
import { waitForBoot } from './helpers.mjs';

test('repeated device loss falls back to WebGL 2 and stops a recovery loop', async ({ page }) => {
  // Pretend the immediately preceding document already made the one allowed
  // WebGPU recreation attempt. This keeps the browser test to two expensive
  // software-rendered boots; the first-attempt state machine is unit-tested.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('beamlineTycoon.rendererRecoveryReloadAt')) {
      sessionStorage.setItem('beamlineTycoon.rendererRecoveryReloadAt', String(Date.now()));
    }
  });
  await page.goto('/');
  await waitForBoot(page);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.evaluate(() => {
      window._renderer.renderer.onDeviceLost({
        api: 'WebGPU',
        message: 'synthetic browser test loss',
        reason: 'unknown',
      });
    }),
  ]);

  await waitForBoot(page);
  const recovered = await page.evaluate(() => ({
    stats: window._renderer.getLightingStats(),
    recoveryMode: sessionStorage.getItem('beamlineTycoon.rendererRecovery'),
  }));
  expect(recovered.recoveryMode).toBe('legacy');
  expect(recovered.stats.requestedRendererMode).toBe('legacy');
  expect(recovered.stats.rendererBackend).toBe('webgl2');

  await page.evaluate(() => {
    window._renderer.renderer.onDeviceLost({
      api: 'WebGL',
      message: 'synthetic repeated browser test loss',
      reason: null,
    });
  });
  await expect(page.locator('#graphics-recovery-error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload Graphics' })).toBeVisible();
});
