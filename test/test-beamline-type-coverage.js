// test/test-beamline-type-coverage.js
//
// Can you actually BUILD a machine of each beamline type?
//
// The palette filter is two-directional (component allowlist, type denylist)
// and component research gating is layered on top when the player builds.
// Mission families themselves are always selectable; this test asks whether
// the complete catalogue ultimately contains a credible implementation.
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
//   REACH AT FULL RESEARCH targets the band TOP. Everything is unlocked; this
//   is "is the ceiling of this type reachable at all?"
//
// The budget (55) is generous on purpose. It is not a balance target —
// balance lives in scripts/balance-sim.mjs. They are the line between "long
// build" and "the content is missing", and a regression here reads as a number
// in the printed table rather than a bare FAIL.
//
// AND A THIRD QUESTION, which is the one this file used to miss entirely:
//
//   DOES IT FIT ON ANY MAP THE PLAYER CAN BUY? Counting placements says how
//   many times the player drags hardware out; it says nothing about the ground
//   that hardware stands on. `collider` sailed through at 34 placements while
//   being 174 tiles of dead straight beamline — longer than the 61-tile site
//   the game starts on and, before the land ladder existed, longer than any
//   map in the game. The type was arithmetically buildable and physically
//   unsiteable, and nothing here could tell the difference. See section 3.

import { COMPONENTS } from '../src/data/components.js';
import { BEAMLINE_TYPES } from '../src/data/beamline-types.js';
import {
  beamlineTypeHidesComponent, BEAMLINE_CATEGORIES,
} from '../src/ui/BeamlineTypePicker.js';
import { MAX_MAP_HALF_EXTENT, halfExtentForStraightRun, LAND_PARCELS } from '../src/data/land.js';
import { DEFAULT_MAP_HALF_EXTENT } from '../src/game/map-generator.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// Budgets, in placements.
//
// 55, not the 35 this started at, and the number is arithmetic rather than
// taste: `blackHoleFactory`'s band top is 500,000 GeV and `crystalChannelStage`
// gives 12,000 GeV a placement, so 42 placements is what the machine IS. That
// ratio is the tier-6 design — a rung three orders of magnitude above the RF
// ladder, still needing four dozen of them — and lowering the cap would not
// make the machine shorter, it would only make this file refuse to describe it.
// 55 is the spec's acceptance criterion and leaves the 13 placements of
// headroom a future band or component tweak needs before anyone has to think
// about this constant again.
const MAX_AT_FULL_RESEARCH = 55;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Component `requires` is a bare id, an array, or absent. */
const asArray = (v) => (Array.isArray(v) ? v : (v == null ? [] : [v]));

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

// ---------------------------------------------------------------------------
// Length: the criterion the placement count cannot see.
// ---------------------------------------------------------------------------

// One map tile of beamline is four sub-units of half a metre each — see the
// SUB_PER_TILE note in src/beamline/design-layout.js and the sub-unit
// definition in flattener.js. So `subL / 4` is tiles, and `tiles * 2` is
// metres.
const SUB_PER_TILE = 4;
const METRES_PER_TILE = 2;

/**
 * Tiles of beamline the machine in `reach` occupies: the source, the
 * accelerating structures it takes to cross the band, and the endpoint the
 * beam has to stop in.
 *
 * This is the LEANEST possible machine of the type — no optics, no
 * diagnostics, no drift, and no inter-module pipe (every real design has at
 * least one tile of pipe between neighbouring modules, so a shipped blueprint
 * always measures longer; test-stock-designs.js prints those numbers). That is
 * the right thing to measure here: this file asks whether the type can exist
 * at all, so it wants the floor, not a typical build.
 */
function straightRunTiles(type, reach) {
  if (!Number.isFinite(reach.count)) return Infinity;
  const subL = (id) => (id && COMPONENTS[id]?.subL) || SUB_PER_TILE;
  const endpoint = asArray(type.requiredEndpoint)[0] || null;
  const total = subL(reach.extractionId)
    + reach.count * subL(reach.gainId)
    + subL(endpoint);
  return Math.ceil(total / SUB_PER_TILE);
}

