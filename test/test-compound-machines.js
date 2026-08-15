// test/test-compound-machines.js — the ploppable compound machines.
//
// A compound machine is source + acceleration + extraction in one placeable:
// you plop it, it has a beam exit port, and everything downstream is an
// ordinary player-designed beamline. Mechanically they are pure data — a
// `source` component carrying a high `extractionEnergy` — which is precisely
// why they need a test: nothing about them is enforced by a type system, and
// every one of the invariants below is a silent no-op if it breaks.
//
// The four that would actually bite:
//
//   1. `extractionEnergy` is only read off the raw component when the id has
//      NO entry in PARAM_DEFS. Game.js and BeamlineDesigner both prefer
//      computeStats(id, params).extractionEnergy and fall back to the static
//      field. Add a PARAM_DEFS entry for one of these ids without also adding
//      a derived extractionEnergy and the machine silently drops to the
//      engine's 0.01 GeV default — a 1 GeV LWFA becomes a 10 MeV one and
//      nothing anywhere complains.
//   2. A machine whose energy sits in no allowed type's band and which is not
//      deliberately a front end is content the player can build and never be
//      paid for.
//   3. requires ↔ unlocks symmetry (also covered globally by
//      test-registry-integrity, restated here so a compound-machine failure
//      names the compound machine).
//   4. The LWFA's utility profile IS its identity: heavy power and cooling,
//      no RF waveguide, no cryogenics. A well-meaning "make it consistent
//      with the other big machines" edit would erase the one thing that makes
//      it play differently.
//
// See docs/superpowers/specs/2026-08-11-compound-machines-design.md.

import { COMPONENTS } from '../src/data/components.js';
import { BEAMLINE_COMPONENTS_RAW } from '../src/data/beamline-components.raw.js';
import { INFRASTRUCTURE_RAW } from '../src/data/infrastructure.raw.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { BEAMLINE_TYPES } from '../src/data/beamline-types.js';
import { RESEARCH } from '../src/data/research.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
// The roster. `energyBand` is the range the design doc justifies from a real
// machine; a number outside it means someone retuned without re-anchoring.
// `standalone` says whether the machine's own extraction energy lands inside
// at least one of its allowed types' energy bands — false marks a pure front
// end, which must stay a deliberate statement rather than an accident.
// ---------------------------------------------------------------------------
const MACHINES = [
  {
    id: 'vanDeGraaff', species: 'electron', energyBand: [0.002, 0.005],
    gate: null, standalone: true,
    anchor: 'HVE/NEC electrostatic sets, 0.5-5 MV terminal',
  },
  {
    id: 'cockcroftWalton', species: 'proton', energyBand: [0.0005, 0.001],
    gate: null, standalone: false,
    anchor: 'Fermilab / BNL / CERN Linac2 750 kV preinjector',
  },
  {
    id: 'cyclotron30', species: 'proton', energyBand: [0.025, 0.035],
    gate: 'cyclotronTech', standalone: true,
    anchor: 'IBA Cyclone 30, 30 MeV, 2 x 350 uA',
  },
  {
    id: 'cyclotron70', species: 'proton', energyBand: [0.065, 0.075],
    gate: 'isochronousCyclotron', standalone: true,
    anchor: 'ARRONAX / IBA Cyclone 70, 70 MeV, 2 x 375 uA',
  },
  {
    id: 'protonLinacFrontEnd', species: 'proton', energyBand: [0.17, 0.19],
    gate: 'cwLinacDesign', standalone: false,
    anchor: 'PIP-II / ESS low-beta front end, 180 MeV handoff',
  },
  {
    id: 'cyclotron230', species: 'proton', energyBand: [0.225, 0.250],
    gate: 'isochronousCyclotron', standalone: true,
    anchor: 'IBA Cyclone 230 / Varian ProBeam, 230 MeV fixed, ~1 uA',
  },
  {
    id: 'lwfaStation', species: 'electron', energyBand: [0.5, 2.0],
    gate: 'plasmaAcceleration', standalone: true,
    anchor: 'LBNL BELLA, 1 GeV in a 3.3 cm capillary (2006)',
  },
  {
    // The species outlier. Positrons share the electron rest mass exactly, so
    // 'positron' costs the engine nothing and gets the kinematics right for
    // free — but charge sign is modelled NOWHERE in beam_physics, so nothing
    // downstream treats this beam differently from an electron beam and
    // nothing checks that a collider's two arms are opposite species. The
    // declaration is bookkeeping and a hook, and the assertions below say so.
    id: 'positronSource', species: 'positron', energyBand: [0.1, 0.5],
    gate: 'antimatter', standalone: false,
    anchor: 'SLC positron source, W-Re target + flux concentrator, 200 MeV capture',
  },
];

