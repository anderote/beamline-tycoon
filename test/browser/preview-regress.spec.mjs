// test/browser/preview-regress.spec.mjs
//
// Regression net for the three placement-preview defects from commit 3e81e9f8
// most likely to come back. All three were invisible to every other suite:
// they live in the seam between the input layer's snap math, the world
// snapshot, and what three.js actually puts in the scene — which no
// model-level test can see and no pixel-free smoke walk happens to hit.
//
// ─── WHAT THIS COVERS ──────────────────────────────────────────────────────
// 1. keyboard-arm ghost — arming a tool with a palette hotkey (no mousemove
//    at all) must paint the ghost immediately. InputHandler.setTool calls
//    _repaintArmedPreview for exactly this; without it the ghost only
//    appeared once the mouse twitched. Driven purely through the keyboard.
// 2. stackable ghost hitbox — ComponentBuilder wraps every component in an
//    invisible click box floating at BEAM_HEIGHT, and three.js raycasts test
//    object.visible, not material.visible. Before the guard in
//    screenToPlacementWorld, hovering *clear ground next to* a beamline
//    module snapped the cursor onto that box, putting the ghost on the
//    module's tile instead of the one under the cursor — and lifting it to
//    beam height whenever what it landed on was a stackable surface. The
//    spec locates a pixel where the box really is the nearest hit (so it
//    cannot pass vacuously) and asserts the app ignores it.
// 3. decoration rotation — decorations ignored `dir` outright: the snapshot
//    never emitted it, so a bench rotated with R rendered unrotated and
//    centred on the *unswapped* footprint, i.e. offset from the subgrid
//    cells it had actually reserved. Asserted as an equality between two
//    independently-computed things: the rendered group's transform, and the
//    centre of the cells Placeable.footprintCells reserved for it.
//
// ─── WHAT IS API-DRIVEN, AND WHY ───────────────────────────────────────────
// Marked [API]. Arming, rotating and committing are real palette clicks,
// real key presses and real canvas clicks throughout; the API is used only
// for scaffolding and for reading back what the renderer produced:
//   * window.dev.enable() and clearing the generated map — same scaffolding
//     the other sweep specs use, and the reason the walk has bare ground.
//   * window.game.beamline.placeJunction for the module in case 2. Placing
//     it through the palette is smoke.spec.mjs's job; here it is a prop.
//   * window._renderer.{previewGroup, decorationBuilder, screenToPlacementWorld,
//     _screenRay, componentGroup, _terrainMesh} — the assertions ARE about
//     the renderer's internals, so there is no UI-level substitute. Every
//     read is a read; nothing here mutates renderer state.
//   * window._renderer._inputHandler.{placementDir, hoverPlaceable} — the
//     ghost's model, which has no DOM representation.
//
// ─── WHAT THIS DOES *NOT* COVER ────────────────────────────────────────────
//   * The other 22 fixes in that commit (demolish highlights, variant
//     leakage, ghost tint, attachment-ghost material cloning, ...).
//   * Pixels. "Rendered rotated" means the group's rotation.y is right, not
//     that the bench looks right.

import { test, expect } from '@playwright/test';
import {
  createErrorCollector, expectRendererLive, bootFreshGame, autoAcceptDialogs,
  frames, clickTile,
} from './helpers.mjs';

