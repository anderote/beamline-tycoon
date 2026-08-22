// Structure -> Hangings content, wall-span placement, search ownership, and
// procedural geometry all meet at this contract boundary.

import * as ThreeModule from 'three';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { DECORATIONS_RAW } from '../src/data/decorations.raw.js';
import { MODES } from '../src/data/modes.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import {
  canPlaceWallFixture,
  wallFixtureOffFromFrac,
  wallFixtureMountKeys,
} from '../src/game/placement.js';
import { wallFixturePose } from '../src/game/wall-fixture-geometry.js';
import { buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';
import {
  DecorationBuilder,
  buildDecorationGroup,
  hasDedicatedDecorationGeometry,
} from '../src/renderer3d/decoration-builder.js';
import { buildPaletteIndex } from '../src/ui/palette-search.js';

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

function makeGame(seed = 901) {
  const game = new Game(new BeamlineRegistry(), { seed });
  game.state.resources.funding = 1e9;
  game.state.resources.spares = 1e9;
  return game;
}

const HANGING_IDS = [
  'abstractPainting',
  'landscapePainting',
  'beamlinePhotograph',
  'acceleratorBlueprint',
  'wallTelevision',
  'largeWallTelevision',
  'wallWhiteboard',
  'wallBlackboard',
  'noticeBoard',
];

console.log('\n=== Structure Hangings catalogue ===\n');

assertOk(MODES.structure.categories.hangings?.isDecorationTab === true,
  'Hangings is a live Structure decoration tab');
for (const id of HANGING_IDS) {
  const raw = DECORATIONS_RAW[id];
  const def = PLACEABLES[id];
  assertOk(raw?.category === 'hangings' && def?.category === 'hangings',
    `${id} is authored and normalized into Hangings`);
  assertOk(def?.kind === 'decoration' && def?.mount === 'wall',
    `${id} uses the shared wall-mounted decoration path`);
  assertOk(Number.isInteger(def?.wallSpan) && def.wallSpan >= 1 && def.wallSpan <= 4,
    `${id} declares a valid quarter-wall span`);
  assertOk(def?.mountY > 0, `${id} declares a positive mounting height`);
  assertOk(hasDedicatedDecorationGeometry(id), `${id} has dedicated geometry`);

  const group = buildDecorationGroup(
    id, def.category, def.subW * 0.5, def.subL * 0.5, def.subH * 0.5,
  );
  const bounds = new ThreeModule.Box3().setFromObject(group);
  assertOk(group.children.length > 1 && !bounds.isEmpty(), `${id} builds a visible detailed model`);
}

const searchIndex = buildPaletteIndex(null);
for (const id of HANGING_IDS) {
  const entry = searchIndex.find(item => item.id === id);
  assertOk(entry?.mode === 'structure' && entry.category === 'hangings',
    `${id} search result lands in Structure / Hangings`);
}

console.log('\n=== wide hangings reserve their real wall span ===\n');

{
  const game = makeGame();
  assertOk(game.placeWall(4, 4, 'n', 'officeWall'), 'setup wall is built');

  const paintingId = game.placePlaceable({
    type: 'abstractPainting', col: 4, row: 4, subCol: 0, subRow: 0,
    wallMount: { col: 4, row: 4, edge: 'n', off: 0 },
  });
  const painting = game.getPlaceable(paintingId);
  assertOk(!!paintingId && painting.wallMount.span === 2,
    'a two-slot painting stores its resolved span');
  assertOk(wallFixtureMountKeys(painting.wallMount).length === 2,
    'the painting owns both consecutive face slots');
  assertOk(canPlaceWallFixture(game, PLACEABLES.wallSconce,
    { col: 4, row: 4, edge: 'n', off: 1 }).ok,
  'a one-slot fixture can overlap the second half of a non-blocking hanging');
  const sconceId = game.placePlaceable({
    type: 'wallSconce', col: 4, row: 4, subCol: 0, subRow: 0,
    wallMount: { col: 4, row: 4, edge: 'n', off: 1 },
  });
  assertOk(!!sconceId,
    'placing a wall fixture after a hanging ignores the hanging slots');
  const photographId = game.placePlaceable({
    type: 'beamlinePhotograph', col: 4, row: 4, subCol: 0, subRow: 0,
    wallMount: { col: 4, row: 4, edge: 'n', off: 0 },
  });
  assertOk(!!photographId,
    'placing another hanging over an existing fixture is also allowed');
  assertOk(canPlaceWallFixture(game, PLACEABLES.wallSconce,
    { col: 4, row: 4, edge: 'n', off: 2 }).ok,
  'the first free slot beside the painting remains usable');
  assertOk(canPlaceWallFixture(game, PLACEABLES.landscapePainting,
    { col: 4, row: 4, edge: 'n', off: 3 }).wallMount.off === 1,
  'a wide hanging is clamped wholly inside the wall segment');
  assertOk(canPlaceWallFixture(game, PLACEABLES.abstractPainting,
    { col: 4, row: 3, edge: 's', off: 2 }).ok,
  'the opposite face of the same physical wall remains independently usable');

  assertOk(wallFixtureOffFromFrac(0.95, 4) === 0,
    'a four-slot TV always snaps to the whole wall segment');
  const fullPose = wallFixturePose({ col: 4, row: 4, edge: 'n', off: 0, span: 4 });
  assertOk(approx(fullPose.x, 9), 'a four-slot wall pose is centered on the segment');

  const snapshot = buildWorldSnapshot(game, { only: ['decorations'] });
  const dec = snapshot.decorations.find(item => item.id === paintingId);
  assertOk(dec?.wallMount?.span === 2, 'the renderer snapshot preserves wall span');

  const builder = new DecorationBuilder();
  const parent = new ThreeModule.Group();
  builder.build(snapshot.decorations, parent);
  const rendered = builder.getGroup(paintingId);
  const expected = wallFixturePose(dec.wallMount);
  assertOk(approx(rendered.position.x, expected.x) && approx(rendered.position.z, expected.z),
    'committed hanging geometry uses the span-centered wall pose');
  assertOk(approx(rendered.position.y, PLACEABLES.abstractPainting.mountY),
    'committed hanging geometry uses its authored mounting height');
}

console.log('\n=== wall openings are the only hanging conflict ===\n');

{
  const game = makeGame(903);
  assertOk(game.placeWall(10, 10, 'n', 'officeWall'), 'door conflict setup wall is built');
  assertOk(game.placeDoor(10, 10, 'n', 'officeDoor'), 'setup door is placed');
  const doorResult = canPlaceWallFixture(game, PLACEABLES.abstractPainting,
    { col: 10, row: 10, edge: 'n', off: 0 });
  assertOk(!doorResult.ok && doorResult.openingOccupied,
    'a hanging cannot cover a door opening');

  assertOk(game.placeWall(11, 10, 'n', 'officeWall'), 'window conflict setup wall is built');
  assertOk(game.placeWindow(11, 10, 'n', 'officeWindow'), 'setup window is placed');
  const windowResult = canPlaceWallFixture(game, PLACEABLES.landscapePainting,
    { col: 11, row: 10, edge: 'n', off: 0 });
  assertOk(!windowResult.ok && windowResult.openingOccupied,
    'a hanging cannot cover a window opening');

  assertOk(game.placeWall(12, 10, 'n', 'officeWall'), 'reverse conflict setup wall is built');
  const hangingId = game.placePlaceable({
    type: 'abstractPainting', col: 12, row: 10, subCol: 0, subRow: 0,
    wallMount: { col: 12, row: 10, edge: 'n', off: 0 },
  });
  assertOk(!!hangingId, 'setup hanging is placed');
  assertOk(!game.placeDoor(12, 10, 'n', 'officeDoor'),
    'a door cannot be cut through an existing hanging');
  assertOk(!game.placeWindow(12, 10, 'n', 'officeWindow'),
    'a window cannot be cut through an existing hanging');
}

console.log('\n=== wall hangings do not mutate painted wall faces ===\n');
{
  const game = makeGame(902);
  assertOk(game.placeWall(30, 30, 'n', 'officeWall'), 'painted hanging setup wall is built');
  assertOk(game.paintWallFace(30, 30, 'n', 'labBlue'), 'setup wall face is painted');
  const hangingId = game.placePlaceable({
    type: 'abstractPainting', col: 30, row: 30, subCol: 0, subRow: 0,
    wallMount: { col: 30, row: 30, edge: 'n', off: 0 },
  });
  const wall = game.state.walls.find(w => w.col === 30 && w.row === 30 && w.edge === 'n');
  assertOk(!!hangingId && wall?.facePaint?.inside === 'labBlue',
    'placing a wall hanging preserves the painted wall face');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