const IDS = MACHINES.map(m => m.id);

// ---------------------------------------------------------------------------
// 1. Each machine is a valid, placeable beam source with an exit port.
// ---------------------------------------------------------------------------
console.log('\n--- every compound machine is a placeable source ---');
for (const m of MACHINES) {
  const raw = BEAMLINE_COMPONENTS_RAW[m.id];
  assert(!!raw, `${m.id} exists in BEAMLINE_COMPONENTS_RAW`);
  if (!raw) continue;

  assert(raw.isSource === true, `${m.id} declares isSource`);
  assert(raw.physicsType === 'source',
    `${m.id}.physicsType = 'source' (got ${raw.physicsType})`);
  assert(raw.category === 'source', `${m.id} lives in the source palette`);
  assert(raw.placement === 'module', `${m.id} is a placed module`);
  // junction + empty routing is what lets the player draw pipe off it. A
  // 'placement' role would make it insertable into a pipe run instead, which
  // is nonsense for a machine that starts the beam.
  assert(raw.role === 'junction', `${m.id} is a junction, not a pipe insert`);
  assert(Array.isArray(raw.routing) && raw.routing.length === 0,
    `${m.id}.routing is empty — the beam starts here`);
  assert(!raw.isDrawnConnection, `${m.id} is a real placeable, not a drawn connection`);

  const beamPorts = Object.entries(raw.ports || {});
  assert(beamPorts.length === 1 && beamPorts[0][0] === 'exit',
    `${m.id} declares exactly one beam port and it is 'exit' `
    + `(got ${beamPorts.map(([k]) => k).join(', ') || 'none'})`);
  assert(!!raw.ports?.exit?.side, `${m.id}.ports.exit names a side`);

  // No entry port: a compound machine cannot be fed, only drawn from.
  assert(!raw.ports?.entry, `${m.id} has no entry port`);
}

// ---------------------------------------------------------------------------
// 2. Extraction energies are in band, and actually reach the engine.
// ---------------------------------------------------------------------------
console.log('\n--- extraction energies are declared, in band, and reachable ---');
for (const m of MACHINES) {
  const raw = BEAMLINE_COMPONENTS_RAW[m.id];
  if (!raw) continue;
  const e = raw.extractionEnergy;
  assert(typeof e === 'number' && Number.isFinite(e) && e > 0,
    `${m.id}.extractionEnergy is a positive number (got ${e})`);
  const [lo, hi] = m.energyBand;
  assert(e >= lo && e <= hi,
    `${m.id} extracts ${(e * 1000).toFixed(2)} MeV, inside [${lo * 1000}, ${hi * 1000}] MeV `
    + `— anchored on ${m.anchor}`);

  // THE LOAD-BEARING ONE. Game.js:
  //     if (computed?.extractionEnergy !== undefined) use computed
  //     else if (t.extractionEnergy !== undefined)    use the static field
  // A PARAM_DEFS entry with tunables but no derived extractionEnergy would
  // not shadow the static field — but one WITH a derived extractionEnergy
  // would, and adding tunables to a compound machine is an obvious future
  // move. Pin the current state so that move has to come with a formula.
  const defs = PARAM_DEFS[m.id];
  assert(defs === undefined || defs.extractionEnergy?.derived === true,
    `${m.id} either has no PARAM_DEFS entry or that entry derives `
    + 'extractionEnergy — otherwise the static field is silently unused');
}

console.log('\n--- the roster is a monotonic energy ladder ---');
{
  const sorted = [...MACHINES].sort(
    (a, b) => BEAMLINE_COMPONENTS_RAW[a.id].extractionEnergy
            - BEAMLINE_COMPONENTS_RAW[b.id].extractionEnergy);
  const order = sorted.map(m => m.id).join(' < ');
  assert(order === 'cockcroftWalton < vanDeGraaff < cyclotron30 < cyclotron70 '
                 + '< protonLinacFrontEnd < positronSource < cyclotron230 < lwfaStation',
    `energy ordering is the designed one: ${order}`);
}