// --- Can this machine's beam be folded? ------------------------------------
//
// A machine that can turn a corner is not length-constrained the way a
// straight one is: it fits in a square site of roughly the square root of its
// run. So the straight-run assertion below only applies to the types that
// genuinely cannot bend, and this is how that is decided.
//
// NOT by looking for a bending element in the palette, which was the obvious
// rule and is a rule that asserts nothing: EVERY type in the game can see
// `dipole`, so palette-based exemption exempts the whole roster including the
// two machines this check exists for. (And `chicane`, the other candidate, is
// not a folding element at all — its exit port is on 'front'. It walks the
// beam sideways and puts it back, which is why xfel-flagship measures 117
// tiles long and 2 wide with two chicanes in it.)
//
// Instead, the physics the type comments in beamline-types.js already appeal
// to, which is two questions rather than one. A 90° bend that fits on the site
// has to be BUILDABLE, and it has to not destroy the beam:
//
//   RIGIDITY. Bρ = p / 0.29979 T·m. The strongest dipole ever built is Nb3Sn
//   at ~16 T (HL-LHC / FCC-hh class), and the bend has to fit inside the site,
//   so ρ ≤ MAX_MAP_HALF_EXTENT tiles ≈ 240 m. That caps a buildable bend at
//   about 1.15 TeV/c of momentum. This is what rules out `blackHoleFactory`:
//   500 TeV/beam would want a dipole of several thousand tesla.
//
//   RADIATION. U0 = 88.5 keV × (E/GeV)^4 / (ρ/m) per turn for electrons,
//   scaled by (m_e/m)^4 for anything heavier; a quarter of that is one 90°
//   bend. If that is an appreciable fraction of the beam energy, the dipole
//   that folds the machine throws away everything the linac just bought. This
//   is what rules out `collider` — a quarter turn at 500 GeV/beam costs about
//   5.8 TeV, eleven times the energy of the beam being bent.
//
// Both are evaluated at the BAND TOP, because that is the machine at full
// stretch and the length assertion is about the longest version of the type.
// Everything else in the roster clears both by orders of magnitude.
//
// This is a SITING question, not a beam-model question: nothing here feeds the
// physics engine, and it exists only to decide which of two assertions a type
// is held to. The printed table shows the classification and the numbers
// behind it, so a wrong answer here is visible rather than silent.
const M_E_GEV = 0.000510999;
const M_P_GEV = 0.938272;
const MAX_DIPOLE_FIELD_T = 16;
const MAX_BEND_RADIUS_M = MAX_MAP_HALF_EXTENT * METRES_PER_TILE;
const U0_KEV_PER_TURN = 88.5;
// A bend is "affordable" if it costs under 1% of the beam energy. The roster
// straddles this by ~20x either side, so the exact threshold is not load
// bearing.
const MAX_BEND_LOSS_FRACTION = 0.01;

