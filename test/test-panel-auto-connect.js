// Distribution-panel radius wiring: nearby free power plugs become ordinary,
// paid cables in one undoable action. Outlet count and radius remain real
// constraints; this is assisted drawing, not an implicit power bus.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import {
  commitPanelAutoConnect,
  planPanelAutoConnect,
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

console.log('\n--- 5. Tab belongs to one selected distribution panel ---');
{
  const game = makeGame();
  const input = {
    game,
    selectedPlaceableId: 'panel',
    selectedPlaceableIds: new Set(['panel']),
    _selectionIdsForAnchor: InputHandler.prototype._selectionIdsForAnchor,
    _selectedAutoConnectPanelId: InputHandler.prototype._selectedAutoConnectPanelId,
    _autoConnectPanel: id => { input.connectedPanelId = id; },
  };
  let prevented = 0;
  const handled = InputHandler.prototype._handleSelectedPanelAutoConnectKey.call(input, {
    key: 'Tab', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    repeat: false, preventDefault: () => { prevented++; },
  });
  assert(handled && prevented === 1 && input.connectedPanelId === 'panel',
    'plain Tab auto-connects the single selected distribution panel');

  input.selectedPlaceableIds.add('near_1');
  input.connectedPanelId = null;
  const multiHandled = InputHandler.prototype._handleSelectedPanelAutoConnectKey.call(input, {
    key: 'Tab', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    repeat: false, preventDefault: () => { prevented++; },
  });
  assert(!multiHandled && input.connectedPanelId === null,
    'multi-selection leaves Tab available to cycle palette categories');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
