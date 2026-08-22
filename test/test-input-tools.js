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
//   3. Moving a selected item closes its info window before entering move mode.
//   3b. Delete removes ordinary selections while beamlines remain protected;
//       D pans, 6 demolishes, C/M/P are contextual modes, and Backspace
//       triggers a selected-placeable explosion.
//   4. Shift-drag decoration line placement emits one rebuild event.
//   5. Preview lifecycle around arming and committing: a keyboard-armed tool
//      must show its ghost before the mouse moves, the variant must not
//      survive an arm into another family, and a commit must re-preview so
//      the ghost stops claiming a tile it just filled.
//   8. Ctrl/Cmd is the mirror of Shift on the structure build tools: the same
//      gesture ERASES along exactly the path it would have drawn, previewed in
//      demolish red and quoted as a refund. Includes the macOS collision where
//      a Ctrl+left-click also arrives as a right-click.
//   7. Beam pipes demolish by the SECTION, not all-or-nothing: a press
//      anchors a sweep at the 0.5 m sub-unit under the cursor, the release
//      removes exactly what was swept (splitting the run on an interior cut),
//      Shift still takes the whole pipe, and demolishAll opts out entirely.

import { readFileSync } from 'node:fs';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { DemolishTool } from '../src/input/demolish-tool.js';
import { MoveTool, SelectionActionTool } from '../src/input/mode-tools.js';
import { InputHandler } from '../src/input/InputHandler.js';
import { BeamlineWindow } from '../src/ui/BeamlineWindow.js';
import { tileCenterIso } from '../src/renderer/grid.js';
import {
  WallPaintTool, FloorTool, WallTool, DoorTool, WindowTool,
} from '../src/input/structure-tools.js';

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
    findDemolishableEdgeAtScreen: () => ({ edge: run[0], wallType: 'officeWall' }),
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

console.log('\n=== 1a. Demolish resolves visible opening geometry before its ground projection ===\n');

function openingDemolishCtx(g, edge, groundEdge, kind = 'door') {
  const edgeField = `${kind}Edge`;
  const renderer = {
    raycastOpeningScreen: () => ({ object: { userData: { [edgeField]: edge } } }),
    screenToWorld: () => tileCenterIso(groundEdge.col, groundEdge.row),
    clearDragPreview() {},
    renderDemolishPathPreview() {},
  };
  const input = {
    renderer,
    game: g,
    _shiftDown: false,
    _edgeAlias: InputHandler.prototype._edgeAlias,
    _findOpeningAtEdge: InputHandler.prototype._findOpeningAtEdge,
    _findWallOrDoorAtEdge: InputHandler.prototype._findWallOrDoorAtEdge,
    _getNearestEdge: () => groundEdge,
    _buildWallLine: InputHandler.prototype._buildWallLine,
    findDemolishableEdgeAtScreen: InputHandler.prototype.findDemolishableEdgeAtScreen,
    _removeWallAndDoorAtEdge: InputHandler.prototype._removeWallAndDoorAtEdge,
  };
  return { game: g, input, renderer };
}

{
  const g = makeGame(44);
  const doorEdge = { col: 6, row: 7, edge: 'n' };
  const wrongGroundEdge = { col: 20, row: 20, edge: 's' };
  g.placeWall(doorEdge.col, doorEdge.row, doorEdge.edge, 'officeWall');
  g.placeDoor(doorEdge.col, doorEdge.row, doorEdge.edge, 'officeDoor');
  const ctx = openingDemolishCtx(g, doorEdge, wrongGroundEdge);

  const found = ctx.input.findDemolishableEdgeAtScreen(300, 200);
  assertOk(found?.doorType === 'officeDoor'
    && found.edge.col === doorEdge.col && found.edge.row === doorEdge.row,
    'visible door ray wins when its ground projection lands on another edge');

  const tool = new DemolishTool('demolishBuilding');
  tool.onMouseDown({ button: 0, clientX: 300, clientY: 200 }, ctx);
  tool.onMouseUp({ button: 0, clientX: 300, clientY: 200 }, ctx);
  assertOk(g.state.doors.length === 0,
    'Building demolition removes the door selected through its visible panel');
  assertOk(g.state.walls.length === 1,
    'directly deleting a door preserves its host wall');
}

{
  const g = makeGame(45);
  const doorEdge = { col: 8, row: 9, edge: 'e' };
  const wrongGroundEdge = { col: 24, row: 24, edge: 'w' };
  g.placeWall(doorEdge.col, doorEdge.row, doorEdge.edge, 'officeWall');
  g.placeDoor(doorEdge.col, doorEdge.row, doorEdge.edge, 'officeDoor');
  const ctx = openingDemolishCtx(g, doorEdge, wrongGroundEdge);

  const tool = new DemolishTool('demolishAll');
  tool.onMouseDown({ button: 0, clientX: 320, clientY: 220 }, ctx);
  tool.onMouseUp({ button: 0, clientX: 320, clientY: 220 }, ctx);
  assertOk(g.state.doors.length === 0,
    'catch-all demolition also removes a door selected above the wrong ground tile');
  assertOk(g.state.walls.length === 1,
    'catch-all directly deletes the door rather than its host wall');
}

{
  const g = makeGame(46);
  const windowEdge = { col: 10, row: 11, edge: 'n' };
  const wrongGroundEdge = { col: 28, row: 28, edge: 's' };
  g.placeWall(windowEdge.col, windowEdge.row, windowEdge.edge, 'officeWall');
  g.placeWindow(windowEdge.col, windowEdge.row, windowEdge.edge, 'officeWindow');
  const ctx = openingDemolishCtx(g, windowEdge, wrongGroundEdge, 'window');

  const found = ctx.input.findDemolishableEdgeAtScreen(340, 240);
  assertOk(found?.windowType === 'officeWindow' && found.wallType === null
    && found.edge.col === windowEdge.col && found.edge.row === windowEdge.row,
    'visible window ray wins when its ground projection lands on another edge');

  const tool = new DemolishTool('demolishFiltered', new Set(['structure']));
  tool.onMouseDown({ button: 0, clientX: 340, clientY: 240 }, ctx);
  tool.onMouseMove({ clientX: 341, clientY: 241 }, ctx);
  tool.onMouseUp({ button: 0, clientX: 340, clientY: 240 }, ctx);
  assertOk(g.state.windows.length === 0,
    'Structure-filtered demolition removes the window selected through its visible pane');
  assertOk(g.state.walls.length === 1,
    'directly deleting a window preserves its host wall');
}

console.log('\n=== 1b. Wall paint follows the selected floor tile ===\n');

{
  const g = makeGame(142);
  const tile = { col: 10, row: 10 };
  g.placeInfraTile(tile.col, tile.row, 'concrete');

  // Store two walls from the selected tile and two from their mirrored
  // neighbours. The paint gesture must still address the face looking into
  // the selected tile, regardless of which spelling owns the physical wall.
  g.placeWall(10, 10, 'n', 'structuralWall');
  g.placeWall(11, 10, 'w', 'structuralWall');
  g.placeWall(10, 10, 's', 'structuralWall');
  g.placeWall(9, 10, 'e', 'structuralWall');
  g.placeWall(15, 15, 'n', 'structuralWall');

  const ctx = {
    game: g,
    input: { _shiftDown: false },
    renderer: { screenToWorld: () => tileCenterIso(tile.col, tile.row) },
  };
  const counts = {};
  g.on((ev) => { counts[ev] = (counts[ev] || 0) + 1; });

  new WallPaintTool('labBlue').onClick(
    { shiftKey: false, clientX: 0, clientY: 0 },
    ctx,
  );

  const [north, east, south, west, remote] = g.state.walls;
  assertOk(north.facePaint?.inside === 'labBlue'
    && east.facePaint?.outside === 'labBlue'
    && south.facePaint?.inside === 'labBlue'
    && west.facePaint?.outside === 'labBlue',
  'click paints every existing wall face adjacent to the selected tile');
  assertOk(!remote.facePaint, 'click leaves walls away from the selected tile unchanged');
  assertOk((counts.wallsChanged || 0) === 1,
    `one wallsChanged for the tile paint (got ${counts.wallsChanged || 0})`);
  assertOk(g._undoStack.length === 1, 'the tile paint pushes exactly one undo entry');

  new WallPaintTool('labBlue').onRightClick(
    { shiftKey: false, clientX: 0, clientY: 0 },
    ctx,
  );
  assertOk(g.state.walls.slice(0, 4).every(wall => !wall.facePaint),
    'right-click clears the same tile-adjacent wall faces');
  assertOk(g._undoStack.length === 2, 'the tile paint removal pushes one undo entry');
}

