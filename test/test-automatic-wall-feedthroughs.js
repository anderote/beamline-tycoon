import assert from 'node:assert/strict';
import test from 'node:test';

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { componentPaletteEntries } from '../src/ui/palette-collection.js';
import { buildPaletteIndex } from '../src/ui/palette-search.js';
import { utilityLineHeight, UTILITY_TYPES } from '../src/utility/registry.js';
import { portAnchor3D } from '../src/utility/port-anchors.js';
import { pathLengthSubUnits } from '../src/utility/line-geometry.js';
import {
  applyAutomaticWallPassThroughPlanToState,
  automaticWallPassThroughType,
  combineConstructionCosts,
  executeAutomaticWallPassThroughPlan,
  planAutomaticWallPassThroughs,
} from '../src/utility/automatic-wall-feedthroughs.js';
import { runWiringCost } from '../src/input/utility-run-wiring.js';

const wallOccupied = { '1,0,e': 'officeWall' };
const crossingPath = [{ col: 0.5, row: 0.5 }, { col: 2.5, row: 0.5 }];

const families = [
  ['powerCable', null, 'powerWallPassThrough'],
  ['hvCable', null, 'hvWallPassThrough'],
  ['dataFiber', null, 'dataFiberWallPassThrough'],
  ['coolingWater', 'cold', 'coldWaterLineWallPassThrough'],
  ['coolingWater', 'hot', 'hotWaterLineWallPassThrough'],
  ['waterSupplyPipe', 'cold', 'coldWaterSupplyWallPassThrough'],
  ['waterSupplyPipe', 'room', 'roomWaterSupplyWallPassThrough'],
  ['waterSupplyPipe', 'hot', 'hotWaterSupplyWallPassThrough'],
  ['cryoTransfer', null, 'cryoWallPassThrough'],
  ['rfWaveguide', null, 'rfWallPassThrough'],
  ['vacuumPipe', null, 'vacuumWallPassThrough'],
];

const meterStationUtilities = new Set([
  'hvCable', 'cryoTransfer', 'rfWaveguide', 'waterSupplyPipe',
]);

function blankState(extra = {}) {
  return {
    placeables: [], beamPipes: [], utilityLines: new Map(),
    wallOccupied: { ...wallOccupied },
    ...extra,
  };
}

function lineOpts(utilityType, waterCircuit) {
  const opts = {
    utilityType,
    path: crossingPath.map(point => ({ ...point })),
    ...(waterCircuit ? { waterCircuit } : {}),
  };
  if (['powerCable', 'hvCable', 'dataFiber', 'coolingWater'].includes(utilityType)) {
    opts.cablePath = crossingPath.map(point => ({ ...point }));
  }
  return opts;
}

test('every routed utility owns a hidden automatic wall fitting at its declared station width', () => {
  for (const [utilityType, waterCircuit, type] of families) {
    assert.equal(UTILITY_TYPES[utilityType].requiresWallPassThrough, true, utilityType);
    assert.equal(automaticWallPassThroughType(utilityType, waterCircuit), type);
    const def = PLACEABLES[type];
    assert.equal(def.paletteHidden, true, type);
    assert.equal(def.wallSpan, meterStationUtilities.has(utilityType) ? 2 : 1, type);
    assert.equal(def.mount, 'wall', type);
    assert.equal(def.automaticWallPassThrough.utilityType, utilityType, type);
  }

  const hidden = new Set(families.map(([, , type]) => type));
  hidden.add('waterSupplyWallPassThrough1x1');
  for (const category of ['power', 'dataControls', 'cooling', 'rfPower', 'vacuum']) {
    assert.ok(componentPaletteEntries(COMPONENTS, category)
      .every(({ key }) => !hidden.has(key)), category);
  }
  assert.ok(buildPaletteIndex(null).every(item => !hidden.has(item.id)),
    'automatic and compatibility 1×1 fittings are absent from search too');
  assert.ok(componentPaletteEntries(COMPONENTS, 'power')
    .some(({ key }) => key === 'hvWallPassThrough4x4'), 'manual 4×4 HV remains');
  assert.ok(componentPaletteEntries(COMPONENTS, 'cooling')
    .some(({ key }) => key === 'waterSupplyWallPassThrough2x2'), 'manual 2×2 water remains');
});

