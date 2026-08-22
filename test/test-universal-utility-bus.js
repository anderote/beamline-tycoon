import assert from 'node:assert/strict';
import { UtilityLineSystem } from '../src/utility/UtilityLineSystem.js';
import { discoverNetworks } from '../src/utility/network-discovery.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { COMPONENTS } from '../src/data/components.js';
import { UniversalUtilityBusTool } from '../src/input/universal-utility-bus-tool.js';
import { UtilityLineInputController } from '../src/input/UtilityLineInputController.js';
import { standardPaletteKind } from '../src/ui/palette-collection.js';
import coolingWater from '../src/utility/types/coolingWater.js';
import { UTILITY_TYPE_LIST } from '../src/utility/registry.js';
import {
  UNIVERSAL_BUS_MAX_CHANNELS,
  UniversalUtilityBusSystem,
} from '../src/utility/UniversalUtilityBusSystem.js';
import {
  UNIVERSAL_BUS_HALF_WIDTH_METERS,
  UNIVERSAL_BUS_LANE_LIST,
  universalBusLane,
} from '../src/utility/universal-bus-layout.js';
import {
  canBuildUniversalBus,
  universalBusFootprintCells,
} from '../src/utility/universal-bus-clearance.js';
import { canPlace } from '../src/game/placement.js';
import { gridToIso } from '../src/renderer/grid.js';

assert.equal(PLACEABLES.universalUtilityBus, undefined,
  'the bus is a drawn connection, not a placeable component');
assert.ok(COMPONENTS.universalUtilityBus?.isDrawnConnection,
  'the transport catalogue retains the drawn bus definition');
assert.equal(standardPaletteKind(COMPONENTS.universalUtilityBus), 'utilityBus',
  'the palette routes it through a line tool rather than component placement');
assert.equal(new UniversalUtilityBusTool().armedPlaceableId, null,
  'arming the bus cannot trigger the generic brick placement ghost');
assert.equal(UNIVERSAL_BUS_MAX_CHANNELS, 7,
  'the carrier exposes one designated lane for every registered utility');
assert.deepEqual(
  UNIVERSAL_BUS_LANE_LIST.map(lane => lane.utilityType).sort(),
  [...UTILITY_TYPE_LIST].sort(),
  'every registered utility has exactly one designated carrier lane');
assert.deepEqual(
  UNIVERSAL_BUS_LANE_LIST.filter(lane => lane.tier === 'top').map(lane => lane.utilityType),
  ['hvCable', 'powerCable', 'coolingWater', 'dataFiber', 'vacuumPipe', 'cryoTransfer', 'rfWaveguide'],
  'every registered service occupies a fixed position on top of the wire tray');
assert.equal(UNIVERSAL_BUS_LANE_LIST.some(lane => lane.tier !== 'top'), false,
  'the universal bus has no below-tray service lanes');

const state = {
  placeables: [], beamPipes: [], wallOccupied: {},
  utilityLines: new Map(), utilityBuses: [], subgridOccupied: {}, infraOccupied: {},
};
let nextLine = 1, nextBus = 1;
const lines = new UtilityLineSystem({
  state, nextLineId: () => `line_${nextLine++}`,
});
const buses = new UniversalUtilityBusSystem({
  state, utilityLineSystem: lines, nextBusId: () => `bus_${nextBus++}`,
});

const busId = buses.addBus({
  path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  taps: [0, 1, 2, 3, 4].map((col, index) => ({
    id: `tap_${index}`, index, point: { col, row: 0, subCol: 0, subRow: 0 },
  })),
  costFunding: 80000,
});
assert.equal(busId, 'bus_1');
assert.equal(state.utilityBuses[0].channels.length, 0, 'a new rack is utility-neutral');

const drawBusId = buses.addBus({
  path: [{ col: 0, row: 20 }, { col: 4, row: 20 }],
  taps: [0, 1, 2, 3, 4].map((col, index) => ({
    id: `draw_tap_${index}`, index, point: { col, row: 20, subCol: 0, subRow: 0 },
  })),
});
const gestureCosts = [];
const drawGame = {
  state,
  utilityBusSystem: buses,
  utilityLineSystem: lines,
  commitGesture({ cost, mutate }) {
    gestureCosts.push(cost || null);
    return mutate();
  },
};
const laneController = new UtilityLineInputController({ game: drawGame, renderer: {} });
laneController.setUtilityType('vacuumPipe');
const drawStart = gridToIso(0, 20);
const drawEnd = gridToIso(4, 20);
laneController.onMouseDown(drawStart.x, drawStart.y, 0, {});
laneController.onMouseMove(drawEnd.x, drawEnd.y, {});
assert.equal(laneController.preview?.busLane, true,
  'a tap-to-tap drag previews the utility in its elevated carrier lane');
