// test/test-lighting-defs.js
//
// Tests for the facility lighting fixtures defined in
// src/data/placeables/lighting.js and wired into PLACEABLES via
// src/data/placeables/index.js.
//
//   1. All catalogue ids exist in PLACEABLES with the spec's mount, and
//      each def's `category` follows the documented mount -> category rule
//      (ground -> 'lighting', wall/overhead/surface -> 'structureLights') rather
//      than a hardcoded per-id value, so this keeps working if a fixture's
//      mount is reassigned or new fixtures are added. Which palette tab
//      each category actually renders under, that all fixtures are covered with
//      none orphaned, and that every category key exists in MODES is
//      test/test-lighting-palette-split.js's job, not this file's — this
//      test only pins the catalogue's own mount/category consistency.
//   2. Every def with a `light` block has a valid mount, positive
//      energyCost, positive light.radius, and — for cone shapes — a
//      coneDeg and tiltDeg.
//   3. Importing placeables/index.js without throwing IS the no-duplicate-id
//      assertion (it throws on duplicates at module load).
//   4. DECORATIONS_RAW no longer carries lamppost/bollardLight/spotLight —
//      one source of truth, not two.
//   5. Regression guard for the world-snapshot.js companion change: every
//      one of the 24 pre-existing decorations resolves an identical
//      category, subW, subL and subH through the new PLACEABLES[d.type]
//      lookup as it did through the old DECORATIONS_RAW[d.type] lookup.
//      This is the thing that matters most in this task — a silent
//      regression here means every decoration in the game gets category
//      'unknown' and 4x4x4 default dims with no error. 21 of the 24 are
//      still checkable straight off DECORATIONS_RAW; lamppost and
//      bollardLight moved into lighting.js so their *old* values are
//      pinned explicitly below (they are the two ids most likely to drift,
//      since they're the ones whose file changed). spotLight was renamed
//      to floodLight, not moved id-for-id, so it is explicitly excluded
//      from this by-id comparison — see the note at Test 5.

import { PLACEABLES } from '../src/data/placeables/index.js';
import { DECORATIONS_RAW } from '../src/data/decorations.raw.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ==========================================================================
// Test 1: the catalogue fixtures exist with the spec's mount.
// ==========================================================================
console.log('\n--- Test 1: catalogue fixtures present with correct mount ---');
{
  const EXPECTED_MOUNTS = {
    lamppost: 'ground',
    doubleLamppost: 'ground',
    bollardLight: 'ground',
    highMastLight: 'ground',
    floodLight: 'ground',
    wallSconce: 'wall',
    bulkheadLight: 'wall',
    wallStripLight: 'wall',
    emergencyWallLight: 'wall',
    ceilingPanel: 'overhead',
    highBay: 'overhead',
    linearPendant: 'overhead',
    cleanroomPanel: 'overhead',
    deskLamp: 'surface',
    portableWorkLight: 'surface',
  };

  // Mirrors lighting.js's own CATEGORY_BY_MOUNT (not imported — it's a
  // private module const) so this asserts the *rule* — category is derived
  // from mount — rather than hardcoding each fixture's category, the same
  // way Test 5 mirrors buildDecorations' derivation instead of re-deriving
  // it ad hoc. Which tab a category actually renders under is
  // test-lighting-palette-split.js's job.
  const EXPECTED_CATEGORY_BY_MOUNT = {
    ground: 'lighting',
    wall: 'structureLights',
    overhead: 'structureLights',
    surface: 'structureLights',
  };

  for (const [id, mount] of Object.entries(EXPECTED_MOUNTS)) {
    const def = PLACEABLES[id];
    assert(!!def, `PLACEABLES has '${id}'`);
    if (def) {
      assert(def.mount === mount, `'${id}' has mount '${mount}' (got '${def.mount}')`);
      assert(def.kind === 'decoration', `'${id}' has kind 'decoration' (got '${def.kind}')`);
      assert(def.category === EXPECTED_CATEGORY_BY_MOUNT[mount],
        `'${id}' (mount '${mount}') has category '${EXPECTED_CATEGORY_BY_MOUNT[mount]}' per the mount->category rule (got '${def.category}')`);
    }
  }
}

// ==========================================================================
// Test 2: every light-bearing def has a coherent light block.
// ==========================================================================
console.log('\n--- Test 2: light blocks are well-formed ---');
{
  const LIGHT_MOUNTS = new Set(['ground', 'wall', 'overhead', 'surface']);
  const lit = Object.values(PLACEABLES).filter(p => p.light != null);

  assert(lit.length === 15, `exactly 15 placeables carry a light block (got ${lit.length})`);

  for (const def of lit) {
    assert(LIGHT_MOUNTS.has(def.mount), `${def.id}: mount '${def.mount}' is valid`);
    assert(typeof def.energyCost === 'number' && def.energyCost > 0,
      `${def.id}: energyCost is a positive number (got ${JSON.stringify(def.energyCost)})`);
    assert(typeof def.light.radius === 'number' && def.light.radius > 0,
      `${def.id}: light.radius is a positive number (got ${JSON.stringify(def.light.radius)})`);
    if (def.light.shape === 'cone') {
      assert(typeof def.light.coneDeg === 'number' && def.light.coneDeg > 0,
        `${def.id}: cone shape declares a positive coneDeg`);
      assert(typeof def.light.tiltDeg === 'number' && Number.isFinite(def.light.tiltDeg),
        `${def.id}: cone shape declares a numeric tiltDeg`);
    }
  }
}

