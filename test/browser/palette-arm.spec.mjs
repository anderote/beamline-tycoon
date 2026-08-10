// test/browser/palette-arm.spec.mjs
//
// Rewrite of the stale Puppeteer harness test/test-ui-placement.mjs.
//
// ─── WHY IT WAS REWRITTEN, NOT REPAIRED ────────────────────────────────────
// The old harness selected every `placement: 'module'` component from the
// palette and clicked the canvas, treating "nothing placed" as a pass and
// only catching thrown errors. Under the current taxonomy that set mixes two
// incompatible families: free-grid infrastructure modules AND the nine
// role:'placement' RF cavities that can only sit on a beam pipe. It also
// reached for `window._input`, a global that no longer exists, so its tool
// selection silently no-opped on every iteration — it was asserting nothing.
//
// ─── WHAT THIS COVERS ──────────────────────────────────────────────────────
// Every palette item in every mode and category, driven by real clicks:
//   * click the mode button, click the category tab, click the item
//   * assert the click reached selectPaletteTool (activeTool.id matches)
//   * move the cursor over open ground so the tool builds its hover ghost
//   * for build tools, click to commit
//   * press Escape and assert the tool disarmed and its preview was torn down
// with zero page errors / console.errors throughout. This is the
// arming/preview/teardown lifecycle across the whole palette — the surface
// the overhaul's Tool refactor touched hardest, and the one the model-level
// suites cannot see at all.
//
// It also pins the corrected premise the old harness got wrong: clicking a
// role:'placement' component on open ground must place nothing. They belong
// on pipes, and the UI path has to respect that as firmly as
// Game.placePlaceable does.
//
// ─── WHAT THIS DOES *NOT* COVER ────────────────────────────────────────────
//   * That a placement *succeeded*. Most items here legitimately fail on the
//     tile they are offered (no floor, occupied, needs a pipe, needs a zone).
//     Placement legality is test/test-place-all-components.js's job;
//     rendering is render-placement.spec.mjs's. This is the input layer.
//   * Drag gestures (rect floors, wall runs, pipe draws) — smoke.spec.mjs.
//   * Demolish clicks: the tool is armed and disarmed, but never fired, so
//     the run cannot chew through the map it is placing into.
//   * Locked/unaffordable items, which the palette does not render at all.
//   * Whether a click that opens an inspector window opened the RIGHT one —
//     the walk only clears such windows so the Escape assertion is about the
//     tool. smoke.spec.mjs asserts the window contents.

import { test, expect } from '@playwright/test';
import {
  createErrorCollector, expectRendererLive, bootFreshGame, autoAcceptDialogs, frames,
} from './helpers.mjs';

// Kinds the walk actually clicks with. Restricted to beamline components on
// purpose:
//   * they are what the old harness aimed at, and where the pipe-bound
//     premise it got wrong actually bites;
//   * every successful placement costs two full scene rebuilds (place +
//     cleanup) under software GL, so clicking all ~190 items would triple
//     this spec's runtime for coverage smoke.spec.mjs already provides.
// Every other kind is still armed, hovered (ghost built) and disarmed.
const CLICK_TO_PLACE = new Set(['component']);

