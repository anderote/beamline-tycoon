import { test, expect } from '@playwright/test';
import {
  createErrorCollector, expectRendererLive, bootFreshGame, autoAcceptDialogs, frames,
} from './helpers.mjs';

test('vacuum manifold variants place, render, rotate, and dispose', async ({ page }) => {
  const errors = createErrorCollector(page);
  autoAcceptDialogs(page);
  await bootFreshGame(page);
  await expectRendererLive(page);

  const ids = await page.evaluate(() => {
    window.dev.enable();
    const g = window.game;
    for (const id of g.state.placeables.map(p => p.id)) g.removePlaceable(id);
    return [
      g.placePlaceable({
        type: 'vacuumManifold', col: -2, row: 0,
        subCol: 0, subRow: 0, dir: 0, free: true, silent: true,
      }),
      g.placePlaceable({
        type: 'vacuumManifold8', col: 2, row: 0,
        subCol: 0, subRow: 0, dir: 1, free: true, silent: true,
      }),
    ];
  });
  expect(ids.every(Boolean), 'both manifold variants place').toBe(true);
  await frames(page, 3);
  errors.check('render vacuum manifolds');
  await expectRendererLive(page);

  await page.evaluate((placedIds) => {
    for (const id of placedIds) window.game.removePlaceable(id);
  }, ids);
  await frames(page, 3);
  errors.check('dispose vacuum manifolds');
  expect(await page.evaluate(() => window.game.state.placeables.length)).toBe(0);
});
