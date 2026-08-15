// Overhead fixtures use their footprint only as a render anchor. They float
// above the floor layer and must never collide with, replace, flatten, or
// erase equipment beneath them.

import { Game } from '../src/game/Game.js';
import * as THREE from 'three';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { canPlace, usesFloorOccupancy } from '../src/game/placement.js';
import { getTileCorners, setTileCorners } from '../src/game/terrain.js';
import { InputHandler } from '../src/input/InputHandler.js';
import { DecorationBuilder } from '../src/renderer3d/decoration-builder.js';
import { fixtureMountY } from '../src/renderer3d/fixture-light-math.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

let passed = 0;
let failed = 0;
function assertOk(condition, message) {
  if (condition) {
    passed++;
    console.log('  PASS:', message);
  } else {
    failed++;
    console.log('  FAIL:', message);
  }
}

function makeGame(seed) {
  const game = new Game(new BeamlineRegistry(), { seed });
  game.state.resources.funding = 1e9;
  game.state.resources.spares = 1e9;
  return game;
}

const key = (cell) => `${cell.col},${cell.row},${cell.subCol},${cell.subRow}`;

console.log('\n=== overhead fixtures render above occupied work areas ===\n');

{
  const expectedHeights = {
    ceilingPanel: 3.0,
    highBay: 4.5,
    linearPendant: 3.4,
    cleanroomPanel: 3.2,
  };
  for (const [id, expected] of Object.entries(expectedHeights)) {
    const def = PLACEABLES[id];
    assertOk(def?.mount === 'overhead', `${id} remains an overhead fixture`);
    assertOk(fixtureMountY(def, 0) === expected,
      `${id} renders at ${expected.toFixed(1)} m above a level floor`);
  }
}

console.log('\n=== overhead fixtures share floor footprints safely ===\n');

{
  const game = makeGame(701);
  const floorId = game.placePlaceable({
    type: 'source', col: 8, row: 8, subCol: 0, subRow: 0, dir: 0,
  });
  const lightDef = PLACEABLES.ceilingPanel;
  const pose = { col: 8, row: 8, subCol: 0, subRow: 0, dir: 0 };

  assertOk(usesFloorOccupancy(lightDef) === false,
    'ceiling panels are explicitly outside floor occupancy');
  assertOk(canPlace(game, lightDef, pose.col, pose.row, pose.subCol, pose.subRow, pose.dir).ok,
    'preview allows a ceiling panel directly over occupied equipment');

  const lightId = game.placePlaceable({ type: 'ceilingPanel', ...pose });
  assertOk(!!lightId, 'commit builds the ceiling panel over the equipment');

  const lightCell = lightDef.footprintCells(
    pose.col, pose.row, pose.subCol, pose.subRow, pose.dir,
  )[0];
  assertOk(game.state.subgridOccupied[key(lightCell)]?.id === floorId,
    'the underlying equipment remains the floor-cell owner');

  game._rebuildPlaceableIndex();
  assertOk(game.state.subgridOccupied[key(lightCell)]?.id === floorId,
    'save/load-style occupancy rebuild keeps the floating light off the floor layer');

  assertOk(game.removePlaceable(lightId), 'the overhead fixture can be removed normally');
  assertOk(game.state.subgridOccupied[key(lightCell)]?.id === floorId,
    'removing the overhead fixture does not erase equipment occupancy below it');
}

console.log('\n=== floor construction remains possible beneath an existing light ===\n');

{
  const game = makeGame(702);
  setTileCorners(game.state, 12, 12, { nw: 1, ne: 1, se: 1, sw: 0 });
  const before = getTileCorners(game.state, 12, 12);
  const lightId = game.placePlaceable({
    type: 'highBay', col: 12, row: 12, subCol: 0, subRow: 0, dir: 0,
  });

  assertOk(!!lightId, 'an overhead light can be built without a roof');
  assertOk(JSON.stringify(getTileCorners(game.state, 12, 12)) === JSON.stringify(before),
    'a floating fixture does not flatten the terrain beneath it');

  const floorId = game.placePlaceable({
    type: 'source', col: 12, row: 12, subCol: 0, subRow: 0, dir: 0,
  });
  assertOk(!!floorId, 'floor equipment can be built later beneath the light');

  const floorCell = PLACEABLES.source.footprintCells(12, 12, 0, 0, 0)[0];
  assertOk(game.state.subgridOccupied[key(floorCell)]?.id === floorId,
    'the later floor equipment owns its normal occupancy cells');

  assertOk(game.movePlaceable(lightId, {
    col: 12, row: 12, subCol: 1, subRow: 1, dir: 0,
  }), 'the overhead light can move across occupied floor cells');
  assertOk(game.state.subgridOccupied[key(floorCell)]?.id === floorId,
    'moving the light leaves floor occupancy intact');
}

console.log('\n=== floating fixtures remain directly interactive ===\n');

{
  const builder = new DecorationBuilder();
  builder._buildOne = () => new THREE.Group();
  const parent = new THREE.Group();
  builder.build([{
    id: 'light-overhead', type: 'ceilingPanel', category: 'structureLights',
    col: 3, row: 4, subCol: 0, subRow: 0, subW: 1, subL: 1, subH: 2, dir: 0,
  }], parent);
  const rendered = builder.getGroup('light-overhead');
  assertOk(rendered?.userData?.nodeId === 'light-overhead',
    'the rendered fixture carries its placeable id for raycast selection');

  const overhead = { id: 'light-overhead', type: 'ceilingPanel', kind: 'decoration' };
  const floor = { id: 'floor-machine', type: 'source', kind: 'beamline' };
  let liftedId = null;
  const input = {
    game: {
      getPlaceable: (id) => (id === overhead.id ? overhead : floor),
      _withUndo: (fn) => fn(),
      liftPlaceable: (id) => {
        liftedId = id;
        return { type: 'ceilingPanel', dir: 0, col: 3, row: 4, subCol: 0, subRow: 0 };
      },
    },
    renderer: {
      raycastScreen: () => ({ object: {} }),
      identifyHit: () => ({ group: 'decoration', nodeId: overhead.id, rootObj: {} }),
      screenToWorld: () => ({ x: 6.25, y: 8.25 }),
    },
    _getNodeAtGrid: () => null,
    _placeableAtWorldPos: () => floor,
    _showToast: () => {},
  };
  const payload = InputHandler.prototype._pickUpAt.call(input, 3, 4, 100, 100);
  assertOk(liftedId === overhead.id && payload?.type === 'ceilingPanel',
    'move mode uses the raycast id instead of picking the occupied floor object below');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
