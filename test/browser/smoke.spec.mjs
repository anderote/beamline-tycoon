// test/browser/smoke.spec.mjs — one end-to-end session through the real app.
//
// ─── WHAT THIS COVERS ──────────────────────────────────────────────────────
// A single continuous session, in order, asserting ZERO uncaught page errors
// and ZERO console.error after every step (see helpers.mjs for the one
// environmental ignore):
//
//   boot -> title screen -> New Game -> welcome guide dismissed
//   -> place a floor (drag-rect)          [UI: mode/tab/palette + canvas drag]
//   -> place a wall run                   [UI: mode/tab/palette + canvas drag]
//   -> place a decoration                 [UI: mode/tab/palette + canvas click]
//   -> place two beamline junctions       [UI: palette + canvas click]
//   -> draw a beam pipe between them      [UI: canvas press-drag-release]
//   -> place an on-pipe component         [UI: palette + canvas click]
//   -> draw a utility line port-to-port   [UI: palette + canvas press-drag]
//   -> pause the sim                      [UI: HUD pause button]
//   -> start the beam                     [UI: dbl-click -> context window button]
//   -> glow toggle off, live               [UI: Options dialog checkbox]
//   -> save + reload via Menu > Main Menu [UI: menu; then title "Continue"]
//   -> glow off survived reload, toggle back on, live [UI: Options dialog]
//   -> undo / redo                        [UI: Ctrl+Z / Ctrl+Shift+Z]
//   -> Escape out of every UI layer       [UI: keyboard]
//
// Every world mutation above goes through real mouse/keyboard input on the
// real canvas; screen positions come from the app's own screenToWorld
// raycast (helpers.tileToScreen), so nothing here re-implements the
// isometric projection.
//
// ─── WHAT IS API-DRIVEN, AND WHY ───────────────────────────────────────────
// Marked [API] in the step names. These are scaffolding, not the thing under
// test:
//   * window.dev.enable()      — the game's own dev-console affordance; the
//                                alternative is playing far enough to afford
//                                a beamline.
//   * finding/centering on a clear build area — the map is randomly
//                                generated per new game, so the spec has to
//                                ask the world where there is room.
//   * the remaining utility wiring before Start Beam — the utility gate needs
//                                power+vacuum on both junctions; one line is
//                                drawn by hand to prove the gesture, the rest
//                                go through scenario-wiring.js (the same
//                                helper shipped content uses).
//   * one extra decoration placed for the undo/redo step, because undo
//                                history does not survive the reload above.
//
// The remote-drive channel (public/demo-commands.json, polled and eval'd by
// main.js in dev) is intercepted for the whole run — see blockRemoteDrive.
//
// ─── WHAT THIS DOES *NOT* COVER ────────────────────────────────────────────
//   * Rendering correctness. It asserts the WebGL context is live and frames
//     are being drawn; it never looks at pixels. No visual regression.
//   * Physics results. Pyodide loads and the beam runs, but no beam number is
//     asserted — test/test_*.py and the node suites own that.
//   * Economy / research / staff / scenarios / the Beamline Designer's
//     editing surface beyond "it opens and Escape closes it".
//   * Demolish, move, and blueprint (DesignPlacer) gestures.
//   * Every component type — see render-placement.spec.mjs.
//   * Every palette item's arming/preview path — see palette-arm.spec.mjs.
//   * Multi-tab / cloud-save paths (no backend in dev).

import { test, expect } from '@playwright/test';
import {
  createErrorCollector, waitForBoot, expectRendererLive, installPageHelpers,
  autoAcceptDialogs, blockRemoteDrive, dismissWelcome, frames, armPaletteTool,
  clickTile, clickWorld, dragTiles,
} from './helpers.mjs';

