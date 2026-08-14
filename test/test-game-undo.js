// test/test-game-undo.js — full-state snapshot undo/redo.
//
// commitGesture() captures serialize() output; undo() must restore the exact
// pre-action payload (byte-equal modulo the log, which accrues 'Undo'/action
// entries) for every mutation family the input layer can trigger: placeables,
// floors, walls, beam pipes (via BeamlineSystem), utility lines, demolish.
// Also: redo restores the after-state, a new gesture clears the redo stack,
// and the undo stack caps at 20 with oldest-first eviction.
//
// commitGesture is the only thing allowed to touch the undo stacks, and it
// owns the ordering validate -> charge -> mutate -> snapshot; the ordering
// itself is pinned in test-gesture-ordering.js.
//
// What undo deliberately does NOT rewind: the message log, and the sim's own
// progress (tick, research, objectives, staff needs). Resources are reconciled
// so the undone gesture's spending comes back without also reversing tick
// income/upkeep — see the last three blocks.

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

// Run one input-layer gesture: capture before, mutate inside a gesture,
// undo, and assert byte-equality with the before payload.
function gestureRoundTrip(g, label, action) {
  const before = payload(g);
  const acted = g.commitGesture({ mutate: action });
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
    [{ col: 5, row: 5, edge: 'n' }, { col: 6, row: 5, edge: 'n' }],
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
  const ok = g.commitGesture({
    mutate: () => g.placeInfraTile(3, 30, 'concrete') || g.placeInfraTile(3, 31, 'concrete'),
  });
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
  g.commitGesture({ mutate: () => g.placeInfraTile(3, 33, 'concrete') });   // new user gesture
  assertOk(g._redoStack.length === 0, 'a new mutating gesture clears the redo stack');
}

console.log('\n=== _withUndo: no-op gestures keep undo/redo intact ===\n');

// Regression: tools used to call _pushUndo() before knowing whether the
// gesture mutated anything, so a miss-click pushed an identical snapshot AND
// cleared the redo stack, making the just-undone action unrecoverable.
{
  const gw = makeGame(11);
  const before = payload(gw);
  gw._withUndo(() => { gw.placeInfraTile(4, 30, 'concrete'); });
  assertOk(payload(gw) !== before, '_withUndo setup: mutation applied');
  assertOk(gw._undoStack.length === 1, '_withUndo pushed for a mutating gesture');
  gw.undo();
  assertOk(gw._redoStack.length === 1, 'redo available after undo');

  const undoDepth = gw._undoStack.length;
  // A no-op gesture (miss-click: nothing under the cursor mutates state).
  gw._withUndo(() => { /* found nothing deletable */ });
  assertOk(gw._undoStack.length === undoDepth,
    'no-op gesture does not grow the undo stack');
  assertOk(gw._redoStack.length === 1,
    'no-op gesture does not clobber the redo stack');
  gw.redo();
  assertOk(payload(gw) !== before && gw.state.infraOccupied['4,30'] === 'concrete',
    'redo still restores the undone action after a no-op gesture');

  // 25 consecutive no-op gestures must not evict real history.
  const gv = makeGame(12);
  gv._withUndo(() => { gv.placeInfraTile(5, 30, 'concrete'); });
  for (let i = 0; i < 25; i++) gv._withUndo(() => {});
  assertOk(gv._undoStack.length === 1,
    'repeated no-op gestures leave real undo history untouched');
  gv.undo();
  assertOk(!gv.state.infraOccupied['5,30'],
    'undo still reaches the real gesture after 25 no-ops');
}

console.log('\n=== Rejected gestures that only log are still no-ops ===\n');

// Regression: _withUndo compared full serialize() output, which embeds
// state.log — so a rejected placement ("Lab Flooring requires Concrete Pad!")
// looked like a mutation, pushed a junk snapshot and clobbered the redo stack.
{
  const gl = makeGame(3);
  gl._withUndo(() => gl.placeInfraTile(6, 30, 'concrete'));
  gl.undo();
  assertOk(gl._undoStack.length === 0 && gl._redoStack.length === 1,
    'setup: one undone gesture, redo pending');

  const logBefore = gl.state.log.length;
  const rejected = gl._withUndo(() => gl.placeInfraTile(9, 31, 'labFloor'));
  assertOk(rejected === false, 'placement without a foundation is rejected');
  assertOk(gl.state.log.length > logBefore, 'the rejection did log a message');
  assertOk(gl._undoStack.length === 0,
    'a logged rejection does not push an undo snapshot');
  assertOk(gl._redoStack.length === 1,
    'a logged rejection does not clobber the redo stack');

  // Same for the most common miss-click: placing onto an occupied subtile.
  const gd = makeGame(4);
  let dec = null;
  for (let row = 2; row < 40 && !dec; row++) {
    for (let col = 2; col < 40 && !dec; col++) {
      const id = gd._withUndo(() => gd.placePlaceable({ type: 'oakTree', col, row, subCol: 0, subRow: 0 }));
      if (id) dec = { col, row };
    }
  }
  assertOk(dec, 'setup: decoration placed');
  const depth = gd._undoStack.length;
  const count = gd.state.placeables.length;
  gd._withUndo(() => gd.placePlaceable({ type: 'oakTree', col: dec.col, row: dec.row, subCol: 0, subRow: 0 }));
  assertOk(gd.state.placeables.length === count, 'the duplicate placement was refused');
  assertOk(gd._undoStack.length === depth,
    "'Space occupied!' does not grow the undo stack");
}

