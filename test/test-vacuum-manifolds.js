// Vacuum manifolds are physical fan-in devices: a finite bank of pump
// branches joins one common header, and the manifold itself adds no speed.

import assert from 'node:assert/strict';
import * as THREE_REAL from 'three';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { discoverNetworks, makeDefaultPortLookup } from '../src/utility/network-discovery.js';

globalThis.THREE = THREE_REAL;

const {
  _buildVacuumManifold4Roles,
  _buildVacuumManifold8Roles,
} = await import('../src/renderer3d/builders/vacuum-builder.js');

function passPorts(type) {
  return Object.entries(getUtilityPortsV2(type))
    .filter(([, port]) => port.utility === 'vacuumPipe' && port.role === 'pass');
}

console.log('\n=== 1. The catalogue exposes real 1×4 and 1×8 headers ===\n');
{
  assert.equal(PLACEABLES.vacuumManifold.name, '1×4 Vacuum Manifold');
  assert.equal(PLACEABLES.vacuumManifold8.name, '1×8 Vacuum Manifold');
  assert.equal(passPorts('vacuumManifold').length, 5,
    '1×4 has one common fitting plus four branches');
  assert.equal(passPorts('vacuumManifold8').length, 9,
    '1×8 has one common fitting plus eight branches');
  assert.equal(passPorts('vacuumManifold')[0][0], 'bus_back',
    'the common header fitting is stable and authored first');
  assert.equal(passPorts('vacuumManifold').filter(([, p]) => p.side === 'left').length, 2);
  assert.equal(passPorts('vacuumManifold').filter(([, p]) => p.side === 'right').length, 2);
  assert.equal(passPorts('vacuumManifold8').filter(([, p]) => p.side === 'left').length, 4);
  assert.equal(passPorts('vacuumManifold8').filter(([, p]) => p.side === 'right').length, 4);
}

console.log('\n=== 2. Geometry contains a header, every branch, flanges, and valves ===\n');
for (const [count, build] of [
  [4, _buildVacuumManifold4Roles],
  [8, _buildVacuumManifold8Roles],
]) {
  const roles = build();
  assert.equal(roles.pipe.length, count + 1,
    `1×${count} has one cylindrical header plus ${count} branch pipes`);
  assert.equal(roles.accent.length, count,
    `1×${count} has one isolation handwheel per branch`);
  assert.ok(roles.detail.length >= count * 2 + 2,
    `1×${count} exposes branch hardware and end flanges`);
  assert.ok(roles.stand.length >= 6,
    `1×${count} is carried by an open steel skid`);
}

console.log('\n=== 3. Four pumps combine through four separate fittings ===\n');
{
  const pumps = Array.from({ length: 4 }, (_, i) => ({
    id: `pump_${i + 1}`, type: 'roughingPump', col: i, row: 4,
    subCol: 0, subRow: 0, dir: 0,
  }));
  const manifold = {
    id: 'manifold', type: 'vacuumManifold', col: 2, row: 2,
    subCol: 0, subRow: 0, dir: 0,
  };
  const load = {
    id: 'gun', type: 'source', col: 2, row: 0,
    subCol: 0, subRow: 0, dir: 0,
  };
  const branches = passPorts('vacuumManifold')
    .map(([name]) => name)
    .filter(name => name !== 'bus_back');
  const lines = new Map();
  branches.forEach((portName, i) => lines.set(`pump_line_${i + 1}`, {
    id: `pump_line_${i + 1}`,
    utilityType: 'vacuumPipe',
    start: { placeableId: pumps[i].id, portName: 'vac_out' },
    end: { placeableId: manifold.id, portName },
    path: [{ col: i, row: 4 }, { col: 2, row: 2 }],
  }));
  lines.set('load_line', {
    id: 'load_line', utilityType: 'vacuumPipe',
    start: { placeableId: manifold.id, portName: 'bus_back' },
    end: { placeableId: load.id, portName: 'vac_in' },
    path: [{ col: 2, row: 2 }, { col: 2, row: 0 }],
  });
  const state = { placeables: [...pumps, manifold, load], beamPipes: [], utilityLines: lines };
  const networks = discoverNetworks('vacuumPipe', lines, makeDefaultPortLookup(state));
  assert.equal(networks.length, 1, 'all five runs form one vacuum network');
  assert.equal(networks[0].sources.length, 4, 'only the four pumps are sources');
  assert.equal(networks[0].sinks.length, 1, 'the common header reaches the vacuum load');
  assert.equal(networks[0].sources.reduce(
    (sum, source) => sum + (source.params.pumpSpeed || 0), 0,
  ), 60, 'four 15 L/s pumps deliver 60 L/s through the header');
}

console.log('\nVacuum manifold tests passed.');