test('full session walk: boot -> build -> beam -> save/reload -> undo -> escape', async ({ page }) => {
  const errors = createErrorCollector(page);
  autoAcceptDialogs(page);
  await blockRemoteDrive(page);

  // ── boot -> title screen ────────────────────────────────────────────────
  await test.step('boot to the title screen', async () => {
    await page.goto('/');
    await waitForBoot(page);
    await expect(page.locator('#title-screen')).toHaveCount(1);
    await expectRendererLive(page);
    errors.check('boot');
  });

  // ── title -> New Game ───────────────────────────────────────────────────
  await test.step('title screen: click-to-continue, then New Game', async () => {
    // The title gates its menu behind one deliberate click (the autoplay
    // unlock gesture), so the menu only appears after a pointerdown.
    await page.mouse.click(720, 450);
    await expect(page.locator('.title-btn').first()).toBeVisible();
    const labels = await page.locator('.title-btn').allTextContents();
    // Fresh profile: no save, so no Continue button yet. Manual is always
    // present — the operator manual is readable before a game exists.
    expect(labels).toEqual(['New Game', 'Scenarios', 'Manual']);

    await page.locator('.title-btn', { hasText: 'New Game' }).click();
    // New Game clears the save and reloads with skipTitle set.
    await waitForBoot(page);
    await expect(page.locator('#title-screen')).toHaveCount(0);
    await installPageHelpers(page);
    await expectRendererLive(page);
    errors.check('new game');
  });

  await test.step('dismiss the first-run guide', async () => {
    await expect(page.locator('#welcome-dialog')).toBeVisible();
    await dismissWelcome(page);
    errors.check('welcome dialog');
  });

  // ── [API] scaffolding: funds + a clear build site ───────────────────────
  let area;
  await test.step('[API] enable dev funds and find a clear build area', async () => {
    await page.evaluate(() => window.dev.enable());
    area = await page.evaluate(() => window.__bt.findClearArea(12, 12));
    expect(area, 'the generated map has a 12x12 clear block').not.toBeNull();
    await page.evaluate(a => window.__bt.centerOn(a.col + 6, a.row + 6, 0.8), area);
    await frames(page, 3);
    errors.check('dev mode + camera');
  });

  const before = () => page.evaluate(() => window.__bt.worldSummary());

  // ── structure: floor ────────────────────────────────────────────────────
  await test.step('place a floor (structure > flooring, drag-rect)', async () => {
    const b = await before();
    const key = await firstPaletteKey(page, 'structure', 'flooring', 'floor');
    await armPaletteTool(page, 'structure', 'flooring', 'floor', key);
    await dragTiles(page, [area.col + 1, area.row + 1], [area.col + 3, area.row + 3]);
    await frames(page);
    const a = await before();
    expect(a.infraTiles, `floor "${key}" tiles placed`).toBeGreaterThan(b.infraTiles);
    errors.check('floor placement');
  });

  // ── structure: wall ─────────────────────────────────────────────────────
  await test.step('place a wall run (structure > walls, drag)', async () => {
    const b = await before();
    const key = await firstPaletteKey(page, 'structure', 'walls', 'wall');
    await armPaletteTool(page, 'structure', 'walls', 'wall', key);
    await dragTiles(page, [area.col + 1, area.row + 1], [area.col + 3, area.row + 1]);
    await frames(page);
    const a = await before();
    expect(a.walls, `wall "${key}" segments placed`).toBeGreaterThan(b.walls);
    errors.check('wall placement');
  });

  // ── grounds: decoration ─────────────────────────────────────────────────
  await test.step('place a decoration (grounds > trees & plants, click)', async () => {
    const b = await before();
    const key = await firstPaletteKey(page, 'grounds', 'treesPlants', 'decoration');
    await armPaletteTool(page, 'grounds', 'treesPlants', 'decoration', key);
    await clickTile(page, area.col + 10, area.row + 10);
    await frames(page);
    const a = await before();
    expect(a.placeables, `decoration "${key}" placed`).toBeGreaterThan(b.placeables);
    errors.check('decoration placement');
  });

  // ── beamline: junctions ─────────────────────────────────────────────────
  // Both junctions keep the default placement dir (0), under which the
  // source's `front` exit port faces south (+row) and the cup's `back` entry
  // port faces north (-row) — so stacking them in one column, cup below
  // source, points them straight at each other and no rotation is needed.
  const srcTile = { col: 0, row: 0 };
  const cupTile = { col: 0, row: 0 };
  await test.step('place a source and a faraday cup (beamline palette, click)', async () => {
    srcTile.col = area.col + 6; srcTile.row = area.row + 2;
    cupTile.col = area.col + 6; cupTile.row = area.row + 10;

    await armPaletteTool(page, 'beamline', 'source', 'component', 'source');
    await clickTile(page, srcTile.col, srcTile.row);
    await frames(page);
    // Placing a source auto-advances the tool to the beam-pipe (drift) tool.
    expect(await activeToolId(page)).toBe('component:drift');

    await armPaletteTool(page, 'beamline', 'endpoint', 'component', 'faradayCup');
    await clickTile(page, cupTile.col, cupTile.row);
    await frames(page);

    const junctions = await page.evaluate(() =>
      window.game.state.placeables.filter(p => ['source', 'faradayCup'].includes(p.type))
        .map(p => ({ type: p.type, col: p.col, row: p.row, dir: p.dir })));
    expect(junctions.map(j => j.type).sort()).toEqual(['faradayCup', 'source']);
    errors.check('junction placement');
  });

  // ── beamline: pipe ──────────────────────────────────────────────────────
  await test.step('draw a beam pipe between them (press-drag-release)', async () => {
    await armPaletteTool(page, 'beamline', 'source', 'component', 'drift');
    await dragTiles(page, [srcTile.col, srcTile.row], [cupTile.col, cupTile.row], 10);
    await frames(page);
    const s = await before();
    expect(s.pipes, 'a beam pipe now exists').toBeGreaterThan(0);
    const anchored = await page.evaluate(() => window.game.state.beamPipes.map(
      p => ({ start: p.start?.portName ?? null, end: p.end?.portName ?? null })));
    expect(anchored[0], 'pipe is anchored port-to-port').toEqual({ start: 'exit', end: 'entry' });
    errors.check('beam pipe drawing');
  });

  // ── beamline: on-pipe placement ─────────────────────────────────────────
  await test.step('place a quadrupole on the pipe (click)', async () => {
    await armPaletteTool(page, 'beamline', 'optics', 'component', 'quadrupole');
    await clickTile(page, srcTile.col, srcTile.row + 4);
    await frames(page);
    const s = await before();
    expect(s.pipePlacements, 'quadrupole landed on the pipe').toBeGreaterThan(0);
    errors.check('on-pipe placement');
  });

  // ── infra: a power source, then a hand-drawn utility line ───────────────
  await test.step('place a transformer and draw a power line to the source', async () => {
    // Utility lines are validated against port *direction*: the first path
    // segment must leave along the source port's outward normal and the last
    // must arrive against the sink port's. padMountTransformer.pwr_out faces
    // east and source.pwr_in faces west, so the transformer goes due west of
    // the source on the same world Z — which means aiming the placement click
    // at a world point, not a tile centre.
    const sink = await portWorld(page, 'source', 'pwr_in');
    await armPaletteTool(page, 'infra', 'power', 'facility', 'padMountTransformer');
    await clickWorld(page, sink.x - 6, sink.z);
    await frames(page);
    const feed = await portWorld(page, 'padMountTransformer', 'pwr_out');
    expect(feed, 'transformer placed').not.toBeNull();
    expect(feed.z, 'transformer feed port lines up with the source inlet').toBeCloseTo(sink.z, 3);

    await armPaletteTool(page, 'infra', 'power', 'utility', 'powerCable');
    const b = await before();
    await dragPortToPort(page,
      { type: 'padMountTransformer', port: 'pwr_out' },
      { type: 'source', port: 'pwr_in' });
    await frames(page);
    const a = await before();
    expect(a.utilityLines, 'a power line was committed').toBeGreaterThan(b.utilityLines);
    errors.check('utility line drawing');
  });

  // ── beam on ─────────────────────────────────────────────────────────────
  await test.step('[API] finish the required wiring, then start the beam via its window', async () => {
    // Escape first: a live tool would eat the double-click below.
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      const { wireUtility } = await import('/src/data/scenarios/scenario-wiring.js');
      const g = window.game;
      const find = t => g.state.placeables.find(p => p.type === t)?.id;
      const src = find('source'), cup = find('faradayCup'), xfmr = find('padMountTransformer');
      const pump = g.placePlaceable({ type: 'roughingPump', col: g.getPlaceable(src).col + 3, row: g.getPlaceable(src).row + 2 });
      wireUtility(g, 'powerCable', { id: xfmr, port: 'pwr_out' }, { id: cup, port: 'pwr_in' });
      wireUtility(g, 'vacuumPipe', { id: pump, port: 'vac_out' }, { id: src, port: 'vac_in' });
      wireUtility(g, 'vacuumPipe', { id: pump, port: 'vac_out' }, { id: cup, port: 'vac_in' });
      // The utility gate also demands a *working* operator, and one goes
      // onBreak after ~40 ticks of fatigue — which this walk reaches before it
      // gets here, making "Start Beam" trip on beam_unstaffed at a time that
      // depends on how fast the machine ran the earlier steps. Reset the
      // roster so the assertion below is about the beam, not the clock.
      for (const m of g.state.staffMembers || []) {
        if (m.profession !== 'operator') continue;
        m.status = 'working';
        m._restTimer = null;
        Object.assign(m.needs, { fatigue: 0, hunger: 0, morale: 1 });
      }
      g.tick();
    });
    await frames(page);

    // Pause first (HUD button, real click): the beamline window re-renders
    // its action row on every 1 Hz tick, which detaches the button out from
    // under the click.
    await page.click('#btn-pause');
    await expect.poll(() => page.evaluate(() => window.game.state.paused)).toBe(true);

    await dblClickTile(page, srcTile.col, srcTile.row);
    const startBtn = page.locator('#context-windows-container button', { hasText: 'Start Beam' });
    await expect(startBtn).toBeVisible();
    await startBtn.click();
    await frames(page);
    const status = await page.evaluate(() => {
      const e = window.game.registry.getAll().find(x => !!x.sourceId);
      return e?.status ?? null;
    });
    expect(status, 'the beamline is running').toBe('running');

    await page.keyboard.press('Escape');   // close the beamline window
    await page.click('#btn-pause');        // back to running
    await expect.poll(() => page.evaluate(() => window.game.state.paused)).toBe(false);
    errors.check('beam toggle');
  });

  // ── glow toggle: off, live, before the reload below carries it forward ──
  await test.step('glow toggle off via Options (live, no reload)', async () => {
    await page.click('#btn-menu');
    await page.click('.menu-item[data-action="options"]');
    await expect(page.locator('#options-dialog')).toBeVisible();
    const glowCheckbox = page.locator('#opt-glow');
    // Default on — the composer path is what every earlier step above just
    // ran through. Confirm it rendered clean before touching anything.
    await expect(glowCheckbox).toBeChecked();
    await expectRendererLive(page);
    errors.check('glow on (composer path, default)');

    // Flip off: renderer.setGlowEnabled(false) falls through to the direct
    // renderer.render() path on the very next frame — no reload needed.
    await glowCheckbox.uncheck();
    await expect.poll(() => page.evaluate(() => window._renderer.glowEnabled)).toBe(false);
    await frames(page, 3);
    await expectRendererLive(page);
    errors.check('glow off (direct path, live toggle)');

    // Leave it off and close — the reload in the next step should carry
    // 'beamlineTycoon.glow'=0 forward and boot straight into the direct path.
    await page.keyboard.press('Escape');
    await expect(page.locator('#options-dialog')).toBeHidden();
  });

  // ── save + reload + Continue ────────────────────────────────────────────
  let saved;
  await test.step('save and reload via Menu > Main Menu, then Continue', async () => {
    saved = await before();
    await page.click('#btn-menu');
    await page.click('.menu-item[data-action="main-menu"]');
    await waitForBoot(page);
    await installPageHelpers(page);

    // A save now exists, so the title screen offers Continue.
    await page.mouse.click(720, 450);
    await expect(page.locator('.title-btn').first()).toBeVisible();
    expect(await page.locator('.title-btn').allTextContents())
      .toEqual(['Continue', 'New Game', 'Scenarios', 'Manual']);
    await page.locator('.title-btn', { hasText: 'Continue' }).click();
    await expect(page.locator('#title-screen')).toHaveCount(0);
    await frames(page, 3);
    await expectRendererLive(page);

    const restored = await before();
    expect(restored.pipes).toBe(saved.pipes);
    expect(restored.pipePlacements).toBe(saved.pipePlacements);
    expect(restored.utilityLines).toBe(saved.utilityLines);
    expect(restored.walls).toBe(saved.walls);
    expect(restored.infraTiles).toBe(saved.infraTiles);
    expect(restored.placeables).toBe(saved.placeables);
    errors.check('save / reload / continue');
  });

  // ── glow toggle: confirm the off state (direct path) survived the reload,
  //    then flip back on so the rest of the walk exercises the composer path
  //    it started in ──────────────────────────────────────────────────────
  await test.step('glow stayed off across reload, then back on (direct + composer both boot clean)', async () => {
    expect(await page.evaluate(() => window._renderer.glowEnabled),
      'glow=0 persisted through the reload; booted straight into the direct path').toBe(false);
    await expectRendererLive(page);
    errors.check('booted with glow off (direct path)');

    await page.click('#btn-menu');
    await page.click('.menu-item[data-action="options"]');
    await expect(page.locator('#options-dialog')).toBeVisible();
    const glowCheckbox = page.locator('#opt-glow');
    await expect(glowCheckbox, 'checkbox reflects the persisted off state').not.toBeChecked();

    await glowCheckbox.check();
    await expect.poll(() => page.evaluate(() => window._renderer.glowEnabled)).toBe(true);
    await frames(page, 3);
    await expectRendererLive(page);
    errors.check('glow back on (composer path, live toggle)');

    await page.keyboard.press('Escape');
    await expect(page.locator('#options-dialog')).toBeHidden();
  });

  // ── undo / redo ─────────────────────────────────────────────────────────
  await test.step('undo and redo a placement (Ctrl+Z / Ctrl+Shift+Z)', async () => {
    // Undo history is per-session, so make a fresh mutation to undo.
    await page.evaluate(() => window.dev.enable());
    await page.evaluate(a => window.__bt.centerOn(a.col + 6, a.row + 6, 0.8), area);
    const key = await firstPaletteKey(page, 'grounds', 'treesPlants', 'decoration');
    await armPaletteTool(page, 'grounds', 'treesPlants', 'decoration', key);
    await clickTile(page, area.col + 9, area.row + 10);
    await frames(page);
    const placed = await before();
    expect(placed.placeables).toBeGreaterThan(saved.placeables);

    await page.keyboard.press('Escape'); // disarm so the tool can't eat keys
    await page.keyboard.press('Control+z');
    await frames(page);
    expect((await before()).placeables, 'undo removed it').toBe(saved.placeables);

    await page.keyboard.press('Control+Shift+z');
    await frames(page);
    expect((await before()).placeables, 'redo put it back').toBe(placed.placeables);
    errors.check('undo / redo');
  });

  // ── Escape from every UI layer ──────────────────────────────────────────
  await test.step('Escape closes every UI layer', async () => {
    // 1. an armed build tool
    await armPaletteTool(page, 'beamline', 'optics', 'component', 'quadrupole');
    await page.keyboard.press('Escape');
    expect(await activeToolId(page), 'Escape disarms the active tool').toBeNull();

    // 2. research tech tree (its own esc-stack handler)
    await page.click('#btn-research');
    await expect(page.locator('#research-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#research-overlay')).toBeHidden();

    // 3. goals overlay (closed by the input layer's fallback ladder)
    await page.click('#btn-goals');
    await expect(page.locator('#goals-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#goals-overlay')).toBeHidden();

    // 4. beamline designer
    await page.click('#btn-designer');
    await expect(page.locator('#designer-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#designer-overlay')).toBeHidden();

    // 5. save/load dialog. The dropdown is a child of #top-bar, whose z-index
    // opens a stacking context, so the menu's own 300 is scoped inside it and
    // the whole dropdown used to stack at the bar's 100 — under #music-player
    // (101), which parks directly beneath these very buttons and swallowed the
    // clicks. Hit-test every item the walk goes on to click, so a stacking
    // regression names the intercepting layer instead of timing out on a click.
    await page.click('#btn-menu');
    for (const action of ['save-game', 'load-game', 'options', 'guide']) {
      const covering = await page.evaluate((a) => {
        const item = document.querySelector(`.menu-item[data-action="${a}"]`);
        if (!item) return `missing menu item ${a}`;
        const r = item.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit === item || item.contains(hit)) return null;
        return hit ? (hit.closest('[id]')?.id || hit.className || hit.tagName) : 'nothing';
      }, action);
      expect(covering, `no layer intercepts clicks on the ${action} menu item`).toBeNull();
    }
    await page.click('.menu-item[data-action="save-game"]');
    await expect(page.locator('#saveload-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#saveload-dialog')).toBeHidden();

    // 6. options dialog
    await page.click('#btn-menu');
    await page.click('.menu-item[data-action="options"]');
    await expect(page.locator('#options-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#options-dialog')).toBeHidden();

    // 7. the reopenable first-run guide. NOTE: WelcomeDialog registers no
    // esc-stack handler, so Escape does NOT close it — asserted here so the
    // gap is pinned rather than forgotten. Closed by its button instead.
    await page.click('#btn-menu');
    await page.click('.menu-item[data-action="guide"]');
    await expect(page.locator('#welcome-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#welcome-dialog'),
      'known gap: the welcome guide has no Escape handler').toBeVisible();
    await dismissWelcome(page);

    // 8. a world-anchored context window (removed from the DOM on close)
    await dblClickTile(page, srcTile.col, srcTile.row);
    await expect(page.locator('#context-windows-container .ctx-window')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#context-windows-container .ctx-window')).toHaveCount(0);

    errors.check('escape ladder');
  });

  errors.checkAll();
});

