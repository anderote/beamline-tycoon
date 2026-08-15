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
//   3. P on a selected item closes its info window before entering move mode.
//   3b. Delete/Backspace removes ordinary selections while beamlines remain
//       protected and D keeps its camera-pan binding.
//   4. Shift-drag decoration line placement emits one rebuild event.
//   5. Preview lifecycle around arming and committing: a keyboard-armed tool
//      must show its ghost before the mouse moves, the variant must not
//      survive an arm into another family, and a commit must re-preview so
//      the ghost stops claiming a tile it just filled.
//   7. Beam pipes demolish by the SECTION, not all-or-nothing: a press
//      anchors a sweep at the 0.5 m sub-unit under the cursor, the release
//      removes exactly what was swept (splitting the run on an interior cut),
//      Shift still takes the whole pipe, and demolishAll opts out entirely.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { DemolishTool } from '../src/input/demolish-tool.js';
import { MoveTool } from '../src/input/mode-tools.js';
import { InputHandler } from '../src/input/InputHandler.js';
import { BeamlineWindow } from '../src/ui/BeamlineWindow.js';
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

console.log('\n=== 3. P-selected move closes the item info window ===\n');

{
  const entry = { id: 'selected_1', type: 'flowerBed', category: 'grounds', dir: 2 };
  let closed = null;
  const input = {
    selectedPlaceableId: entry.id,
    game: { getPlaceable: (id) => id === entry.id ? entry : null },
    renderer: {
      canvas: { style: {} },
      _closePlaceableInfoWindow: (target) => { closed = target; },
    },
    setTool(tool) { this.activeTool = tool; },
    _armMovePreview() {},
    _showToast() {},
  };
  const began = InputHandler.prototype._beginSelectedMove.call(input);
  assertOk(began && input.activeTool?.kind === 'move', 'P-selected path enters move mode');
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
      _closePlaceableInfoWindow: entry => { closedId = entry.id; },
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
    renderer: { _closePlaceableInfoWindow: () => { closed = true; } },
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
  globalThis.document = { addEventListener() {} };
  let deletes = 0;
  const input = {
    keysDown: new Set(),
    activeTool: null,
    game: { _designPlacer: null },
    _toolConsumed: () => false,
    _deleteSelectedFromKeyboard: () => { deletes++; return true; },
    _toggleContextDemolish() {},
  };
  InputHandler.prototype._bindKeyboard.call(input);
  const keydown = listeners.keydown[0];
  const event = key => ({
    key, target: { tagName: 'BODY' },
    ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    preventDefault() {},
  });
  keydown(event('Delete'));
  keydown(event('Backspace'));
  keydown(event('d'));
  assertOk(deletes === 2, 'Delete and Mac Backspace use selection deletion');
  assertOk(input.keysDown.has('d'), 'D remains the camera pan-right key');
  if (priorWindow === undefined) delete globalThis.window;
  else globalThis.window = priorWindow;
  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
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

console.log('\n=== 7. Demolish beam pipes by the section, not the whole run ===\n');

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
