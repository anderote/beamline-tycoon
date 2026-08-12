// test/test-design-layout-fidelity.js — the harness measures the machine the
// player actually gets.
//
// scripts/eval-design.mjs validates every stock blueprint by pushing it through
// the real physics engine, and it reaches that engine via designToOrderedNodes()
// — a HAND-WRITTEN reproduction of the node run that src/beamline/flattener.js
// emits once a design has been placed on the map. Nothing else pins those two
// together. If the reproduction drifts, eval-design happily reports an energy,
// a current and a spot size for a lattice that is not the one placing the
// blueprint builds, and the numbers on the picker cards become fiction.
//
// So this test does not reason about the arithmetic. It PLACES each blueprint,
// through the real DesignPlacer on a real headless Game, and compares
//
//     flattenPath(game.state, <source placeable>)      <- ground truth
//     designToOrderedNodes(blueprint)                  <- what the harness measures
//
// entry for entry. The comparison is on `kind` + `type` (the sequence of
// elements the lattice sees) and on `subL` (which sets each element's length,
// and therefore every number the engine returns). Ids, beamStart and params are
// deliberately not compared: ids are synthetic on the harness side, and
// beamStart is a running sum of the subLs that are compared.
//
// Coverage:
//   1. Registry fixture sanity — the ids below are still modules/attachments.
//   2. Modules only, no attachments.
//   3. One attachment on each pipe.
//   4. Three attachments on one pipe — the packed interval layout, which is what
//      sets the drift lengths around them.
//   5. Two half-pipe attachments on one pipe — the spacing at the point where
//      the attachments stop fitting.
//   6. A design containing dipoles, so the walk has to turn corners.
//   7. Every shipped blueprint in src/data/stock-designs.js.
//
// IF THIS FAILS, DO NOT "FIX" IT BY EDITING EITHER SIDE INTO AGREEMENT. The
// two sequences are printed side by side on a mismatch precisely so the real
// defect can be found; forcing agreement just moves the lie somewhere quieter.

import '../scripts/balance-env.mjs';

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { DesignPlacer } from '../src/ui/DesignPlacer.js';
import { flattenPath } from '../src/beamline/flattener.js';
import { layoutDesign } from '../src/beamline/design-layout.js';
import { COMPONENTS } from '../src/data/components.js';
import { STOCK_DESIGNS } from '../src/data/stock-designs.js';
import { designToOrderedNodes } from '../scripts/eval-design.mjs';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// DesignPlacer only reaches the renderer to repaint the cursor layer on
// cancel(); confirm() ends with a cancel(), so this is the whole surface.
const stubRenderer = { _renderCursors() {} };

// Sub-unit lengths are eighths of a metre once halved, so exact equality is
// the right test for most entries; the tolerance only exists so a drift length
// derived through `position * pipeBeamLen` on one side and a differently
// -associated product on the other is not reported as a divergence when the two
// agree to the last useful digit.
const SUBL_EPS = 1e-9;

/**
 * Place `design` through the REAL DesignPlacer on a fresh headless Game.
 *
 * The start tile is found by walking the map until DesignPlacer itself reports
 * the footprint clear — the same `valid` flag the cursor colours itself with —
 * so the test never has to know where the generated terrain put its trees.
 * Sandbox mode plus a large balance means cost can never be the reason a
 * placement fails.
 */
function placeDesign(design, seed) {
  const game = new Game(new BeamlineRegistry(), { seed });
  game.setSandboxMode(true);
  game.state.resources.funding = 1e12;

  const placer = new DesignPlacer(game, stubRenderer);
  placer.start(design);

  let origin = null;
  outer:
  for (let row = -30; row <= 30; row++) {
    for (let col = -30; col <= 20; col++) {
      placer.setPosition(col, row);
      if (placer.valid) { origin = { col, row }; break outer; }
    }
  }
  if (!origin) return { error: 'no free start tile on the generated map' };

  const before = new Set(game.state.placeables.map(p => p.id));
  if (!placer.confirm()) return { error: 'DesignPlacer.confirm() returned false', origin };

  // Modules are pushed to state.placeables in beam order by confirm(), so the
  // first new beamline placeable is the design's first module — the node
  // flattenPath has to be started from.
  const modules = game.state.placeables.filter(p => !before.has(p.id) && p.kind === 'beamline');
  return { game, origin, modules, sourceId: modules[0]?.id };
}

