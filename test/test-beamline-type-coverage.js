// test/test-beamline-type-coverage.js
//
// Can you actually BUILD a machine of each beamline type?
//
// The palette filter is two-directional (component allowlist, type denylist)
// and research gating is a third, independent filter layered on top. Nothing
// checked that the three of them intersect to leave a usable set of hardware.
// They did not: before the RF ladder landed, an XFEL unlocked onto a palette
// whose best accelerating structure was `sbandStructure` at 51 MeV a placement,
// so reaching the 6 GeV band floor took 118 of them. Nothing failed. The type
// was simply unplayable, and the only way to find out was to try to build one.
//
// This file turns "try to build one" into arithmetic. For each type it takes
// the strongest source and the strongest accelerating structure the type can
// see, and asks how many placements the band needs:
//
//     placements = ceil((target - bestExtractionEnergy) / bestEnergyGain)
//
// which is the number of tiles a player drags out, and therefore the number
// that decides whether the type is a machine or a corridor.
//
// Two conditions, because they ask different questions:
//
//   REACH AT FULL RESEARCH targets the band TOP. Everything is unlocked; this
//   is "is the ceiling of this type reachable at all?"
//
//   REACH AT UNLOCK targets the band BOTTOM, over only the hardware the type's
//   own `requires` closure has already paid for. This is "the moment this type
//   appears in the picker, can I build a working one?" — the question the XFEL
//   failed. The bottom, not the top, is deliberate: `collider` tops out at 500
//   GeV/beam via `plasmaAfterburner`, which sits behind `plasmaAcceleration`
//   and is MEANT to be a late stretch goal. Measuring the collider's top at
//   unlock would force the type behind plasma research, which is a design
//   regression, not a fix.
//
// The budgets (35 / 40) are generous on purpose. They are not balance targets —
// balance lives in scripts/balance-sim.mjs. They are the line between "long
// build" and "the content is missing", and a regression here reads as a number
// in the printed table rather than a bare FAIL.

import { COMPONENTS } from '../src/data/components.js';
import { BEAMLINE_TYPES } from '../src/data/beamline-types.js';
import { RESEARCH } from '../src/data/research.js';
import {
  beamlineTypeHidesComponent, BEAMLINE_CATEGORIES,
} from '../src/ui/BeamlineTypePicker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// Budgets, in placements.
const MAX_AT_FULL_RESEARCH = 35;
const MAX_AT_UNLOCK = 40;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `requires` is a bare id, an array, or absent everywhere in the data. */
const asArray = (v) => (Array.isArray(v) ? v : (v == null ? [] : [v]));

/**
 * Every research node implied by finishing `ids`, walked transitively through
 * `requires`. A type's own `requires` is the set the player has demonstrably
 * bought by the time the type appears, so its closure is exactly the hardware
 * available on day one of that type.
 */
function researchClosure(ids) {
  const done = new Set();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop();
    if (done.has(id)) continue;
    done.add(id);
    const node = RESEARCH[id];
    if (!node) continue;
    for (const parent of asArray(node.requires)) stack.push(parent);
  }
  return done;
}

/**
 * The build palette for a type: every beamline-category component that the
 * shared filter does not hide. Reusing `beamlineTypeHidesComponent` rather than
 * reimplementing the allowlist/denylist logic is the point — a test with its
 * own copy of the filter would pass while the palette was empty.
 */
function paletteFor(typeId) {
  return Object.entries(COMPONENTS).filter(
    ([key, comp]) => BEAMLINE_CATEGORIES.has(comp.category)
      && !beamlineTypeHidesComponent(typeId, key, comp),
  );
}

/**
 * Placements needed to get a beam from a standing start to `targetGeV`, using
 * the best hardware in `palette`.
 *
 * Source energy is the TOP-LEVEL `extractionEnergy` field, not `stats` — guns
 * declare it there and several sources (the electron `source`, `ionSource`)
 * declare it nowhere, contributing zero, which is correct: a gun that names no
 * extraction energy hands the linac a beam at rest.
 */
function placementsToReach(palette, targetGeV) {
  let bestExtraction = 0, extractionId = null;
  let bestGain = 0, gainId = null;
  for (const [key, comp] of palette) {
    if (comp.category === 'source' && (comp.extractionEnergy || 0) > bestExtraction) {
      bestExtraction = comp.extractionEnergy;
      extractionId = key;
    }
    // `energyGain` also appears on `energyDegrader` as a NEGATIVE number; the
    // > bestGain comparison drops it without a special case.
    if (comp.category === 'rf' && (comp.stats?.energyGain || 0) > bestGain) {
      bestGain = comp.stats.energyGain;
      gainId = key;
    }
  }
  const deficit = Math.max(0, targetGeV - bestExtraction);
  const count = deficit === 0 ? 0
    : (bestGain > 0 ? Math.ceil(deficit / bestGain) : Infinity);
  return { count, bestExtraction, extractionId, bestGain, gainId };
}

const fmt = (n) => (Number.isFinite(n) ? String(n) : 'UNREACHABLE');
const pad = (s, n) => String(s).padEnd(n);

