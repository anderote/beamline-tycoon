import test from 'node:test';
import assert from 'node:assert/strict';

import { COMPONENTS } from '../src/data/components.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { Game } from '../src/game/Game.js';
import {
  BREAKER_AUTO_RETRY_TICKS,
  GENERATOR_REFUEL_COST,
  PowerReliabilityCoordinator,
} from '../src/game/power-reliability.js';
import { UtilityLineSystem } from '../src/utility/UtilityLineSystem.js';
import { validateDrawLine } from '../src/utility/line-drawing.js';
import { discoverNetworks, makeDefaultPortLookup } from '../src/utility/network-discovery.js';
import { UtilityRegistry } from '../src/utility/registry.js';
import { SolveRunner } from '../src/utility/solve-runner.js';

function placed(id, type, col = 0, row = 0) {
  return { id, type, kind: PLACEABLES[type]?.kind, col, row, subCol: 0, subRow: 0, dir: 0 };
}

function ref(placeableId, portName) {
  return { placeableId, portName };
}

function line(id, utilityType, start, end, row = 0) {
  return {
    id, utilityType, start, end,
    path: [{ col: 0, row }, { col: 1, row }],
    cablePath: [{ col: 0, row }, { col: 1, row }],
    subL: 4,
  };
}

function world(placeables, lines = []) {
  return {
    placeables,
    beamPipes: [],
    utilityLines: new Map(lines.map(item => [item.id, item])),
    utilityNetworkState: new Map(),
    powerReliability: { devices: {} },
    wallOccupied: {},
    resources: { funding: 1000000 },
  };
}

function runnerFor(state) {
  return new SolveRunner({
    state,
    registry: UtilityRegistry,
    getDefinition: type => COMPONENTS[type] || PLACEABLES[type] || null,
  });
}

function reliabilityFor(state, options = {}) {
  return new PowerReliabilityCoordinator({
    state,
    rng: options.rng || (() => 0.5),
    log: options.log || (() => {}),
    markTopologyDirty: options.markTopologyDirty || (() => {}),
    canAfford: options.canAfford || (cost => state.resources.funding >= cost.funding),
    spend: options.spend || (cost => { state.resources.funding -= cost.funding; }),
  });
}

test('the active power catalog covers service, metering, and resilience', () => {
  for (const id of [
    'gridServicePoint', 'gridServicePointHighCapacity', 'poleMountTransformer', 'meterMain', 'disconnectSwitch',
    'automaticTransferSwitch', 'ups', 'backupGenerator',
  ]) {
    assert.ok(PLACEABLES[id], id);
    assert.ok(Object.keys(getUtilityPortsV2(id)).length > 0, `${id} has connectors`);
  }
  assert.equal(COMPONENTS.laserSystem.category, 'experimentalSystems');
  assert.equal(COMPONENTS.petawattLaser.category, 'experimentalSystems');
  assert.equal(PLACEABLES.overheadPowerSpan.deprecated, true);
  for (const id of ['cableTray', 'cableRiser', 'hvDuctBankVault']) {
    assert.equal(PLACEABLES[id].deprecated, true, `${id} is retained only for old saves`);
  }
});

test('utility service, pole, service transformer, and branch load solve end to end', () => {
  const state = world([
    placed('grid', 'gridServicePoint'),
    placed('pole', 'utilityPole'),
    placed('xfmr', 'poleMountTransformer'),
    placed('load', 'quadrupole'),
  ], [
    line('hv_a', 'hvCable', ref('grid', 'hv_out_1'), ref('pole', 'hv_in'), 0),
    line('hv_b', 'hvCable', ref('pole', 'hv_in'), ref('xfmr', 'hv_in'), 2),
    line('pwr', 'powerCable', ref('xfmr', 'pwr_out_1'), ref('load', 'pwr_in'), 4),
  ]);
  reliabilityFor(state);
  const runner = runnerFor(state);
  const solved = runner.runSolve(state);
  assert.equal(solved.errors.filter(error => error.severity === 'hard').length, 0);

  const hvFlow = [...state.utilityNetworkData.get('hvCable').values()][0];
  const branchFlow = [...state.utilityNetworkData.get('powerCable').values()][0];
  assert.equal(hvFlow.totalCapacity, 3000);
  assert.equal(hvFlow.totalDemand, 10,
    'the 100 kW pole transformer draws only its connected 10 kW load');
  assert.equal(branchFlow.totalCapacity, 100);
  assert.equal(branchFlow.totalDemand, 10);

  state.powerReliability.devices.grid.outageTicksRemaining = 2;
  runner.runSolve(state);
  assert.equal([...state.utilityNetworkData.get('hvCable').values()][0].totalCapacity, 0);
});

