// test/test-beamline-types.js — the beamline-type table has to stay honest.
//
// BEAMLINE_TYPES is a hub: it names research nodes, component ids and physics
// machine types, and none of those namespaces live in this file. Every one of
// those references is a hand-written string, which is the exact bug class
// test-registry-integrity.js exists for — a string that used to be right
// silently widens a palette or greys out a type forever, and nothing throws.
//
// Two failure modes are worth calling out because they are silent rather than
// loud:
//
//   * A `requires` naming a node that no longer exists makes the type
//     permanently unbuildable — beamlineTypesFor() just never returns it.
//   * A component both allowlisted to a type and named in that type's
//     `excludes` is a contradiction. Whichever rule the palette filter checks
//     first wins, so the design intent is decided by code ordering rather than
//     by data. Neither direction is "more correct"; the table simply must not
//     say both.
//
// The physics-machine-type check parses beam_physics/machines.py rather than
// importing it, so the JS suite stays runnable with no Python process, exactly
// as test-cavity-specs.js does for the cavity tables.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BEAMLINE_TYPES, getBeamlineType, beamlineTypesFor,
  beamlineTypeUnlocked, missingResearchFor,
} from '../src/data/beamline-types.js';
import { COMPONENTS } from '../src/data/components.js';
import { RESEARCH } from '../src/data/research.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const TYPES = Object.values(BEAMLINE_TYPES);
const asArray = v => (v == null ? [] : (Array.isArray(v) ? v : [v]));

