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

for (const [id, expectedOutputCount] of [
  ['compactHvDistributor', 2],
  ['switchgear', 4],
]) {
  const distributor = { id, ports: getUtilityPortsV2(id) };
  const outputs = Object.entries(distributor.ports)
    .filter(([, spec]) => spec.connectionKind === 'hvDistributionOut');

  assert.equal(outputs.length, expectedOutputCount,
    `${id} exposes its full outgoing plug bank`);
  assert.ok(outputs.every(([, spec]) => spec.side === 'front'),
    `${id} output plugs share its authored front service face`);

  for (let dir = 0; dir < 4; dir++) {
    const arrowDir = placementFacingArrowDir(distributor, dir);
    const arrowVec = DIR_DELTA[arrowDir];
    const arrowSide = COMPASS_BY_VECTOR.get(`${arrowVec.dc},${arrowVec.dr}`);
    const outputSide = portSide(distributor, outputs[0][0], dir);
    assert.equal(arrowSide, outputSide,
      `${id} rotation ${dir}: placement arrow points toward the outgoing plugs`);
  }
}

assert.equal(placementFacingArrowDir({ id: 'officeChair' }, 1), 1,
  'ordinary directional placeables keep the gameplay direction');
assert.equal(placementFacingArrowDir({ id: 'source', isSource: true }, 1), 3,
  'beam sources retain their +Z output-facing arrow');

console.log('placement facing arrow tests passed');
