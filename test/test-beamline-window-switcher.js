import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };

const { BeamlineWindow } = await import('../src/ui/BeamlineWindow.js');

const entries = [
  {
    id: 'bl-1', name: 'Injector', accentColor: 0x46c25a,
    status: 'running', sourceId: 'source-1', beamState: {},
  },
  {
    id: 'bl-2', name: 'Test Stand', accentColor: 0x4d8ee8,
    status: 'stopped', sourceId: 'source-2', beamState: {},
  },
];
const registry = {
  get: id => entries.find(entry => entry.id === id) || null,
  getAll: () => entries,
};
const calls = [];
const ctx = {
  activeTab: 'component',
  setId: id => { calls.push(['setId', id]); return true; },
  setTitle: title => calls.push(['setTitle', title]),
  setTitleMenu: (items, selected) => calls.push([
    'setTitleMenu', items.map(item => item.key), selected,
  ]),
  switchTab: tab => calls.push(['switchTab', tab]),
  update: () => calls.push(['update']),
};
const emitted = [];
const switched = [];
const panel = Object.assign(Object.create(BeamlineWindow.prototype), {
  game: {
    registry,
    selectedBeamlineId: 'bl-1',
    emit: (...args) => emitted.push(args),
  },
  beamlineId: 'bl-1',
  selectedComponentId: 'quad-1',
  _selectedComponentFallback: { id: 'quad-1' },
  _titleMenuSignature: '',
  _onBeamlineChanged: (...args) => switched.push(args),
  ctx,
  _updateStatus: () => calls.push(['status']),
  _updateActions: () => calls.push(['actions']),
});

assert.equal(panel.switchBeamline('bl-2'), true);
assert.equal(panel.beamlineId, 'bl-2');
assert.equal(panel.game.selectedBeamlineId, 'bl-2');
assert.equal(panel.selectedComponentId, null,
  'component selection is cleared instead of leaking into the next beamline');
assert.deepEqual(emitted, [['beamlineSelected', 'bl-2']]);
assert.deepEqual(calls[0], ['setId', 'bl-bl-2'],
  'the live ContextWindow is re-keyed so later clicks focus it instead of duplicating it');
assert(calls.some(call => call[0] === 'setTitle' && call[1] === 'Test Stand'));
assert(calls.some(call => call[0] === 'setTitleMenu'
  && call[2] === 'bl-2'
  && call[1].join(',') === 'bl-1,bl-2'));
assert(calls.some(call => call[0] === 'switchTab' && call[1] === 'overview'),
  'switching away from a component view lands on the new beamline overview');
assert.equal(switched.length, 1);
assert.equal(switched[0][0], 'bl-1');
assert.equal(switched[0][1], 'bl-2');
assert.equal(switched[0][2], panel);
assert.equal(panel.switchBeamline('missing'), false,
  'stale picker entries cannot retarget the window');

console.log('Beamline-window switcher: all assertions passed');