// ---------------------------------------------------------------------------
// 1. Palette integrity — the three things without which nothing can be built.
// ---------------------------------------------------------------------------
console.log('\n--- Palette integrity ---');
for (const [typeId, type] of Object.entries(BEAMLINE_TYPES)) {
  const palette = paletteFor(typeId);
  const has = (pred) => palette.some(pred);

  assert(has(([, c]) => c.category === 'source'),
    `${typeId} can see at least one source`);
  assert(has(([, c]) => c.category === 'rf'),
    `${typeId} can see at least one rf component`);

  const endpoints = asArray(type.requiredEndpoint);
  assert(endpoints.length > 0 && has(([k]) => endpoints.includes(k)),
    `${typeId} can see a required endpoint (wants one of ${endpoints.join('/') || 'nothing'})`);
}

// ---------------------------------------------------------------------------
// 2/3. Reach, in both conditions, with the numbers printed either way.
// ---------------------------------------------------------------------------
console.log('\n--- Reach ---');
console.log(`  ${pad('type', 20)} ${pad('band GeV', 14)} ${pad('full research', 30)} unlock`);

for (const [typeId, type] of Object.entries(BEAMLINE_TYPES)) {
  const palette = paletteFor(typeId);
  const [bandLo, bandHi] = type.spec.energyGeV;

  const full = placementsToReach(palette, bandHi);

  const unlocked = researchClosure(asArray(type.requires));
  const unlockPalette = palette.filter(
    ([, comp]) => asArray(comp.requires).every((r) => unlocked.has(r)),
  );
  const atUnlock = placementsToReach(unlockPalette, bandLo);

  console.log(`  ${pad(typeId, 20)} ${pad(`${bandLo}-${bandHi}`, 14)} `
    + `${pad(`${fmt(full.count)} x ${full.gainId ?? 'nothing'}`, 30)} `
    + `${fmt(atUnlock.count)} x ${atUnlock.gainId ?? 'nothing'}`);

  assert(full.count <= MAX_AT_FULL_RESEARCH,
    `${typeId} reaches its band top (${bandHi} GeV) in ${fmt(full.count)} placements `
    + `<= ${MAX_AT_FULL_RESEARCH}, best ${full.gainId ?? 'nothing'} @ ${full.bestGain} GeV `
    + `from ${full.extractionId ?? 'rest'} @ ${full.bestExtraction} GeV`);

  assert(atUnlock.count <= MAX_AT_UNLOCK,
    `${typeId} reaches its band bottom (${bandLo} GeV) at unlock in ${fmt(atUnlock.count)} `
    + `placements <= ${MAX_AT_UNLOCK}, best ${atUnlock.gainId ?? 'nothing'} @ `
    + `${atUnlock.bestGain} GeV from ${atUnlock.extractionId ?? 'rest'} @ `
    + `${atUnlock.bestExtraction} GeV`);
}

// ---------------------------------------------------------------------------
// 4. No orphans. A component every type hides is content nobody will ever see,
//    and the usual cause is an allowlist that names a type id that was renamed.
// ---------------------------------------------------------------------------
console.log('\n--- No orphaned components ---');
{
  const typeIds = Object.keys(BEAMLINE_TYPES);
  const orphans = [];
  let checked = 0;
  for (const [key, comp] of Object.entries(COMPONENTS)) {
    if (!BEAMLINE_CATEGORIES.has(comp.category)) continue;
    checked++;
    const visible = typeIds.some((t) => !beamlineTypeHidesComponent(t, key, comp));
    if (!visible) {
      orphans.push(`'${key}' (allowlist ${JSON.stringify(comp.beamlineTypes ?? null)})`);
    }
  }
  assert(orphans.length === 0,
    `all ${checked} beamline components are visible to at least one type`
    + (orphans.length ? ` — invisible: ${orphans.join('; ')}` : ''));
}

// ---------------------------------------------------------------------------
// 5. Denylist hygiene. `excludes` is the type saying "this general-purpose
//    thing is wrong here". An entry naming a component that does not exist is
//    dead, and one the allowlist already hides is a lie about where the
//    decision lives — the next reader will edit the wrong file.
// ---------------------------------------------------------------------------
console.log('\n--- Denylist hygiene ---');
for (const [typeId, type] of Object.entries(BEAMLINE_TYPES)) {
  const dead = [], redundant = [];
  for (const key of asArray(type.excludes)) {
    const comp = COMPONENTS[key];
    if (!comp) { dead.push(key); continue; }
    if (Array.isArray(comp.beamlineTypes) && !comp.beamlineTypes.includes(typeId)) {
      redundant.push(key);
    }
  }
  assert(dead.length === 0,
    `${typeId}.excludes names only real components${dead.length ? ` — unknown: ${dead.join(', ')}` : ''}`);
  assert(redundant.length === 0,
    `${typeId}.excludes says nothing the allowlist already says`
    + (redundant.length ? ` — redundant: ${redundant.join(', ')}` : ''));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
