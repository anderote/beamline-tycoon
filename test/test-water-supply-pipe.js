import assert from 'node:assert/strict';

import { COMPONENTS } from '../src/data/components.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { validateDrawLine } from '../src/utility/line-drawing.js';
import { discoverNetworks, makeDefaultPortLookup } from '../src/utility/network-discovery.js';
import { SolveRunner } from '../src/utility/solve-runner.js';
import { UtilityRegistry, utilityLineHeight } from '../src/utility/registry.js';
import { componentPaletteEntries } from '../src/ui/palette-collection.js';

function item(id, type, col, row) {
  return { id, type, col, row, subCol: 0, subRow: 0, dir: 0,
    kind: 'infrastructure', category: 'infrastructure' };
}

function line(id, utilityType, start, end, waterCircuit, row = 0) {
  return { id, utilityType, start, end, waterCircuit,
    path: [{ col: 0, row }, { col: 4, row }] };
}

console.log('\n--- paired equipment ports ---');
{
  const quad = getUtilityPortsV2('quadrupole');
  assert.equal(quad.cool_in.utility, 'coolingWater');
  assert.equal(quad.cool_in.params.waterCircuit, 'cold');
  assert.equal(quad.hot_out.utility, 'coolingWater');
  assert.equal(quad.hot_out.params.waterCircuit, 'hot');

  for (const type of ['cyclotron70', 'cyclotron230']) {
    const ports = getUtilityPortsV2(type);
    assert.equal(ports.cool_in.utility, 'waterSupplyPipe');
    assert.equal(ports.cool_in.params.waterCircuit, 'cold');
    assert.equal(ports.hot_out.utility, 'waterSupplyPipe');
    assert.equal(ports.hot_out.params.waterCircuit, 'hot');
  }

  const badBeamlinePairs = [];
  for (const [type, def] of Object.entries(COMPONENTS)) {
    if (def.kind !== 'beamline') continue;
    const waterPorts = Object.entries(getUtilityPortsV2(type))
      .filter(([, port]) => ['coolingWater', 'waterSupplyPipe'].includes(port.utility));
    if (waterPorts.length === 0) continue;
    const cold = waterPorts.filter(([, port]) => port.params.waterCircuit === 'cold');
    const hot = waterPorts.filter(([, port]) => port.params.waterCircuit === 'hot');
    if (cold.length !== 1 || hot.length !== 1
        || cold[0][1].utility !== hot[0][1].utility) badBeamlinePairs.push(type);
  }
  assert.deepEqual(badBeamlinePairs, [],
    'every water-cooled beamline component has one blue inlet and one red outlet');

  const chiller = getUtilityPortsV2('chiller');
  assert.equal(Object.values(chiller)
    .filter(port => port.utility === 'coolingWater').length, 4);
  assert.equal(Object.values(chiller)
    .filter(port => port.utility === 'waterSupplyPipe').length, 4);
  const tank = getUtilityPortsV2('waterTank');
  const tankLukewarm = Object.entries(tank)
    .filter(([, port]) => port.utility === 'waterSupplyPipe'
      && !port.legacyOnly && port.params.waterCircuit === 'lukewarm');
  assert.equal(tankLukewarm.filter(([name]) => name.startsWith('lukewarm_out_')).length, 4);
  assert.equal(tankLukewarm.filter(([name]) => name.startsWith('lukewarm_in_')).length, 2);
  assert.ok(tankLukewarm.filter(([name]) => name.startsWith('lukewarm_in_'))
    .every(([, port]) => port.role === 'pass' && port.flowRole === 'sink'),
  'reservoir returns are optional inward-flow through ports');
  assert.equal(tank.water_supply_out.legacyOnly, true);
  assert.equal(chiller.room_in.params.waterCircuit, 'lukewarm');
  assert.equal(chiller.room_in.role, 'sink');
  assert.equal(chiller.return_hot_in.params.waterCircuit, 'hot');
  assert.equal(chiller.return_hot_in.role, 'source');
  assert.equal(chiller.return_hot_in.flowRole, 'sink');
  assert.equal(chiller.return_hot_in.params.processReturnCapacity, 300);
  assert.equal(chiller.reject_hot_out.params.waterCircuit, 'hot');
  assert.equal(chiller.reject_hot_out.role, 'sink');
  assert.equal(chiller.reject_hot_out.flowRole, 'source');
  assert.equal(chiller.reject_hot_out.params.heatLoad, 360,
    'condenser rejection includes the 300 kW process load and 60 kW compressor input');
  const tower = getUtilityPortsV2('coolingTower');
  assert.equal(tower.hot_in.params.waterCircuit, 'hot');
  assert.equal(tower.room_out.params.waterCircuit, 'lukewarm');

  const exchanger = getUtilityPortsV2('heatExchanger');
  assert.equal(exchanger.hot_in.params.waterCircuit, 'hot');
  assert.equal(exchanger.room_out.params.waterCircuit, 'lukewarm');
  assert.equal(exchanger.hot_in.params.heatRejectionCapacity, 1);

  const labChiller = getUtilityPortsV2('chillerUnit');
  assert.equal(labChiller.room_in.params.waterCircuit, 'lukewarm');
  assert.equal(labChiller.cold_out.params.waterCircuit, 'cold');
  assert.equal(labChiller.cold_out.params.capacity, 1);

  const lcw = getUtilityPortsV2('coolingManifold');
  assert.equal(lcw.supply_cold.flowRole, 'sink');
  assert.equal(lcw.supply_hot.flowRole, 'source',
    'the LCW manifold sends its collected hot return into the rigid header');
  const distributor = getUtilityPortsV2('waterDistributor2');
  assert.equal(distributor.supply_pipe_1.params.waterCircuit, 'cold');
  assert.equal(distributor.supply_pipe_1.flowRole, 'sink');
  assert.equal(distributor.supply_pipe_2.params.waterCircuit, 'hot');
  assert.equal(distributor.supply_pipe_2.flowRole, 'source',
    'the distributor hot Water Supply Pipe connector is an outlet');
}

