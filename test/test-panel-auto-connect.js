// Distribution-panel radius wiring: nearby free power plugs become ordinary,
// paid cables in one undoable action. Outlet count and radius remain real
// constraints; this is assisted drawing, not an implicit power bus.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import {
  commitPanelAutoConnect,
  connectedUtilityLineIds,
  disconnectAutoConnectDevices,
  planPanelAutoConnect,
  utilityAutoConnectProfile,
} from '../src/input/panel-auto-connect.js';
import { validateDrawLine } from '../src/utility/line-drawing.js';
import { InputHandler } from '../src/input/InputHandler.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

function item(id, type, col, row) {
  return {
    id, type, kind: type === 'quadrupole' ? 'beamline' : 'infrastructure',
    category: type === 'quadrupole' ? 'beamline' : 'infrastructure',
    col, row, subCol: 0, subRow: 0, dir: 0,
  };
}

function makeGame() {
  const game = new Game(new BeamlineRegistry(), { seed: 91 });
  game.state.resources.funding = 1e9;
  game.state.placeables.push(
    item('panel', 'powerPanel', 10, 10),
    item('near_1', 'quadrupole', 11, 10),
    item('near_2', 'quadrupole', 12, 10),
    item('near_3', 'quadrupole', 13, 10),
    item('near_4', 'quadrupole', 14, 10),
    item('near_5', 'quadrupole', 10, 14),
    item('far', 'quadrupole', 20, 10),
  );
  return game;
}

function powerLines(game) {
  return Array.from(game.state.utilityLines.values())
    .filter(line => line.utilityType === 'powerCable');
}

function linesOf(game, utilityType) {
  return Array.from(game.state.utilityLines.values())
    .filter(line => line.utilityType === utilityType);
}

console.log('\n--- 1. Radius and physical outlet constraints ---');
{
  assert(COMPONENTS.powerPanel.autoConnectRadius === 5,
    'compact panel has a five-tile assisted-wire radius');
  assert(COMPONENTS.sectionDistributionPanel.autoConnectRadius
      > COMPONENTS.powerPanel.autoConnectRadius
      && COMPONENTS.mainDistributionPanel.autoConnectRadius
      > COMPONENTS.sectionDistributionPanel.autoConnectRadius,
  'larger distribution panels have progressively larger reach');

  const game = makeGame();
  const plan = planPanelAutoConnect(game.state, 'panel');
  const ends = plan.stubs.map(stub => stub.end.placeableId);
  assert(plan.candidates === 5,
    `finds five free plugs inside the radius (got ${plan.candidates})`);
  assert(plan.stubs.length === 4 && plan.outlets === 4,
    `only four cables are promised by the four-outlet panel (got ${plan.stubs.length})`);
  assert(plan.skipped === 1, 'the fifth in-range plug is reported but left unconnected');
  assert(!ends.includes('far'), 'a plug outside the radius is untouched');
  assert(ends.join(',') === 'near_1,near_2,near_3,near_4',
    `nearest plugs win when outlets run out (got ${ends.join(',')})`);
  assert(plan.stubs.every(stub => validateDrawLine(game.state, {
    utilityType: 'powerCable',
    start: stub.start,
    end: stub.end,
    path: stub.path,
  }).ok), 'every promised cable is accepted by the normal line validator');
  assert(plan.totalSubL > 0 && plan.cost?.funding > 0,
    `the plan has a real measured cable cost ($${plan.cost?.funding || 0})`);
}

console.log('\n--- 2. Existing connections consume outlets and sinks ---');
{
  const game = makeGame();
  game.state.utilityLines.set('already', {
    id: 'already', utilityType: 'powerCable',
    start: { placeableId: 'panel', portName: 'pwr_out_1' },
    end: { placeableId: 'near_1', portName: 'pwr_in' },
    path: [{ col: 10.5, row: 10.5 }, { col: 11.25, row: 10.5 }],
  });
  const plan = planPanelAutoConnect(game.state, 'panel');
  const ends = plan.stubs.map(stub => stub.end.placeableId);
  assert(plan.outlets === 3 && plan.stubs.length === 3,
    `one occupied socket leaves three assisted cables (got ${plan.stubs.length})`);
  assert(!ends.includes('near_1'), 'an already-connected sink is not offered again');
  assert(plan.stubs.every(stub => stub.start.portName !== 'pwr_out_1'),
    'the occupied panel outlet is never reused');
}

