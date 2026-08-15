// test/test-content-validate.js
//
// Tests for src/data/validate.js — the content validator that gates the
// registries at load (src/data/components.js throws on problems in dev/node).
//
//   1. The real content passes with zero problems.
//   2. Synthetic bad defs produce the expected problems (missing physicsType,
//      dangling utility-port ref, unknown kind, unknown category, numeric
//      cost, routing to an undeclared port, missing sink port).
//   3. The JS KNOWN_PHYSICS_TYPES mirror matches beam_physics/gameplay.py.
//   4. roleBuilderFallbacks reports uncovered beamline ids.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validateContent, roleBuilderFallbacks, KNOWN_PHYSICS_TYPES } from '../src/data/validate.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { BEAMLINE_COMPONENTS_RAW } from '../src/data/beamline-components.raw.js';
import { INFRASTRUCTURE_RAW } from '../src/data/infrastructure.raw.js';
import { FACILITY_ROOM_FURNISHINGS_RAW } from '../src/data/facility-room-furnishings.raw.js';
import { FACILITY_LAB_FURNISHINGS_RAW } from '../src/data/facility-lab-furnishings.raw.js';
import { DECORATIONS_RAW } from '../src/data/decorations.raw.js';
import { UTILITY_PORTS_V2_BY_ID } from '../src/data/utility-ports-v2.js';
import { MODES, INFRA_DISTRIBUTION } from '../src/data/modes.js';
import { UTILITY_TYPE_LIST } from '../src/utility/registry.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function hasProblem(problems, id, field, messagePart) {
  return problems.some(p =>
    p.id === id &&
    p.field === field &&
    (messagePart === undefined || p.message.includes(messagePart)));
}

// ==========================================================================
// Test 1: real content validates clean.
// ==========================================================================
console.log('\n--- Test 1: real content passes with zero problems ---');
{
  const problems = validateContent({
    placeables: PLACEABLES,
    rawRegistries: {
      beamline: BEAMLINE_COMPONENTS_RAW,
      infrastructure: INFRASTRUCTURE_RAW,
      roomFurnishings: FACILITY_ROOM_FURNISHINGS_RAW,
      labFurnishings: FACILITY_LAB_FURNISHINGS_RAW,
      decorations: DECORATIONS_RAW,
    },
    utilityPorts: UTILITY_PORTS_V2_BY_ID,
  });
  for (const p of problems) console.log(`    - [${p.id}] ${p.field}: ${p.message}`);
  assert(problems.length === 0, `real content has zero problems (got ${problems.length})`);
}

// ==========================================================================
// Test 2: components.js (the wired gate) loads without throwing.
// ==========================================================================
console.log('\n--- Test 2: components.js gate passes on real content ---');
{
  let ok = true;
  try {
    await import('../src/data/components.js');
  } catch (e) {
    ok = false;
    console.log('    threw:', e.message.split('\n')[0]);
  }
  assert(ok, 'importing components.js does not throw');
}

