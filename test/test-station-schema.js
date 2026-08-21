// test/test-station-schema.js
//
// Tests for the station/seat schema on placeable defs (Task 3 of the
// staff-professions-2 nav-and-stations plan). Data only — station/seat.facing
// and station.anchors feed Task 6's StaffPawns.js pathing/pose logic;
// seat.seatY (fix-round-1 on Task 6) feeds its seated hip placement, see
// test-pawn-pathing.js for the world-Y math that consumes it. Verifies:
//   1. validateContent reports zero station/seat problems over real content.
//   2. Every def in the assignment table carries the expected jobs/slots.
//   3. Stackable benchtop instruments never carry a station (fix-round-1:
//      their def-local anchor resolves against the wrong footprint once
//      they're stacked on a bench/table/rack).
//   4. All geometry-driven anchor deviations (the defs whose "face a
//      person works from" isn't the brief's +Z/facing:'n' example) are
//      pinned to their exact coordinates, so a later edit can't silently
//      flip one back without a red test.
//   5. All eight chairs carry a seat facing exactly 'n' (their backrests are
//      all authored at local +Z), and (5b) the exact seatY read off each
//      chair's own 'seat' part.
//   6. No chair carries a station (chairs are matched by adjacency).
//   7. The job-id vocabulary itself is exactly the eleven ids from the
//      brief — distinct from "content only uses known ids" (validate.js
//      already enforces that; this locks the vocabulary's own contents).
//   8. Synthetic bad defs are rejected by validateContent, covering every
//      rule checkStation enforces (inside-footprint, bad job id, bad
//      seated, slots/anchors mismatch, bad facing, bad seat.facing, bad/
//      missing seat.seatY, station+seat mutual exclusion,
//      facing-away-from-object, duplicate anchors, anchor too far outside).

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

function hasProblem(problems, id, field, messagePart) {
  return problems.some(p =>
    p.id === id &&
    p.field === field &&
    (messagePart === undefined || p.message.includes(messagePart)));
}

const CHAIR_IDS = [
  'officeChair', 'ergonomicChair', 'executiveChair',
  'operatorChair', 'meetingChair', 'barStool', 'cafeteriaChair', 'labStool',
];

// seat.seatY per chair (subtiles — the same coordinate space as the def's
// own `parts[].y`), pinned to the exact value read off each chair's own
// 'seat' part in the facility furnishing registries. Not all chairs share a
// height (fix-round-1 on this task: StaffPawns.js used to lift every seated
// pawn by a fixed, style-only hip height, landing the hip at roughly TWICE
// hip height regardless of which chair — see test-pawn-pathing.js's seated
// hip world-Y test for the placement math this schema data feeds).
const CHAIR_SEAT_Y = {
  officeChair: 0.8, ergonomicChair: 0.8, executiveChair: 0.8,
  operatorChair: 0.82, meetingChair: 0.82, barStool: 1.15, cafeteriaChair: 0.82,
  labStool: 1.02,
};

