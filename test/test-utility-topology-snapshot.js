import test from 'node:test';
import assert from 'node:assert/strict';

import { buildUtilityTopologySnapshot } from '../src/utility/topology-snapshot.js';
import { bindUtilityTopologyPan, renderUtilityTopology } from '../src/ui/utility-topology.js';
import { UtilityInspector } from '../src/ui/UtilityInspector.js';

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
  assert.match(html, /Drag the diagram to pan/);
  assert.match(html, /class="utility-topology-canvas" tabindex="0" role="region"/);
});

test('topology panning moves both graph axes and reports persistent position', () => {
  const listeners = new Map();
  const classes = new Set();
  const parent = {
    scrollTop: 40,
    addEventListener(type, fn) { listeners.set(`parent:${type}`, fn); },
    removeEventListener(type) { listeners.delete(`parent:${type}`); },
  };
  const canvas = {
    scrollLeft: 90,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
    },
    addEventListener(type, fn) { listeners.set(`canvas:${type}`, fn); },
    removeEventListener(type) { listeners.delete(`canvas:${type}`); },
  };
  let dragOptions = null;
  let dragDisposed = false;
  let panning = false;
  let reported = null;
  const dispose = bindUtilityTopologyPan(canvas, {
    scrollParent: parent,
    makeDraggable: (_el, _handle, options) => {
      dragOptions = options;
      return () => { dragDisposed = true; };
    },
    onScroll: position => { reported = position; },
    onPanStart: () => { panning = true; },
    onPanEnd: () => { panning = false; },
  });

  const start = dragOptions.onStart();
  dragOptions.onMove({}, 25, -15, start);
  assert.equal(canvas.scrollLeft, 65);
  assert.equal(parent.scrollTop, 55);
  assert.deepEqual(reported, { left: 65, top: 55 });
  assert(classes.has('is-panning') && panning, 'the active drag exposes its panning state');

  dragOptions.onEnd({}, true);
  assert(!classes.has('is-panning') && !panning, 'release clears the panning state');
  dispose();
  assert(dragDisposed, 'disposing topology panning disposes its drag listeners');
  assert.equal(listeners.size, 0, 'disposing topology panning removes scroll listeners');
});

test('utility inspector preserves topology pan position across live rerenders', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
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

  function fakeCanvas() {
    const listeners = new Map();
    return {
      scrollLeft: 0,
      style: {},
      classList: { add() {}, remove() {} },
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type) { listeners.delete(type); },
    };
  }
  const el = {
    scrollTop: 0,
    canvas: null,
    listeners: new Map(),
    querySelector(selector) {
      return selector === '.utility-topology-canvas' ? this.canvas : null;
    },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    removeEventListener(type) { this.listeners.delete(type); },
    set innerHTML(value) {
      this.html = value;
      this.canvas = value.includes('utility-topology-canvas') ? fakeCanvas() : null;
    },
  };
  const inspector = Object.assign(Object.create(UtilityInspector.prototype), {
    game: { state: { utilityNetworkData: new Map([['powerCable', new Map([['network', { topology }]])]]) } },
    utilityType: 'powerCable',
    networkId: 'network',
    _topologyPanState: { left: 0, top: 0 },
    _topologyPanning: false,
    _disposeTopologyPan: null,
    _placeableLabel: id => id,
  });

  try {
    inspector._renderTopology(el);
    el.canvas.scrollLeft = 78;
    el.scrollTop = 46;
    inspector._renderTopology(el);

    assert.equal(el.canvas.scrollLeft, 78, 'live topology refresh keeps horizontal pan');
    assert.equal(el.scrollTop, 46, 'live topology refresh keeps vertical pan');
    inspector._clearTopologyPanBinding();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
