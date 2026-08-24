import test from 'node:test';
import assert from 'node:assert/strict';

import { buildUtilityTopologySnapshot } from '../src/utility/topology-snapshot.js';
import { renderUtilityTopology } from '../src/ui/utility-topology.js';

function ref(placeableId, portName) {
  return { placeableId, portName };
}

function networkFixture() {
  return {
    id: 'net_power_radial',
    utilityType: 'powerCable',
    lineIds: ['branch_a', 'branch_b'],
    ports: [
      { placeableId: 'panel', portName: 'out_a', role: 'source' },
      { placeableId: 'panel', portName: 'out_b', role: 'source' },
      { placeableId: 'load_a', portName: 'in', role: 'sink' },
      { placeableId: 'load_b', portName: 'in', role: 'sink' },
    ],
    sources: [
      { portKey: 'panel:out_a', placeableId: 'panel', portName: 'out_a', capacity: 50, params: { capacity: 50 } },
      { portKey: 'panel:out_b', placeableId: 'panel', portName: 'out_b', capacity: 50, params: { capacity: 50 } },
    ],
    sinks: [
      { portKey: 'load_a:in', placeableId: 'load_a', portName: 'in', demand: 10, params: { demand: 10 } },
      { portKey: 'load_b:in', placeableId: 'load_b', portName: 'in', demand: 20, params: { demand: 20 } },
    ],
  };
}

test('radial utility topology publishes exact downstream load per physical run', () => {
  const network = networkFixture();
  const state = {
    utilityLines: new Map([
      ['branch_a', { id: 'branch_a', start: ref('panel', 'out_a'), end: ref('load_a', 'in') }],
      ['branch_b', { id: 'branch_b', start: ref('panel', 'out_b'), end: ref('load_b', 'in') }],
    ]),
  };
  const flow = {
    totalCapacity: 100,
    totalDemand: 30,
    perSinkQuality: { 'load_a:in': 1, 'load_b:in': 1 },
  };
  const topology = buildUtilityTopologySnapshot(state, network, flow, {
    capacityParam: 'capacity', demandParam: 'demand',
  });

  assert.equal(topology.radial, true);
  assert.deepEqual(topology.perSegmentLoad, [
    { lineId: 'branch_a', load: 10, utilization: 0.1, status: 'healthy' },
    { lineId: 'branch_b', load: 20, utilization: 0.2, status: 'healthy' },
  ]);
  assert.equal(topology.nodes.find(node => node.placeableId === 'panel')?.downstreamDemand, 30);
});

test('dynamic electrical inlet demand, trip state, and dead branches reach telemetry', () => {
  const network = {
    id: 'net_hv_dynamic', utilityType: 'hvCable', lineIds: ['feed', 'unused'],
    ports: [
      { placeableId: 'service', portName: 'out', role: 'source' },
      { placeableId: 'panel', portName: 'in', role: 'sink' },
    ],
    sources: [{ portKey: 'service:out', placeableId: 'service', portName: 'out', capacity: 1200, params: { capacity: 1200 } }],
    sinks: [{ portKey: 'panel:in', placeableId: 'panel', portName: 'in', demand: 400, params: { demand: 400, tracksDownstreamDemand: true } }],
  };
  const state = {
    utilityLines: new Map([
      ['feed', { id: 'feed', start: ref('service', 'out'), end: ref('panel', 'in') }],
      ['unused', { id: 'unused', start: ref('service', 'out'), end: null }],
    ]),
    electricalSinkDemands: new Map([['panel:in', 35]]),
    powerReliability: { devices: { service: { breakerTripped: true } } },
  };
  const flow = {
    totalCapacity: 0,
    totalDemand: 35,
    perSinkQuality: { 'panel:in': 0 },
  };
  const topology = buildUtilityTopologySnapshot(state, network, flow, {
    capacityParam: 'capacity', demandParam: 'demand',
  });

  assert.equal(topology.nodes.find(node => node.placeableId === 'panel')?.demand, 35,
    'nameplate demand is replaced by live downstream load');
  assert.equal(topology.nodes.find(node => node.placeableId === 'service')?.fault, 'breaker_tripped');
  assert.equal(topology.diagnostics.deenergizedNodes, 2);
  assert.equal(topology.diagnostics.deadBranches, 1);
  assert.equal(topology.diagnostics.openEnds, 1);
});

test('topology rendering exposes hierarchy, diagnostics, live flow, and controls', () => {
  const topology = buildUtilityTopologySnapshot({
    utilityLines: new Map([
      ['branch_a', { id: 'branch_a', start: ref('panel', 'out_a'), end: ref('load_a', 'in') }],
      ['branch_b', { id: 'branch_b', start: ref('panel', 'out_b'), end: ref('load_b', 'in') }],
    ]),
  }, networkFixture(), {
    totalCapacity: 100,
    totalDemand: 30,
    perSinkQuality: { 'load_a:in': 1, 'load_b:in': 0.5 },
  }, { capacityParam: 'capacity', demandParam: 'demand' });

  const html = renderUtilityTopology(topology, {
    capacityUnit: 'kW', demandUnit: 'kW',
    labelFor: id => ({ panel: 'Distribution Panel', load_a: 'Quad A', load_b: 'Quad B' })[id],
    actionsFor: id => id === 'panel' ? [{ id: 'toggleSwitch', label: 'Open switch' }] : [],
  });

  assert.match(html, /Live network flow/);
  assert.match(html, /Supply/);
  assert.match(html, /Loads/);
  assert.match(html, /20\.0 kW/);
  assert.match(html, /Constrained/);
  assert.match(html, /data-topology-action="toggleSwitch"/);
});
