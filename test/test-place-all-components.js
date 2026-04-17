// test/test-place-all-components.js
//
// Headless smoke test: create a fresh Game, try placing every beamline
// component type on open ground, and report any crashes.

import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { Game } from '../src/game/Game.js';
import { BEAMLINE_COMPONENTS_RAW } from '../src/data/beamline-components.raw.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

// --- harness ---
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  FAIL: ${name}`);
    console.log(`        ${e.message}`);
    if (e.stack) {
      const lines = e.stack.split('\n').slice(1, 4);
      for (const l of lines) console.log(`        ${l.trim()}`);
    }
  }
}

// --- setup ---
console.log('\n=== Place All Beamline Components Test ===\n');

const registry = new BeamlineRegistry();
const game = new Game(registry);

// Unlimited funding so cost checks don't interfere.
game.state.resources.funding = 1e15;

// All component types from the raw data.
const allTypes = Object.keys(BEAMLINE_COMPONENTS_RAW);
// drift is drawn as a connection, not placed as a standalone object — excluded from PLACEABLES by design.
const drawnConnectionTypes = new Set(
  allTypes.filter(id => BEAMLINE_COMPONENTS_RAW[id].isDrawnConnection)
);
const placeableTypes = allTypes.filter(id => !drawnConnectionTypes.has(id));
console.log(`Component types to test: ${placeableTypes.length} placeable + ${drawnConnectionTypes.size} drawn-connection (skipped)\n`);

// Place each component on open ground at well-separated positions.
// We space them 10 tiles apart to avoid any overlap.
let colOffset = 5;

for (const type of placeableTypes) {
  const placeable = PLACEABLES[type];
  const placement = BEAMLINE_COMPONENTS_RAW[type].placement;

  if (placement === 'attachment') {
    // Attachments can't be placed standalone on the ground — they go on pipes.
    // Test that placePlaceable at least doesn't crash (it may return false).
    test(`${type} (attachment) — no crash on standalone attempt`, () => {
      const result = game.placePlaceable({
        type,
        col: colOffset, row: 0,
        subCol: 0, subRow: 0,
        dir: 0,
        free: true,
        silent: true,
      });
      // Attachments may or may not succeed — we just care about no crash.
      colOffset += 10;
    });
  } else {
    // Modules should place successfully on open ground.
    test(`${type} (module) — places on open ground`, () => {
      const result = game.placePlaceable({
        type,
        col: colOffset, row: 0,
        subCol: 0, subRow: 0,
        dir: 0,
        free: true,
        silent: true,
      });
      if (!result) {
        throw new Error(`placePlaceable returned false for ${type}`);
      }
      colOffset += 10;
    });

    // Also test all 4 rotations.
    for (const dir of [1, 2, 3]) {
      test(`${type} dir=${dir} — places on open ground`, () => {
        const result = game.placePlaceable({
          type,
          col: colOffset, row: 0,
          subCol: 0, subRow: 0,
          dir,
          free: true,
          silent: true,
        });
        if (!result) {
          throw new Error(`placePlaceable returned false for ${type} dir=${dir}`);
        }
        colOffset += 10;
      });
    }
  }
}

// --- also test infrastructure placeables ---
console.log('\n--- Infrastructure placeables ---\n');

const infraTypes = Object.values(PLACEABLES)
  .filter(p => p.kind === 'infrastructure')
  .map(p => p.id);

for (const type of infraTypes) {
  test(`${type} (infra) — places on open ground`, () => {
    const result = game.placePlaceable({
      type,
      col: colOffset, row: 0,
      subCol: 0, subRow: 0,
      dir: 0,
      free: true,
      silent: true,
    });
    if (!result) {
      throw new Error(`placePlaceable returned false for ${type}`);
    }
    colOffset += 10;
  });
}

// --- removal test: remove everything we placed ---
console.log('\n--- Removal ---\n');

const placeableCount = game.state.placeables.length;
test(`remove all ${placeableCount} placed items`, () => {
  const ids = game.state.placeables.map(p => p.id);
  for (const id of ids) {
    game.removePlaceable(id);
  }
});

// --- summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error.message}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
