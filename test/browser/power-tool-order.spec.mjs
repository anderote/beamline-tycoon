import { test, expect } from '@playwright/test';
import {
  createErrorCollector, expectRendererLive, bootFreshGame, autoAcceptDialogs,
} from './helpers.mjs';

test('Power and RF palettes expose their transport tools in workflow order', async ({ page }) => {
  const errors = createErrorCollector(page);
  autoAcceptDialogs(page);
  await bootFreshGame(page);
  await expectRendererLive(page);

  await page.click('.mode-btn[data-mode="infra"]');

  const infraTabs = page.locator('#category-tabs .cat-tab');
  await expect(infraTabs.nth(0)).toHaveAttribute('data-category', 'power');
  await expect(infraTabs.nth(1)).toHaveAttribute('data-category', 'rfPower');
  await expect(infraTabs.nth(2)).toHaveAttribute('data-category', 'vacuum');

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

  await page.click('.cat-tab[data-category="rfPower"]');
  await expect(tools).toHaveCount(2);
  await expect(tools.nth(0)).toHaveAttribute('data-palette-key', 'rfWaveguide');
  await expect(tools.nth(1)).toHaveAttribute('data-palette-key', 'hvCable');
  await expect(tools.nth(0).locator('.palette-name')).toHaveText('RF Waveguide');
  await expect(tools.nth(1).locator('.palette-name')).toHaveText('HV Feeder');

  await page.click('.mode-btn[data-mode="beamline"]');
  const beamlineTabs = page.locator('#category-tabs .cat-tab');
  await expect(beamlineTabs.nth(0)).toHaveAttribute('data-category', 'source');
  await expect(beamlineTabs.nth(1)).toHaveAttribute('data-category', 'rf');
  await expect(beamlineTabs.nth(2)).toHaveAttribute('data-category', 'optics');

  errors.check('Power and RF transport palettes');
});
