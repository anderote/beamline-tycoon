// test/test-station-schema.js
//
// Tests for the station/seat schema on placeable defs (Task 3 of the
// staff-professions-2 nav-and-stations plan). Data only — nothing consumes
// station/seat yet. Verifies:
//   1. validateContent reports zero station/seat problems over real content.
//   2. Every def in the assignment table carries the expected jobs/slots.
//   3. All six chairs carry a seat with a cardinal facing.
//   4. No chair carries a station (chairs are matched by adjacency).
//   5. Every job id used anywhere in the data is in the closed vocabulary.

import { validateContent, JOB_IDS } from '../src/data/validate.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { BEAMLINE_COMPONENTS_RAW } from '../src/data/beamline-components.raw.js';
import { INFRASTRUCTURE_RAW } from '../src/data/infrastructure.raw.js';
import { FACILITY_ROOM_FURNISHINGS_RAW } from '../src/data/facility-room-furnishings.raw.js';
import { FACILITY_LAB_FURNISHINGS_RAW } from '../src/data/facility-lab-furnishings.raw.js';
import { DECORATIONS_RAW } from '../src/data/decorations.raw.js';
import { UTILITY_PORTS_V2_BY_ID } from '../src/data/utility-ports-v2.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const CHAIR_IDS = [
  'officeChair', 'ergonomicChair', 'executiveChair',
  'operatorChair', 'meetingChair', 'cafeteriaChair',
];

// Assignment table from task-3-brief.md.
const EXPECTED_STATIONS = {
  operatorConsole: { jobs: ['runBeam'], slots: 1 },
  monitorBank: { jobs: ['runBeam'], slots: 1 },
  desk: { jobs: ['analyze', 'paperwork'], slots: 1 },
  workstation: { jobs: ['analyze', 'paperwork'], slots: 1 },
  receptionDesk: { jobs: ['paperwork'], slots: 1 },
  conferenceTable: { jobs: ['meet'], slots: 6 },
  diningTable: { jobs: ['eat'], slots: 4 },
  labBench: { jobs: ['labWork'], slots: 2 },
  oscilloscope: { jobs: ['labWork'], slots: 1 },
  networkAnalyzer: { jobs: ['labWork'], slots: 1 },
  spectrumAnalyzer: { jobs: ['labWork'], slots: 1 },
  testChamber: { jobs: ['labWork'], slots: 1 },
  rga: { jobs: ['labWork'], slots: 1 },
  heatExchanger: { jobs: ['labWork'], slots: 1 },
  flowMeter: { jobs: ['labWork'], slots: 1 },
  opticalTable: { jobs: ['labWork', 'takeData'], slots: 2 },
  scopeStation: { jobs: ['takeData'], slots: 1 },
  daqRack: { jobs: ['takeData'], slots: 1 },
  lathe: { jobs: ['fabricate'], slots: 1 },
  millingMachine: { jobs: ['fabricate'], slots: 1 },
  cncMill: { jobs: ['fabricate'], slots: 1 },
  drillPress: { jobs: ['fabricate'], slots: 1 },
  toolChest: { jobs: ['rest'], slots: 1 },
  workCart: { jobs: ['rest'], slots: 1 },
};

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every(x => sa.has(x));
}

// ==========================================================================
// Test 1: validateContent reports zero problems over real content.
// ==========================================================================
console.log('\n--- Test 1: real content passes station/seat validation ---');
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
  const stationProblems = problems.filter(p =>
    p.field === 'station' || p.field.startsWith('station.') || p.field.startsWith('seat'));
  for (const p of stationProblems) console.log(`    - [${p.id}] ${p.field}: ${p.message}`);
  assert(stationProblems.length === 0, `zero station/seat problems (got ${stationProblems.length})`);
}

// ==========================================================================
// Test 2: assignment table — every def has the expected jobs/slots station.
// ==========================================================================
console.log('\n--- Test 2: assignment table jobs/slots ---');
for (const [id, expected] of Object.entries(EXPECTED_STATIONS)) {
  const p = PLACEABLES[id];
  assert(!!p, `${id}: placeable exists`);
  if (!p) continue;
  assert(!!p.station, `${id}: has a station block`);
  if (!p.station) continue;
  assert(sameSet(p.station.jobs, expected.jobs),
    `${id}: station.jobs is [${expected.jobs.join(', ')}] (got [${(p.station.jobs || []).join(', ')}])`);
  assert(p.station.slots === expected.slots,
    `${id}: station.slots is ${expected.slots} (got ${p.station.slots})`);
  assert(Array.isArray(p.station.anchors) && p.station.anchors.length === p.station.slots,
    `${id}: station.anchors.length matches slots`);
}

// ==========================================================================
// Test 3: all six chairs have a seat with a cardinal facing.
// ==========================================================================
console.log('\n--- Test 3: chairs have seat.facing ---');
const CARDINALS = new Set(['n', 'e', 's', 'w']);
for (const id of CHAIR_IDS) {
  const p = PLACEABLES[id];
  assert(!!p, `${id}: placeable exists`);
  if (!p) continue;
  assert(!!p.seat && CARDINALS.has(p.seat.facing), `${id}: seat.facing is a cardinal (got ${JSON.stringify(p.seat?.facing)})`);
}

// ==========================================================================
// Test 4: no chair carries a station — chairs are matched by adjacency.
// ==========================================================================
console.log('\n--- Test 4: chairs have no station ---');
for (const id of CHAIR_IDS) {
  const p = PLACEABLES[id];
  if (!p) continue;
  assert(p.station == null, `${id}: does not carry a station block`);
}

// ==========================================================================
// Test 5: every job id used anywhere in the data is in the vocabulary.
// ==========================================================================
console.log('\n--- Test 5: job id vocabulary closure ---');
{
  let allKnown = true;
  const unknown = new Set();
  for (const p of Object.values(PLACEABLES)) {
    if (!p.station) continue;
    for (const j of p.station.jobs || []) {
      if (!JOB_IDS.has(j)) { allKnown = false; unknown.add(j); }
    }
  }
  assert(allKnown, `every job id used in the data is in JOB_IDS (unknown: [${[...unknown].join(', ')}])`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
