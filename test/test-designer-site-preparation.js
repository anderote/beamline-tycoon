// test/test-designer-site-preparation.js — decisive Beamline Designer Apply.
//
// Site preparation is part of the same transaction as the beamline edits:
// ordinary buildables and walls are bulldozed, concrete is laid through the
// real Game API, and a later refused beam operation restores every one of
// those changes.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { executeDesignerApply } from '../src/beamline/designer-apply.js';
import { COMPONENTS } from '../src/data/components.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { FLOORS, WALL_TYPES, variantCost } from '../src/data/structure.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};

let passed = 0;
let failed = 0;
function assert(condition, message) {
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

function placeSomewhere(game, type) {
  const extent = game.state.mapHalfExtent;
  for (let row = -extent + 3; row <= extent - 3; row += 2) {
    for (let col = -extent + 3; col <= extent - 3; col += 2) {
      const id = game.placePlaceable({ type, col, row, subCol: 0, subRow: 0 });
      if (id) return { id, col, row };
    }
  }
  return null;
}

function siteOps(site) {
  return [
    {
      kind: 'bulldozePlaceable', nodeIndex: 2,
      placeableId: site.id, destructive: false, removalCost: 0,
    },
    {
      kind: 'bulldozeWall', nodeIndex: 2,
      col: site.col, row: site.row, edge: 'e',
    },
    {
      kind: 'placeConcrete', nodeIndex: 2,
      col: site.col, row: site.row,
    },
  ];
}

console.log('\n=== Decisive Designer site preparation ===\n');

const game = makeGame(891);
const site = placeSomewhere(game, 'coolantPump');
assert(site, 'fixture: placed ordinary equipment at a clear site');

assert(game.placeInfraTile(site.col, site.row, 'path'),
  'fixture: placed a non-concrete floor under the obstruction');
assert(game.placeWall(site.col, site.row, 'e', 'structuralWall'),
  'fixture: placed a wall at the construction site');

const fundingBefore = game.state.resources.funding;
const floorBefore = game.state.infraOccupied[`${site.col},${site.row}`];
const wallBefore = game.state.wallOccupied[`${site.col},${site.row},e`];
const occupiedCellsBefore = Object.entries(game.state.subgridOccupied)
  .filter(([, value]) => (typeof value === 'string' ? value : value?.id) === site.id)
  .map(([key]) => key)
  .sort();

const failedApply = executeDesignerApply(game, [
  ...siteOps(site),
  {
    kind: 'placeOnPipe', nodeIndex: 3,
    pipeId: 'missing-pipe', type: 'bpm', position: 0.5, subL: 1, mode: 'snap',
  },
]);

assert(failedApply.ok === false && failedApply.failure?.kind === 'placeOnPipe',
  'a refused late beamline step reports the exact failing operation');
assert(!!game.getPlaceable(site.id),
  'rollback restores the bulldozed equipment');
assert(game.state.infraOccupied[`${site.col},${site.row}`] === floorBefore,
  'rollback restores the replaced floor instead of leaving concrete');
assert(game.state.wallOccupied[`${site.col},${site.row},e`] === wallBefore,
  'rollback restores the demolished wall');
const occupiedCellsAfter = Object.entries(game.state.subgridOccupied)
  .filter(([, value]) => (typeof value === 'string' ? value : value?.id) === site.id)
  .map(([key]) => key)
  .sort();
assert(JSON.stringify(occupiedCellsAfter) === JSON.stringify(occupiedCellsBefore),
  'rollback restores the site occupancy claims');
assert(game.state.resources.funding === fundingBefore,
  'rollback restores every site-preparation charge and refund');

const successfulApply = executeDesignerApply(game, siteOps(site));
assert(successfulApply.ok === true && successfulApply.failure === null,
  'the same site preparation commits when every operation succeeds');
assert(!game.getPlaceable(site.id), 'successful Apply bulldozes the obstruction');
assert(game.state.infraOccupied[`${site.col},${site.row}`] === 'concrete',
  'successful Apply leaves a concrete foundation');
assert(!game.state.wallOccupied[`${site.col},${site.row},e`],
  'successful Apply removes the wall in the way');

const expectedDelta = Math.floor((PLACEABLES.coolantPump.cost.funding || 0) * 0.5)
  + Math.floor(variantCost(WALL_TYPES.structuralWall, 0) * 0.5)
  - FLOORS.concrete.cost;
assert(game.state.resources.funding - fundingBefore === expectedDelta,
  'the committed transaction settles the demolition refunds and concrete cost exactly once');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