test('every palette item arms, previews and disarms cleanly', async ({ page }) => {
  const errors = createErrorCollector(page);
  autoAcceptDialogs(page);

  await bootFreshGame(page);
  await expectRendererLive(page);

  // Dev funds, and an empty map. Clearing the ~1k generated decorations is
  // not cosmetic: under software GL the per-frame cost of the full scene
  // dominates this spec, and every armed tool re-renders its ghost each
  // frame. It also stops stray clicks landing on scenery.
  await page.evaluate(() => {
    window.dev.enable();
    const g = window.game;
    for (const id of g.state.placeables.map(p => p.id)) g.removePlaceable(id);
  });
  await frames(page, 2);

  const area = await page.evaluate(() => window.__bt.findClearArea(8, 8));
  expect(area, 'the generated map has an 8x8 clear block').not.toBeNull();
  await page.evaluate(a => window.__bt.centerOn(a.col + 4, a.row + 4, 0.8), area);
  await frames(page, 3);

  // Solving tile -> pixel raycasts the terrain mesh and is by far the most
  // expensive thing here, so the walk cycles through a fixed 16-tile pool,
  // pre-solved and memoised in the page.
  const TILES = [];
  for (let dr = 0; dr < 4; dr++) {
    for (let dc = 0; dc < 4; dc++) TILES.push([area.col + dc * 2, area.row + dr * 2]);
  }
  const PIX = await page.evaluate(ts => ts.map(([c, r]) => window.__bt.tileToScreen(c, r)), TILES);
  errors.check('boot');

  const modes = await page.$$eval('.mode-btn', els => els.map(e => e.dataset.mode));
  expect(modes.length, 'mode buttons').toBeGreaterThan(0);

  const pipeBound = await page.evaluate(async () => {
    const { COMPONENTS } = await import('/src/data/components.js');
    return Object.entries(COMPONENTS).filter(([, c]) => c.role === 'placement').map(([id]) => id);
  });
  expect(pipeBound.length, 'pipe-bound components exist').toBeGreaterThan(0);

  let armed = 0;
  let slot = 0;

  for (const mode of modes) {
    await test.step(`mode: ${mode}`, async () => {
      await page.click(`.mode-btn[data-mode="${mode}"]`, { force: true });
      // Facility splits its tabs behind a Labs/Rooms toggle, so walk both
      // groups; every other mode shows all of its tabs at once.
      const groups = mode === 'facility' ? [0, 1] : [0];

      for (const group of groups) {
        if (group === 1) await page.click('.facility-group-toggle', { force: true });
        const tabs = await page.$$eval('.cat-tab', els => els.map(e => e.dataset.category));

        for (const category of tabs) {
          await page.click(`.cat-tab[data-category="${category}"]`, { force: true });
          // Indexed, re-queried per item: some palettes (demolish) rebuild
          // themselves in response to what exists in the world, so a list of
          // selectors captured up front goes stale mid-walk.
          const palette = page.locator('#component-palette .palette-item');
          const count = await palette.count();

          for (let i = 0; i < count; i++) {
            const el = palette.nth(i);
            const kind = await el.getAttribute('data-palette-kind');
            const key = await el.getAttribute('data-palette-key');
            const label = `${mode}/${category} ${kind}:${key}`;
            const p = PIX[slot++ % PIX.length];

            // force: every click here is on an element just read out of the
            // DOM, and Playwright's stability check costs two animation
            // frames — which, under software GL with a build ghost armed,
            // is most of this spec's runtime.
            await el.click({ force: true });
            const before = await page.evaluate(() => ({
              tool: window._renderer._inputHandler.activeTool?.id ?? null,
              placeables: window.game.state.placeables.length,
            }));
            expect(before.tool, `${label}: palette click arms the tool`).toBe(`${kind}:${key}`);

            // Hover open ground so the tool builds its ghost, then commit if
            // this kind commits on a plain click.
            await page.mouse.move(p.x, p.y);
            if (CLICK_TO_PLACE.has(kind)) await page.mouse.click(p.x, p.y);
            await frames(page, 1);

            // One round trip does three jobs: clear anything that landed (so
            // the next item still gets bare ground and the scene stops
            // growing), report what landed, and close any inspector window
            // the click opened — such a window legitimately owns Escape
            // (esc-stack: topmost layer first), so it must go before the
            // disarm assertion below.
            const after = await page.evaluate((n) => {
              const g = window.game;
              const fresh = g.state.placeables.slice(n);
              const types = fresh.map(x => x.type);
              for (const x of fresh) g.removePlaceable(x.id);
              const wins = [...document.querySelectorAll('#context-windows-container .ctx-window')];
              for (const w of wins) w.querySelector('.ctx-close')?.click();
              return { types, closedWindows: wins.length };
            }, before.placeables);
            expect(after.types.filter(t => pipeBound.includes(t)),
              `${label}: pipe-bound components must not place on open ground`).toEqual([]);

            await page.keyboard.press('Escape');
            // Dump the whole UI state alongside the assertion: if Escape went
            // to some other layer instead, the failure message says which.
            const st = await uiState(page);
            expect(st.tool, `${label}: Escape must disarm — ${JSON.stringify(st)}`).toBeNull();

            errors.check(label);
            armed++;
          }
        }
      }
    });
  }

  // Sanity: the walk actually visited a realistic number of items rather
  // than silently finding an empty palette.
  expect(armed, 'palette items exercised').toBeGreaterThan(80);

  await expectRendererLive(page);
  errors.checkAll();
});

/** Everything that could plausibly have eaten the Escape key. */
function uiState(page) {
  return page.evaluate(() => ({
    tool: window._renderer._inputHandler.activeTool?.id ?? null,
    ctxWindows: document.querySelectorAll('#context-windows-container .ctx-window').length,
    openOverlays: [...document.querySelectorAll('.overlay, .tech-tree-overlay, .designer-overlay')]
      .filter(e => !e.classList.contains('hidden')).map(e => e.id),
    dialogs: [...document.querySelectorAll('#welcome-dialog, #saveload-dialog, #options-dialog, #scenario-dialog')]
      .filter(e => !e.classList.contains('hidden')).map(e => e.id),
    designPlacer: !!window.game._designPlacer?.active,
    editingBeamlineId: window.game.editingBeamlineId ?? null,
    focus: document.activeElement?.tagName ?? null,
  }));
}
