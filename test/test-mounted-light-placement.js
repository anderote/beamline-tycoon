// Wall lights occupy wall-face subslots, while desk/work lights use the
// existing surface stack. These are separate vertical layers and must survive
// the same placement, snapshot, and geometry paths as ordinary decorations.

import * as ThreeModule from 'three';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import {
  canPlaceWallFixture, physicalWallKey, usesFloorOccupancy,
} from '../src/game/placement.js';
import { wallFixtureFaceOffset, wallFixturePose } from '../src/renderer3d/fixture-light-math.js';
import { WALL_TYPES } from '../src/data/structure.js';
import { buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';
import { DecorationBuilder } from '../src/renderer3d/decoration-builder.js';
import { buildLightFixture } from '../src/renderer3d/lighting-builder.js';
import { InputHandler } from '../src/input/InputHandler.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;
globalThis.THREE = ThreeModule;

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

function approx(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) <= epsilon;
}

function makeGame(seed) {
  const game = new Game(new BeamlineRegistry(), { seed });
  game.state.resources.funding = 1e9;
  game.state.resources.spares = 1e9;
  return game;
}

console.log('\n=== wall fixtures snap to independent wall faces ===\n');

{
  const game = makeGame(801);
  const northFace = { col: 5, row: 5, edge: 'n', off: 1 };
  const southFace = { col: 5, row: 4, edge: 's', off: 2 };

  assertOk(game.placeWall(5, 5, 'n', 'officeWall'), 'setup wall is built');
  assertOk(physicalWallKey(northFace) === physicalWallKey(southFace),
    'the two edge aliases resolve to the same physical wall');
  assertOk(canPlaceWallFixture(game, PLACEABLES.wallSconce, northFace).ok,
    'a free subslot on the first face previews valid');

  const firstId = game.placePlaceable({
    type: 'wallSconce', col: 5, row: 5, subCol: 0, subRow: 0,
    wallMount: northFace,
  });
  assertOk(!!firstId, 'a wall sconce commits to the selected face');
  assertOk(usesFloorOccupancy(PLACEABLES.wallSconce) === false,
    'wall fixtures do not claim floor occupancy');
  assertOk(!canPlaceWallFixture(game, PLACEABLES.wallStripLight, northFace).ok,
    'the same face/subslot cannot hold a second fixture');
  assertOk(canPlaceWallFixture(game, PLACEABLES.wallSconce, northFace, firstId).ok,
    'a moving wall fixture does not block its own current face slot');
  const secondId = game.placePlaceable({
    type: 'wallStripLight', col: 5, row: 4, subCol: 0, subRow: 0,
    wallMount: southFace,
  });
  assertOk(!!secondId, 'the opposite face of that same wall remains independently usable');
  assertOk(!game.placePlaceable({
    type: 'bulkheadLight', col: 9, row: 9, subCol: 0, subRow: 0,
    wallMount: { col: 9, row: 9, edge: 'e', off: 0 },
  }), 'a wall fixture cannot be built without an actual wall');

  game._rebuildPlaceableIndex();
  assertOk(!Object.values(game.state.subgridOccupied).some(
    occupant => occupant.id === firstId || occupant.id === secondId),
    'save/load-style occupancy rebuild keeps both wall fixtures off the floor layer');

  const a = wallFixturePose(northFace);
  const b = wallFixturePose(southFace);
  assertOk(approx(a.x, b.x) && approx(Math.abs(a.z - b.z), 0.125),
    'opposite aliases line up and sit outside the wall slab on opposite faces');
  assertOk(approx(Math.abs(a.yaw - b.yaw), Math.PI),
    'opposite wall faces orient fixtures in opposite directions');
  const leadOffset = wallFixtureFaceOffset(WALL_TYPES.leadWall);
  assertOk(leadOffset > wallFixtureFaceOffset(WALL_TYPES.officeWall),
    'shielding-wall fixtures derive a larger face offset from the actual slab depth');
  assertOk(wallFixturePose({ ...northFace, faceOffset: leadOffset }).z > leadOffset - 1e-9,
    'the derived shielding offset carries through the render pose');

  const eastFace = { col: 5, row: 5, edge: 'e', off: 1 };
  assertOk(game.placeWall(5, 5, 'e', 'officeWall'), 'setup destination wall is built');
  assertOk(game.movePlaceable(firstId, { wallMount: eastFace }),
    'a wall fixture moves through the validated stable-id path');
  assertOk(game.getPlaceable(firstId)?.wallMount?.edge === 'e'
      && canPlaceWallFixture(game, PLACEABLES.wallSconce, northFace).ok,
    'moving updates the mount and releases the old wall-face slot');
  assertOk(game.movePlaceable(firstId, { wallMount: northFace }),
    'the fixture can move back onto its original slot');

  assertOk(game.removeWall(5, 4, 's'), 'the supporting wall can be demolished from its alias');
  assertOk(!game.state.placeables.some(p => p.wallMount),
    'demolishing a wall removes fixtures from both faces');
}

