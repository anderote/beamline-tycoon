// test/test-game-undo.js — full-state snapshot undo/redo.
//
// _pushUndo() captures serialize() output; undo() must restore the exact
// pre-action payload (byte-equal modulo the log, which accrues 'Undo'/action
// entries) for every mutation family the input layer can trigger: placeables,
// floors, walls, beam pipes (via BeamlineSystem), utility lines, demolish.
// Also: redo restores the after-state, a new gesture clears the redo stack,
// and the undo stack caps at 20 with oldest-first eviction.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// Game talks to localStorage; back it with a Map for Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeGame(seed) {
  const g = new Game(new BeamlineRegistry(), { seed });
  g.state.resources.funding = 1e9;
  return g;
}

// serialize() with the log normalized out — undo appends 'Undo' log lines
// and actions log placements/refunds, so the log legitimately differs.
function payload(g) {
  const d = JSON.parse(g.serialize());
  d.state.log = null;
  return JSON.stringify(d);
}

// Find a clear 2x2 spot on the starter map for a concrete pad + magnetron.
function placePadAndMagnetron(g) {
  for (let row = 2; row < 40; row += 3) {
    for (let col = 2; col < 40; col += 3) {
      let padOk = true;
      for (let dr = 0; dr < 2 && padOk; dr++)
        for (let dc = 0; dc < 2 && padOk; dc++)
          padOk = g.placeInfraTile(col + dc, row + dr, 'concrete');
      if (!padOk) continue;
      const id = g.placePlaceable({ type: 'magnetron', col, row });
      if (id) return { col, row, id };
    }
  }
  return null;
}

// Run one input-layer gesture: capture before, push undo, mutate, undo,
// and assert byte-equality with the before payload.
function gestureRoundTrip(g, label, action) {
  const before = payload(g);
  g._pushUndo();
  const acted = action();
  assertOk(acted, `${label}: action applied`);
  assertOk(payload(g) !== before, `${label}: action changed serialized state`);
  g.undo();
  assertOk(payload(g) === before, `${label}: undo restores byte-equal state`);
}

console.log('\n=== Undo round-trips per gesture family ===\n');

const g = makeGame(42);

gestureRoundTrip(g, 'place placeable', () => placePadAndMagnetron(g));

gestureRoundTrip(g, 'place floor tiles', () => {
  let n = 0;
  for (let col = 2; col < 40 && n < 3; col++) {
    if (g.placeInfraTile(col, 2, 'concrete')) n++;
  }
  return n === 3;
});

gestureRoundTrip(g, 'place wall', () =>
  g.placeWallPath(
    [{ col: 5, row: 5, edge: 'N' }, { col: 6, row: 5, edge: 'N' }],
    'officeWall',
  ));

gestureRoundTrip(g, 'draw beam pipe', () => {
  // Free-standing straight pipe via BeamlineSystem; scan for a clear run.
  for (let row = 2; row < 40; row += 2) {
    for (let col = 2; col < 34; col += 2) {
      const id = g.beamline.drawPipe(null, null,
        [{ col, row }, { col: col + 4, row }]);
      if (id) return id;
    }
  }
  return null;
});

gestureRoundTrip(g, 'place utility line', () =>
  g.utilityLineSystem.addLine({
    utilityType: 'powerCable',
    start: null,
    end: null,
    path: [{ col: 20, row: 20 }, { col: 24, row: 20 }],
  }));

// Demolish: place a pad + magnetron as setup, then undo just the removal.
const setup = placePadAndMagnetron(g);
assertOk(setup, 'demolish setup: pad + magnetron placed');
gestureRoundTrip(g, 'demolish placeable', () => g.removePlaceable(setup.id));

console.log('\n=== Redo ===\n');

{
  const before = payload(g);
  g._pushUndo();
  const ok = g.placeInfraTile(3, 30, 'concrete') || g.placeInfraTile(3, 31, 'concrete');
  assertOk(ok, 'redo setup: floor tile placed');
  const after = payload(g);
  assertOk(after !== before, 'redo setup: state changed');
  g.undo();
  assertOk(payload(g) === before, 'undo restores before-state');
  g.redo();
  assertOk(payload(g) === after, 'redo restores after-state');
  // Undo the redone action so the next block starts clean.
  g.undo();
  assertOk(payload(g) === before, 'undo after redo restores before-state again');
}

console.log('\n=== New gesture clears redo ===\n');

{
  assertOk(g._redoStack.length > 0, 'redo stack non-empty after undo');
  g._pushUndo();   // new user gesture
  assertOk(g._redoStack.length === 0, 'new _pushUndo clears the redo stack');
}

console.log('\n=== Cap eviction at 20 ===\n');

{
  const gc = makeGame(7);
  for (let i = 1; i <= 25; i++) {
    gc.state.resources.funding = i;
    gc._pushUndo();
  }
  assertOk(gc._undoStack.length === 20, 'undo stack capped at 20');
  for (let i = 0; i < 20; i++) gc.undo();
  assertOk(gc.state.resources.funding === 6,
    'oldest snapshots evicted first (deepest undo lands on push #6)');
  assertOk(gc._undoStack.length === 0, 'undo stack drained after 20 undos');
  const fundingBefore = gc.state.resources.funding;
  gc.undo();   // no-op: logs 'Nothing to undo'
  assertOk(gc.state.resources.funding === fundingBefore, 'undo on empty stack is a no-op');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