// ==========================================================================
// Test 3: synthetic bad defs produce the expected problems.
// ==========================================================================
console.log('\n--- Test 3: synthetic bad defs are rejected ---');
{
  const badBeamline = {
    // Missing physicsType + role + ports; category not a palette tab.
    mysteryModule: {
      id: 'mysteryModule', name: 'Mystery Module', category: 'magnet',
      cost: { funding: 1000 }, subW: 2, subL: 2, subH: 2,
      placement: 'module',
      requiredConnections: ['powerCable'],
    },
    // Unknown physicsType; routing references an undeclared port.
    badRouter: {
      id: 'badRouter', name: 'Bad Router', category: 'optics',
      physicsType: 'warpDrive',
      cost: { funding: 1 }, subW: 2, subL: 2, subH: 2,
      placement: 'module', role: 'junction',
      ports: { entry: { side: 'back' } },
      routing: [{ from: 'entry', to: 'exit' }],
      requiredConnections: [],
    },
  };
  // Same rule applies to infrastructure: the cross-check used to run only in
  // the beamline loop, so 42 infra entries declared connections that no sink
  // port backed — they contributed zero demand to every utility network.
  const badInfrastructure = {
    hungryBox: {
      id: 'hungryBox', name: 'Hungry Box', category: 'power',
      cost: { funding: 100 }, subW: 2, subL: 2, subH: 2,
      placement: 'module',
      requiredConnections: ['powerCable'],
    },
  };
  const badDecorations = {
    freebie: {
      id: 'freebie', name: 'Freebie', category: 'notATab',
      cost: 5, subW: 1, subL: 1, subH: 1, // numeric cost = silently free
    },
  };
  const badPlaceables = {
    ghost: { id: 'ghost', kind: 'poltergeist', subW: 1, subL: 1, subH: 1 },
    // Light-bearing def with no mount, and a non-positive energyCost.
    darkFixture: {
      id: 'darkFixture', kind: 'decoration', category: 'lighting',
      subW: 1, subL: 1, subH: 1, cost: { funding: 1 },
      energyCost: 0,
      light: { color: '#fff', intensity: 1, radius: 3, shape: 'point', emitterY: 1 },
    },
  };
  const badPorts = {
    // Dangling ref: no such component in any registry.
    phantomComponent: {
      pwr_in: { utility: 'powerCable', side: 'left', offsetAlong: 0.5, role: 'sink' },
    },
    // Bad spec shapes on a real-ish id.
    mysteryModule: {
      weird: { utility: 'steamPipe', side: 'top', offsetAlong: 7, role: 'both' },
    },
  };

  const problems = validateContent({
    placeables: badPlaceables,
    rawRegistries: {
      beamline: badBeamline,
      infrastructure: badInfrastructure,
      decorations: badDecorations,
    },
    utilityPorts: badPorts,
  });

  assert(hasProblem(problems, 'mysteryModule', 'physicsType', 'missing physicsType'),
    'missing physicsType reported');
  assert(hasProblem(problems, 'mysteryModule', 'role'),
    'missing module role reported');
  assert(hasProblem(problems, 'mysteryModule', 'ports'),
    'missing beam ports reported');
  assert(hasProblem(problems, 'mysteryModule', 'category', "'magnet'"),
    "non-palette category 'magnet' reported");
  assert(hasProblem(problems, 'badRouter', 'physicsType', "'warpDrive'"),
    'unknown physicsType reported');
  assert(hasProblem(problems, 'badRouter', 'routing[0].to', "'exit'"),
    'routing to undeclared port reported');
  assert(hasProblem(problems, 'freebie', 'cost'),
    'numeric decoration cost reported');
  assert(hasProblem(problems, 'freebie', 'category', "'notATab'"),
    'unknown decoration category reported');
  assert(hasProblem(problems, 'ghost', 'kind', "'poltergeist'"),
    'unknown kind reported');
  assert(hasProblem(problems, 'darkFixture', 'mount'),
    'light-bearing def with no mount reported');
  assert(hasProblem(problems, 'darkFixture', 'energyCost'),
    'light-bearing def with energyCost 0 reported');
  assert(hasProblem(problems, 'phantomComponent', 'utilityPorts'),
    'dangling utility-port ref reported');
  assert(hasProblem(problems, 'mysteryModule', 'utilityPorts.weird', "'steamPipe'"),
    'unknown port utility reported');
  assert(hasProblem(problems, 'mysteryModule', 'utilityPorts.weird', "role 'both'"),
    'invalid port role reported');
  assert(hasProblem(problems, 'mysteryModule', 'utilityPorts.weird', 'offsetAlong'),
    'out-of-range offsetAlong reported');
  // mysteryModule requires powerCable but its only port spec is invalid →
  // no powerCable sink.
  assert(hasProblem(problems, 'mysteryModule', 'requiredConnections', "'powerCable'"),
    'requiredConnections without matching sink port reported');
  assert(hasProblem(problems, 'hungryBox', 'requiredConnections', "'powerCable'"),
    'the sink-port rule also covers infrastructure entries');
}

