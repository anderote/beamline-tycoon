// test/test-map-expansion.js — the map is a resource the player buys, not a
// compile-time constant.
//
// Three properties, in the order they have to hold:
//
//   1. THE EXTENT IS STATE. `mapHalfExtent` starts at 30 (61x61 tiles),
//      serialises, and is the single number every map bound in the game reads.
//      It used to be a literal 35 duplicated across map-generator.js,
//      world-snapshot.js and agent/observation.js — three copies that had to
//      agree and nothing that made them.
//   2. EXPANSION NEVER MOVES EXISTING TERRAIN. generateStartingMap draws from a
//      SEQUENTIAL LCG, so its output depends on how many tiles it iterates:
//      re-running it at a larger extent would hand every tile a different draw
//      and relocate every tree, including the ones the player built around.
//      New ground therefore comes from generateAnnulus, whose randomness is
//      position-hashed. The assertion that proves it is
//      `30->60 plus 60->90 equals 30->90`, exactly: if a tile's contents can
//      depend on iteration order or on how much land has been bought, that
//      identity breaks.
//   3. BUYING LAND IS A PURCHASE. It goes through canAfford/chargeConstruction
//      like every other debit, refuses when the money is not there, refuses
//      when the ladder runs out, and survives a save.
//
// The starting map deliberately SHRANK here, 71x71 -> 61x61. That is the point
// of the feature — a map you outgrow is what makes land worth buying — so this
// file does NOT assert bit-identity with the old generator. It asserts what
// still has to be true: same seed, same map; nothing outside the extent.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import {
  generateStartingMap, generateAnnulus, DEFAULT_MAP_HALF_EXTENT,
} from '../src/game/map-generator.js';
import {
  LAND_PARCELS, LAND_PARCEL_COST, nextLandParcel, MAX_MAP_HALF_EXTENT,
} from '../src/data/land.js';
import { STOCK_DESIGNS } from '../src/data/stock-designs.js';
import { DesignPlacer } from '../src/ui/DesignPlacer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const newGame = (seed) => new Game(new BeamlineRegistry(), { seed });
// Placeables keyed by identity-on-the-ground. Ids are deliberately excluded:
// they are assigned in iteration order, which is exactly the thing the
// order-independence assertions are allowed to differ on.
const key = (ps) => JSON.stringify(
  ps.map(p => [p.type, p.col, p.row, p.subCol, p.subRow]).sort());

// ==========================================================================
// 1. mapHalfExtent is state, not a constant
// ==========================================================================
console.log('\n=== mapHalfExtent is state, not a constant ===\n');
{
  const g = newGame(77);
  assert(g.state.mapHalfExtent === 30,
    `starts at 30 (got ${g.state.mapHalfExtent})`);
  assert(DEFAULT_MAP_HALF_EXTENT === 30,
    `map-generator publishes the same starting extent (got ${DEFAULT_MAP_HALF_EXTENT})`);

  const saved = JSON.parse(g.serialize()).state;
  assert(saved.mapHalfExtent === 30, 'mapHalfExtent is serialised');
}

// The three former MAP_EXTENT sites. A literal surviving in any of them is the
// bug this whole rework exists to remove — they have to agree, and the only way
// to guarantee that is for none of them to hold a number of its own.
{
  // Code only — the comments in these files still discuss the old numbers,
  // which is exactly where a superseded constant belongs.
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  // Standalone integer, so 0.35 (a meadow falloff) and 1274126177 (a hash
  // constant) are not mistaken for a map bound.
  const literal = (n) => new RegExp(`(?<![\\w.])${n}(?![\\w.])`);

  const sites = [
    'src/game/map-generator.js',
    'src/renderer3d/world-snapshot.js',
    'src/game/agent/observation.js',
  ];
  for (const rel of sites) {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    assert(!literal(35).test(code), `${rel}: no leftover half-extent literal 35`);
    assert(!literal(71).test(code), `${rel}: no leftover tiles-per-side literal 71`);
  }
}

// ==========================================================================
// 2. A fresh map is deterministic and fits the extent
// ==========================================================================
console.log('\n=== a fresh map is deterministic and fits its extent ===\n');
{
  // Not bit-identical to the old 71x71 map — the start deliberately shrinks.
  // What must hold is that generation is still deterministic per seed and that
  // nothing spawns outside the new, smaller extent.
  const a = newGame(4242);
  const b = newGame(4242);
  assert(key(a.state.placeables) === key(b.state.placeables),
    'same seed gives the same starting map');
  assert(a.state.placeables.length > 0, 'starting map is non-empty');
  const span = Math.max(...a.state.placeables.map(
    p => Math.max(Math.abs(p.col), Math.abs(p.row))));
  assert(span <= 30, `starting map fits in half-extent 30 (widest placeable at ${span})`);

  // The extent is a real parameter, not decoration: a bigger one generates a
  // bigger map from the same seed.
  const wide = generateStartingMap(4242, a.state.terrainBlobs, 45);
  const wideSpan = Math.max(...wide.placeables.map(
    p => Math.max(Math.abs(p.col), Math.abs(p.row))));
  assert(wideSpan > 30, `generateStartingMap honours a larger extent (reached ${wideSpan})`);
}

