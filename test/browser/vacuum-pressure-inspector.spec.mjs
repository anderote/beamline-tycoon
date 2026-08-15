import { test, expect } from '@playwright/test';
import {
  bootFreshGame, createErrorCollector, expectRendererLive, frames,
} from './helpers.mjs';

test('clicking a vacuum pipeline opens its ten-day pressure plot by default', async ({ page }) => {
  const errors = createErrorCollector(page);
  await bootFreshGame(page);
  await expectRendererLive(page);

  const setup = await page.evaluate(async () => {
    window.dev.enable();
    const game = window.game;
    const area = window.__bt.findClearArea(10, 6);
    if (!area) return null;

    const pumpId = game.placePlaceable({
      type: 'roughingPump', col: area.col + 1, row: area.row + 2,
      dir: 0, free: true, silent: true,
    });
    const sinkId = game.placePlaceable({
      type: 'faradayCup', col: area.col + 8, row: area.row + 2,
      dir: 0, free: true, silent: true,
    });
    const { wireUtility } = await import('/src/data/scenarios/scenario-wiring.js');
    const lineId = wireUtility(game, 'vacuumPipe',
      { id: pumpId, port: 'vac_out' }, { id: sinkId, port: 'vac_in' });
    if (!lineId) return null;

    // Publish the first pressure sample now so the click-created inspector
    // does not depend on the wall-clock timing of the game's next tick.
    game.solveRunner.runSolve(game.state);
    game.emit('utilityLinesChanged', {});
    const line = game.state.utilityLines.get(lineId);
    const middle = line.path[Math.floor(line.path.length / 2)];
    window.__bt.centerOn(middle.col, middle.row, 1.0);
    return { lineId };
  });

  expect(setup, 'the vacuum test network was created').not.toBeNull();
  await frames(page, 4);

  const hitPoint = await page.evaluate((lineId) => {
    const line = window.game.state.utilityLines.get(lineId);
    const candidates = [];
    for (let i = 1; i < line.path.length; i++) {
      const a = line.path[i - 1];
      const b = line.path[i];
      for (const t of [0.25, 0.5, 0.75]) {
        candidates.push({
          col: a.col + (b.col - a.col) * t,
          row: a.row + (b.row - a.row) * t,
        });
      }
    }
    for (const point of candidates) {
      const screen = window.__bt.worldToScreen(point.col * 2, 0.07, point.row * 2);
      if (window._renderer.raycastUtilityLine(screen.x, screen.y)?.lineId === lineId) {
        return screen;
      }
    }
    return null;
  }, setup.lineId);

  expect(hitPoint, 'a visible point on the vacuum pipeline can be clicked').not.toBeNull();
  await page.mouse.click(hitPoint.x, hitPoint.y);

  const inspector = page.locator('#context-windows-container .ctx-window', {
    hasText: 'Vacuum Pipe',
  });
  await expect(inspector).toBeVisible();
  await expect(inspector.locator('.vacuum-pressure-chart')).toBeVisible();
  await expect(inspector.locator('.vacuum-pressure-chart')).toHaveAttribute(
    'aria-label', 'Vacuum pressure over the last 10d of in-game time',
  );
  await expect(inspector.locator('[data-vacuum-range-ticks="2400"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector.locator('[data-vacuum-range-ticks]')).toHaveText(['1d', '2d', '10d']);
  await expect(inspector).toContainText('Network');
  await expect(inspector).not.toContainText('Mount a Pirani');
  errors.checkAll();
});
