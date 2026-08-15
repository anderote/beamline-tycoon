// test/test-palette-search.js — build-menu search index + ranking.
//
// Covers the two correctness bugs the search brief calls out explicitly:
//   1. the index must reach all six placeable families (a search that only
//      sees COMPONENTS silently misses most of the game), and
//   2. research-locked components must never be searchable, even though
//      they're only excluded from COMPONENTS — every other family has no
//      lock concept at all.
// Plus the ranking order and the motivating "desk"/"table" case: a query
// that surfaces furnishings scattered across multiple facility room (and
// grounds) categories at once, which browsing category tabs cannot do.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { buildPaletteIndex, searchPalette, matchesWordPrefix } from '../src/ui/palette-search.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// Game talks to localStorage; back it with a Map for Node (same pattern as
// test-game-undo.js).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeGame() {
  return new Game(new BeamlineRegistry(), { seed: 1 });
}

// === 1. The index reaches every family ===================================
{
  const game = makeGame();
  const index = buildPaletteIndex(game);

  assertOk(index.length > 100, `index has a substantial number of entries (got ${index.length})`);

  const bySource = (src) => index.filter(e => e.source === src);
  assertOk(bySource('components').some(e => e.id === 'drift'), 'COMPONENTS: at least one known beamline component (drift) is indexed');
  assertOk(bySource('structure').some(e => e.kind === 'floor'), 'structure: at least one floor is indexed');
  assertOk(bySource('structure').some(e => e.kind === 'wall'), 'structure: at least one wall is indexed');
  assertOk(bySource('structure').some(e => e.kind === 'door'), 'structure: at least one door is indexed');
  assertOk(bySource('decorations').length > 0, 'decorations: at least one decoration is indexed');
  assertOk(bySource('facility').some(e => e.kind === 'furnishing'), 'facility: at least one furnishing is indexed');
  assertOk(bySource('facility').some(e => e.kind === 'zone'), 'facility: the zone paint tools are indexed');

  // DEMOLISH_BUTTONS are tools, not placeables — deliberately excluded.
  assertOk(!index.some(e => e.id === 'demolishAll'), 'demolish tool buttons are excluded from the index');

  // Every entry must resolve to a mode + category a player can actually
  // land on — a dangling entry would arm a tool and then fail to switch
  // the palette anywhere sensible.
  const allHaveHome = index.every(e => e.mode && e.category && e.kind && e.id);
  assertOk(allHaveHome, 'every index entry has a mode, category, kind and id');
}

// === 2. Research-locked components are excluded ===========================
{
  const game = makeGame(); // fresh game: completedResearch is empty
  const locked = COMPONENTS.srfGun;
  assertOk(!!locked && locked.requires === 'srfGunTech', 'sanity: srfGun is gated behind srfGunTech');
  assertOk(!game.isComponentUnlocked(locked), 'sanity: srfGun is locked on a fresh game');

  const index = buildPaletteIndex(game);
  assertOk(!index.some(e => e.id === 'srfGun'), 'locked component (srfGun) is excluded from the index');

  // Unlock it and rebuild — buildPaletteIndex is a pure function of `game`,
  // so the caller rebuilding on a 'researchChanged' event is how the HUD
  // keeps this live without a page reload.
  game.state.completedResearch.push('srfGunTech');
  const index2 = buildPaletteIndex(game);
  assertOk(index2.some(e => e.id === 'srfGun'), 'newly-unlocked component appears once the index is rebuilt');
}

// === 3. Ranking order ======================================================
{
  const game = makeGame();
  const index = buildPaletteIndex(game);

  // 'desk' name-exact vs a description-only substring hit should rank the
  // exact name match first.
  const deskResults = searchPalette('desk', index);
  assertOk(deskResults.length > 0, `"desk" returns results (got ${deskResults.length})`);
  assertOk(deskResults[0].id === 'desk', `exact name match ("Desk") ranks first (got ${deskResults[0]?.id})`);

  // A query under 2 characters returns nothing (matches searchWiki's rule).
  assertOk(searchPalette('d', index).length === 0, 'single-character query returns no results');
  assertOk(searchPalette('', index).length === 0, 'empty query returns no results');
}