test('placement previews: keyboard arming, stackable hitbox, decoration rotation', async ({ page }) => {
  const errors = createErrorCollector(page);
  autoAcceptDialogs(page);

  await bootFreshGame(page);
  await expectRendererLive(page);

  // [API] Dev funds and an empty map: map generation scatters ~1k trees, and
  // both the clear-tile assertions below and the software-GL frame cost want
  // them gone. Same move render-placement.spec.mjs makes.
  await page.evaluate(() => {
    window.dev.enable();
    const g = window.game;
    for (const id of g.state.placeables.map(p => p.id)) g.removePlaceable(id);
  });
  await frames(page, 2);

  const area = await page.evaluate(() => window.__bt.findClearArea(10, 10));
  expect(area, 'the generated map has a 10x10 clear block').not.toBeNull();
  await page.evaluate(a => window.__bt.centerOn(a.col + 5, a.row + 5, 0.8), area);
  await frames(page, 3);
  errors.check('boot');

  // ── 1. arming by hotkey paints a ghost with no mouse movement ───────────
  await test.step('palette hotkey arms and paints a ghost without a mousemove', async () => {
    // Open a palette page whose slot 0 is a ghost-bearing tool. Mode and tab
    // are HUD clicks; InputHandler's mousemove listener is bound to the
    // canvas, so nothing here touches the world cursor.
    await page.click('.mode-btn[data-mode="grounds"]');
    await page.click('.cat-tab[data-category="treesPlants"]');

    // The one and only world mouse event in this step. Everything after it is
    // keyboard, which is the whole point.
    const p = await page.evaluate(a => window.__bt.tileToScreen(a.col + 4, a.row + 4), area);
    await page.mouse.move(p.x, p.y);
    await frames(page, 1);

    const cursor = await page.evaluate(() => {
      const h = window._renderer._inputHandler;
      return { x: h.lastMouseWorldX, y: h.lastMouseWorldY };
    });
    expect(cursor.x, 'the cursor move registered a world position').not.toBeNull();

    // 'z' selects palette slot 0 — InputHandler's own hotkey binding, not a
    // synthetic tool call.
    await page.keyboard.press('z');

    const armed = await page.evaluate(() => {
      const r = window._renderer;
      const h = r._inputHandler;
      return {
        tool: h.activeTool?.id ?? null,
        armedId: h.armedPlaceableId ?? null,
        hover: h.hoverPlaceable ? { col: h.hoverPlaceable.col, row: h.hoverPlaceable.row } : null,
        ghostMeshes: r.previewGroup.children.length,
        mouseWorld: { x: h.lastMouseWorldX, y: h.lastMouseWorldY },
      };
    });
    expect(armed.tool, 'the hotkey armed a decoration tool').toMatch(/^decoration:/);
    expect(armed.armedId, 'the armed tool carries a placeable to ghost').not.toBeNull();
    // If this moved, the ghost could have come from a mousemove and the
    // assertion below would prove nothing.
    expect(armed.mouseWorld, 'no mouse event fired between arming and reading').toEqual(cursor);
    expect(armed.hover, 'the armed tool has a hover ghost model').not.toBeNull();
    expect(armed.ghostMeshes, 'ghost meshes are in previewGroup').toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect
      .poll(() => page.evaluate(() => window._renderer.previewGroup.children.length))
      .toBe(0);
    errors.check('keyboard arming');
  });

  // ── 2. a stackable ghost must not snap to a component's invisible hitbox ─
  await test.step('stackable ghost ignores a beamline module\'s invisible hitbox', async () => {
    // [API] The module is a prop; smoke.spec.mjs owns placing one by hand.
    const modTile = { col: area.col + 5, row: area.row + 5 };
    const placed = await page.evaluate(t => window.game.beamline.placeJunction({
      type: 'source', col: t.col, row: t.row, dir: 0, free: true, silent: true,
    }), modTile);
    expect(placed, 'the prop module was placed').toBeTruthy();
    await frames(page, 2);

    // Find a pixel where the invisible hitbox is genuinely the nearest thing
    // the ray meets AND the terrain behind it belongs to a clear tile. Both
    // conditions matter: the first makes the guard load-bearing (a pixel the
    // box misses would pass no matter what screenToPlacementWorld does), the
    // second means a lifted ghost can only come from the box, not from the
    // module's own occupied cells legitimately being under the cursor.
    const probe = await page.evaluate((t) => {
      const r = window._renderer;
      const matOf = o => (Array.isArray(o.material) ? o.material[0] : o.material);
      const centre = window.__bt.tileToScreen(t.col, t.row);
      for (let dy = -140; dy <= 140; dy += 7) {
        for (let dx = -140; dx <= 140; dx += 7) {
          const sx = centre.x + dx, sy = centre.y + dy;
          const { raycaster } = r._screenRay(sx, sy);
          const comp = raycaster.intersectObjects(r.componentGroup.children, true);
          if (!comp.length) continue;
          const terrain = r._terrainMesh ? raycaster.intersectObject(r._terrainMesh) : [];
          if (!terrain.length) continue;
          // Nearest component hit must be the invisible box, and it must beat
          // the terrain — otherwise the box is not in the way here.
          if (matOf(comp[0].object)?.visible !== false) continue;
          if (comp[0].distance > terrain[0].distance) continue;
          // Visible geometry in front of the terrain would legitimately win.
          const vis = comp.find(h => matOf(h.object)?.visible !== false);
          if (vis && vis.distance < terrain[0].distance) continue;
          const g = window.__bt.tileAt(sx, sy);
          const col = Math.floor(g.col), row = Math.floor(g.row);
          if (!window.__bt.tileIsClear(col, row)) continue;
          return { sx, sy, col, row };
        }
      }
      return null;
    }, modTile);
    expect(probe, 'found a pixel where the invisible hitbox is the nearest hit').not.toBeNull();

    // The raycast itself: with the box excluded, the placement ray and the
    // plain terrain ray have to agree.
    const rays = await page.evaluate(({ sx, sy }) => ({
      placement: window._renderer.screenToPlacementWorld(sx, sy),
      ground: window._renderer.screenToWorld(sx, sy),
    }), probe);
    expect(rays.placement.x, 'placement ray follows the terrain, not the hitbox')
      .toBeCloseTo(rays.ground.x, 3);
    expect(rays.placement.y, 'placement ray follows the terrain, not the hitbox')
      .toBeCloseTo(rays.ground.y, 3);

    // And the user-visible consequence: hover that pixel with a stackable
    // armed and the ghost must sit on the tile under the cursor. This is the
    // load-bearing assertion — with the guard removed the ghost jumps two
    // tiles onto the module itself (verified by monkey-patching the pre-fix
    // raycast back in). placeY/stackTargetId are the secondary symptom: they
    // only lift when the thing the cursor wrongly snapped to is a stackable
    // surface, so they pin the shape of the bug without discriminating on
    // their own.
    const stackKey = await armFirstStackable(page);
    await page.mouse.move(probe.sx, probe.sy);
    await frames(page, 1);
    const hover = await page.evaluate(() => {
      const h = window._renderer._inputHandler.hoverPlaceable;
      return h && { id: h.id, col: h.col, row: h.row, placeY: h.placeY, stackTargetId: h.stackTargetId };
    });
    expect(hover, `${stackKey} ghost exists over the probe pixel`).not.toBeNull();
    expect({ col: hover.col, row: hover.row }, `${stackKey} ghost is on the hovered tile`)
      .toEqual({ col: probe.col, row: probe.row });
    expect(hover.placeY, `${stackKey} ghost is on the ground, not lifted to beam height`).toBe(0);
    expect(hover.stackTargetId, `${stackKey} ghost has no stack target`).toBeNull();

    await page.keyboard.press('Escape');
    errors.check('stackable ghost hitbox');
  });

  // ── 3. a rotated decoration renders rotated, on the cells it reserved ────
  await test.step('a decoration placed at dir=1 renders rotated and on its swapped footprint', async () => {
    // Any decoration whose footprint is square would make the swap
    // unobservable, so pick a rectangular one the palette is actually
    // offering rather than hard-coding a key that may get rebalanced.
    const pick = await findRectangularDecoration(page);
    expect(pick, 'the grounds palette offers a non-square decoration').not.toBeNull();

    await page.click(`.mode-btn[data-mode="grounds"]`);
    await page.click(`.cat-tab[data-category="${pick.category}"]`);
    await page.click(
      `#component-palette .palette-item[data-palette-kind="decoration"][data-palette-key="${pick.key}"]`,
    );
    await expect
      .poll(() => page.evaluate(() => window._renderer._inputHandler.activeTool?.id ?? null))
      .toBe(`decoration:${pick.key}`);

    // R advances placementDir; one press = dir 1, the swapped orientation.
    await page.keyboard.press('r');
    expect(await page.evaluate(() => window._renderer._inputHandler.placementDir))
      .toBe(1);

    const tile = { col: area.col + 1, row: area.row + 1 };
    await clickTile(page, tile.col, tile.row);
    await frames(page, 2);
    await page.keyboard.press('Escape');

    const placed = await page.evaluate((key) => {
      const p = window.game.state.placeables.filter(x => x.type === key).pop();
      return p && { id: p.id, type: p.type, col: p.col, row: p.row, subCol: p.subCol, subRow: p.subRow, dir: p.dir };
    }, pick.key);
    expect(placed, `${pick.key} was committed`).not.toBeNull();
    // The original defect: the ghost rotated but the commit snapped back.
    expect(placed.dir, `${pick.key} kept the rotation it was previewed with`).toBe(1);

    const render = await page.evaluate(async (id) => {
      const { PLACEABLES } = await import('/src/data/placeables/index.js');
      const p = window.game.state.placeables.find(x => x.id === id);
      const group = window._renderer.decorationBuilder.getGroup(id);
      if (!group) return null;
      // Centre of the subgrid cells the MODEL reserved. Independent of
      // anything the renderer computed — that is the point of the check.
      const cells = PLACEABLES[p.type].footprintCells(
        p.col, p.row, p.subCol || 0, p.subRow || 0, p.dir || 0);
      const xs = cells.map(c => c.col * 2 + c.subCol * 0.5);
      const zs = cells.map(c => c.row * 2 + c.subRow * 0.5);
      return {
        rotY: group.rotation.y,
        pos: { x: group.position.x, z: group.position.z },
        cellCentre: {
          x: (Math.min(...xs) + Math.max(...xs) + 0.5) / 2,
          z: (Math.min(...zs) + Math.max(...zs) + 0.5) / 2,
        },
        cellSpan: {
          x: Math.max(...xs) - Math.min(...xs) + 0.5,
          z: Math.max(...zs) - Math.min(...zs) + 0.5,
        },
      };
    }, placed.id);
    expect(render, `${pick.key} has a rendered group`).not.toBeNull();
    // Sanity: the reserved cells really did swap, so the centre comparison
    // below can tell an unswapped mesh apart from a swapped one.
    expect(render.cellSpan.z, 'the reserved footprint is the rotated one')
      .toBeGreaterThan(render.cellSpan.x);
    expect(render.rotY, 'the group is rotated a quarter turn').toBeCloseTo(-Math.PI / 2, 5);
    expect(render.pos.x, 'the mesh is centred on the cells it reserved')
      .toBeCloseTo(render.cellCentre.x, 5);
    expect(render.pos.z, 'the mesh is centred on the cells it reserved')
      .toBeCloseTo(render.cellCentre.z, 5);

    errors.check('decoration rotation');
  });

  await expectRendererLive(page);
  errors.checkAll();
});