// Assignment table from task-3-brief.md. Stackable benchtop instruments
// (oscilloscope, spectrumAnalyzer, networkAnalyzer, flowMeter, scopeStation)
// are deliberately absent — see Test 3.
const EXPECTED_STATIONS = {
  operatorConsole: { jobs: ['runBeam'], slots: 1 },
  monitorBank: { jobs: ['runBeam'], slots: 1 },
  desk: { jobs: ['analyze', 'paperwork'], slots: 1 },
  workstation: { jobs: ['analyze', 'paperwork'], slots: 1 },
  receptionDesk: { jobs: ['paperwork'], slots: 1 },
  conferenceTable: { jobs: ['meet'], slots: 6 },
  diningTable: { jobs: ['eat'], slots: 4 },
  cafeTable: { jobs: ['eat'], slots: 2 },
  breakfastBar: { jobs: ['eat'], slots: 3 },
  labBench: { jobs: ['labWork'], slots: 2 },
  labTable: { jobs: ['labWork'], slots: 2 },
  labComputerDesk: { jobs: ['labWork', 'analyze', 'paperwork'], slots: 1 },
  rfElectronicsBench: { jobs: ['labWork'], slots: 2 },
  coolingServiceBench: { jobs: ['labWork'], slots: 2 },
  vacuumAssemblyBench: { jobs: ['labWork'], slots: 2 },
  opticsAlignmentBench: { jobs: ['labWork', 'takeData'], slots: 2 },
  diagnosticsBench: { jobs: ['labWork', 'takeData'], slots: 2 },
  fabricationWorkbench: { jobs: ['fabricate'], slots: 2 },
  maintenanceWorkbench: { jobs: ['repair'], slots: 2 },
  rfTestRack: { jobs: ['labWork'], slots: 1 },
  waveguideWorkstand: { jobs: ['labWork'], slots: 1 },
  testChamber: { jobs: ['labWork'], slots: 1 },
  rga: { jobs: ['labWork'], slots: 1 },
  heatExchanger: { jobs: ['labWork'], slots: 1 },
  opticalTable: { jobs: ['labWork', 'takeData'], slots: 2 },
  daqRack: { jobs: ['takeData'], slots: 1 },
  lathe: { jobs: ['fabricate'], slots: 1 },
  millingMachine: { jobs: ['fabricate'], slots: 1 },
  cncMill: { jobs: ['fabricate'], slots: 1 },
  drillPress: { jobs: ['fabricate'], slots: 1 },
  toolChest: { jobs: ['rest'], slots: 1 },
  workCart: { jobs: ['rest'], slots: 1 },
};

// Stackable benchtop instruments: fix-round-1, finding 1. A stackable
// instrument's def-local anchor is only valid on bare floor; once stacked on
// a labBench/opticalTable/daqRack (the normal use case) it resolves against
// the wrong host footprint, so these must never carry a station.
const STACKABLE_NO_STATION_IDS = [
  'oscilloscope', 'spectrumAnalyzer', 'networkAnalyzer', 'flowMeter', 'scopeStation',
  'solderingStation', 'frequencyCounter', 'rfPowerMeter', 'rfDummyLoad', 'rfShieldBox',
  'ruggedLabLaptop', 'labLabelPrinter', 'sampleOrganizer',
  'pressureGaugeSet', 'thermalCamera', 'coolantSampleKit',
  'vacuumGaugeController', 'flangePartsTray', 'ionGaugeTube',
  'lensTray', 'alignmentCamera', 'fiberSpool',
  'logicAnalyzer', 'calibrationPulser', 'detectorModule',
  'benchVise', 'precisionScale', 'colletSet',
  'digitalMultimeter', 'powerToolCharger', 'portableToolCase',
];

// The defs whose anchor deviates from the brief's +Z/facing:'n' example
// because their part geometry puts the "face a person works from" somewhere
// else (see task-3-report.md for the per-def reasoning). Pinned exactly so a
// later edit can't silently flip one back to +Z without a red test.
const DEVIATING_ANCHORS = {
  desk: { subCol: 1, subRow: -1, facing: 's' },
  workstation: { subCol: 1, subRow: -1, facing: 's' },
  operatorConsole: { subCol: 1, subRow: -1, facing: 's' },
  monitorBank: { subCol: 1, subRow: -1, facing: 's' },
  daqRack: { subCol: 0, subRow: -1, facing: 's' },
  rfTestRack: { subCol: 0, subRow: -1, facing: 's' },
  toolChest: { subCol: 1, subRow: -1, facing: 's' },
  lathe: { subCol: -1, subRow: 1, facing: 'e' },
  millingMachine: { subCol: 0, subRow: -1, facing: 's' },
  drillPress: { subCol: 0, subRow: -1, facing: 's' },
  cncMill: { subCol: 1, subRow: -1, facing: 's' },
};

const EXPECTED_JOB_IDS = [
  'runBeam', 'repair', 'labWork', 'commission', 'takeData', 'analyze',
  'fabricate', 'paperwork', 'meet', 'eat', 'rest',
];

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
// Test 3: stackable benchtop instruments never carry a station.
// ==========================================================================
console.log('\n--- Test 3: stackable instruments have no station ---');
for (const id of STACKABLE_NO_STATION_IDS) {
  const p = PLACEABLES[id];
  assert(!!p, `${id}: placeable exists`);
  if (!p) continue;
  assert(p.stackable === true, `${id}: is stackable (sanity check on the fixture list itself)`);
  assert(p.station == null, `${id}: does not carry a station block`);
}

