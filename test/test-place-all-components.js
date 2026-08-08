// test/test-place-all-components.js
//
// Headless smoke test for the pipe-centric placement rules:
//   - role:'junction' components place standalone on open ground (all 4 dirs)
//   - role:'placement' components must be REJECTED on open ground — they can
//     only be placed ON a beam pipe (Game routes them away by design)
//   - infrastructure placeables place on open ground
//   - everything placed can be removed

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

// No funding padding: every placement passes free:true, and placeJunction must
// forward that flag — zero funds makes a dropped flag fail loudly here.
game.state.resources.funding = 0;

// Map generation scatters decorations (trees, rocks, ...) that occupy random
// subgrid cells. Clear them all so "open ground" is actually open.
for (const id of game.state.placeables.map(p => p.id)) {
  game.removePlaceable(id);
}

// Partition component types by role.
const allTypes = Object.keys(BEAMLINE_COMPONENTS_RAW);
// drift is drawn as a connection, not placed as a standalone object — excluded from PLACEABLES by design.
const drawnConnectionTypes = allTypes.filter(id => BEAMLINE_COMPONENTS_RAW[id].isDrawnConnection);
const junctionTypes  = allTypes.filter(id => BEAMLINE_COMPONENTS_RAW[id].role === 'junction');
const placementTypes = allTypes.filter(id => BEAMLINE_COMPONENTS_RAW[id].role === 'placement');
console.log(`Component types: ${junctionTypes.length} junction + ${placementTypes.length} placement + ${drawnConnectionTypes.length} drawn-connection (skipped)\n`);

// Place components at well-separated positions (10 tiles apart) to avoid overlap.
let colOffset = 5;

// --- junction-role components place on open ground, all 4 rotations ---
console.log('--- Junction-role components (place on open ground) ---\n');

for (const type of junctionTypes) {
  for (const dir of [0, 1, 2, 3]) {
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

// --- placement-role components are rejected on open ground ---
console.log('\n--- Placement-role components (rejected on open ground) ---\n');

for (const type of placementTypes) {
  test(`${type} (placement) — rejected on open ground`, () => {
    const result = game.placePlaceable({
      type,
      col: colOffset, row: 0,
      subCol: 0, subRow: 0,
      dir: 0,
      free: true,
      silent: true,
    });
    if (result) {
      throw new Error(`placePlaceable succeeded for ${type} on open ground — role:'placement' components must require a beam pipe`);
    }
    colOffset += 10;
  });
}

// --- infrastructure placeables place on open ground ---
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
