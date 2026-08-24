// Multi-selection group placement: translated footprints, paid copies, stable
// moves, and utility lines whose two endpoints are inside the selection.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { WALL_PAINTS } from '../src/data/structure.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { InputHandler } from '../src/input/InputHandler.js';
import { UtilityLineInputController } from '../src/input/UtilityLineInputController.js';
import {
  captureSelectionGroup,
  previewSelectionGroup,
  selectionEdgeTargets,
  selectionFloorTargets,
  selectionTargets,
  transformSelectionGroup,
} from '../src/input/selection-group.js';
import { copySelectionGroup, moveSelectionGroup } from '../src/input/selection-commands.js';
import { findUtilityEndpoint } from '../src/utility/utility-endpoints.js';
import { portWorldPosition } from '../src/utility/ports.js';
import { gridToIso } from '../src/renderer/grid.js';
import {
  floorSelectionKey,
  physicalEdgeSelectionKey,
} from '../src/game/selection-targets.js';

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
  // Simulate a pre-unified-routing save. New lines do not author cablePath,
  // but selection transforms must remain lossless for legacy freehand data.
  if (line) line.cablePath = line.path.map(point => ({ ...point }));
  assert(!!sourceId && !!sinkId && !!line, 'fixture placed and wired two selectable objects');
  return { game, sourceId, sinkId, line };
}

console.log('\n=== Selection groups ===\n');

{
  const state = {
    placeables: [{
      id: 'plant', type: 'chiller', kind: 'infrastructure', category: 'infrastructure',
      col: 3, row: 4,
    }],
    beamPipes: [{
      id: 'pipe', path: [{ col: 0, row: 0 }, { col: 4, row: 0 }], subL: 16,
      placements: [{ id: 'quad', type: 'quadrupole', position: 0.5, subL: 2 }],
    }],
    floors: [], walls: [], wallOverlays: [], doors: [], windows: [],
  };
  const roots = new Map([
    ['plant', { name: 'plant-root' }],
    ['quad', { name: 'quad-root' }],
  ]);
  const input = Object.create(InputHandler.prototype);
  Object.assign(input, {
    game: {
      state,
      getPlaceable: id => state.placeables.find(entry => entry.id === id) || null,
    },
    renderer: { selectionRootForTarget: target => roots.get(target.id) || null },
    selectedNodeId: null,
    selectedPlaceableId: null,
    selectedPlaceableIds: new Set(),
    _selectedRootsById: new Map(),
    _selectionCandidatesByKey: new Map(),
    _renderSelectionOutlines() {},
  });

  assert(input.selectWorldObject('plant', { openInspector: false })
      && input.selectedPlaceableId === 'plant'
      && input._selectedRootsById.get('plant') === roots.get('plant'),
  'the public selection command selects an ordinary placeable with its live highlight root');
  assert(input.selectWorldObject('quad', { openInspector: false })
      && input.selectedPlaceableId === 'attachment:quad'
      && input._selectedRootsById.get('attachment:quad') === roots.get('quad'),
  'the public selection command resolves a raw utility endpoint id to an on-pipe attachment');
  assert(input.selectWorldObject('unknown', { openInspector: false }) === false,
    'the public selection command rejects stale fault targets safely');
}

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
  const game = new Game(new BeamlineRegistry(), { seed: 559 });
  game.state.resources.funding = 1e9;
  game.placeInfraTile(30, 30, 'concrete');
  game.placeInfraTile(30, 30, 'labFloor');
  game.placeWall(30, 30, 'n', 'officeWall');
  game.paintWallFace(30, 30, 'n', 'leadLining');
  game.placeDoor(30, 30, 'n', 'officeDoor', 1, 2);
  game.placeWall(30, 30, 'e', 'officeWall');
  game.placeWindow(30, 30, 'e', 'officeWindow', 2);

  const keys = [
    floorSelectionKey(30, 30),
    physicalEdgeSelectionKey(30, 30, 'n'),
    physicalEdgeSelectionKey(30, 30, 'e'),
  ];
  const captured = captureSelectionGroup(game, keys, {
    operation: 'copy', primaryId: keys[0],
  });
  assert(captured.ok && captured.payload.items.length === 0
      && captured.payload.floors.length === 1 && captured.payload.edges.length === 2,
  'structure-only capture includes a floor and complete physical edge assemblies');

  const rotated = transformSelectionGroup(captured.payload, { quarterTurns: 1 });
  const rotatedEdges = selectionEdgeTargets(rotated, rotated.anchor);
  assert(rotatedEdges.length === 2
      && rotatedEdges.some(edge => edge.wall.edge === 'e' || edge.wall.edge === 'w'),
  'structure-only formations rotate their physical edges');
  const fourTurns = [0, 1, 2, 3].reduce(
    payload => transformSelectionGroup(payload, { quarterTurns: 1 }),
    captured.payload,
  );
  const twoMirrors = transformSelectionGroup(
    transformSelectionGroup(captured.payload, { mirror: true }),
    { mirror: true },
  );
  assert(JSON.stringify(fourTurns.floors) === JSON.stringify(captured.payload.floors)
      && JSON.stringify(fourTurns.edges) === JSON.stringify(captured.payload.edges),
  'four rotations return structural tiles and edge assemblies exactly');
  assert(JSON.stringify(twoMirrors.floors) === JSON.stringify(captured.payload.floors)
      && JSON.stringify(twoMirrors.edges) === JSON.stringify(captured.payload.edges),
  'mirroring twice returns structural tiles and edge assemblies exactly');

  const destination = { ...captured.payload.anchor, col: 60, row: 60 };
  const preview = previewSelectionGroup(game, captured.payload, destination);
  assert(preview.ok && preview.floorTargets.length === 1 && preview.edgeTargets.length === 2,
    'a structure-only copy previews at a clear tile-aligned destination');
  assert((preview.structureCost.funding || 0) >= WALL_PAINTS.leadLining.cost,
    'structure preview includes floor, wall finish, wall, door, and window costs');
  const copied = copySelectionGroup(game, captured.payload, preview);
  const copiedFloor = selectionFloorTargets(captured.payload, destination)[0];
  assert(copied.ok && game.state.infraOccupied[`${copiedFloor.col},${copiedFloor.row}`] === 'labFloor',
    'structure copy commits the floor and its foundation');
  assert(game.state.walls.length === 4 && game.state.doors.length === 2
      && game.state.windows.length === 2,
  'structure copy commits walls with their door/window openings');
  assert(game.state.walls.some(w => w.col === 60 && w.row === 60
      && w.facePaint?.inside === 'leadLining'),
    'structure copy preserves and pays for a thick wall-face finish');
  game.undo();
  assert(game.state.walls.length === 2 && game.state.doors.length === 1
      && game.state.windows.length === 1,
  'one undo removes the complete copied structure');
}

