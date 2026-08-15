import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { Game } from '../src/game/Game.js';

test('Game keeps the current beam state while background physics is pending', async () => {
  let resolvePhysics;
  const engine = {
    isReady: () => true,
    computeAsync: () => new Promise(resolve => { resolvePhysics = resolve; }),
  };
  const registry = new BeamlineRegistry();
  const entry = registry.createBeamline('linac');
  const game = new Game(registry, { seed: 1, physicsEngine: engine });
  entry.beamState.beamEnergy = 7;

  game.runPhysicsForBeamline(entry, [{
    id: 'cavity-a', type: 'pillboxCavity', subL: 2, stats: {}, params: {},
  }], { machineType: 'linac' });
  assert.equal(entry.beamState.beamEnergy, 7,
    'scheduling must not blank the last published result');
  assert.equal(game.physicsRecalcCoordinator.pendingCount(), 1);

  resolvePhysics({
    beamEnergy: 12, dataRate: 3, beamQuality: 0.9, beamAlive: true,
    beamCurrent: 2, totalLossFraction: 0.01, envelope: [{ s: 0 }, { s: 1 }],
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(entry.beamState.beamEnergy, 12);
  assert.equal(entry.beamState.physicsEnvelope.length, 2);
  assert.equal(game.physicsRecalcCoordinator.pendingCount(), 0);
});
