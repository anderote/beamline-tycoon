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
      betaAcceptance: { min: 0.5, design: 0.4, max: 1, tracksBeam: 'yes' },
      requiredConnections: [],
    },
    badInlineKind: {
      id: 'badInlineKind', name: 'Bad Inline Kind', category: 'diagnostic',
      subsection: 'monitors', physicsType: 'drift',
      cost: { funding: 1 }, subW: 1, subL: 1, subH: 1,
      placement: 'attachment', role: 'placement', attachmentKind: 'huge',
      requiredConnections: [],
    },
    misplacedInline: {
      id: 'misplacedInline', name: 'Misplaced Inline', category: 'diagnostic',
      subsection: 'monitors', physicsType: 'drift',
      cost: { funding: 1 }, subW: 1, subL: 1, subH: 1,
      placement: 'module', role: 'junction', attachmentKind: 'inline',
      ports: { entry: { side: 'back' } }, requiredConnections: [],
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
    badAutoUtility: {
      id: 'badAutoUtility', name: 'Bad Auto Utility', category: 'power',
      cost: { funding: 100 }, subW: 1, subL: 1, subH: 1,
      placement: 'module', requiredConnections: [],
      autoConnectRadius: 5, autoConnectUtility: 'steamPipe',
    },
    portlessAutoPanel: {
      id: 'portlessAutoPanel', name: 'Portless Auto Panel', category: 'power',
      cost: { funding: 100 }, subW: 1, subL: 1, subH: 1,
      placement: 'module', requiredConnections: [],
      autoConnectRadius: 5,
    },
    badFeedthrough: {
      id: 'badFeedthrough', name: 'Bad Feedthrough', category: 'power',
      cost: { funding: 100 }, subW: 1, subL: 1, subH: 1,
      placement: 'module', requiredConnections: [],
      mount: 'floor', wallPassThrough: true,
    },
    badDisconnect: {
      id: 'badDisconnect', name: 'Bad Disconnect', category: 'power',
      cost: { funding: 100 }, subW: 1, subL: 1, subH: 1,
      placement: 'module', requiredConnections: [],
      electricalControl: {
        kind: 'disconnect',
        breaker: { utility: 'steamPipe', rating: 0, tripDelayTicks: 0 },
      },
    },
    badCableCarrier: {
      id: 'badCableCarrier', name: 'Bad Cable Carrier', category: 'power',
      cost: { funding: 100 }, subW: 1, subL: 1, subH: 1,
      placement: 'module', requiredConnections: [],
      electricalGroups: { powerCable: [['in', 'missing'], ['in', 'out']] },
    },
    badEdgeService: {
      id: 'badEdgeService', name: 'Bad Edge Service', category: 'power',
      cost: { funding: 100 }, subW: 1, subL: 1, subH: 1,
      placement: 'module', requiredConnections: [],
      mapEdgeConnection: {
        maxDistanceTiles: 0,
        conductorCount: 9,
        leadHeightMeters: NaN,
        conductorSpacingMeters: 0,
        conductorRadiusMeters: -1,
        sagMeters: 'low',
      },
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
      light: { color: '#fff', intensity: 1, radius: 3, shape: 'point', emitterY: 1, dayFloor: 2 },
    },
    badHanging: {
      id: 'badHanging', kind: 'decoration', category: 'hangings', mount: 'wall',
      wallSpan: 5, subW: 1, subL: 1, subH: 1, cost: { funding: 1 },
    },
    malformedPrimitive: {
      id: 'malformedPrimitive', kind: 'equipment',
      subW: 1, subL: 1, subH: 1,
      parts: [{
        name: 'badPrimitive', shape: 'banana', w: 0, h: 1, l: 1,
        axis: 'diagonal', rotation: [0, 1], topScale: 2,
      }],
    },
    badSelectionOwner: {
      id: 'badSelectionOwner', name: 'Bad selection owner', cost: { funding: 1 },
      kind: 'equipment', category: 'diagnostics', subW: 1, subL: 1, subH: 1,
      selectionCategory: 'powerStuff',
    },
  };
  const badPorts = {
    // Dangling ref: no such component in any registry.
    phantomComponent: {
      pwr_in: { utility: 'powerCable', side: 'left', offsetAlong: 0.5, role: 'sink' },
    },
    // Bad spec shapes on a real-ish id.
    mysteryModule: {
      weird: { utility: 'steamPipe', side: 'top', offsetAlong: 7, role: 'both', maxConnections: 0 },
    },
    badFeedthrough: {
      only: { utility: 'powerCable', side: 'front', offsetAlong: 0.5, role: 'sink' },
    },
    badDisconnect: {
      only: { utility: 'hvCable', side: 'front', offsetAlong: 0.5, role: 'pass' },
    },
    badCableCarrier: {
      in: { utility: 'powerCable', side: 'back', offsetAlong: 0.5, role: 'pass' },
      out: { utility: 'powerCable', side: 'front', offsetAlong: 0.5, role: 'pass' },
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
  assert(hasProblem(problems, 'badInlineKind', 'attachmentKind', 'unknown'),
    'unknown attachmentKind reported');
  assert(hasProblem(problems, 'misplacedInline', 'attachmentKind', 'requires'),
    'inline kind requires an on-pipe attachment role');
  assert(hasProblem(problems, 'badSelectionOwner', 'selectionCategory', "'powerStuff'"),
    'unknown player-facing selection ownership reported');
  assert(hasProblem(problems, 'badRouter', 'betaAcceptance', 'min <= design <= max'),
    'misordered beta acceptance window reported');
  assert(hasProblem(problems, 'badRouter', 'betaAcceptance.tracksBeam', 'boolean'),
    'non-boolean beta tracking flag reported');
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
  assert(hasProblem(problems, 'badHanging', 'wallSpan', '1 to 4'),
    'wall hanging span outside the quarter-wall range reported');
  assert(hasProblem(problems, 'badHanging', 'mountY', 'positive'),
    'non-light wall hanging without a mounting height reported');
  assert(hasProblem(problems, 'darkFixture', 'subsection', 'missing subsection'),
    'light-bearing def in a grouped palette requires an authored subsection');
  assert(hasProblem(problems, 'darkFixture', 'light.dayFloor', '[0, 1]'),
    'out-of-range daytime fixture activation is rejected');
  assert(hasProblem(problems, 'malformedPrimitive', 'parts[0].shape', "'banana'"),
    'unknown authored primitive shape reported');
  assert(hasProblem(problems, 'malformedPrimitive', 'parts[0].w', 'positive number'),
    'non-positive primitive dimensions reported');
  assert(hasProblem(problems, 'malformedPrimitive', 'parts[0].axis', 'x, y, z'),
    'unknown primitive axis reported');
  assert(hasProblem(problems, 'malformedPrimitive', 'parts[0].rotation', 'three finite radians'),
    'malformed primitive rotation reported');
  assert(hasProblem(problems, 'malformedPrimitive', 'parts[0].topScale', 'only valid on cones'),
    'invalid primitive top scale reported');
  assert(hasProblem(problems, 'phantomComponent', 'utilityPorts'),
    'dangling utility-port ref reported');
  assert(hasProblem(problems, 'mysteryModule', 'utilityPorts.weird', "'steamPipe'"),
    'unknown port utility reported');
  assert(hasProblem(problems, 'mysteryModule', 'utilityPorts.weird', "role 'both'"),
    'invalid port role reported');
  assert(hasProblem(problems, 'mysteryModule', 'utilityPorts.weird', 'offsetAlong'),
    'out-of-range offsetAlong reported');
  assert(hasProblem(problems, 'mysteryModule', 'utilityPorts.weird', 'maxConnections'),
    'non-positive connection capacity reported');
  // mysteryModule requires powerCable but its only port spec is invalid →
  // no powerCable sink.
  assert(hasProblem(problems, 'mysteryModule', 'requiredConnections', "'powerCable'"),
    'requiredConnections without matching sink port reported');
  assert(hasProblem(problems, 'hungryBox', 'requiredConnections', "'powerCable'"),
    'the sink-port rule also covers infrastructure entries');
  assert(hasProblem(problems, 'badAutoUtility', 'autoConnectUtility', "'steamPipe'"),
    'an unknown assisted-wiring utility is rejected');
  assert(hasProblem(problems, 'portlessAutoPanel', 'autoConnectUtility', 'source port'),
    'assisted wiring requires a real source port of its selected utility');
  assert(hasProblem(problems, 'badFeedthrough', 'wallPassThrough', "mount: 'wall'"),
    'wall pass-throughs must use the wall placement layer');
  assert(hasProblem(problems, 'badFeedthrough', 'wallPassThrough', 'matching passive'),
    'wall pass-throughs require two passive ports on opposite faces');
  assert(hasProblem(problems, 'badDisconnect', 'electricalControl.breaker.utility'),
    'electrical breakers reject non-electrical utility types');
  assert(hasProblem(problems, 'badDisconnect', 'electricalControl.breaker.rating'),
    'electrical breakers require a positive rating');
  assert(hasProblem(problems, 'badDisconnect', 'electricalControl.kind', 'exactly two'),
    'disconnects require one real two-terminal conductor');
  assert(hasProblem(problems, 'badCableCarrier', 'electricalGroups.powerCable[0]', "'missing'"),
    'carrier groups may reference only real passive ports');
  assert(hasProblem(problems, 'badCableCarrier', 'electricalGroups.powerCable[1]', 'more than one'),
    'one port cannot belong to two isolated conductor groups');
  assert(hasProblem(problems, 'badEdgeService', 'mapEdgeConnection.maxDistanceTiles', 'positive integer'),
    'map-edge services require a positive placement distance');
  assert(hasProblem(problems, 'badEdgeService', 'mapEdgeConnection.conductorCount', '1 to 6'),
    'map-edge services bound their conductor count');
  assert(hasProblem(problems, 'badEdgeService', 'mapEdgeConnection.leadHeightMeters', 'positive finite'),
    'map-edge service lead dimensions must be finite and positive');
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

  assert(Object.keys(MODES.infra.categories.power.subsections).join(',')
      === 'transport,gridSupply,transformers,overhead,routingHardware,distribution,fieldDistribution,specialty',
  'Power follows transport, supply, transformation, overhead routing, wall entry, and distribution');

  assert(JSON.stringify(MODES.infra.categories.rfPower.utilityLineTools)
      === JSON.stringify(['rfWaveguide', 'hvCable']),
  'RF Power transport lists Waveguide beside the HV Feeder it also uses');

  assert(Object.keys(MODES.infra.categories).slice(0, 3).join(',')
      === 'power,rfPower,vacuum',
  'Infra puts RF Power immediately beside Power');

  assert(Object.keys(MODES.beamline.categories).slice(0, 3).join(',')
      === 'source,rf,optics',
  'Beamline puts RF / Accel immediately beside Sources');

  assert(BEAMLINE_COMPONENTS_RAW.dcInjector.category === 'rf'
      && BEAMLINE_COMPONENTS_RAW.dcInjector.subsection === 'normalConducting',
  'High-Voltage DC Injector appears in RF / Accel → Normal Conducting');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
