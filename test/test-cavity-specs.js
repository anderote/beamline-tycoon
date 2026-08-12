// test/test-cavity-specs.js — cross-language guard for the cavity model.
//
// src/beamline/cavity-specs.js and beam_physics/srf.py hold the same constants
// and the same formulas, because the thermal solve runs in JS every tick while
// the physics pass runs in Python. If they drift apart, the cryoplant bills for
// heat the cavities never produced (or misses heat they did), and the two sides
// of the feedback loop disagree about what temperature means.
//
// This test parses the Python table rather than importing it, so it catches
// divergence without needing a Python process. It also re-checks the JS maths
// against the same calibration table test_srf.py pins on the Python side.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAVITY_SPECS, T_CRITICAL, Q0_COPPER, R_RES_DEFAULT,
  rBcs, q0, eAccMax, pDiss, getCavitySpec,
} from '../src/beamline/cavity-specs.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function close(a, b, rel, msg) {
  const ok = Math.abs(a - b) <= Math.abs(b) * rel;
  assert(ok, `${msg} (got ${a}, want ~${b})`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- Parse the Python CAVITY_SPECS table ---------------------------------
const py = readFileSync(path.join(root, 'beam_physics/srf.py'), 'utf8');
const tableMatch = py.match(/^CAVITY_SPECS = \{([\s\S]*?)^\}/m);
assert(!!tableMatch, 'found CAVITY_SPECS block in beam_physics/srf.py');

const pySpecs = {};
if (tableMatch) {
  // Entries look like:  "cryomodule": { "kind": "srf", "f_ghz": 1.3, ... },
  const entryRe = /"(\w+)":\s*\{([^}]*)\}/g;
  let m;
  while ((m = entryRe.exec(tableMatch[1])) !== null) {
    const [, id, body] = m;
    const spec = {};
    const fieldRe = /"(\w+)":\s*("(?:\w+)"|[-\d.eE+]+|R_RES_DEFAULT)/g;
    let f;
    while ((f = fieldRe.exec(body)) !== null) {
      const [, key, raw] = f;
      if (raw === 'R_RES_DEFAULT') spec[key] = R_RES_DEFAULT;
      else if (raw.startsWith('"')) spec[key] = raw.slice(1, -1);
      else spec[key] = parseFloat(raw);
    }
    pySpecs[id] = spec;
  }
}

// --- Table agreement ------------------------------------------------------
const jsKeys = Object.keys(CAVITY_SPECS).sort();
const pyKeys = Object.keys(pySpecs).sort();
assert(jsKeys.length > 0, `parsed ${pyKeys.length} Python specs`);
assert(
  JSON.stringify(jsKeys) === JSON.stringify(pyKeys),
  `same component ids on both sides (js: ${jsKeys.length}, py: ${pyKeys.length})`,
);

for (const id of jsKeys) {
  const js = CAVITY_SPECS[id];
  const pyS = pySpecs[id];
  if (!pyS) { assert(false, `${id} missing from Python table`); continue; }
  for (const key of Object.keys(js)) {
    const a = js[key], b = pyS[key];
    if (typeof a === 'number') {
      assert(Math.abs(a - b) <= Math.abs(b) * 1e-9, `${id}.${key} agrees (${a})`);
    } else {
      assert(a === b, `${id}.${key} agrees (${a})`);
    }
  }
}

// --- Calibration table (mirrors test_srf.py) ------------------------------
const TESLA = CAVITY_SPECS.cryomodule;
const CALIBRATION = [
  // T,   R_BCS nohm,  Q0,       E_acc @42W,  P_diss @20MV/m
  [1.8, 10.2, 1.33e10, 23.1, 31],
  [2.0, 24.6, 7.80e9, 17.7, 54],
  [2.5, 115.2, 2.16e9, 9.3, 194],
  [3.0, 311.7, 8.39e8, 5.8, 499],
  [4.2, 1198.2, 2.23e8, 3.0, 1872],
];
for (const [t, rb, q, eacc, pd] of CALIBRATION) {
  close(rBcs(t, TESLA.f_ghz) * 1e9, rb, 0.05, `R_BCS at ${t} K`);
  close(q0(t, TESLA), q, 0.05, `Q0 at ${t} K`);
  close(eAccMax(42, TESLA, t), eacc, 0.05, `E_acc at ${t} K, 42 W`);
  close(pDiss(20, TESLA, t), pd, 0.05, `P_diss at ${t} K, 20 MV/m`);
}

// --- Properties the thermal loop depends on -------------------------------
for (const t of [1.8, 2.0, 3.0, 4.5]) {
  for (const p of [10, 42, 500]) {
    const g = eAccMax(p, TESLA, t);
    close(pDiss(g, TESLA, t), p, 1e-9, `dissipation round-trips at ${t} K, ${p} W`);
  }
}

const qs = [1.8, 2.0, 2.5, 3.0, 4.2, 5.0].map(t => q0(t, TESLA));
assert(qs.every((v, i) => i === 0 || qs[i - 1] > v), 'Q0 falls monotonically with T');

close(eAccMax(200, TESLA, 2.0), 2 * eAccMax(50, TESLA, 2.0), 1e-9,
  'gradient scales as sqrt(power)');

assert(eAccMax(1000, TESLA, T_CRITICAL + 0.1) === 0, 'no gradient above Tc');
assert(q0(T_CRITICAL + 0.1, TESLA) === Q0_COPPER, 'Q0 above Tc falls to copper');
assert(eAccMax(0, TESLA, 2.0) === 0, 'zero power gives zero gradient');
assert(eAccMax(-5, TESLA, 2.0) === 0, 'negative power gives zero gradient');
assert(q0(2.0, TESLA, 1e-9) > q0(2.0, TESLA, 20e-9),
  'lower residual resistance raises Q0');

// --- Normal conducting ----------------------------------------------------
const SBAND = CAVITY_SPECS.sbandStructure;
close(eAccMax(30e6, SBAND), 23.5, 0.05, 'S-band 30 MW gives ~23.5 MV/m');
assert(eAccMax(30e6, SBAND, 2.0) === eAccMax(30e6, SBAND, 300),
  'NC gradient ignores temperature');
assert(getCavitySpec('quadrupole') === null, 'unmodelled component has no spec');
assert(getCavitySpec('cryomodule') === TESLA, 'getCavitySpec returns the spec');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