test('utility service point energizes transformer HV outputs only through its HV input', () => {
  const state = world([
    placed('service', 'gridServicePoint'),
    placed('xfmr', 'hvTransformer'),
    placed('panel', 'mainDistributionPanel'),
    placed('load', 'quadrupole'),
  ], [
    line('service_to_xfmr', 'hvCable', ref('service', 'hv_out_1'), ref('xfmr', 'hv_in'), 0),
    line('xfmr_to_panel', 'hvCable', ref('xfmr', 'hv_out_1'), ref('panel', 'hv_in'), 2),
    line('panel_to_load', 'powerCable', ref('panel', 'pwr_out_1'), ref('load', 'pwr_in'), 4),
  ]);
  reliabilityFor(state);
  const runner = runnerFor(state);
  runner.runSolve(state);
  const hvNetworks = [...state.utilityNetworkData.get('hvCable').values()];
  assert.ok(hvNetworks.every(flow => flow.totalDemand === 10),
    'both transformer stages propagate the actual 10 kW downstream draw');
  const downstream = hvNetworks.find(flow => flow.totalCapacity === 1500);
  assert.equal(downstream?.totalCapacity, 1500);

  state.utilityLines.delete('service_to_xfmr');
  runner.markTopologyDirty();
  runner.runSolve(state);
  const starved = [...state.utilityNetworkData.get('hvCable').values()]
    .find(flow => flow.totalDemand === 10);
  assert.equal(starved?.totalCapacity, 0);
});

test('a distribution panel caps upstream draw at its rating when downstream is overloaded', () => {
  const loads = Array.from({ length: 8 }, (_, index) =>
    placed(`load_${index + 1}`, 'source'));
  const state = world([
    placed('service', 'gridServicePoint'),
    placed('panel', 'sectionDistributionPanel'),
    ...loads,
  ], [
    line('feed', 'hvCable', ref('service', 'hv_out_1'), ref('panel', 'hv_in'), 0),
    ...loads.map((load, index) => line(
      `branch_${index + 1}`, 'powerCable',
      ref('panel', `pwr_out_${index + 1}`), ref(load.id, 'pwr_in'), index + 2,
    )),
  ]);
  reliabilityFor(state);
  const runner = runnerFor(state);
  runner.runSolve(state);

  const hvFlow = [...state.utilityNetworkData.get('hvCable').values()][0];
  const branchFlow = [...state.utilityNetworkData.get('powerCable').values()][0];
  assert.equal(branchFlow.totalDemand, 400);
  assert.equal(branchFlow.totalCapacity, 200);
  assert.equal(hvFlow.totalDemand, 200,
    'the overloaded 200 kW panel cannot pull more than its nameplate rating');
});

test('an HV distributor propagates mixed panel and dedicated downstream demand', () => {
  const state = world([
    placed('service', 'gridServicePoint'),
    placed('gear', 'switchgear'),
    placed('panel', 'mainDistributionPanel'),
    placed('load', 'quadrupole'),
    placed('cooler', 'dryCoolerBank'),
  ], [
    line('service_to_gear', 'hvCable', ref('service', 'hv_out_1'), ref('gear', 'hv_in'), 0),
    line('gear_to_panel', 'hvCable', ref('gear', 'hv_out_1'), ref('panel', 'hv_in'), 2),
    line('gear_to_cooler', 'hvCable', ref('gear', 'hv_out_2'), ref('cooler', 'hv_in'), 4),
    line('panel_to_load', 'powerCable', ref('panel', 'pwr_out_1'), ref('load', 'pwr_in'), 6),
  ]);
  reliabilityFor(state);
  const runner = runnerFor(state);
  runner.runSolve(state);

  const hvFlows = [...state.utilityNetworkData.get('hvCable').values()];
  assert.equal(hvFlows.length, 2);
  assert.ok(hvFlows.every(flow => flow.totalDemand === 15),
    '10 kW branch load plus 5 kW dedicated HV load propagates through both stages');
});