// ==========================================================================
// Test 4: geometry-driven anchor deviations are pinned exactly.
// ==========================================================================
console.log('\n--- Test 4: deviating anchor coordinates are pinned ---');
for (const [id, expected] of Object.entries(DEVIATING_ANCHORS)) {
  const p = PLACEABLES[id];
  assert(!!p && !!p.station, `${id}: has a station block`);
  if (!p || !p.station) continue;
  const a = (p.station.anchors || [])[0];
  assert(!!a, `${id}: has at least one anchor`);
  if (!a) continue;
  assert(a.subCol === expected.subCol && a.subRow === expected.subRow && a.facing === expected.facing,
    `${id}: anchor[0] is (${expected.subCol},${expected.subRow},'${expected.facing}') ` +
    `(got (${a.subCol},${a.subRow},'${a.facing}'))`);
}

// ==========================================================================
// Test 5: all chairs have seat.facing exactly 'n'.
// ==========================================================================
console.log("\n--- Test 5: chairs have seat.facing === 'n' ---");
for (const id of CHAIR_IDS) {
  const p = PLACEABLES[id];
  assert(!!p, `${id}: placeable exists`);
  if (!p) continue;
  assert(!!p.seat && p.seat.facing === 'n',
    `${id}: seat.facing is 'n' (got ${JSON.stringify(p.seat?.facing)})`);
}

// ==========================================================================
// Test 5b: chairs carry the exact seatY read off their own 'seat' part.
// ==========================================================================
console.log('\n--- Test 5b: chairs have the pinned seat.seatY ---');
for (const [id, expected] of Object.entries(CHAIR_SEAT_Y)) {
  const p = PLACEABLES[id];
  assert(!!p, `${id}: placeable exists`);
  if (!p) continue;
  assert(p.seat?.seatY === expected,
    `${id}: seat.seatY is ${expected} (got ${JSON.stringify(p.seat?.seatY)})`);
  const seatPart = (p.parts || []).find(part => part.name === 'seat');
  assert(!!seatPart && seatPart.y === expected,
    `${id}: seat.seatY matches the actual 'seat' part's own y (part y ${seatPart?.y})`);
}

// ==========================================================================
// Test 6: no chair carries a station — chairs are matched by adjacency.
// ==========================================================================
console.log('\n--- Test 6: chairs have no station ---');
for (const id of CHAIR_IDS) {
  const p = PLACEABLES[id];
  if (!p) continue;
  assert(p.station == null, `${id}: does not carry a station block`);
}

// ==========================================================================
// Test 7: the job-id vocabulary itself is exactly the brief's eleven ids.
// ==========================================================================
console.log('\n--- Test 7: JOB_IDS vocabulary is exactly the brief\'s eleven ---');
{
  const got = [...JOB_IDS].sort();
  const want = [...EXPECTED_JOB_IDS].sort();
  assert(got.length === want.length && got.every((v, i) => v === want[i]),
    `JOB_IDS === [${want.join(', ')}] (got [${got.join(', ')}])`);
}

