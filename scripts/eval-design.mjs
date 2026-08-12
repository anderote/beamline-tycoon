// scripts/eval-design.mjs — measure what a stock blueprint actually does.
//
// A blueprint that has never been through the physics engine is a guess. This
// runs each one through the SAME code the browser runs and checks the beam it
// produces against its type's declared spec band, so shipped content cannot
// quietly claim an energy it does not reach.
//
//   node scripts/eval-design.mjs                 every blueprint
//   node scripts/eval-design.mjs therapy         one type
//   node scripts/eval-design.mjs therapy-c230    one blueprint by id
//   node scripts/eval-design.mjs --json          machine-readable, for the
//                                                generated measured.json
//   node scripts/eval-design.mjs --write         regenerate measured.json
//
// Exit code is non-zero if any evaluated blueprint is out of band, so this is
// usable as a check and not merely a report.
//
// FIDELITY IS THE WHOLE POINT. The chain is
//
//   blueprint  -> layoutDesign()        (the walk DesignPlacer places with)
//              -> designToOrderedNodes() (the shape flattenPath emits)
//              -> buildPhysicsElements() (the payload Game sends Pyodide)
//              -> beam_physics.eval_design (the engine itself)
//
// Only the middle step is written here, and test/test-design-layout-fidelity.js
// pins it against a blueprint actually placed through DesignPlacer on a
// headless Game. If that test fails, this harness is measuring a machine the
// player does not get, and its numbers are worthless.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import '../scripts/balance-env.mjs';
import { COMPONENTS } from '../src/data/components.js';
import { BEAMLINE_TYPES } from '../src/data/beamline-types.js';
import { layoutDesign } from '../src/beamline/design-layout.js';
import { buildPhysicsElements } from '../src/beamline/physics-payload.js';
import { seedComponentParams } from '../src/beamline/component-params.js';
import { STOCK_DESIGNS } from '../src/data/stock-designs.js';

const ROOT = new URL('..', import.meta.url).pathname;

// The params a component ACTUALLY carries once placed, given what the design
// authored. This used to be a local copy of Game._placePlaceableInner's three
// step seed; it is now the shared seedComponentParams, imported above, which
// both placement paths in the game also call. Keeping a copy here is what let
// the game's own pipe path silently stop seeding at all while this harness
// kept measuring the correctly-seeded machine.
//
// Why the harness needs it at all, and why getting it wrong is severe: a
// blueprint's params are only the OVERRIDES. `cyclotron30`, `cyclotron70`,
// `cyclotron230` and `cockcroftWalton` declare `particleType: 'proton'` in the
// catalogue and nowhere else, and `gameplay.extract_source_params` falls back
// to a game-type check that covers only `ionSource`/`ecrIonSource`. So a proton
// blueprint that did not restate the species was measured as a beam of
// ELECTRONS — at the proton's kinetic energy, with the proton's current, and a
// plausible-looking spot size. Nothing in the output said "electron".
const seedParams = seedComponentParams;

/**
 * Blueprint -> the ordered-node run `flattenPath` would emit for it once placed.
 *
 * This mirrors flattener.js's pipe walk deliberately and literally: beam length
 * is `subL * 0.5` metres, a placement sits at `position * pipeBeamLen` from the
 * pipe's entry, drifts fill the gaps between placements, and a tail drift closes
 * out the pipe. Diverging from that arithmetic — even by rounding — measures a
 * different lattice than the one the game will build.
 *
 * Ids are synthetic and positional. Nothing downstream reads them except the
 * per-cavity result write-back, which does not run here.
 */
export function designToOrderedNodes(design) {
  const { sequence } = layoutDesign(design);
  const out = [];
  let n = 0;

  for (const item of sequence) {
    if (item.kind === 'module') {
      out.push({
        kind: 'module',
        id: `m${n++}`,
        type: item.type,
        params: seedParams(item.type, item.params),
        subL: item.subL,
      });
      continue;
    }

    const pipeBeamLen = item.subL * 0.5;
    const placements = (item.attachments || []).map(a => {
      const plSubL = a.subL != null
        ? a.subL
        : (COMPONENTS[a.type] ? (COMPONENTS[a.type].subL || 1) : 1);
      return {
        a,
        plSubL,
        plBeamLen: plSubL * 0.5,
        offset: a.position * pipeBeamLen,
      };
    }).sort((x, y) => x.offset - y.offset);

    let consumed = 0;
    for (const p of placements) {
      const driftBeamLen = p.offset - consumed;
      if (driftBeamLen > 0) {
        out.push({ kind: 'drift', id: `d${n++}`, subL: driftBeamLen * 2 });
        consumed += driftBeamLen;
      }
      out.push({
        kind: 'placement',
        id: `p${n++}`,
        type: p.a.type,
        params: seedParams(p.a.type, p.a.params),
        subL: p.plSubL,
        position: p.a.position,
      });
      consumed += p.plBeamLen;
    }

    const tail = pipeBeamLen - consumed;
    if (tail > 0) out.push({ kind: 'drift', id: `d${n++}`, subL: tail * 2 });
  }

  return out;
}