console.log('\n--- 3. One paid commit and one undo ---');
{
  const game = makeGame();
  const plan = planPanelAutoConnect(game.state, 'panel');
  const fundingBefore = game.state.resources.funding;
  const undoBefore = game._undoStack.length;
  const committed = commitPanelAutoConnect(game, plan);
  assert(committed.length === 4 && powerLines(game).length === 4,
    `the button lands all four planned cables (got ${committed.length})`);
  assert(game.state.resources.funding === fundingBefore - plan.cost.funding,
    `funding is charged exactly once ($${plan.cost.funding})`);
  assert(game._undoStack.length === undoBefore + 1,
    'all auto-connected cables share one undo entry');
  game.undo();
  assert(powerLines(game).length === 0, 'one undo removes the whole assisted-wire gesture');
}

console.log('\n--- 4. Affordability is checked before mutation ---');
{
  const game = makeGame();
  const plan = planPanelAutoConnect(game.state, 'panel');
  game.state.resources.funding = Math.max(0, plan.cost.funding - 1);
  const fundingBefore = game.state.resources.funding;
  const undoBefore = game._undoStack.length;
  const committed = commitPanelAutoConnect(game, plan);
  assert(committed.length === 0 && powerLines(game).length === 0,
    'an unaffordable click adds no cables');
  assert(game.state.resources.funding === fundingBefore,
    'an unaffordable click spends nothing');
  assert(game._undoStack.length === undoBefore,
    'an unaffordable click adds no undo entry');
}

console.log('\n--- 5. A hovered distribution panel owns Tab without selection ---');
{
  const game = makeGame();
  const input = {
    game,
    _hoverTooltipTarget: 'placeable:panel',
    selectedPlaceableId: null,
    selectedPlaceableIds: new Set(),
    _selectionIdsForAnchor: InputHandler.prototype._selectionIdsForAnchor,
    _hoveredAutoConnectPanelId: InputHandler.prototype._hoveredAutoConnectPanelId,
    _selectedAutoConnectPanelId: InputHandler.prototype._selectedAutoConnectPanelId,
    panelAutoConnectTargetId: InputHandler.prototype.panelAutoConnectTargetId,
    _autoConnectPanel: id => { input.connectedPanelId = id; },
    _disconnectAutoConnectPanel: id => { input.disconnectedPanelId = id; },
  };
  let prevented = 0;
  const handled = InputHandler.prototype.handlePanelAutoConnectKey.call(input, {
    key: 'Tab', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    repeat: false, preventDefault: () => { prevented++; },
  });
  assert(handled && prevented === 1 && input.connectedPanelId === 'panel',
    'plain Tab auto-connects a hovered panel without selecting or opening it');

  const disconnectHandled = InputHandler.prototype.handlePanelAutoConnectKey.call(input, {
    key: 'Tab', shiftKey: false, ctrlKey: true, metaKey: false, altKey: false,
    repeat: false, preventDefault: () => { prevented++; },
  });
  assert(disconnectHandled && input.disconnectedPanelId === 'panel',
    'Ctrl+Tab disconnects every line from the hovered auto-connect device');

  input._hoverTooltipTarget = 'placeable:near_1';
  input.selectedPlaceableId = 'panel';
  input.selectedPlaceableIds.add('panel');
  input.connectedPanelId = null;
  const selectedHandled = InputHandler.prototype.handlePanelAutoConnectKey.call(input, {
    key: 'Tab', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    repeat: false, preventDefault: () => { prevented++; },
  });
  assert(selectedHandled && input.connectedPanelId === 'panel',
    'the existing single-selected-panel shortcut remains available off hover');

  input.selectedPlaceableIds.add('near_1');
  input.connectedPanelId = null;
  const multiHandled = InputHandler.prototype.handlePanelAutoConnectKey.call(input, {
    key: 'Tab', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    repeat: false, preventDefault: () => { prevented++; },
  });
  assert(!multiHandled && input.connectedPanelId === null,
    'multi-selection leaves Tab available to cycle palette categories');
}

