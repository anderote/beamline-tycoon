import { test, expect } from '@playwright/test';
import {
  createErrorCollector, expectRendererLive, bootFreshGame, autoAcceptDialogs,
} from './helpers.mjs';

test('Power transport leads with Power Cable and omits repeated drag hints', async ({ page }) => {
  const errors = createErrorCollector(page);
  autoAcceptDialogs(page);
  await bootFreshGame(page);
  await expectRendererLive(page);

  await page.click('.mode-btn[data-mode="infra"]');
  await page.click('.cat-tab[data-category="power"]');

  const tools = page.locator(
    '#component-palette .palette-item[data-palette-kind="utility"]',
  );
  await expect(tools).toHaveCount(2);
  await expect(tools.nth(0)).toHaveAttribute('data-palette-key', 'powerCable');
  await expect(tools.nth(1)).toHaveAttribute('data-palette-key', 'hvCable');
  await expect(tools.nth(0).locator('.palette-name')).toHaveText('Power Cable');
  await expect(tools.nth(1).locator('.palette-name')).toHaveText('HV Feeder');
  await expect(tools.locator('.palette-cost')).toHaveCount(0);
  errors.check('Power transport palette');
});