// ==========================================================================
// 3. Annulus generation is deterministic and order-independent
// ==========================================================================
console.log('\n=== annulus generation is deterministic and order-independent ===\n');
{
  const A = generateAnnulus(4242, [], 30, 60);
  const B = generateAnnulus(4242, [], 30, 60);
  assert(A.placeables.length > 0,
    `an annulus has ground cover on it (${A.placeables.length} placeables)`);
  assert(key(A.placeables) === key(B.placeables), 'same inputs give the same annulus');

  // Every placeable lands strictly inside the new ring, never in old land.
  const inRing = A.placeables.every(p => {
    const d = Math.max(Math.abs(p.col), Math.abs(p.row));
    return d > 30 && d <= 60;
  });
  assert(inRing, 'annulus contains no tile inside the previous extent');

  // Two chained purchases equal one big one — the property that makes
  // expansion order irrelevant, and therefore the property that guarantees
  // buying land cannot move a tree the player already built around.
  const chained = [...generateAnnulus(4242, [], 30, 60).placeables,
                   ...generateAnnulus(4242, [], 60, 90).placeables];
  const direct = generateAnnulus(4242, [], 30, 90).placeables;
  assert(key(chained) === key(direct), '30->60->90 equals 30->90');

  // The same, over real terrain blobs rather than featureless ground, so the
  // brightness-driven branch is covered too.
  const blobs = newGame(4242).state.terrainBlobs;
  const chainedB = [...generateAnnulus(4242, blobs, 30, 60).placeables,
                    ...generateAnnulus(4242, blobs, 60, 90).placeables];
  const directB = generateAnnulus(4242, blobs, 30, 90).placeables;
  assert(key(chainedB) === key(directB), '30->60->90 equals 30->90 over terrain blobs');

  // Degenerate rings are empty, not exceptions.
  assert(generateAnnulus(4242, [], 60, 60).placeables.length === 0,
    'a zero-width annulus is empty');
  assert(generateAnnulus(4242, [], 60, 30).placeables.length === 0,
    'a backwards annulus is empty');

  // Ids are unique within a purchase and continue from where the caller is.
  const withIds = generateAnnulus(4242, [], 30, 60, 500);
  const ids = new Set(withIds.placeables.map(p => p.id));
  assert(ids.size === withIds.placeables.length, 'annulus ids are unique');
  assert(withIds.placeableNextId === 500 + withIds.placeables.length,
    'annulus reports the next free id');
}

// ==========================================================================
// 4. The land ladder
// ==========================================================================
console.log('\n=== the land ladder ===\n');
{
  assert(LAND_PARCELS.length === 3, `three parcels (got ${LAND_PARCELS.length})`);
  let prevExtent = DEFAULT_MAP_HALF_EXTENT;
  for (const p of LAND_PARCELS) {
    assert(p.halfExtent > prevExtent, `${p.id}: half-extent ascends (${p.halfExtent})`);
    assert(p.cost === LAND_PARCEL_COST, `${p.id}: costs $500k`);
    assert(p.tilesPerSide === p.halfExtent * 2 + 1,
      `${p.id}: tilesPerSide matches half-extent (${p.tilesPerSide})`);
    assert(typeof p.name === 'string' && p.name.length > 0, `${p.id}: has a name`);
    prevExtent = p.halfExtent;
  }
  assert(MAX_MAP_HALF_EXTENT === LAND_PARCELS[LAND_PARCELS.length - 1].halfExtent,
    `MAX_MAP_HALF_EXTENT is the last parcel (${MAX_MAP_HALF_EXTENT})`);
  assert(nextLandParcel(DEFAULT_MAP_HALF_EXTENT)?.id === LAND_PARCELS[0].id,
    'the first parcel is what a new site is offered');
  assert(nextLandParcel(MAX_MAP_HALF_EXTENT) === null,
    'nothing is offered past the last parcel');

  const g = newGame(77);
  g.state.resources.funding = LAND_PARCEL_COST - 1;
  assert(g.getLandPurchaseStatus().affordable === false,
    'published land status reports a shortfall');
  g.state.resources.funding = LAND_PARCEL_COST;
  assert(g.getLandPurchaseStatus().affordable === true,
    'published land status uses the canonical affordability rule');
}

