// test/test-lighting-defs.js
//
// Tests for the nine facility lighting fixtures defined in
// src/data/placeables/lighting.js and wired into PLACEABLES via
// src/data/placeables/index.js.
//
//   1. All nine catalogue ids exist in PLACEABLES with the spec's mount.
//   2. Every def with a `light` block has a valid mount, positive
//      energyCost, positive light.radius, and — for cone shapes — a
//      coneDeg and tiltDeg.
//   3. Importing placeables/index.js without throwing IS the no-duplicate-id
//      assertion (it throws on duplicates at module load).
//   4. DECORATIONS_RAW no longer carries lamppost/bollardLight/spotLight —
//      one source of truth, not two.
//   5. Regression guard for the world-snapshot.js companion change: every
//      remaining DECORATIONS_RAW entry resolves an identical category,
//      subW, subL and subH through the new PLACEABLES[d.type] lookup as it
//      did through the old DECORATIONS_RAW[d.type] lookup. This is the
//      thing that matters most in this task — a silent regression here
//      means every decoration in the game gets category 'unknown' and
//      4x4x4 default dims with no error.

import { PLACEABLES } from '../src/data/placeables/index.js';
import { DECORATIONS_RAW } from '../src/data/decorations.raw.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ==========================================================================
// Test 1: the nine catalogue fixtures exist with the spec's mount.
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
    ceilingPanel: 'overhead',
    highBay: 'overhead',
  };

  for (const [id, mount] of Object.entries(EXPECTED_MOUNTS)) {
    const def = PLACEABLES[id];
    assert(!!def, `PLACEABLES has '${id}'`);
    if (def) {
      assert(def.mount === mount, `'${id}' has mount '${mount}' (got '${def.mount}')`);
      assert(def.kind === 'decoration', `'${id}' has kind 'decoration' (got '${def.kind}')`);
      assert(def.category === 'lighting', `'${id}' has category 'lighting' (got '${def.category}')`);
    }
  }
}

// ==========================================================================
// Test 2: every light-bearing def has a coherent light block.
// ==========================================================================
console.log('\n--- Test 2: light blocks are well-formed ---');
{
  const LIGHT_MOUNTS = new Set(['ground', 'wall', 'overhead']);
  const lit = Object.values(PLACEABLES).filter(p => p.light != null);

  assert(lit.length === 9, `exactly 9 placeables carry a light block (got ${lit.length})`);

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
// swap resolves every remaining decoration identically to the old lookup.
// ==========================================================================
console.log('\n--- Test 5: PLACEABLES lookup matches old DECORATIONS_RAW lookup ---');
{
  const ids = Object.keys(DECORATIONS_RAW);
  assert(ids.length > 0, 'DECORATIONS_RAW still has entries to check against');

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
    const oldResolved = resolve(DECORATIONS_RAW[id]);
    const newResolved = resolve(PLACEABLES[id]);
    assert(
      oldResolved.category === newResolved.category &&
      oldResolved.subW === newResolved.subW &&
      oldResolved.subL === newResolved.subL &&
      oldResolved.subH === newResolved.subH,
      `${id}: PLACEABLES resolves the same category/subW/subL/subH as DECORATIONS_RAW ` +
      `(old ${JSON.stringify(oldResolved)}, new ${JSON.stringify(newResolved)})`,
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