// ---------------------------------------------------------------------------
// 3. Species. gameplay.py picks PROTON_MASS off params.particleType — a
//    proton machine that forgets it silently accelerates electrons, and the
//    only visible symptom is that the beam is 1836x too stiff.
// ---------------------------------------------------------------------------
console.log('\n--- species reach the physics engine ---');
for (const m of MACHINES) {
  const raw = BEAMLINE_COMPONENTS_RAW[m.id];
  if (!raw) continue;
  const declared = raw.params?.particleType;
  if (m.species === 'proton') {
    assert(declared === 'proton',
      `${m.id} declares params.particleType = 'proton' (got ${declared})`);
    assert(raw.subsection === 'proton', `${m.id} sits in the proton subsection`);
  } else if (m.species === 'positron') {
    // extract_source_params only branches on 'proton'; anything else falls
    // through to ELECTRON_MASS, which is the correct rest mass for a positron.
    // So this string must NOT be one the engine acts on, and the fact that it
    // is inert is the point — the day charge sign gets modelled, this is where
    // it reads from.
    assert(declared === 'positron',
      `${m.id} declares params.particleType = 'positron' (got ${declared})`);
    assert(raw.subsection === 'electron',
      `${m.id} sits in the electron subsection — same rest mass, same optics`);
  } else {
    assert(declared === undefined,
      `${m.id} declares no particleType — the engine's default is the electron mass`);
    assert(raw.subsection === 'electron', `${m.id} sits in the electron subsection`);
  }
}

// ---------------------------------------------------------------------------
// 4. Source phase space. Large numbers here are honest physics, NOT a quality
//    penalty — see the spec. The check is that the field exists and is sane,
//    because an omitted emittance silently falls back to gameplay.py's 1e-6
//    m.rad default and every machine looks like a photoinjector.
// ---------------------------------------------------------------------------
console.log('\n--- every machine declares its own source emittance ---');
for (const m of MACHINES) {
  const raw = BEAMLINE_COMPONENTS_RAW[m.id];
  if (!raw) continue;
  const eps = raw.stats?.emittance;
  assert(typeof eps === 'number' && eps > 0 && eps <= 50,
    `${m.id}.stats.emittance = ${eps} mm.mrad, declared and in a sane range`);
  const cur = raw.stats?.beamCurrent;
  assert(typeof cur === 'number' && cur > 0,
    `${m.id}.stats.beamCurrent = ${cur} mA is declared and positive`);
}

// ---------------------------------------------------------------------------
// 5. Palette. Every machine must be buildable somewhere, and the front end
//    vs standalone split must stay deliberate.
// ---------------------------------------------------------------------------
console.log('\n--- every machine resolves in at least one type palette ---');
for (const m of MACHINES) {
  const comp = COMPONENTS[m.id];
  if (!comp) continue;
  const allow = comp.beamlineTypes;
  assert(Array.isArray(allow) && allow.length > 0,
    `${m.id} carries a non-empty beamlineTypes allowlist`);

  const dead = (allow || []).filter(t => !BEAMLINE_TYPES[t]);
  assert(dead.length === 0,
    `${m.id}: ${dead.length === 0 ? 'every allowed type resolves' : `dead type(s) ${dead.join(', ')}`}`);

  // Survives the type's own denylist, so it really is in that palette.
  const visible = (allow || []).filter(
    t => BEAMLINE_TYPES[t] && !(BEAMLINE_TYPES[t].excludes || []).includes(m.id));
  assert(visible.length > 0,
    `${m.id} survives its own filter in ${visible.length} type(s): ${visible.join(', ')}`);
}

console.log('\n--- standalone machines land in a type band; front ends do not ---');
for (const m of MACHINES) {
  const comp = COMPONENTS[m.id];
  const raw = BEAMLINE_COMPONENTS_RAW[m.id];
  if (!comp || !raw) continue;
  const e = raw.extractionEnergy;
  const inBand = (comp.beamlineTypes || []).filter((tid) => {
    const [lo, hi] = BEAMLINE_TYPES[tid]?.spec?.energyGeV || [];
    return lo != null && hi != null && e >= lo && e <= hi;
  });
  if (m.standalone) {
    assert(inBand.length > 0,
      `${m.id} at ${(e * 1000).toFixed(1)} MeV is inside ${inBand.join(', ') || 'NO'} band(s) `
      + '— it can be plopped and paid');
  } else {
    assert(inBand.length === 0,
      `${m.id} at ${(e * 1000).toFixed(2)} MeV is deliberately below every band it serves `
      + `(${inBand.join(', ') || 'none'}) — it is a front end, not a machine you get paid for`);
  }
}

