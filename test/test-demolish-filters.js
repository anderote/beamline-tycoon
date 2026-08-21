// Demolition category contract. These tests stay at the policy boundary used
// by hover, click picking, and area sweeps, so all three interaction paths must
// agree about what each checkbox means.

import assert from 'node:assert/strict';
import {
  DEMOLISH_FILTERS,
  createDemolishPolicy,
  defaultDemolishFilters,
} from '../src/input/demolishScopes.js';

const defaults = defaultDemolishFilters();
assert.deepEqual([...defaults], ['beamline', 'infra', 'facility'],
  'default filters select Beamline, Infra, and Facility in display order');
assert.deepEqual(DEMOLISH_FILTERS.map(filter => filter.key),
  ['structure', 'beamline', 'infra', 'facility', 'grounds']);

const policy = createDemolishPolicy(defaults);
assert.equal(policy.allowsPlaceable({ type: 'drift', kind: 'beamline' }), true);
assert.equal(policy.allowsPlaceable({ type: 'gridServicePoint', kind: 'infrastructure' }), true);
assert.equal(policy.allowsPlaceable({ type: 'labBench', kind: 'furnishing' }), true);
assert.equal(policy.allowsPlaceable({ type: 'wallSconce', kind: 'decoration' }), false,
  'Structure-off protects indoor fixtures');
assert.equal(policy.allowsPlaceable({ type: 'lamppost', kind: 'decoration' }), false,
  'Grounds-off protects outdoor decorations');
assert.equal(policy.allowsFloor('concrete'), false, 'Structure-off protects foundations');
assert.equal(policy.allowsFloor('grass'), false, 'Grounds-off protects terrain surfaces');
assert.equal(policy.allowsEdge({ wallType: 'officeWall' }), false,
  'Structure-off protects ordinary walls');
assert.equal(policy.allowsEdge({ wallType: 'chainLinkFence' }), false,
  'Grounds-off protects fences');
assert.equal(policy.allowsEdge({ doorType: 'securityGate' }), false,
  'Grounds-off protects gates even when visible door geometry was picked');

const structure = createDemolishPolicy(['structure']);
assert.equal(structure.allowsPlaceable({ type: 'wallSconce', kind: 'decoration' }), true);
assert.equal(structure.allowsPlaceable({ type: 'lamppost', kind: 'decoration' }), false);
assert.equal(structure.allowsFloor('concrete'), true);
assert.equal(structure.allowsFloor('grass'), false);
assert.equal(structure.allowsEdge({ wallType: 'officeWall' }), true);
assert.equal(structure.allowsEdge({ doorType: 'securityGate' }), false);

const grounds = createDemolishPolicy(['grounds']);
assert.equal(grounds.allowsPlaceable({ type: 'wallSconce', kind: 'decoration' }), false);
assert.equal(grounds.allowsPlaceable({ type: 'lamppost', kind: 'decoration' }), true);
assert.equal(grounds.allowsFloor('concrete'), false);
assert.equal(grounds.allowsFloor('grass'), true);
assert.equal(grounds.allowsEdge({ wallType: 'officeWall' }), false);
assert.equal(grounds.allowsEdge({ wallType: 'chainLinkFence' }), true);
assert.equal(grounds.allowsEdge({ doorType: 'securityGate' }), true);

console.log('demolish filter policy: defaults and category ownership pass');
