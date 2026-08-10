// test/browser/render-placement.spec.mjs
//
// Rewrite of the stale Puppeteer harness test/test-render-placement.mjs.
//
// ─── WHY IT WAS REWRITTEN, NOT REPAIRED ────────────────────────────────────
// The old harness partitioned COMPONENTS on `placement` ('module' vs
// 'attachment') and asserted that every 'module' places on open ground. That
// premise died with the pipe-centric model: nine components are
// placement:'module' AND role:'placement' (buncher, pillboxCavity, rfCavity,
// sbandStructure, rfq, halfWaveResonator, spokeCavity, ellipticalSrfCavity,
// cryomodule) and Game.placePlaceable *correctly* refuses them on open
// ground — they live on a beam pipe. Run as written it reports nine spurious
// failures. It also had no working WebGL, so it never rendered anything and
// its "render errors" filter silently swallowed the evidence.
//
// ─── WHAT THIS COVERS ──────────────────────────────────────────────────────
// Every entry in COMPONENTS, routed through the placement path its CURRENT
// taxonomy calls for, then actually rendered:
//
//   role:'junction'                 -> beamline.placeJunction, all 4 rotations
//   role:'placement'                -> beamline.placeOnPipe on a scratch pipe
//   isDrawnConnection               -> beamline.drawPipe (the scratch pipe)
//   placement:'module', no role     -> Game.placePlaceable on open ground
//   placement:'attachment', no role -> Game.addAttachmentToPipe
//
// For each type: place, let the renderer's own event-driven rebuild run and
// draw, assert no page error / console.error, remove, draw again, assert
// again — so both the builder and the dispose path are exercised for every
// component mesh. (This is how the multi-material dispose crash in
// ComponentBuilder._disposeWrapper was found.)
// It also keeps the old harness's two stress cases (rapid place/remove
// cycling and place-then-tick for the RF family), which is where its real
// crashes lived, but points them at the pipe where those components now go.
//
// Placement is API-driven throughout, deliberately: this spec is about the
// renderer, and driving 100+ components through the palette would multiply
// its runtime for no extra renderer coverage. palette-arm.spec.mjs owns the
// UI path.
//
// ─── WHAT THIS DOES *NOT* COVER ────────────────────────────────────────────
//   * Whether the mesh looks right. Errors only, never pixels.
//   * Placement legality — that is test/test-place-all-components.js,
//     headless and far cheaper. Here every placement is `free` and lands on
//     ground cleared beforehand, so a failure means "the renderer threw",
//     not "the rules said no".
//   * PLACEABLES that are not COMPONENTS (furnishings, decorations, floors);
//     the generated map renders hundreds of them at boot.

import { test, expect } from '@playwright/test';
import {
  createErrorCollector, expectRendererLive, bootFreshGame, autoAcceptDialogs, frames,
} from './helpers.mjs';

// Test slots inside the generated map (|col|,|row| <= 35). 6 tiles apart so
// the widest footprints cannot collide. Every cycle removes what it placed,
// so the same slots are reused throughout.
const SLOT = [
  { col: 0, row: 0 }, { col: 6, row: 0 }, { col: 12, row: 0 }, { col: 18, row: 0 },
];
const MODULE_SLOT = { col: 0, row: 10 };

