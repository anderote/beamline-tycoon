import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { UtilityLineInputController } from '../src/input/UtilityLineInputController.js';
import { UtilityLineTool } from '../src/input/utility-line-tool.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';
import { portWorldPosition } from '../src/utility/ports.js';
import { gridToIso } from '../src/renderer/grid.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;
globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};

function endpoint(id, type, col, row) {
  return {
    id, type, kind: 'infrastructure', category: 'infrastructure',
    col, row, subCol: 0, subRow: 0, dir: 0,
  };
}

function portIso(record, portName) {
  const pos = portWorldPosition(record, COMPONENTS[record.type], portName);
  return gridToIso(pos.x / 2, pos.z / 2);
}

test('Water Line publishes remembered cold/blue and hot/red palette variants', () => {
  const descriptor = UTILITY_TYPES.coolingWater;
  assert.deepEqual(descriptor.variants, ['Cold Water', 'Hot Water']);
  assert.deepEqual(descriptor.variantWaterCircuits, ['cold', 'hot']);
  assert.deepEqual(descriptor.variantPreviewColors, [0x287fc4, 0xc45b42]);
});

test('UtilityLineTool passes the selected water circuit into the gesture controller', () => {
  const calls = [];
  const ctx = {
    input: { utilityLineController: { setUtilityType: (...args) => calls.push(args) } },
    renderer: { _renderCursors() {} },
  };
  new UtilityLineTool('coolingWater', 'hot').onEnter(ctx);
  assert.deepEqual(calls, [['coolingWater', 'hot']]);
});

test('the selected variant filters ports and commits the designated circuit', () => {
  const game = new Game(new BeamlineRegistry(), { seed: 141 });
  game.state.resources.funding = 1e9;
  const manifold = endpoint('manifold', 'coolingManifold', 2, 2);
  const quad = endpoint('quad', 'quadrupole', 8, 2);
  game.state.placeables.push(manifold, quad);

  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('coolingWater', 'hot');
  const hotStart = portIso(manifold, 'hot_1');
  const hotEnd = portIso(quad, 'hot_out');
  ctrl.onHover(hotStart.x, hotStart.y);
  assert.equal(ctrl.hoverPort?.portName, 'hot_1');
  assert.equal(ctrl.hoverPort?.waterCircuit, 'hot');

  ctrl.onMouseDown(hotStart.x, hotStart.y, 0, {});
  ctrl.onMouseMove(hotEnd.x, hotEnd.y, {});
  ctrl.onMouseUp(hotEnd.x, hotEnd.y, 0, {});
  const line = [...game.state.utilityLines.values()][0];
  assert.equal(line?.waterCircuit, 'hot');
  assert.equal(line?.start?.portName, 'hot_1');
  assert.equal(line?.end?.portName, 'hot_out');

  ctrl.setUtilityType('coolingWater', 'cold');
  ctrl.onHover(hotStart.x, hotStart.y);
  assert.notEqual(ctrl.hoverPort?.waterCircuit, 'hot',
    'cold mode does not offer a nearby red fitting even inside the magnetic halo');
});
