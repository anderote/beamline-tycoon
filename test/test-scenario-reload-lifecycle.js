import assert from 'node:assert/strict';

import { ScenarioPicker } from '../src/ui/ScenarioPicker.js';

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

const inPlaceOrder = [];
const inPlaceStorage = memoryStorage([['beamlineTycoon', 'active-save']]);
const inPlaceDocument = {
  getElementById: id => id === 'scenario-dialog'
    ? { remove: () => inPlaceOrder.push('remove-dialog') }
    : null,
};
const inPlacePicker = new ScenarioPicker({
  save: () => inPlaceOrder.push('save'),
  log() {},
}, {
  storage: inPlaceStorage,
  sessionStorage: memoryStorage(),
  document: inPlaceDocument,
  location: { reload: () => inPlaceOrder.push('reload') },
  confirm: () => true,
  editorEnabled: false,
  startInPlace: scenario => {
    assert.equal(scenario.id, 'minorLab');
    assert.equal(inPlaceStorage.getItem('beamlineTycoon'), 'active-save',
      'the previous active save remains recoverable until in-place startup succeeds');
    inPlaceOrder.push('start-in-place');
    return true;
  },
  beforeReload: () => inPlaceOrder.push('dispose'),
});

inPlacePicker._startScenario('minorLab');
assert.deepEqual(inPlaceOrder, ['save', 'start-in-place', 'remove-dialog']);
assert.equal(inPlaceStorage.getItem('beamlineTycoon.pendingScenario'), null,
  'an in-place start does not stage a redundant reload');

const storage = memoryStorage([['beamlineTycoon', 'active-save']]);
const sessionStorage = memoryStorage();
const order = [];
const location = { reload: () => order.push('reload') };
const game = { save: () => order.push('save'), log: () => {} };
const picker = new ScenarioPicker(game, {
  storage,
  sessionStorage,
  location,
  confirm: () => true,
  editorEnabled: false,
  beforeReload: () => {
    assert.equal(storage.getItem('beamlineTycoon'), null,
      'the active save is cleared before GPU teardown starts');
    order.push('dispose');
  },
  scheduleReload: callback => {
    order.push('schedule');
    callback();
  },
});

picker._startScenario('minorLab');

assert.deepEqual(order, ['save', 'dispose', 'schedule', 'reload']);
assert.equal(storage.getItem('beamlineTycoon.pendingScenario'), 'minorLab');
assert.equal(sessionStorage.getItem('beamlineTycoon.skipTitle'), '1');

const recoveryOrder = [];
const recoveryPicker = new ScenarioPicker({ save() {}, log() {} }, {
  storage: memoryStorage(),
  sessionStorage: memoryStorage(),
  location: { reload: () => recoveryOrder.push('reload') },
  confirm: () => true,
  editorEnabled: false,
  beforeReload: () => { throw new Error('cleanup failed'); },
  scheduleReload: callback => callback(),
});
const previousWarn = console.warn;
console.warn = () => recoveryOrder.push('warn');
try {
  recoveryPicker._startScenario('sandbox');
} finally {
  console.warn = previousWarn;
}
assert.deepEqual(recoveryOrder, ['warn', 'reload'],
  'cleanup failures are reported but never strand a staged New Game');

console.log('Scenario reload lifecycle: all assertions passed');
