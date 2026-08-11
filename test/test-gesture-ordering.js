// test/test-gesture-ordering.js — the gesture helper's ordering contract.
//
// Six review rounds kept producing instances of one structural defect:
// gestures that mutated (or charged, or snapshotted) before they validated.
// Game.commitGesture is the single helper that owns the order
//
//     validate -> charge -> mutate -> snapshot
//
// and this suite pins each edge of it, plus the two real input paths that
// used to get it wrong (junction placement, pipe remove-sweep).
//
// The invariant that makes the class closed: a gesture that changes nothing
// must charge nothing, push no undo entry, and leave the redo stack alone —
// otherwise a miss-click on empty terrain silently destroys redo history.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { BeamlineInputController } from '../src/input/BeamlineInputController.js';
import { tileCenterIso } from '../src/renderer/grid.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

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

// A game with one committed-then-undone gesture, so there is real redo
// history for the next gesture to (not) destroy.
function gameWithPendingRedo(seed) {
  const g = makeGame(seed);
  g.commitGesture({ mutate: () => g.placeInfraTile(4, 30, 'concrete') });
  g.undo();
  return g;
}

console.log('\n=== 1. A rejected gesture touches nothing ===\n');

{
  const g = gameWithPendingRedo(1);
  assertOk(g._undoStack.length === 0 && g._redoStack.length === 1,
    'setup: one undone gesture, redo pending');

  const funding = g.state.resources.funding;
  let mutated = false;
  const out = g.commitGesture({
    validate: () => false,
    cost: { funding: 500 },
    mutate: () => { mutated = true; return true; },
  });

  assertOk(out === undefined, 'a rejected gesture returns undefined');
  assertOk(!mutated, 'a rejected gesture never runs its mutation');
  assertOk(g.state.resources.funding === funding, 'a rejected gesture charges nothing');
  assertOk(g._undoStack.length === 0, 'a rejected gesture pushes no undo entry');
  assertOk(g._redoStack.length === 1, 'a rejected gesture does not clear the redo stack');
}

// Rejections that explain themselves ("Space occupied!") write to the log,
// and the log must not read as a mutation — the change test used to compare
// full serialize() output, which embeds state.log.
{
  const g = gameWithPendingRedo(2);
  const logBefore = g.state.log.length;
  g.commitGesture({
    validate: () => ({ ok: false, reason: 'Space occupied!' }),
    mutate: () => { throw new Error('mutation ran on a rejected gesture'); },
  });
  assertOk(g.state.log.length > logBefore, 'the rejection reason was logged');
  assertOk(g.state.log[0].msg === 'Space occupied!', 'the reason is the logged message');
  assertOk(g._undoStack.length === 0 && g._redoStack.length === 1,
    'a logged rejection still pushes no undo entry and keeps redo');
}

console.log('\n=== 2. Charge happens once, between validate and mutate ===\n');

{
  const g = makeGame(3);
  const funding = g.state.resources.funding;
  let fundingAtMutate = null;
  g.commitGesture({
    cost: { funding: 1000 },
    mutate: () => { fundingAtMutate = g.state.resources.funding; return true; },
  });
  assertOk(fundingAtMutate === funding - 1000, 'the cost is already paid when the mutation runs');
  assertOk(g.state.resources.funding === funding - 1000,
    `charged exactly once (got ${funding - g.state.resources.funding})`);
}

// A mutation that refuses after the charge gets the money back, so the
// gesture stays a true no-op rather than billing for nothing.
{
  const g = gameWithPendingRedo(4);
  const funding = g.state.resources.funding;
  const out = g.commitGesture({
    cost: { funding: 1000 },
    mutate: () => false,
  });
  assertOk(out === false, 'the failed mutation result is returned');
  assertOk(g.state.resources.funding === funding, 'a failed mutation is refunded');
  assertOk(g._undoStack.length === 0 && g._redoStack.length === 1,
    'a failed-but-charged gesture pushes no undo entry and keeps redo');
}

// Unaffordable: refuse before mutating, and before touching the stacks.
{
  const g = gameWithPendingRedo(5);
  g.state.resources.funding = 10;
  let mutated = false;
  g.commitGesture({ cost: { funding: 1000 }, mutate: () => { mutated = true; } });
  assertOk(!mutated, 'an unaffordable gesture never runs its mutation');
  assertOk(g.state.resources.funding === 10, 'an unaffordable gesture charges nothing');
  assertOk(g._undoStack.length === 0 && g._redoStack.length === 1,
    'an unaffordable gesture pushes no undo entry and keeps redo');
}

console.log('\n=== 3. One user action, one undo entry ===\n');