const sig = e => `${e.kind}:${e.type ?? '-'}`;

function printSideBySide(placedRun, harnessRun, game) {
  const n = Math.max(placedRun.length, harnessRun.length);
  console.log('      #   placed — flattenPath()              harness — designToOrderedNodes()');
  for (let i = 0; i < n; i++) {
    const a = placedRun[i];
    const b = harnessRun[i];
    const fmt = e => (e ? `${sig(e)} subL=${e.subL}` : '—');
    const same = a && b && sig(a) === sig(b) && Math.abs(a.subL - b.subL) <= SUBL_EPS;
    console.log(`      ${same ? '  ' : '!!'} ${String(i).padStart(2)}  `
      + `${fmt(a).padEnd(36)}${fmt(b)}`);
  }
  if (game) {
    console.log('      pipes: ' + game.state.beamPipes.map(p =>
      `${p.id}[subL=${p.subL}] `
      + ((p.placements || []).map(x => `${x.type}@${x.position}`).join(',') || '(empty)')
    ).join('  |  '));
  }
}

/**
 * The whole test, for one design: place it, flatten the placement, and hold the
 * harness's reproduction against it.
 */
function checkFidelity(label, design, seed) {
  console.log(`\n--- ${label} ---`);

  const placed = placeDesign(design, seed);
  if (placed.error) {
    assert(false, `setup: ${placed.error}`);
    return;
  }
  assert(!!placed.sourceId, 'setup: the design placed at least one module');
  if (!placed.sourceId) return;

  const layout = layoutDesign(design);
  const wantModules = layout.sequence.filter(s => s.kind === 'module').length;
  const wantAtts = layout.sequence
    .filter(s => s.kind === 'pipe')
    .reduce((n, s) => n + s.attachments.length, 0);
  const gotAtts = placed.game.state.beamPipes
    .reduce((n, p) => n + (p.placements || []).length, 0);

  // These two are not setup checks — they are the first place a divergence
  // shows up. layoutDesign is what BOTH sides consume, so if placement dropped
  // a module or an attachment the harness has already been told about, the two
  // runs describe different hardware before the flattener is even involved.
  assert(placed.modules.length === wantModules,
    `every module in the layout became a placeable `
    + `(placed ${placed.modules.length}, layout wants ${wantModules})`);
  assert(gotAtts === wantAtts,
    `every attachment in the layout landed on a pipe `
    + `(placed ${gotAtts}, layout wants ${wantAtts})`);

  const placedRun = flattenPath(placed.game.state, placed.sourceId);
  const harnessRun = designToOrderedNodes(design);

  const kindsMatch = placedRun.length === harnessRun.length
    && placedRun.every((e, i) => sig(e) === sig(harnessRun[i]));
  assert(kindsMatch,
    `the kind/type sequence matches entry for entry `
    + `(placed ${placedRun.length} entries, harness ${harnessRun.length})`);

  const subLMatch = placedRun.length === harnessRun.length
    && placedRun.every((e, i) => Math.abs(e.subL - harnessRun[i].subL) <= SUBL_EPS);
  assert(subLMatch, 'subL matches for every entry — element lengths, and so the physics');

  // PARAMS, not just geometry. A blueprint authors only the OVERRIDES; the game
  // seeds the rest at placement (`Game._placePlaceableInner`): non-derived
  // PARAM_DEFS defaults, then the catalogue's own `params` for anything still
  // unset. The harness skipped that seeding entirely, and because
  // `particleType: 'proton'` lives ONLY in the catalogue for cyclotron30/70/230
  // and cockcroftWalton, every proton blueprint that did not restate its
  // species was measured as a beam of electrons — at the proton's energy and
  // current, with a plausible spot size and nothing in the output naming the
  // species. Geometry agreed perfectly the whole time, which is exactly why
  // comparing only kind/type/subL could not see it.
  const paramMismatches = [];
  if (placedRun.length === harnessRun.length) {
    placedRun.forEach((e, i) => {
      const placedParams = e.params || {};
      const harnessParams = harnessRun[i].params || {};
      const keys = new Set([...Object.keys(placedParams), ...Object.keys(harnessParams)]);
      for (const k of keys) {
        const a = placedParams[k];
        const b = harnessParams[k];
        const same = (typeof a === 'number' && typeof b === 'number')
          ? Math.abs(a - b) <= 1e-9
          : a === b;
        if (!same) {
          paramMismatches.push(`  #${i} ${e.type || e.kind}.${k}: placed=${a} harness=${b}`);
        }
      }
    });
  }
  assert(paramMismatches.length === 0,
    'params match for every entry — species, gradients and phases, not just geometry');
  if (paramMismatches.length) console.log(paramMismatches.join('\n'));

  if (!kindsMatch || !subLMatch) printSideBySide(placedRun, harnessRun, placed.game);
}