test('every component renders and disposes without errors', async ({ page }) => {
  const errors = createErrorCollector(page);
  autoAcceptDialogs(page);

  await bootFreshGame(page);
  await expectRendererLive(page);
  errors.check('boot');

  // Dev funds, and a genuinely empty map: map generation scatters ~1k trees
  // and rocks, so "open ground" is only open once they are gone. Same move
  // test/test-place-all-components.js makes headlessly.
  await page.evaluate(() => {
    window.dev.enable();
    const g = window.game;
    for (const id of g.state.placeables.map(p => p.id)) g.removePlaceable(id);
  });
  await page.evaluate(() => window._renderer.refresh());
  await frames(page, 3);
  expect(await page.evaluate(() => window.game.state.placeables.length)).toBe(0);
  // A stray console.error here would mean clearing 1k+ decorations broke a
  // dispose path — worth its own checkpoint before the per-type loops.
  errors.check('clear the map');

  // Taxonomy split, read from the live registry so it can never drift.
  const taxonomy = await page.evaluate(async () => {
    const { COMPONENTS } = await import('/src/data/components.js');
    const out = { junction: [], placement: [], drawn: [], module: [], attachment: [] };
    for (const [id, c] of Object.entries(COMPONENTS)) {
      if (c.isDrawnConnection) out.drawn.push(id);
      else if (c.role === 'junction') out.junction.push(id);
      else if (c.role === 'placement') out.placement.push(id);
      else if (c.placement === 'attachment') out.attachment.push(id);
      else if (c.placement === 'module') out.module.push(id);
    }
    return out;
  });
  // Guard rails: an empty bucket means the split stopped covering something,
  // not that the content shrank.
  for (const bucket of Object.keys(taxonomy)) {
    expect(taxonomy[bucket].length, `${bucket} components exist`).toBeGreaterThan(0);
  }

  // A long scratch pipe for everything that has to live on one. Built with
  // the same drawPipe call the pipe tool uses, so the isDrawnConnection
  // bucket is covered here rather than separately.
  const pipeId = await test.step('build a scratch beamline', async () => {
    const built = await page.evaluate(() => {
      const g = window.game;
      const col = -20;
      const src = g.beamline.placeJunction({ type: 'source', col, row: -20, dir: 0, free: true });
      const cup = g.beamline.placeJunction({ type: 'faradayCup', col, row: 5, dir: 0, free: true });
      if (!src || !cup) return null;
      const path = [];
      for (let r = -19.5; r <= 5; r += 0.25) path.push({ col, row: r });
      return g.beamline.drawPipe(
        { junctionId: src, portName: 'exit' },
        { junctionId: cup, portName: 'entry' },
        path,
      );
    });
    expect(built, 'scratch pipe was drawn').toBeTruthy();
    await frames(page, 2);
    errors.check('scratch beamline');
    return built;
  });

  // Shared per-type driver: place -> frames -> assert -> remove -> frames ->
  // assert. No explicit renderer.refresh(): every mutation below emits
  // 'beamlineChanged' or 'placeableChanged', which the renderer already turns
  // into a synchronous rebuild — so relying on the events tests the real
  // path and halves the (software-GL, expensive) rebuild count.
  const cycle = async (label, place, arg, remove) => {
    const ids = await page.evaluate(place, arg);
    expect(ids, `${label}: placement succeeded`).not.toBeNull();
    await frames(page, 2);
    errors.check(`render ${label}`);
    await page.evaluate(remove, ids);
    await frames(page, 2);
    errors.check(`dispose ${label}`);
  };

  await test.step('junction-role components (all 4 rotations)', async () => {
    for (const type of taxonomy.junction) {
      await cycle(
        `${type} (junction)`,
        ([t, slots]) => {
          const ids = [];
          for (let dir = 0; dir < 4; dir++) {
            const id = window.game.beamline.placeJunction({
              type: t, col: slots[dir].col, row: slots[dir].row, dir, free: true, silent: true,
            });
            if (!id) return null;
            ids.push(id);
          }
          return ids;
        },
        [type, SLOT],
        (ids) => { for (const id of ids) window.game.removePlaceable(id); },
      );
    }
  });

  await test.step('pipe-placement components', async () => {
    for (const type of taxonomy.placement) {
      await cycle(
        `${type} (on pipe)`,
        ([t, pid]) => {
          const id = window.game.beamline.placeOnPipe(pid, {
            type: t, position: 0.5, mode: 'snap', free: true,
          });
          return id ? [id] : null;
        },
        [type, pipeId],
        (ids) => {
          const pipe = window.game.state.beamPipes[0];
          for (const id of ids) window.game.beamline.removeFromPipe(pipe.id, id);
        },
      );
    }
  });

  await test.step('free-grid module components', async () => {
    for (const type of taxonomy.module) {
      await cycle(
        `${type} (module)`,
        ([t, slot]) => {
          const id = window.game.placePlaceable({
            type: t, col: slot.col, row: slot.row,
            subCol: 0, subRow: 0, dir: 0, free: true, silent: true,
          });
          return id ? [id] : null;
        },
        [type, MODULE_SLOT],
        (ids) => { for (const id of ids) window.game.removePlaceable(id); },
      );
    }
  });

  await test.step('legacy pipe attachments', async () => {
    for (const type of taxonomy.attachment) {
      await cycle(
        `${type} (attachment)`,
        // Game.addAttachmentToPipe is a thin delegate to placeOnPipe with no
        // `free` option, so it hits the research gate (baGauge and friends
        // are locked on a new game). Call through with free:true — this spec
        // asserts the mesh renders, not that the tech tree allows it.
        ([t, pid]) => {
          const id = window.game.beamline.placeOnPipe(pid, {
            type: t, position: 0.3, mode: 'snap', params: {}, free: true,
          });
          return id ? [id] : null;
        },
        [type, pipeId],
        (ids) => {
          const pipe = window.game.state.beamPipes[0];
          for (const id of ids) window.game.removeAttachment(pipe.id, id);
        },
      );
    }
  });

  // The original harness's two stress cases, kept because they are where its
  // real crashes were found.
  const RF = /cavity|rfq|buncher|resonator|structure|cryomodule/i;

  await test.step('RF family: rapid place/remove cycles on the pipe', async () => {
    const rf = taxonomy.placement.filter(t => RF.test(t));
    expect(rf.length, 'RF components are pipe placements').toBeGreaterThan(0);
    for (const type of rf) {
      await page.evaluate(async ([t, pid]) => {
        const g = window.game;
        for (let i = 0; i < 5; i++) {
          const id = g.beamline.placeOnPipe(pid, {
            type: t, position: 0.2 + i * 0.12, mode: 'snap', free: true,
          });
          await new Promise(r => requestAnimationFrame(r));
          if (id) g.beamline.removeFromPipe(pid, id);
          await new Promise(r => requestAnimationFrame(r));
        }
      }, [type, pipeId]);
      await frames(page, 2);
      errors.check(`rapid cycle ${type}`);
    }
  });

  await test.step('RF family: place then run a game tick', async () => {
    for (const type of taxonomy.placement.filter(t => RF.test(t))) {
      await page.evaluate(([t, pid]) => {
        const g = window.game;
        const id = g.beamline.placeOnPipe(pid, { type: t, position: 0.5, mode: 'snap', free: true });
        g.tick();
        if (id) g.beamline.removeFromPipe(pid, id);
      }, [type, pipeId]);
      await frames(page, 2);
      errors.check(`tick with ${type}`);
    }
  });

  await expectRendererLive(page);
  errors.checkAll();
});
