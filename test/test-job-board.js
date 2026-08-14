// test/test-job-board.js — the job board (src/game/staff/jobs.js).
//
// Task 1 of the staff-professions-3 (jobs-and-gates) plan. Builds small
// hand-made states (plain objects shaped like Game.state) and a minimal
// fake `game` ({ state, registry: { getAll() } }) rather than routing
// through the real Game/BeamlineRegistry classes, matching
// test-staff-stations.js's pattern.

import { JOB_TYPES, buildJobOffers, eligibleFor } from '../src/game/staff/jobs.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeState() {
  return {
    infraOccupied: {},
    wallOccupied: {},
    doorOccupied: {},
    subgridOccupied: {},
    placeableIndex: {},
    placeables: [],
    zoneOccupied: {},
    stationReservations: {},
    staffMembers: [],
    resources: { funding: 0, reputation: 0, data: 0, spares: 5 },
    navRevision: 0,
  };
}

function floorRect(state, minCol, maxCol, minRow, maxRow, type = 'concrete') {
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) {
      state.infraOccupied[`${c},${r}`] = type;
    }
  }
}

function wall(state, col, row, edge) { state.wallOccupied[`${col},${row},${edge}`] = 'officeWall'; }

let _nextId = 1;
function placeItem(state, type, col, row, subCol = 0, subRow = 0, dir = 0) {
  const def = PLACEABLES[type];
  const id = `${type}_${_nextId++}`;
  const cells = def.footprintCells(col, row, subCol, subRow, dir);
  const entry = { id, type, kind: def.kind, col, row, subCol, subRow, dir, cells };
  state.placeableIndex[id] = state.placeables.length;
  state.placeables.push(entry);
  for (const c of cells) {
    state.subgridOccupied[`${c.col},${c.row},${c.subCol},${c.subRow}`] = { id, kind: def.kind };
  }
  return entry;
}

function bump(state) { state.navRevision = (state.navRevision | 0) + 1; }

// Sealed 2x3-chamber shape reused from test-staff-stations.js's scenario 9:
// two columns walled on every side but the bisecting interior wall, whose
// only opening is a door at (1,1,'e'). Anything placed at (0,1) is reachable
// only through that door; the open cols 2-4 sit outside the walled area
// entirely and merge trivially with "outdoors".
function sealChamber(state) {
  floorRect(state, 0, 4, 0, 2);
  wall(state, 0, 0, 'n'); wall(state, 1, 0, 'n');
  wall(state, 0, 2, 's'); wall(state, 1, 2, 's');
  wall(state, 0, 0, 'w'); wall(state, 0, 1, 'w'); wall(state, 0, 2, 'w');
  wall(state, 1, 0, 'e'); wall(state, 1, 1, 'e'); wall(state, 1, 2, 'e'); // the bisecting wall
}

function makeGame(state, beamlines = []) {
  return { state, registry: { getAll: () => beamlines } };
}

console.log('\n=== 0. JOB_TYPES is exactly the eleven closed ids ===\n');
{
  const expected = ['runBeam', 'repair', 'labWork', 'commission', 'takeData', 'analyze', 'fabricate', 'paperwork', 'meet', 'eat', 'rest'];
  const actual = Object.keys(JOB_TYPES);
  assertOk(expected.every(id => actual.includes(id)) && actual.length === expected.length,
    `JOB_TYPES has exactly the eleven job ids (got ${actual.sort().join(',')})`);
}

console.log('\n=== 1. runBeam: one offer per beamline, zero with no beamline ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);

  let offers = buildJobOffers(makeGame(state, []));
  assertOk(offers.filter(o => o.jobType === 'runBeam').length === 0, 'no beamline -> zero runBeam offers even with a free console');

  offers = buildJobOffers(makeGame(state, [{ id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } }]));
  const runOffers = offers.filter(o => o.jobType === 'runBeam');
  assertOk(runOffers.length === 1, `exactly one runBeam offer with one beamline and one console (got ${runOffers.length})`);
  assertOk(runOffers[0].target === null, 'runBeam offer target is null (station-only job)');
  assertOk(typeof runOffers[0].stationKey === 'string', 'runBeam offer carries a stationKey');
}