test('modular sleeve bores and ports match exact service elevations', () => {
  const wallMount = { col: 1, row: 0, edge: 'e', off: 2, faceOffset: 0.0625 };
  for (const [utilityType, waterCircuit, type] of families) {
    const def = COMPONENTS[type];
    const metadata = def.automaticWallPassThrough;
    const entry = { id: type, type, col: 1, row: 0, subCol: 0, subRow: 0, dir: 1, wallMount };
    for (const portName of metadata.portPairs[0]) {
      assert.ok(Math.abs(portAnchor3D(entry, def, portName).y - metadata.heightMeters) < 1e-9,
        `${type}.${portName}`);
    }
    const bore = def.parts.find(part => part.l === 2.50);
    assert.ok(bore, `${type} has a through-wall bore`);
    assert.ok(Math.abs((bore.y + bore.h / 2) * 0.5 - metadata.heightMeters) < 1e-9,
      `${type} bore centre`);
    assert.ok(def.parts.every(part => (part.w || 1) <= 1), `${type} keeps compact hardware`);

    const expectedHeight = utilityType === 'hvCable'
      ? 2.00
      : utilityType === 'waterSupplyPipe'
      ? UTILITY_TYPES.waterSupplyPipe.runHeightsByWaterCircuit[waterCircuit]
      : utilityLineHeight(utilityType);
    assert.ok(Math.abs(metadata.heightMeters - expectedHeight) < 1e-9,
      `${type} matches ${utilityType} route datum`);
  }

  const hvPorts = COMPONENTS.hvWallPassThrough.ports;
  assert.ok(['hv_in', 'hv_out'].every(portName => hvPorts[portName].tensionsCable === true),
    'both elevated HV terminals explicitly tension attached cable spans');
});

test('HV, cryo, RF and rigid supply water snap crossings to one-metre wall stations', () => {
  for (const row of [0, 0.5]) {
    const expectedOff = row < 0.5 ? 0 : 2;
    const expectedRow = row < 0.5 ? 0.25 : 0.75;
    for (const [utilityType, waterCircuit] of [
      ['hvCable', null],
      ['cryoTransfer', null],
      ['rfWaveguide', null],
      ['waterSupplyPipe', 'cold'],
      ['waterSupplyPipe', 'room'],
      ['waterSupplyPipe', 'hot'],
    ]) {
      const path = [{ col: 0.5, row }, { col: 2.5, row }];
      const opts = {
        utilityType,
        path,
        ...(utilityType === 'hvCable' ? { cablePath: path } : {}),
        ...(waterCircuit ? { waterCircuit } : {}),
      };
      const plan = planAutomaticWallPassThroughs({ state: blankState() }, opts);
      assert.equal(plan.ok, true, `${utilityType}/${waterCircuit}: ${plan.reason || 'ok'}`);
      assert.deepEqual(plan.feedthroughs[0].wallMount, {
        col: 1, row: 0, edge: 'e', off: expectedOff, span: 2, faceOffset: 0.0625,
      });
      if (utilityType !== 'hvCable') {
        assert.deepEqual(plan.segments[0].path.at(-1), { col: 2, row: expectedRow });
        assert.deepEqual(plan.segments[1].path[0], { col: 2, row: expectedRow });
        assert.ok(plan.segments.every(segment => segment.path.every((point, index, points) => {
          if (index === 0) return true;
          return point.col === points[index - 1].col || point.row === points[index - 1].row;
        })), `${utilityType}/${waterCircuit} stays Manhattan through the snapped station`);
      }
    }
  }
});

test('one-metre stations preserve south-edge slot reversal and route alignment', () => {
  const state = blankState({ wallOccupied: { '0,1,s': 'officeWall' } });
  const path = [{ col: 0.5, row: 0.5 }, { col: 0.5, row: 2.5 }];
  const plan = planAutomaticWallPassThroughs({ state }, {
    utilityType: 'cryoTransfer', path,
  });
  assert.equal(plan.ok, true, plan.reason);
  assert.deepEqual(plan.feedthroughs[0].wallMount, {
    col: 0, row: 1, edge: 's', off: 2, span: 2, faceOffset: 0.0625,
  });
  assert.deepEqual(plan.segments[0].path.at(-1), { col: 0.25, row: 2 });
  assert.deepEqual(plan.segments[1].path[0], { col: 0.25, row: 2 });
});