console.log('\n=== 1c. Shift-paint rebuilds the wall scene once ===\n');

{
  const g = makeGame(143);
  const path = [];
  for (let col = 4; col < 12; col++) {
    path.push({ col, row: 9, edge: 'n' });
    g.placeInfraTile(col, 9, 'concrete');
  }
  for (const pt of path) g.placeWall(pt.col, pt.row, pt.edge, 'structuralWall');

  const ctx = {
    game: g,
    input: {},
    renderer: { screenToWorld: () => tileCenterIso(4, 9) },
  };
  const counts = {};
  g.on((ev) => { counts[ev] = (counts[ev] || 0) + 1; });

  new WallPaintTool('labBlue').onClick(
    { shiftKey: true, clientX: 0, clientY: 0 },
    ctx,
  );

  assertOk(g.state.walls.every(w => w.facePaint?.inside === 'labBlue'),
    'the full selected structural-wall run is painted');
  assertOk((counts.wallsChanged || 0) === 1,
    `one wallsChanged for the paint sweep (got ${counts.wallsChanged || 0}, ${path.length} edges)`);
  assertOk(g._undoStack.length === 1, 'the paint sweep pushes exactly one undo entry');
}

console.log('\n=== 1d. Mouse-release Shift reaches room paint ===\n');

{
  const g = makeGame(146);
  g.placeInfraTile(4, 9, 'concrete');
  g.placeInfraTile(5, 9, 'concrete');
  for (const pt of [
    { col: 4, row: 9, edge: 'n' }, { col: 5, row: 9, edge: 'n' },
    { col: 5, row: 9, edge: 'e' }, { col: 4, row: 9, edge: 's' },
    { col: 5, row: 9, edge: 's' }, { col: 4, row: 9, edge: 'w' },
  ]) g.placeWall(pt.col, pt.row, pt.edge, 'structuralWall');

  const handler = {
    _suppressNextClick: false,
    _shiftDown: false,
    activeTool: new WallPaintTool('labBlue'),
    game: g,
    renderer: { screenToWorld: () => tileCenterIso(4, 9) },
  };
  handler._toolCtx = { game: g, renderer: handler.renderer, input: handler };
  handler._toolConsumed = InputHandler.prototype._toolConsumed;

  // The release event is the authoritative modifier snapshot. Keyboard
  // tracking can be false after a focus transition even though the canvas
  // release still reports Shift; dropping this flag reduced room paint to
  // only the clicked tile's four adjacent faces.
  InputHandler.prototype._handleClick.call(handler, 0, 0, { shiftKey: true });

  assertOk(g.state.walls.every(wall => wall.facePaint?.inside === 'labBlue'),
    'Shift from mouse release paints every inward-facing wall in the room');
}

console.log('\n=== 1e. Shift-wallpaper stays on room boundaries ===\n');

{
  const g = makeGame(144);
  for (let row = 9; row <= 10; row++) {
    for (let col = 4; col <= 6; col++) g.placeInfraTile(col, row, 'concrete');
  }
  // This partial partition reconnects around its south end. It does not
  // bound a room, so Shift-fill must leave both of its faces alone.
  g.placeWall(5, 9, 'e', 'structuralWall');
  g.placeWall(4, 9, 'n', 'structuralWall');
  const ctx = {
    game: g,
    input: {},
    renderer: { screenToWorld: () => tileCenterIso(4, 9) },
  };

  new WallPaintTool('paperPinstripe').onClick(
    { shiftKey: true, clientX: 0, clientY: 0 },
    ctx,
  );

  const partition = g.state.walls.find(w => w.col === 5 && w.row === 9 && w.edge === 'e');
  assertOk(partition?.facePaint === undefined,
    'shift-wallpaper excludes a reconnecting partition instead of choosing its far-side face');
}

console.log('\n=== 1f. Ctrl-wallpaper paints one contiguous wall side ===\n');

