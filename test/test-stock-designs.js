// test/test-stock-designs.js — the shipped blueprint roster, and the one hop
// that makes placing one mean anything.
//
// STOCK_DESIGNS is content: it grows whenever somebody authors a machine, and
// nothing in this file may name a blueprint or count them, or it becomes a
// speed bump on the exact activity it exists to protect. Every assertion below
// is quantified over the roster as it stands at run time.
//
// What is checked, and why each one is a real failure mode rather than a
// tautology:
//
//   1. IDS ARE KEYS. `id` is the join to stock-designs.measured.json and the
//      handle the picker returns; a duplicate silently gives two machines one
//      set of measured numbers.
//   2. THE TYPE EXISTS AND THE PARTS EXIST. A typo in `typeId` produces a
//      blueprint that appears in no picker at all (stockDesignsFor filters by
//      it), and an unknown component type is dropped silently by layoutDesign —
//      the player is charged for a machine with a hole in it.
//   3. NOTHING IS FORBIDDEN TO ITS OWN TYPE. beamlineTypeHidesComponent is the
//      palette filter. A blueprint containing hardware that filter hides is a
//      machine the game tells you, in the same window, that you may not build —
//      and one the player could never repair after demolishing a part of it.
//   4. IT ENDS SOMEWHERE. Every type declares `requiredEndpoint`; the beam has
//      to stop in one of them. This mirrors scripts/eval-design.mjs's check
//      deliberately, so a blueprint cannot pass the shipping validator and fail
//      here or the reverse.
//   5. TIERS ARE DISTINCT WITHIN A TYPE. Tier is the ladder the picker sorts
//      on; two tier-2 machines under one type make that ladder meaningless.
//   6. IT STARTS WITH A SOURCE — which is what makes item 7 possible at all.
//   7. TYPE STAMPING SURVIVES PLACEMENT. This is the sharp one, and the reason
//      the whole file exists. Registry entries are lazy: placing a source is
//      what mints one, and Game._ensureBeamlineForSourcePlaceable stamps it
//      from `pendingBeamlineTypeId` AT THAT INSTANT. So the pick has to be
//      armed before DesignPlacer.confirm() reaches its first placeJunction. Arm
//      it after, or not at all, and the player gets a beamline that looks typed
//      in the picker they just used and is untyped in the model, the palette
//      filter and the save. Nothing in the UI would show that.
//
// Beam physics is deliberately NOT asserted here. What a placed blueprint's
// beam does is measured by scripts/eval-design.mjs against the type's spec
// band; this file is about identity and wiring, and asserting element counts
// would pin the layout walk, which test-design-layout.js owns.

import { readFileSync } from 'node:fs';

import { STOCK_DESIGNS, stockDesignsFor, getStockDesign } from '../src/data/stock-designs.js';
import { BEAMLINE_TYPES, getBeamlineType } from '../src/data/beamline-types.js';
import { COMPONENTS } from '../src/data/components.js';
import {
  beamlineTypeHidesComponent, stockDesignCost, formatMeasuredPerformance,
  measuredFor, formatEnergyValue, formatCurrentValue,
} from '../src/ui/BeamlineTypePicker.js';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { DesignPlacer } from '../src/ui/DesignPlacer.js';

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

const flush = () => new Promise((res) => queueMicrotask(res));

// ==========================================================================
// 0. The roster is a roster.
// ==========================================================================
console.log('\n=== Roster shape ===\n');
{
  assert(Array.isArray(STOCK_DESIGNS) && STOCK_DESIGNS.length > 0,
    `STOCK_DESIGNS has entries (${STOCK_DESIGNS.length})`);

  const ids = STOCK_DESIGNS.map(d => d.id);
  assert(new Set(ids).size === ids.length,
    `every blueprint id is unique (${ids.length} ids)`);
  assert(ids.every(id => typeof id === 'string' && id.length > 0),
    'every blueprint has a non-empty string id');

  for (const d of STOCK_DESIGNS) {
    assert(getStockDesign(d.id) === d, `getStockDesign("${d.id}") returns it`);
  }
  assert(getStockDesign('no-such-blueprint') === null,
    'getStockDesign returns null for an unknown id rather than undefined');
}

// ==========================================================================
// 1. Every blueprint, against the type it claims and the catalogue it is
//    built from.
// ==========================================================================
console.log('\n=== Each blueprint against its type ===\n');