console.log('\n--- 6. T removal spans selected devices and utilities in one undo step ---');
{
  const game = makeGame();
  game.state.placeables.push(item('panel_2', 'powerPanel', 16, 10));
  game.state.utilityLines.set('panel_power', {
    id: 'panel_power', utilityType: 'powerCable',
    start: { placeableId: 'panel', portName: 'pwr_out_1' },
    end: { placeableId: 'near_1', portName: 'pwr_in' },
    path: [{ col: 10.5, row: 10.5 }, { col: 11.25, row: 10.5 }],
  });
  game.state.utilityLines.set('panel_hv', {
    id: 'panel_hv', utilityType: 'hvCable',
    start: { placeableId: 'upstream', portName: 'hv_out' },
    end: { placeableId: 'panel', portName: 'hv_in' },
    path: [{ col: 8, row: 10.5 }, { col: 10.5, row: 10.5 }],
  });
  game.state.utilityLines.set('unrelated', {
    id: 'unrelated', utilityType: 'dataFiber',
    start: { placeableId: 'near_2', portName: 'data' },
    end: { placeableId: 'near_3', portName: 'data' },
    path: [{ col: 12, row: 10 }, { col: 13, row: 10 }],
  });
  game.state.utilityLines.set('panel_link', {
    id: 'panel_link', utilityType: 'powerCable',
    start: { placeableId: 'panel', portName: 'pwr_out_2' },
    end: { placeableId: 'panel_2', portName: 'pwr_out_1' },
    path: [{ col: 10.5, row: 10.5 }, { col: 16.5, row: 10.5 }],
  });
  const undoBefore = game._undoStack.length;
  assert(connectedUtilityLineIds(game.state, 'panel').sort().join(',')
      === 'panel_hv,panel_link,panel_power',
    'all incident utility types are included in the disconnect set');
  const removed = disconnectAutoConnectDevices(game, ['panel', 'panel_2']);
  assert(removed.length === 3 && game.state.utilityLines.size === 1
      && game.state.utilityLines.has('unrelated'),
  'T destroys only lines terminating on selected auto-connect devices');
  assert(game._undoStack.length === undoBefore + 1,
    'all selected-device removals share one undo entry');
  game.undo();
  assert(game.state.utilityLines.size === 4
      && game.state.utilityLines.has('panel_power')
      && game.state.utilityLines.has('panel_hv')
      && game.state.utilityLines.has('panel_link'),
  'one undo restores every disconnected line');

  let disconnectedIds = null;
  const input = {
    game,
    _selectionTargets: () => [
      { id: 'panel', selectionCategory: 'infra' },
      { id: 'panel_2', selectionCategory: 'infra' },
    ],
    _selectedAutoConnectPanelIds: InputHandler.prototype._selectedAutoConnectPanelIds,
    _disconnectSelectedAutoConnectPanels: ids => { disconnectedIds = ids; },
  };
  let prevented = 0;
  const handled = InputHandler.prototype.handleDisconnectSelectedUtilitiesKey.call(input, {
    key: 't', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    repeat: false, preventDefault: () => { prevented++; },
  });
  assert(handled && prevented === 1 && disconnectedIds?.join(',') === 'panel,panel_2',
    'T claims the key for all selected auto-connect-capable devices');
}