{
  const game = new Game(new BeamlineRegistry(), { seed: 560 });
  game.state.resources.funding = 1e9;
  const sourceId = game.placePlaceable({ type: 'source', col: 80, row: 80 });
  const captured = captureSelectionGroup(game, [sourceId], { operation: 'copy' });
  assert(captured.ok === false && captured.reason.includes('Deselect Beamline'),
    'beamline candidates stay selectable but must be filtered out before formation copy');
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
    _openPlaceableInfoWindow: InputHandler.prototype._openPlaceableInfoWindow,
    _reconcileSelectionWindow: InputHandler.prototype._reconcileSelectionWindow,
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
  const candidates = [
    {
      key: 'desk', id: 'desk', targetKind: 'placeable', selectionCategory: 'facility',
      entry: { id: 'desk', type: 'officeDesk', kind: 'furnishing' },
    },
    {
      key: 'floor:4,5', targetKind: 'floor', selectionCategory: 'structure',
      col: 4, row: 5, name: 'Lab floor',
    },
    {
      key: 'tree', id: 'tree', targetKind: 'placeable', selectionCategory: 'grounds',
      entry: { id: 'tree', type: 'oakTree', kind: 'decoration' },
    },
  ];
  const outlined = [];
  const anchors = [];
  const input = {
    game: {
      state: { placeables: [], beamPipes: [], floors: [], walls: [] },
      getPlaceable: () => null,
    },
    renderer: {
      setSelectionTargets: targets => outlined.push(targets.map(target => target.key)),
      openSelectionWindow: target => anchors.push(target.key),
      closeSelectionWindow() {},
      closePlaceableInfoWindow() {},
      refreshContextWindows() {},
    },
    selectedNodeId: null,
    selectedPlaceableId: 'tree',
    selectedPlaceableIds: new Set(candidates.map(target => target.key)),
    _selectedRootsById: new Map(),
    _selectionCandidatesByKey: new Map(candidates.map(target => [target.key, target])),
    _selectionTarget: InputHandler.prototype._selectionTarget,
    _selectionTargets: InputHandler.prototype._selectionTargets,
    _renderSelectionOutlines: InputHandler.prototype._renderSelectionOutlines,
    _reconcileSelectionWindow: InputHandler.prototype._reconcileSelectionWindow,
    _toggleSelectionCategory: InputHandler.prototype._toggleSelectionCategory,
  };
  InputHandler.prototype.dispatchSelectionPanelAction.call(input, 'toggleCategory', 'structure');
  assert(!input.selectedPlaceableIds.has('floor:4,5')
      && input.selectedPlaceableIds.has('desk') && input.selectedPlaceableIds.has('tree'),
  'clicking a category excludes only that category from the active selection');

  InputHandler.prototype.dispatchSelectionPanelAction.call(input, 'toggleCategory', 'facility');
  InputHandler.prototype.dispatchSelectionPanelAction.call(input, 'toggleCategory', 'grounds');
  assert(input.selectedPlaceableIds.size === 0 && anchors.at(-1) === 'tree',
    'the category panel remains open when every category is temporarily excluded');

  InputHandler.prototype.dispatchSelectionPanelAction.call(input, 'toggleCategory', 'structure');
  assert(input.selectedPlaceableIds.size === 1
      && input.selectedPlaceableIds.has('floor:4,5')
      && outlined.at(-1).join(',') === 'floor:4,5',
  'an excluded category can be re-enabled without drawing a new marquee');

  input._selectionClipboard = { items: [], floors: [{}], edges: [{}] };
  input._selectionSlots = { 3: { items: [{}], floors: [], edges: [] } };
  const panelState = InputHandler.prototype.selectionPanelState.call(input);
  assert(panelState.candidates.length === 3 && panelState.entries.length === 1
      && panelState.clipboardCount === 2 && panelState.slots[3] === 1,
  'the public selection-panel model exposes candidates, active entries, and saved counts');
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
  const targets = [
    { key: 'beam', targetKind: 'beamlineAttachment', selectionCategory: 'beamline' },
    { key: 'panel', targetKind: 'placeable', selectionCategory: 'infra' },
    { key: 'wall', targetKind: 'edge', selectionCategory: 'structure' },
  ];
  const input = {
    selectedPlaceableId: 'beam',
    _selectionTargets: () => targets,
  };
  const copy = InputHandler.prototype._selectionIdsForPanelAction.call(input, 'copy');
  const move = InputHandler.prototype._selectionIdsForPanelAction.call(input, 'move');
  assert(copy.ids.join(',') === 'panel,wall' && copy.anchorId === 'wall',
    'panel copy excludes beamline hardware and chooses a compatible anchor');
  assert(move.ids.join(',') === 'panel' && move.anchorId === 'panel',
    'panel move and transforms exclude both beamline hardware and building fabric');

  const calls = [];
  input._selectionIdsForPanelAction = InputHandler.prototype._selectionIdsForPanelAction;
  input._beginSelectionPlacement = (operation, anchorId, ids) => {
    calls.push([operation, anchorId, ids]);
    return true;
  };
  InputHandler.prototype.dispatchSelectionPanelAction.call(input, 'copy');
  InputHandler.prototype.dispatchSelectionPanelAction.call(input, 'move');
  assert(calls[0][0] === 'copy' && calls[0][1] === 'wall'
      && calls[0][2].join(',') === 'panel,wall',
  'the public panel copy command immediately places only its compatible subset');
  assert(calls[1][0] === 'move' && calls[1][1] === 'panel'
      && calls[1][2].join(',') === 'panel',
  'the public panel move command forwards only movable placeables');
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
  const openedWindows = [];
  const closedWindows = [];
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
      openPlaceableInfoPopup: entry => openedWindows.push(entry.id),
      closePlaceableInfoWindow: entry => closedWindows.push(entry.id),
      refreshContextWindows() {},
    },
    selectedNodeId: null,
    selectedPlaceableId: null,
    selectedPlaceableIds: new Set(),
    _selectedRootsById: new Map(),
    _renderSelectionOutlines: InputHandler.prototype._renderSelectionOutlines,
    _openPlaceableInfoWindow: InputHandler.prototype._openPlaceableInfoWindow,
    _reconcileSelectionWindow: InputHandler.prototype._reconcileSelectionWindow,
  };
  InputHandler.prototype._selectPlaceable.call(input, entries.a, { name: 'root-a' });
  InputHandler.prototype._selectPlaceable.call(input, entries.b, { name: 'root-b' }, { additive: true });
  assert(input.selectedPlaceableIds.size === 2 && roots.at(-1).length === 2,
    'Shift-add selection retains both ids and both outlines');
  assert(openedWindows.join(',') === 'a,b' && closedWindows.join(',') === 'a',
    'Shift-add replaces the first item window with one group window');
  InputHandler.prototype._selectPlaceable.call(input, entries.b, { name: 'root-b' }, { additive: true });
  assert(input.selectedPlaceableIds.size === 1 && input.selectedPlaceableId === 'a',
    'Shift-clicking the primary object toggles only that object off');
  assert(closedWindows.at(-1) === 'b' && openedWindows.at(-1) === 'a',
    'removing the primary moves the single window to the remaining selection');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