assert.equal(laneController.dragCost, 0,
  'populating a prepaid carrier lane does not charge for a duplicate loose run');
laneController.onMouseUp(drawEnd.x, drawEnd.y, 0, {});
const drawnChannelId = buses.channelLineId(drawBusId, 'vacuumPipe');
assert.ok(drawnChannelId, 'dragging a utility along the bus visibly populates its lane');
assert.equal(state.utilityLines.get(drawnChannelId)?.manifold?.busId, drawBusId,
  'the gesture creates the real full-length bus backbone');
assert.equal([...state.utilityLines.values()].filter(line =>
  line.manifold?.busId === drawBusId).length, 1,
  'the gesture does not add an overlapping partial branch over that backbone');
assert.deepEqual(gestureCosts, [null], 'the lane-population gesture remains free');

const busCells = universalBusFootprintCells(state.utilityBuses[0].path);
assert.ok(busCells.some(cell => cell.row === -1 && cell.subRow === 3)
  && busCells.some(cell => cell.row === 0 && cell.subRow === 0),
  'a bus on a quarter-grid line reserves the two floor strips beneath its tray');
assert.ok(!busCells.some(cell => cell.row === 0 && cell.subRow === 1),
  'the next subtile remains free so equipment can build flush alongside the bus');
const oneCellEquipment = {
  mount: 'ground',
  footprintCells: (col, row, subCol, subRow) => [{ col, row, subCol, subRow }],
};
assert.equal(canPlace({ state }, oneCellEquipment, 0, 0, 0, 0).ok, false,
  'ordinary floor equipment cannot build underneath the bus');
assert.equal(canPlace({ state }, oneCellEquipment, 0, 0, 0, 1).ok, true,
  'ordinary floor equipment can build directly alongside the bus');
assert.equal(canBuildUniversalBus(state, [{ col: 2, row: -1 }, { col: 2, row: 1 }]).ok, false,
  'a second bus cannot cross the first bus corridor');
state.subgridOccupied['10,0,0,0'] = { id: 'existing_equipment' };
assert.equal(buses.addBus({
  path: [{ col: 10, row: 0 }, { col: 12, row: 0 }], taps: [],
}), null, 'bus construction refuses to run underneath existing equipment');
delete state.subgridOccupied['10,0,0,0'];

const branchId = buses.connectLine({
  utilityType: 'powerCable',
  line: {
    start: null, end: null,
    path: [{ col: 2, row: 0 }, { col: 2, row: 1 }],
  },
  busTapIds: { start: busId, end: null },
});
assert.ok(branchId, 'a branch onto the rack commits');
const powerChannel = state.utilityBuses[0].channels[0];
assert.equal(powerChannel.utilityType, 'powerCable');
assert.equal(state.utilityLines.get(branchId).tapLineIds.start, powerChannel.lineId,
  'the branch joins the generated power backbone');
assert.equal(state.utilityLines.get(powerChannel.lineId).manifold.busId, busId,
  'the generated backbone retains its rack identity');

const reused = buses.ensureChannel(busId, 'powerCable');
assert.equal(reused.created, false, 'more power connections reuse one network channel');
assert.equal(reused.lineId, powerChannel.lineId);
const secondBranchId = buses.connectLine({
  utilityType: 'powerCable',
  line: {
    start: null, end: null,
    path: [{ col: 3, row: 0 }, { col: 3, row: -1 }],
  },
  busTapIds: { start: busId, end: null },
});
const powerNetworks = discoverNetworks('powerCable', state.utilityLines, () => null);
assert.equal(powerNetworks.length, 1, 'all branches on one channel discover as one network');
assert.deepEqual(new Set(powerNetworks[0].lineIds),
  new Set([powerChannel.lineId, branchId, secondBranchId]));

for (const utilityType of ['vacuumPipe', 'dataFiber']) {
  assert.equal(buses.ensureChannel(busId, utilityType).ok, true);
}
const coolingBranchId = buses.connectLine({
  utilityType: 'coolingWater',
  line: {
    start: null, end: null,
    path: [{ col: 1, row: 0 }, { col: 1, row: 1 }],
  },
  busTapIds: { start: busId, end: null },
});
assert.ok(coolingBranchId, 'a cooling-water line can claim and connect to the rack');
for (const utilityType of ['cryoTransfer', 'rfWaveguide', 'hvCable']) {
  assert.equal(buses.ensureChannel(busId, utilityType).ok, true,
    `${utilityType} can populate its own carrier position`);
}
assert.equal(state.utilityBuses[0].channels.length, UNIVERSAL_BUS_MAX_CHANNELS,
  'all seven utility types coexist on one carrier');