// ── small local helpers ───────────────────────────────────────────────────

function activeToolId(page) {
  return page.evaluate(() => window._renderer._inputHandler.activeTool?.id ?? null);
}

/** First palette key of the given kind in mode/category (unlock-order safe). */
async function firstPaletteKey(page, mode, category, kind) {
  await page.click(`.mode-btn[data-mode="${mode}"]`);
  await page.click(`.cat-tab[data-category="${category}"]`);
  const key = await page.locator(
    `#component-palette .palette-item[data-palette-kind="${kind}"]`,
  ).first().getAttribute('data-palette-key');
  expect(key, `mode ${mode}/${category} offers a ${kind} palette item`).toBeTruthy();
  return key;
}

async function dblClickTile(page, col, row) {
  const p = await page.evaluate(([c, r]) => window.__bt.tileToScreen(c, r), [col, row]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.dblclick(p.x, p.y);
}

/**
 * Drag a utility line between two named ports, exactly as a player would:
 * press on the source port, drag, release on the sink port.
 *
 * Port pixels come from the app's own portWorldPosition() projected through
 * the live camera at ground level (y=0), because that is the plane the
 * controller's cursor raycast lands on. Each end asserts that the armed
 * UtilityLineInputController actually snapped to the intended port before
 * the button goes down/up — otherwise a near-miss would silently draw an
 * open-ended line and the count assertion would still pass.
 */
/** {x, z} of a named port on the (single) placeable of the given type. */
function portWorld(page, type, port) {
  return page.evaluate(async ([t, p]) => {
    const { portWorldPosition } = await import('/src/utility/ports.js');
    const { COMPONENTS } = await import('/src/data/components.js');
    const pl = window.game.state.placeables.find(x => x.type === t);
    return pl ? portWorldPosition(pl, COMPONENTS[t], p) : null;
  }, [type, port]);
}

async function dragPortToPort(page, from, to) {
  const locate = async ({ type, port }) => {
    const pos = await portWorld(page, type, port);
    expect(pos, `${type}.${port} has a world position`).not.toBeNull();
    return page.evaluate(w => window.__bt.worldToScreen(w.x, 0, w.z), pos);
  };
  const snapped = () => page.evaluate(() => {
    const h = window._renderer._inputHandler.utilityLineController.hoverPort;
    return h ? h.portName : null;
  });

  const a = await locate(from);
  await page.mouse.move(a.x, a.y);
  expect(await snapped(), `cursor snapped to ${from.type}.${from.port}`).toBe(from.port);
  await page.mouse.down();

  const b = await locate(to);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.mouse.move(b.x, b.y);
  expect(await snapped(), `cursor snapped to ${to.type}.${to.port}`).toBe(to.port);
  await page.mouse.up();
}
