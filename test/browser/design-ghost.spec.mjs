// test/browser/design-ghost.spec.mjs
//
// The design-placement ghost: a translucent 3D copy of the whole blueprint,
// drawn at the transform DesignPlacer.confirm() will actually build it at.
//
// ─── WHY THIS NEEDS A BROWSER ──────────────────────────────────────────────
// The pose maths is testable headless (test-design-layout*.js already own the
// sequencing), but the three things that can actually go wrong here cannot be:
//   1. Does anything render at all? The preview used to sit behind
//      `if (!this.buildMode) return` in _renderCursors, and nothing in the
//      design-placement flow arms a build tool — so it was dead code that
//      looked alive.
//   2. Does it leak? The ghost is rebuilt from the same component factories
//      the committed scene uses, at pointer rate. A missing signature gate or
//      a wrong dispose frees buffers the real scene is still drawing with, or
//      grows THREE's geometry count without bound. Only renderer.info knows.
//   3. Does it follow the cursor and the rotate key, and go away on cancel?
//
// Placement is driven through game._startDesignPlacement — the same entry the
// design library, the stock tab and the blueprint gallery all funnel into —
// and through real mouse moves and key presses, so the input plumbing is under
// test too.

import { test, expect } from '@playwright/test';
import {
  createErrorCollector, expectRendererLive, bootFreshGame, autoAcceptDialogs, frames,
  installPageHelpers,
} from './helpers.mjs';

// A blueprint with junctions AND on-pipe hardware, so both ghost paths run.
const DESIGN_ID = 'testStand-sband';

/**
 * Put the route on #game and let the navigation drain.
 *
 * startDesignPlacement forces `location.hash = 'game'`, and a fresh boot has
 * no hash at all, so arming the placer fires a same-document navigation. If
 * that lands while a page.evaluate is in flight — which, at pointer rate, it
 * reliably does — Playwright tears the execution context out from under it
 * ("Execution context was destroyed"). Getting the hash change over with
 * before the placer is armed makes startDesignPlacement's guard a no-op.
 */
async function settleRoute(page) {
  await page.evaluate(() => { window.location.hash = 'game'; });
  await page.waitForFunction(() => window.location.hash === '#game');
  await page.waitForTimeout(300);
  await installPageHelpers(page);
}

/** Arm the placer with a stock blueprint and park the cursor on a tile. */
async function startPlacing(page, designId) {
  await page.evaluate(async (id) => {
    const { STOCK_DESIGNS } = await import('/src/data/stock-designs.js');
    const design = STOCK_DESIGNS.find(d => d.id === id);
    if (!design) throw new Error(`no stock design ${id}`);
    window.game._startDesignPlacement(design);
  }, designId);
}

/** Everything the ghost publishes about itself, in one round trip. */
async function ghostState(page) {
  return page.evaluate(() => {
    const r = window._renderer;
    const g = r.designGhostGroup;
    return {
      sig: r._designGhostSig,
      count: g ? g.children.length : -1,
      protos: r._designGhostProtos.size,
      // Sorted so a pure reordering of previewModules does not read as a move.
      poses: (g ? g.children : []).map(c => ({
        x: +c.position.x.toFixed(3),
        y: +c.position.y.toFixed(3),
        z: +c.position.z.toFixed(3),
        ry: +c.rotation.y.toFixed(3),
      })).sort((a, b) => (a.x - b.x) || (a.z - b.z)),
      // Component ghosts only (no pipe runs), keyed by type — the set that has
      // to survive the click unchanged.
      componentPoses: (g ? g.children : [])
        .filter(c => c.userData.ghostKind && c.userData.ghostKind !== 'pipe')
        .map(c => [
          c.userData.ghostType,
          +c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2),
          +c.rotation.y.toFixed(3),
        ].join('/'))
        .sort(),
      // Distinct geometry objects the ghost is drawing with. Clones share
      // their prototype's buffers by reference, so this set must be identical
      // on every rebuild — a rebuild that allocates would show new uuids.
      ghostGeoIds: [...new Set(
        (g ? g.children : []).flatMap((c) => {
          const ids = [];
          c.traverse(n => { if (n.isMesh && n.geometry) ids.push(n.geometry.uuid); });
          return ids;
        }),
      )].sort(),
      placer: {
        modules: window.game._designPlacer.previewModules.length,
        onPipe: window.game._designPlacer.previewModules.filter(m => m.kind === 'onPipe').length,
        pipes: window.game._designPlacer.previewPipes.length,
        valid: window.game._designPlacer.valid,
      },
    };
  });
}

