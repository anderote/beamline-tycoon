import assert from 'node:assert/strict';
import { checkBands, checkMissionOutput } from '../scripts/eval-design.mjs';
const design = { typeId: 'xfel', components: [{ type: 'xfelEndstation' }] };
const beam = { beamEnergy: 8, beamCurrent: 0.001, beamAlive: true, dataRate: 1,
  felPower: 0.001, felSaturated: false };
assert.equal(checkBands(design, beam).ok, true);
assert.equal(checkMissionOutput(design, beam).ok, false, 'transport is not lasing');
assert.equal(checkMissionOutput(design, { ...beam, felSaturated: true }).ok, true);
const collider = { typeId: 'collider', components: [{ type: 'collisionPoint' }] };
const collision = { beamEnergy: 100, beamCurrent: 0.01, dataRate: 1, luminosity: 0 };
assert.equal(checkBands(collider, collision).ok, true);
assert.equal(checkMissionOutput(collider, collision).ok, false, 'energy is not luminosity');
assert.equal(checkMissionOutput(collider, { ...collision, luminosity: 1e30 }).ok, true);
assert.equal(checkMissionOutput(collider, { ...collision, luminosity: Infinity }).ok, false);
console.log('Mission output boundary passed');