test('an HV distributor roof tap continues the trunk and energizes its protected outputs', () => {
  const state = world([
    placed('service', 'gridServicePoint'),
    placed('gear', 'compactHvDistributor'),
    placed('panel', 'powerPanel'),
    placed('load', 'quadrupole'),
    placed('cooler', 'dryCoolerBank'),
  ], [
    line('trunk_in', 'hvCable', ref('service', 'hv_out_1'), ref('gear', 'hv_in'), 0),
    line('trunk_out', 'hvCable', ref('gear', 'hv_in'), ref('panel', 'hv_in'), 2),
    line('protected', 'hvCable', ref('gear', 'hv_out_1'), ref('cooler', 'hv_in'), 4),
    line('branch', 'powerCable', ref('panel', 'pwr_out_1'), ref('load', 'pwr_in'), 6),
  ]);
  reliabilityFor(state);
  const runner = runnerFor(state);
  const solved = runner.runSolve(state);
  assert.equal(solved.errors.filter(error => error.severity === 'hard').length, 0);

  const hvNetworks = state.utilityNetworks.get('hvCable');
  const trunk = hvNetworks.find(network => network.ports.some(port =>
    port.placeableId === 'service'));
  const protectedFeed = hvNetworks.find(network => network.ports.some(port =>
    port.placeableId === 'cooler'));
  const trunkFlow = state.utilityNetworkData.get('hvCable').get(trunk.id);
  const protectedFlow = state.utilityNetworkData.get('hvCable').get(protectedFeed.id);
  assert.equal(trunkFlow.totalDemand, 15,
    'the trunk carries both the continued 10 kW panel load and the tapped 5 kW output load');
  assert.equal(protectedFlow.totalCapacity, 600,
    'the energized roof tap makes the compact distributor output bus live at nameplate capacity');
  assert.equal(protectedFlow.perSinkQuality['cooler:hv_in'], 1);
});

test('an open disconnect divides its HV feeder immediately', () => {
  const state = world([
    placed('supply', 'facilityTransformer'),
    placed('switch', 'disconnectSwitch'),
    placed('panel', 'powerPanel'),
  ], [
    line('a', 'hvCable', ref('supply', 'hv_out_1'), ref('switch', 'hv_in'), 0),
    line('b', 'hvCable', ref('switch', 'hv_out'), ref('panel', 'hv_in'), 2),
  ]);
  reliabilityFor(state);
  assert.equal(discoverNetworks('hvCable', state.utilityLines, makeDefaultPortLookup(state)).length, 1);
  state.powerReliability.devices.switch.switchClosed = false;
  assert.equal(discoverNetworks('hvCable', state.utilityLines, makeDefaultPortLookup(state)).length, 2);
});

test('a cable tray keeps its numbered circuits electrically isolated', () => {
  const state = world([
    placed('panel_a', 'powerPanel'), placed('panel_b', 'powerPanel'),
    placed('tray', 'cableTray'),
    placed('load_a', 'quadrupole'), placed('load_b', 'quadrupole'),
  ], [
    line('a1', 'powerCable', ref('panel_a', 'pwr_out_1'), ref('tray', 'pwr_in_1'), 0),
    line('a2', 'powerCable', ref('tray', 'pwr_out_1'), ref('load_a', 'pwr_in'), 2),
    line('b1', 'powerCable', ref('panel_b', 'pwr_out_1'), ref('tray', 'pwr_in_2'), 10),
    line('b2', 'powerCable', ref('tray', 'pwr_out_2'), ref('load_b', 'pwr_in'), 12),
  ]);
  const networks = discoverNetworks(
    'powerCable', state.utilityLines, makeDefaultPortLookup(state),
  );
  assert.equal(networks.length, 2);
  assert.ok(networks.every(network => network.sources.length === 4));
  assert.ok(networks.every(network => network.sinks.length === 1));
});

