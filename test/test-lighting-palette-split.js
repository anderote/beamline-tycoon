// test/test-lighting-palette-split.js
//
// Lighting fixtures split across two palette tabs by where they mount:
//   - mount: 'ground'            -> Grounds mode's `lighting` tab (free-
//     standing fixtures you plant outdoors — landscaping).
//   - mount: 'wall' | 'overhead' -> Structure mode's `structureLights` tab
//     (fixtures that attach to the building — building fabric, alongside
//     Flooring/Walls/Doors).
//
// The rule is keyed on `mount`, not a hardcoded id list (see
// src/data/placeables/lighting.js's CATEGORY_BY_MOUNT), and both tabs are
// decoration tabs (`isDecorationTab: true`) so the hud.js decoration-palette
// branch renders them — that branch used to hardcode MODES.grounds, which
// would have made the Structure tab render empty (see hud.js's
// _renderPaletteImpl, the `decCatDef` lookup).
//
// This test asserts three things, all against the real content (no synthetic
// defs, since the failure mode is specifically "real fixture ends up in the
// wrong or a nonexistent tab"):
//   1. Every mount resolves to the category the design calls for.
//   2. All nine fixtures are covered by exactly one of the two tabs — none
//      orphaned into a third category or left uncategorized.
//   3. Every lighting def's `category` is a key that actually exists in
//      MODES — an unrecognized category is invisible in every palette
//      (see src/data/validate.js's checkCategory).

import { MODES } from '../src/data/modes.js';
import { LIGHTING_DEFS } from '../src/data/placeables/lighting.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

console.log('\n--- Lighting palette split (mount -> category) ---');

const GROUNDS_LIGHTING = 'lighting';
const STRUCTURE_LIGHTS = 'structureLights';

// Sanity: the two category keys really exist as distinct MODES tabs.
assert(MODES.grounds?.categories?.[GROUNDS_LIGHTING]?.isDecorationTab === true,
  `MODES.grounds.categories.${GROUNDS_LIGHTING} exists and is a decoration tab`);
assert(MODES.structure?.categories?.[STRUCTURE_LIGHTS]?.isDecorationTab === true,
  `MODES.structure.categories.${STRUCTURE_LIGHTS} exists and is a decoration tab`);
assert(GROUNDS_LIGHTING !== STRUCTURE_LIGHTS,
  'grounds and structure lighting tabs use distinct category keys');

// Flat set of every category key declared anywhere in MODES — mirrors how
// src/data/validate.js's checkCategory / DECORATION_CATEGORIES resolve a
// category, so "invisible in every palette" is caught here too.
const ALL_MODE_CATEGORIES = new Set(
  Object.values(MODES).flatMap(mode => Object.keys(mode.categories)),
);

assert(LIGHTING_DEFS.length === 9, `nine lighting fixtures defined (got ${LIGHTING_DEFS.length})`);

const seen = { ground: 0, nonGround: 0 };
for (const def of LIGHTING_DEFS) {
  assert(ALL_MODE_CATEGORIES.has(def.category),
    `${def.id}: category '${def.category}' is a real MODES tab key`);

  if (def.mount === 'ground') {
    seen.ground++;
    assert(def.category === GROUNDS_LIGHTING,
      `${def.id} (mount: ground) resolves to Grounds -> Lighting`);
  } else if (def.mount === 'wall' || def.mount === 'overhead') {
    seen.nonGround++;
    assert(def.category === STRUCTURE_LIGHTS,
      `${def.id} (mount: ${def.mount}) resolves to Structure -> Lights`);
  } else {
    failed++;
    console.log(`  FAIL: ${def.id} has unrecognized mount '${def.mount}'`);
  }
}

assert(seen.ground === 5, `five ground-mounted fixtures found (got ${seen.ground})`);
assert(seen.nonGround === 4, `four wall/overhead-mounted fixtures found (got ${seen.nonGround})`);
assert(seen.ground + seen.nonGround === LIGHTING_DEFS.length,
  'every fixture is accounted for by exactly one tab (none orphaned)');

// The expected ids per tab, spelled out once so a future rename/id change
// that silently moves a fixture to the wrong tab fails loudly.
const expectedGround = ['lamppost', 'doubleLamppost', 'bollardLight', 'highMastLight', 'floodLight'];
const expectedStructure = ['wallSconce', 'bulkheadLight', 'ceilingPanel', 'highBay'];

const byId = Object.fromEntries(LIGHTING_DEFS.map(d => [d.id, d]));
for (const id of expectedGround) {
  assert(byId[id]?.category === GROUNDS_LIGHTING, `${id} is in Grounds -> Lighting`);
}
for (const id of expectedStructure) {
  assert(byId[id]?.category === STRUCTURE_LIGHTS, `${id} is in Structure -> Lights`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