/**
 * A fully provisioned node: every utility present and generous.
 *
 * This has to be supplied EXPLICITLY. `buildPhysicsElements` fail-closes any
 * declared sink it has no solved quality for, and the fail-closed values are
 * not zeros — they are 1013 mbar and 300 K, i.e. atmosphere and room
 * temperature, deliberately chosen so that never wiring a component can never
 * score better than wiring it badly. Handing the builder an empty context
 * therefore measures every blueprint at ATMOSPHERIC PRESSURE, where beam-gas
 * scattering destroys the beam within a metre or two. The first run of this
 * harness did exactly that and reported 0/3 in band with total loss on a bare
 * electron gun firing into a Faraday cup two metres away.
 *
 * A blueprint is a beamline, not a facility: it carries no cryoplant, no RF
 * station and no pumps, because the player builds those separately and feeding
 * the machine is a large part of the game. So the reference measurement is the
 * machine's DESIGN performance — what it does when its utilities are adequate
 * — and the picker's cards must say as much rather than implying the number
 * comes for free.
 */
const IDEAL_PROVISION = {
  powerQuality: 1, rfQuality: 1, coolingQuality: 1,
  cryoQuality: 1, vacuumQuality: 1, dataQuality: 1,
  // Enough RF that `achievable` never binds below the demanded gradient, so a
  // cavity is measured at its catalogue energy gain rather than at whatever
  // an arbitrary klystron size would allow.
  rfPowerW: 1e7,
  cryoTempK: 2.0,        // superfluid design point
  coolingDeltaT: 2.0,    // on-tune, negligible detuning
  vacuumPressure: 1e-9,  // UHV; beam-gas scattering negligible
};

/** The payload src/beamline/physics.js hands Pyodide, for a blueprint. */
export function designToPayload(design) {
  const nodes = designToOrderedNodes(design);
  const nodeQualities = {};
  for (const n of nodes) nodeQualities[n.id] = { ...IDEAL_PROVISION };
  return buildPhysicsElements(nodes, { nodeQualities }).map(el =>
    el.physicsType ? el : { ...el, physicsType: COMPONENTS[el.type]?.physicsType }
  );
}

let _tmp = null;
function tmpFile(name) {
  if (!_tmp) _tmp = mkdtempSync(join(tmpdir(), 'evaldesign-'));
  return join(_tmp, name);
}