// ---------------------------------------------------------------------------
// 6. Research gating.
// ---------------------------------------------------------------------------
console.log('\n--- gates resolve to real research nodes, both directions ---');
for (const m of MACHINES) {
  const raw = BEAMLINE_COMPONENTS_RAW[m.id];
  if (!raw) continue;
  if (m.gate === null) {
    assert(raw.requires == null,
      `${m.id} is ungated (requires = ${raw.requires ?? 'none'})`);
    assert(raw.unlocked === true,
      `${m.id} declares unlocked: true — an ungated component that omits it never appears`);
    continue;
  }
  assert(raw.requires === m.gate,
    `${m.id} is gated on '${m.gate}' (got '${raw.requires}')`);
  assert(raw.unlocked !== true,
    `${m.id} is not also pre-unlocked — that would make its gate a lie`);
  const node = RESEARCH[m.gate];
  assert(!!node, `${m.gate} is a real research node`);
  assert(!!node && (node.unlocks || []).includes(m.id),
    `RESEARCH.${m.gate}.unlocks advertises ${m.id} — the tech tree and the `
    + 'component have to agree in both directions');
}

// ---------------------------------------------------------------------------
// 7. Utilities. requiredConnections without a matching sink port throws at
//    import (validate.js), so reaching this file at all proves the pairing —
//    what is checked here is the SHAPE of each profile, which nothing else
//    pins.
// ---------------------------------------------------------------------------
console.log('\n--- utility profiles are wired and shaped as designed ---');
for (const m of MACHINES) {
  const raw = BEAMLINE_COMPONENTS_RAW[m.id];
  if (!raw) continue;
  const ports = Object.values(getUtilityPortsV2(m.id));
  const sinks = new Set(ports.filter(p => p.role === 'sink').map(p => p.utility));

  for (const u of raw.requiredConnections || []) {
    assert(sinks.has(u), `${m.id} has a '${u}' sink port to match requiredConnections`);
  }
  // Auto-injected for every non-drawn beamline module; a hand-added one would
  // be the bug, an absent one would mean the injector stopped running.
  assert(sinks.has('vacuumPipe'), `${m.id} received its auto-injected vacuum sink`);
  assert(!(raw.requiredConnections || []).includes('vacuumPipe'),
    `${m.id} does not hand-declare vacuumPipe`);

  const pwr = ports.find(p => p.utility === 'powerCable' && p.role === 'sink');
  assert(pwr && pwr.params.demand > 0,
    `${m.id} draws ${pwr?.params?.demand} kW — every compound machine is mains-fed`);
}

console.log('\n--- the tier-1 pair are cheap to run, the big ones are not ---');
{
  const demand = id => Object.values(getUtilityPortsV2(id))
    .find(p => p.utility === 'powerCable' && p.role === 'sink')?.params.demand ?? 0;
  // One powerPanel is 40 kW. The Van de Graaff has to fit behind one, or the
  // "plop it on tick 1" promise is false.
  assert(demand('vanDeGraaff') <= 40,
    `vanDeGraaff draws ${demand('vanDeGraaff')} kW — inside one powerPanel's 40 kW`);
  assert(demand('cyclotron30') > 40 && demand('cyclotron30') <= 150,
    `cyclotron30 draws ${demand('cyclotron30')} kW — past a panel, inside a padMountTransformer`);
  assert(demand('cyclotron70') > 250,
    `cyclotron70 draws ${demand('cyclotron70')} kW — past an MCC, needs switchgear or better`);
  assert(demand('lwfaStation') > 400,
    `lwfaStation draws ${demand('lwfaStation')} kW before its drive laser is even switched on`);

  // Cooling scales with the wall draw everywhere except the Van de Graaff,
  // which has no loop at all — that absence is its whole tier-1 identity.
  const cooled = id => Object.values(getUtilityPortsV2(id))
    .some(p => p.utility === 'coolingWater' && p.role === 'sink');
  assert(!cooled('vanDeGraaff'),
    'vanDeGraaff needs no cooling water — power and vacuum and nothing else');
  for (const id of ['cockcroftWalton', 'cyclotron30', 'cyclotron70', 'lwfaStation']) {
    assert(cooled(id), `${id} takes its heat off into the water loop`);
  }
}

