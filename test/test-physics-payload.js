// test/test-physics-payload.js — pins the shape of the element array
// src/beamline/physics-payload.js hands to the Python physics engine.
//
// This payload is a cross-language contract: beam_physics/lattice.py and
// gameplay.py read every one of these fields BY NAME, so a rename, a dropped
// key or a changed default shows up not as an error but as physics that
// quietly stops responding to something (the infraQuality regression that made
// unwired components run at full quality is exactly this failure mode). The
// snapshot below is therefore written out literally rather than recomputed —
// if a change makes it fail, the question to answer is whether the Python side
// was updated to match, not whether to re-bless the numbers.
//
// Scenarios:
//   1. Full-shape snapshot over ordered nodes covering a module with params,
//      a module whose computed stats overlay (not replace) its catalogue
//      stats, a flattener drift entry, a module with no params at all, an
//      on-pipe attachment, and a module carrying a type-level
//      extractionEnergy.
//   2. subL fallback chain: node → component default → 4.
//   3. infraQuality fail-closed floor, with and without solved qualities.
//   4. extractionEnergy precedence: computed wins over the type's value.
//   5. Designer drafts share catalogue physics while assuming ideal services.

import {
  buildDesignerPhysicsElements,
  buildPhysicsElements,
} from '../src/beamline/physics-payload.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// Structural compare that also rejects EXTRA keys, so a newly added field
// can't slip into the payload without this test noticing.
function deepEqual(a, b, path = '') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null) {
    return `${path || '<root>'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  }
  if (typeof a !== 'object') {
    return `${path || '<root>'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array/object mismatch`;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join(',') !== kb.join(',')) {
    return `${path || '<root>'}: keys [${ka.join(',')}] !== [${kb.join(',')}]`;
  }
  for (const k of ka) {
    const sub = deepEqual(a[k], b[k], path ? `${path}.${k}` : k);
    if (sub) return sub;
  }
  return null;
}

function assertDeep(actual, expected, msg) {
  const diff = deepEqual(actual, expected);
  assert(diff === null, diff ? `${msg} — ${diff}` : msg);
}

// ---------------------------------------------------------------------------
// Fixture: one flattened path, in beam order.
// ---------------------------------------------------------------------------

const ORDERED = [
  // Module WITH params: computeStats replaces the catalogue focusStrength.
  { kind: 'module', id: 'q1', type: 'quadrupole', subL: 2,
    params: { gradient: 20, polarity: 1 }, beamStart: 0 },
  // Module WITH params whose computed stats do NOT cover every catalogue key:
  // bendAngle must survive the overlay, maxMomentum must be added.
  { kind: 'module', id: 'dip1', type: 'dipole', subL: 2,
    params: { fieldStrength: 1.2 }, beamStart: 1 },
  // Flattener drift entry: no `type`, no params, no id in the payload.
  { kind: 'drift', id: 'pipe1:d0', subL: 6, beamStart: 2 },
  // Module with NO params and NO explicit subL — falls back to the type's.
  { kind: 'module', id: 'bpm1', type: 'bpm', beamStart: 5 },
  // On-pipe attachment (role 'placement'), with solved utility qualities.
  { kind: 'placement', id: 'cav1', type: 'ellipticalSrfCavity', subL: 3,
    params: {}, pipeId: 'pipe1', position: 0.4, beamStart: 5.5 },
  // Type-level extractionEnergy, no PARAM_DEFS entry.
  { kind: 'module', id: 'cyc1', type: 'cyclotron30', subL: 8, beamStart: 7 },
];

// The gate's solved qualities. q1 is partially solved (power + cooling only);
// cav1 is solved for cryo/RF. Everything else the type declares stays at the
// fail-closed floor.
const NODE_QUALITIES = {
  q1: { powerQuality: 0.5, coolingQuality: 0.9 },
  cav1: { cryoQuality: 0.75, cryoTempK: 2, rfQuality: 1, cryoQuenched: false },
};

const EXPECTED = [
  {
    id: 'q1',
    type: 'quadrupole',
    subL: 2,
    activeLengthM: 0.35,
    apertureRadius: 48,
    stats: { focusStrength: 5.996 },
    params: { gradient: 20, polarity: 1 },
    infraQuality: {
      powerQuality: 0.5,
      coolingQuality: 0.9,
      coolingDeltaT: 100,
      vacuumQuality: 0,
      vacuumPressure: 1013,
    },
  },
  {
    id: 'dip1',
    type: 'dipole',
    subL: 2,
    apertureRadius: 48,
    stats: { bendAngle: 90, maxMomentum: 0.6870909879208832 },
    params: { fieldStrength: 1.2 },
    infraQuality: {
      powerQuality: 0,
      coolingQuality: 0,
      coolingDeltaT: 100,
      vacuumQuality: 0,
      vacuumPressure: 1013,
    },
  },
  {
    // No `id` key at all — drifts are not placeables and nothing writes back
    // to them.
    type: 'drift',
    subL: 6,
    stats: {},
    params: {},
  },
  {
    id: 'bpm1',
    type: 'bpm',
    subL: 1,
    apertureRadius: 40,
    stats: { beamQuality: 0.02 },
    params: {},
    infraQuality: {
      powerQuality: 0,
      dataQuality: 0,
      vacuumQuality: 0,
      vacuumPressure: 1013,
    },
  },
  {
    id: 'cav1',
    type: 'ellipticalSrfCavity',
    subL: 3,
    stats: { energyGain: 0.0375, gradient: 25 },
    rfFrequency: 1300,
    betaAcceptance: { min: 0.85, design: 0.999, max: 1.0 },
    apertureRadius: 56,
    params: {},
    infraQuality: {
      powerQuality: 0,
      cryoQuality: 0.75,
      cryoTempK: 2,
      rfQuality: 1,
      rfPowerW: 0,
      vacuumQuality: 0,
      vacuumPressure: 1013,
      cryoQuenched: false,
    },
  },
  {
    id: 'cyc1',
    type: 'cyclotron30',
    subL: 8,
    apertureRadius: 40,
    stats: { beamCurrent: 0.35, emittance: 6 },
    params: {},
    extractionEnergy: 0.03,
    infraQuality: {
      hvQuality: 0,
      coolingQuality: 0,
      coolingDeltaT: 100,
      vacuumQuality: 0,
      vacuumPressure: 1013,
    },
  },
];

// ==========================================================================
// Test 1: the whole payload, field for field.
// ==========================================================================
console.log('\n--- Test 1: payload snapshot ---');
{
  const out = buildPhysicsElements(ORDERED, { nodeQualities: NODE_QUALITIES });
  assert(out.length === ORDERED.length,
    `one element per ordered node, drifts included (got ${out.length})`);
  assertDeep(out, EXPECTED, 'payload deep-equals the pinned snapshot');

  // Spelled out separately because these are the invariants the snapshot is
  // protecting, and a future edit to EXPECTED should have to break them too.
  assert(out[1].stats.bendAngle === 90,
    'computed stats OVERLAY the catalogue stats rather than replacing them');
  assert(out[0].stats.focusStrength === 5.996,
    'a key computeStats does produce wins over the catalogue value');
  assert(out[2].type === 'drift' && !('id' in out[2]),
    'a flattener drift entry becomes type "drift" and carries no id');
  assert(out[4].id === 'cav1',
    'ids round-trip so per-cavity results can be written back to the placeable');
  assert(out[0].apertureRadius === 48 && out[4].apertureRadius === 56,
    'authored aperture radii cross the JS/Python payload boundary');
  assert(out[0].activeLengthM === 0.35,
    'authored active optics length crosses the JS/Python payload boundary');
}

// ==========================================================================
// Test 2: subL fallback chain.
// ==========================================================================
console.log('\n--- Test 2: subL fallback ---');
{
  const out = buildPhysicsElements([
    { kind: 'module', id: 'a', type: 'bpm', subL: 7 },
    { kind: 'module', id: 'b', type: 'bpm' },
    { kind: 'drift', id: 'c', subL: 3 },
    { kind: 'drift', id: 'd' },
    { kind: 'placement', id: 'inline', type: 'bpm', subL: 0 },
  ], {});
  assert(out[0].subL === 7, 'node subL wins');
  assert(out[1].subL === 1, "falls back to the component's subL");
  assert(out[2].subL === 3, 'drift keeps its own subL');
  assert(out[3].subL === 4, 'a drift with no subL falls back to 4');
  assert(out[4].subL === 0,
    'an inline attachment preserves its intentional zero-length physics span');
}

// ==========================================================================
// Test 3: infraQuality fails closed, and stays absent when not applicable.
//
// An ABSENT quality field means "does not consume this utility" and reads as
// 1.0 downstream, so a declared-but-unsolved sink has to be present at 0.
// ==========================================================================
console.log('\n--- Test 3: infraQuality floor ---');
{
  // No ctx at all — the gate has not run yet. Declared sinks still floor to 0.
  const [cav] = buildPhysicsElements(
    [{ kind: 'placement', id: 'cav1', type: 'ellipticalSrfCavity', subL: 3 }], {});
  assert(cav.infraQuality.cryoQuality === 0 && cav.infraQuality.rfQuality === 0,
    'declared sinks floor to 0 before the gate has written nodeQualities');
  assert(!('coolingQuality' in cav.infraQuality),
    'a utility the type declares no sink for stays ABSENT (= not applicable)');
  assert(!('dataQuality' in cav.infraQuality),
    'same for dataFiber on a component that has no data sink');

  // ctx omitted entirely — must behave exactly like an empty ctx.
  const [cavNoCtx] = buildPhysicsElements(
    [{ kind: 'placement', id: 'cav1', type: 'ellipticalSrfCavity', subL: 3 }]);
  assertDeep(cavNoCtx, cav, 'omitting ctx matches an empty ctx');

  // Solved qualities overlay the floor; unsolved declared sinks stay at 0.
  const [q] = buildPhysicsElements(
    [{ kind: 'module', id: 'q1', type: 'quadrupole', subL: 2, params: {} }],
    { nodeQualities: { q1: { powerQuality: 0.25 } } });
  assert(q.infraQuality.powerQuality === 0.25, 'solved quality overlays the floor');
  assert(q.infraQuality.coolingQuality === 0,
    'a declared sink the solve reported nothing for stays at 0');

  // A type with no declared sinks and no solved entry carries no infraQuality
  // key at all, so the fallback model treats it as unconstrained.
  const [drift] = buildPhysicsElements([{ kind: 'drift', id: 'd0', subL: 2 }], {});
  assert(!('infraQuality' in drift), 'a drift carries no infraQuality');
}

// ==========================================================================
// Test 4: extractionEnergy precedence — computed beats the type's value.
// ==========================================================================
console.log('\n--- Test 4: extractionEnergy precedence ---');
{
  const [src] = buildPhysicsElements([{
    kind: 'module', id: 'src1', type: 'ionSource', subL: 4,
    params: { extractionVoltage: 30000, arcCurrent: 5 },
  }], {});
  assert(src.extractionEnergy === 0.03,
    `computed extractionEnergy is lifted to a top-level field (got ${src.extractionEnergy})`);
  assert(src.stats.extractionEnergy === 0.03,
    'and it also stays in the stats blob');

  const [cyc] = buildPhysicsElements(
    [{ kind: 'module', id: 'c1', type: 'cyclotron30', subL: 8 }], {});
  assert(cyc.extractionEnergy === 0.03,
    'a type-level extractionEnergy is used when nothing computes one');

  const [bpm] = buildPhysicsElements(
    [{ kind: 'module', id: 'b1', type: 'bpm' }], {});
  assert(!('extractionEnergy' in bpm),
    'a component with neither carries no extractionEnergy key');
}

// ==========================================================================
// Test 5: Designer drafts share catalogue physics without pretending their
// not-yet-built utility endpoints are disconnected.
// ==========================================================================
console.log('\n--- Test 5: Designer ideal-services payload ---');
{
  const [cavity] = buildDesignerPhysicsElements([{
    id: 'preview', type: 'ellipticalSrfCavity', subL: 3,
    params: { rfFrequency: 1300, gradient: 25, rfPhase: 0 },
  }]);
  assert(cavity.apertureRadius === 56,
    'Designer preview publishes the same authored aperture as production');
  assert(cavity.betaAcceptance?.min === 0.85 && cavity.betaAcceptance?.max === 1,
    'Designer preview publishes the same beta-acceptance window as production');
  assert(!('infraQuality' in cavity),
    'Designer draft assumes ideal services until components have map endpoints');
}

// ==========================================================================
// Test 6: source exit conditions and authored RF frequency survive the JS /
// Python boundary.  These are top-level fields, not recomputed UI values.
// ==========================================================================
console.log('\n--- Test 6: front-end physics fields ---');
{
  const [source, injector, rfq] = buildDesignerPhysicsElements([
    { id: 'ecr', type: 'ecrIonSource' },
    { id: 'hv', type: 'dcInjector', params: { terminalVoltage: 750, lensVoltage: 30 } },
    { id: 'rfq', type: 'rfq' },
  ]);
  assert(source.sourceBeamRadiusMm === 10,
    'ECR measured RMS source radius crosses the payload boundary');
  assert(source.sourceSpaceChargeCompensation === 0.98,
    'ECR source neutralization crosses the payload boundary');
  assert(injector.stats.energyGain === 0.00075 && injector.stats.focusStrength === 0.9,
    'DC injector controls publish electrostatic energy and lens strength');
  assert(injector.stats.spaceChargeCompensation === 99,
    'DC injector publishes its neutralized LEBT fraction');
  assert(rfq.rfFrequency === 162.5,
    'RFQ authored 162.5 MHz reaches Python instead of falling back to 1.3 GHz');
}

// ==========================================================================
// Test 7: component operating state and health affect physics, never path
// continuity. Off or failed downstream hardware becomes drift; partial health
// derates active output while leaving physical length intact.
// ==========================================================================
console.log('\n--- Test 7: passive and damaged components ---');
{
  const node = {
    kind: 'placement', id: 'q-health', type: 'quadrupole', subL: 2,
    params: { gradient: 20, polarity: 0 },
  };
  const [healthy] = buildPhysicsElements([node], {
    componentHealth: { 'q-health': 100 },
  });
  const [damaged] = buildPhysicsElements([node], {
    componentHealth: { 'q-health': 50 },
  });
  assert(Math.abs(damaged.stats.focusStrength - healthy.stats.focusStrength * 0.5) < 1e-12,
    'partial health proportionally derates active magnet strength');
  assert(damaged.subL === healthy.subL,
    'damage does not change the occupied beam-path length');

  const [switchedOff] = buildPhysicsElements([
    { ...node, beamlineEnabled: false },
  ], { componentHealth: { 'q-health': 100 } });
  assert(switchedOff.type === 'drift' && Object.keys(switchedOff.stats).length === 0,
    'a switched-off downstream component is emitted as passive drift');

  const [failed] = buildPhysicsElements([node], {
    componentHealth: { 'q-health': 0 },
  });
  assert(failed.type === 'drift' && failed.subL === 2,
    'a zero-health downstream component remains continuous beam pipe');

  const sourceNode = {
    kind: 'module', id: 'source-health', type: 'source', subL: 4,
    params: { extractionVoltage: 50, cathodeTemperature: 1200 },
  };
  const [healthySource] = buildPhysicsElements([sourceNode], {
    componentHealth: { 'source-health': 100 },
  });
  const [damagedSource] = buildPhysicsElements([sourceNode], {
    componentHealth: { 'source-health': 50 },
  });
  assert(damagedSource.type === 'source'
      && Math.abs(damagedSource.stats.beamCurrent - healthySource.stats.beamCurrent * 0.5) < 1e-12,
  'a damaged-but-working source stays a source with reduced current');
  assert(damagedSource.stats.emittance > healthySource.stats.emittance,
    'source damage worsens emitted beam quality');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
