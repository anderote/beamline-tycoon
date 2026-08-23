import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  waterDripEffect,
  waterDripEmitterPoints,
} from '../src/renderer3d/water-drip-presentation.js';

const points = [
  { x: 1, y: 1.1, z: 2 },
  { x: 4, y: 0.75, z: 2 },
  { x: 8, y: 1.3, z: 2 },
];

test('hot and cold water lines drip only at connected terminal fittings', () => {
  for (const utilityType of ['coolingWater', 'waterSupplyPipe']) {
    for (const waterCircuit of ['cold', 'hot']) {
      const line = {
        id: `${utilityType}-${waterCircuit}`,
        utilityType,
        waterCircuit,
        start: { placeableId: 'plant', portName: 'out' },
        end: { placeableId: 'load', portName: 'in' },
      };
      assert.deepEqual(waterDripEmitterPoints(line, points), [points[0], points[2]]);
      const effect = waterDripEffect(line, points);
      assert.equal(effect.kind, 'ambientDrip');
      assert.equal(effect.emitterMode, 'points');
      assert.equal(effect.source, 'water-fittings');
      assert.deepEqual(effect.path, [points[0], points[2]]);
      assert.ok(effect.elongation < 2, 'water reads as small dots rather than long streaks');
    }
  }
});

test('open caps, lukewarm transfer, and non-water utilities do not drip', () => {
  assert.deepEqual(waterDripEmitterPoints({
    utilityType: 'coolingWater', waterCircuit: 'cold', start: null, end: null,
  }, points), []);
  assert.equal(waterDripEffect({
    utilityType: 'waterSupplyPipe', waterCircuit: 'lukewarm', start: {}, end: {},
  }, points), null);
  assert.equal(waterDripEffect({
    utilityType: 'cryoTransfer', waterCircuit: 'cold', start: {}, end: {},
  }, points), null);
});

test('drip color follows the authored temperature circuit and dry faults stop animation', () => {
  const base = {
    id: 'water', utilityType: 'coolingWater',
    start: { placeableId: 'plant', portName: 'out' }, end: null,
  };
  const cold = waterDripEffect({ ...base, waterCircuit: 'cold' }, points);
  const hot = waterDripEffect({ ...base, waterCircuit: 'hot' }, points);
  assert.equal(cold.color, '#287fc4');
  assert.equal(hot.color, '#c45b42');
  assert.notEqual(cold.cycle, hot.cycle);
  assert.equal(waterDripEffect({ ...base, waterCircuit: 'cold' }, points, 'hard').enabled, false);
  assert.equal(waterDripEffect({ ...base, waterCircuit: 'cold' }, points, 'off').enabled, false);
});
