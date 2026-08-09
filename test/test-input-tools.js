// test/test-input-tools.js — Tool-layer regressions that need a real Game but
// no renderer/DOM. Tools are plain objects driven through their handler
// contract (see src/input/Tool.js), so they can be exercised with stub
// ctx = { game, renderer, input } records.
//
//   1. DemolishTool's wall/door edge paths (shift-click whole-run delete and
//      the edge drag) must coalesce their per-edge removals into a single
//      renderer event. (Regression: each edge emitted its own 'wallsChanged',
//      and every one of those costs a full WallBuilder teardown + rebuild of
//      every wall on the map — 60 rebuilds for one shift-click.)
//   2. MoveTool must drop its carried payload when the world is restored
//      under it. (Regression: the pick-up pushed an undo snapshot, so Ctrl+Z
//      mid-carry put the object back in the world while the tool still held
//      it — the next drop minted a free second copy.)

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { DemolishTool } from '../src/input/demolish-tool.js';
import { MoveTool } from '../src/input/mode-tools.js';
import { InputHandler } from '../src/input/InputHandler.js';

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

console.log('\n=== 1. Demolish edge paths rebuild walls once, not per edge ===\n');

{
  const g = makeGame(42);
  const RUN = 24;
  const run = [];
  for (let col = 4; col < 4 + RUN; col++) run.push({ col, row: 10, edge: 'n' });
  for (const pt of run) g.placeWall(pt.col, pt.row, pt.edge, 'officeWall');
  assertOk(g.state.walls.length === RUN, `setup: ${RUN}-segment wall run placed`);

  // Minimal InputHandler stand-in: the tool only reaches these four members
  // on the shift-click path.
  const input = {
    _shiftDown: true,
    _suppressNextClick: false,
    _getNearestEdge: () => run[0],
    _findWallOrDoorAtEdge: (edge) => ({ edge, wallType: 'officeWall' }),
    _buildWallSegmentPath: () => run,
    _removeWallAndDoorAtEdge: (pt) => {
      g.removeWall(pt.col, pt.row, pt.edge);
      g.removeDoor(pt.col, pt.row, pt.edge);
    },
  };
  const ctx = { game: g, input, renderer: { clearDragPreview() {} } };

  const counts = {};
  g.on((ev) => { counts[ev] = (counts[ev] || 0) + 1; });
  new DemolishTool('demolishBuilding').onMouseDown({ button: 0, clientX: 0, clientY: 0 }, ctx);

  assertOk(g.state.walls.length === 0, 'the whole run was deleted');
  assertOk((counts.wallsChanged || 0) === 1,
    `one wallsChanged for the whole run (got ${counts.wallsChanged || 0}, ${RUN} edges)`);
}

{
  // Same for the edge-path drag, which commits on mouseup.
  const g = makeGame(43);
  const RUN = 16;
  const path = [];
  for (let col = 4; col < 4 + RUN; col++) path.push({ col, row: 12, edge: 'n' });
  for (const pt of path) g.placeWall(pt.col, pt.row, pt.edge, 'officeWall');

  const input = {
    _removeWallAndDoorAtEdge: (pt) => {
      g.removeWall(pt.col, pt.row, pt.edge);
      g.removeDoor(pt.col, pt.row, pt.edge);
    },
  };
  const ctx = { game: g, input, renderer: { clearDragPreview() {} } };
  const tool = new DemolishTool('demolishBuilding');
  tool._drawingEdges = true;
  tool._edgePath = path;

  const counts = {};
  g.on((ev) => { counts[ev] = (counts[ev] || 0) + 1; });
  tool.onMouseUp({ button: 0, clientX: 0, clientY: 0 }, ctx);

  assertOk(g.state.walls.length === 0, 'the dragged edge path was deleted');
  assertOk((counts.wallsChanged || 0) === 1,
    `one wallsChanged for the whole drag (got ${counts.wallsChanged || 0}, ${RUN} edges)`);
}

