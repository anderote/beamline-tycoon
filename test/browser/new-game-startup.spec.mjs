import { expect, test } from '@playwright/test';
import {
  blockRemoteDrive,
  createErrorCollector,
  expectRendererLive,
  waitForBoot,
} from './helpers.mjs';

test('title-screen Minor Lab reuses one renderer without a second page boot', async ({ page }) => {
  await blockRemoteDrive(page);
  await page.addInitScript(() => {
    const probe = { rendererAssignments: 0 };
    let renderer = null;
    window.__newGameStartupProbe = probe;
    Object.defineProperty(window, '_renderer', {
      configurable: true,
      get() { return renderer; },
      set(value) {
        renderer = value;
        probe.rendererAssignments++;
      },
    });
  });
  const errors = createErrorCollector(page);

  await page.goto('/');
  await page.mouse.click(720, 450);
  await waitForBoot(page, 300_000);
  await expect(page.getByRole('button', { name: 'New Game', exact: true })).toBeVisible();

  const before = await page.evaluate(() => ({
    timeOrigin: performance.timeOrigin,
    navigations: performance.getEntriesByType('navigation').length,
    assignments: window.__newGameStartupProbe.rendererAssignments,
  }));
  expect(before.assignments).toBeGreaterThan(0);

  // Scene construction and the Minor Lab draw/triangle budget have dedicated
  // tests. This spec isolates the session lifecycle: uploading that campus to
  // CPU-only SwiftShader can take minutes and obscures whether a reload or a
  // second renderer initialization occurred.
  await page.evaluate(() => {
    window.__newGameStartupProbe.refreshes = 0;
    window._renderer.refreshForNewSession = () => {
      window.__newGameStartupProbe.refreshes++;
      window._renderer._worldInvalidationScheduler.clear();
    };
  });

  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  const confirmation = new Promise((resolve, reject) => {
    page.once('dialog', dialog => dialog.accept().then(resolve, reject));
  });
  await page.locator('.scenario-card[data-id="minorLab"]').click();
  await confirmation;

  await expect(page.locator('#title-screen')).toHaveCount(0, { timeout: 120_000 });
  await page.waitForFunction(() => (
    window.game?.registry?.getAll?.().length > 0
    && window.game?.state?.placeables?.length > 100
    && window._renderer?.renderingSuspended === false
  ), null, { timeout: 120_000 });

  const after = await page.evaluate(() => ({
    timeOrigin: performance.timeOrigin,
    navigations: performance.getEntriesByType('navigation').length,
    assignments: window.__newGameStartupProbe.rendererAssignments,
    refreshes: window.__newGameStartupProbe.refreshes,
    beamlines: window.game.registry.getAll().length,
    placeables: window.game.state.placeables.length,
    started: window.game._started,
  }));

  // main.js republishes its one renderer on window at two composition seams.
  // In-place startup must not add another assignment; a page reload would
  // also restart the navigation clock.
  expect(after.assignments).toBe(before.assignments);
  expect(after.refreshes).toBe(1);
  expect(after.timeOrigin).toBe(before.timeOrigin);
  expect(after.navigations).toBe(before.navigations);
  expect(after.beamlines).toBeGreaterThan(0);
  expect(after.placeables).toBeGreaterThan(100);
  expect(after.started).toBe(true);

  await expectRendererLive(page);
  errors.checkAll('title-screen Minor Lab startup');
});