// === 4. The motivating case: "table" spans multiple facility room
// categories (and Grounds) at once — the thing browsing tabs cannot do. ===
{
  const game = makeGame();
  const index = buildPaletteIndex(game);
  const results = searchPalette('table', index);

  console.log('  "table" query results:');
  for (const r of results) console.log(`    ${r.name.padEnd(20)} ${r.mode}/${r.category} (${r.kind}, ${r.source}, matchedIn=${r.matchedIn})`);

  const categories = new Set(results.map(r => `${r.mode}/${r.category}`));
  assertOk(results.length >= 4, `"table" surfaces several distinct items (got ${results.length})`);
  assertOk(categories.size >= 3, `"table" spans at least 3 distinct mode/category homes (got ${categories.size}: ${[...categories].join(', ')})`);
  assertOk(results.some(r => r.category === 'officeSpace'), '"table" reaches Office Space (coffeeTable)');
  assertOk(results.some(r => r.category === 'cafeteria'), '"table" reaches Cafeteria (diningTable)');
  assertOk(results.some(r => r.category === 'meetingRoom'), '"table" reaches Meeting Room (conferenceTable)');
  assertOk(results.some(r => r.mode === 'grounds'), '"table" reaches Grounds mode (picnicTable), not just Facility');

  // Regression: "table" is a mid-word substring of "stable" (Package
  // Chiller's desc: "50 kW of stable water"), "adjustable" (Aperture's
  // desc: "Simple adjustable slit..."), "Stackable" (Meeting Chair),
  // "Rotatable" (Polarizer Mount), and "Insertable" (Screen/YAG) — all real
  // false positives a naive substring search produced before word-boundary
  // matching. None of them should appear.
  assertOk(!results.some(r => r.id === 'packageChiller'), '"table" does not match "stable" inside Package Chiller\'s description');
  assertOk(!results.some(r => r.id === 'aperture'), '"table" does not match "adjustable" inside Aperture\'s description');
  assertOk(!results.some(r => r.id === 'meetingChair'), '"table" does not match "Stackable" (Meeting Chair\'s description)');

  // Name/id matches must all rank ahead of description-only matches — the
  // grouping searchPalette does so a flood of incidental description hits
  // can't bury the real items.
  const firstDescIdx = results.findIndex(r => r.matchedIn === 'desc');
  const lastNameIdx = results.map(r => r.matchedIn).lastIndexOf('name');
  if (firstDescIdx !== -1 && lastNameIdx !== -1) {
    assertOk(lastNameIdx < firstDescIdx, 'every name/id match is ranked ahead of every description-only match');
  }
}

// === 5. Word-boundary matching, directly ===================================
// The bug fixed above lived entirely in this one predicate — a direct test
// against the exact strings that produced the false positives.
{
  assertOk(matchesWordPrefix('Coffee Table', 'table'), '"table" matches the word "Table" in "Coffee Table"');
  assertOk(matchesWordPrefix('50 kW of stable water', 'table') === false, '"table" does NOT match mid-word inside "stable"');
  assertOk(matchesWordPrefix('portable pump cart', 'table') === false, '"table" does NOT match mid-word inside "portable"');
  assertOk(matchesWordPrefix('suitable for high-power facilities', 'table') === false, '"table" does NOT match mid-word inside "suitable"');
  assertOk(matchesWordPrefix('Stackable chair', 'table') === false, '"table" does NOT match mid-word inside "Stackable"');
  assertOk(matchesWordPrefix('Reception Desk', 'desk'), '"desk" matches the word "Desk" in "Reception Desk"');
  assertOk(matchesWordPrefix('deskilled labor', 'desk'), 'sanity: word-prefix (not whole-word) matching still matches "deskilled" — a prefix test, not a whole-word test');
}

console.log(`\n${passed}/${passed + failed} assertions passed`);
process.exit(failed > 0 ? 1 : 0);