{
  const g = makeGame(145);
  for (let col = 4; col <= 7; col++) {
    g.placeInfraTile(col, 30, 'concrete');
    g.placeWall(col, 30, 'n', 'structuralWall');
  }
  const ctx = structCtx(g, {
    ctrl: true,
    edgeAt: () => ({ col: 6, row: 30, edge: 'n' }),
  });
  const tool = new WallPaintTool('paperGingham');
  tool.onMouseDown({ button: 0, clientX: 6, clientY: 30 }, ctx);
  tool.onMouseUp({ button: 2, clientX: 6, clientY: 30 }, ctx);
  assertOk(g.state.walls.every(w => w.facePaint?.inside === 'paperGingham'),
    'Ctrl-wallpaper paints the complete contiguous side from tile to tile');
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

console.log('\n=== 3. Selected move closes the item info window ===\n');

{
  const entry = { id: 'selected_1', type: 'flowerBed', category: 'grounds', dir: 2 };
  let closed = null;
  const input = {
    selectedPlaceableId: entry.id,
    game: { getPlaceable: (id) => id === entry.id ? entry : null },
    renderer: {
      canvas: { style: {} },
      closePlaceableInfoWindow: (target) => { closed = target; },
    },
    setTool(tool) { this.activeTool = tool; },
    _armMovePreview() {},
    _showToast() {},
  };
  const began = InputHandler.prototype._beginSelectedMove.call(input);
  assertOk(began && input.activeTool?.kind === 'move', 'selected move command enters move mode');
  assertOk(closed === entry, 'moving a selected item closes that item\'s info window first');
  assertOk(input.activeTool.payload?.placeableId === entry.id,
    'the selected item is armed as the move payload');
}

console.log('\n=== 3a. Click-to-move preserves the object ID and utilities ===\n');

{
  const entry = {
    id: 'wired_rack_1', type: 'mcc', kind: 'infrastructure',
    category: 'infrastructure', dir: 1, variant: 0,
  };
  let liftCalls = 0;
  const input = {
    game: {
      getPlaceable: id => id === entry.id ? entry : null,
      liftPlaceable() { liftCalls++; return null; },
    },
    renderer: {
      raycastScreen: () => ({}),
      identifyHit: () => ({ nodeId: entry.id }),
    },
    _showToast() {},
  };
  const payload = InputHandler.prototype._pickUpAt.call(input, 0, 0, 10, 10);
  assertOk(payload?.kind === 'selectedPlaceable' && payload.placeableId === entry.id,
    'click-to-move carries the existing stable ID');
  assertOk(liftCalls === 0,
    'click-to-move does not remove the object or dangle its utility endpoints');
}

console.log('\n=== 3b. Delete removes ordinary selections but protects beamlines ===\n');

{
  const g = makeGame(441);
  let itemId = null;
  for (let row = 2; row < 40 && !itemId; row++) {
    for (let col = 2; col < 40 && !itemId; col++) {
      itemId = g.placePlaceable({
        type: 'flowerBed', col, row, subCol: 0, subRow: 0,
        free: true, silent: true,
      });
    }
  }
  assertOk(!!itemId, 'setup: selected ordinary item exists');
  let closedId = null;
  const input = {
    game: g,
    renderer: {
      closePlaceableInfoWindow: entry => { closedId = entry.id; },
      clearSelectionOutline() {},
    },
    selectedNodeId: null,
    selectedPlaceableId: itemId,
    selectedPlaceableIds: new Set([itemId]),
    _selectedRootsById: new Map(),
    _showToast() {},
  };
  for (const method of [
    '_selectionIdsForAnchor', '_deleteSelectedFromKeyboard',
    '_demolishSelected', '_clearSelection',
  ]) input[method] = InputHandler.prototype[method];

  const consumed = input._deleteSelectedFromKeyboard();
  assertOk(consumed === true && !g.getPlaceable(itemId),
    'Delete immediately demolishes an ordinary selected item');
  assertOk(closedId === itemId && input.selectedPlaceableId === null,
    'Delete closes the item window and clears the selection');
}

{
  const target = {
    key: 'equipment-1', id: 'equipment-1', targetKind: 'placeable',
    name: 'Oscilloscope', rootObj: { id: 'visible-object' },
  };
  let exploded = null;
  let toast = '';
  const input = {
    selectedPlaceableId: target.id,
    _selectionTarget: () => target,
    renderer: { explodeSelectionTarget: value => { exploded = value; return true; } },
    _showToast: message => { toast = message; },
  };
  input._explodeSelectedFromKeyboard = InputHandler.prototype._explodeSelectedFromKeyboard;
  assertOk(input._explodeSelectedFromKeyboard() === true && exploded === target,
    'Backspace command routes the primary logical selection to the public renderer incident API');
  assertOk(/Boom: Oscilloscope/.test(toast),
    'a successful selected explosion reports the affected item');

  input.selectedPlaceableId = null;
  assertOk(input._explodeSelectedFromKeyboard() === false && /Select a placeable/.test(toast),
    'the explosion command is a safe no-op when nothing is selected');
}

{
  const g = makeGame(442);
  let sourceId = null;
  for (let row = 2; row < 40 && !sourceId; row += 3) {
    for (let col = 2; col < 40 && !sourceId; col += 3) {
      sourceId = g.placePlaceable({
        type: 'penningIonSource', col, row,
        free: true, silent: true,
      });
    }
  }
  assertOk(!!sourceId, 'setup: selected beamline exists');
  let toast = '';
  let closed = false;
  const input = {
    game: g,
    renderer: { closePlaceableInfoWindow: () => { closed = true; } },
    selectedPlaceableId: sourceId,
    selectedPlaceableIds: new Set([sourceId]),
    _selectionIdsForAnchor: InputHandler.prototype._selectionIdsForAnchor,
    _showToast: message => { toast = message; },
  };
  input._deleteSelectedFromKeyboard = InputHandler.prototype._deleteSelectedFromKeyboard;

  const consumed = input._deleteSelectedFromKeyboard();
  assertOk(consumed === true && !!g.getPlaceable(sourceId),
    'Delete is consumed without removing a selected beamline');
  assertOk(!closed && /disabled/i.test(toast),
    'protected beamline stays selected and gets a clear disabled message');
}

{
  let actions = null;
  const beamlineWindow = {
    beamlineId: 'bl-safe',
    game: {
      registry: { get: () => ({ status: 'stopped', name: 'Safe beamline' }) },
      toggleBeam() {},
      _openDesignerForBeamline() {},
      editingBeamlineId: null,
      selectedBeamlineId: null,
    },
    ctx: {
      setActions: next => { actions = next; },
      update() {},
      setTitle() {},
    },
    _updateStatus() {},
  };
  BeamlineWindow.prototype._updateActions.call(beamlineWindow);
  assertOk(actions?.length > 0 && !actions.some(action => /demolish|delete/i.test(action.label)),
    'the whole-beamline info window exposes no delete/demolish action');
}

{
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const listeners = {};
  globalThis.window = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  };
  const modeClicks = [];
  globalThis.document = {
    addEventListener() {},
    querySelector(selector) {
      const match = /data-mode="([^"]+)"/.exec(selector);
      return match ? { click: () => modeClicks.push(match[1]) } : null;
    },
  };
  let deletes = 0;
  let explosions = 0;
  const selectionModes = [];
  let moveModes = 0;
  const slots = [];
  let designerOpens = 0;
  const input = {
    keysDown: new Set(),
    activeTool: null,
    game: {
      _designPlacer: null,
      _designer: {
        isOpen: false,
        openDesign: () => { designerOpens++; },
        openFromSource: () => { designerOpens++; },
      },
      state: { designerState: null },
    },
    _toolConsumed: () => false,
    _deleteSelectedFromKeyboard: () => { deletes++; return true; },
    _toggleContextDemolish() {},
    _selectionIdsForAnchor: () => [],
    _toggleSelectionActionMode: mode => selectionModes.push(mode),
    _beginSelectedMove: () => false,
    _toggleMoveMode: () => { moveModes++; },
    _explodeSelectedFromKeyboard: () => { explosions++; return false; },
    handleDisconnectSelectedUtilitiesKey: () => false,
    _saveSelectionSlot: slot => slots.push(`save:${slot}`),
    _recallSelectionSlot: slot => slots.push(`recall:${slot}`),
  };
  InputHandler.prototype._bindKeyboard.call(input);
  const keydown = listeners.keydown[0];
  const event = (key, opts = {}) => ({
    key, target: { tagName: 'BODY' },
    ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    code: opts.code || '', repeat: false,
    ...opts,
    preventDefault() {},
  });
  keydown(event('Delete'));
  keydown(event('Backspace'));
  keydown(event('d'));
  keydown(event('c'));
  keydown(event('m'));
  keydown(event('p'));
  keydown(event('6'));
  keydown(event('1', { code: 'Digit1', ctrlKey: true }));
  keydown(event('!', { code: 'Digit1', shiftKey: true }));
  keydown(event('t'));
  keydown(event('T'));
  assertOk(deletes === 1, 'Delete uses contextual selection deletion');
  assertOk(explosions === 1, 'Backspace triggers the selected explosion command');
  assertOk(input.keysDown.has('d'), 'D remains the camera pan-right key');
  assertOk(selectionModes.join(',') === 'copy,mirror',
    'C and M enter click-to-target modes when nothing is selected');
  assertOk(moveModes === 1, 'P enters click-to-move mode when nothing is selected');
  const selectedActions = [];
  input.selectedPlaceableId = 'selected';
  input._selectionIdsForAnchor = () => ['selected'];
  input._beginSelectedCopy = id => { selectedActions.push(`copy:${id}`); return true; };
  input._beginSelectedMirror = id => { selectedActions.push(`mirror:${id}`); return true; };
  input._beginSelectedMove = () => { selectedActions.push('move:selected'); return true; };
  input._explodeSelectedFromKeyboard = () => {
    selectedActions.push('explode:selected');
    return true;
  };
  keydown(event('c'));
  keydown(event('m'));
  keydown(event('p'));
  keydown(event('Backspace'));
  assertOk(selectedActions.join(',')
      === 'copy:selected,mirror:selected,move:selected,explode:selected',
  'C, M, P, and Backspace act immediately on the current selection');
  assertOk(modeClicks.join(',') === 'demolish',
    '6 enters the full Demolish build mode through its visible menu button');
  assertOk(slots.join(',') === 'save:1,recall:1',
    'Ctrl+digit saves and Shift+digit recalls the same formation slot');
  assertOk(designerOpens === 0,
    'T never opens the Beamline Designer when no utility disconnect is available');
  if (priorWindow === undefined) delete globalThis.window;
  else globalThis.window = priorWindow;
  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
}