for (const d of STOCK_DESIGNS) {
  const type = getBeamlineType(d.typeId);
  assert(!!type, `${d.id}: typeId "${d.typeId}" is a real BEAMLINE_TYPES entry`);
  if (!type) continue;

  const comps = d.components || [];
  assert(comps.length > 0, `${d.id}: has components`);

  const unknown = comps.filter(c => !COMPONENTS[c.type]).map(c => c.type);
  assert(unknown.length === 0,
    `${d.id}: every component type exists in COMPONENTS${unknown.length ? ` (missing: ${unknown.join(', ')})` : ''}`);

  const hidden = comps
    .filter(c => COMPONENTS[c.type]
      && beamlineTypeHidesComponent(d.typeId, c.type, COMPONENTS[c.type]))
    .map(c => c.type);
  assert(hidden.length === 0,
    `${d.id}: no component is hidden from ${d.typeId}'s own palette${hidden.length ? ` (hidden: ${[...new Set(hidden)].join(', ')})` : ''}`);

  // The first component has to be the source: it is what mints the registry
  // entry that carries the type (see section 3), and a blueprint that expects
  // the player to bring their own would place a headless line.
  assert(COMPONENTS[comps[0]?.type]?.isSource === true,
    `${d.id}: starts with a source (${comps[0]?.type})`);

  // Mirrors scripts/eval-design.mjs checkBands(): the last endpoint-category
  // component is the one the beam stops in.
  const endpoints = type.requiredEndpoint || [];
  const lastEndpoint = [...comps].reverse()
    .find(c => COMPONENTS[c.type]?.category === 'endpoint');
  assert(!!lastEndpoint, `${d.id}: terminates in an endpoint component`);
  assert(!endpoints.length || (lastEndpoint && endpoints.includes(lastEndpoint.type)),
    `${d.id}: ends in one of ${d.typeId}'s requiredEndpoint (${endpoints.join('/')}) — got ${lastEndpoint?.type}`);

  assert(Number.isInteger(d.tier) && d.tier >= 1,
    `${d.id}: tier is a positive integer (${d.tier})`);
  assert(typeof d.name === 'string' && d.name.length > 0, `${d.id}: has a name`);
  assert(typeof d.blurb === 'string' && d.blurb.length > 0, `${d.id}: has a blurb`);

  // Every part has to price, or the card advertises a machine cheaper than the
  // one the placer will charge for.
  const cost = stockDesignCost(d);
  assert(Number.isFinite(cost) && cost > 0, `${d.id}: costs something ($${cost})`);
}

// ==========================================================================
// 2. Per-type grouping: tiers, ordering, and the picker's view of a type.
// ==========================================================================
console.log('\n=== Tiers within each type ===\n');
{
  const byType = new Map();
  for (const d of STOCK_DESIGNS) {
    if (!byType.has(d.typeId)) byType.set(d.typeId, []);
    byType.get(d.typeId).push(d);
  }

  for (const [typeId, designs] of byType) {
    const tiers = designs.map(d => d.tier);
    assert(new Set(tiers).size === tiers.length,
      `${typeId}: tiers are distinct within the type (${tiers.join(', ')})`);

    const listed = stockDesignsFor(typeId);
    assert(listed.length === designs.length,
      `${typeId}: stockDesignsFor returns all ${designs.length} of its blueprints`);
    assert(listed.every(d => d.typeId === typeId),
      `${typeId}: stockDesignsFor returns nothing belonging to another type`);
    assert(listed.every((d, i) => i === 0 || listed[i - 1].tier <= d.tier),
      `${typeId}: stockDesignsFor is in tier order`);
  }

  // A type nobody has authored for yet is not an error — the picker falls back
  // to Custom — but it must answer with an empty list, not undefined.
  for (const typeId of Object.keys(BEAMLINE_TYPES)) {
    assert(Array.isArray(stockDesignsFor(typeId)),
      `stockDesignsFor("${typeId}") always returns an array`);
  }
}

