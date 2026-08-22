// Office-interior catalogue and floor-covering placement contracts.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { itemMatchesZone } from '../src/data/facility.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { MODES, ROOM_FURNITURE_GROUPS } from '../src/data/modes.js';
import { DOOR_TYPES, WALL_TYPES, WINDOW_TYPES, windowOpeningHeight } from '../src/data/structure.js';
import { canPlace, usesFloorOccupancy } from '../src/game/placement.js';

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

const cellKey = (cell) => `${cell.col},${cell.row},${cell.subCol},${cell.subRow}`;

console.log('\n=== office and meeting-room catalogue ===\n');

console.log('\n=== faculty lounge catalogue ===\n');

console.log('\n=== shared furniture catalogue and grouping ===\n');
for (const id of ['sharedCounter', 'coffeeStation', 'snackTable', 'bookcaseWide', 'glassBookcase', 'sideboard', 'endTable', 'visitorArmchair', 'ottoman', 'credenza', 'wastebasket', 'deskOrganizer', 'displayScreen', 'flipChart', 'bulletinBoard', 'globe']) {
  const def = PLACEABLES[id];
  assertOk(!!def && def.kind === 'furnishing', `${id} is registered as a furnishing`);
  assertOk(def?.furnitureGroup && ROOM_FURNITURE_GROUPS[def.furnitureGroup],
    `${id} has a palette furniture group`);
  assertOk(['officeSpace', 'privateOffice', 'meetingRoom', 'reception'].every(zone => itemMatchesZone(def, zone)),
    `${id} is shared across core room types`);
}
for (const id of ['umbrellaStand', 'readingLamp', 'drinksTrolley']) {
  const def = PLACEABLES[id];
  assertOk(!!def && def.kind === 'furnishing', `${id} is registered as a furnishing`);
  assertOk(def?.furnitureGroup && ROOM_FURNITURE_GROUPS[def.furnitureGroup], `${id} has a palette furniture group`);
}
for (const id of ['badgePrinter', 'dishwasher', 'warmingCabinet', 'plateStation']) {
  const def = PLACEABLES[id];
  assertOk(!!def && def.kind === 'furnishing', `${id} is registered as a furnishing`);
  assertOk(def?.furnitureGroup && ROOM_FURNITURE_GROUPS[def.furnitureGroup], `${id} has a palette furniture group`);
}
for (const [id, category] of Object.entries(MODES.facility.categories)) {
  if (!category.isZoneTab || !category.furnitureGroups) continue;
  assertOk(category.furnitureGroups === ROOM_FURNITURE_GROUPS, `${id} uses the shared furniture group order`);
}

for (const id of ['clubChair', 'tuftedSofa', 'clawFootTable', 'drinksCabinet', 'facultyBar', 'chalkboard', 'newspaperStand', 'cigarAshtray']) {
  const def = PLACEABLES[id];
  assertOk(!!def && def.kind === 'furnishing', `${id} is registered as a furnishing`);
  assertOk(itemMatchesZone(def, 'facultyLounge'), `${id} is available in faculty lounges`);
  assertOk(Array.isArray(def?.parts) && def.parts.length >= 4, `${id} has authored 3D geometry`);
}
assertOk(PLACEABLES.clubChair.gridW === 2 && PLACEABLES.clubChair.gridH === 2,
  'faculty lounge club chair occupies a full 2×2-subtile footprint');
assertOk(PLACEABLES.clubChair.parts.some(part => part.name === 'back' && part.w >= 1.8),
  'faculty lounge club chair upholstery fills its wider footprint');

console.log('\n=== upholstered seating color variants ===\n');

const colorSelectableSeating = [
  'couch', 'visitorArmchair', 'ottoman', 'clubChair', 'tuftedSofa',
  'waitingBench', 'officeChair', 'ergonomicChair', 'executiveChair', 'meetingChair',
];
for (const id of colorSelectableSeating) {
  const def = PLACEABLES[id];
  const partNames = new Set(def?.parts?.map(part => part.name));
  assertOk(def?.variants?.length >= 3, `${id} offers at least three upholstery colors`);
  assertOk(def.variants.length === def.variantPreviewColors?.length
      && def.variants.length === def.variantOverrides?.length,
  `${id} keeps labels, swatches, and rendered overrides index-aligned`);
  assertOk(def.variantOverrides.slice(1).every(overrides => Object.keys(overrides).length > 0),
    `${id} non-default colors alter authored upholstery`);
  assertOk(def.variantOverrides.every(overrides => Object.keys(overrides).every(name => partNames.has(name))),
    `${id} color overrides reference real geometry parts`);
}

{
  const game = new Game(new BeamlineRegistry(), { seed: 1900 });
  game.state.resources.funding = 1e9;
  const chairId = game.placePlaceable({
    type: 'visitorArmchair', variant: 2,
    col: 68, row: 68, subCol: 0, subRow: 0, dir: 0,
  });
  assertOk(!!chairId && game.getPlaceable(chairId)?.variant === 2,
    'an armchair placement retains its selected upholstery color');
}