// ==========================================================================
// Test 1: registry fixtures.
//
// The hand-written designs below name real registry ids so that a change to
// `placement` breaks this file loudly instead of quietly testing a fiction.
// ==========================================================================
console.log('\n--- Test 1: registry fixtures ---');
{
  for (const t of ['source', 'dipole', 'faradayCup']) {
    assert(COMPONENTS[t] && COMPONENTS[t].placement !== 'attachment',
      `${t} is still a module`);
  }
  for (const t of ['quadrupole', 'bpm']) {
    assert(COMPONENTS[t]?.placement === 'attachment', `${t} is still an attachment`);
  }
  // A one-tile inter-module pipe is 4 sub-units, so a subL-2 attachment claims
  // half of it and a subL-1 attachment a quarter. Both fixtures below depend on
  // that.
  assert(COMPONENTS.quadrupole?.subL === 2, 'quadrupole is still 2 sub-units (half a pipe)');
  assert(COMPONENTS.bpm?.subL === 1, 'bpm is still 1 sub-unit (a quarter of a pipe)');
}

const design = (name, ...types) => ({
  name,
  components: types.map(t => ({ type: t, params: {} })),
});

// ==========================================================================
// Tests 2-6: hand-written fixtures for the shapes the stock roster does not
// isolate.
// ==========================================================================
checkFidelity(
  'Test 2: modules only',
  design('modules-only', 'source', 'dipole', 'faradayCup'), 401);

checkFidelity(
  'Test 3: one attachment on each pipe',
  design('one-per-pipe', 'source', 'quadrupole', 'dipole', 'bpm', 'faradayCup'), 402);

checkFidelity(
  'Test 4: three attachments on one pipe — packed interval layout',
  design('three-on-one', 'source', 'bpm', 'bpm', 'bpm', 'faradayCup'), 403);

checkFidelity(
  'Test 5: two half-pipe attachments on one pipe',
  design('two-quads', 'source', 'quadrupole', 'quadrupole', 'faradayCup'), 404);

checkFidelity(
  'Test 6: dipoles — the walk has to turn corners',
  design('dipoles', 'source', 'dipole', 'quadrupole', 'dipole', 'faradayCup'), 405);

// ==========================================================================
// Test 7: every shipped blueprint.
//
// These are the designs eval-design.mjs actually measures and the picker
// actually advertises, so they are the ones whose fidelity has consequences.
// ==========================================================================
console.log('\n=== Test 7: shipped blueprints ===');
{
  assert(STOCK_DESIGNS.length > 0, 'there are blueprints to check');
  let seed = 500;
  for (const d of STOCK_DESIGNS) {
    checkFidelity(`Test 7: ${d.id}`, d, seed++);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
