// Mouse-selection category defaults and their selection boundary.

import { InputHandler } from '../src/input/InputHandler.js';
import {
  DEFAULT_MOUSE_SELECTION_CATEGORIES,
  MOUSE_SELECTION_CATEGORY_STORAGE_KEY,
  loadMouseSelectionCategories,
  saveMouseSelectionCategories,
} from '../src/input/selection-preferences.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.error('  FAIL:', message); }
}

console.log('\n=== Mouse selection preferences ===\n');

{
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  const defaults = loadMouseSelectionCategories(storage);
  assert([...defaults].join(',') === DEFAULT_MOUSE_SELECTION_CATEGORIES.join(','),
    'fresh settings select Beamline, Infra, and Facility by default');
  assert(!defaults.has('structure') && !defaults.has('grounds'),
    'fresh settings exclude Structure and Grounds');

  saveMouseSelectionCategories(new Set(['beamline', 'grounds', 'unknown']), storage);
  const restored = loadMouseSelectionCategories(storage);
  assert([...restored].join(',') === 'beamline,grounds',
    'saved category choices persist while unknown categories are discarded');

  saveMouseSelectionCategories(new Set(), storage);
  assert(loadMouseSelectionCategories(storage).size === 0,
    'an intentionally empty category selection survives reload');

  values.set(MOUSE_SELECTION_CATEGORY_STORAGE_KEY, '{broken');
  assert(loadMouseSelectionCategories(storage).has('facility'),
    'malformed persisted settings safely restore the defaults');
}

{
  const candidates = [
    { key: 'beam', selectionCategory: 'beamline', targetKind: 'beamlineAttachment' },
    { key: 'cable', selectionCategory: 'infra', targetKind: 'placeable' },
    { key: 'desk', selectionCategory: 'facility', targetKind: 'placeable' },
    { key: 'floor:1,1', selectionCategory: 'structure', targetKind: 'floor' },
    { key: 'tree', selectionCategory: 'grounds', targetKind: 'placeable' },
  ];
  const byKey = new Map(candidates.map(target => [target.key, target]));
  const input = {
    _marquee: { startX: 0, startY: 0, endX: 80, endY: 80, additive: false, dragging: true },
    _updateMarquee() { return true; },
    _clearMarquee() { this._marquee = null; },
    renderer: {
      selectionTargetsInScreenRect: () => candidates.map(target => ({ target })),
    },
    game: { getPlaceable: () => null },
    selectedNodeId: null,
    selectedPlaceableId: null,
    selectedPlaceableIds: new Set(),
    _selectedRootsById: new Map(),
    _selectionCandidatesByKey: new Map(),
    _mouseSelectionCategories: new Set(DEFAULT_MOUSE_SELECTION_CATEGORIES),
    _selectionTarget: key => byKey.get(key) || null,
    _renderSelectionOutlines() {},
    _reconcileSelectionWindow() {},
    _showToast() {},
  };

  InputHandler.prototype._finishMarquee.call(input, { clientX: 80, clientY: 80 });
  assert([...input.selectedPlaceableIds].join(',') === 'beam,cable,desk',
    'a new drag box activates only the configured categories');
  assert(input._selectionCandidatesByKey.size === 5,
    'excluded drag-box matches remain candidates for the Selection panel');
}

{
  const tree = { id: 'tree', type: 'oakTree', kind: 'decoration', category: 'decoration' };
  let selected = 0;
  const input = {
    _mouseSelectionCategories: new Set(DEFAULT_MOUSE_SELECTION_CATEGORIES),
    renderer: {
      raycastScreen: () => ({}),
      identifyHit: () => ({ nodeId: tree.id, rootObj: {} }),
    },
    game: { getPlaceable: () => tree },
    _selectPlaceable() { selected++; return true; },
  };

  const consumed = InputHandler.prototype._selectPlaceableAt.call(
    input, {}, { col: 0, row: 0 }, 20, 20,
  );
  assert(consumed === true && selected === 0,
    'a direct click consumes but does not select an excluded Grounds object');

  input._mouseSelectionCategories.add('grounds');
  InputHandler.prototype._selectPlaceableAt.call(input, {}, { col: 0, row: 0 }, 20, 20);
  assert(selected === 1,
    'enabling Grounds in options makes direct mouse selection available immediately');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