/** Run one blueprint through the engine. Never throws; returns {error} instead. */
export function evaluate(design) {
  const type = BEAMLINE_TYPES[design.typeId];
  const payloadPath = tmpFile('payload.json');
  const effectsPath = tmpFile('effects.json');
  writeFileSync(payloadPath, JSON.stringify(designToPayload(design)));
  writeFileSync(effectsPath, JSON.stringify({
    machineType: type ? type.machineType : 'linac',
  }));

  try {
    const out = execFileSync(
      'python3',
      ['-m', 'beam_physics.eval_design', payloadPath, effectsPath],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(out);
  } catch (err) {
    return { error: String(err.stderr || err.message).slice(0, 400) };
  }
}

// --- Band checking --------------------------------------------------------

const inBand = (v, band) => {
  if (!band) return null;
  const [lo, hi] = band;
  if (lo != null && v < lo) return false;
  if (hi != null && v > hi) return false;
  return true;
};

/**
 * Judge a measurement against its type's spec.
 *
 * Loss is reported but never gates: `totalLossFraction` folds in RF capture
 * efficiency, so a correctly-built bunched line reads ~0.55 from its 0.45
 * capture alone. Anything that scrapes beam away shows up in the CURRENT band
 * instead, which is the honest place for it.
 */
export function checkBands(design, m) {
  const type = BEAMLINE_TYPES[design.typeId];
  const problems = [];
  if (!type) return { ok: false, problems: [`unknown typeId "${design.typeId}"`] };
  if (m.error) return { ok: false, problems: [`engine error: ${m.error}`] };

  if (m.beamAlive === false) problems.push('beam is dead');

  const eOk = inBand(m.beamEnergy, type.spec?.energyGeV);
  if (eOk === false) {
    problems.push(`energy ${fmtGeV(m.beamEnergy)} outside ${fmtBand(type.spec.energyGeV, fmtGeV)}`);
  }

  const iOk = inBand(m.beamCurrent, type.spec?.currentMA);
  if (iOk === false) {
    problems.push(`current ${fmtMA(m.beamCurrent)} outside ${fmtBand(type.spec.currentMA, fmtMA)}`);
  }

  if (type.spec?.spotSizeMm) {
    // The band is on the RMS spot the sample sees; use the larger plane, which
    // is what a uniformity requirement actually binds on.
    const spotMm = Math.max(m.finalBeamSizeX || 0, m.finalBeamSizeY || 0) * 1000;
    if (inBand(spotMm, type.spec.spotSizeMm) === false) {
      problems.push(`spot ${spotMm.toFixed(1)}mm outside ${fmtBand(type.spec.spotSizeMm, v => v + 'mm')}`);
    }
  }

  const endpoints = type.requiredEndpoint || [];
  if (endpoints.length) {
    const last = [...(design.components || [])].reverse()
      .find(c => COMPONENTS[c.type]?.category === 'endpoint');
    if (!last) problems.push(`no endpoint (wants one of ${endpoints.join('/')})`);
    else if (!endpoints.includes(last.type)) {
      problems.push(`ends in ${last.type}, wants one of ${endpoints.join('/')}`);
    }
  }

  return { ok: problems.length === 0, problems };
}

// --- Formatting -----------------------------------------------------------

function fmtGeV(v) {
  if (v == null) return '—';
  if (v >= 1) return `${v.toFixed(2)} GeV`;
  return `${(v * 1000).toFixed(1)} MeV`;
}
function fmtMA(v) {
  if (v == null) return '—';
  if (v >= 1) return `${v.toFixed(2)} mA`;
  if (v >= 1e-3) return `${(v * 1e3).toFixed(1)} µA`;
  return `${(v * 1e6).toFixed(1)} nA`;
}
function fmtBand(band, f) {
  if (!band) return '—';
  const [lo, hi] = band;
  return `${lo == null ? '' : f(lo)}–${hi == null ? '' : f(hi)}`;
}

// --- Main -----------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const filters = argv.filter(a => !a.startsWith('--'));

  let designs = STOCK_DESIGNS;
  if (filters.length) {
    designs = designs.filter(d =>
      filters.includes(d.typeId) || filters.includes(d.id));
  }
  if (designs.length === 0) {
    console.error(`No blueprints match ${filters.join(', ')}`);
    process.exit(2);
  }

  const results = [];
  let failed = 0;
  let lastType = null;

  for (const d of designs) {
    const m = evaluate(d);
    const verdict = checkBands(d, m);
    results.push({ id: d.id, typeId: d.typeId, tier: d.tier, measured: m, ...verdict });
    if (!verdict.ok) failed++;

    if (!flags.has('--json')) {
      if (d.typeId !== lastType) {
        const t = BEAMLINE_TYPES[d.typeId];
        console.log(`\n\x1b[1m${t ? t.name : d.typeId}\x1b[0m  `
          + `E ${fmtBand(t?.spec?.energyGeV, fmtGeV)}   I ${fmtBand(t?.spec?.currentMA, fmtMA)}`);
        lastType = d.typeId;
      }
      const mark = verdict.ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      console.log(`  ${mark} T${d.tier} ${d.id.padEnd(28)}`
        + `${fmtGeV(m.beamEnergy).padStart(11)} ${fmtMA(m.beamCurrent).padStart(11)}`
        + `  q=${(m.beamQuality ?? 0).toFixed(2)} loss=${(m.totalLossFraction ?? 0).toFixed(2)}`);
      for (const p of verdict.problems) console.log(`         \x1b[33m${p}\x1b[0m`);
    }
  }

  if (flags.has('--json')) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`\n${results.length - failed}/${results.length} blueprints in band`);
  }

  if (flags.has('--write')) {
    const measured = {};
    for (const r of results) {
      measured[r.id] = {
        beamEnergy: r.measured.beamEnergy,
        beamCurrent: r.measured.beamCurrent,
        beamQuality: r.measured.beamQuality,
        finalBeamSizeX: r.measured.finalBeamSizeX,
        finalBeamSizeY: r.measured.finalBeamSizeY,
        totalLossFraction: r.measured.totalLossFraction,
        inBand: r.ok,
      };
    }
    const out = join(ROOT, 'src/data/stock-designs.measured.json');
    writeFileSync(out, JSON.stringify(measured, null, 2) + '\n');
    console.log(`wrote ${out}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