// Nested gestures join the outer one. Without this, a tool path that calls a
// Game method which itself commits a gesture needs two Ctrl+Z to undo one
// click.
{
  const g = makeGame(6);
  g.commitGesture({
    mutate: () => g.commitGesture({
      mutate: () => {
        g.placeInfraTile(6, 30, 'concrete');
        g.placeInfraTile(7, 30, 'concrete');
      },
    }),
  });
  assertOk(g.state.infraOccupied['6,30'] === 'concrete'
    && g.state.infraOccupied['7,30'] === 'concrete', 'setup: nested gesture placed both tiles');
  assertOk(g._undoStack.length === 1, 'a nested gesture pushes one entry, not two');
  g.undo();
  assertOk(!g.state.infraOccupied['6,30'] && !g.state.infraOccupied['7,30'],
    'one undo reverses the whole nested gesture');
}

console.log('\n=== 4. Non-semantic state is not a mutation ===\n');

// Host aux sections (renderer camera, probe pins, designer session) ride in
// serialize() but restoreSnapshot deliberately never dispatches them, so a
// gesture that only moved the camera must not push an undo entry.
{
  const g = gameWithPendingRedo(7);
  let camera = 0;
  g.registerSerializer('view', { save: () => ({ camera }), load: () => {} });
  g.commitGesture({ mutate: () => { camera = 42; } });
  assertOk(g._undoStack.length === 0,
    'a gesture that only changed an aux section pushes no undo entry');
  assertOk(g._redoStack.length === 1,
    'a gesture that only changed an aux section keeps the redo stack');

  // ...and the aux section is not in the payload at all, so undo can never
  // silently rewind the camera either.
  const snap = JSON.parse(g._snapshot());
  assertOk(!snap.aux || Object.keys(snap.aux).length === 0,
    'undo snapshots carry no aux sections');
  assertOk(JSON.parse(g.serialize()).aux.view.camera === 42,
    'save payloads still carry aux sections');
}

console.log('\n=== 5. Real input paths ===\n');

// Junction placement: canPlace() is the validate step. A click on an occupied
// tile must be a complete no-op — this used to push undo before validating.
{
  const g = gameWithPendingRedo(8);
  const controller = new BeamlineInputController({
    game: g,
    renderer: {
      renderBeamPipePreview() {}, clearDragPreview() {},
      renderPlaceableGhost() {}, renderAttachmentGhost() {},
    },
    inputHandler: { placementDir: 0, selectedParamOverrides: null },
  });
  const placed = g.commitGesture({
    mutate: () => g.beamline.placeJunction({
      type: 'source', col: 6, row: 6, dir: 3, free: true, silent: true,
    }),
  });
  assertOk(!!placed, 'setup: a source is in the way');
  g._undoStack.length = 0;
  g._redoStack.length = 0;
  g.commitGesture({ mutate: () => g.placeInfraTile(9, 30, 'concrete') });
  g.undo();
  assertOk(g._undoStack.length === 0 && g._redoStack.length === 1,
    'setup: redo pending again');

  const funding = g.state.resources.funding;
  const count = g.state.placeables.length;
  // Click dead centre of the occupied tile (world coords are iso; the
  // controller re-snaps, so any point inside the footprint is enough).
  const click = tileCenterIso(6, 6);
  controller.onMouseDown(click.x, click.y, 0, 'source');
  assertOk(g.state.placeables.length === count, 'the blocked junction click placed nothing');
  assertOk(g.state.resources.funding === funding, 'the blocked junction click charged nothing');
  assertOk(g._undoStack.length === 0, 'the blocked junction click pushed no undo entry');
  assertOk(g._redoStack.length === 1, 'the blocked junction click kept the redo stack');
}

// Pipe remove-sweep across empty ground: nothing to remove, so nothing to
// snapshot. (This path pushed undo unconditionally before the sweep found
// its victims.)
{
  const g = gameWithPendingRedo(9);
  const controller = new BeamlineInputController({
    game: g,
    renderer: { renderBeamPipePreview() {}, clearDragPreview() {} },
    inputHandler: { placementDir: 0, selectedParamOverrides: null },
  });
  controller._drawing = true;
  controller._drawMode = 'remove';
  controller._drawButton = 2;
  controller._drawOrigin = { col: 30, row: 30 };
  controller._drawPath = [controller._drawOrigin];
  controller.onMouseUp(0, 0, 2);
  assertOk(g._undoStack.length === 0, 'an empty remove-sweep pushed no undo entry');
  assertOk(g._redoStack.length === 1, 'an empty remove-sweep kept the redo stack');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