function foldability(type) {
  const bandHi = type.spec.energyGeV[1];
  // 'e-', 'e+e-' are electrons; 'p+', 'p+p-' are protons.
  const mass = /e[+-]/.test(type.particle || '') ? M_E_GEV : M_P_GEV;
  // p ≈ E for every beam in this roster (the softest is 5 MeV of electron,
  // γ ≈ 10), so the band top doubles as the momentum in GeV/c.
  const fieldT = bandHi / (0.299792458 * MAX_BEND_RADIUS_M);
  const bendLossGeV = 0.25 * (U0_KEV_PER_TURN * 1e-6) * (bandHi ** 4)
    / MAX_BEND_RADIUS_M * ((M_E_GEV / mass) ** 4);

  if (fieldT > MAX_DIPOLE_FIELD_T) {
    return {
      canFold: false,
      why: `rigidity — a 90° bend on this site needs ${Math.round(fieldT).toLocaleString()} T`,
    };
  }
  if (bendLossGeV > MAX_BEND_LOSS_FRACTION * bandHi) {
    return {
      canFold: false,
      why: `radiation — a 90° bend costs ${bendLossGeV.toPrecision(3)} GeV of a ${bandHi} GeV beam`,
    };
  }
  return {
    canFold: true,
    why: `${fieldT.toPrecision(2)} T bend, ${bendLossGeV.toPrecision(2)} GeV radiated`,
  };
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
// 2. Reach with the complete researched catalogue.
// ---------------------------------------------------------------------------
console.log('\n--- Reach ---');
console.log(`  ${pad('type', 20)} ${pad('band GeV', 14)} full research`);

for (const [typeId, type] of Object.entries(BEAMLINE_TYPES)) {
  const palette = paletteFor(typeId);
  const [bandLo, bandHi] = type.spec.energyGeV;

  const full = placementsToReach(palette, bandHi);

  console.log(`  ${pad(typeId, 20)} ${pad(`${bandLo}-${bandHi}`, 14)} `
    + `${fmt(full.count)} x ${full.gainId ?? 'nothing'}`);

  assert(full.count <= MAX_AT_FULL_RESEARCH,
    `${typeId} reaches its band top (${bandHi} GeV) in ${fmt(full.count)} placements `
    + `<= ${MAX_AT_FULL_RESEARCH}, best ${full.gainId ?? 'nothing'} @ ${full.bestGain} GeV `
    + `from ${full.extractionId ?? 'rest'} @ ${full.bestExtraction} GeV`);

}

// ---------------------------------------------------------------------------
// 4. The land each type needs.
//
// The count above says how many times the player drags hardware out of the
// palette. This says how much ground that hardware stands on, which is the
// question `collider` passed while being unbuildable: 34 placements, and 174
// tiles of beamline that must not bend, against a starting site 61 tiles
// across.
//
// The map is now a purchasable resource (src/data/land.js), so the criterion
// is not "fits the starting site" — outgrowing the site is the point — but
// "fits SOME map the player can buy". A type needing more than the last parcel
// is a type nobody can ever site, and no amount of research or money fixes it.
//
// The minimum half-extent is printed for every type, folding or not, so the
// table doubles as the documentation of what land each machine wants. Those
// numbers are what the picker has to surface on a blueprint card; printing
// them here means they cannot drift silently.
// ---------------------------------------------------------------------------
console.log('\n--- Land ---');
console.log(`  ${pad('type', 20)} ${pad('run (tiles)', 12)} ${pad('min halfExtent', 16)} bends?`);

for (const [typeId, type] of Object.entries(BEAMLINE_TYPES)) {
  const palette = paletteFor(typeId);
  const bandHi = type.spec.energyGeV[1];
  const reach = placementsToReach(palette, bandHi);
  const run = straightRunTiles(type, reach);
  const fold = foldability(type);

  const minHalfExtent = Number.isFinite(run)
    ? halfExtentForStraightRun(run, DEFAULT_MAP_HALF_EXTENT) : null;
  const parcel = LAND_PARCELS.find(p => p.halfExtent === minHalfExtent);
  const land = minHalfExtent === null ? 'NONE'
    : minHalfExtent === DEFAULT_MAP_HALF_EXTENT ? `${minHalfExtent} (start)`
      : `${minHalfExtent} (${parcel.id})`;

  console.log(`  ${pad(typeId, 20)} ${pad(fmt(run), 12)} ${pad(land, 16)} `
    + `${fold.canFold ? 'folds' : 'STRAIGHT'} — ${fold.why}`);

  if (!fold.canFold) {
    // The real assertion. A machine that cannot turn a corner has to lie in one
    // line, and that line has to fit between two edges of a map the player can
    // actually own.
    assert(minHalfExtent !== null,
      `${typeId} is ${fmt(run)} tiles of unbendable beamline and fits within the largest `
      + `purchasable map (${MAX_MAP_HALF_EXTENT * 2 + 1} tiles) — needs mapHalfExtent `
      + `${minHalfExtent ?? '> ' + MAX_MAP_HALF_EXTENT}`);
  } else {
    // A folding machine is not off the hook, it is held to a looser bound: its
    // run has to fit inside the site when serpentined. Two tiles of pitch per
    // pass is the tightest fold worth pretending to, so half the site's area is
    // the budget. Every folding type in the roster clears this by two orders of
    // magnitude, which is exactly why it is stated rather than left implicit —
    // "it folds" is not the same as "it fits".
    const foldedBudget = ((MAX_MAP_HALF_EXTENT * 2 + 1) ** 2) / 2;
    assert(run <= foldedBudget,
      `${typeId} is ${fmt(run)} tiles and can fold, so it fits the largest map `
      + `serpentined (budget ${foldedBudget} tiles)`);
  }
}

// ---------------------------------------------------------------------------
// 5. No orphans. A component every type hides is content nobody will ever see,
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
// 6. Denylist hygiene. `excludes` is the type saying "this general-purpose
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