// ── local helpers ─────────────────────────────────────────────────────────

/**
 * Click the first stackable item the facility palette is offering, walking
 * both the Labs and Rooms tab groups. Picked from the live palette rather
 * than hard-coded: which furnishings are unlocked and affordable on a new
 * game is content that moves.
 */
async function armFirstStackable(page) {
  await page.click('.mode-btn[data-mode="facility"]');
  for (const group of [0, 1]) {
    if (group === 1) await page.click('.facility-group-toggle', { force: true });
    const tabs = await page.$$eval('.cat-tab', els => els.map(e => e.dataset.category));
    for (const category of tabs) {
      await page.click(`.cat-tab[data-category="${category}"]`, { force: true });
      const keys = await page.$$eval('#component-palette .palette-item',
        els => els.map(e => e.dataset.paletteKey));
      const hit = await page.evaluate(async (ks) => {
        const { PLACEABLES } = await import('/src/data/placeables/index.js');
        return ks.find(k => PLACEABLES[k]?.stackable) ?? null;
      }, keys);
      if (!hit) continue;
      await page.click(`#component-palette .palette-item[data-palette-key="${hit}"]`, { force: true });
      await expect
        .poll(() => page.evaluate(() => window._renderer._inputHandler.armedPlaceableId ?? null))
        .toBe(hit);
      return hit;
    }
  }
  throw new Error('no stackable item found in the facility palette');
}

/** First grounds-palette decoration whose footprint is not square, or null. */
async function findRectangularDecoration(page) {
  await page.click('.mode-btn[data-mode="grounds"]');
  const tabs = await page.$$eval('.cat-tab', els => els.map(e => e.dataset.category));
  for (const category of tabs) {
    await page.click(`.cat-tab[data-category="${category}"]`, { force: true });
    const keys = await page.$$eval(
      '#component-palette .palette-item[data-palette-kind="decoration"]',
      els => els.map(e => e.dataset.paletteKey));
    const key = await page.evaluate(async (ks) => {
      const { PLACEABLES } = await import('/src/data/placeables/index.js');
      return ks.find(k => PLACEABLES[k] && PLACEABLES[k].subW !== PLACEABLES[k].subL) ?? null;
    }, keys);
    if (key) return { category, key };
  }
  return null;
}