assert.deepEqual(
  Object.fromEntries(state.utilityBuses[0].channels.map(channel => [channel.utilityType, channel.slot])),
  Object.fromEntries(UNIVERSAL_BUS_LANE_LIST.map(lane => [lane.utilityType, lane.slot])),
  'each utility occupies its designated slot regardless of connection order');

const balanceBusId = buses.addBus({
  path: [{ col: 0, row: 10 }, { col: 4, row: 10 }],
  taps: [0, 1, 2, 3, 4].map((col, index) => ({
    id: `balance_tap_${index}`, index, point: { col, row: 10, subCol: 0, subRow: 0 },
  })),
});
const balancePorts = [
  ['source_a', 'out', 'source', {
    capacity: 60, heatRejectionCapacity: 60, storageCapacityL: 300,
    supplyRateLPerTick: 2,
  }],
  ['source_b', 'out', 'source', {
    capacity: 50, heatRejectionCapacity: 50, storageCapacityL: 200,
    supplyRateLPerTick: 2,
  }],
  ['sink_a', 'in', 'sink', { heatLoad: 40 }],
  ['sink_b', 'in', 'sink', { heatLoad: 50 }],
];
for (let index = 0; index < balancePorts.length; index++) {
  const [placeableId, portName] = balancePorts[index];
  const id = buses.connectLine({
    utilityType: 'coolingWater',
    line: {
      start: null, end: null,
      path: [{ col: index, row: 10 }, { col: index, row: 11 }],
    },
    busTapIds: { start: balanceBusId, end: null },
  });
  assert.ok(id, `${placeableId} can branch from a periodic cooling tap`);
  state.utilityLines.get(id).end = { placeableId, portName };
}
const specs = new Map(balancePorts.map(([id, name, role, params]) => [
  `${id}:${name}`, { utility: 'coolingWater', role, params },
]));
const balancedNetworks = discoverNetworks(
  'coolingWater', state.utilityLines,
  (placeableId, portName) => specs.get(`${placeableId}:${portName}`) || null,
);
const balanced = balancedNetworks.find(network => network.sources.length === 2);
assert.ok(balanced, 'all sources and sinks plugged into periodic taps form one bus network');
assert.equal(balanced.sources.length, 2);
assert.equal(balanced.sinks.length, 2);
const solved = coolingWater.solve(balanced, { reservoirVolumeL: null }, {});
assert.equal(solved.flowState.totalCapacity, 110,
  'the universal network adds every connected cooling source');
assert.equal(solved.flowState.totalDemand, 90,
  'the universal network adds every connected cooling demand');
assert.equal(solved.flowState.perSinkQuality['sink_a:in'], 1,
  'combined bus supply serves connected demand through the ordinary solver');

for (const utilityType of ['powerCable', 'vacuumPipe', 'rfWaveguide',
  'coolingWater', 'cryoTransfer', 'dataFiber', 'hvCable']) {
  const controller = new UtilityLineInputController({
    game: { state, utilityBusSystem: buses },
    renderer: {
      raycastUtilityLine: () => ({
        busId, universalUtilityBus: true, worldPos: { x: 3.8, z: 0.18 },
      }),
    },
  });
  controller.setUtilityType(utilityType);
  const snap = controller._snapToNearest(9999, 9999, { x: 20, y: 20 });
  assert.equal(snap?.busId, busId,
    `${utilityType} can snap directly to the visible elevated tray`);
  assert.equal(snap?.busTap, true);
}

const THREE_NS = await import('three');
globalThis.THREE = THREE_NS;
const { UtilityLineBuilderV2 } = await import('../src/renderer3d/utility-line-builder-v2.js');
const parent = new THREE_NS.Group();
const builder = new UtilityLineBuilderV2();
builder.setPreview({
  utilityType: 'powerCable', rack: true, valid: true,
  path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
}, parent);
assert.equal(builder._previewObject?.userData?.isUniversalUtilityBusPreview, true,
  'drag preview is a ladder tray, not a component box or thick cable');
assert.ok(builder._previewObject.children.length >= 6,
  'drag preview contains two rails and repeated crossbars');
builder.setPreview(null, parent);
const vacuumLane = universalBusLane('vacuumPipe');
builder.setPreview({
  utilityType: 'vacuumPipe', busLane: true, valid: true,
  routeHeightMeters: vacuumLane.runY,
  path: [{ col: 0, row: 20 }, { col: 4, row: 20 }],
}, parent);
const lanePreviewBounds = new THREE_NS.Box3().setFromObject(builder._previewObject);
const lanePreviewCenter = lanePreviewBounds.getCenter(new THREE_NS.Vector3());
assert.ok(lanePreviewBounds.min.y > 0.7,
  'the tap-to-tap preview appears above the tray instead of on the floor');
