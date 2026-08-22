import { test, expect } from '@playwright/test';
import {
  bootFreshGame, createErrorCollector, expectRendererLive, frames,
} from './helpers.mjs';

test('hovered distribution panel owns Tab without opening its info window', async ({ page }) => {
  const errors = createErrorCollector(page);
  await bootFreshGame(page);
  await expectRendererLive(page);

  const setup = await page.evaluate(() => {
    const g = window.game;
    const area = window.__bt.findClearArea(8, 4);
    if (!area) return null;
    return g._batchEvents(() => {
      const panelId = g.placePlaceable({
        type: 'powerPanel', col: area.col, row: area.row,
        subCol: 0, subRow: 0, dir: 0, free: true, silent: true,
      });
      const loadIds = ['rackIoc', 'areaMonitor', 'roughingPump'].map((type, index) =>
        g.placePlaceable({
          type, col: area.col + index + 1, row: area.row,
          subCol: 0, subRow: 0, dir: 0, free: true, silent: true,
        }));
      window.__bt.centerOn(area.col + 1.5, area.row + 0.5);
      return { panelId, loadIds, area };
    });
  });
  expect(setup, 'the generated map has a clear panel test area').not.toBeNull();
  expect(setup.panelId).toBeTruthy();
  expect(setup.loadIds.every(Boolean), 'all nearby power loads placed').toBe(true);
  await frames(page, 4);

  const panelPoint = await page.evaluate((panelId) => {
    const root = window._renderer.componentBuilder._meshMap.get(panelId);
    if (!root) return null;
    const centre = new window.THREE.Box3().setFromObject(root).getCenter(new window.THREE.Vector3());
    return window.__bt.worldToScreen(centre.x, centre.y, centre.z);
  }, setup.panelId);
  expect(panelPoint, 'the panel has a rendered selection target').not.toBeNull();

  await page.mouse.move(panelPoint.x, panelPoint.y);
  await expect(page.locator('.hover-tooltip-detail')).toHaveText(
    '3 unconnected power connections in range · Tab connects 3',
  );

  const categoryBefore = await page.evaluate(() =>
    window._renderer._inputHandler.selectedCategory);
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.game.state.utilityLines.size)).toBe(3);
  expect(await page.evaluate(() => window._renderer._inputHandler.selectedCategory),
    'hovered-panel Tab does not also cycle the build palette').toBe(categoryBefore);
  expect(await page.evaluate(() => window._renderer._inputHandler.selectedPlaceableId),
    'hover auto-connect does not select the panel').toBeNull();
  await expect(page.locator(`.ctx-window[data-ctx-id="equip-${setup.panelId}"]`))
    .toHaveCount(0);

  const connectedLoads = await page.evaluate(() => [...window.game.state.utilityLines.values()]
    .map(line => line.end.placeableId).sort());
  expect(connectedLoads).toEqual(setup.loadIds.slice().sort());

  await page.mouse.move(4, 4);
  await expect(page.locator('.hover-tooltip')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() =>
    window._renderer._inputHandler.selectedCategory)).not.toBe(categoryBefore);

  errors.checkAll();
});