test('vault-to-vault HV lines are stored as buried duct-bank runs', () => {
  const state = world([
    placed('vault_a', 'hvDuctBankVault', 0, 0),
    placed('vault_b', 'hvDuctBankVault', 5, 0),
  ]);
  const system = new UtilityLineSystem({
    state,
    nextLineId: () => 'buried_1',
  });
  const id = system.addLine({
    utilityType: 'hvCable',
    start: ref('vault_a', 'hv_out'),
    end: ref('vault_b', 'hv_in'),
    path: [{ col: 0, row: 0 }, { col: 5, row: 0 }],
    cablePath: [{ col: 0, row: 0 }, { col: 5, row: 0 }],
  });
  assert.equal(id, 'buried_1');
  assert.equal(state.utilityLines.get(id).buried, true);
  assert.equal(state.utilityLines.get(id).routeHeightMeters, -0.18);
});

test('generator power can enter only an ATS backup terminal and auto-transfer feeds the load', () => {
  const placeables = [
    placed('normal', 'powerPanel'), placed('gen', 'backupGenerator'),
    placed('ats', 'automaticTransferSwitch'), placed('load', 'quadrupole'),
  ];
  const validationState = world(placeables);
  const draw = (start, end) => validateDrawLine(validationState, {
    utilityType: 'powerCable', start, end,
    path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
    cablePath: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
  });
  assert.equal(draw(ref('gen', 'pwr_out'), ref('load', 'pwr_in')).reason, 'invalid_port_pair');
  assert.equal(draw(ref('gen', 'pwr_out'), ref('ats', 'backup_in')).ok, true);
  assert.equal(draw(ref('normal', 'pwr_out_1'), ref('ats', 'normal_in')).ok, true);
  assert.equal(draw(ref('ats', 'pwr_out'), ref('load', 'pwr_in')).ok, true);

  const state = world(placeables, [
    line('normal_line', 'powerCable', ref('normal', 'pwr_out_1'), ref('ats', 'normal_in'), 0),
    line('backup_line', 'powerCable', ref('gen', 'pwr_out'), ref('ats', 'backup_in'), 3),
    line('load_line', 'powerCable', ref('ats', 'pwr_out'), ref('load', 'pwr_in'), 6),
  ]);
  let dirty = 0;
  const reliability = reliabilityFor(state, { markTopologyDirty: () => dirty++ });
  const runner = runnerFor(state);
  runner.runSolve(state);
  assert.equal(reliability.afterSolve({ advance: false }).requiresResolve, true);
  assert.equal(state.powerReliability.devices.ats.transferActive, 'backup');
  assert.equal(dirty, 1);
  runner.markTopologyDirty();
  runner.runSolve(state);
  const loadNetwork = state.utilityNetworks.get('powerCable').find(network =>
    network.ports.some(port => port.placeableId === 'load'));
  const loadFlow = state.utilityNetworkData.get('powerCable').get(loadNetwork.id);
  assert.equal(loadFlow.totalCapacity, 250);
  assert.equal(loadFlow.perSinkQuality['load:pwr_in'], 1);
});

test('outages, breakers, UPS charge, generator fuel, and refueling are saved device state', () => {
  const gridState = world([placed('grid', 'gridServicePoint')]);
  const gridReliability = reliabilityFor(gridState, { rng: () => 0 });
  assert.equal(gridReliability.beforeSolve().requiresResolve, true);
  assert.equal(gridState.powerReliability.devices.grid.outageTicksRemaining, 12);

  gridState.utilityNetworks = new Map([['hvCable', [{
    id: 'overloaded', ports: [{ placeableId: 'grid', portName: 'hv_out_1' }],
  }]]]);
  gridState.utilityNetworkData = new Map([['hvCable', new Map([['overloaded', {
    totalCapacity: 1200, totalDemand: 1400,
  }]])]]);
  for (let i = 0; i < 5; i++) gridReliability.afterSolve();
  assert.equal(gridState.powerReliability.devices.grid.breakerTripped, true);
  assert.equal(
    gridState.powerReliability.devices.grid.breakerRetryTicks,
    BREAKER_AUTO_RETRY_TICKS,
  );

  const upsState = world([placed('ups_1', 'ups')]);
  const upsReliability = reliabilityFor(upsState);
  upsState.nodeQualities = { ups_1: { hvQuality: 0 } };
  upsState.utilityNetworks = new Map([['powerCable', [{
    id: 'critical', ports: [{ placeableId: 'ups_1', portName: 'pwr_out_1' }],
  }]]]);
  upsState.utilityNetworkData = new Map([['powerCable', new Map([['critical', {
    totalCapacity: 100, totalDemand: 50,
  }]])]]);
  upsReliability.afterSolve();
  assert.equal(upsState.powerReliability.devices.ups_1.batteryChargeTicks, 29.5);

  const genState = world([placed('gen', 'backupGenerator')]);
  const genReliability = reliabilityFor(genState);
  genState.utilityNetworks = new Map([['powerCable', [{
    id: 'standby', ports: [{ placeableId: 'gen', portName: 'pwr_out' }],
  }]]]);
  genState.utilityNetworkData = new Map([['powerCable', new Map([['standby', {
    totalCapacity: 250, totalDemand: 125,
  }]])]]);
  genReliability.afterSolve();
  assert.equal(genState.powerReliability.devices.gen.generatorFuelTicks, 299.5);
  const result = genReliability.dispatch('gen', 'refuelGenerator');
  assert.equal(result.resourcesChanged, true);
  assert.equal(genState.powerReliability.devices.gen.generatorFuelTicks, 300);
  assert.equal(genState.resources.funding, 1000000 - GENERATOR_REFUEL_COST);
});