assert.ok(Math.abs(lanePreviewCenter.z - (40 + vacuumLane.lateral)) < 1e-6,
  'the tap-to-tap preview uses the selected utility lane offset');
builder.setPreview(null, parent);
builder.build(state.utilityLines, new Map(), parent, { state });
const renderedRackGroups = parent.children.filter(group =>
  group.userData?.isUniversalUtilityBus && group.userData.busId === busId);
assert.equal(renderedRackGroups.filter(group => group.userData.channelSlot == null).length, 1,
  'the neutral metal rack renders independently of its utility channels');
const carrierGroup = renderedRackGroups.find(group => group.userData.channelSlot == null);
assert.equal(
  carrierGroup.children.filter(child => child.userData?.isUniversalUtilityBusHanger).length,
  state.utilityBuses[0].taps.length,
  'the wire tray renders one floor-standing support at every access point');
const carrierBounds = new THREE_NS.Box3().setFromObject(carrierGroup);
assert.ok(Math.abs(carrierBounds.min.y) < 1e-6,
  'the bus support feet sit on the ground plane instead of floating above it');
assert.equal(renderedRackGroups.filter(group => group.userData.channelSlot != null).length, 7,
  'all seven populated service runs remain visible on the carrier');
assert.deepEqual(
  renderedRackGroups.filter(group => group.userData.channelSlot != null)
    .map(group => group.userData.channelSlot).sort(),
  [0, 1, 2, 3, 4, 5, 6],
  'rendered channels retain separate rack slots');
for (const channel of renderedRackGroups.filter(group => group.userData.channelSlot != null)) {
  const lane = universalBusLane(channel.userData.utilityType);
  assert.equal(channel.userData.busLaneTier, lane.tier,
    `${channel.userData.utilityType} renders on the ${lane.tier} carrier tier`);
  assert.equal(channel.userData.routeHeightMeters, lane.runY,
    `${channel.userData.utilityType} uses its designated carrier height`);
  const channelBounds = new THREE_NS.Box3().setFromObject(channel);
  const channelCenter = channelBounds.getCenter(new THREE_NS.Vector3());
  assert.ok(Math.abs(channelCenter.z - lane.lateral) < 1e-6,
    `${channel.userData.utilityType} geometry occupies its designated lateral lane`);
  assert.ok(channelBounds.min.y > 0.7,
    `${channel.userData.utilityType} geometry rides above the tray deck`);
  const ports = [];
  channel.traverse(object => {
    if (object.userData?.isUniversalUtilityBusPort) ports.push(object);
  });
  assert.equal(ports.length, state.utilityBuses[0].taps.length,
    `${channel.userData.utilityType} renders one utility-specific port at every rack tap`);
  assert.ok(ports.every(port => port.userData.utilityType === channel.userData.utilityType),
    'each periodic port is tagged as the utility carried by its lane');
}
const channelBoundsByLane = renderedRackGroups
  .filter(group => group.userData.channelSlot != null)
  .map(group => ({
    utilityType: group.userData.utilityType,
    bounds: new THREE_NS.Box3().setFromObject(group),
  }))
  .sort((a, b) => universalBusLane(a.utilityType).lateral
    - universalBusLane(b.utilityType).lateral);
assert.ok(channelBoundsByLane[0].bounds.min.z > -UNIVERSAL_BUS_HALF_WIDTH_METERS
  && channelBoundsByLane.at(-1).bounds.max.z < UNIVERSAL_BUS_HALF_WIDTH_METERS,
  'the outermost service fittings remain inside the tray rails');
for (let index = 1; index < channelBoundsByLane.length; index++) {
  const left = channelBoundsByLane[index - 1];
  const right = channelBoundsByLane[index];
  assert.ok(left.bounds.max.z < right.bounds.min.z,
    `${left.utilityType} (${left.bounds.max.z}) and ${right.utilityType} `
      + `(${right.bounds.min.z}) remain visually distinct on top of the tray`);
}
const coolingBranchGroup = builder._lineGroups.get(coolingBranchId);
const coolingBranchBounds = new THREE_NS.Box3().setFromObject(coolingBranchGroup);
assert.ok(coolingBranchBounds.max.y > 0.9,
  'a cooling branch visibly rises and plugs into its periodic tray port');
builder.dispose(parent);
assert.equal(parent.children.length, 0, 'renderer teardown removes rack and channel meshes');

assert.equal(buses.removeBus(busId), true);
assert.equal(state.utilityBuses.length, 2, 'the unrelated buses remain installed');
assert.equal(state.utilityLines.size, 9,
  'removing the rack removes its backbones but leaves external branch ownership explicit');

console.log('universal utility bus tests passed');
