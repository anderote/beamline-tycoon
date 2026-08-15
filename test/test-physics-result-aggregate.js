import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aggregateBeamlinePhysics } from '../src/beamline/physics-result-aggregate.js';

function entry(id, sourceId, energy, dataRate) {
  return {
    id, sourceId,
    beamState: {
      beamEnergy: energy, beamCurrent: 2, beamQuality: 0.8,
      dataRate, collisionRate: 3, photonRate: 4, luminosity: 5,
      physicsAlive: true, physicsEnvelope: [{ s: 0 }, { s: 10 }],
    },
  };
}

test('facility physics derives strongest headline and additive production', () => {
  const entries = [entry('a', 'source-a', 10, 2), entry('b', 'source-b', 30, 7)];
  const graph = [
    { id: 'source-a', beamStart: 0 },
    { id: 'source-b', beamStart: 20 },
  ];
  const result = aggregateBeamlinePhysics(entries, graph);
  assert.equal(result.beamEnergy, 30);
  assert.equal(result.dataRate, 9);
  assert.equal(result.collisionRate, 6);
  assert.deepEqual(result.envelope.map(sample => sample.s), [0, 10, 20, 30]);
});