{
  const actions = [];
  const input = {
    selectedPlaceableId: null,
    _selectPlaceableAt(_world, _grid, _x, _y, options) {
      actions.push(`pick:${options.refillReservoir}:${options.openInspector}`);
      this.selectedPlaceableId = 'picked';
      return true;
    },
    _beginSelectedCopy: id => actions.push(`copy:${id}`),
    _beginSelectedMirror: id => actions.push(`mirror:${id}`),
    _showToast() {},
  };
  const ctx = {
    input,
    renderer: {
      screenToWorld: () => ({ x: 0, y: 0 }),
      updateHover() {},
    },
  };
  new SelectionActionTool('copy').onClick({ clientX: 10, clientY: 20 }, ctx);
  new SelectionActionTool('mirror').onClick({ clientX: 10, clientY: 20 }, ctx);
  assertOk(actions.join(',')
      === 'pick:false:false,copy:picked,pick:false:false,mirror:picked',
  'click-to-copy and click-to-mirror select without opening an inspector or refilling storage');

  let opened = 0;
  const selectionInput = {
    selectedPlaceableId: null,
    selectedPlaceableIds: new Set(),
    selectedNodeId: null,
    _selectedRootsById: new Map(),
    _selectionCandidatesByKey: new Map(),
    _renderSelectionOutlines() {},
    _openPlaceableInfoWindow() { opened++; },
    renderer: { refreshContextWindows() {} },
  };
  const entry = { id: 'copy-source', type: 'desk', category: 'facility' };
  InputHandler.prototype._selectPlaceable.call(
    selectionInput, entry, null, { openInspector: false },
  );
  assertOk(opened === 0,
    'the source-selection path honors copy mode and leaves the object window closed');
  InputHandler.prototype._selectPlaceable.call(selectionInput, entry);
  assertOk(opened === 1,
    'ordinary selection still opens the object window');
}

{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assertOk(/data-mode="demolish"><span class="mode-hotkey">6<\/span>Demolish/.test(html)
      && !/data-mode="demolish"><span class="mode-hotkey">D<\/span>/.test(html),
    'the bottom build menu advertises 6, not D, for Demolish');
}

console.log('\n=== 4. Shift+drag decoration line rebuilds decorations once ===\n');

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

console.log('\n=== 5. Preview lifecycle: arming, variants, post-commit refresh ===\n');

// InputHandler needs a DOM to construct, so drive its prototype methods on a
// record carrying only the members the preview paths touch — the same trick
// the line-place case above uses, plus the tool-arming plumbing.
function makeRenderer() {
  return {
    canvas: { style: {} },
    ghosts: [],                 // every renderPlaceableGhost call: { hover, ok }
    lastWorld: { x: 0, y: 0 },  // what screenToWorld reports
    hoverCol: -1, hoverRow: -1,
    _clearPreview() {},
    clearDragPreview() {},
    hidePopup() {},
    setBuildMode() {},
    updatePlacementDir() {},
    updateHover(col, row) { this.hoverCol = col; this.hoverRow = row; },
    screenToWorld() { return { x: this.lastWorld.x, y: this.lastWorld.y }; },
    renderPlaceableGhost(hover, ok) { this.ghosts.push({ hover: { ...hover }, ok }); },
    renderPlaceableGhosts() {},
  };
}

function makeInput(game, renderer) {
  const input = {
    game, renderer,
    activeTool: null,
    hoverPlaceable: null,
    selectedNodeId: null,
    selectedPlaceableVariant: 0,
    selectedParamOverrides: null,
    placementDir: 0,
    paletteIndex: 0,
    lastMouseWorldX: null,
    lastMouseWorldY: null,
    isLinePlacingDecoration: false,
    beamlineController: { onHover() {}, reset() {}, clearHover() {}, _placementHover: null },
    get armedPlaceableId() { return this.activeTool?.armedPlaceableId ?? null; },
    _hideTooltip() {}, _updateShiftHint() {}, _showToast() {}, _hidePreview() {},
    _checkHoverTooltip() {}, _showPreviewForFocusedItem() {},
  };
  for (const m of [
    'setTool', 'clearTool', '_repaintArmedPreview', '_updatePlaceablePreview',
    '_commitHoverPlaceable', 'selectPaletteTool', 'selectComponentTool',
    '_applyPaletteFocus', '_recallPaletteVariant',
  ]) {
    input[m] = InputHandler.prototype[m];
  }
  input._toolCtx = { game, renderer, input };
  return input;
}

function fakeItem(kind, key) {
  return {
    dataset: { paletteKind: kind, paletteKey: key },
    classList: { add() {}, remove() {} },
    scrollIntoView() {},
  };
}

// Drive the armed tool's real mousemove over a tile center; returns the ghost
// it painted (or undefined). Also establishes lastMouseWorldX/Y, which is what
// the keyboard-arming repaint reads.
function hoverTile(input, renderer, col, row) {
  const iso = tileCenterIso(col, row);
  renderer.lastWorld = { x: iso.x, y: iso.y };
  renderer.ghosts.length = 0;
  input.activeTool.onMouseMove({ clientX: 100, clientY: 100 }, input._toolCtx);
  return renderer.ghosts[renderer.ghosts.length - 1];
}

{
  const g = makeGame(46);
  const renderer = makeRenderer();
  const input = makeInput(g, renderer);

  // Find a tile where a flower bed is actually placeable (generated scenery
  // occupies plenty of them).
  input.selectPaletteTool('decoration', 'flowerBed', 0);
  let spot = null;
  for (let row = 2; row < 40 && !spot; row++) {
    for (let col = 2; col < 40 && !spot; col++) {
      const ghost = hoverTile(input, renderer, col, row);
      if (ghost && ghost.ok) spot = { col, row };
    }
  }
  assertOk(spot, 'setup: found a tile where the flower bed ghost is valid');

  // --- keyboard arming paints a ghost with no mousemove ---
  // The cursor last moved during the scan above; arrow-key/hotkey palette
  // navigation goes through _applyPaletteFocus and never produces a mousemove,
  // so the repaint has to come from the arm itself.
  localStorage.setItem('bt_lastVariantByKey', JSON.stringify({ largeFlowerBed: 2 }));
  const items = [fakeItem('decoration', 'flowerBed'), fakeItem('decoration', 'largeFlowerBed')];
  input.paletteIndex = 1;
  renderer.ghosts.length = 0;
  input._applyPaletteFocus(items);

  assertOk(renderer.ghosts.length === 1,
    `arming by palette focus painted exactly one ghost (got ${renderer.ghosts.length})`);
  assertOk(input.hoverPlaceable?.id === 'largeFlowerBed',
    'the ghost is the newly armed item');
  assertOk(input.selectedPlaceableVariant === 2 && renderer.ghosts[0]?.hover.variant === 2,
    'palette focus kept the remembered variant instead of resetting it to 0');

  // --- variant does not leak between families ---
  input.selectPaletteTool('decoration', 'flowerBed', 4);
  assertOk(input.selectedPlaceableVariant === 4, 'the decoration armed its own variant');
  input.selectPaletteTool('facility', 'labBench');
  assertOk(input.selectedPlaceableVariant === 0,
    `arming a facility item reset the variant (got ${input.selectedPlaceableVariant})`);
  input.selectPaletteTool('decoration', 'flowerBed', 5);
  input.selectPaletteTool('component', 'drift');
  assertOk(input.selectedPlaceableVariant === 0,
    `arming a beamline component reset the variant (got ${input.selectedPlaceableVariant})`);

  // --- committing re-previews so the ghost stops reading as valid ---
  input.selectPaletteTool('decoration', 'flowerBed', 0);
  const before = hoverTile(input, renderer, spot.col, spot.row);
  assertOk(before && before.ok, 'the ghost is valid before the click');
  const countBefore = g.state.placeables.length;
  renderer.ghosts.length = 0;
  const consumed = input._commitHoverPlaceable(100, 100);
  assertOk(consumed && g.state.placeables.length === countBefore + 1,
    'the click placed the flower bed');
  const after = renderer.ghosts[renderer.ghosts.length - 1];
  assertOk(after && !after.ok,
    'the ghost re-previewed as blocked on the tile the click just filled');
}