console.log('\n--- 7. HV distributors auto-connect ordinary HV feeders ---');
{
  assert(COMPONENTS.compactHvDistributor.autoConnectUtility === 'hvCable'
      && COMPONENTS.switchgear.autoConnectUtility === 'hvCable',
  'both HV distribution tiers opt into feeder auto-connect');
  assert(COMPONENTS.switchgear.autoConnectRadius
      > COMPONENTS.compactHvDistributor.autoConnectRadius,
  'the larger HV distributor has the longer assisted-wiring reach');

  const game = new Game(new BeamlineRegistry(), { seed: 92 });
  game.state.resources.funding = 1e9;
  game.state.placeables.push(
    item('hv_dist', 'compactHvDistributor', 10, 10),
    item('panel_1', 'powerPanel', 12, 10),
    item('panel_2', 'sectionDistributionPanel', 14, 10),
    item('panel_3', 'mainDistributionPanel', 16, 10),
    item('panel_far', 'powerPanel', 30, 10),
  );
  const plan = planPanelAutoConnect(game.state, 'hv_dist');
  const ends = plan.stubs.map(stub => stub.end.placeableId);
  assert(plan.utilityType === 'hvCable' && plan.candidates === 3,
    `the HV plan finds feeder inputs in range (got ${plan.candidates})`);
  assert(plan.outlets === 2 && plan.stubs.length === 2 && plan.skipped === 1,
    `two protected outputs promise exactly two feeder runs (got ${plan.stubs.length})`);
  assert(ends.join(',') === 'panel_1,panel_2' && !ends.includes('panel_far'),
    `nearest downstream panels win and the far panel is ignored (got ${ends.join(',')})`);
  assert(plan.stubs.every(stub => validateDrawLine(game.state, {
    utilityType: 'hvCable', start: stub.start, end: stub.end, path: stub.path,
  }).ok), 'HV auto-connect uses the ordinary feeder validator');

  const committed = commitPanelAutoConnect(game, plan);
  assert(committed.length === 2 && linesOf(game, 'hvCable').length === 2,
    'the HV action commits real HV feeder lines');
}

console.log('\n--- 8. Utility sources and peer distributors opt in by capability ---');
{
  const profiles = [
    ['chiller', 'coolingWater'],
    ['roughingPump', 'vacuumPipe'],
    ['solidStateAmp', 'rfWaveguide'],
    ['coldBox4K', 'cryoTransfer'],
    ['networkSwitch', 'dataFiber'],
    ['utilityPole', 'hvCable'],
  ];
  for (const [type, utilityType] of profiles) {
    const profile = utilityAutoConnectProfile(COMPONENTS[type]);
    assert(profile?.utilityType === utilityType && profile.radius > 0,
      `${type} derives ${utilityType} auto-connect capability`);
  }
  assert(utilityAutoConnectProfile(COMPONENTS.quadrupole) === null,
    'sink-only beamline equipment remains a target rather than an origin');
}

console.log('\n--- 9. Chillers reserve all four flexible branches for cold-water loads ---');
{
  const game = new Game(new BeamlineRegistry(), { seed: 93 });
  game.state.resources.funding = 1e9;
  game.state.placeables.push(
    item('plant', 'chiller', 10, 10),
    item('tank', 'waterTank', 8, 9),
    item('rejector', 'fanCoilCooler', 8, 12),
    item('manifold', 'coolingManifold', 10, 12),
    item('magnet_1', 'quadrupole', 12, 8),
    item('magnet_2', 'quadrupole', 13, 10),
    item('magnet_3', 'quadrupole', 13, 12),
    item('magnet_4', 'quadrupole', 12, 14),
  );
  const plan = planPanelAutoConnect(game.state, 'plant');
  const loadStubs = plan.stubs.filter(stub => stub.end.portName === 'cool_in');
  assert(plan.utilityType === 'coolingWater' && plan.candidates === 4,
    `the chiller finds only nearby cold-water loads (got ${plan.candidates})`);
  assert(loadStubs.length === 4
      && loadStubs.every(stub => ['cool_out', 'cool_out_2', 'cool_out_3', 'cool_out_4']
        .includes(stub.start.portName)),
  'all four beamline loads use only the four primary load branches');
  assert(!plan.stubs.some(stub => ['tank', 'rejector', 'manifold']
    .includes(stub.end.placeableId)),
  'tank, heat rejection, and distribution use the separate rigid-water architecture');
  assert(plan.skipped === 0, 'incompatible plant equipment is not counted as a skipped hose target');
  assert(plan.stubs.every(stub => validateDrawLine(game.state, {
    utilityType: 'coolingWater', start: stub.start, end: stub.end, path: stub.path,
  }).ok), 'chiller auto-connect routes pass through the normal cooling validator');
  commitPanelAutoConnect(game, plan);
  assert(linesOf(game, 'coolingWater').length === 4,
    'the chiller action commits real cooling-water lines');
}

