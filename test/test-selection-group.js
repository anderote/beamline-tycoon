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
} from '../src/input/selection-group.js';
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

function inputFacade(game) {
  return {
    game,
    _showToast() {},
    _copySelectionGroup: InputHandler.prototype._copySelectionGroup,
    _moveSelectionGroup: InputHandler.prototype._moveSelectionGroup,
  };
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

  const copied = inputFacade(game)._copySelectionGroup(captured.payload, preview);
  assert(copied === true && game.state.placeables.length === countBefore + 2,
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
  const moved = inputFacade(game)._moveSelectionGroup(captured.payload, preview);
  assert(moved === true, 'connected group move commits');
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
      _openEquipmentWindow() {},
      _refreshContextWindows() {},
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
