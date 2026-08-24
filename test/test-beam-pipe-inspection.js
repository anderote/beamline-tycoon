import assert from 'node:assert/strict';

import { beamlineForPipe } from '../src/beamline/pipe-ownership.js';
import { inspectBeamPipe } from '../src/input/beam-pipe-inspection.js';

const entries = [
  { id: 'bl-1', name: 'Injector', sourceId: 'source-1' },
  { id: 'bl-2', name: 'Test Stand', sourceId: 'source-2' },
];
const registry = {
  get: id => entries.find(entry => entry.id === id) || null,
  getAll: () => entries,
};
const state = {
  placeables: [
    { id: 'source-1', beamlineId: 'bl-1' },
    { id: 'end-1', beamlineId: 'bl-1' },
    // Legacy graph: no beamlineId fields, so ownership comes from connectivity.
    { id: 'source-2' },
    { id: 'middle-2' },
  ],
  beamPipes: [
    {
      id: 'pipe-1',
      start: { junctionId: 'source-1' },
      end: { junctionId: 'end-1' },
      path: [{ col: 1, row: 1 }, { col: 3, row: 1 }],
    },
    {
      id: 'pipe-2a',
      start: { junctionId: 'source-2' },
      end: { junctionId: 'middle-2' },
      path: [{ col: 1, row: 4 }, { col: 3, row: 4 }],
    },
    {
      id: 'pipe-2b',
      start: { junctionId: 'middle-2' },
      end: null,
      path: [{ col: 3, row: 4 }, { col: 6, row: 4 }],
    },
  ],
};

assert.equal(beamlineForPipe(state, registry, 'pipe-1'), entries[0],
  'current pipes resolve directly through their junction beamlineId');
assert.equal(beamlineForPipe(state, registry, 'pipe-2b'), entries[1],
  'legacy open-ended pipes resolve through source-connected graph traversal');
assert.equal(beamlineForPipe(state, registry, 'missing'), null,
  'stale pipe ids do not select an unrelated beamline');

const emitted = [];
const opened = [];
const game = {
  state,
  registry,
  selectedBeamlineId: null,
  emit: (...args) => emitted.push(args),
};
assert.equal(inspectBeamPipe(game, 'pipe-1', (...args) => opened.push(args)), true);
assert.equal(game.selectedBeamlineId, 'bl-1');
assert.deepEqual(emitted, [['beamlineSelected', 'bl-1']]);
assert.deepEqual(opened, [[
  'bl-1',
  null,
  [{ col: 1, row: 1 }, { col: 3, row: 1 }],
]], 'pipe inspection opens the beamline window anchored to the clicked run');
assert.equal(inspectBeamPipe(game, 'missing', () => opened.push('bad')), false);
assert.equal(opened.length, 1, 'an unresolved pipe opens no window');

console.log('Beam-pipe inspection: all assertions passed');