// ==========================================================================
// Test 4: KNOWN_PHYSICS_TYPES mirror matches beam_physics/gameplay.py.
// ==========================================================================
console.log('\n--- Test 4: KNOWN_PHYSICS_TYPES sync with gameplay.py ---');
{
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const py = readFileSync(path.join(root, 'beam_physics', 'gameplay.py'), 'utf8');
  const m = py.match(/KNOWN_PHYSICS_TYPES\s*=\s*\{([\s\S]*?)\}/);
  assert(!!m, 'found KNOWN_PHYSICS_TYPES in gameplay.py');
  if (m) {
    const pyTypes = new Set([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
    const jsTypes = new Set(KNOWN_PHYSICS_TYPES);
    const onlyPy = [...pyTypes].filter(t => !jsTypes.has(t));
    const onlyJs = [...jsTypes].filter(t => !pyTypes.has(t));
    assert(onlyPy.length === 0 && onlyJs.length === 0,
      `JS mirror matches python set (py-only: [${onlyPy}], js-only: [${onlyJs}])`);
  }
}

// ==========================================================================
// Test 5: roleBuilderFallbacks lists uncovered ids.
// ==========================================================================
console.log('\n--- Test 5: roleBuilderFallbacks coverage helper ---');
{
  const raw = { a: {}, b: {}, c: {} };
  const out = roleBuilderFallbacks(raw, ['b']);
  assert(out.length === 2 && out.includes('a') && out.includes('c') && !out.includes('b'),
    'uncovered ids listed, covered ids excluded');
}

// ==========================================================================
// Test 6: every utility the player can draw has a tool in the palette.
// ==========================================================================
//
// Defect this pins: hvCable shipped complete — descriptor, solver, port tables
// on every transformer and panel, network panel row — and no way to draw it,
// because the palette reads MODES.infra.categories[cat].utilityLineTools and
// nothing had added it there. A utility that exists everywhere except the one
// list that puts a tool in the player's hand is invisible in exactly the way
// that is hardest to notice from the code.
console.log('\n--- Test 6: every utility type is reachable from the palette ---');
{
  const armable = new Set();
  for (const def of Object.values(MODES.infra.categories)) {
    for (const t of (def.utilityLineTools || [])) armable.add(t);
  }
  const missing = UTILITY_TYPE_LIST.filter(t => !armable.has(t));
  assert(missing.length === 0,
    `every utility has a palette tool (unreachable: ${missing.join(',') || 'none'})`);

  const unknown = [...armable].filter(t => !UTILITY_TYPE_LIST.includes(t));
  assert(unknown.length === 0,
    `and every palette tool is a real utility (unknown: ${unknown.join(',') || 'none'})`);

  // The fallback map is derived from the same source, so it cannot drift.
  for (const [cat, def] of Object.entries(MODES.infra.categories)) {
    if (!def.utilityLineTools) continue;
    assert(JSON.stringify(INFRA_DISTRIBUTION[cat]) === JSON.stringify(def.utilityLineTools),
      `${cat}: INFRA_DISTRIBUTION matches the category's own tool list`);
  }

  assert(JSON.stringify(MODES.infra.categories.power.utilityLineTools)
      === JSON.stringify(['powerCable', 'hvCable']),
  'Power transport lists the everyday Power Cable before the HV Feeder');

  assert(JSON.stringify(MODES.infra.categories.rfPower.utilityLineTools)
      === JSON.stringify(['rfWaveguide', 'hvCable']),
  'RF Power transport lists Waveguide beside the HV Feeder it also uses');

  assert(Object.keys(MODES.infra.categories).slice(0, 3).join(',')
      === 'power,rfPower,vacuum',
  'Infra puts RF Power immediately beside Power');

  assert(Object.keys(MODES.beamline.categories).slice(0, 3).join(',')
      === 'source,rf,optics',
  'Beamline puts RF / Accel immediately beside Sources');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
