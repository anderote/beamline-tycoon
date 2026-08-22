// Regression coverage for the multi-selection context panel.

import {
  EquipmentWindow,
  equipmentAutoConnectAction,
  selectionWindowItems,
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
    selectionActions: { getClipboardCount: () => 0 },
    ctx: { setActions(next) { actions = next; } },
  };
  SelectionWindow.prototype._updateActions.call(panel);
  assert(actions.find(action => action.label === 'Copy')?.disabled === false
      && actions.find(action => action.label === 'Move selection')?.disabled === true,
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
  assert(actions.find(action => action.label === 'Copy compatible (2)')?.disabled === false
      && actions.find(action => action.label === 'Move compatible (1)')?.disabled === false,
  'unsupported items no longer disable compatible formation actions');
  const availability = selectionActionAvailability(panel._selected(), 3);
  assert(availability.copyableCount === 2 && availability.movableCount === 1
      && availability.clipboardCount === 3,
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
  const items = selectionWindowItems([
    { id: 'a', type: 'labBench', category: 'equipment', col: 4, row: 7 },
    { id: 'b', type: 'flowerBed', category: 'decoration', col: 8, row: 2 },
  ]);
  assert(items.length === 2, 'every selected placeable becomes a list row');
  assert(items[0].name === 'Lab Bench' && items[0].position === '(4, 7)',
    'rows expose the display name and position');
  assert(items[1].category === 'decoration', 'rows expose the placeable category');
}

{
  let actions = [];
  let copied = null;
  let pasted = 0;
  let refreshed = 0;
  const panel = {
    equip: { id: 'primary' },
    _selectionEntries: () => [{ id: 'primary' }, { id: 'other' }],
    selectionActions: {
      getClipboardCount: () => 2,
      onCopyToClipboard: id => { copied = id; },
      onPaste: () => { pasted++; },
    },
    ctx: { setActions(next) { actions = next; } },
    refresh() { refreshed++; },
  };
  EquipmentWindow.prototype._updateActions.call(panel);
  const labels = actions.map(action => action.label);
  assert(labels.includes('Copy') && labels.includes('Paste (2)')
      && labels.includes('Rotate group') && labels.includes('Mirror group'),
  'group window exposes clipboard and transform actions');
  actions.find(action => action.label === 'Copy').onClick();
  actions.find(action => action.label === 'Paste (2)').onClick();
  assert(copied === 'primary' && refreshed === 1,
    'Copy targets the complete anchored selection and refreshes slot state');
  assert(pasted === 1, 'Paste recalls the formation clipboard');
}

{
  let actions = [];
  const panel = {
    equip: { id: 'primary' },
    _selectionEntries: () => [{ id: 'primary' }, { id: 'other' }],
    selectionActions: { getClipboardCount: () => 0 },
    ctx: { setActions(next) { actions = next; } },
  };
  EquipmentWindow.prototype._updateActions.call(panel);
  assert(actions.find(action => action.label === 'Paste')?.disabled === true,
    'Paste is disabled until a formation has been copied');
}

{
  const priorDocument = globalThis.document;
  const makeNode = () => ({
    dataset: {},
    appendChild() {},
    addEventListener() {},
    setAttribute() {},
  });
  globalThis.document = { createElement: makeNode };

  const categories = makeNode();
  const list = makeNode();
  const selectionContainer = {
    innerHTML: '',
    querySelector(selector) {
      if (selector === '.selection-category-list') return categories;
      if (selector === '.selection-panel-list') return list;
      return null;
    },
  };
  SelectionWindow.prototype._render.call({
    _candidates: () => [],
    _selectedKeys: () => new Set(),
    selectionActions: {},
    refresh() {},
  }, selectionContainer);

  const equipmentContainer = {
    innerHTML: '',
    querySelector: selector => selector === '.selection-panel-list' ? list : null,
  };
  EquipmentWindow.prototype._renderGroupInfo.call({ selectionActions: {} }, equipmentContainer, [
    { id: 'a', type: 'labBench', category: 'equipment', col: 1, row: 2 },
    { id: 'b', type: 'labBench', category: 'equipment', col: 3, row: 4 },
  ]);

  assert(!selectionContainer.innerHTML.includes('Save selection')
      && !selectionContainer.innerHTML.includes('selection-panel-slots')
      && !equipmentContainer.innerHTML.includes('Save selection')
      && !equipmentContainer.innerHTML.includes('selection-panel-slots'),
  'selection panels no longer show the persistent save-selection slot block');

  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
}

{
  const action = equipmentAutoConnectAction({
    utilityType: 'hvCable', candidates: 2, stubs: [{}, {}],
    cost: { funding: 960 },
  });
  assert(action.label === 'Auto-connect 2 ($960) · Tab'
      && action.title.includes('2 unconnected HV feeder inputs'),
  'HV distributor action copy identifies feeder inputs');

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
