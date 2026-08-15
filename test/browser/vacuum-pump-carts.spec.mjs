import { test, expect } from '@playwright/test';
import {
  bootFreshGame, createErrorCollector, expectRendererLive, frames,
} from './helpers.mjs';

test('compact roughing and turbo carts place and render inside 2×1×3 subtiles', async ({ page }) => {
  const errors = createErrorCollector(page);
  await bootFreshGame(page);
  await expectRendererLive(page);

  const placed = await page.evaluate(() => {
    window.dev.enable();
    const area = window.__bt.findClearArea(6, 4);
    if (!area) return null;
    const ids = window.game._batchEvents(() => [
      window.game.placePlaceable({
        type: 'roughingPumpCart', col: area.col, row: area.row,
        subCol: 0, subRow: 0, dir: 0, free: true, silent: true,
      }),
      window.game.placePlaceable({
        type: 'turboPumpCart', col: area.col + 2, row: area.row,
        subCol: 0, subRow: 0, dir: 0, free: true, silent: true,
      }),
    ]);
    window.__bt.centerOn(area.col + 1, area.row + 0.5);
    return { ids, area };
  });

  expect(placed, 'the generated map has a clear cart test area').not.toBeNull();
  expect(placed.ids.every(Boolean), 'both compact carts place').toBe(true);
  await frames(page, 4);

  const state = await page.evaluate(async (ids) => {
    const { COMPONENTS } = await import('/src/data/components.js');
    const { getModelBounds } = await import('/src/renderer3d/component-builder.js');
    return ['roughingPumpCart', 'turboPumpCart'].map((type, index) => ({
      type,
      dims: {
        subW: COMPONENTS[type].subW,
        subL: COMPONENTS[type].subL,
        subH: COMPONENTS[type].subH,
      },
      bounds: getModelBounds(type),
      rendered: window._renderer.componentBuilder._meshMap.has(ids[index]),
    }));
  }, placed.ids);

  for (const cart of state) {
    expect(cart.dims, `${cart.type} uses the compact authored envelope`)
      .toEqual({ subW: 1, subL: 2, subH: 3 });
    expect(cart.rendered, `${cart.type} has a live component mesh`).toBe(true);
    expect(cart.bounds.maxX - cart.bounds.minX, `${cart.type} fits its 0.5 m width`)
      .toBeLessThanOrEqual(0.500001);
    expect(cart.bounds.maxZ - cart.bounds.minZ, `${cart.type} fits its 1.0 m length`)
      .toBeLessThanOrEqual(1.000001);
    expect(cart.bounds.maxY - cart.bounds.minY, `${cart.type} fits its 1.5 m height`)
      .toBeLessThanOrEqual(1.500001);
  }
  errors.checkAll();

  await page.evaluate((ids) => {
    for (const id of ids) window.game.removePlaceable(id);
  }, placed.ids);
  await frames(page, 3);
  expect(await page.evaluate((ids) => ids.every(id =>
    !window._renderer.componentBuilder._meshMap.has(id)), placed.ids),
  'both cart meshes dispose cleanly').toBe(true);
  errors.checkAll();
});