test('one crossing becomes a real fitting and two ordinary terminated runs', () => {
  for (const [utilityType, waterCircuit, type] of families) {
    const state = blankState();
    const plan = planAutomaticWallPassThroughs({ state }, lineOpts(utilityType, waterCircuit));
    assert.equal(plan.ok, true, `${utilityType}/${waterCircuit}: ${plan.reason || 'ok'}`);
    assert.deepEqual(plan.feedthroughs.map(fitting => fitting.type), [type]);
    assert.equal(plan.segments.length, 2);
    assert.equal(plan.segments[0].end.placeableId, plan.feedthroughs[0].probeId);
    assert.equal(plan.segments[1].start.placeableId, plan.feedthroughs[0].probeId);
  }
});

test('independent rigid services stack in one wall slot', () => {
  const state = blankState();
  const game = { state };
  for (const [utilityType, waterCircuit] of [
    ['cryoTransfer', null],
    ['waterSupplyPipe', 'cold'],
    ['waterSupplyPipe', 'hot'],
    ['rfWaveguide', null],
    ['vacuumPipe', null],
  ]) {
    const plan = planAutomaticWallPassThroughs(game, lineOpts(utilityType, waterCircuit));
    assert.equal(plan.ok, true, `${utilityType}/${waterCircuit}: ${plan.reason || 'ok'}`);
    assert.equal(applyAutomaticWallPassThroughPlanToState(state, plan), true);
  }
  const fittings = state.placeables.filter(placeable =>
    PLACEABLES[placeable.type]?.automaticWallPassThrough);
  assert.equal(fittings.length, 5);
  assert.deepEqual(new Set(fittings.map(fitting => fitting.wallMount.off)), new Set([2]));
});

test('a manually placed 4×4 HV fitting is reused instead of replaced', () => {
  const state = blankState({
    placeables: [{
      id: 'big', type: 'hvWallPassThrough4x4', col: 1, row: 0,
      subCol: 0, subRow: 0, dir: 1,
      wallMount: { col: 1, row: 0, edge: 'e', off: 0, span: 4 },
    }],
  });
  const plan = planAutomaticWallPassThroughs({ state }, lineOpts('hvCable', null));
  assert.equal(plan.ok, true);
  assert.equal(plan.feedthroughs.length, 0);
  assert.equal(plan.segments[0].end.placeableId, 'big');
  assert.match(plan.segments[0].end.portName, /^hv_in_/);
  assert.match(plan.segments[1].start.portName, /^hv_out_/);
});

test('automatic fitting, split lines, price and undo are one gesture', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  };
  const game = new Game(new BeamlineRegistry(), { seed: 991 });
  game.state.resources.funding = 1e9;
  game.recomputeZoneConnectivity();
  game.state.wallOccupied['49,50,e'] = 'officeWall';
  const opts = {
    utilityType: 'vacuumPipe',
    path: [{ col: 49.5, row: 50.5 }, { col: 51.5, row: 50.5 }],
  };
  const plan = planAutomaticWallPassThroughs(game, opts);
  assert.equal(plan.ok, true, plan.reason);
  const lineCost = runWiringCost('vacuumPipe', pathLengthSubUnits(opts.path));
  const cost = combineConstructionCosts(lineCost, plan.fittingCost);
  const beforeFunding = game.state.resources.funding;
  const beforePlaceables = game.state.placeables.length;
  const beforeLines = game.state.utilityLines.size;
  const result = game.commitGesture({
    cost,
    mutate: () => executeAutomaticWallPassThroughPlan(game, plan),
  });
  assert.equal(result.placeableIds.length, 1);
  assert.equal(result.lineIds.length, 2);
  assert.equal(game.state.resources.funding, beforeFunding - cost.funding);
  assert.equal(game.state.placeables.length, beforePlaceables + 1);
  assert.equal(game.state.utilityLines.size, beforeLines + 2);
  game.undo();
  assert.equal(game.state.resources.funding, beforeFunding);
  assert.equal(game.state.placeables.length, beforePlaceables);
  assert.equal(game.state.utilityLines.size, beforeLines);
});
