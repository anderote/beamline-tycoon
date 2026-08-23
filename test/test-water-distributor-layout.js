import assert from 'node:assert/strict';
import test from 'node:test';

import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { portWorldPosition } from '../src/utility/ports.js';

function portsFor(type, utility) {
  return Object.entries(getUtilityPortsV2(type))
    .filter(([, port]) => port.utility === utility);
}

test('water distributors use compact footprints with branches opposite supplies', () => {
  for (const [type, flexibleCount, supplyCount, expectedLength] of [
    ['waterDistributor2', 2, 2, 2],
    ['waterDistributor4', 4, 2, 3],
  ]) {
    const def = PLACEABLES[type];
    assert.deepEqual([def.subW, def.subL], [1, expectedLength],
      `${type} uses a compact single-subtile-deep footprint`);

    const branches = portsFor(type, 'coolingWater');
    const supplies = portsFor(type, 'waterSupplyPipe');
    assert.equal(branches.length, flexibleCount);
    assert.equal(supplies.length, supplyCount);
    assert.ok(branches.every(([, port]) => port.side === 'right'));
    assert.ok(supplies.every(([, port]) => port.side === 'left'));
    assert.equal(new Set(branches.map(([, port]) => port.offsetAlong)).size, flexibleCount,
      `${type} gives every branch a distinct position`);
    assert.equal(branches.filter(([, port]) => port.params.waterCircuit === 'cold').length,
      flexibleCount / 2);
    assert.equal(branches.filter(([, port]) => port.params.waterCircuit === 'hot').length,
      flexibleCount / 2);
    assert.equal(supplies.filter(([, port]) => port.params.waterCircuit === 'cold').length,
      supplyCount / 2);
    assert.equal(supplies.filter(([, port]) => port.params.waterCircuit === 'hot').length,
      supplyCount / 2);

    const shapes = def.parts.map(part => part.shape || 'box');
    assert.equal(shapes.filter(shape => shape === 'box').length, 0,
      `${type} is exposed pipework with no cabinet shell`);
    assert.ok(shapes.filter(shape => shape === 'cylinder').length >= flexibleCount * 4,
      `${type} has a pipe-dominant authored silhouette`);
    assert.equal(shapes.filter(shape => shape === 'torus').length, flexibleCount,
      `${type} exposes one handwheel per flexible branch`);
  }
});

test('LCW manifold puts four cold and four hot branches opposite two plant pipes', () => {
  const type = 'coolingManifold';
  const def = PLACEABLES[type];
  const branches = portsFor(type, 'coolingWater');
  const supplies = portsFor(type, 'waterSupplyPipe');

  assert.equal(branches.length, 8);
  assert.equal(branches.filter(([, port]) => port.params.waterCircuit === 'cold').length, 4);
  assert.equal(branches.filter(([, port]) => port.params.waterCircuit === 'hot').length, 4);
  assert.ok(branches.every(([, port]) => port.side === 'right'));
  assert.equal(new Set(branches.map(([, port]) => port.offsetAlong)).size, 8,
    'all eight flexible connections occupy distinct positions on the branch face');
  const circuitsByPosition = branches
    .toSorted(([, left], [, right]) => left.offsetAlong - right.offsetAlong)
    .map(([, port]) => port.params.waterCircuit);
  assert.deepEqual(circuitsByPosition,
    ['cold', 'hot', 'cold', 'hot', 'cold', 'hot', 'cold', 'hot'],
    'cold and hot outlets alternate along the branch face');

  assert.equal(supplies.length, 2);
  assert.deepEqual(supplies.map(([, port]) => port.params.waterCircuit).sort(), ['cold', 'hot']);
  assert.ok(supplies.every(([, port]) => port.side === 'left'));

  const placed = { type, col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 };
  const branchPositions = branches.map(([name]) => portWorldPosition(placed, def, name));
  const supplyPositions = supplies.map(([name]) => portWorldPosition(placed, def, name));
  assert.ok(branchPositions.every(position => position.x > 0.25));
  assert.ok(supplyPositions.every(position => position.x < 0.25));
  assert.equal(new Set(branchPositions.map(position => position.z)).size, 8,
    'the eight branch endpoints do not overlap in plan view');
  const sortedBranchZ = branchPositions.map(position => position.z).sort((a, b) => a - b);
  const minimumBranchSpacing = Math.min(...sortedBranchZ.slice(1)
    .map((z, index) => z - sortedBranchZ[index]));
  assert.ok(minimumBranchSpacing > 0.22,
    `branch endpoints clear the 0.22 m placement markers (${minimumBranchSpacing} m)`);
  assert.ok(Math.abs(supplyPositions[0].z - supplyPositions[1].z) > 0.8,
    'the rigid cold and hot supply endpoints occupy separate header stations');
});