console.log('\n=== 6. Demolishing an object does not tear up the ground under it ===\n');

// The catch-all Demolish tool always started a tile-rect drag on mouse-down, so
// a plain CLICK committed as a 1x1 sweep and levelled the tile: deleting a
// bench also removed the floor it stood on, the zone it was in and any walls on
// that tile's edges. The hover preview had been outlining the OBJECT the whole
// time, so what the tool promised and what it did were different things.
{
  const g = makeGame(77);
  g.placeInfraTile(6, 6, 'concrete');
  assertOk(g.state.infraOccupied['6,6'] === 'concrete', 'setup: a floor tile to protect');
  g.placePlaceable({ type: 'oscilloscope', col: 6, row: 6, subCol: 0, subRow: 0, free: true });
  const item = g.state.placeables.find(p => p.type === 'oscilloscope');
  assertOk(!!item, 'setup: an object standing on it');

  // The tool asks InputHandler what is under the cursor; stub that, since the
  // pick itself is a raycast and this is about what the tool DOES with it.
  const input = {
    _findDeletablePlaceable: () => ({ kind: 'equipment', id: item.id, entry: item }),
    _demolishEverythingAt: () => { throw new Error('levelled the tile on an object click'); },
  };
  const ctx = {
    game: g, input,
    renderer: { screenToWorld: () => tileCenterIso(6, 6), clearDragPreview() {} },
  };
  const tool = new DemolishTool('demolishAll');
  tool.onMouseDown({ button: 0, clientX: 10, clientY: 10 }, ctx);
  tool.onMouseUp({ button: 0, clientX: 10, clientY: 10 }, ctx);

  assertOk(!g.state.placeables.some(p => p.id === item.id), 'the object was demolished');
  assertOk(g.state.infraOccupied['6,6'] === 'concrete', 'and the floor under it survived');
}

{
  // Clicking bare ground still levels the tile — that is the tool's other half,
  // and the only way to pull up flooring with it.
  const g = makeGame(78);
  g.placeInfraTile(6, 6, 'concrete');
  let levelled = null;
  const input = {
    _findDeletablePlaceable: () => null,
    _demolishEverythingAt: (c, r) => { levelled = `${c},${r}`; g.removeInfraTile(c, r); },
  };
  const ctx = {
    game: g, input,
    renderer: { screenToWorld: () => tileCenterIso(6, 6), clearDragPreview() {} },
  };
  const tool = new DemolishTool('demolishAll');
  tool.onMouseDown({ button: 0, clientX: 10, clientY: 10 }, ctx);
  tool.onMouseUp({ button: 0, clientX: 10, clientY: 10 }, ctx);

  assertOk(levelled === '6,6', `a click on bare ground levels that tile (got ${levelled})`);
  assertOk(!g.state.infraOccupied['6,6'], 'so the floor does come up');
}

{
  // A rect DRAG is unchanged: sweeping an area is the "level it all" gesture,
  // and it must not stop at the first object it finds.
  const g = makeGame(79);
  const swept = [];
  const input = {
    _findDeletablePlaceable: () => { throw new Error('object pick ran on a rect drag'); },
    _demolishEverythingAt: (c, r) => swept.push(`${c},${r}`),
  };
  const ctx = {
    game: g, input,
    renderer: { screenToWorld: () => ({ x: 0, y: 0 }), clearDragPreview() {} },
  };
  const tool = new DemolishTool('demolishAll');
  tool._dragging = true;
  tool._dragStart = { col: 2, row: 2 };
  tool._dragEnd = { col: 3, row: 3 };
  tool.onMouseUp({ button: 0, clientX: 10, clientY: 10 }, ctx);

  assertOk(swept.length === 4, `the 2x2 drag swept every tile (got ${swept.length})`);
}

console.log('\n=== 7. Utility demolition removes HV support placeables ===\n');

// Utility poles and transmission towers render through the decoration builder,
// but are player-facing Infra objects. The utility demolish shortcut used to
// skip placeable picking entirely, then look only for a cable or bus under the
// cursor, making both supports effectively undeletable from that tool.
for (const [index, type] of ['utilityPole', 'transmissionTower'].entries()) {
  const g = makeGame(100 + index);
  const col = 12 + index * 4;
  const row = 12;
  const id = g.placePlaceable({ type, col, row, subCol: 0, subRow: 0, free: true });
  const entry = g.getPlaceable(id);
  assertOk(!!entry, `setup: placed ${type}`);

  const input = {
    _findDeletablePlaceable: (_world, _grid, _x, _y, policy) => {
      assertOk(policy.allowsPlaceable(entry), `${type} belongs to the Infra demolish scope`);
      return { kind: entry.kind, entry };
    },
  };
  const ctx = {
    game: g,
    input,
    renderer: {
      screenToWorld: () => tileCenterIso(col, row),
      raycastScreen: () => null,
      raycastUtilityLine: () => null,
    },
  };
  new DemolishTool('demolishUtility').onClick(
    { clientX: 10, clientY: 10 }, ctx,
  );
  assertOk(!g.getPlaceable(id), `${type} can be deleted with utility demolition`);
}

console.log('\n=== 8. Demolish beam pipes by the section, not the whole run ===\n');

// The gesture: press anchors a sweep on the 0.5 m sub-unit under the cursor,
// the release removes everything swept. Shift takes the whole run instead.
// _demolishPipeSection is borrowed from the real InputHandler prototype rather
// than stubbed — the section maths is the thing under test, and a stub would
// only prove the tool calls something.
function pipeCtx(g, pipe, shift = false) {
  const input = {
    _shiftDown: shift,
    _suppressNextClick: false,
    _findDeletablePlaceable: () => ({ kind: 'beampipe', pipeId: pipe.id, rootObj: null }),
    _demolishPipeSection: InputHandler.prototype._demolishPipeSection,
  };
  return {
    game: g, input,
    // clientX/clientY carry iso coords directly, so a "screen" position in
    // these tests is just the iso point the cursor is over.
    renderer: { screenToWorld: (x, y) => ({ x, y }), clearDragPreview() {} },
  };
}
// A horizontal run along row 10, tiles 4 → 12: 8 tiles, subL 32.
function sectionPipe(g) {
  const pipe = {
    id: 'bp_sec', start: null, end: null,
    path: [{ col: 4, row: 10 }, { col: 12, row: 10 }],
    subL: 32, placements: [],
  };
  g.state.beamPipes.push(pipe);
  return pipe;
}
// Drive one press → release gesture over two tile centres.
function sweep(tool, ctx, from, to) {
  const a = tileCenterIso(from, 10);
  const b = tileCenterIso(to, 10);
  tool.onMouseDown({ button: 0, clientX: a.x, clientY: a.y }, ctx);
  tool.onMouseUp({ button: 0, clientX: b.x, clientY: b.y }, ctx);
}