console.log('\n=== 2. repair: priority rises as health falls ===\n');
{
  function repairOfferAt(health) {
    const state = makeState();
    floorRect(state, 0, 10, 0, 10);
    state.placeables.push({ id: 'comp1', type: 'testComponent', col: 5, row: 5, subCol: 0, subRow: 0 });
    const game = makeGame(state, [{ id: 'bl-1', sourceId: 'comp1', beamState: { componentHealth: { comp1: health } } }]);
    return buildJobOffers(game).find(o => o.jobType === 'repair');
  }

  const mild = repairOfferAt(90);
  const severe = repairOfferAt(10);
  assertOk(!!mild && !!severe, 'a damaged node (health < 100) produces a repair offer');
  assertOk(mild.target.beamlineId === 'bl-1' && mild.target.nodeId === 'comp1', 'repair target carries both beamlineId and nodeId');
  assertOk(mild.stationKey === null, 'repair has no station (target-addressed, not a StationRef)');
  assertOk(severe.priority > mild.priority, `lower health -> higher priority (mild=${mild.priority}, severe=${severe.priority})`);

  const healthy = repairOfferAt(100);
  assertOk(healthy === undefined, 'a node at full health produces no repair offer');
}

console.log('\n=== 3. repair: spares === 0 -> offer absent (reason: no spares to fix it with) ===\n');
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  state.placeables.push({ id: 'comp1', type: 'testComponent', col: 5, row: 5, subCol: 0, subRow: 0 });
  state.resources.spares = 0;
  const game = makeGame(state, [{ id: 'bl-1', sourceId: 'comp1', beamState: { componentHealth: { comp1: 40 } } }]);

  let offers = buildJobOffers(game);
  assertOk(!offers.some(o => o.jobType === 'repair'), 'spares === 0: repair offer is absent (reason: no spares available)');

  state.resources.spares = 5;
  offers = buildJobOffers(game);
  assertOk(offers.some(o => o.jobType === 'repair'), 'spares > 0: the same damaged node is offered again');
}

console.log('\n=== 4. eligibleFor: a walled-off console is ineligible (unreachable), reachable once a door opens ===\n');
{
  const state = makeState();
  sealChamber(state);
  placeItem(state, 'operatorConsole', 0, 1, 0, 0, 0);
  const from = { col: 4, row: 1, subCol: 3, subRow: 3 };
  const game = makeGame(state, [{ id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } }]);

  const offers = buildJobOffers(game);
  const offer = offers.find(o => o.jobType === 'runBeam');
  assertOk(!!offer, 'sanity: buildJobOffers still offers the walled-off console (reachability is eligibleFor\'s job, not the board\'s)');

  const operator = { id: 'op1', profession: 'operator', specialty: null, skills: { operating: 5 }, fromNode: from };
  let res = eligibleFor(operator, offer, game);
  assertOk(res.ok === false, 'no door -> the operator is not eligible for the walled-off console');
  assertOk(!!res.reason && res.reason.length > 0, 'the rejection carries a non-empty reason');
  assertOk(/reach/i.test(res.reason), `the reason mentions reachability (got "${res.reason}")`);

  state.doorOccupied['1,1,e'] = 'officeDoor';
  bump(state);
  res = eligibleFor(operator, offer, game);
  assertOk(res.ok === true, 'a door in the bisecting wall makes the operator eligible');
  assertOk(res.reason === null, 'an eligible result carries no rejection reason');
}

console.log('\n=== 5. eligibleFor: RF labWork — eligible for RF engineer, eligible (reduced) for vacuum engineer, rejected for operator ===\n');
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const bench = placeItem(state, 'labBench', 5, 5, 0, 0, 0);
  state.zoneOccupied[`${bench.col},${bench.row}`] = 'rfLab';
  bump(state);
  const game = makeGame(state, []);

  const offers = buildJobOffers(game);
  const offer = offers.find(o => o.jobType === 'labWork');
  assertOk(!!offer, 'the RF-zoned bench produces a labWork offer');
  assertOk(offer.specialty === 'rf', `the offer carries the zone's specialty (got ${offer.specialty})`);

  const from = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const rfEngineer = { id: 'e1', profession: 'engineer', specialty: 'rf', skills: { technical: 6 }, fromNode: from };
  const vacuumEngineer = { id: 'e2', profession: 'engineer', specialty: 'vacuum', skills: { technical: 6 }, fromNode: from };
  const operator = { id: 'o1', profession: 'operator', specialty: null, skills: { operating: 6 }, fromNode: from };

  const rMatch = eligibleFor(rfEngineer, offer, game);
  assertOk(rMatch.ok === true, 'an RF engineer is eligible for the RF labWork offer');

  const rMismatch = eligibleFor(vacuumEngineer, offer, game);
  assertOk(rMismatch.ok === true, 'a vacuum engineer is STILL eligible (reduced efficiency elsewhere, never rejected on specialty alone)');

  const rWrongProfession = eligibleFor(operator, offer, game);
  assertOk(rWrongProfession.ok === false, 'an operator is rejected — on profession grounds');
  assertOk(!!rWrongProfession.reason, 'the profession rejection carries a reason');
  assertOk(!/[a-z][A-Z]/.test(rWrongProfession.reason), `the reason reads as English, not a camelCase job id (got "${rWrongProfession.reason}")`);
}