for (const id of ['standingDesk', 'acousticPod', 'beamlineDisplayCase', 'collaborationTable']) {
  const def = PLACEABLES[id];
  assertOk(!!def && def.kind === 'furnishing', `${id} is registered as a furnishing`);
  assertOk(Array.isArray(def?.parts) && def.parts.length >= 8,
    `${id} has distinctive authored 3D geometry`);
  assertOk(itemMatchesZone(def, 'officeSpace'), `${id} is available in office spaces`);
}
for (const id of ['acousticPod', 'beamlineDisplayCase', 'collaborationTable']) {
  assertOk(itemMatchesZone(PLACEABLES[id], 'meetingRoom'), `${id} is available in meeting rooms`);
}

console.log('\n=== floor coverings layer beneath furniture ===\n');

for (const id of ['areaRug', 'runnerRug']) {
  const def = PLACEABLES[id];
  assertOk(def?.mount === 'floor' && usesFloorOccupancy(def) === false,
    `${id} is a non-blocking floor covering`);
  assertOk(def.variants.length === def.variantOverrides.length,
    `${id} has an authored appearance for every variant`);
  assertOk(itemMatchesZone(def, 'officeSpace') && itemMatchesZone(def, 'meetingRoom'),
    `${id} is offered in both office and meeting rooms`);
}

{
  const game = new Game(new BeamlineRegistry(), { seed: 1901 });
  game.state.resources.funding = 1e9;
  game.state.resources.spares = 1e9;
  const pose = { col: 70, row: 70, subCol: 0, subRow: 0, dir: 0 };
  const rugDef = PLACEABLES.areaRug;
  const rugId = game.placePlaceable({ type: 'areaRug', variant: 2, ...pose });

  assertOk(!!rugId && game.getPlaceable(rugId)?.variant === 2,
    'an area rug places with its selected variant');
  assertOk(canPlace(
    game, PLACEABLES.standingDesk,
    pose.col, pose.row, pose.subCol, pose.subRow, pose.dir,
  ).ok, 'ordinary furniture can preview directly over an existing rug');

  const deskId = game.placePlaceable({ type: 'standingDesk', ...pose });
  assertOk(!!deskId, 'ordinary furniture commits directly over an existing rug');
  const deskCell = PLACEABLES.standingDesk.footprintCells(
    pose.col, pose.row, pose.subCol, pose.subRow, pose.dir,
  )[0];
  assertOk(game.state.subgridOccupied[cellKey(deskCell)]?.id === deskId,
    'the desk, not the rug, owns the shared floor cell');

  game._rebuildPlaceableIndex();
  assertOk(game.state.subgridOccupied[cellKey(deskCell)]?.id === deskId,
    'occupancy rebuild preserves the layered rug and desk');
  const furnishings = game.state.zoneFurnishings;
  const deskLegacyIndex = furnishings.findIndex(entry => entry.id === deskId) + 1;
  assertOk(game.state.zoneFurnishingSubgrids[`${pose.col},${pose.row}`]?.[0]?.[0]
      === deskLegacyIndex,
    'legacy furnishing hit-testing still selects the desk above the rug');

  assertOk(game.removePlaceable(deskId), 'the desk can be removed independently');
  assertOk(game.state.placeables.some(entry => entry.id === rugId),
    'removing furniture leaves the floor covering in place');
}

{
  const game = new Game(new BeamlineRegistry(), { seed: 1902 });
  game.state.resources.funding = 1e9;
  const pose = { col: 74, row: 74, subCol: 0, subRow: 0, dir: 0 };
  const deskId = game.placePlaceable({ type: 'standingDesk', ...pose });
  const rugId = game.placePlaceable({ type: 'areaRug', variant: 1, ...pose });
  assertOk(!!deskId && !!rugId, 'a rug can also be placed after overlapping furniture');
  const cell = PLACEABLES.standingDesk.footprintCells(
    pose.col, pose.row, pose.subCol, pose.subRow, pose.dir,
  )[0];
  assertOk(game.state.subgridOccupied[cellKey(cell)]?.id === deskId,
    'placing a rug later never replaces existing floor occupancy');
}

console.log('\n=== architectural glass catalogue ===\n');

{
  const wall = WALL_TYPES.glassWall;
  const door = DOOR_TYPES.glassDoor;
  assertOk(wall?.isGlassWall === true && wall.wallHeight === 24,
    'framed glass wall is a full-height interior wall type');
  assertOk(door?.isGlassDoor === true && door.wallHeight === wall.wallHeight,
    'framed glass door is sized for the glass wall system');
  assertOk(wall.variants.length === wall.variantGlassColors.length
      && wall.variants.length === wall.variantGlassOpacities.length,
    'every glass wall variant declares tint and opacity');
  assertOk(door.variants.length === door.variantGlassColors.length
      && door.variants.length === door.variantGlassOpacities.length,
    'every glass door variant declares tint and opacity');
}

for (const id of ['clerestoryWindow', 'conferenceWindow', 'ribbonWindow']) {
  const def = WINDOW_TYPES[id];
  const hostHeight = def.previewWallHeight;
  assertOk(!!def?.isWindow && def.mullions?.vertical > 0,
    `${id} is a framed multi-pane window type`);
  assertOk(def.sillHeight + windowOpeningHeight(def, hostHeight) + def.headClearance <= hostHeight,
    `${id} fits within its intended wall height`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