// ==========================================================================
// Test 3: no id collision — a bare import that didn't throw IS the assertion
// (placeables/index.js throws "Duplicate placeable id" at module load).
// ==========================================================================
console.log('\n--- Test 3: no id collisions ---');
{
  assert(Object.keys(PLACEABLES).length > 0, 'placeables/index.js imported without throwing on duplicate ids');
}

// ==========================================================================
// Test 4: DECORATIONS_RAW no longer defines the three reworked fixtures.
// ==========================================================================
console.log('\n--- Test 4: reworked fixtures removed from DECORATIONS_RAW ---');
{
  assert(!('lamppost' in DECORATIONS_RAW), "DECORATIONS_RAW no longer has 'lamppost'");
  assert(!('bollardLight' in DECORATIONS_RAW), "DECORATIONS_RAW no longer has 'bollardLight'");
  assert(!('spotLight' in DECORATIONS_RAW), "DECORATIONS_RAW no longer has 'spotLight'");
}

// ==========================================================================
// Test 5: world-snapshot.js's DECORATIONS_RAW[d.type] -> PLACEABLES[d.type]
// swap resolves every one of the 24 pre-existing decorations identically to
// the old lookup.
//
// 21 of the 24 are still present in DECORATIONS_RAW, so their "old" values
// can be read straight off it. `lamppost` and `bollardLight` moved into
// lighting.js — this task's own change — so DECORATIONS_RAW no longer has
// them; their pre-existing values are pinned explicitly below, copied
// byte-for-byte from the decorations.raw.js entries this task deleted, so a
// future accidental drift in exactly the two fixtures whose file changed
// still gets caught. `spotLight` was renamed to `floodLight`, not moved
// id-for-id — there is no "old spotLight resolved via the new lookup" to
// compare, since the id itself no longer exists anywhere. It is excluded
// from this comparison deliberately, not by omission: Test 4 already
// confirms `spotLight` is gone, and Test 1/2 confirm `floodLight` exists
// with a well-formed light block under its new id.
// ==========================================================================
console.log('\n--- Test 5: PLACEABLES lookup matches every raw decoration plus moved fixtures ---');
{
  // Pre-existing values for the two ids that moved out of DECORATIONS_RAW
  // and into lighting.js, exactly as decorations.raw.js declared them
  // before this task removed them.
  const MOVED_OLD_VALUES = {
    lamppost: { category: 'lighting', subW: 1, subL: 1, subH: 6 },
    bollardLight: { category: 'lighting', subW: 1, subL: 1, subH: 2 },
  };

  const rawIds = Object.keys(DECORATIONS_RAW);
  const ids = [...new Set([...rawIds, ...Object.keys(MOVED_OLD_VALUES)])];
  assert(ids.length === rawIds.length + Object.keys(MOVED_OLD_VALUES).length,
    `${rawIds.length} raw decoration ids plus lamppost + bollardLight are covered ` +
    `(spotLight excluded — renamed, not moved id-for-id) (got ${ids.length})`);
  assert(!ids.includes('spotLight'), "'spotLight' is excluded from this comparison, not silently missing");

  // Mirrors the exact field derivation buildDecorations used to do straight
  // off DECORATIONS_RAW, so we're diffing old-lookup vs new-lookup, not
  // reinventing the derivation.
  const resolve = (raw) => ({
    category: raw?.category ?? 'unknown',
    subW: raw?.subW ?? raw?.gridW ?? 4,
    subL: raw?.subL ?? raw?.gridH ?? 4,
    subH: raw?.subH ?? 4,
  });

  for (const id of ids) {
    const oldResolved = MOVED_OLD_VALUES[id]
      ? { category: MOVED_OLD_VALUES[id].category, subW: MOVED_OLD_VALUES[id].subW, subL: MOVED_OLD_VALUES[id].subL, subH: MOVED_OLD_VALUES[id].subH }
      : resolve(DECORATIONS_RAW[id]);
    const newResolved = resolve(PLACEABLES[id]);
    assert(
      oldResolved.category === newResolved.category &&
      oldResolved.subW === newResolved.subW &&
      oldResolved.subL === newResolved.subL &&
      oldResolved.subH === newResolved.subH,
      `${id}: PLACEABLES resolves the same category/subW/subL/subH as the old lookup ` +
      `(old ${JSON.stringify(oldResolved)}, new ${JSON.stringify(newResolved)})`,
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