console.log('\n--- the LWFA profile is genuinely different ---');
{
  const raw = BEAMLINE_COMPONENTS_RAW.lwfaStation;
  const req = raw?.requiredConnections || [];
  // No cavity to drive and nothing to hold at 2 K. This is the assertion that
  // stops a future "make the big machines consistent" pass from erasing it.
  assert(!req.includes('rfWaveguide'),
    'lwfaStation needs no RF waveguide — a plasma wake is not a cavity');
  assert(!req.includes('cryoTransfer'),
    'lwfaStation needs no cryogenics — a plasma stage is warm');
  assert(!raw?.rfFrequency && !raw?.rfBand,
    'lwfaStation declares no RF frequency bucket');
  assert(req.includes('dataFiber'),
    'lwfaStation takes a fibre — the femtosecond timing link to its drive laser');

  // The one compound machine whose operation depends on a timing network.
  // Photoinjector guns also need fibre timing, but they are source modules,
  // not self-contained source+acceleration machines.
  const otherCompoundMachinesOnFibre = MACHINES
    .map(machine => BEAMLINE_COMPONENTS_RAW[machine.id])
    .filter(c => c.id !== 'lwfaStation')
    .filter(c => (c.requiredConnections || []).includes('dataFiber'))
    .map(c => c.id);
  assert(otherCompoundMachinesOnFibre.length === 0,
    `lwfaStation is the only compound source on the fibre network${otherCompoundMachinesOnFibre.length ? ` (also: ${otherCompoundMachinesOnFibre.join(', ')})` : ''}`);
}

console.log('\n--- the drive laser is its own component, not the gun-drive one ---');
{
  const pw = INFRASTRUCTURE_RAW.petawattLaser;
  assert(!!pw, 'petawattLaser exists in INFRASTRUCTURE_RAW');
  assert(pw?.requires === 'plasmaAcceleration',
    `petawattLaser is gated on plasmaAcceleration (got ${pw?.requires})`);
  assert((RESEARCH.plasmaAcceleration?.unlocks || []).includes('petawattLaser'),
    'RESEARCH.plasmaAcceleration advertises petawattLaser');

  // The distinction that justifies a second laser at all: laserSystem is a
  // 3 kW photocathode gun drive, this is a hundred times the wall draw.
  const gunDrive = INFRASTRUCTURE_RAW.laserSystem;
  assert(!!gunDrive && pw && pw.energyCost > gunDrive.energyCost * 50,
    `petawattLaser draws ${pw?.energyCost} kW against laserSystem's `
    + `${gunDrive?.energyCost} kW — two different machines, not a rename`);

  const sinks = Object.values(getUtilityPortsV2('petawattLaser'))
    .filter(p => p.role === 'sink').map(p => p.utility);
  for (const u of ['powerCable', 'coolingWater', 'dataFiber']) {
    assert(sinks.includes(u), `petawattLaser sinks ${u}`);
  }
  // It is not a beamline component: no beam ever enters or leaves it.
  assert(Object.keys(pw?.ports || {}).length === 0,
    'petawattLaser declares no beam ports');
}

// ---------------------------------------------------------------------------
// 8. Costs. The whole proposition is "pay capital to skip design work", so a
//    compound machine that undercuts the parts it replaces is a free lunch.
// ---------------------------------------------------------------------------
console.log('\n--- compound machines cost more than the parts they replace ---');
{
  const cost = id => COMPONENTS[id]?.cost?.funding ?? 0;
  // 750 keV of protons out of one box, against a duoplasmatron plus the RFQ
  // that would otherwise be mandatory to get off the space-charge floor —
  // and the RFQ needs an rfWaveguide network the CW set does not.
  assert(cost('cockcroftWalton') > cost('ionSource'),
    `cockcroftWalton (${cost('cockcroftWalton')}) costs more than a bare ionSource (${cost('ionSource')})`);
  // 1 GeV in a crate against five cryomodules at 0.2 GeV each.
  assert(cost('lwfaStation') > 3 * cost('cryomodule'),
    `lwfaStation (${cost('lwfaStation')}) costs more than three cryomodules `
    + `(${3 * cost('cryomodule')}) — it buys length and cryoplant, not a discount`);
  // Ladder within the roster.
  const ladder = IDS.map(cost);
  assert(ladder.every((c, i) => i === 0 || c > ladder[i - 1]),
    `cost rises monotonically along the roster: ${ladder.join(' < ')}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
