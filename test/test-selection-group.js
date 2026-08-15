// Multi-selection group placement: translated footprints, paid copies, stable
// moves, and utility lines whose two endpoints are inside the selection.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { InputHandler } from '../src/input/InputHandler.js';
import { UtilityLineInputController } from '../src/input/UtilityLineInputController.js';
import {
  captureSelectionGroup,
  previewSelectionGroup,
  selectionTargets,
  transformSelectionGroup,
} from '../src/input/selection-group.js';
import { copySelectionGroup, moveSelectionGroup } from '../src/input/selection-commands.js';
import { findUtilityEndpoint } from '../src/utility/utility-endpoints.js';
import { portWorldPosition } from '../src/utility/ports.js';
import { gridToIso } from '../src/renderer/grid.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;
const store = new Map();
globalThis.localStorage = {
  getItem: key => store.get(key) || null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

function portTile(game, placeableId, portName) {
  const endpoint = findUtilityEndpoint(game.state, placeableId);
  const pos = portWorldPosition(endpoint, COMPONENTS[endpoint.type], portName);
  return { col: pos.x / 2, row: pos.z / 2 };
}

function wire(game, start, end) {
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('powerCable');
  const a = gridToIso(start.col, start.row);
  const b = gridToIso(end.col, end.row);
  ctrl.onMouseDown(a.x, a.y, 0, {});
  ctrl.onMouseMove((a.x + b.x) / 2, (a.y + b.y) / 2, {});
  ctrl.onMouseMove(b.x, b.y, {});
  ctrl.onMouseUp(b.x, b.y, 0, {});
}

function fixture(seed) {
  const game = new Game(new BeamlineRegistry(), { seed });
  game.state.resources.funding = 1e9;
  const sourceId = game.placePlaceable({ type: 'mcc', col: 100, row: 100 });
  const sinkId = game.placePlaceable({ type: 'modulator', col: 108, row: 106 });
  wire(
    game,
    portTile(game, sourceId, 'pwr_out_1'),
    portTile(game, sinkId, 'pwr_in'),
  );
  const line = [...game.state.utilityLines.values()][0];
  assert(!!sourceId && !!sinkId && !!line, 'fixture placed and wired two selectable objects');
  return { game, sourceId, sinkId, line };
}

console.log('\n=== Selection groups ===\n');

{
  const payload = {
    anchor: { col: 0, row: 0, subCol: 1, subRow: 1 },
    items: [{ id: 'a', col: 0, row: 0, subCol: 1, subRow: 1 }],
  };
  const [target] = selectionTargets(payload, { col: -2, row: -3, subCol: 3, subRow: 2 });
  assert(target.col === -2 && target.subCol === 3 && target.row === -3 && target.subRow === 2,
    'subtile translation normalizes correctly across negative tile coordinates');
}

{
  const { game, sourceId, sinkId } = fixture(550);
  const captured = captureSelectionGroup(game, [sourceId, sinkId], {
    operation: 'copy', primaryId: sourceId,
  });
  const rotated = transformSelectionGroup(captured.payload, { quarterTurns: 1 });
  const mirrored = transformSelectionGroup(captured.payload, { mirror: true });
  assert(rotated.items.every((item, index) => item.dir === (captured.payload.items[index].dir + 1) % 4),
    'rotating a formation turns every item orientation');
  assert(rotated.connections.length === 1
      && rotated.connections[0].path[0].col !== captured.payload.connections[0].path[0].col,
  'rotation transforms the internal utility path with the items');
  assert(mirrored.connections.length === 1
      && mirrored.connections[0].path[0].col !== captured.payload.connections[0].path[0].col,
  'mirroring reflects the internal utility path with the items');
  for (const transformed of [rotated, mirrored]) {
    const preview = previewSelectionGroup(game, transformed, {
      ...transformed.anchor,
      col: transformed.anchor.col + 30,
      row: transformed.anchor.row + 30,
    });
    assert(preview.ok && preview.connections.length === 1,
      'a transformed formation and its cable validate at a clear destination');
  }
  const fourTurns = [0, 1, 2, 3].reduce(
    payload => transformSelectionGroup(payload, { quarterTurns: 1 }),
    captured.payload,
  );
  const twoMirrors = transformSelectionGroup(
    transformSelectionGroup(captured.payload, { mirror: true }),
    { mirror: true },
  );
  assert(JSON.stringify(fourTurns.items) === JSON.stringify(captured.payload.items),
    'four rotations return every item to its exact subtile and direction');
  assert(JSON.stringify(twoMirrors.items) === JSON.stringify(captured.payload.items),
    'mirroring twice returns every item exactly');
}

{
  const { game, sourceId, sinkId, line } = fixture(551);
  const countBefore = game.state.placeables.length;
  const fundingBefore = game.state.resources.funding;
  const captured = captureSelectionGroup(game, [sourceId, sinkId], {
    operation: 'copy', primaryId: sinkId,
  });
  assert(captured.ok && captured.payload.connections.length === 1,
    'capture includes the utility line internal to the selection');

  const anchor = captured.payload.anchor;
  const preview = previewSelectionGroup(game, captured.payload, {
    ...anchor, col: anchor.col + 20, row: anchor.row + 12,
  });
  assert(preview.ok && preview.targets.length === 2 && preview.connections.length === 1,
    'a clear destination previews the full copied formation and connection');
  assert((preview.lineCost.funding || 0) > 0,
    'copy preview prices the duplicated utility line');

  const copied = copySelectionGroup(game, captured.payload, preview);
  assert(copied.ok === true && game.state.placeables.length === countBefore + 2,
    'copy commit creates both objects in one operation');
  assert(game.state.utilityLines.size === 2, 'copy commit creates the internal utility line');
  const copiedLine = [...game.state.utilityLines.values()].find(candidate => candidate.id !== line.id);
  const newIds = new Set(game.state.placeables.slice(-2).map(entry => entry.id));
  assert(newIds.has(copiedLine.start.placeableId) && newIds.has(copiedLine.end.placeableId),
    'copied line endpoints reference the copied object ids');
  assert(![copiedLine.start.placeableId, copiedLine.end.placeableId].includes(sourceId)
      && ![copiedLine.start.placeableId, copiedLine.end.placeableId].includes(sinkId),
    'copied line does not remain attached to either original');
  assert(copiedLine.cablePath?.length === line.cablePath?.length
      && copiedLine.cablePath[0].col === line.cablePath[0].col + 20
      && copiedLine.cablePath[0].row === line.cablePath[0].row + 12,
    'copied line preserves and translates its freeform cable trace');
  assert(game.state.resources.funding < fundingBefore,
    'copy charges for objects and copied utility length');
  game.undo();
  assert(game.state.placeables.length === countBefore && game.state.utilityLines.size === 1,
    'one undo removes the copied formation and its utility line together');
}


{
  const selectedFrames = [];
  const closedWindows = [];
  const entries = {
    a: { id: 'a', type: 'labBench', kind: 'equipment', category: 'equipment' },
    b: { id: 'b', type: 'controlConsole', kind: 'equipment', category: 'equipment' },
    old: { id: 'old', type: 'flowerBed', kind: 'decoration', category: 'decoration' },
  };
  const input = {
    _marquee: { startX: 10, startY: 20, endX: 100, endY: 120, additive: false, dragging: true },
    _updateMarquee() { return true; },
    _clearMarquee() { this._marquee = null; },
    renderer: {
      placeablesInScreenRect: () => [
        { entry: entries.a, rootObj: { name: 'root-a' } },
        { entry: entries.b, rootObj: { name: 'root-b' } },
      ],
      setSelectionOutlines: roots => selectedFrames.push(roots.slice()),
      openEquipmentWindow() {},
      closePlaceableInfoWindow: entry => closedWindows.push(entry.id),
      refreshContextWindows() {},
    },
    game: { getPlaceable: id => entries[id] || null },
    selectedNodeId: null,
    selectedPlaceableId: null,
    selectedPlaceableIds: new Set(['old']),
    _selectedRootsById: new Map(),
    _renderSelectionOutlines: InputHandler.prototype._renderSelectionOutlines,
    _showToast() {},
  };
  const consumed = InputHandler.prototype._finishMarquee.call(input, { clientX: 100, clientY: 120 });
  assert(consumed && input.selectedPlaceableIds.size === 2,
    'a dragged screen marquee selects every matching movable placeable');
  assert(input.selectedPlaceableId === 'b' && selectedFrames.at(-1).length === 2,
    'marquee selection establishes one primary item and outlines the whole group');
  assert(closedWindows.includes('old') && closedWindows.includes('a')
      && !closedWindows.includes('b'),
  'marquee leaves one group panel instead of stale per-item windows');
}

{
  const { game, sourceId, sinkId } = fixture(553);
  let persisted = 0;
  let recalled = null;
  const input = {
    game,
    selectedPlaceableId: sinkId,
    selectedPlaceableIds: new Set([sourceId, sinkId]),
    _selectionSlots: {},
    _selectionIdsForAnchor: InputHandler.prototype._selectionIdsForAnchor,
    _captureSelectedCopy: InputHandler.prototype._captureSelectedCopy,
    _cloneSelectionPayload: InputHandler.prototype._cloneSelectionPayload,
    _persistSelectionSlots() { persisted++; },
    _showToast() {},
    _armSelectionPayload(payload) { recalled = payload; return true; },
  };
  const saved = InputHandler.prototype._saveSelectionSlot.call(input, '1');
  const savedCol = input._selectionSlots['1'].items[0].col;
  game.getPlaceable(sourceId).col += 50;
  const recalledOk = InputHandler.prototype._recallSelectionSlot.call(input, '1');
  assert(saved && persisted === 1 && input._selectionSlots['1'].items.length === 2,
    'Ctrl+digit stores the full selected formation and persists the slot');
  assert(recalledOk && recalled.operation === 'copy' && recalled.items[0].col === savedCol,
    'Shift+digit recalls an immutable copy even after the originals move');
}

{
  const { game, sourceId, sinkId } = fixture(554);
  const closedWindows = [];
  let armed = null;
  const input = {
    game,
    renderer: {
      closePlaceableInfoWindow: entry => closedWindows.push(entry.id),
    },
    selectedPlaceableId: sinkId,
    selectedPlaceableIds: new Set([sourceId, sinkId]),
    _selectionIdsForAnchor: InputHandler.prototype._selectionIdsForAnchor,
    _showToast() {},
    _armSelectionPayload(payload) { armed = payload; return true; },
  };
  const moved = InputHandler.prototype._beginSelectionPlacement.call(input, 'move', sinkId);
  assert(moved && armed?.operation === 'move', 'Move selection arms the captured group');
  assert(closedWindows.length === 2
      && closedWindows.includes(sourceId) && closedWindows.includes(sinkId),
    'Move selection closes every selected object info window');

  closedWindows.length = 0;
  const copied = InputHandler.prototype._beginSelectionPlacement.call(input, 'copy', sinkId);
  assert(copied && closedWindows.length === 0,
    'Copy selection leaves selected object info windows open');
}

{
  const hint = InputHandler.prototype._placementKeyHintText.call({
    game: { _designPlacer: null },
    activeTool: { kind: 'move', payload: { kind: 'selectionGroup' } },
    armedPlaceableId: null,
  });
  assert(hint.includes('F') && hint.includes('Rotate') && hint.includes('M') && hint.includes('Mirror'),
    'group placement exposes rotate and mirror keys in the cursor hint');
}

{
  const { game, sourceId, sinkId, line } = fixture(552);
  const originalPath = line.path.map(point => ({ ...point }));
  const originalCablePath = line.cablePath.map(point => ({ ...point }));
  const captured = captureSelectionGroup(game, [sourceId, sinkId], {
    operation: 'move', primaryId: sourceId,
  });
  const anchor = captured.payload.anchor;
  const preview = previewSelectionGroup(game, captured.payload, {
    ...anchor, col: anchor.col + 14, row: anchor.row + 9,
  });
  assert(preview.ok, 'connected group move previews at a clear destination');
  const moved = moveSelectionGroup(game, captured.payload, preview);
  assert(moved.ok === true, 'connected group move commits');
  assert(game.getPlaceable(sourceId).col === 114 && game.getPlaceable(sourceId).row === 109,
    'move preserves ids and translates the source object');
  assert(game.getPlaceable(sinkId).col === 122 && game.getPlaceable(sinkId).row === 115,
    'move preserves the formation offset');
  const movedLine = game.state.utilityLines.get(line.id);
  assert(movedLine.start.placeableId === sourceId && movedLine.end.placeableId === sinkId,
    'moved internal line retains both endpoint ids');
  assert(movedLine.path[0].col === originalPath[0].col + 14
      && movedLine.path[0].row === originalPath[0].row + 9,
    'moved internal line path translates rigidly with the group');
  assert(movedLine.cablePath[0].col === originalCablePath[0].col + 14
      && movedLine.cablePath[0].row === originalCablePath[0].row + 9,
    'moved internal line translates its freeform cable trace with the group');
  game.undo();
  assert(game.getPlaceable(sourceId).col === 100 && game.getPlaceable(sourceId).row === 100,
    'one undo restores the moved formation');
  assert(game.state.utilityLines.get(line.id).path[0].col === originalPath[0].col
      && game.state.utilityLines.get(line.id).path[0].row === originalPath[0].row,
    'the same undo restores the internal utility path');
  assert(game.state.utilityLines.get(line.id).cablePath[0].col === originalCablePath[0].col
      && game.state.utilityLines.get(line.id).cablePath[0].row === originalCablePath[0].row,
    'the same undo restores the freeform cable trace');
}

{
  const roots = [];
  const entries = {
    a: { id: 'a', type: 'labBench', kind: 'equipment', category: 'equipment' },
    b: { id: 'b', type: 'labBench', kind: 'equipment', category: 'equipment' },
  };
  const input = {
    game: {
      getPlaceable: id => entries[id] || null,
      emit() {},
    },
    renderer: {
      setSelectionOutlines: selected => roots.push(selected.slice()),
      openEquipmentWindow() {},
      refreshContextWindows() {},
    },
    selectedNodeId: null,
    selectedPlaceableId: null,
    selectedPlaceableIds: new Set(),
    _selectedRootsById: new Map(),
    _renderSelectionOutlines: InputHandler.prototype._renderSelectionOutlines,
  };
  InputHandler.prototype._selectPlaceable.call(input, entries.a, { name: 'root-a' });
  InputHandler.prototype._selectPlaceable.call(input, entries.b, { name: 'root-b' }, { additive: true });
  assert(input.selectedPlaceableIds.size === 2 && roots.at(-1).length === 2,
    'Shift-add selection retains both ids and both outlines');
  InputHandler.prototype._selectPlaceable.call(input, entries.a, { name: 'root-a' }, { additive: true });
  assert(input.selectedPlaceableIds.size === 1 && input.selectedPlaceableId === 'b',
    'Shift-clicking a selected object toggles only that object off');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