// ==========================================================================
// 5. Buying land
// ==========================================================================
console.log('\n=== buying land ===\n');
{
  const g = newGame(77);
  g.state.resources.funding = 0;
  assert(g.buyLand().ok === false, 'cannot buy land with no money');
  assert(g.state.mapHalfExtent === 30, 'a refused purchase does not move the map');

  g.state.resources.funding = 1e12;
  const before = g.state.placeables.length;
  const beforeKey = key(g.state.placeables);
  const r = g.buyLand();
  assert(r.ok === true, `purchase succeeds (${r.reason || ''})`);
  assert(g.state.mapHalfExtent === 60, `map grew to 60 (got ${g.state.mapHalfExtent})`);
  assert(g.state.placeables.length > before, 'new land arrived with terrain on it');
  assert(g.state.resources.funding < 1e12, 'funding was spent');

  // The whole reason for the position hash: the starting map is untouched.
  const kept = g.state.placeables.filter(
    p => Math.max(Math.abs(p.col), Math.abs(p.row)) <= 30);
  assert(key(kept) === beforeKey, 'buying land did not move a single existing tree');

  // Ids stayed unique across the join, or the placeable index silently loses
  // whichever of the two collided.
  const ids = new Set(g.state.placeables.map(p => p.id));
  assert(ids.size === g.state.placeables.length, 'ids are still unique after a purchase');
  assert(Object.keys(g.state.placeableIndex).length === g.state.placeables.length,
    'the placeable index covers the new land');

  // Exhaustion.
  for (let i = 0; i < 10; i++) g.buyLand();
  assert(g.state.mapHalfExtent === MAX_MAP_HALF_EXTENT,
    `stops at the last parcel (got ${g.state.mapHalfExtent})`);
  assert(g.buyLand().ok === false, 'no parcels left to buy');
}

// ==========================================================================
// 6. A bought map survives the save
// ==========================================================================
console.log('\n=== a bought map survives the save ===\n');
{
  const g = newGame(4242);
  g.state.resources.funding = 1e12;
  assert(g.buyLand().ok === true, 'bought a parcel to round-trip');
  const extent = g.state.mapHalfExtent;
  const count = g.state.placeables.length;
  const mapKey = key(g.state.placeables);
  g.save();

  const g2 = newGame(4242);
  assert(g2.load() === true, 'the save loads');
  assert(g2.state.mapHalfExtent === extent,
    `mapHalfExtent survives the round trip (${g2.state.mapHalfExtent} vs ${extent})`);
  assert(g2.state.placeables.length === count,
    `the bought land's terrain survives (${g2.state.placeables.length} vs ${count})`);
  assert(key(g2.state.placeables) === mapKey, 'and lands on exactly the same tiles');
}

// ---------------------------------------------------------------------------
// The land ladder has to BIND. Nothing else in the placement path knows where
// the ground ends — `valid` checks occupancy and affordability, and
// validateDrawPipe checks ports, straightness and pipe overlap — so without an
// on-site check in DesignPlacer a 121-tile collider lays itself out past the
// edge of the world on the starting site and every parcel is decoration.
// ---------------------------------------------------------------------------
console.log('\n--- a machine that cannot fold needs the land bought for it ---');
{
  const design = STOCK_DESIGNS.find(d => d.id === 'collider-zpole');
  assert(!!design, 'collider-zpole is in the roster');

  const g = newGame(77);
  g.setSandboxMode(true);
  g.state.resources.funding = 1e12;

  const p = new DesignPlacer(g, { _renderCursors() {} });
  p.start(design);
  p.setPosition(-25, 0);
  assert(p.valid === false, 'a 121-tile straight run is refused on the 61-tile starting site');
  assert(p.invalidReason === 'off-site',
    `refused for leaving the site, not for something else (got ${p.invalidReason})`);

  while (g.buyLand().ok) { /* to the last parcel */ }
  assert(g.state.mapHalfExtent === MAX_MAP_HALF_EXTENT, 'bought every parcel');

  const p2 = new DesignPlacer(g, { _renderCursors() {} });
  p2.start(design);
  p2.setPosition(-110, 0);
  assert(p2.valid === true, 'and accepted once the land is there');
}

// ---------------------------------------------------------------------------
// A refused placement must not spend the New Beamline pick.
// `pendingBeamlineTypeId` lives on the Game instance rather than in `state`,
// so serialize() does not carry it and restoreSnapshot used to leave it spent:
// _ensureBeamlineForSourcePlaceable consumes it the moment a source lands, and
// a placement that then failed and rolled back left the retry minting an
// UNTYPED beamline with an unfiltered palette — from one misclick.
// ---------------------------------------------------------------------------
console.log('\n--- a rolled-back placement gives the beamline pick back ---');
{
  const g = newGame(77);
  g.startNewBeamline('xfel');
  assert(g.pendingBeamlineTypeId === 'xfel', 'the pick is armed');

  const entry = g._makeUndoEntry();
  g.pendingBeamlineTypeId = null;             // exactly what consuming it does
  g.restoreSnapshot(entry);
  assert(g.pendingBeamlineTypeId === 'xfel',
    `the pick rewinds with the state it belonged to (got ${g.pendingBeamlineTypeId})`);

  // A bare payload string is a WORLD REPLACEMENT, not an undo, and must still
  // clear the pick — _applyState drops it because "it belongs to the world
  // being replaced", and the first imported source would otherwise eat it.
  // Only the undo path, which carries the field explicitly, puts it back.
  g.startNewBeamline('collider');
  g.restoreSnapshot(entry.payload);
  assert(g.pendingBeamlineTypeId === null,
    `a payload-only restore still drops the pick (got ${g.pendingBeamlineTypeId})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
