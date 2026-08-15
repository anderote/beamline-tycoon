// test/test-beamline-types.js — the beamline-type table has to stay honest.
//
// BEAMLINE_TYPES is a hub: it names component ids and physics machine types,
// and neither namespace lives in this file. Every one of
// those references is a hand-written string, which is the exact bug class
// test-registry-integrity.js exists for — a string that used to be right
// silently widens a palette or greys out a type forever, and nothing throws.
//
// Two failure modes are worth calling out because they are silent rather than
// loud:
//
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
} from '../src/data/beamline-types.js';
import { COMPONENTS } from '../src/data/components.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const TYPES = Object.values(BEAMLINE_TYPES);

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

// Mission choice is not progression. Research belongs on buildable hardware
// and upgrades, never on the purpose/target-band table itself.
console.log('\n--- every mission family is available independently of research ---');
{
  assert(TYPES.every(t => !Object.hasOwn(t, 'requires')),
    'no beamline type declares a research gate');
  assert(beamlineTypesFor().length === TYPES.length,
    'the complete mission roster is available from the start');
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

console.log('\n--- purpose-specific endpoints give every non-collider line its own finish ---');
{
  const PURPOSE_ENDPOINTS = {
    testStand: 'materialsTestStation',
    ebeamProcessing: 'eBeamIrradiationVault',
    isotopeIrradiation: 'isotopeProductionTarget',
    therapy: 'protonTherapyGantry',
    spallation: 'spallationNeutronTarget',
    lightSource: 'photonScienceHutch',
    xfel: 'xfelEndstation',
    euvFel: 'euvCollector',
  };
  for (const [typeId, endpointId] of Object.entries(PURPOSE_ENDPOINTS)) {
    const type = BEAMLINE_TYPES[typeId];
    const endpoint = COMPONENTS[endpointId];
    assert(endpoint?.isEndpoint && endpoint.category === 'endpoint',
      `${endpointId} is a terminating endpoint`);
    assert(endpoint?.beamlineTypes?.length === 1 && endpoint.beamlineTypes[0] === typeId,
      `${endpointId} belongs only to ${typeId}`);
    assert(type?.requiredEndpoint?.includes(endpointId),
      `${typeId} accepts its purpose-specific endpoint`);
  }
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
  assert(Number.isInteger(t.tier) && t.tier >= 1 && t.tier <= 6, `${t.id}.tier = ${t.tier}`);
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
// Tier 6 is the deliberate exception — one machine, no money — so it is
// asserted as a singleton rather than folded into the triangle.
console.log('\n--- the roster spans tier 1 through 6 ---');
{
  const tiers = new Set(TYPES.map(t => t.tier));
  assert([1, 2, 3, 4, 5, 6].every(n => tiers.has(n)), `tiers present: ${[...tiers].sort().join(', ')}`);
  assert(TYPES.length === 10, `ten types (got ${TYPES.length})`);
  const top = TYPES.filter(t => t.tier === 6);
  assert(top.length === 1 && top[0].id === 'blackHoleFactory',
    `tier 6 holds exactly the Black Hole Factory (${top.map(t => t.id).join(', ')})`);
}

// ---------------------------------------------------------------------------
// Lookup and availability helpers.
// ---------------------------------------------------------------------------
console.log('\n--- lookup and availability helpers ---');
{
  assert(getBeamlineType('testStand') === BEAMLINE_TYPES.testStand, 'getBeamlineType returns the entry');
  assert(getBeamlineType('nope') === null, 'getBeamlineType is null for an unknown id');

  const opening = beamlineTypesFor();
  assert(opening.length === TYPES.length,
    `the opening roster contains all ${TYPES.length} mission families`);
  assert(getBeamlineType('blackHoleFactory') === BEAMLINE_TYPES.blackHoleFactory,
    'getBeamlineType finds the tier-6 mission without research context');
}

// ---------------------------------------------------------------------------
// Research still has real work to do: it unlocks placeable hardware and
// performance upgrades. Removing purpose gates must not flatten the catalogue.
// ---------------------------------------------------------------------------
console.log('\n--- research remains on buildable hardware, not mission families ---');
{
  assert(COMPONENTS.radiationEffectsStation.requires === 'protonAcceleration',
    'electronics irradiation hardware requires proton acceleration');
  assert(COMPONENTS.protonTherapyGantry.requires === 'machineProtection',
    'the therapy gantry remains gated as buildable clinical hardware');
  assert(COMPONENTS.xfelEndstation.requires === 'felTech',
    'the XFEL endstation remains gated as buildable FEL hardware');
  assert(COMPONENTS.blackHoleChamber.requires === 'particleDiscovery',
    'the black-hole chamber remains gated as buildable detector hardware');
  assert(BEAMLINE_TYPES.isotopeIrradiation.requiredEndpoint[0] === 'radiationEffectsStation',
    'the guided endpoint order leads with the early paid test station');
  assert(COMPONENTS.isotopeProductionTarget.requires === 'targetPhysics',
    'isotope production remains a later Target Physics upgrade');

  const eb = BEAMLINE_TYPES.ebeamProcessing.excludes;
  assert(eb.includes('velocitySelector'), 'ebeamProcessing excludes velocitySelector');
  assert(eb.includes('emittanceFilter'), 'ebeamProcessing excludes emittanceFilter');

  assert(BEAMLINE_TYPES.collider.spec.energyGeV[1] === 500, 'collider band tops at 500 GeV/beam');
}

// ---------------------------------------------------------------------------
// The RF ladder. A component that exists but is allowlisted to nothing is
// invisible in every palette — the same silent failure as a misspelled
// subsection, and the reason each of these carries a beamlineTypes array.
// plasmaAfterburner gets its own pair of assertions because the absence of RF
// is its identity: it has no cavity to drive and no frequency to match, so a
// well-meaning "all accelerating structures need a waveguide" edit would make
// it wrong rather than merely different.
// ---------------------------------------------------------------------------
console.log('\n--- New RF ladder present and allowlisted ---');
{
  const LADDER = ['cbandStructure','xbandStructure','srf650Cryomodule','srf805Cryomodule',
                  'cwCryomodule','nbSnCryomodule','srfLinacSector','twoBeamModule','plasmaAfterburner'];
  for (const id of LADDER) {
    const c = COMPONENTS[id];
    assert(!!c, `${id} exists`);
    assert(c.category === 'rf', `${id} is category rf`);
    assert(Array.isArray(c.beamlineTypes) && c.beamlineTypes.length > 0, `${id} is allowlisted`);
  }
  assert(COMPONENTS.plasmaAfterburner.requiredConnections.includes('dataFiber'),
    'plasmaAfterburner needs dataFiber, not rfWaveguide');
  assert(!COMPONENTS.plasmaAfterburner.requiredConnections.includes('rfWaveguide'),
    'plasmaAfterburner is not RF-fed');
}

// ---------------------------------------------------------------------------
// The three non-RF additions. recirculationArc is the one with a shape worth
// pinning: it is a junction with a routing array, following injectionSeptum,
// so the router never has to learn a new primitive to place it.
// ---------------------------------------------------------------------------
console.log('\n--- Non-RF additions ---');
{
  assert(COMPONENTS.fastKicker.beamlineTypes.includes('lightSource'),
    'lightSource can build a fast kicker');
  assert(COMPONENTS.recirculationArc.role === 'junction', 'recirculationArc is a junction');
  assert(Array.isArray(COMPONENTS.recirculationArc.routing), 'recirculationArc declares routing');
  assert(COMPONENTS.finalFocusDoublet.physicsType === 'quadrupole',
    'finalFocusDoublet models as a quadrupole');
}

// ---------------------------------------------------------------------------
// The tier-6 rung and its endpoints.
//
// crystalChannelStage gets the same pair of assertions plasmaAfterburner does,
// for the same reason and one more: like the afterburner it is not RF-fed, so
// a well-meaning "every accelerating structure needs a waveguide" edit would
// make it wrong. The extra one is the gradient. `stats.gradient` is not read by
// the engine — gameplay.py back-derives gradientDemanded as
// energyGain * 1000 / length — so the catalogue number is free to drift away
// from what the machine actually does, silently, and it is the only number in
// the balance readout the player sees. Every rung on the ladder pins it here.
// ---------------------------------------------------------------------------
console.log('\n--- crystalChannelStage: the top of the ladder ---');
{
  const c = COMPONENTS.crystalChannelStage;
  assert(!!c, 'crystalChannelStage exists');
  assert(c.category === 'rf' && c.subsection === 'normalConducting',
    'crystalChannelStage is rf / normalConducting');
  assert(c.physicsType === 'rfCavity',
    'crystalChannelStage models as an rfCavity — no new physics type');
  assert(Array.isArray(c.beamlineTypes) && c.beamlineTypes.length === 1
    && c.beamlineTypes[0] === 'blackHoleFactory',
    'crystalChannelStage is allowlisted to blackHoleFactory alone');
  assert(c.requiredConnections.includes('dataFiber')
    && !c.requiredConnections.includes('rfWaveguide'),
    'crystalChannelStage is not RF-fed');
  assert(c.rfFrequency === undefined && c.rfBand === undefined,
    'crystalChannelStage carries no RF frequency or band');

  // subL is in half-metre sub-units; gradientDemanded = energyGain*1000/length
  // in MV/m, which for 12000 GeV over 10 m is 1.2e6 MV/m = 1.2 TeV/m.
  const lengthM = c.subL * 0.5;
  const derived = c.stats.energyGain * 1000 / lengthM;
  assert(c.stats.gradient === derived,
    `crystalChannelStage.stats.gradient ${c.stats.gradient} MV/m is what the `
    + `engine derives (${derived})`);
  assert(derived >= 1e6 && derived <= 1e7,
    `${derived / 1e6} TeV/m sits inside the 1-10 TeV/m the channeling `
    + 'literature discusses');

  // The same identity every rung of the ladder has to keep.
  assert(c.stats.energyGain / c.subL === 600,
    `crystalChannelStage delivers ${c.stats.energyGain / c.subL} GeV per `
    + 'sub-unit (2,400 GeV per 4-sub-unit tile)');
}

console.log('\n--- the Black Hole Factory type ---');
{
  const t = BEAMLINE_TYPES.blackHoleFactory;
  assert(!!t && t.tier === 6, 'blackHoleFactory is tier 6');
  assert(t.particle === 'p+p-', 'blackHoleFactory collides hadrons');
  assert(t.spec.energyGeV[0] === 100000 && t.spec.energyGeV[1] === 500000,
    'band runs 100,000-500,000 GeV/beam (200 TeV - 1 PeV c.o.m.)');
  assert(t.spec.currentMA === undefined,
    'no current band — the currency is luminosity, as on the collider');
  assert(t.fom === 'blackHoleYield', 'paid on blackHoleYield');
  assert(t.dutyFactor < BEAMLINE_TYPES.collider.dutyFactor,
    `duty factor ${t.dutyFactor} is below the collider's `
    + `${BEAMLINE_TYPES.collider.dutyFactor} — it fires rarely`);
  assert(!Object.hasOwn(t, 'requires'),
    'the tier-6 mission is selectable even though its hardware is late-game');

  // The endpoints, and the identity that makes hawkingDetector worth having:
  // it is the only endpoint in the catalogue that records at scale and sells
  // nothing at all. `detector` (the collider's) is the comparison.
  const chamber = COMPONENTS.blackHoleChamber;
  const hawking = COMPONENTS.hawkingDetector;
  assert(chamber && chamber.isEndpoint, 'blackHoleChamber is an endpoint');
  assert(chamber.category === 'endpoint' && hawking.category === 'endpoint',
    'both new endpoints are category endpoint');
  assert(!!chamber.ports.entryA && !!chamber.ports.entryB,
    'blackHoleChamber takes two counter-propagating arms, as collisionPoint does');
  assert(chamber.physicsType === 'detector',
    'blackHoleChamber models as a detector so beam_beam fires on it');
  assert((hawking.stats.dataRate || 0) > (COMPONENTS.detector.stats.dataRate || 0),
    `hawkingDetector records more than the collider's detector `
    + `(${hawking.stats.dataRate} vs ${COMPONENTS.detector.stats.dataRate})`);
  assert(!hawking.stats.collisionRate && !hawking.stats.photonRate,
    'hawkingDetector sells nothing — no collision rate, no photon rate');
  for (const [id, c] of [['blackHoleChamber', chamber], ['hawkingDetector', hawking]]) {
    assert(Array.isArray(c.beamlineTypes) && c.beamlineTypes.length === 1
      && c.beamlineTypes[0] === 'blackHoleFactory',
      `${id} is allowlisted to blackHoleFactory alone`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