console.log('\n--- hot/cold topology and wall rules ---');
{
  const state = {
    placeables: [item('cy', 'cyclotron70', 0, 0), item('tower', 'coolingTower', 4, 0)],
    utilityLines: new Map(),
    wallOccupied: {},
  };
  const mismatch = validateDrawLine(state, {
    utilityType: 'waterSupplyPipe',
    start: { placeableId: 'tower', portName: 'hot_in' },
    end: { placeableId: 'cy', portName: 'cool_in' },
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'water_circuit_mismatch');

  const plantState = {
    placeables: [item('tank', 'waterTank', 0, 0), item('ch', 'chiller', 4, 0)],
    utilityLines: new Map(), wallOccupied: {},
  };
  const roomTransfer = validateDrawLine(plantState, {
    utilityType: 'waterSupplyPipe',
    start: { placeableId: 'tank', portName: 'lukewarm_out_1' },
    end: { placeableId: 'ch', portName: 'room_in' },
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  });
  assert.equal(roomTransfer.ok, true);
  assert.equal(roomTransfer.line.waterCircuit, 'lukewarm',
    'a rigid line inherits lukewarm service from its equipment ports');
  assert.equal(roomTransfer.line.routeHeightMeters,
    UtilityRegistry.types.waterSupplyPipe.runHeightsByWaterCircuit.lukewarm);

  const wrongPlantPair = validateDrawLine({
    placeables: [item('tower', 'coolingTower', 0, 0), item('ch', 'chiller', 4, 0)],
    utilityLines: new Map(), wallOccupied: {},
  }, {
    utilityType: 'waterSupplyPipe',
    start: { placeableId: 'tower', portName: 'hot_in' },
    end: { placeableId: 'ch', portName: 'room_in' },
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  });
  assert.equal(wrongPlantPair.reason, 'water_circuit_mismatch',
    'hot rejection cannot be connected to a lukewarm chiller inlet');

  const crossingState = {
    placeables: [], utilityLines: new Map(),
    wallOccupied: { '1,0,w': 'interiorWall' },
  };
  for (const utilityType of ['coolingWater', 'waterSupplyPipe']) {
    const blocked = validateDrawLine(crossingState, {
      utilityType, waterCircuit: 'cold',
      path: [{ col: 0, row: 0 }, { col: 2, row: 0 }],
      ...(utilityType === 'coolingWater'
        ? { cablePath: [{ col: 0, row: 0 }, { col: 2, row: 0 }] } : {}),
    });
    assert.equal(blocked.reason, 'wall_pass_through_required');
  }

  const legacyState = {
    placeables: [
      item('ch', 'chiller', 0, 0), item('q', 'quadrupole', 2, 0),
      item('dist', 'waterDistributor2', 2, 2),
    ],
    utilityLines: new Map(), wallOccupied: {},
  };
  legacyState.utilityLines.set('legacyCold', {
    id: 'legacyCold', utilityType: 'coolingWater',
    start: { placeableId: 'ch', portName: 'cool_out' },
    end: { placeableId: 'q', portName: 'cool_in' },
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  });
  const legacyCrossing = {
    utilityType: 'coolingWater', waterCircuit: 'hot',
    start: { placeableId: 'q', portName: 'hot_out' },
    end: { placeableId: 'dist', portName: 'water_line_2' },
    path: [{ col: 2, row: -2 }, { col: 2, row: 0 }],
  };
  assert.equal(validateDrawLine(legacyState, legacyCrossing).ok, true,
    'legacy untagged cold lines are inferred from their ports when hot lines cross');
  legacyState.utilityLines.set('hotCrossing', { id: 'hotCrossing', ...legacyCrossing });
  assert.equal(discoverNetworks('coolingWater', legacyState.utilityLines,
    makeDefaultPortLookup(legacyState)).length, 2,
  'a legacy cold endpoint contact does not join the new hot return circuit');
}

console.log('\n--- rigid high-flow loop solves evaporator and condenser circuits separately ---');
{
  const state = {
    placeables: [
      item('grid', 'gridServicePoint', 0, 4),
      item('ch', 'chiller', 0, 0),
      item('cy', 'cyclotron70', 4, 0),
      item('tower', 'coolingTower', 8, 0),
      item('tank', 'waterTank', 6, 2),
    ],
    beamPipes: [], utilityLines: new Map(), utilityNetworkState: new Map(),
  };
  state.utilityLines.set('hvCh', line('hvCh', 'hvCable',
    { placeableId: 'grid', portName: 'hv_out_1' },
    { placeableId: 'ch', portName: 'hv_in' }, null, 4));
  state.utilityLines.set('hvTower', line('hvTower', 'hvCable',
    { placeableId: 'grid', portName: 'hv_out_2' },
    { placeableId: 'tower', portName: 'hv_in' }, null, 5));
  state.utilityLines.set('cold', line('cold', 'waterSupplyPipe',
    { placeableId: 'ch', portName: 'supply_cold_out' },
    { placeableId: 'cy', portName: 'cool_in' }, 'cold', 0));
  state.utilityLines.set('hot', line('hot', 'waterSupplyPipe',
    { placeableId: 'ch', portName: 'return_hot_in' },
    { placeableId: 'cy', portName: 'hot_out' }, 'hot', 1));
  state.utilityLines.set('rejectHot', line('rejectHot', 'waterSupplyPipe',
    { placeableId: 'tower', portName: 'hot_in' },
    { placeableId: 'ch', portName: 'reject_hot_out' }, 'hot', 3));
  state.utilityLines.set('room', line('room', 'waterSupplyPipe',
    { placeableId: 'tower', portName: 'room_out' },
    { placeableId: 'tank', portName: 'lukewarm_in_1' }, 'lukewarm', 2));
  state.utilityLines.set('roomTank', line('roomTank', 'waterSupplyPipe',
    { placeableId: 'tank', portName: 'lukewarm_out_1' },
    { placeableId: 'ch', portName: 'room_in' }, 'lukewarm', 2));
  const runner = new SolveRunner({ state, registry: UtilityRegistry,
    getDefinition: type => COMPONENTS[type] });
  runner.runSolve(state);
  const flows = [...state.utilityNetworkData.get('waterSupplyPipe').values()];
  assert.deepEqual(flows.map(flow => flow.waterCircuit).sort(), ['cold', 'hot', 'hot', 'lukewarm']);
  const cold = flows.find(flow => flow.waterCircuit === 'cold');
  const hot = flows.find(flow => flow.waterCircuit === 'hot'
    && flow.perSinkQuality['cy:hot_out'] != null);
  const rejectHot = flows.find(flow => flow.waterCircuit === 'hot'
    && flow.perSinkQuality['ch:reject_hot_out'] != null);
  const room = flows.find(flow => flow.waterCircuit === 'lukewarm');
  assert.equal(cold.totalCapacity, 300);
  assert.equal(cold.totalDemand, 310);
  assert.equal(hot.totalCapacity, 300);
  assert.equal(hot.totalDemand, 310);
  assert.equal(rejectHot.totalCapacity, 800);
  assert.equal(rejectHot.totalDemand, 360);
  assert.equal(room.totalCapacity, 800);
  assert.equal(room.totalDemand, 360);
  assert.equal(room.storageCapacityL, 500);
  assert.equal(room.supplyRateLPerTick, 1);
  assert.equal(room.evaporationL, 7.2);
  const roomPersistent = state.utilityNetworkState.get(room.networkId);
  assert.equal(roomPersistent.reservoirVolumeL, 493.8,
    'the condenser reservoir supplies one litre and loses 7.2 litres of process-plus-compressor heat');
}

console.log('\n--- distributors bridge pipe capacity without joining hot and cold headers ---');
{
  const state = {
    placeables: [
      item('grid', 'gridServicePoint', 0, 4),
      item('ch', 'chiller', 0, 0), item('tower', 'coolingTower', 8, 0),
      item('coldDist', 'waterDistributor2', 2, 0),
      item('hotDist', 'waterDistributor2', 6, 0),
    ],
    beamPipes: [{ id: 'bp', path: [{ col: 3, row: 2 }, { col: 5, row: 2 }], subL: 8,
      placements: [{ id: 'q', type: 'quadrupole', position: 0.5, params: {} }] }],
    utilityLines: new Map(), utilityNetworkState: new Map(),
  };
  state.utilityLines.set('hvCh', line('hvCh', 'hvCable',
    { placeableId: 'grid', portName: 'hv_out_1' },
    { placeableId: 'ch', portName: 'hv_in' }, null, 4));
  state.utilityLines.set('hvTower', line('hvTower', 'hvCable',
    { placeableId: 'grid', portName: 'hv_out_2' },
    { placeableId: 'tower', portName: 'hv_in' }, null, 5));
  state.utilityLines.set('pipeCold', line('pipeCold', 'waterSupplyPipe',
    { placeableId: 'ch', portName: 'supply_cold_out' },
    { placeableId: 'coldDist', portName: 'supply_pipe_1' }, 'cold', 0));
  state.utilityLines.set('lineCold', line('lineCold', 'coolingWater',
    { placeableId: 'coldDist', portName: 'water_line_1' },
    { placeableId: 'q', portName: 'cool_in' }, 'cold', 1));
  state.utilityLines.set('pipeHot', line('pipeHot', 'waterSupplyPipe',
    { placeableId: 'ch', portName: 'return_hot_in' },
    { placeableId: 'hotDist', portName: 'supply_pipe_2' }, 'hot', 2));
  state.utilityLines.set('lineHot', line('lineHot', 'coolingWater',
    { placeableId: 'hotDist', portName: 'water_line_2' },
    { placeableId: 'q', portName: 'hot_out' }, 'hot', 3));
  const runner = new SolveRunner({ state, registry: UtilityRegistry,
    getDefinition: type => COMPONENTS[type] });
  runner.runSolve(state);
  const flows = [...state.utilityNetworkData.get('coolingWater').values()];
  assert.equal(flows.length, 2);
  assert(flows.every(flow => flow.importedCapacity > 0));
  assert(flows.every(flow => flow.perSinkQuality[Object.keys(flow.perSinkQuality)[0]] === 1));
}

console.log('\n--- wall penetrations keep two pipe circuits isolated ---');
{
  const state = {
    placeables: [item('wall', 'waterSupplyWallPassThrough2x2', 0, 0)],
    beamPipes: [], utilityLines: new Map(),
  };
  state.utilityLines.set('c1', line('c1', 'waterSupplyPipe', null,
    { placeableId: 'wall', portName: 'supply_front_1' }, 'cold', 0));
  state.utilityLines.set('c2', line('c2', 'waterSupplyPipe',
    { placeableId: 'wall', portName: 'supply_back_1' }, null, 'cold', 1));
  state.utilityLines.set('h1', line('h1', 'waterSupplyPipe', null,
    { placeableId: 'wall', portName: 'supply_front_2' }, 'hot', 2));
  state.utilityLines.set('h2', line('h2', 'waterSupplyPipe',
    { placeableId: 'wall', portName: 'supply_back_2' }, null, 'hot', 3));
  const networks = discoverNetworks('waterSupplyPipe', state.utilityLines,
    makeDefaultPortLookup(state));
  assert.equal(networks.length, 2);
}

console.log('\n--- independent rigid runs replace the universal bus ---');
{
  const heights = [
    utilityLineHeight('cryoTransfer'),
    utilityLineHeight('waterSupplyPipe', UtilityRegistry.types.waterSupplyPipe
      .runHeightsByWaterCircuit.cold),
    utilityLineHeight('waterSupplyPipe', UtilityRegistry.types.waterSupplyPipe
      .runHeightsByWaterCircuit.lukewarm),
    utilityLineHeight('waterSupplyPipe', UtilityRegistry.types.waterSupplyPipe
      .runHeightsByWaterCircuit.hot),
    utilityLineHeight('rfWaveguide'),
    utilityLineHeight('vacuumPipe'),
  ];
  assert.equal(heights[1], heights[3], 'cold and hot rigid water share one twin-pipe elevation');
  assert.equal(new Set(heights).size, heights.length - 1);
  assert.equal(COMPONENTS.universalUtilityBus.deprecated, true);
  assert.equal(componentPaletteEntries(COMPONENTS, 'power')
    .some(({ key }) => key === 'universalUtilityBus'), false);
}

console.log('\nAll water-supply-pipe tests passed.');
