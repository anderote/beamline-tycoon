// Regression coverage for the multi-selection context panel.

import {
  EquipmentWindow,
  equipmentAutoConnectAction,
} from '../src/ui/EquipmentWindow.js';
import { reconcileSelectionWindow } from '../src/input/selection-window.js';
import { COMPONENTS } from '../src/data/components.js';
import {
  SelectionWindow,
  selectionActionAvailability,
  selectionCategoryRows,
} from '../src/ui/SelectionWindow.js';

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

console.log('\n=== Multi-selection window ===\n');

{
  const candidates = [
    { key: 'beam', selectionCategory: 'beamline' },
    { key: 'cable', selectionCategory: 'infra' },
    { key: 'desk', selectionCategory: 'facility' },
    { key: 'wall', selectionCategory: 'structure' },
    { key: 'floor', selectionCategory: 'structure' },
    { key: 'tree', selectionCategory: 'grounds' },
  ];
  const rows = selectionCategoryRows(candidates, new Set(['desk', 'wall', 'floor']));
  assert(rows.map(row => row.label).join(',')
      === 'Beamline,Infra,Facility,Structure,Grounds',
  'category controls use the requested stable order');
  assert(rows.find(row => row.key === 'structure')?.selectedCount === 2
      && rows.find(row => row.key === 'structure')?.enabled === true,
  'category rows count active structural targets');
  assert(rows.find(row => row.key === 'beamline')?.count === 1
      && rows.find(row => row.key === 'beamline')?.enabled === false,
  'an excluded category keeps its candidates available for re-enabling');
}

{
  let actions = [];
  const panel = {
    game: { sandboxMode: false },
    _selected: () => [{
      key: 'edge:1,1,n', targetKind: 'edge', selectionCategory: 'structure',
    }],
    selectionActions: {},
    ctx: { setActions(next) { actions = next; } },
  };
  SelectionWindow.prototype._updateActions.call(panel);
  assert(actions.find(action => action.label === 'Copy')?.disabled === false
      && actions.find(action => action.label === 'Move')?.disabled === true,
  'structure-only selections can be copied but cannot be picked up');

  panel._selected = () => [{
    key: 'source', targetKind: 'placeable', selectionCategory: 'beamline',
  }];
  SelectionWindow.prototype._updateActions.call(panel);
  assert(actions.find(action => action.label === 'Copy')?.disabled === true
      && actions.find(action => action.label === 'Copy')?.title.includes('Designer'),
  'beamline hardware remains selectable while unsafe formation copy is explained');

  panel._selected = () => [
    { key: 'source', targetKind: 'placeable', selectionCategory: 'beamline' },
    { key: 'panel', targetKind: 'placeable', selectionCategory: 'infra' },
    { key: 'wall', targetKind: 'edge', selectionCategory: 'structure' },
  ];
  SelectionWindow.prototype._updateActions.call(panel);
  assert(actions.map(action => action.label).join(',') === 'Copy,Move,Delete'
      && actions.find(action => action.label === 'Copy')?.disabled === false
      && actions.find(action => action.label === 'Move')?.disabled === false,
  'unsupported items no longer disable compatible formation actions');
  const availability = selectionActionAvailability(panel._selected());
  assert(availability.copyableCount === 2 && availability.movableCount === 1
      && availability.hasBeamline === true,
  'action availability separates copyable and movable selection subsets');
}

{
  const entries = new Map([
    ['a', { id: 'a' }],
    ['b', { id: 'b' }],
    ['c', { id: 'c' }],
  ]);
  const closed = [];
  const opened = [];
  let refreshed = 0;
  const primary = reconcileSelectionWindow({
    previousIds: ['a', 'b'],
    selectedIds: ['a', 'b', 'c'],
    primaryId: 'c',
    getPlaceable: id => entries.get(id),
    closeWindow: entry => closed.push(entry.id),
    openWindow: entry => opened.push(entry.id),
    refreshWindows: () => { refreshed++; },
  });
  assert(primary?.id === 'c' && opened.join(',') === 'c',
    'the current primary owns the one selection window');
  assert(closed.join(',') === 'a,b' && refreshed === 1,
    'all other selected item windows close before the group panel refreshes');
}