// ---------------------------------------------------------------------------
// Physics machine types. Parsed out of machines.py so a renamed config fails
// here rather than degrading silently: get_machine_config() falls back to
// 'linac' for an unknown type, which is the right runtime behaviour and the
// wrong thing to ship — the beamline would quietly lose its specialised
// modules and its success metric.
// ---------------------------------------------------------------------------
console.log('\n--- every machineType resolves in beam_physics/machines.py ---');
{
  const py = readFileSync(join(ROOT, 'beam_physics/machines.py'), 'utf8');
  const block = py.match(/^_MACHINE_CONFIGS = \{([\s\S]*?)^\}/m);
  assert(!!block, 'found _MACHINE_CONFIGS block in beam_physics/machines.py');

  const known = new Set(
    [...(block ? block[1] : '').matchAll(/^\s{4}"(\w+)":\s*\{/gm)].map(m => m[1]),
  );
  assert(known.size >= 4, `parsed ${known.size} machine configs`);

  for (const t of TYPES) {
    assert(known.has(t.machineType),
      `${t.id}.machineType '${t.machineType}' is a real machine config`);
  }
}

// ---------------------------------------------------------------------------
// Research gates.
// ---------------------------------------------------------------------------
console.log('\n--- every research gate resolves in RESEARCH ---');
for (const t of TYPES) {
  const dead = asArray(t.requires).filter(id => !RESEARCH[id]);
  assert(dead.length === 0,
    `${t.id}.requires: ${dead.length === 0 ? 'all gates resolve' : `dead node(s) ${dead.join(', ')}`}`);
}

// The roster's design claim, and worth pinning: adding nine types required
// adding zero research nodes. If a future type needs a new node, that is a
// decision to make deliberately rather than discover.
console.log('\n--- the roster is gated entirely on pre-existing research ---');
{
  const ungated = TYPES.filter(t => !t.requires).map(t => t.id);
  assert(ungated.length === 2 && ungated.every(id => BEAMLINE_TYPES[id].tier === 1),
    `exactly the two tier-1 types are ungated (${ungated.join(', ')})`);
}

// ---------------------------------------------------------------------------
// Component references, in both directions.
// ---------------------------------------------------------------------------
console.log('\n--- every component id named by a type is real ---');
for (const t of TYPES) {
  for (const [field, ids] of [['excludes', t.excludes], ['requiredEndpoint', t.requiredEndpoint]]) {
    const dead = (ids || []).filter(id => !COMPONENTS[id]);
    assert(dead.length === 0,
      `${t.id}.${field}: ${dead.length === 0 ? `all ${(ids || []).length} ids resolve` : `dead component(s) ${dead.join(', ')}`}`);
  }
}

console.log('\n--- every component allowlist names real types ---');
{
  let annotated = 0;
  for (const [id, comp] of Object.entries(COMPONENTS)) {
    if (!comp.beamlineTypes) continue;
    annotated++;
    assert(Array.isArray(comp.beamlineTypes) && comp.beamlineTypes.length > 0,
      `${id}.beamlineTypes is a non-empty array`);
    const dead = (comp.beamlineTypes || []).filter(t => !BEAMLINE_TYPES[t]);
    assert(dead.length === 0,
      `${id}.beamlineTypes: ${dead.length === 0 ? 'all types resolve' : `dead type(s) ${dead.join(', ')}`}`);
  }
  assert(annotated > 0, `${annotated} components carry an allowlist`);
}

console.log('\n--- allowlists only ever narrow beamline mode ---');
{
  // The filter runs in MODES.beamline only. An allowlist on an infra or
  // facility component would read as intentional and do nothing.
  const misplaced = Object.values(COMPONENTS)
    .filter(c => c.beamlineTypes && c.kind && c.kind !== 'beamline')
    .map(c => c.id);
  assert(misplaced.length === 0,
    `no non-beamline component carries an allowlist${misplaced.length ? `: ${misplaced.join(', ')}` : ''}`);
}

console.log('\n--- no component is both excluded by a type and allowlisted to it ---');
for (const t of TYPES) {
  const contradictions = (t.excludes || []).filter(id => {
    const allow = COMPONENTS[id]?.beamlineTypes;
    return Array.isArray(allow) && allow.includes(t.id);
  });
  assert(contradictions.length === 0,
    `${t.id}: ${contradictions.length === 0 ? 'excludes and allowlists agree' : `contradictory ${contradictions.join(', ')}`}`);
}

// A required endpoint the palette filter hides is a type that can never be
// finished — the harshest possible version of the stale-id bug, and one no
// other check would catch.
console.log('\n--- every required endpoint is actually buildable on its type ---');
for (const t of TYPES) {
  const ends = t.requiredEndpoint || [];
  assert(ends.length > 0, `${t.id} declares at least one terminating endpoint`);
  const hidden = ends.filter(id => {
    const comp = COMPONENTS[id];
    if (!comp) return true;
    if ((t.excludes || []).includes(id)) return true;
    return Array.isArray(comp.beamlineTypes) && !comp.beamlineTypes.includes(t.id);
  });
  assert(hidden.length === 0,
    `${t.id}: ${hidden.length === 0 ? 'endpoints survive its own filter' : `filtered out ${hidden.join(', ')}`}`);
}

// Same argument one step upstream: a type with no source cannot be started.
console.log('\n--- every type has at least one buildable source ---');
for (const t of TYPES) {
  const sources = Object.values(COMPONENTS).filter(c => {
    if (!c.isSource) return false;
    if ((t.excludes || []).includes(c.id)) return false;
    return !Array.isArray(c.beamlineTypes) || c.beamlineTypes.includes(t.id);
  });
  assert(sources.length > 0,
    `${t.id} keeps ${sources.length} source(s): ${sources.map(s => s.id).join(', ') || 'NONE'}`);
}

// ---------------------------------------------------------------------------
// Spec bands. A band is what the whole design rests on — an inverted or empty
// one makes bandGate() score the type's own design point as out of spec.
// ---------------------------------------------------------------------------
console.log('\n--- every spec band is non-empty and ordered ---');
for (const t of TYPES) {
  const bands = Object.entries(t.spec).filter(([, v]) => Array.isArray(v));
  assert(bands.length > 0, `${t.id}.spec declares at least one band`);
  for (const [key, [lo, hi]] of bands) {
    const bothNull = lo == null && hi == null;
    const ordered = lo == null || hi == null || lo < hi;
    assert(!bothNull && ordered,
      `${t.id}.spec.${key} = [${lo}, ${hi}] is a usable band`);
  }
  const [lo, hi] = t.spec.energyGeV || [];
  assert(lo > 0 && hi > lo, `${t.id} has a positive energy band [${lo}, ${hi}] GeV`);
}

console.log('\n--- scoring parameters are present and sane ---');
for (const t of TYPES) {
  assert(typeof t.fom === 'string' && t.fom.length > 0, `${t.id}.fom is named`);
  assert(Number.isFinite(t.fomRef) && t.fomRef > 0, `${t.id}.fomRef = ${t.fomRef} is positive and finite`);
  assert(Number.isFinite(t.bandWidth) && t.bandWidth > 0,
    `${t.id}.bandWidth = ${t.bandWidth} is a positive falloff`);
  assert(t.dutyFactor > 0 && t.dutyFactor <= 1,
    `${t.id}.dutyFactor = ${t.dutyFactor} is a fraction`);
  assert(Number.isInteger(t.tier) && t.tier >= 1 && t.tier <= 5, `${t.id}.tier = ${t.tier}`);
}

console.log('\n--- ids, keys and display fields line up ---');
for (const [key, t] of Object.entries(BEAMLINE_TYPES)) {
  assert(key === t.id, `${key} keys its own id`);
  assert(typeof t.name === 'string' && t.name.length > 0, `${key} has a name`);
  assert(typeof t.blurb === 'string' && t.blurb.length > 0, `${key} has a picker blurb`);
  assert(Number.isInteger(t.accentColor), `${key} has an accent colour`);
  assert(typeof t.particle === 'string' && t.particle.length > 0, `${key} declares a species`);
}

// The money/data/prestige triangle only works if every tier holds something.
console.log('\n--- the roster spans tier 1 through 5 ---');
{
  const tiers = new Set(TYPES.map(t => t.tier));
  assert([1, 2, 3, 4, 5].every(n => tiers.has(n)), `tiers present: ${[...tiers].sort().join(', ')}`);
  assert(TYPES.length === 9, `nine types (got ${TYPES.length})`);
}

// ---------------------------------------------------------------------------
// Lookup helpers.
// ---------------------------------------------------------------------------
console.log('\n--- lookup and unlock helpers ---');
{
  assert(getBeamlineType('testStand') === BEAMLINE_TYPES.testStand, 'getBeamlineType returns the entry');
  assert(getBeamlineType('nope') === null, 'getBeamlineType is null for an unknown id');

  const opening = beamlineTypesFor([]);
  assert(opening.length === 2 && opening.every(t => t.tier === 1),
    `an empty research state opens exactly the two tier-1 types (${opening.map(t => t.id).join(', ')})`);

  const all = beamlineTypesFor(Object.keys(RESEARCH));
  assert(all.length === TYPES.length, 'a complete tech tree opens every type');

  // Every shape a caller might reasonably hand it.
  const gates = ['isochronousCyclotron', 'machineProtection'];
  assert(beamlineTypeUnlocked('therapy', gates), 'accepts an array of node ids');
  assert(beamlineTypeUnlocked('therapy', new Set(gates)), 'accepts a Set');
  assert(beamlineTypeUnlocked('therapy', { completedResearch: gates }), 'accepts a game state');
  assert(!beamlineTypeUnlocked('therapy', ['isochronousCyclotron']),
    'a multi-node gate needs every node');
  assert(!beamlineTypeUnlocked('nope', gates), 'an unknown id is never unlocked');
  assert(beamlineTypeUnlocked('testStand', undefined), 'an ungated type needs no state at all');

  assert(JSON.stringify(missingResearchFor('therapy', ['machineProtection']))
    === JSON.stringify(['isochronousCyclotron']),
    'missingResearchFor names only what is still missing');
  assert(missingResearchFor('testStand', []).length === 0, 'an ungated type is missing nothing');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
