import { test, expect } from '@playwright/test';
import {
  bootFreshGame, createErrorCollector, expectRendererLive, frames,
} from './helpers.mjs';

test('selected distribution panel owns Tab and advertises live nearby plugs on hover', async ({ page }) => {
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
    '3 unconnected power plugs in range · Tab connects 3',
  );

  // Selection itself is existing, separately-covered behavior. Use its public
  // input entry point as scaffolding so this spec stays about the new Tab
  // ownership and does not depend on pixel-perfect picking at a map edge.
  await page.evaluate((panelId) => {
    const input = window._renderer._inputHandler;
    input._selectPlaceable(window.game.getPlaceable(panelId));
  }, setup.panelId);
  await expect.poll(() => page.evaluate(() =>
    window._renderer._inputHandler.selectedPlaceableId)).toBe(setup.panelId);
  await expect(page.locator('.ctx-action-btn').filter({ hasText: 'Auto-connect' }))
    .toContainText('Tab');

  const categoryBefore = await page.evaluate(() =>
    window._renderer._inputHandler.selectedCategory);
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.game.state.utilityLines.size)).toBe(3);
  expect(await page.evaluate(() => window._renderer._inputHandler.selectedCategory),
    'selected-panel Tab does not also cycle the build palette').toBe(categoryBefore);

  const connectedLoads = await page.evaluate(() => [...window.game.state.utilityLines.values()]
    .map(line => line.end.placeableId).sort());
  expect(connectedLoads).toEqual(setup.loadIds.slice().sort());

  // Clear the selection through the same input seam an empty-ground click
  // uses; the keyboard event below remains real user input.
  await page.evaluate(() => window._renderer._inputHandler._clearSelection());
  await expect.poll(() => page.evaluate(() =>
    window._renderer._inputHandler.selectedPlaceableId)).toBeNull();
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() =>
    window._renderer._inputHandler.selectedCategory)).not.toBe(categoryBefore);

  errors.checkAll();
});
