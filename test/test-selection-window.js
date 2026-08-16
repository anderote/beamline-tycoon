// Regression coverage for the multi-selection context panel.

import { EquipmentWindow, selectionWindowItems } from '../src/ui/EquipmentWindow.js';
import { reconcileSelectionWindow } from '../src/input/selection-window.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