// ==========================================================================
// 3. Measured performance: never invented, and honoured when present.
//
// stock-designs.measured.json is GENERATED (node scripts/eval-design.mjs
// --write) and is allowed not to exist — a fresh clone has never run the
// harness. So the presence of the file is what is conditional here; the rule
// that a card may only ever state a measured number is not.
// ==========================================================================
console.log('\n=== Measured performance ===\n');
{
  assert(measuredFor('no-such-blueprint') === null,
    'an unmeasured id has no measured record');
  assert(formatMeasuredPerformance('no-such-blueprint') === null,
    'and therefore no performance line — the picker renders nothing rather than a guess');
  assert(formatMeasuredPerformance(undefined) === null,
    'a missing id is handled the same way');

  // The value formatters must speak the same units the picker's spec bands do,
  // or a card reads "0.0246 GeV" under a band that reads "5–50 MeV".
  assert(formatEnergyValue(0.0246) === '24.6 MeV', 'sub-GeV energies read in MeV');
  assert(formatEnergyValue(17.5) === '17.5 GeV', 'GeV energies stay in GeV');
  assert(formatEnergyValue(null) === null, 'a missing energy renders nothing at all');
  assert(formatCurrentValue(2.5) === '2.5 mA', 'mA currents read in mA');
  assert(formatCurrentValue(0.005) === '5 µA', 'sub-0.1 mA currents drop to µA');
  assert(formatCurrentValue(undefined) === null, 'a missing current renders nothing');

  let measured = null;
  try {
    measured = JSON.parse(readFileSync(
      new URL('../src/data/stock-designs.measured.json', import.meta.url), 'utf8'));
  } catch { /* never generated here — see the block comment above */ }

  if (!measured) {
    console.log('  SKIP: stock-designs.measured.json absent '
      + '(run `node scripts/eval-design.mjs --write` to generate it)');
  } else {
    const ids = new Set(STOCK_DESIGNS.map(d => d.id));
    const orphans = Object.keys(measured).filter(k => !ids.has(k));
    assert(orphans.length === 0,
      `every measured entry names a live blueprint${orphans.length ? ` (stale: ${orphans.join(', ')})` : ''}`);
    for (const [id, m] of Object.entries(measured)) {
      assert(typeof m.beamEnergy === 'number' && typeof m.beamCurrent === 'number',
        `${id}: measured record carries numeric energy and current`);
    }
  }
}

// ==========================================================================
// 4. Type stamping: the pick has to reach the registry through the placer.
// ==========================================================================
console.log('\n=== A placed blueprint carries its type ===\n');

function makeGame(seed) {
  const g = new Game(new BeamlineRegistry(), { seed });
  g.state.resources.funding = 1e12;
  return g;
}

/**
 * Place `design` on an empty patch of the map. Scans for a spot the preview
 * accepts rather than assuming one: blueprints are long, and the generated map
 * has decorations on it.
 */
function placeSomewhere(g, design) {
  const dp = new DesignPlacer(g, { _renderCursors() {} });
  dp.start(design);
  for (let col = -24; col <= 8; col += 4) {
    for (let row = -30; row <= 30; row += 2) {
      dp.setPosition(col, row);
      if (dp.valid) return { dp, ok: dp.confirm() };
    }
  }
  return { dp, ok: false };
}

for (const design of STOCK_DESIGNS) {
  const type = getBeamlineType(design.typeId);
  if (!type) continue;

  const g = makeGame(77);
  // Exactly what the picker's caller does (hud.js → main.js), in the same
  // order: arm first, then hand the design to the placer.
  g.startNewBeamline(design.typeId);
  assert(g.pendingBeamlineTypeId === design.typeId,
    `${design.id}: the pick is armed before the ghost starts`);

  const { ok } = placeSomewhere(g, design);
  await flush();
  assert(ok === true, `${design.id}: places on an empty map`);
  if (!ok) continue;

  const entries = g.registry.getAll();
  assert(entries.length === 1,
    `${design.id}: places exactly one beamline (got ${entries.length})`);
  const entry = entries[0];
  assert(entry?.typeId === design.typeId,
    `${design.id}: the registry entry carries typeId "${design.typeId}" (got ${entry?.typeId})`);
  assert(entry?.beamState?.machineType === type.machineType,
    `${design.id}: beamState.machineType is "${type.machineType}" (got ${entry?.beamState?.machineType})`);
  assert(g.pendingBeamlineTypeId === null,
    `${design.id}: the pick is consumed exactly once`);
  assert(g.getActiveBeamlineTypeId() === design.typeId,
    `${design.id}: the palette follows the beamline that was just built`);

  // And it survives the save, which is where an in-memory-only stamp would
  // still look right in the UI and be gone on reload.
  const json = JSON.parse(JSON.stringify(g.registry.toJSON()));
  assert(json.entries[0]?.typeId === design.typeId,
    `${design.id}: typeId is serialised`);
}

{
  // The negative control. Without an armed pick the same placement produces an
  // untyped beamline — which is what proves the assertions above are testing
  // the arming and not something that would pass regardless.
  const design = STOCK_DESIGNS[0];
  const g = makeGame(77);
  const { ok } = placeSomewhere(g, design);
  await flush();
  assert(ok === true, 'control: the same blueprint places with no pick armed');
  const entry = g.registry.getAll()[0];
  assert(entry?.typeId === null || entry?.typeId === undefined,
    `control: an unarmed placement is untyped (got ${entry?.typeId})`);
  assert(entry?.beamState?.machineType === 'linac',
    'control: and falls back to the plain linac transport stack');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
