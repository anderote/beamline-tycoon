import assert from 'node:assert/strict';

import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { Game } from '../src/game/Game.js';

const registry = new BeamlineRegistry();
const game = new Game(registry, { seed: 4201 });
const stateIdentity = game.state;
const baseline = JSON.parse(game.serialize({ includeAux: false }));

game.state.resources.funding = 17;
game.state.tick = 99;
game.state.placeables = [];
game.state.floors = [];
game.activeLevel = 2;
game.editingBeamlineId = 'old';
game.selectedBeamlineId = 'old';
game.pendingBeamlineTypeId = 'protonLinac';
game._undoStack.push({ payload: 'old' });
game._redoStack.push({ payload: 'old' });
registry.createBeamline('linac', 'old-source', 'protonLinac');
game.start();

assert.equal(game.resetForNewSession(), true);
assert.equal(game.state, stateIdentity,
  'systems keep the original mutable state object');
assert.equal(game.tickInterval, null, 'the old simulation loop is stopped');
assert.equal(game._started, false);
assert.equal(game.state.resources.funding, baseline.state.resources.funding);
assert.equal(game.state.tick, 0);
assert.equal(game.state.floors.length, baseline.state.floors.length);
assert.equal(game.state.placeables.length, baseline.state.placeables.length);
assert.equal(registry.getAll().length, 0, 'the old beamline registry is cleared');
assert.equal(registry.nextBeamlineId, 1);
assert.equal(game.activeLevel, 0);
assert.equal(game.editingBeamlineId, null);
assert.equal(game.selectedBeamlineId, null);
assert.equal(game.pendingBeamlineTypeId, null);
assert.deepEqual(game._undoStack, []);
assert.deepEqual(game._redoStack, []);
assert.deepEqual(game._resourceLedger, {});
assert.deepEqual(game._resourceMark, game.state.resources);

console.log('New session reset: all assertions passed');
