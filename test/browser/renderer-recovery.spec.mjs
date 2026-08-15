import { test, expect } from '@playwright/test';
import { waitForBoot } from './helpers.mjs';

test('device loss reloads once on WebGL 2 and stops a recovery loop', async ({ page }) => {
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