console.log('\n=== 6. eligibleFor: reason is always non-empty when ok is false (profession / unreachable / reserved) ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const consoleEntry = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  bump(state);
  const game = makeGame(state, [{ id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } }]);

  const offers = buildJobOffers(game);
  const runOffer = offers.find(o => o.jobType === 'runBeam');
  assertOk(!!runOffer, 'sanity: a free runBeam offer exists');

  const from = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const technician = { id: 't1', profession: 'technician', specialty: null, skills: { technical: 5 }, fromNode: from };
  const profReason = eligibleFor(technician, runOffer, game);
  assertOk(profReason.ok === false && !!profReason.reason, 'profession mismatch: ok is false and reason is non-empty');

  state.stationReservations = { [runOffer.stationKey]: 'someone-else' };
  const operator = { id: 'op1', profession: 'operator', specialty: null, skills: { operating: 5 }, fromNode: from };
  const reservedReason = eligibleFor(operator, runOffer, game);
  assertOk(reservedReason.ok === false && !!reservedReason.reason, 'already-reserved: ok is false and reason is non-empty');

  state.stationReservations = { [runOffer.stationKey]: operator.id };
  const ownReservation = eligibleFor(operator, runOffer, game);
  assertOk(ownReservation.ok === true, "a member's own reservation on the station is not held against them");
}

console.log('\n=== 7. Offers sorted by descending priority: repair before runBeam before analyze ===\n');
{
  const state = makeState();
  floorRect(state, 0, 12, 0, 12);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  placeItem(state, 'desk', 6, 6, 0, 0, 0);
  state.placeables.push({ id: 'comp1', type: 'testComponent', col: 9, row: 9, subCol: 0, subRow: 0 });
  bump(state);
  const game = makeGame(state, [{ id: 'bl-1', sourceId: 'comp1', beamState: { componentHealth: { comp1: 40 } } }]);

  const offers = buildJobOffers(game);
  const iRepair = offers.findIndex(o => o.jobType === 'repair');
  const iRunBeam = offers.findIndex(o => o.jobType === 'runBeam');
  const iAnalyze = offers.findIndex(o => o.jobType === 'analyze');
  assertOk(iRepair !== -1 && iRunBeam !== -1 && iAnalyze !== -1, 'sanity: repair, runBeam and analyze offers are all present');
  assertOk(iRepair < iRunBeam && iRunBeam < iAnalyze,
    `offers sorted descending: repair(${iRepair}) before runBeam(${iRunBeam}) before analyze(${iAnalyze})`);
  for (let i = 1; i < offers.length; i++) {
    assertOk(offers[i - 1].priority >= offers[i].priority, `offer ${i} does not have a higher priority than offer ${i - 1}`);
  }
}

console.log('\n=== 8 (bonus). repair: a sealed-off component produces no offer until a door opens ===\n');
{
  const state = makeState();
  sealChamber(state);
  state.placeables.push({ id: 'compWalled', type: 'testComponent', col: 0, row: 1, subCol: 0, subRow: 0 });
  const game = makeGame(state, [{ id: 'bl-1', sourceId: 'compWalled', beamState: { componentHealth: { compWalled: 50 } } }]);

  let offers = buildJobOffers(game);
  assertOk(!offers.some(o => o.jobType === 'repair'), 'sealed-room component: no repair offer (reason: unreachable)');

  state.doorOccupied['1,1,e'] = 'officeDoor';
  bump(state);
  offers = buildJobOffers(game);
  assertOk(offers.some(o => o.jobType === 'repair'), 'once a door opens, the same component is offered for repair');
}

console.log("\n=== 9 (bonus). commission: target carries {beamlineId, nodeId} + the component's specialty; vanishes with its beamline ===\n");
{
  const state = makeState();
  floorRect(state, 0, 6, 0, 6);
  state.placeables.push({
    id: 'compNew', type: 'testComponent', col: 3, row: 3, subCol: 0, subRow: 0,
    needsCommissioning: true, specialty: 'rf',
  });
  const game = makeGame(state, [{ id: 'bl-2', sourceId: 'compNew', beamState: { componentHealth: {} } }]);

  const offers = buildJobOffers(game);
  const offer = offers.find(o => o.jobType === 'commission');
  assertOk(!!offer, 'a component flagged needsCommissioning produces a commission offer');
  assertOk(!!offer && offer.target.beamlineId === 'bl-2' && offer.target.nodeId === 'compNew',
    'commission target carries both beamlineId and nodeId');
  assertOk(!!offer && offer.specialty === 'rf', "commission offer carries the component's specialty");

  const offersGone = buildJobOffers(makeGame(state, []));
  assertOk(!offersGone.some(o => o.jobType === 'commission'), 'a commission target whose beamline no longer exists is never offered (stale job)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
