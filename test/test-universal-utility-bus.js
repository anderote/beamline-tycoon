import assert from 'node:assert/strict';
import { UtilityLineSystem } from '../src/utility/UtilityLineSystem.js';
import { discoverNetworks } from '../src/utility/network-discovery.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { COMPONENTS } from '../src/data/components.js';
import { UniversalUtilityBusTool } from '../src/input/universal-utility-bus-tool.js';
import { UtilityLineInputController } from '../src/input/UtilityLineInputController.js';
import { standardPaletteKind } from '../src/ui/palette-collection.js';
import {
  UNIVERSAL_BUS_MAX_CHANNELS,
  UniversalUtilityBusSystem,
} from '../src/utility/UniversalUtilityBusSystem.js';

assert.equal(PLACEABLES.universalUtilityBus, undefined,
  'the bus is a drawn connection, not a placeable component');
assert.ok(COMPONENTS.universalUtilityBus?.isDrawnConnection,
  'the transport catalogue retains the drawn bus definition');
assert.equal(standardPaletteKind(COMPONENTS.universalUtilityBus), 'utilityBus',
  'the palette routes it through a line tool rather than component placement');
assert.equal(new UniversalUtilityBusTool().armedPlaceableId, null,
  'arming the bus cannot trigger the generic brick placement ghost');

const state = {
  placeables: [], beamPipes: [], wallOccupied: {},
  utilityLines: new Map(), utilityBuses: [],
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
assert.equal(state.utilityBuses[0].channels.length, UNIVERSAL_BUS_MAX_CHANNELS,
  'four distinct utility types fill the four isolated channels');
assert.deepEqual(
  state.utilityBuses[0].channels.map(channel => channel.slot), [0, 1, 2, 3],
  'each utility occupies a stable visual channel');
assert.deepEqual(buses.ensureChannel(busId, 'cryoTransfer'), {
  ok: false, reason: 'bus_full',
}, 'a fifth utility type is rejected');

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
builder.build(state.utilityLines, new Map(), parent, { state });
const renderedRackGroups = parent.children.filter(group => group.userData?.isUniversalUtilityBus);
assert.equal(renderedRackGroups.filter(group => group.userData.channelSlot == null).length, 1,
  'the neutral metal rack renders independently of its utility channels');
assert.equal(renderedRackGroups.filter(group => group.userData.channelSlot != null).length, 4,
  'four colored channel runs visibly populate the rack');
assert.deepEqual(
  renderedRackGroups.filter(group => group.userData.channelSlot != null)
    .map(group => group.userData.channelSlot).sort(),
  [0, 1, 2, 3],
  'rendered channels retain separate rack slots');
builder.dispose(parent);
assert.equal(parent.children.length, 0, 'renderer teardown removes rack and channel meshes');

assert.equal(buses.removeBus(busId), true);
assert.equal(state.utilityBuses.length, 0);
assert.equal(state.utilityLines.size, 3,
  'removing the rack removes its backbones but leaves external branch ownership explicit');

console.log('universal utility bus tests passed');
