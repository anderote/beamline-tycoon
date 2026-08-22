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

test('Water Line has no cosmetic temperature picker', () => {
  for (const utilityType of ['coolingWater', 'waterSupplyPipe']) {
    const descriptor = UTILITY_TYPES[utilityType];
    assert.equal(descriptor.variants, undefined, utilityType);
    assert.equal(descriptor.variantWaterCircuits, undefined, utilityType);
    assert.equal(descriptor.variantPreviewColors, undefined, utilityType);
  }
});

test('the gesture controller ignores a remembered legacy palette circuit', () => {
  let controller;
  const ctx = {
    input: { utilityLineController: new UtilityLineInputController({
      game: { state: { utilityLines: new Map() } }, renderer: {},
    }) },
    renderer: { _renderCursors() {} },
  };
  controller = ctx.input.utilityLineController;
  new UtilityLineTool('coolingWater', 'hot').onEnter(ctx);
  assert.equal(controller.waterCircuit, null);
});

test('connected ports automatically color and classify hot and cold Water Lines', () => {
  const game = new Game(new BeamlineRegistry(), { seed: 141 });
  game.state.resources.funding = 1e9;
  const manifold = endpoint('manifold', 'coolingManifold', 2, 2);
  const quad = endpoint('quad', 'quadrupole', 8, 2);
  game.state.placeables.push(manifold, quad);

  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('coolingWater');
  const hotStart = portIso(manifold, 'hot_1');
  const hotEnd = portIso(quad, 'hot_out');
  ctrl.onHover(hotStart.x, hotStart.y);
  assert.equal(ctrl.hoverPort?.portName, 'hot_1');
  assert.equal(ctrl.hoverPort?.waterCircuit, 'hot');

  ctrl.onMouseDown(hotStart.x, hotStart.y, 0, {});
  const incompatibleColdEnd = portIso(quad, 'cool_in');
  ctrl.onMouseMove(incompatibleColdEnd.x, incompatibleColdEnd.y, {});
  assert.notEqual(ctrl.hoverPort?.portName, 'cool_in',
    'after the hot start port, the gesture stops offering cold destinations');
  ctrl.onMouseMove(hotEnd.x, hotEnd.y, {});
  ctrl.onMouseUp(hotEnd.x, hotEnd.y, 0, {});
  const line = [...game.state.utilityLines.values()][0];
  assert.equal(line?.waterCircuit, 'hot');
  assert.equal(line?.start?.portName, 'hot_1');
  assert.equal(line?.end?.portName, 'hot_out');

  ctrl.setUtilityType('coolingWater');
  const coldStart = portIso(manifold, 'cold_1');
  const coldEnd = portIso(quad, 'cool_in');
  ctrl.onHover(coldStart.x, coldStart.y);
  assert.equal(ctrl.hoverPort?.waterCircuit, 'cold');
  ctrl.onMouseDown(coldStart.x, coldStart.y, 0, {});
  ctrl.onMouseMove(coldEnd.x, coldEnd.y, {});
  ctrl.onMouseUp(coldEnd.x, coldEnd.y, 0, {});
  const circuits = [...game.state.utilityLines.values()].map(entry => entry.waterCircuit).sort();
  assert.deepEqual(circuits, ['cold', 'hot']);
});