console.log('\n--- 10. Storage and rejection equipment never auto-connect to flexible loads ---');
{
  const game = new Game(new BeamlineRegistry(), { seed: 94 });
  game.state.resources.funding = 1e9;
  game.state.placeables.push(
    item('tank', 'waterTank', 10, 10),
    item('plant', 'chiller', 13, 10),
    item('rejector', 'coolingTower', 10, 13),
    item('manifold', 'coolingManifold', 13, 13),
    item('magnet_1', 'quadrupole', 11, 10),
    item('magnet_2', 'quadrupole', 12, 10),
  );
  for (const origin of ['tank', 'rejector']) {
    const plan = planPanelAutoConnect(game.state, origin);
    const ends = plan.stubs.map(stub => stub.end.placeableId);
    assert(!ends.includes('magnet_1') && !ends.includes('magnet_2'),
      `${origin} ignores nearby beamline cooling sinks`);
    assert(!ends.includes('plant'), `${origin} requires an explicitly routed rigid-water connection`);
  }
}

console.log('\n--- 11. Integrated plants extend to loads and distribution only ---');
{
  const game = new Game(new BeamlineRegistry(), { seed: 95 });
  game.state.resources.funding = 1e9;
  game.state.placeables.push(
    item('package', 'packageChiller', 10, 10),
    item('tank', 'waterTank', 11, 10),
    item('rejector', 'fanCoilCooler', 10, 11),
    item('manifold', 'coolingManifold', 13, 10),
    item('magnet', 'quadrupole', 13, 12),
  );
  const plan = planPanelAutoConnect(game.state, 'package');
  const ends = plan.stubs.map(stub => stub.end.placeableId);
  const manifoldStub = plan.stubs.find(stub => stub.end.placeableId === 'manifold');
  assert(plan.candidates === 2 && ends.includes('magnet'),
    `the integrated package sees its cold-water load and header (got ${ends.join(',')})`);
  assert(!ends.includes('tank') && !ends.includes('rejector'),
    'the integrated package does not add redundant storage or heat rejection');
  assert(manifoldStub === undefined
      || ['cool_out_a', 'cool_out_b', 'cool_out_c', 'cool_out_d']
        .includes(manifoldStub.start.portName),
  'a cold manifold can only consume a package cold-supply branch');
}

console.log('\n--- 12. A manifold plans one upstream connection and no sink hoses ---');
{
  const game = new Game(new BeamlineRegistry(), { seed: 96 });
  game.state.resources.funding = 1e9;
  game.state.placeables.push(
    item('manifold', 'coolingManifold', 10, 10),
    item('tank', 'waterTank', 11, 10),
    item('central', 'chiller', 12, 10),
    item('package', 'packageChiller', 13, 10),
    item('magnet_1', 'quadrupole', 10, 11),
    item('magnet_2', 'quadrupole', 10, 12),
  );
  const plan = planPanelAutoConnect(game.state, 'manifold');
  assert(plan.candidates >= 1 && plan.stubs.every(stub =>
    ['central', 'package'].includes(stub.end.placeableId)
      && stub.end.portName.startsWith('cool_out')
      && !['cool_out_5', 'cool_out_6', 'cool_out_side', 'cool_out_side_2']
        .includes(stub.end.portName)),
  'the cold manifold considers only chiller cold-supply branches');
  assert(!plan.stubs.some(stub => stub.end.portName === 'cool_in'),
    'the manifold relies on service-radius coverage instead of individual sink hoses');
  commitPanelAutoConnect(game, plan);
  const repeat = planPanelAutoConnect(game.state, 'manifold');
  assert(repeat.stubs.length === 0,
    'a manifold with an upstream connection does not add another on repeated auto-connect');
}