/** Move the pointer onto tile (col,row) and let the renderer settle. */
async function hoverTile(page, col, row) {
  const p = await page.evaluate(([c, r]) => window.__bt.tileToScreen(c, r), [col, row]);
  await page.mouse.move(p.x, p.y);
  await frames(page, 2);
  return p;
}

test.describe('design placement ghost', () => {
  test('renders, tracks the cursor, rotates, and tears down cleanly', async ({ page }) => {
    const errors = createErrorCollector(page);
    autoAcceptDialogs(page);
    await bootFreshGame(page);
    await expectRendererLive(page);
    await settleRoute(page);

    // Work in the middle of the generated map, zoomed out enough that a whole
    // blueprint is on screen (tileToScreen raycasts the terrain, so the tiles
    // it is asked for have to be in frame).
    await page.evaluate(() => window.__bt.centerOn(0, 0, 1.0));
    await frames(page, 2);

    // --- Nothing before the placer is armed -------------------------------
    let s = await ghostState(page);
    expect(s.count, 'ghost group is empty before any placement').toBe(0);

    await startPlacing(page, DESIGN_ID);
    await hoverTile(page, -6, 0);

    // --- The ghost exists, and covers what the placer published -----------
    s = await ghostState(page);
    expect(s.placer.modules, 'placer published module poses').toBeGreaterThan(1);
    expect(s.placer.onPipe, 'blueprint has on-pipe hardware to preview').toBeGreaterThan(0);
    expect(s.placer.pipes, 'placer published connecting pipe runs').toBeGreaterThan(0);
    // One clone per module + one per pipe run. Types with no COMPONENTS entry
    // are skipped, so this is an upper bound, not an equality.
    expect(s.count, 'ghost meshes in the scene').toBeGreaterThan(1);
    expect(s.count).toBeLessThanOrEqual(s.placer.modules + s.placer.pipes);
    expect(s.protos, 'prototypes cached').toBeGreaterThan(0);
    // Ghosts sit at beam height or on the floor, never buried.
    expect(Math.min(...s.poses.map(p => p.y)), 'no ghost below the floor').toBeGreaterThanOrEqual(0);
    errors.check('arming the placer and drawing the ghost');

    // --- Sub-tile pointer motion must NOT rebuild -------------------------
    const before = s;
    const p = await page.evaluate(() => window.__bt.tileToScreen(-6, 0));
    await page.mouse.move(p.x + 2, p.y + 1);
    await frames(page, 2);
    let after = await ghostState(page);
    expect(after.sig, 'signature unchanged inside one tile').toBe(before.sig);
    expect(after.poses, 'ghost not rebuilt inside one tile').toEqual(before.poses);

    // --- Moving to a new tile moves the ghost with it ---------------------
    await hoverTile(page, -4, 2);
    after = await ghostState(page);
    expect(after.sig, 'signature changed on a new tile').not.toBe(before.sig);
    expect(after.count, 'same mesh count, new position').toBe(before.count);
    expect(after.poses, 'ghost followed the cursor').not.toEqual(before.poses);
    errors.check('moving the ghost');

    // --- F rotates ---------------------------------------------------------
    const preRotate = after;
    await page.keyboard.press('f');
    await frames(page, 2);
    const rotated = await ghostState(page);
    expect(
      await page.evaluate(() => window.game._designPlacer.direction),
      'rotate key advanced the placement direction',
    ).not.toBe(0);
    expect(rotated.poses, 'ghost rotated with the design').not.toEqual(preRotate.poses);
    errors.check('rotating the ghost');

    // --- Escape cancels ----------------------------------------------------
    await page.keyboard.press('Escape');
    await frames(page, 2);
    const cancelled = await ghostState(page);
    expect(
      await page.evaluate(() => window.game._designPlacer.active),
      'placer cancelled',
    ).toBe(false);
    expect(cancelled.count, 'ghost removed on cancel').toBe(0);
    expect(cancelled.sig, 'signature forgotten on cancel').toBe(null);
    expect(cancelled.protos, 'prototype cache released on cancel').toBe(0);

    errors.checkAll();
  });

  test('the ghost stands exactly where the click builds', async ({ page }) => {
    // The whole promise of the feature in one assertion: whatever pose the
    // ghost was drawn at, the committed mesh has to land on. Anything that
    // desynchronises DesignPlacer's preview walk from its confirm() walk —
    // a rotation convention, the face-to-face pipe offset, the attachment
    // packing — shows up here as a moved component.
    const errors = createErrorCollector(page);
    autoAcceptDialogs(page);
    await bootFreshGame(page);
    await expectRendererLive(page);
    await settleRoute(page);
    await page.evaluate(() => window.__bt.centerOn(0, 0, 1.0));
    await frames(page, 2);

    await startPlacing(page, DESIGN_ID);
    const target = await hoverTile(page, -6, 0);
    const ghost = await ghostState(page);
    expect(ghost.placer.valid, 'the spot takes the design').toBe(true);
    expect(ghost.componentPoses.length, 'ghost has components to check').toBeGreaterThan(1);
    errors.check('arming the placer and drawing the ghost');

    await page.mouse.click(target.x, target.y);
    await frames(page, 3);
    expect(
      await page.evaluate(() => window.game._designPlacer.active),
      'placer closed after the click',
    ).toBe(false);

    // Committed meshes, in the same shape ghostState reports. Junctions live
    // in componentBuilder, on-pipe hardware in pipeAttachmentBuilder — the two
    // halves the ghost had to reproduce.
    const built = await page.evaluate(() => {
      const r = window._renderer;
      const out = [];
      for (const b of [r.componentBuilder, r.pipeAttachmentBuilder]) {
        for (const obj of b._meshMap.values()) {
          out.push([
            obj.userData.compType,
            +obj.position.x.toFixed(2), +obj.position.y.toFixed(2), +obj.position.z.toFixed(2),
            +obj.rotation.y.toFixed(3),
          ].join('/'));
        }
      }
      return out.sort();
    });

    expect(built, 'every ghosted component was built where it was shown')
      .toEqual(ghost.componentPoses);

    errors.checkAll();
  });

  test('dragging the ghost across the map does not leak geometry', async ({ page }) => {
    const errors = createErrorCollector(page);
    autoAcceptDialogs(page);
    await bootFreshGame(page);
    // Same live-renderer gate as the first test. waitForBoot only proves the
    // globals exist; without this the first centerOn has been seen to land on
    // a page that was still coming up.
    await expectRendererLive(page);
    await settleRoute(page);
    await page.evaluate(() => window.__bt.centerOn(0, 0, 1.0));
    await frames(page, 2);

    await startPlacing(page, DESIGN_ID);

    // Warm up: every prototype this design needs gets built on the first few
    // tiles, so the baseline below is taken with the caches already full.
    const TILES = [];
    for (let i = 0; i < 12; i++) TILES.push([-8 + (i % 6), -3 + Math.floor(i / 6)]);
    for (const [c, r] of TILES) await hoverTile(page, c, r);
    const baseline = await ghostState(page);
    expect(baseline.count, 'ghost still up after the warm-up sweep').toBeGreaterThan(1);

    // Two more full sweeps. Every one of these rebuilds the ghost, and if the
    // rebuild allocated geometry (rather than cloning prototypes) the live
    // geometry count would climb monotonically.
    for (let pass = 0; pass < 2; pass++) {
      for (const [c, r] of TILES) await hoverTile(page, c, r);
    }
    const after = await ghostState(page);
    expect(after.protos, 'prototype cache did not grow').toBe(baseline.protos);
    // The load-bearing assertion: same buffers, rebuild after rebuild. A ghost
    // that rebuilt geometry per frame would hand back a completely fresh set.
    expect(after.ghostGeoIds, 'ghost reuses its prototype geometry')
      .toEqual(baseline.ghostGeoIds);
    expect(after.count, 'ghost mesh count stable across rebuilds').toBe(baseline.count);
    // NOT asserted: renderer.info.memory.geometries. It drifts by tens either
    // way from ambient work (terrain/foliage streaming, the transient
    // previewGroup quads) whether or not the placer is armed — measured at
    // +42/+66 per sweep with no placer and +39/+51 with one — so it cannot
    // separate a ghost leak from the noise. The uuid-set equality above is the
    // direct statement of the invariant that matters.

    await page.keyboard.press('Escape');
    await frames(page, 2);
    errors.checkAll();
  });
});