{
  const g = makeGame(80);
  const pipe = sectionPipe(g);
  const ctx = pipeCtx(g, pipe);
  const tool = new DemolishTool('demolishBeamline');

  // Press and release on the same tile centre: one 0.5 m sub-unit, mid-run,
  // so the run splits rather than shortening.
  sweep(tool, ctx, 6, 6);

  assertOk(g.state.beamPipes.length === 2,
    `a click mid-run cuts one sub-unit and splits the pipe (got ${g.state.beamPipes.length} pipes)`);
  const total = g.state.beamPipes.reduce((n, p) => n + p.subL, 0);
  assertOk(total === 31, `31 of 32 sub-units survive (got ${total})`);
  assertOk(ctx.input._suppressNextClick === true,
    'the release consumed the gesture so onClick cannot also delete the pipe');
}

{
  const g = makeGame(81);
  const pipe = sectionPipe(g);
  const ctx = pipeCtx(g, pipe);
  const tool = new DemolishTool('demolishBeamline');

  // Drag from tile 6 to tile 8 — sub-units 8..16 inclusive, i.e. [8, 17).
  sweep(tool, ctx, 6, 8);

  assertOk(g.state.beamPipes.length === 2,
    `an interior sweep still splits the run (got ${g.state.beamPipes.length} pipes)`);
  const total = g.state.beamPipes.reduce((n, p) => n + p.subL, 0);
  assertOk(total === 23, `the whole swept stretch went, not just one sub-unit (got ${total}/32)`);
}

{
  const g = makeGame(82);
  const pipe = sectionPipe(g);
  const ctx = pipeCtx(g, pipe, true);  // Shift held
  const tool = new DemolishTool('demolishBeamline');

  sweep(tool, ctx, 6, 6);

  assertOk(g.state.beamPipes.length === 0,
    `Shift takes the whole run (got ${g.state.beamPipes.length} pipes)`);
}

{
  // The hover must not quote a refund the click can't pay: a section overlapping
  // mounted hardware is refused by pipe-splice.js, so it reports blocked and $0.
  const g = makeGame(84);
  const pipe = sectionPipe(g);
  // Occupies sub-units 8..10, i.e. the sub-unit under tile 6's centre.
  pipe.placements = [{ id: 'pl_h', type: 'bpm', position: 8 / 32, subL: 2, params: {} }];
  const input = { _shiftDown: false };
  const at = (col) => InputHandler.prototype._demolishPipeSection.call(
    input, pipe, tileCenterIso(col, 10),
  );

  const over = at(6);
  assertOk(over && over.blocked === true, 'a section under mounted hardware reports blocked');
  assertOk(over.refund === 0, `and quotes no refund (got ${over.refund})`);

  const clear = at(10);
  assertOk(clear && clear.blocked === false, 'bare pipe is not blocked');
  assertOk(clear.refund > 0, `and does quote a refund (got ${clear.refund})`);

  input._shiftDown = true;
  const whole = at(6);
  assertOk(whole.wholePipe && whole.blocked === false,
    'Shift takes the whole run, which is never blocked — it removes its hardware too');
}

{
  // demolishAll is the "level everything here" tool and stays all-or-nothing
  // on pipes: no sweep is anchored, so the ordinary click path handles it.
  const g = makeGame(83);
  const pipe = sectionPipe(g);
  const ctx = pipeCtx(g, pipe);
  const tool = new DemolishTool('demolishAll');

  tool.onMouseDown({ button: 0, clientX: tileCenterIso(6, 10).x, clientY: tileCenterIso(6, 10).y }, ctx);
  assertOk(tool._pipeSweep == null, 'demolishAll anchors no pipe sweep');
  assertOk(g.state.beamPipes.length === 1, 'and the press alone changed nothing');
}

console.log('\n=== 8. Ctrl/Cmd+drag erases along the path the tool would have drawn ===\n');

// Shift EXTENDS a structure gesture; Ctrl inverts it. The tools are driven
// through their handler contract with a stub ctx that records which preview
// family was painted and what the tooltip quoted, so each test can assert both
// the world change AND that the player was shown the erase, not a placement.
//
// Tiles are addressed by iso world position (tileCenterIso) because the tools
// import isoToGrid directly — screenToWorld is the identity here. Edge-based
// tools take their edges from the _getNearest*Edge stubs instead, so those
// tests can pass a bare column as clientX.
function structCtx(g, opts = {}) {
  const seen = { preview: [], tooltip: null };
  const renderer = {
    screenToWorld: (x, y) => ({ x, y }),
    clearDragPreview() {}, updateHover() {},
    renderDragPreview() { seen.preview.push('place-rect'); },
    renderLinePreview(_path, _type, erase) { seen.preview.push(erase ? 'erase-line' : 'place-line'); },
    renderRoofPreview(_region, _def, _profile, erase) {
      seen.preview.push(erase ? 'erase-roof' : 'place-roof');
    },
    renderInfraHoverCursor() { seen.preview.push('place-hover'); },
    renderWallPreview() { seen.preview.push('place-wall'); },
    renderWallEdgeHighlight() { seen.preview.push('place-edge'); },
    renderWallPaintPreview(_col, _row, path) { seen.preview.push(`paint-run:${path.length}`); },
    renderDoorPreview() { seen.preview.push('place-door'); },
    renderWindowPreview() { seen.preview.push('place-window'); },
    renderDemolishPreview() { seen.preview.push('erase-rect'); },
    renderDemolishPathPreview(path) { seen.preview.push(`erase-path:${path.length}`); },
    renderDemolishEdgeOutline() { seen.preview.push('erase-edge'); },
    renderDemolishTileOutline() { seen.preview.push('erase-tile'); },
  };
  const input = {
    _shiftDown: !!opts.shift,
    _ctrlDown: !!opts.ctrl,
    _lastScreenX: null, _lastScreenY: null,
    _showDragCostTooltip() { seen.tooltip = { kind: 'cost' }; },
    _hideDragCostTooltip() {},
    _showDemolishTooltip(name, refund) { seen.tooltip = { kind: 'refund', name, refund }; },
    _hideDemolishTooltip() {},
    _hideTooltip() {}, _setHoverTooltip() {}, clearTool() {},
    _buildLPath: InputHandler.prototype._buildLPath,
    _buildWallLine: InputHandler.prototype._buildWallLine,
    _getNearestEdge: (x, y) => opts.edgeAt?.(x, y),
    _getNearestFloorEdge: (x, y) => opts.edgeAt?.(x, y),
    _getNearestWallEdge: (x, y) => opts.edgeAt?.(x, y),
    _buildSmartFloorWallPath: () => opts.smart,
  };
  return { game: g, renderer, input, seen };
}

// Press → move → release, the shape every drag gesture takes.
function drag(tool, ctx, from, to) {
  tool.onMouseDown({ button: 0, clientX: from.x, clientY: from.y }, ctx);
  tool.onMouseMove({ button: 0, clientX: to.x, clientY: to.y }, ctx);
  tool.onMouseUp({ button: 0, clientX: to.x, clientY: to.y }, ctx);
}

function countInfra(g, c0, r0, c1, r1) {
  let n = 0;
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
    if (g.state.infraOccupied[`${c},${r}`]) n++;
  }
  return n;
}

{
  // FloorTool, drag-placement: Ctrl+drag clears the rect it would have filled.
  const g = makeGame(90);
  g.placeInfraRect(2, 2, 5, 5, 'concrete');
  assertOk(countInfra(g, 2, 2, 5, 5) === 16, 'setup: a 4x4 concrete pad');

  const ctx = structCtx(g, { ctrl: true });
  const tool = new FloorTool('concrete');
  drag(tool, ctx, tileCenterIso(2, 2), tileCenterIso(5, 5));

  assertOk(countInfra(g, 2, 2, 5, 5) === 0, 'Ctrl+drag cleared the whole rect');
  assertOk(ctx.seen.preview.length > 0 && ctx.seen.preview.every(p => p.startsWith('erase')),
    `the drag previewed in demolish red throughout (got ${ctx.seen.preview.join(',')})`);
  // concrete costs 25, so 16 tiles quote 16 x floor(25/2).
  assertOk(ctx.seen.tooltip?.kind === 'refund' && ctx.seen.tooltip.refund === 16 * 12,
    `the tooltip quoted a refund, not a cost (got ${JSON.stringify(ctx.seen.tooltip)})`);

  g.undo();
  assertOk(countInfra(g, 2, 2, 5, 5) === 16, 'one Ctrl+drag is one undo step');
}

