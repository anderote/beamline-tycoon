import test from 'node:test';
import assert from 'node:assert/strict';

import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { INDOOR_HV_RACK_TERMINAL_Y, PORT_ANCHOR_OVERRIDES } from '../src/data/utility-port-anchors.js';
import { MODES } from '../src/data/modes.js';
import { Game } from '../src/game/Game.js';
import { usesFloorOccupancy } from '../src/game/placement.js';
import { discoverNetworks, makeDefaultPortLookup } from '../src/utility/network-discovery.js';
import { findUtilityTapMount, utilityTapMountCandidates } from '../src/utility/tap-mounts.js';

function gameWithFunds(seed = 8801) {
  const game = new Game(new BeamlineRegistry(), { seed });
  game.state.resources.funding = 1e9;
  game.state.resources.spares = 1e9;
  return game;
}

test('elevated wire tray carries power and data below indoor HV terminals', () => {
  const tray = PLACEABLES.elevatedWireTray;
  const ports = getUtilityPortsV2(tray.id);
  assert.equal(tray.deprecated, undefined);
  assert.equal(tray.mount, 'overhead');
  assert.equal(usesFloorOccupancy(tray), false);
  assert.equal(PORT_ANCHOR_OVERRIDES.elevatedWireTray._default.y, 1.78);
  assert.equal(Math.max(...tray.parts.map(part => (part.y + part.h) * 0.5)), 1.78,
    'the visible tray deck tops out at the authored cable datum');
  assert.ok(PORT_ANCHOR_OVERRIDES.elevatedWireTray._default.y < INDOOR_HV_RACK_TERMINAL_Y);
  assert.equal(Object.values(ports).filter(port => port.utility === 'powerCable').length, 8);
  assert.equal(Object.values(ports).filter(port => port.utility === 'dataFiber').length, 2);
  assert.deepEqual(tray.electricalGroups.powerCable, [
    ['pwr_in_1', 'pwr_out_1'], ['pwr_in_2', 'pwr_out_2'],
    ['pwr_in_3', 'pwr_out_3'], ['pwr_in_4', 'pwr_out_4'],
  ]);
  assert.ok(MODES.infra.categories.dataControls.subsections.transport
    .linkedPlaceables.includes(tray.id));
  assert.equal(PLACEABLES.indoorHvCableCornerRack.deprecated, true);
});

test('service transformer mounts to a wood-pole tap with four power outlets', () => {
  const game = gameWithFunds();
  const poleId = game.placePlaceable({
    type: 'utilityPole', col: 12, row: 12, subCol: 0, subRow: 0, free: true,
  });
  assert.ok(poleId);
  const candidates = utilityTapMountCandidates(game.state);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].host.id, poleId);
  assert.equal(candidates[0].portName, 'hv_tap');

  const cursor = {
    col: candidates[0].position.x / 2,
    row: candidates[0].position.z / 2,
  };
  const mount = findUtilityTapMount(game.state, cursor);
  const transformerId = game.placePlaceable({
    type: 'poleMountTransformer',
    utilityMount: mount.utilityMount,
    free: true,
  });
  assert.ok(transformerId);
  const transformer = game.getPlaceable(transformerId);
  assert.deepEqual(transformer.utilityMount, {
    hostPlaceableId: poleId,
    portName: 'hv_tap',
    connectionKind: 'hvDistributionTap',
  });
  assert.equal(Object.values(getUtilityPortsV2('poleMountTransformer'))
    .filter(port => port.utility === 'powerCable' && port.role === 'source').length, 4);
  assert.equal(usesFloorOccupancy(PLACEABLES.poleMountTransformer), false);

  const mountLines = [...game.state.utilityLines.values()]
    .filter(line => line.mountConnectionPlaceableId === transformerId);
  assert.equal(mountLines.length, 1);
  assert.deepEqual(mountLines[0].start, { placeableId: poleId, portName: 'hv_tap' });
  assert.deepEqual(mountLines[0].end, { placeableId: transformerId, portName: 'hv_in' });
  assert.equal(mountLines[0].subL, 0);

  const networks = discoverNetworks(
    'hvCable', game.state.utilityLines, makeDefaultPortLookup(game.state),
  );
  assert.equal(networks.length, 1);
  assert.ok(networks[0].ports.some(port => (
    port.placeableId === poleId && port.portName === 'hv_tap'
  )));
  assert.ok(networks[0].ports.some(port => (
    port.placeableId === transformerId && port.portName === 'hv_in'
  )));

  const restored = gameWithFunds(8803);
  restored._applyState(JSON.parse(game.serialize({ includeLog: false, includeAux: false })));
  assert.deepEqual(restored.getPlaceable(transformerId).utilityMount, transformer.utilityMount);
  assert.equal([...restored.state.utilityLines.values()]
    .some(line => line.mountConnectionPlaceableId === transformerId), true,
  'the direct tap connection survives save/load');

  assert.equal(game.placePlaceable({
    type: 'poleMountTransformer', utilityMount: mount.utilityMount, free: true,
  }), false, 'one physical tap accepts only one mounted service box');

  assert.equal(game.removePlaceable(poleId), true);
  assert.equal(game.getPlaceable(transformerId), null);
  assert.equal([...game.state.utilityLines.values()]
    .some(line => line.mountConnectionPlaceableId === transformerId), false);
});

test('service transformer can move between capability-matched indoor side taps', () => {
  const game = gameWithFunds(8802);
  const rack4 = game.placePlaceable({
    type: 'indoorHvCableRack', col: 8, row: 8, subCol: 0, subRow: 0, free: true,
  });
  const rack2 = game.placePlaceable({
    type: 'indoorHvCableRack2Way', col: 14, row: 8, subCol: 0, subRow: 0, free: true,
  });
  const candidates = utilityTapMountCandidates(game.state);
  assert.deepEqual(candidates.map(item => `${item.host.id}:${item.portName}`).sort(), [
    `${rack2}:hv_tap_left`, `${rack4}:hv_tap_left`, `${rack4}:hv_tap_right`,
  ].sort());

  const first = candidates.find(item => item.host.id === rack4 && item.portName === 'hv_tap_right');
  const firstMount = findUtilityTapMount(game.state, {
    col: first.position.x / 2, row: first.position.z / 2,
  });
  const transformerId = game.placePlaceable({
    type: 'poleMountTransformer', utilityMount: firstMount.utilityMount, free: true,
  });
  assert.ok(transformerId);

  const second = utilityTapMountCandidates(game.state)
    .find(item => item.host.id === rack2 && item.portName === 'hv_tap_left');
  const secondMount = findUtilityTapMount(game.state, {
    col: second.position.x / 2, row: second.position.z / 2,
  }, { ignorePlaceableId: transformerId });
  assert.equal(game.movePlaceable(transformerId, {
    utilityMount: secondMount.utilityMount,
  }), true);
  assert.equal(game.getPlaceable(transformerId).utilityMount.hostPlaceableId, rack2);
  const line = [...game.state.utilityLines.values()]
    .find(item => item.mountConnectionPlaceableId === transformerId);
  assert.deepEqual(line.start, { placeableId: rack2, portName: 'hv_tap_left' });
  assert.equal(game.reanchorUtilityLinesForPlaceable(transformerId), 0);
  assert.deepEqual(line.end, { placeableId: transformerId, portName: 'hv_in' },
    'generic cable re-anchoring leaves the internal tap connection intact');
  assert.equal(game.movePlaceable(rack2, { col: 20, row: 20 }), false,
    'a rack cannot move out from under mounted service equipment');
});