console.log('\n=== 2. Undo while carrying does not duplicate the object ===\n');

{
  const g = makeGame(44);
  let placed = null;
  for (let row = 2; row < 40 && !placed; row++) {
    for (let col = 2; col < 40 && !placed; col++) {
      const id = g.placePlaceable({ type: 'flowerBed', col, row, subCol: 0, subRow: 0 });
      if (id) placed = { id, col, row };
    }
  }
  assertOk(placed, 'setup: flower bed placed');
  const countOf = (type) => g.state.placeables.filter(p => p.type === type).length;
  const before = countOf('flowerBed');

  // MoveTool pick-up: the lift runs inside _withUndo (InputHandler._pickUpAt).
  const tool = new MoveTool();
  const snap = g._withUndo(() => g.liftPlaceable(placed.id));
  assertOk(snap && countOf('flowerBed') === before - 1, 'pick-up lifted the object out of the world');
  tool.payload = {
    kind: 'placeable', type: snap.type, params: snap.params, variant: snap.variant ?? 0,
    originCol: snap.col, originRow: snap.row,
    originSubCol: snap.subCol, originSubRow: snap.subRow, originDir: snap.dir, dir: snap.dir,
  };

  // Ctrl+Z: InputHandler asks the active tool to abandon its gesture first,
  // with reason 'stateReplaced' — the one case where the payload must be
  // dropped WITHOUT re-placing it (the undo restore already holds a copy).
  const ctx = {
    game: g,
    input: { hoverPlaceable: {}, isLinePlacingDecoration: false },
    renderer: { _clearPreview() {}, canvas: { style: {} } },
  };
  tool.cancelGesture(ctx, 'stateReplaced');
  g.undo();

  assertOk(tool.payload === null, 'the carried payload was dropped');
  assertOk(countOf('flowerBed') === before,
    `object restored exactly once (got ${countOf('flowerBed')}, want ${before})`);
}

console.log('\n=== 3. Shift+drag decoration line rebuilds decorations once ===\n');

{
  // Regression: _finishLinePlaceDecoration wrapped its N placePlaceable calls
  // in _withUndo but not _batchEvents, so a 12-item hedge drag fired 12
  // 'placeableChanged' events — each one a full teardown+rebuild of every
  // decoration/equipment/component group in the scene.
  const g = makeGame(45);
  const hovers = [];
  for (let i = 0; i < 12 && hovers.length < 12; i++) {
    hovers.push({ valid: true, hover: { id: 'flowerBed', col: 5 + i, row: 30, subCol: 0, subRow: 0, dir: 0 } });
  }
  const ctx = {
    game: g,
    linePlaceHovers: hovers,
    selectedParamOverrides: null,
    selectedPlaceableVariant: 0,
    renderer: { clearDragPreview() {} },
    _updatePlaceablePreview() {},
  };

  const before = g.state.placeables.length;
  const counts = {};
  g.on((ev) => { counts[ev] = (counts[ev] || 0) + 1; });
  InputHandler.prototype._finishLinePlaceDecoration.call(ctx);

  // Some ghosts land on generated scenery and are rejected; the event count
  // is the property under test, so only require a multi-placement gesture.
  const added = g.state.placeables.length - before;
  assertOk(added > 1, `the line placed several items (got ${added})`);
  assertOk((counts.placeableChanged || 0) === 1,
    `one placeableChanged for the whole line (got ${counts.placeableChanged || 0}, ${hovers.length} items)`);
  assertOk(g._undoStack.length === 1, 'the line gesture pushed exactly one undo entry');
  // The helper must NOT arm _suppressNextClick: both of its callers
  // (PlaceableTool/MoveTool onMouseUp) return true, so the canvas mouseup
  // listener bails before _handleClick — the flag's only reader — and the
  // flag stayed armed until the player's next canvas click, which was then
  // silently swallowed.
  assertOk(!ctx._suppressNextClick,
    'the line-place commit leaves no armed click suppressor');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