{
  // FloorTool, line placement: the L path erases tile by tile, batched into a
  // single renderer event, and a hallway falls back to its concrete foundation
  // exactly as the demolish tool leaves it.
  const g = makeGame(91);
  g.placeInfraRect(4, 4, 8, 8, 'concrete');
  for (let c = 4; c <= 8; c++) g.placeInfraTile(c, 4, 'hallway');
  assertOk(g.state.infraOccupied['6,4'] === 'hallway', 'setup: a 5-tile hallway on concrete');

  const ctx = structCtx(g, { ctrl: true });
  const counts = {};
  g.on((ev) => { counts[ev] = (counts[ev] || 0) + 1; });
  drag(new FloorTool('hallway'), ctx, tileCenterIso(4, 4), tileCenterIso(8, 4));

  let reverted = 0;
  for (let c = 4; c <= 8; c++) if (g.state.infraOccupied[`${c},4`] === 'concrete') reverted++;
  assertOk(reverted === 5, `every hallway tile fell back to its foundation (got ${reverted}/5)`);
  assertOk((counts.infrastructureChanged || 0) === 1,
    `one infrastructureChanged for the whole line (got ${counts.infrastructureChanged || 0})`);
  assertOk(ctx.seen.preview.includes('erase-line') && !ctx.seen.preview.includes('place-line'),
    'the L path previewed in demolish red');
}

{
  // FloorTool, click placement: Ctrl+click erases the tile the click would
  // have laid. The synthesized click record does not carry Ctrl/Cmd (see
  // InputHandler._handleClick), so this has to read _ctrlDown.
  const g = makeGame(92);
  const ctx = structCtx(g);
  const tool = new FloorTool('path');
  const p = tileCenterIso(3, 3);

  tool.onClick({ clientX: p.x, clientY: p.y }, ctx);
  assertOk(g.state.infraOccupied['3,3'] === 'path', 'a plain click still places one tile');

  ctx.input._ctrlDown = true;
  tool.onClick({ clientX: p.x, clientY: p.y }, ctx);
  assertOk(!g.state.infraOccupied['3,3'],
    'Ctrl+click erases it again, reading the modifier from InputHandler._ctrlDown');
}

{
  // Auto Roof is also a click-placement floor tool. Ctrl+click removes the
  // roof over the whole enclosed region and previews that exact roof in red.
  const g = makeGame(921);
  const col = 12, row = 12;
  g.placeInfraTile(col, row, 'concrete');
  for (const edge of ['n', 'e', 's', 'w']) {
    g.placeWall(col, row, edge, 'structuralWall');
  }
  assertOk(g.placeRoofRegion(col, row), 'setup: enclosed room has an auto roof');

  const ctx = structCtx(g, { ctrl: true });
  const tool = new FloorTool('roof');
  const p = tileCenterIso(col, row);
  tool.onMouseMove({ clientX: p.x, clientY: p.y, ctrlKey: true }, ctx);
  assertOk(ctx.seen.preview.at(-1) === 'erase-roof'
    && ctx.seen.tooltip?.kind === 'refund' && ctx.seen.tooltip.refund === 18,
  'Ctrl-hover previews the enclosed roof in red with its refund');

  tool.onClick({ clientX: p.x, clientY: p.y }, ctx);
  assertOk(g.state.roofs.length === 0, 'Ctrl+click removes the auto roof region');
  g.undo();
  assertOk(g.state.roofs.length === 1, 'auto-roof removal is one undo step');
}

{
  // WallTool: the straight run erases, batched into one wall rebuild.
  const g = makeGame(93);
  const RUN = 8;
  for (let c = 4; c < 4 + RUN; c++) g.placeWall(c, 10, 'n', 'officeWall');
  assertOk(g.state.walls.length === RUN, `setup: ${RUN}-segment officeWall run`);

  const ctx = structCtx(g, { ctrl: true, edgeAt: (x) => ({ col: x, row: 10, edge: 'n' }) });
  const counts = {};
  g.on((ev) => { counts[ev] = (counts[ev] || 0) + 1; });
  drag(new WallTool('officeWall'), ctx, { x: 4, y: 0 }, { x: 4 + RUN - 1, y: 0 });

  assertOk(g.state.walls.length === 0, 'Ctrl+drag cleared the whole run');
  assertOk((counts.wallsChanged || 0) === 1,
    `one wallsChanged for the whole run (got ${counts.wallsChanged || 0}, ${RUN} edges)`);
  assertOk(ctx.seen.preview.includes(`erase-path:${RUN}`) && !ctx.seen.preview.includes('place-wall'),
    'the run previewed as a red edge path, never the wall ghost');
  // officeWall costs 15 → floor(15/2) each.
  assertOk(ctx.seen.tooltip?.refund === RUN * 7,
    `the tooltip quoted the run's refund (got ${JSON.stringify(ctx.seen.tooltip)})`);
}

{
  // Walls are refunded PER VARIANT: a Reinforced structuralWall costs 35, so
  // quoting the def's base cost would promise 12 instead of 17.
  const g = makeGame(94);
  g.placeWall(5, 12, 'n', 'structuralWall', 3);
  const ctx = structCtx(g, {
    ctrl: true,
    edgeAt: () => ({ col: 5, row: 12, edge: 'n' }),
    smart: { mode: 'free', path: [] },
  });
  new WallTool('structuralWall').onMouseMove({ button: 0, clientX: 5, clientY: 0 }, ctx);

  assertOk(ctx.seen.preview.at(-1) === 'erase-edge', 'the Ctrl hover outlines the edge in red');
  assertOk(ctx.seen.tooltip?.refund === 17,
    `and prices the variant actually standing there (got ${ctx.seen.tooltip?.refund}, base would be 12)`);
}

{
  // An overlay tool must undo what IT places: peel the copper, leave the host
  // wall standing. removeWall would take both.
  const g = makeGame(95);
  for (let c = 4; c < 8; c++) {
    g.placeWall(c, 14, 'n', 'officeWall');
    g.placeWall(c, 14, 'n', 'copperSheeting');
  }
  assertOk(g.state.wallOverlays.length === 4 && g.state.walls.length === 4,
    'setup: 4 copper-clad office walls');

  const ctx = structCtx(g, { ctrl: true, edgeAt: (x) => ({ col: x, row: 14, edge: 'n' }) });
  drag(new WallTool('copperSheeting'), ctx, { x: 4, y: 0 }, { x: 7, y: 0 });

  assertOk(g.state.wallOverlays.length === 0, 'the copper layer is gone');
  assertOk(g.state.walls.length === 4, 'and the host walls it was clad onto still stand');
  // copperSheeting costs 55 → floor(55/2) each.
  assertOk(ctx.seen.tooltip?.refund === 4 * 27,
    `the quote priced the layer, not the wall (got ${JSON.stringify(ctx.seen.tooltip)})`);
}