console.log('\n=== wall fixture input preview follows the nearest face ===\n');

{
  const game = makeGame(803);
  game.placeWall(3, 3, 'e', 'officeWall');
  let ghost = null;
  const input = {
    armedPlaceableId: 'bulkheadLight',
    _lastScreenX: 120,
    _lastScreenY: 80,
    placementDir: 0,
    selectedPlaceableVariant: 0,
    game,
    renderer: {
      renderPlaceableGhost: (hover, valid, reason) => { ghost = { hover, valid, reason }; },
    },
    _getNearestWallEdge: () => ({ col: 3, row: 3, edge: 'e', frac: 0.68 }),
  };
  InputHandler.prototype._updatePlaceablePreview.call(input);
  assertOk(ghost?.valid === true, 'nearest occupied wall face produces a valid ghost');
  assertOk(ghost?.hover?.wallMount?.edge === 'e' && ghost.hover.wallMount.off === 2,
    'cursor fraction snaps the ghost to the expected one of four wall subslots');

  const fixtureId = game.placePlaceable({
    type: 'bulkheadLight', col: 3, row: 3, subCol: 0, subRow: 0,
    wallMount: ghost.hover.wallMount,
  });
  input.activeTool = {
    kind: 'move',
    payload: { kind: 'selectedPlaceable', placeableId: fixtureId, type: 'bulkheadLight' },
  };
  InputHandler.prototype._updatePlaceablePreview.call(input);
  assertOk(ghost?.valid === true,
    'a selected wall fixture previews valid over its own occupied face slot');
}

console.log('\n=== desk and work lights stack on real surfaces ===\n');

{
  const game = makeGame(802);
  const deskId = game.placePlaceable({
    type: 'desk', col: 7, row: 7, subCol: 0, subRow: 0, dir: 0, free: true,
  });
  const lampId = game.placePlaceable({
    type: 'deskLamp', col: 7, row: 7, subCol: 0, subRow: 0, dir: 0, free: true,
  });
  const lamp = game.getPlaceable(lampId);
  assertOk(!!deskId && !!lampId, 'desk and desk lamp both build');
  assertOk(lamp?.stackParentId === deskId, 'desk lamp records the desk as its support');
  assertOk(lamp?.placeY === PLACEABLES.desk.surfaceY,
    'desk lamp uses the authored desktop height');

  const workId = game.placePlaceable({
    type: 'portableWorkLight', col: 7, row: 7, subCol: 1, subRow: 0, dir: 1, free: true,
  });
  const work = game.getPlaceable(workId);
  assertOk(work?.stackParentId === deskId,
    'a work light can share another free subtile on the same worktop');

  const snapshot = buildWorldSnapshot(game, { only: ['decorations'] });
  const lampDec = snapshot.decorations.find(d => d.id === lampId);
  assertOk(lampDec?.placeY === lamp.placeY,
    'the renderer snapshot preserves stacked fixture height');

  const builder = new DecorationBuilder();
  builder._buildOne = () => new ThreeModule.Group();
  const parent = new ThreeModule.Group();
  builder.build([lampDec], parent);
  assertOk(approx(builder.getGroup(lampId)?.position.y, lamp.placeY * 0.5),
    'committed surface-light geometry renders on the worktop rather than the floor');
}

console.log('\n=== every new fixture has authored geometry ===\n');

for (const id of [
  'wallStripLight', 'emergencyWallLight', 'linearPendant',
  'cleanroomPanel', 'deskLamp', 'portableWorkLight',
]) {
  const group = buildLightFixture(PLACEABLES[id], { dir: 1 });
  assertOk(group.children.length > 0, `${id} builds visible geometry`);
  assertOk(!!group.userData.emitterMaterial, `${id} exposes an emitter material`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
