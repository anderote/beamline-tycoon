// test/test-design-foundation.js — DesignPlacer lays foundation through the
// game's own API, not behind its back.
//
// confirm() used to pour concrete by hand:
//
//     game.state.floors.push({ type: 'concrete', col, row, variant: 0 });
//     game.state.infraOccupied[key] = 'concrete';
//
// which is `placeInfraTile` minus everything placeInfraTile exists to do —
// the nav-revision bump, zone eviction, the concrete pad's terrain
// flattening, and validateInfrastructure. Routing it through the real method
// needs a `free` flag, because DesignPlacer quotes the whole gesture in
// _recompute and settles it once at the end of confirm(); the danger of that
// flag is a design that charges for its concrete twice, or not at all.
//
// HONEST SCOPE, measured rather than assumed. The bypass was real, but on
// today's code paths it was not *observable*: routing through placeInfraTile
// changes nothing a reachable input can see, for three independent reasons.
//
//   - "A design lays foundation but places zero modules, so nothing ever
//     bumps navRevision" — the defect report's stated failure. Unreachable:
//     foundation tiles are only ever generated inside _recompute's per-module
//     footprint loop (DesignPlacer.js:232-273), so zero modules means zero
//     foundation. Any design with foundation also reaches placeJunction,
//     which bumps.
//   - Terrain flattening. Not a divergence either: placing the modules
//     already excavates the same tiles, so the pad ends up flat with or
//     without the concrete's own setTileCorners. Verified by running these
//     tests against the old hand-rolled write with a slope forced under the
//     pad — still flat afterwards.
//   - Zone eviction. Unreachable: a foundation tile is by construction one
//     with no infraOccupied entry (:266), and placeZone refuses a tile whose
//     floor is absent (Game.js:1840-1841), so a foundation tile can never
//     carry a zone to evict.
//
// The fix is therefore hygiene — it removes the class of bug rather than a
// live instance, and any future caller that lays foundation outside a module
// footprint inherits the correct behaviour instead of re-deriving it.
//
// What this file genuinely guards is the risk the fix ITSELF introduces: the
// new `free` flag on placeInfraTile. Drop it and the design pays for its
// concrete twice (test 1 fails by exactly the concrete cost). That assertion
// has teeth and is the reason this file exists; tests 2-4 pin surrounding
// invariants that must survive any future rework of this path.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { DesignPlacer } from '../src/ui/DesignPlacer.js';
import { STOCK_DESIGNS } from '../src/data/stock-designs.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { getTileCorners, setTileCorners } from '../src/game/terrain.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// DesignPlacer only reaches the renderer to repaint the cursor layer on
// cancel(); confirm() ends with a cancel(), so this is the whole surface.
const stubRenderer = { _renderCursors() {} };

const DESIGN = (Array.isArray(STOCK_DESIGNS) ? STOCK_DESIGNS : Object.values(STOCK_DESIGNS))
  .find(d => d.id === 'ebeam-crosslinker');

/**
 * Place `design` on a fresh game and return everything the assertions need.
 *
 * Deliberately NOT sandbox mode: chargeConstruction is a no-op in sandbox, so
 * a sandbox game cannot tell "charged once" from "charged twice" from "never
 * charged at all" — which is exactly the regression this file exists to catch.
 * Funding is set high by hand instead.
 */
function placeDesign(seed) {
  const game = new Game(new BeamlineRegistry(), { seed });
  game.state.resources.funding = 1e12;
  // Fix round 1 (staff-professions-3, task 5): DesignPlacer now also quotes
  // and charges spares for every component in the design — fund this the
  // same generous way funding above is, so placement here is gated only by
  // what this file is actually testing.
  game.state.resources.spares = 1e12;

  const placer = new DesignPlacer(game, stubRenderer);
  placer.start(DESIGN);

  const ext = game.state.mapHalfExtent;
  outer:
  for (let row = -ext + 2; row <= ext - 2; row++) {
    for (let col = -ext + 2; col <= ext - 10; col++) {
      placer.setPosition(col, row);
      if (!placer.valid) continue;
      // Snapshot the quote and the footprint BEFORE confirm(), which cancels
      // the session and clears both.
      const quoted = placer.totalCost;
      const foundation = placer.foundationTiles.map(t => ({ col: t.col, row: t.row }));

      // Put a slope under the pad on purpose. Without this the assertion that
      // concrete excavates has no teeth: the scan tends to find flat ground,
      // and on flat ground the old hand-rolled write and the real
      // placeInfraTile are indistinguishable. Raising a corner first is what
      // makes test 4 able to fail.
      for (const ft of foundation) {
        setTileCorners(game.state, ft.col, ft.row, { nw: 2, ne: 2, se: 2, sw: 2 });
      }
      placer.setPosition(col, row);
      if (!placer.valid) { placer.start(DESIGN); continue; }

      const fundingBefore = game.state.resources.funding;
      const navBefore = game.state.navRevision;
      if (placer.confirm()) {
        return { game, quoted, foundation, fundingBefore, navBefore, origin: { col, row } };
      }
      placer.start(DESIGN);
    }
  }
  return null;
}

console.log('\n=== DesignPlacer foundation goes through placeInfraTile ===\n');

assert(DESIGN, 'fixture: the ebeam-crosslinker stock design exists');

const r = placeDesign(11);
assert(r, 'placed the design somewhere on the generated map');

if (r) {
  const { game, quoted, foundation, fundingBefore, navBefore } = r;

  console.log(`\n  (design laid ${foundation.length} foundation tiles, quoted $${quoted.toLocaleString()})\n`);
  assert(foundation.length > 0, 'the design actually needed foundation tiles (otherwise this test proves nothing)');

  // --- 1. charged exactly once ---------------------------------------------
  const spent = fundingBefore - game.state.resources.funding;
  assert(Math.abs(spent - quoted) < 1e-6,
    `funding moved by exactly the quoted total, so the concrete is neither ` +
    `double-charged nor free (quoted $${quoted.toLocaleString()}, spent $${spent.toLocaleString()})`);

  // --- 2. occupancy is recorded once, not twice ----------------------------
  let missingOccupancy = 0, duplicated = 0;
  for (const ft of foundation) {
    if (game.state.infraOccupied[ft.col + ',' + ft.row] !== 'concrete') missingOccupancy++;
    const n = game.state.floors.filter(t => t.col === ft.col && t.row === ft.row).length;
    if (n !== 1) duplicated++;
  }
  assert(missingOccupancy === 0,
    `every foundation tile is concrete in infraOccupied (${missingOccupancy} missing)`);
  assert(duplicated === 0,
    `every foundation tile appears exactly once in state.floors (${duplicated} duplicated or absent)`);

  // --- 3. the nav grid was told ---------------------------------------------
  assert(game.state.navRevision > navBefore,
    `placing the design bumped navRevision (${navBefore} -> ${game.state.navRevision})`);

  // --- 4. concrete excavates, as it does everywhere else -------------------
  // placeInfraTile flattens a concrete tile's corners to y=0. The hand-rolled
  // write skipped it, so a design dropped on a slope kept the slope under its
  // pad and the modules floated over (or sank into) the ground they stood on.
  let unflattened = 0;
  for (const ft of foundation) {
    const c = getTileCorners(game.state, ft.col, ft.row);
    if (c.nw !== 0 || c.ne !== 0 || c.se !== 0 || c.sw !== 0) unflattened++;
  }
  assert(unflattened === 0,
    `every foundation tile was excavated flat to y=0, the same as hand-placed ` +
    `concrete (${unflattened} tiles still sloped)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