console.log('\n--- 13. Network switches fan out once per nearby data device ---');
{
  const game = new Game(new BeamlineRegistry(), { seed: 97 });
  game.state.resources.funding = 1e9;
  game.state.placeables.push(
    item('switch_a', 'networkSwitch', 10, 10),
    item('switch_b', 'networkSwitch', 13, 10),
    item('bpm_1', 'bpm', 10, 13),
  );
  const plan = planPanelAutoConnect(game.state, 'switch_a');
  const switchLinks = plan.stubs.filter(stub => stub.end.placeableId === 'switch_b');
  assert(plan.utilityType === 'dataFiber' && plan.candidates === 2,
    `the switch finds a peer switch and a data sink (got ${plan.candidates})`);
  assert(plan.stubs.length === 2 && switchLinks.length === 1,
    `eight peer ports do not create duplicate switch-to-switch links (got ${switchLinks.length})`);
  commitPanelAutoConnect(game, plan);
  const repeat = planPanelAutoConnect(game.state, 'switch_a');
  assert(repeat.candidates === 0 && repeat.stubs.length === 0,
    'already-linked data devices are not offered again on repeated auto-connect');
}

console.log('\n--- 14. Utility poles build aligned multi-conductor peer spans ---');
{
  const game = new Game(new BeamlineRegistry(), { seed: 98 });
  game.state.resources.funding = 1e9;
  game.state.placeables.push(
    item('pole_a', 'utilityPole', 10, 10),
    item('pole_b', 'utilityPole', 16, 10),
  );
  const lane = { hv_in: 0, hv_out: 0.5, hv_3: 1, hv_4: 1.5 };
  const portPosition = (endpoint, _def, portName) => ({
    x: endpoint.col * 2,
    z: endpoint.row * 2 + lane[portName],
  });
  const plan = planPanelAutoConnect(game.state, 'pole_a', { portPosition });
  assert(plan.utilityType === 'hvCable' && plan.candidates === 1,
    'a pole prioritizes the nearby overhead peer as one target');
  assert(plan.stubs.length === 4
      && plan.stubs.every(stub => stub.start.portName === stub.end.portName),
  `the pole span aligns all four matching terminals (got ${plan.stubs.length})`);
  assert(plan.stubs.every(stub => validateDrawLine(game.state, {
    utilityType: 'hvCable', start: stub.start, end: stub.end, path: stub.path,
  }).ok), 'every aligned overhead conductor is a valid ordinary HV line');
}

console.log('\n--- 15. Utility poles reserve their side tap for pad-mount transformers ---');
{
  const game = new Game(new BeamlineRegistry(), { seed: 99 });
  game.state.resources.funding = 1e9;
  game.state.placeables.push(
    item('pole', 'utilityPole', 10, 10),
    item('green_transformer', 'padMountTransformer', 14, 10),
  );
  const plan = planPanelAutoConnect(game.state, 'pole');
  assert(plan.utilityType === 'hvCable' && plan.candidates === 1,
    'the nearby green pad-mount transformer is the pole feeder target');
  assert(plan.stubs.length === 1
      && plan.stubs[0].start.portName === 'hv_tap'
      && plan.stubs[0].end.portName === 'hv_in',
  'assisted wiring pairs utilityPole.hv_tap directly with padMountTransformer.hv_in');
  assert(validateDrawLine(game.state, {
    utilityType: 'hvCable',
    start: plan.stubs[0]?.start,
    end: plan.stubs[0]?.end,
    path: plan.stubs[0]?.path,
  }).ok, 'the dedicated pole-to-transformer feeder is a valid ordinary HV line');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