// ==========================================================================
// Test 8: synthetic bad defs are rejected by validateContent.
// ==========================================================================
console.log('\n--- Test 8: synthetic bad station/seat defs are rejected ---');
{
  const badPlaceables = {
    insideFootprint: {
      kind: 'furnishing', subW: 2, subL: 2, subH: 1,
      station: { jobs: ['analyze'], slots: 1, seated: 'never',
        anchors: [{ subCol: 0, subRow: 0, facing: 'n' }] },
    },
    badJobId: {
      kind: 'furnishing', subW: 1, subL: 1, subH: 1,
      station: { jobs: ['doTheThing'], slots: 1, seated: 'never',
        anchors: [{ subCol: 0, subRow: 1, facing: 'n' }] },
    },
    badSeated: {
      kind: 'furnishing', subW: 1, subL: 1, subH: 1,
      station: { jobs: ['analyze'], slots: 1, seated: 'sometimes',
        anchors: [{ subCol: 0, subRow: 1, facing: 'n' }] },
    },
    slotsAnchorsMismatch: {
      kind: 'furnishing', subW: 1, subL: 1, subH: 1,
      station: { jobs: ['analyze'], slots: 2, seated: 'never',
        anchors: [{ subCol: 0, subRow: 1, facing: 'n' }] },
    },
    badAnchorFacing: {
      kind: 'furnishing', subW: 1, subL: 1, subH: 1,
      station: { jobs: ['analyze'], slots: 1, seated: 'never',
        anchors: [{ subCol: 0, subRow: 1, facing: 'up' }] },
    },
    badSeatFacing: {
      kind: 'furnishing', subW: 1, subL: 1, subH: 1,
      seat: { facing: 'sideways', seatY: 0.8 },
    },
    badSeatY: {
      kind: 'furnishing', subW: 1, subL: 1, subH: 1,
      seat: { facing: 'n', seatY: -0.5 },
    },
    missingSeatY: {
      kind: 'furnishing', subW: 1, subL: 1, subH: 1,
      seat: { facing: 'n' },
    },
    stationAndSeat: {
      kind: 'furnishing', subW: 1, subL: 1, subH: 1,
      station: { jobs: ['analyze'], slots: 1, seated: 'never',
        anchors: [{ subCol: 0, subRow: 1, facing: 'n' }] },
      seat: { facing: 'n' },
    },
    facingAwayFromObject: {
      // On the +Z edge (subRow === subL) but faces 's' — away from the
      // footprint instead of back into it.
      kind: 'furnishing', subW: 2, subL: 2, subH: 1,
      station: { jobs: ['analyze'], slots: 1, seated: 'never',
        anchors: [{ subCol: 0, subRow: 2, facing: 's' }] },
    },
    duplicateAnchors: {
      kind: 'furnishing', subW: 2, subL: 2, subH: 1,
      station: { jobs: ['analyze'], slots: 2, seated: 'never',
        anchors: [
          { subCol: 0, subRow: 2, facing: 'n' },
          { subCol: 0, subRow: 2, facing: 'n' },
        ] },
    },
    tooFarOutside: {
      // subL is 2, so subRow: 3 is two subtiles past the +Z edge, not one.
      kind: 'furnishing', subW: 2, subL: 2, subH: 1,
      station: { jobs: ['analyze'], slots: 1, seated: 'never',
        anchors: [{ subCol: 0, subRow: 3, facing: 'n' }] },
    },
  };

  const problems = validateContent({ placeables: badPlaceables });

  assert(hasProblem(problems, 'insideFootprint', 'station.anchors[0]', 'lies inside'),
    'anchor inside footprint is rejected');
  assert(hasProblem(problems, 'badJobId', 'station.jobs', "'doTheThing'"),
    'unknown job id is rejected');
  assert(hasProblem(problems, 'badSeated', 'station.seated'),
    "invalid seated value ('sometimes') is rejected");
  assert(hasProblem(problems, 'slotsAnchorsMismatch', 'station.anchors', 'must match station.slots'),
    'anchors.length/slots mismatch is rejected');
  assert(hasProblem(problems, 'badAnchorFacing', 'station.anchors[0].facing'),
    "invalid anchor facing ('up') is rejected");
  assert(hasProblem(problems, 'badSeatFacing', 'seat.facing'),
    "invalid seat.facing ('sideways') is rejected");
  assert(hasProblem(problems, 'badSeatY', 'seat.seatY'),
    'a negative seat.seatY is rejected');
  assert(hasProblem(problems, 'missingSeatY', 'seat.seatY'),
    'a missing seat.seatY is rejected');
  assert(hasProblem(problems, 'stationAndSeat', 'station', 'both station and seat'),
    'a def carrying both station and seat is rejected');
  assert(hasProblem(problems, 'facingAwayFromObject', 'station.anchors[0].facing', 'would look away'),
    'an anchor facing away from the footprint is rejected');
  assert(hasProblem(problems, 'duplicateAnchors', 'station.anchors[1]', 'duplicates'),
    'two anchors on the same subtile are rejected');
  assert(hasProblem(problems, 'tooFarOutside', 'station.anchors[0]', 'not immediately outside'),
    'an anchor more than one subtile outside the footprint is rejected');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