console.log('\n=== Undo rewinds the build, not the simulation ===\n');

// Regression: the snapshot is the full save payload, so undoing a build made
// N ticks ago also restored tick, resources, research and staff needs —
// erasing N ticks of simulation. Sim progress is now carried over and only
// the gesture's own resource delta is reversed.
{
  const gs = makeGame(9);
  gs.state.resources.funding = 100000;
  const fundingBefore = gs.state.resources.funding;
  gs._withUndo(() => gs.placeInfraRect(4, 4, 6, 6, 'concrete'));
  const spent = fundingBefore - gs.state.resources.funding;
  assertOk(spent > 0, `build charged the player ($${spent})`);

  for (let i = 0; i < 25; i++) gs.tick();
  const tickAfter = gs.state.tick;
  const fundingAfterTicks = gs.state.resources.funding;
  assertOk(tickAfter === 25, 'sim ran 25 ticks after the build');

  gs.undo();
  assertOk(gs.state.tick === tickAfter, 'undo does not rewind the sim clock');
  assertOk(!gs.state.infraOccupied['5,5'], 'undo did remove the built tiles');
  assertOk(gs.state.resources.funding === fundingAfterTicks + spent,
    `undo refunds exactly the build cost, keeping tick income/upkeep `
    + `(got ${gs.state.resources.funding}, want ${fundingAfterTicks + spent})`);
  assertOk(gs.state.log.some(e => e.msg === 'Undo'),
    'undo does not rewind the message log');

  gs.redo();
  assertOk(gs.state.infraOccupied['5,5'] === 'concrete', 'redo re-applies the build');
  assertOk(gs.state.resources.funding === fundingAfterTicks,
    'redo re-charges the build cost without touching sim income');
}

// The same must hold for the two-phase form (beginGesture/commit), which the
// helper itself is built on: spending between open and commit is the
// gesture's, everything after it is the ledger's.
{
  const gp = makeGame(10);
  gp.state.resources.funding = 100000;
  const fundingBefore = gp.state.resources.funding;
  const gesture = gp.beginGesture();
  gp.placeInfraRect(10, 10, 12, 12, 'concrete');
  const spent = fundingBefore - gp.state.resources.funding;
  assertOk(spent > 0, `two-phase gesture charged the player ($${spent})`);
  assertOk(gesture.commit() === true, 'two-phase gesture committed a snapshot');

  for (let i = 0; i < 25; i++) gp.tick();
  const fundingAfterTicks = gp.state.resources.funding;
  gp.undo();
  assertOk(gp.state.tick === 25, 'two-phase gesture: undo keeps the sim clock');
  assertOk(gp.state.resources.funding === fundingAfterTicks + spent,
    `two-phase gesture: undo refunds only the build (got ${gp.state.resources.funding}, `
    + `want ${fundingAfterTicks + spent})`);
}

// Per-beamline sim accumulators live on registry entries, not state, so
// restoring the registry wholesale rewound them too: Ctrl+Z was a free repair
// of every worn component, and beamOnTicks rewound under a preserved
// state.tick permanently corrupted uptimeFraction.
{
  const gb = makeGame(11);
  const entry = gb.registry.createBeamline('linac', null);
  Object.assign(entry.beamState, {
    componentHealth: { x1: 100 },
    beamOnTicks: 0,
    continuousBeamTicks: 0,
    totalBeamHours: 0,
    totalDataCollected: 0,
    uptimeFraction: 1,
  });

  gb._withUndo(() => gb.placeInfraRect(20, 20, 21, 21, 'concrete'));

  // Simulate wear + accumulation after the snapshot.
  Object.assign(gb.registry.get(entry.id).beamState, {
    componentHealth: { x1: 12 },
    beamOnTicks: 400,
    continuousBeamTicks: 400,
    totalBeamHours: 0.11,
    totalDataCollected: 999,
    uptimeFraction: 0.8,
  });

  gb.undo();
  const bs = gb.registry.get(entry.id).beamState;
  assertOk(bs.componentHealth.x1 === 12,
    `undo does not repair worn components (health ${bs.componentHealth.x1})`);
  assertOk(bs.beamOnTicks === 400 && bs.continuousBeamTicks === 400,
    `undo does not rewind beamOnTicks (got ${bs.beamOnTicks})`);
  assertOk(bs.totalDataCollected === 999 && bs.totalBeamHours === 0.11,
    'undo does not rewind collected data / beam hours');
  assertOk(!gb.state.infraOccupied['20,20'], 'the build itself was still undone');

  gb.redo();
  const bs2 = gb.registry.get(entry.id).beamState;
  assertOk(bs2.componentHealth.x1 === 12 && bs2.beamOnTicks === 400,
    'redo does not rewind them either');
}