{
  let actions = [];
  let copied = 0;
  const panel = {
    game: { sandboxMode: false },
    _selected: () => [
      { key: 'a', targetKind: 'placeable', selectionCategory: 'infra' },
      { key: 'b', targetKind: 'placeable', selectionCategory: 'facility' },
    ],
    selectionActions: {
      onCopy: () => { copied++; },
    },
    ctx: { setActions(next) { actions = next; } },
  };
  SelectionWindow.prototype._updateActions.call(panel);
  const labels = actions.map(action => action.label);
  assert(labels.join(',') === 'Copy,Move,Delete',
  'the multi-selection window exposes only the three basic actions');
  actions.find(action => action.label === 'Copy').onClick();
  assert(copied === 1, 'Copy immediately invokes the group-copy action');
}

{
  const priorDocument = globalThis.document;
  const makeNode = () => ({
    dataset: {},
    children: [],
    appendChild(child) { this.children.push(child); },
    addEventListener() {},
    setAttribute() {},
  });
  globalThis.document = { createElement: makeNode };

  const categories = makeNode();
  const selectionContainer = {
    innerHTML: '',
    querySelector(selector) {
      if (selector === '.selection-category-list') return categories;
      return null;
    },
  };
  SelectionWindow.prototype._render.call({
    _candidates: () => [
      { key: 'beam', selectionCategory: 'beamline' },
      { key: 'panel', selectionCategory: 'infra' },
    ],
    _selectedKeys: () => new Set(['beam', 'panel']),
    selectionActions: {},
    refresh() {},
  }, selectionContainer);

  assert(categories.children.length === 2,
    'the compact panel renders only categories present in the selection');
  assert(!selectionContainer.innerHTML.includes('Selected objects')
      && !selectionContainer.innerHTML.includes('selection-panel-list')
      && !selectionContainer.innerHTML.includes('selection-panel-help'),
  'the compact panel omits item inventory and instructional detail');

  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
}

{
  const action = equipmentAutoConnectAction({
    utilityType: 'hvCable', candidates: 2, stubs: [{}, {}],
    cost: { funding: 960 },
  });
  assert(action.label === 'Auto-connect 2 ($960) · Tab'
      && action.title.includes('2 unconnected HV connections')
      && action.title.includes('T removes all utility connections'),
  'HV distributor action copy identifies compatible connections');

  let footerActions = [];
  const panel = {
    comp: COMPONENTS.sectionDistributionPanel,
    equip: {
      id: 'section_panel', type: 'sectionDistributionPanel',
      category: 'infrastructure', col: 6, row: 9,
    },
    _autoConnectPlan: {
      utilityType: 'powerCable', candidates: 3, stubs: [{}, {}],
      cost: { funding: 480 },
    },
    selectionActions: {},
    _selectionEntries() { return [this.equip]; },
    ctx: { setActions(actions) { footerActions = actions; } },
  };
  EquipmentWindow.prototype._updateActions.call(panel);
  assert(!footerActions.some(item => item.label.startsWith('Auto-connect')),
    'auto-connect is removed from the crowded footer action row');

  let clickHandler = null;
  const container = {
    innerHTML: '',
    querySelector(selector) {
      if (selector !== '.equipment-auto-connect-btn'
          || !this.innerHTML.includes('equipment-auto-connect-btn')) return null;
      return { addEventListener(type, handler) { if (type === 'click') clickHandler = handler; } };
    },
  };
  EquipmentWindow.prototype._renderInfo.call(panel, container);
  assert(container.innerHTML.indexOf('equipment-auto-connect-btn')
      < container.innerHTML.indexOf('Category:'),
  'the dedicated auto-connect button renders near the top, before metadata');
  assert(container.innerHTML.includes('ctx-action-btn equipment-auto-connect-btn')
      && typeof clickHandler === 'function',
  'the top button uses the shared action styling and remains interactive');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
