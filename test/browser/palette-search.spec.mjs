// test/browser/palette-search.spec.mjs
//
// The build-menu search bar (#palette-search-input, src/ui/palette-search.js
// + src/ui/hud.js), driven through real typing and clicks:
//
//   type a cross-category query -> flat results render into #component-palette
//   -> click a result -> mode + category switch to its home, tool arms
//   -> Escape clears the box, releases focus, and does not disarm anything else
//
// Companion to palette-arm.spec.mjs (which walks every normal palette item)
// and test/test-palette-search.js (which covers the index/ranking headless,
// including the "table" query spanning multiple facility room categories —
// not re-proven here; this spec is about the UI wiring, not the ranking).

import { test, expect } from '@playwright/test';
import { createErrorCollector, expectRendererLive, bootFreshGame, frames } from './helpers.mjs';

test('build-menu search: type, click a result, arm — Escape exits search without disarming', async ({ page }) => {
  const errors = createErrorCollector(page);

  await bootFreshGame(page);
  await expectRendererLive(page);

  // Does not steal focus on load — palette-arm.spec.mjs's uiState() dump
  // reads document.activeElement, and an autofocused search box would land
  // there instead of wherever the boot flow left focus.
  const initialFocus = await page.evaluate(() => document.activeElement?.id ?? null);
  expect(initialFocus, 'search box is not autofocused on load').not.toBe('palette-search-input');

  const searchInput = page.locator('#palette-search-input');
  await expect(searchInput).toBeVisible();

  // "desk" is a single-category case (Office Space) by design — see
  // test-palette-search.js for the multi-category "table" case. Here we
  // just need one result whose home tab isn't the palette's current tab
  // (Beamline > Sources on a fresh game), so the mode/category switch on
  // click is actually exercised.
  await searchInput.fill('desk');

  // Past the 120ms debounce: results replace the normal category grouping.
  await expect
    .poll(() => page.locator('#component-palette .palette-item').count())
    .toBeGreaterThan(0);
  errors.check('typed a query');

  const deskItem = page.locator(
    '#component-palette .palette-item[data-palette-kind="furnishing"][data-palette-key="desk"]',
  );
  await expect(deskItem).toBeVisible();
  await expect(deskItem.locator('.palette-search-category')).toHaveText(/Facility/);

  await deskItem.click();

  // Same contract palette-arm.spec.mjs pins for every other palette item:
  // the click reaches selectPaletteTool and the Tool id is `${kind}:${key}`.
  await expect
    .poll(() => page.evaluate(() => window._renderer._inputHandler.activeTool?.id ?? null))
    .toBe('furnishing:desk');

  const uiAfterClick = await page.evaluate(() => ({
    mode: document.querySelector('.mode-btn.active')?.dataset.mode ?? null,
    category: document.querySelector('.cat-tab.active')?.dataset.category ?? null,
    searchValue: document.getElementById('palette-search-input')?.value ?? null,
  }));
  expect(uiAfterClick.mode, 'clicking a result switches to its home mode').toBe('facility');
  expect(uiAfterClick.category, 'clicking a result selects its home category').toBe('officeSpace');
  expect(uiAfterClick.searchValue, 'search box clears once a result is armed').toBe('');
  errors.check('clicked a result');

  // --- Escape exits search mode locally without disarming the tool ---
  // (the desk tool armed above should still be active — Escape in the
  // search box must not reach the esc-stack / InputHandler ladder).
  await searchInput.fill('table');
  await expect
    .poll(() => page.locator('#component-palette .palette-item').count())
    .toBeGreaterThan(0);

  await searchInput.press('Escape');
  await expect(searchInput).toHaveValue('');
  await expect(searchInput).not.toBeFocused();
  // Escape restored the normal category view (facility/officeSpace, still
  // the active tab from the desk click above) rather than the search list.
  await expect(page.locator('#component-palette .palette-item[data-palette-key="desk"]')).toBeVisible();

  const toolAfterEscape = await page.evaluate(() => window._renderer._inputHandler.activeTool?.id ?? null);
  expect(toolAfterEscape, 'Escape in the search box must not disarm the active tool').toBe('furnishing:desk');
  errors.check('Escape in the search box');

  // --- Empty query also restores the normal view (no Escape involved) ---
  await searchInput.fill('table');
  await expect
    .poll(() => page.locator('#component-palette .palette-item').count())
    .toBeGreaterThan(0);
  await searchInput.fill('');
  await frames(page, 2);
  await expect(page.locator('#component-palette .palette-item[data-palette-key="desk"]')).toBeVisible();
  errors.check('cleared the query');

  await expectRendererLive(page);
  errors.checkAll();
});