// Beamline entries created/deleted by a gesture are still gesture state —
// only the accumulators on surviving entries are carried over.
{
  const gn = makeGame(12);
  const before = gn.registry.getAll().length;
  gn._withUndo(() => { gn.registry.createBeamline('linac', null); });
  assertOk(gn.registry.getAll().length === before + 1, 'gesture created a beamline');
  gn.undo();
  assertOk(gn.registry.getAll().length === before,
    'undo removes a beamline entry the gesture created');
}

// The RNG stream is sim progress like `tick`: reseeding it on every restore
// let a player re-roll wear failures / discoveries with Ctrl+Z, Ctrl+Shift+Z.
{
  const gr = makeGame(1234);
  const draws = [];
  for (let i = 0; i < 3; i++) {
    gr._withUndo(() => gr.placeInfraTile(30 + i, 30, 'concrete'));
    for (let k = 0; k < 7; k++) gr.rng();
    gr.undo();
    draws.push(gr.rng());
    gr.redo();
  }
  assertOk(new Set(draws).size === draws.length,
    `post-undo rng draws differ each cycle (got ${JSON.stringify(draws)})`);

  // load() still restarts the stream from the saved seed: two games that load
  // the same save draw the same numbers regardless of what they drew before.
  localStorage.setItem('beamlineTycoon', makeGame(1234).serialize());
  const glA = makeGame(1234);
  const glB = makeGame(1234);
  for (let k = 0; k < 9; k++) glB.rng();
  assertOk(glA.load() && glB.load(), 'both games loaded the save');
  assertOk(glA.rng() === glB.rng(),
    'load() still reseeds the stream from state.seed');
}

// The design library is saved outside any gesture (addDesign/deleteDesign
// never push undo), so undo must skip past it instead of destroying a design
// saved after the last snapshot — or resurrecting one deleted after it.
{
  const gd = makeGame(13);
  gd._withUndo(() => gd.placeInfraTile(32, 32, 'concrete'));
  const id = gd.addDesign({ name: 'My Linac', nodes: [] });
  assertOk(gd.state.savedDesigns.length === 1 && id, 'design saved after the gesture');
  const nextId = gd.state.savedDesignNextId;

  gd.undo();
  assertOk(gd.state.savedDesigns.length === 1,
    `undo keeps designs saved after the snapshot (got ${gd.state.savedDesigns.length})`);
  assertOk(gd.state.savedDesignNextId === nextId, 'the design id counter is not rewound');
  assertOk(!gd.state.infraOccupied['32,32'], 'the build itself was still undone');

  gd.deleteDesign(id);
  gd._withUndo(() => gd.placeInfraTile(33, 32, 'concrete'));
  gd.undo();
  assertOk(gd.state.savedDesigns.length === 0,
    'undo does not resurrect a design deleted after the snapshot');
}

console.log('\n=== Doors round-trip through undo/redo ===\n');

// Regression: the phase-3 snapshot dropped the derived doorOccupied index and
// _applyState never rebuilt it, so an undone door left a phantom entry that
// blocked ever re-placing a door on that edge.
{
  const gdoor = makeGame(6);
  gdoor.placeWall(7, 7, 'n', 'officeWall');
  gdoor._withUndo(() => gdoor.placeDoor(7, 7, 'n', 'doubleDoor'));
  assertOk(gdoor.state.doorOccupied['7,7,n'] === 'doubleDoor', 'door placed');
  gdoor.undo();
  assertOk(gdoor.state.doors.length === 0, 'undo removed the door');
  assertOk(!gdoor.state.doorOccupied['7,7,n'],
    'undo also cleared the derived door index');
  assertOk(gdoor.placeDoor(7, 7, 'n', 'doubleDoor') && gdoor.state.doors.length === 1,
    'the edge can be re-filled after the undo');
}

console.log('\n=== Cap eviction at 20 ===\n');

{
  const gc = makeGame(7);
  // Each gesture bumps funding, so the snapshot taken before gesture #i
  // holds funding === i - 1.
  for (let i = 1; i <= 25; i++) {
    gc.commitGesture({ mutate: () => { gc.state.resources.funding = i; } });
  }
  assertOk(gc._undoStack.length === 20, 'undo stack capped at 20');
  for (let i = 0; i < 20; i++) gc.undo();
  assertOk(gc.state.resources.funding === 5,
    'oldest snapshots evicted first (deepest undo lands before gesture #6)');
  assertOk(gc._undoStack.length === 0, 'undo stack drained after 20 undos');
  const fundingBefore = gc.state.resources.funding;
  gc.undo();   // no-op: logs 'Nothing to undo'
  assertOk(gc.state.resources.funding === fundingBefore, 'undo on empty stack is a no-op');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
