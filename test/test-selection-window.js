// Regression coverage for the multi-selection context panel.

import {
  EquipmentWindow,
  equipmentAutoConnectAction,
  selectionWindowItems,
} from '../src/ui/EquipmentWindow.js';
import { reconcileSelectionWindow } from '../src/input/selection-window.js';
import { COMPONENTS } from '../src/data/components.js';

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