{
  // Ctrl+Shift erases the whole smart selection — the same path Shift alone
  // would have filled.
  const g = makeGame(96);
  const boundary = [];
  for (let c = 4; c < 8; c++) boundary.push({ col: c, row: 16, edge: 'n' });
  for (const pt of boundary) g.placeWall(pt.col, pt.row, pt.edge, 'officeWall');

  const ctx = structCtx(g, {
    ctrl: true, shift: true,
    edgeAt: (x) => ({ col: x, row: 16, edge: 'n' }),
    smart: { mode: 'perimeter', floorType: 'concrete', tileCount: 4, path: boundary },
  });
  const tool = new WallTool('officeWall');
  tool.onMouseDown({ button: 0, clientX: 4, clientY: 0 }, ctx);
  tool.onMouseUp({ button: 0, clientX: 4, clientY: 0 }, ctx);

  assertOk(g.state.walls.length === 0, 'Ctrl+Shift cleared the whole boundary selection');
  assertOk(ctx.seen.preview.includes('erase-path:4'),
    'and previewed that selection in demolish red');
}

{
  // DoorTool: the edge run erases the openings and leaves the walls.
  const g = makeGame(97);
  for (let c = 4; c < 8; c++) {
    g.placeWall(c, 18, 'n', 'officeWall');
    g.placeDoor(c, 18, 'n', 'officeDoor');
  }
  assertOk(g.state.doors.length === 4, 'setup: 4 office doors in a wall run');

  const ctx = structCtx(g, {
    ctrl: true, edgeAt: (x) => ({ col: x, row: 18, edge: 'n', frac: 0.25 }),
  });
  drag(new DoorTool('officeDoor'), ctx, { x: 4, y: 0 }, { x: 7, y: 0 });

  assertOk(g.state.doors.length === 0, 'Ctrl+drag cleared the door run');
  assertOk(g.state.walls.length === 4, 'the walls the doors were hung in survive');
  // officeDoor costs 20 → floor(20/2) each.
  assertOk(ctx.seen.tooltip?.refund === 4 * 10,
    `the tooltip quoted the doors' refund (got ${JSON.stringify(ctx.seen.tooltip)})`);
}

{
  // WindowTool: same, and the walls stay glazed-hole-free.
  const g = makeGame(98);
  for (let c = 4; c < 8; c++) {
    g.placeWall(c, 20, 'n', 'officeWall');
    g.placeWindow(c, 20, 'n', 'officeWindow');
  }
  assertOk(g.state.windows.length === 4, 'setup: 4 office windows in a wall run');

  const ctx = structCtx(g, {
    ctrl: true, edgeAt: (x) => ({ col: x, row: 20, edge: 'n', frac: 0.25 }),
  });
  drag(new WindowTool('officeWindow'), ctx, { x: 4, y: 0 }, { x: 7, y: 0 });

  assertOk(g.state.windows.length === 0, 'Ctrl+drag cleared the window run');
  assertOk(g.state.walls.length === 4, 'the walls they were set into survive');
  // officeWindow's variant 0 costs 30 → floor(30/2) each.
  assertOk(ctx.seen.tooltip?.refund === 4 * 15,
    `the tooltip quoted the windows' refund (got ${JSON.stringify(ctx.seen.tooltip)})`);
}

{
  // The modifier can change under a stationary cursor, so onCtrlChange has to
  // repaint without waiting for a mousemove — the Shift hook's mirror.
  const g = makeGame(99);
  g.placeWall(5, 22, 'n', 'officeWall');
  const ctx = structCtx(g, {
    edgeAt: () => ({ col: 5, row: 22, edge: 'n' }),
    smart: { mode: 'free', path: [] },
  });
  ctx.input._lastScreenX = 5;
  ctx.input._lastScreenY = 0;
  const tool = new WallTool('officeWall');

  tool.onCtrlChange(true, ctx);
  assertOk(ctx.seen.preview.at(-1) === 'erase-edge' && ctx.seen.tooltip?.refund === 7,
    'pressing Ctrl flips the parked hover to the red outline + refund');

  tool.onCtrlChange(false, ctx);
  assertOk(ctx.seen.preview.at(-1) === 'place-edge',
    'releasing it restores the placement highlight');
}

{
  // Latched intent: releasing Ctrl halfway through a drag must not turn the
  // rest of the run into a placement.
  const g = makeGame(100);
  for (let c = 4; c < 8; c++) g.placeWall(c, 24, 'n', 'officeWall');
  const ctx = structCtx(g, { ctrl: true, edgeAt: (x) => ({ col: x, row: 24, edge: 'n' }) });
  const tool = new WallTool('officeWall');
  tool.onMouseDown({ button: 0, clientX: 4, clientY: 0 }, ctx);
  ctx.input._ctrlDown = false;              // Ctrl released mid-drag
  tool.onMouseMove({ button: 0, clientX: 7, clientY: 0 }, ctx);
  tool.onMouseUp({ button: 0, clientX: 7, clientY: 0 }, ctx);

  assertOk(g.state.walls.length === 0, 'the gesture kept the intent it was pressed with');
}

{
  // macOS turns a Ctrl+left-click into a right-click (and always fires
  // contextmenu). Both must be withheld from the tool while Ctrl is held:
  // WallTool.onRightClick removes an extra wall and FloorTool.onRightClick
  // disarms the tool, either of which would wreck the erase drag.
  const prevWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  const canvas = { handlers: {}, style: {}, addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); } };
  const dispatched = [];
  const handler = {
    renderer: { app: { canvas }, ui: {} },
    game: {},
    _ctrlDown: false,
    isPanning: false,
    _hideDragCostTooltip() {},
    _deferredUtilityPortDrag: { release() {}, update: () => null, begin() {} },
    _finishMiddleCameraGesture: () => false,
    _finishMarquee: () => false,
    // Real tools consume their own release; returning false here lets the
    // handler fall through to the button-2 routing this test is about.
    _toolConsumed: (name) => { dispatched.push(name); return false; },
    _handleClick: () => { dispatched.push('click'); },
  };
  InputHandler.prototype._bindMouse.call(handler);
  const fire = (type, e) => canvas.handlers[type].forEach(fn => fn(e));
  const menuEvent = (mods) => {
    const rec = { ...mods, prevented: false, stopped: false,
      preventDefault() { rec.prevented = true; }, stopPropagation() { rec.stopped = true; } };
    return rec;
  };

  fire('mouseup', { button: 2, ctrlKey: false, metaKey: false });
  assertOk(dispatched.at(-1) === 'onRightClick', 'a plain right release still reaches the tool');

  dispatched.length = 0;
  fire('mouseup', { button: 2, ctrlKey: true, metaKey: false });
  assertOk(!dispatched.includes('onRightClick'),
    'a Ctrl+left-click arriving as a right release is swallowed, not routed to onRightClick');

  handler._ctrlDown = true;   // Cmd/Ctrl held with no flag on the event itself
  dispatched.length = 0;
  fire('mouseup', { button: 2, ctrlKey: false, metaKey: false });
  assertOk(!dispatched.includes('onRightClick'), 'the tracked modifier state guards it too');

  // ...and the left release that actually ends the drag still commits.
  fire('mouseup', { button: 0, ctrlKey: true, metaKey: false });
  assertOk(dispatched.includes('onMouseUp'), 'the Ctrl drag still completes on its left release');

  const menu = menuEvent({ ctrlKey: true, metaKey: false });
  fire('contextmenu', menu);
  assertOk(menu.prevented && menu.stopped,
    'the contextmenu that macOS fires alongside the Ctrl press is stopped');
  handler._ctrlDown = false;
  const plainMenu = menuEvent({ ctrlKey: false, metaKey: false });
  fire('contextmenu', plainMenu);
  assertOk(plainMenu.prevented && !plainMenu.stopped,
    'an ordinary contextmenu is still only prevented, not stopped');

  globalThis.window = prevWindow;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
