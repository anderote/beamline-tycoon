// Compact single-item popup routing, safety, and shortcut affordances.

import { InputHandler } from '../src/input/InputHandler.js';
import {
  singleItemPopupActions,
  singleItemPopupActionsHtml,
} from '../src/ui/overlays.js';

let passed = 0;
let failed = 0;

function assert(ok, label) {
  if (ok) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log('\n=== Single-item BLT info popup ===\n');

{
  const actions = singleItemPopupActions({ category: 'infrastructure' });
  assert(actions.map(action => `${action.label}:${action.hotkey}`).join(',')
      === 'Move:P,Copy:C,Delete:Del',
  'every ordinary item exposes Move, Copy, and Delete with the real hotkeys');
  assert(actions.every(action => !action.disabled),
    'ordinary-placeable footer actions are enabled');

  const html = singleItemPopupActionsHtml({ category: 'grounds' });
  assert(html.includes('data-popup-action="move"')
      && html.includes('data-popup-action="copy"')
      && html.includes('data-popup-action="delete"')
      && html.includes('popup-action-hotkey'),
  'the BLT footer renders all commands and visible keycaps');
}

{
  const actions = singleItemPopupActions({ category: 'beamline' });
  assert(actions.find(action => action.id === 'move')?.disabled !== true,
    'single beamline hardware retains its safe Move command');
  assert(actions.find(action => action.id === 'copy')?.disabled === true
      && actions.find(action => action.id === 'copy')?.title.includes('Designer'),
  'beamline Copy stays visible but routes the player to the safe Designer workflow');
  assert(actions.find(action => action.id === 'delete')?.disabled === true,
    'beamline Delete stays visible without bypassing protected deletion');
}

{
  const previous = {
    id: 'old-flower', type: 'flowerBed', kind: 'decoration',
    category: 'grounds', col: 2, row: 3,
  };
  const entry = {
    id: 'new-flower', type: 'flowerBed', kind: 'decoration',
    category: 'grounds', col: 7, row: 8,
  };
  const closed = [];
  let groupClosed = 0;
  let opened = null;
  const input = {
    game: {
      getPlaceable: id => id === previous.id ? previous : id === entry.id ? entry : null,
    },
    renderer: {
      closeSelectionWindow() { groupClosed++; },
      closePlaceableInfoWindow(item) { closed.push(item.id); },
      openPlaceableInfoPopup(item, x, y) { opened = { id: item.id, x, y }; },
      refreshContextWindows() {},
    },
    selectedNodeId: null,
    selectedPlaceableId: previous.id,
    selectedPlaceableIds: new Set([previous.id]),
    _selectedRootsById: new Map(),
    _selectionCandidatesByKey: new Map(),
    _renderSelectionOutlines() {},
  };
  input._openPlaceableInfoWindow = InputHandler.prototype._openPlaceableInfoWindow;

  InputHandler.prototype._selectPlaceable.call(
    input, entry, null, { screenX: 120, screenY: 240 },
  );
  assert(groupClosed === 1 && closed.join(',') === previous.id,
    'a direct single selection retires the multi-selection and stale item windows');
  assert(opened?.id === entry.id && opened.x === 120 && opened.y === 240,
    'the clicked item opens the compact popup beside the click');
}

{
  let opened = null;
  let selected = null;
  const input = {
    game: {
      selectedBeamlineId: null,
      emit(event, id) { selected = `${event}:${id}`; },
    },
    renderer: {
      openPlaceableInfoPopup(entry) { opened = entry.id; },
    },
  };
  const node = { id: 'quad', type: 'quadrupole', category: 'beamline', beamlineId: 'bl-1' };
  InputHandler.prototype._openPlaceableInfoWindow.call(input, node);
  assert(opened === node.id && selected === 'beamlineSelected:bl-1',
    'beamline single clicks open the compact component popup while preserving beamline focus');
}

{
  const attachments = [
    { id: 'quad-on-pipe', type: 'quadrupole', position: 0.25, subL: 2, params: {} },
    {
      id: 'srf-on-pipe', type: 'halfWaveResonator', position: 0.625, subL: 4, params: {},
    },
  ];
  const opened = [];
  let groupOpened = 0;
  const renderer = {
    selectionRootForTarget() { return null; },
    setSelectionTargets() {},
    setSelectedBeamlineFocus() {},
    closeSelectionWindow() {},
    openSelectionWindow() { groupOpened++; },
    openPlaceableInfoPopup(entry) { opened.push(entry); },
    refreshContextWindows() {},
  };
  const game = {
    state: {
      placeables: [],
      beamPipes: [{
        id: 'pipe-1', subL: 8,
        path: [{ col: 1, row: 1 }, { col: 3, row: 1 }],
        placements: attachments,
      }],
      floors: [], walls: [], wallOverlays: [], doors: [], windows: [],
    },
    registry: { getAll: () => [] },
    getComponentHealth: () => 100,
  };
  const input = {
    renderer,
    game,
    selectedNodeId: null,
    selectedPlaceableId: null,
    selectedPlaceableIds: new Set(),
    _selectedRootsById: new Map(),
    _selectionCandidatesByKey: new Map(),
    _renderSelectionOutlines() {},
    _selectLogicalTarget: InputHandler.prototype._selectLogicalTarget,
    _placeableInfoEntryForTarget: InputHandler.prototype._placeableInfoEntryForTarget,
    _openPlaceableInfoWindow: InputHandler.prototype._openPlaceableInfoWindow,
  };

  const selectedQuad = InputHandler.prototype.selectWorldObject.call(input, attachments[0].id);
  const selectedSrf = InputHandler.prototype.selectWorldObject.call(input, attachments[1].id);
  assert(selectedQuad === true && opened[0]?.id === attachments[0].id
      && opened[0]?.category === 'beamline',
  'a direct selection of an on-pipe Quad opens the beamline component inspector');
  assert(selectedSrf === true && opened[1]?.id === attachments[1].id
      && opened[1]?.type === 'halfWaveResonator',
  'a direct selection of an on-pipe half-wave SRF cavity opens the component inspector');
  assert(groupOpened === 0,
    'a single on-pipe component does not open the multi-selection menu');

  const actions = singleItemPopupActions(opened[1]);
  assert(actions.find(action => action.id === 'move')?.disabled === true,
    'the attachment inspector does not offer an unsupported direct Move action');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
