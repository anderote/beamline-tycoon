import assert from 'node:assert/strict';

import { DIR_DELTA } from '../src/data/directions.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { placementFacingArrowDir } from '../src/renderer3d/placement-facing.js';
import { portSide } from '../src/utility/ports.js';

const COMPASS_BY_VECTOR = new Map([
  ['0,-1', 'N'],
  ['1,0', 'E'],
  ['0,1', 'S'],
  ['-1,0', 'W'],
]);

const switchgear = {
  id: 'switchgear',
  ports: getUtilityPortsV2('switchgear'),
};

const outputs = Object.entries(switchgear.ports)
  .filter(([, spec]) => spec.connectionKind === 'hvDistributionOut');

assert.equal(outputs.length, 4, 'the HV distributor exposes four outgoing plugs');
assert.ok(outputs.every(([, spec]) => spec.side === 'front'),
  'all HV distributor output plugs share its authored front service face');

for (let dir = 0; dir < 4; dir++) {
  const arrowDir = placementFacingArrowDir(switchgear, dir);
  const arrowVec = DIR_DELTA[arrowDir];
  const arrowSide = COMPASS_BY_VECTOR.get(`${arrowVec.dc},${arrowVec.dr}`);
  const outputSide = portSide(switchgear, outputs[0][0], dir);
  assert.equal(arrowSide, outputSide,
    `rotation ${dir}: placement arrow points toward the four outgoing plugs`);
}

assert.equal(placementFacingArrowDir({ id: 'officeChair' }, 1), 1,
  'ordinary directional placeables keep the gameplay direction');
assert.equal(placementFacingArrowDir({ id: 'source', isSource: true }, 1), 3,
  'beam sources retain their +Z output-facing arrow');

console.log('placement facing arrow tests passed');