test('a tripped breaker retries after 15 seconds and trips again if overload remains', () => {
  const state = world([placed('grid', 'gridServicePoint')]);
  let dirty = 0;
  const messages = [];
  const reliability = reliabilityFor(state, {
    log: message => messages.push(message),
    markTopologyDirty: () => dirty++,
  });
  state.utilityNetworks = new Map([['hvCable', [{
    id: 'overloaded', ports: [{ placeableId: 'grid', portName: 'hv_out_1' }],
  }]]]);
  state.utilityNetworkData = new Map([['hvCable', new Map([['overloaded', {
    totalCapacity: 1200, totalDemand: 1400,
  }]])]]);

  for (let i = 0; i < 5; i++) reliability.afterSolve();
  const live = () => state.powerReliability.devices.grid;
  assert.equal(live().breakerTripped, true);

  for (let i = 1; i < BREAKER_AUTO_RETRY_TICKS; i++) {
    assert.equal(reliability.afterSolve().requiresResolve, false);
    assert.equal(live().breakerTripped, true, `breaker remains open through retry second ${i}`);
  }
  assert.equal(live().breakerRetryTicks, 1);
  assert.equal(reliability.afterSolve().requiresResolve, true);
  assert.equal(live().breakerTripped, false);
  assert.equal(live().breakerRetryTicks, 0);
  assert.ok(messages.some(message => message.includes('attempting automatic reset')));

  for (let i = 0; i < 5; i++) reliability.afterSolve();
  assert.equal(live().breakerTripped, true,
    'the normal sustained-overload delay trips a failed retry again');
  assert.equal(dirty, 3, 'initial trip, automatic reset, and repeat trip invalidate the solve');

  state.utilityNetworkData.get('hvCable').get('overloaded').totalDemand = 1000;
  for (let i = 0; i < BREAKER_AUTO_RETRY_TICKS; i++) reliability.afterSolve();
  assert.equal(live().breakerTripped, false, 'the next automatic reset closes after load is reduced');
  for (let i = 0; i < 5; i++) reliability.afterSolve();
  assert.equal(live().breakerTripped, false, 'a recovered circuit remains closed');
  assert.equal(dirty, 4, 'the successful automatic reset invalidates the solve once');
});

test('Game serialization persists operational electrical state', () => {
  const game = new Game(new BeamlineRegistry(), { seed: 817 });
  const generator = placed('saved_generator', 'backupGenerator');
  game.state.placeables.push(generator);
  game.powerReliability.onPlaceablePlaced(generator);
  game.state.powerReliability.devices.saved_generator.generatorFuelTicks = 123.5;
  game.state.powerReliability.devices.saved_generator.generatorEnabled = false;

  const saved = JSON.parse(game.serialize());
  assert.equal(saved.state.powerReliability.devices.saved_generator.generatorFuelTicks, 123.5);
  assert.equal(saved.state.powerReliability.devices.saved_generator.generatorEnabled, false);
});
