// test/test-job-board.js — the job board (src/game/staff/jobs.js).
//
// Task 1 of the staff-professions-3 (jobs-and-gates) plan. Builds small
// hand-made states (plain objects shaped like Game.state) and a minimal
// fake `game` ({ state, registry: { getAll() } }) rather than routing
// through the real Game/BeamlineRegistry classes, matching
// test-staff-stations.js's pattern.
//
// Repair/commission fixtures use a REAL beamline module def ('source', a
// plain 4x4-subtile/1-tile module) placed the same way any real placeable
// is — through PLACEABLES[type].footprintCells, with a genuine
// subgridOccupied claim — rather than a bare object with no footprint. A
// fake, non-blocking fixture makes the reachability perimeter-walk look
// exercised when it never actually runs (see fix-round-1 review): a
// placeable with no subgridOccupied entry is transparent to the nav grid,
// so `approachCandidates` finds the node's own subtile passable and never
// takes the wall-crossing/perimeter-walking branch at all.

import { JOB_TYPES, buildJobOffers, eligibleFor } from '../src/game/staff/jobs.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// Every ok:false reason string produced anywhere in this file, collected as
// we go so a single sweep at the end (scenario 12) can check ALL of them
// for camelCase/raw-identifier leakage — not just one hand-picked case.
const collectedReasons = [];
function trackReason(res) {
  if (res && res.ok === false) collectedReasons.push(res.reason);
  return res;
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
  const entry = { id, type, kind: def.kind, col, row, subCol, subRow, dir, cells, params: {} };
  state.placeableIndex[id] = state.placeables.length;
  state.placeables.push(entry);
  for (const c of cells) {
    state.subgridOccupied[`${c.col},${c.row},${c.subCol},${c.subRow}`] = { id, kind: def.kind };
  }
  return entry;
}

function bump(state) { state.navRevision = (state.navRevision | 0) + 1; }

function makeGame(state, beamlines = []) {
  return { state, registry: { getAll: () => beamlines } };
}

// buildJobOffers returns { offers, suppressions } (see I1: the board needs
// a second channel for "damaged but explicitly declined" nodes, distinct
// from the offers array itself). Most scenarios below only care about the
// offers; the two that specifically verify suppression reasons (spares,
// unreachable) destructure buildJobOffers's return directly instead.
function offersOf(game) { return buildJobOffers(game).offers; }

// A registered beamline whose source is a real, placed 'source' module —
// flattenPath walks straight to it and stops (no pipes attached), so it's
// the only node in the path. `health` seeds componentHealth for it.
function placeSourceBeamline(state, beamlineId, col, row, health) {
  const src = placeItem(state, 'source', col, row, 0, 0, 0);
  bump(state);
  return {
    entry: { id: beamlineId, sourceId: src.id, beamState: { componentHealth: { [src.id]: health } } },
    placeable: src,
  };
}

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

function deepFreeze(obj, seen = new Set()) {
  if (obj === null || typeof obj !== 'object' || seen.has(obj)) return obj;
  seen.add(obj);
  for (const v of Object.values(obj)) deepFreeze(v, seen);
  return Object.freeze(obj);
}

console.log('\n=== 0. JOB_TYPES is exactly the eleven closed ids ===\n');
{
  const expected = ['runBeam', 'repair', 'labWork', 'commission', 'takeData', 'analyze', 'fabricate', 'paperwork', 'meet', 'eat', 'rest'];
  const actual = Object.keys(JOB_TYPES);
  assertOk(expected.every(id => actual.includes(id)) && actual.length === expected.length,
    `JOB_TYPES has exactly the eleven job ids (got ${actual.sort().join(',')})`);
}

console.log('\n=== 0b. eat/rest outrank every possible work priority NUMERICALLY, not just by an assumed margin ===\n');
{
  for (const id of Object.keys(JOB_TYPES)) {
    if (id === 'eat' || id === 'rest') continue;
    assertOk(JOB_TYPES.eat.basePriority > JOB_TYPES[id].basePriority, `eat's base priority beats ${id}'s`);
    assertOk(JOB_TYPES.rest.basePriority > JOB_TYPES[id].basePriority, `rest's base priority beats ${id}'s`);
  }

  // Repair's priority grows with urgency (see scenario 2) — the invariant
  // that matters is that even at MAXIMUM urgency (health 0), it still can't
  // reach eat/rest. Verified against a real generated offer, not a
  // hand-copied constant, so a change to the urgency formula can't silently
  // invalidate this test without also changing its own outcome.
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const { entry } = placeSourceBeamline(state, 'bl-1', 3, 3, 0); // health 0: worst case
  const offer = offersOf(makeGame(state, [entry])).find(o => o.jobType === 'repair');
  assertOk(!!offer, 'sanity: a health-0 component produces a repair offer');
  assertOk(!!offer && offer.priority < JOB_TYPES.eat.basePriority, `even a health-0 repair (priority ${offer?.priority}) stays below eat's base priority`);
  assertOk(!!offer && offer.priority < JOB_TYPES.rest.basePriority, `even a health-0 repair (priority ${offer?.priority}) stays below rest's base priority`);
}

console.log('\n=== 1. runBeam: one offer per free station slot, NOT capped by beamline count (that cap is Task 2\'s) ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  placeItem(state, 'monitorBank', 6, 2, 0, 0, 0);

  let offers = offersOf(makeGame(state, []));
  const runOffersNoBeamline = offers.filter(o => o.jobType === 'runBeam');
  assertOk(runOffersNoBeamline.length === 2, `zero beamlines still offers every free runBeam slot (got ${runOffersNoBeamline.length}, expected 2 — the cap moved to Task 2)`);
  assertOk(runOffersNoBeamline[0].target === null, 'runBeam offer target is null (station-only job)');
  assertOk(runOffersNoBeamline.every(o => typeof o.stationKey === 'string'), 'every runBeam offer carries a stationKey');

  offers = offersOf(makeGame(state, [{ id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } }]));
  assertOk(offers.filter(o => o.jobType === 'runBeam').length === 2, 'one beamline: still both free consoles are offered (not sliced down to 1)');
}

console.log('\n=== 2. repair: priority rises as health falls (real \'source\' module fixture) ===\n');
{
  function repairOfferAt(health) {
    const state = makeState();
    floorRect(state, 0, 10, 0, 10);
    const { entry } = placeSourceBeamline(state, 'bl-1', 5, 5, health);
    return offersOf(makeGame(state, [entry])).find(o => o.jobType === 'repair');
  }

  const mild = repairOfferAt(90);
  const severe = repairOfferAt(10);
  assertOk(!!mild && !!severe, 'a damaged node (health < 100) produces a repair offer');
  assertOk(typeof mild.target.nodeId === 'string' && mild.target.nodeId.length > 0, 'repair target carries a nodeId');
  assertOk(mild.target.beamlineId === 'bl-1', 'repair target carries beamlineId');
  assertOk(mild.stationKey === null, 'repair has no station (target-addressed, not a StationRef)');
  assertOk(severe.priority > mild.priority, `lower health -> higher priority (mild=${mild.priority}, severe=${severe.priority})`);

  const healthy = repairOfferAt(100);
  assertOk(healthy === undefined, 'a node at full health produces no repair offer');
}

console.log('\n=== 3. repair: spares === 0 -> offer absent (reason: no spares to fix it with) ===\n');
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const { entry } = placeSourceBeamline(state, 'bl-1', 5, 5, 40);
  state.resources.spares = 0;
  const game = makeGame(state, [entry]);

  let { offers, suppressions } = buildJobOffers(game);
  assertOk(!offers.some(o => o.jobType === 'repair'), 'spares === 0: repair offer is absent');
  const spareSuppression = suppressions.find(s => s.jobType === 'repair' && s.target.nodeId === entry.sourceId);
  assertOk(!!spareSuppression, 'spares === 0: a suppression is recorded for the damaged node (not just silently dropped)');
  assertOk(!!spareSuppression && /spares/i.test(spareSuppression.reason), `the suppression's reason actually mentions spares (got "${spareSuppression?.reason}")`);
  if (spareSuppression) collectedReasons.push(spareSuppression.reason);

  state.resources.spares = 5;
  ({ offers, suppressions } = buildJobOffers(game));
  assertOk(offers.some(o => o.jobType === 'repair'), 'spares > 0: the same damaged node is offered again');
  assertOk(!suppressions.some(s => s.jobType === 'repair' && s.target.nodeId === entry.sourceId),
    'spares > 0: the node no longer appears in suppressions either');
}

console.log('\n=== 4. eligibleFor: a walled-off console is ineligible (unreachable), reachable once a door opens ===\n');
{
  const state = makeState();
  sealChamber(state);
  placeItem(state, 'operatorConsole', 0, 1, 0, 0, 0);
  const from = { col: 4, row: 1, subCol: 3, subRow: 3 };
  const game = makeGame(state, [{ id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } }]);

  const offers = offersOf(game);
  const offer = offers.find(o => o.jobType === 'runBeam');
  assertOk(!!offer, "sanity: buildJobOffers still offers the walled-off console (reachability is eligibleFor's job, not the board's)");

  const operator = { id: 'op1', profession: 'operator', specialty: null, skills: { operating: 5 }, fromNode: from };
  let res = trackReason(eligibleFor(operator, offer, game));
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

  const offers = offersOf(game);
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

  const rWrongProfession = trackReason(eligibleFor(operator, offer, game));
  assertOk(rWrongProfession.ok === false, 'an operator is rejected — on profession grounds');
  assertOk(!!rWrongProfession.reason, 'the profession rejection carries a reason');
}

console.log('\n=== 6. eligibleFor: reason is always non-empty when ok is false (profession / unreachable / reserved) ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  bump(state);
  const game = makeGame(state, [{ id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } }]);

  const offers = offersOf(game);
  const runOffer = offers.find(o => o.jobType === 'runBeam');
  assertOk(!!runOffer, 'sanity: a free runBeam offer exists');

  const from = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const technician = { id: 't1', profession: 'technician', specialty: null, skills: { technical: 5 }, fromNode: from };
  const profReason = trackReason(eligibleFor(technician, runOffer, game));
  assertOk(profReason.ok === false && !!profReason.reason, 'profession mismatch: ok is false and reason is non-empty');

  state.stationReservations = { [runOffer.stationKey]: 'someone-else' };
  const operator = { id: 'op1', profession: 'operator', specialty: null, skills: { operating: 5 }, fromNode: from };
  const reservedReason = trackReason(eligibleFor(operator, runOffer, game));
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
  const { entry } = placeSourceBeamline(state, 'bl-1', 9, 9, 40);
  bump(state);
  const game = makeGame(state, [entry]);

  const offers = offersOf(game);
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

console.log('\n=== 8. repair reachability — FALSE NEGATIVE regression: a component boxed in only at its origin corner is still offered via its open perimeter ===\n');
{
  // Target at (5,5): a real 4x4-subtile 'source' module. Blockers placed
  // immediately WEST (4,5) and NORTH (5,4) — the target's origin corner
  // (subCol0,subRow0) has its only two TILE-CROSSING neighbors (west,
  // north) blocked, and its two SAME-TILE neighbors (east, south) are
  // self-occupied by construction (any solid single-tile module blocks
  // its own interior). A corner-only probe therefore finds all 4 "blocked"
  // and reports unreachable — even though the EAST and SOUTH edges of the
  // real footprint (12 more subtiles, never visited by a corner-only
  // probe) open directly onto wide-open floor.
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const { entry } = placeSourceBeamline(state, 'bl-1', 5, 5, 50);
  placeItem(state, 'source', 4, 5, 0, 0, 0); // west blocker
  placeItem(state, 'source', 5, 4, 0, 0, 0); // north blocker
  // East (6,5) and south (5,6) are left as open floor.
  bump(state);

  const offers = offersOf(makeGame(state, [entry]));
  assertOk(offers.some(o => o.jobType === 'repair'), 'a component boxed in only at its origin corner is still offered — the fix walks the whole perimeter, not just one corner');
}

console.log('\n=== 9. repair reachability — FALSE POSITIVE regression: a candidate on the far side of a wall is excluded even though it independently counts as "outdoors" ===\n');
{
  // Target at (0,1), against the sealed chamber's WEST wall. The subtile
  // immediately west of it is unbuilt map area — genuinely "outdoors" on
  // its own — but a technician can never actually STEP there from the
  // component's footprint: wall(0,1,'w') blocks exactly that edge. Without
  // an isBlocked() check on the tile-crossing step, that far-side subtile
  // looks like a valid approach (nav.passable doesn't know about walls) and
  // "reachable from outdoors" trivially says yes for it, in isolation —
  // wrongly validating an approach nobody can ever walk to. No offer must
  // appear until the actual (east-side, through the bisecting door) route
  // opens.
  const state = makeState();
  sealChamber(state);
  const { entry } = placeSourceBeamline(state, 'bl-1', 0, 1, 50);

  let { offers, suppressions } = buildJobOffers(makeGame(state, [entry]));
  assertOk(!offers.some(o => o.jobType === 'repair'), 'sealed-room component, no door: no repair offer (the only "reachable" candidate is on the far side of a wall)');
  const wallSuppression = suppressions.find(s => s.jobType === 'repair' && s.target.nodeId === entry.sourceId);
  assertOk(!!wallSuppression, 'a suppression is recorded for the sealed component, not just a silent drop');
  assertOk(!!wallSuppression && /reach/i.test(wallSuppression.reason), `the suppression's reason mentions reachability (got "${wallSuppression?.reason}")`);
  if (wallSuppression) collectedReasons.push(wallSuppression.reason);

  state.doorOccupied['1,1,e'] = 'officeDoor';
  bump(state);
  ({ offers, suppressions } = buildJobOffers(makeGame(state, [entry])));
  assertOk(offers.some(o => o.jobType === 'repair'), 'once the real door opens (the east side route), the same component is offered for repair');
  assertOk(!suppressions.some(s => s.jobType === 'repair' && s.target.nodeId === entry.sourceId),
    'and the suppression for it is gone too, now that it is genuinely reachable');
}

console.log("\n=== 10. commission: target carries {beamlineId, nodeId} + the component's specialty; vanishes with its beamline ===\n");
{
  const state = makeState();
  floorRect(state, 0, 6, 0, 6);
  const src = placeItem(state, 'source', 3, 3, 0, 0, 0);
  src.needsCommissioning = true;
  src.specialty = 'rf';
  const beamline = { id: 'bl-2', sourceId: src.id, beamState: { componentHealth: {} } };

  const offers = offersOf(makeGame(state, [beamline]));
  const offer = offers.find(o => o.jobType === 'commission');
  assertOk(!!offer, 'a component flagged needsCommissioning produces a commission offer');
  assertOk(!!offer && offer.target.beamlineId === 'bl-2' && offer.target.nodeId === src.id,
    'commission target carries both beamlineId and nodeId');
  assertOk(!!offer && offer.specialty === 'rf', "commission offer carries the component's specialty");

  const offersGone = offersOf(makeGame(state, []));
  assertOk(!offersGone.some(o => o.jobType === 'commission'), 'a commission target whose beamline no longer exists is never offered (stale job)');
}

console.log('\n=== 11. eligibleFor: target-addressed offers (repair/commission) are gated on reachability too, not just station-addressed ones ===\n');
{
  const state = makeState();
  sealChamber(state);
  const { entry } = placeSourceBeamline(state, 'bl-1', 0, 1, 50);
  const src = state.placeables.find(p => p.type === 'source');
  src.needsCommissioning = true;
  src.specialty = 'rf';
  const game = makeGame(state, [entry]);

  // No door yet: the component is unreachable board-wide too, so
  // buildJobOffers itself won't have emitted a repair offer (scenario 9) —
  // but eligibleFor must independently reject a STALE offer built before
  // the room was sealed, and must independently reject commission (which
  // has no board-level reachability pre-filter at all).
  const staleRepairOffer = { jobType: 'repair', target: { beamlineId: 'bl-1', nodeId: src.id }, specialty: null, priority: 999, stationKey: null };
  const commissionOffer = { jobType: 'commission', target: { beamlineId: 'bl-1', nodeId: src.id }, specialty: 'rf', priority: 999, stationKey: null };

  const farNode = { col: 4, row: 1, subCol: 3, subRow: 3 };
  const technician = { id: 't1', profession: 'technician', specialty: null, skills: { technical: 5 }, fromNode: farNode };
  const engineer = { id: 'e1', profession: 'engineer', specialty: 'rf', skills: { technical: 5 }, fromNode: farNode };

  const repairFar = trackReason(eligibleFor(technician, staleRepairOffer, game));
  assertOk(repairFar.ok === false, 'a stale/sealed repair target is not eligible from across a wall with no door');
  assertOk(!!repairFar.reason, 'the target-unreachable rejection carries a reason');

  const commissionFar = trackReason(eligibleFor(engineer, commissionOffer, game));
  assertOk(commissionFar.ok === false, 'commission (target-addressed, same as repair) is ALSO gated on reachability — not just station-addressed jobs');
  assertOk(!!commissionFar.reason, 'the commission target-unreachable rejection carries a reason');

  state.doorOccupied['1,1,e'] = 'officeDoor';
  bump(state);
  const repairNear = eligibleFor(technician, staleRepairOffer, game);
  assertOk(repairNear.ok === true, 'once the door opens, the same technician (now with a real route) is eligible for the repair');
  const commissionNear = eligibleFor(engineer, commissionOffer, game);
  assertOk(commissionNear.ok === true, 'and the engineer is eligible for the commission too');

  // A target whose beamline has been demolished must read as "gone", not
  // "unreachable" (a different failure than reachability) — and must never
  // throw just because the id no longer resolves to anything.
  const goneGame = makeGame(state, []);
  const goneRes = trackReason(eligibleFor(technician, staleRepairOffer, goneGame));
  assertOk(goneRes.ok === false && !!goneRes.reason, 'a target whose beamline no longer exists is rejected with a reason, not a throw');
}

console.log('\n=== 12. meet: BOTH gates are required independently — admin alone is not enough, idle count alone is not enough ===\n');
{
  // idleStaffCount counts EVERY staff member holding no reservation,
  // including the admin themselves (nothing excludes the admin from also
  // being "idle") — so `otherIdle` here is staff BESIDES the admin, and
  // the actual total idle count the board checks against MEET_MIN_IDLE is
  // otherIdle + (adminPresent ? 1 : 0).
  function makeMeetState(adminPresent, otherIdle) {
    const state = makeState();
    floorRect(state, 0, 12, 0, 12);
    // conferenceTable is seated:'required' (a dead slot without a matching
    // chair) — one chair at anchors[0] is enough for one usable 'meet'
    // slot, same geometry test-staff-stations.js's diningTable scenario
    // already proved: anchor {subCol:0,subRow:2,facing:'n'} pins the chair
    // to the table's own tile at subRow 3, dir 0 (default facing 'n'
    // already agrees).
    const table = placeItem(state, 'conferenceTable', 4, 4, 0, 0, 0);
    placeItem(state, 'cafeteriaChair', table.col, table.row, 0, 3, 0);
    state.staffMembers = [];
    if (adminPresent) state.staffMembers.push({ id: 'admin1', profession: 'admin' });
    for (let i = 0; i < otherIdle; i++) state.staffMembers.push({ id: `idle${i}`, profession: 'technician' });
    // stationReservations stays empty: nobody in this fixture holds anything, so everyone above counts as idle.
    return state;
  }

  let offers = offersOf(makeGame(makeMeetState(true, 1))); // total idle: admin + 1 = 2
  assertOk(!offers.some(o => o.jobType === 'meet'), 'admin present but only 2 total idle staff (< 3): no meet offer');

  offers = offersOf(makeGame(makeMeetState(false, 5))); // total idle: 5, but no admin
  assertOk(!offers.some(o => o.jobType === 'meet'), '5 idle staff but no admin present: no meet offer');

  offers = offersOf(makeGame(makeMeetState(true, 2))); // total idle: admin + 2 = 3, the boundary
  assertOk(offers.some(o => o.jobType === 'meet'), 'admin present AND >= 3 total idle staff: a meet offer appears');
}

console.log('\n=== 13. eat/rest are never generated by the board, even when a matching free station exists ===\n');
{
  const state = makeState();
  floorRect(state, 0, 12, 0, 12);
  const table = placeItem(state, 'diningTable', 4, 4, 0, 0, 0);
  placeItem(state, 'cafeteriaChair', table.col, table.row, 0, 3, 0); // anchors[0], matches test-staff-stations.js's convention
  placeItem(state, 'toolChest', 8, 8, 0, 0, 0); // jobs: ['rest']
  bump(state);

  const offers = offersOf(makeGame(state, []));
  assertOk(!offers.some(o => o.jobType === 'eat'), 'a free eat-capable station never produces an eat offer (Task 2 injects those itself)');
  assertOk(!offers.some(o => o.jobType === 'rest'), 'a free rest-capable station never produces a rest offer (Task 2 injects those itself)');
}

console.log('\n=== 14. buildJobOffers mutates nothing of its own — deep-frozen state survives a scan (would have caught a false "nothing writes to state" claim) ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  placeItem(state, 'desk', 5, 5, 0, 0, 0);
  bump(state);
  // No stale reservations here — getStationIndex's own legitimate pruning
  // (see jobs.js's header comment) only ever WRITES when there's a dead
  // key to delete; a clean state gives it nothing to do, so this isolates
  // "does buildJobOffers's own code path mutate anything" from that
  // separate, documented, legitimate cache side effect.
  const game = makeGame(state, [{ id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } }]);

  deepFreeze(state);

  let threw = false;
  let result = { offers: [], suppressions: [] };
  try {
    result = buildJobOffers(game);
  } catch (e) {
    threw = true;
    console.log('    (threw:', e.message, ')');
  }
  assertOk(!threw, 'buildJobOffers runs to completion against a deep-frozen state without throwing');
  assertOk(result.offers.length > 0, 'and still returns real offers from it');
}

console.log('\n=== 15. eligibleFor never leaks a raw/unrecognized profession id into player-facing text ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  bump(state);
  const game = makeGame(state, [{ id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } }]);
  const offer = offersOf(game).find(o => o.jobType === 'runBeam');

  const mysteryMember = { id: 'x1', profession: 'labTech', specialty: null, skills: {}, fromNode: { col: 0, row: 0, subCol: 0, subRow: 0 } };
  const res = trackReason(eligibleFor(mysteryMember, offer, game));
  assertOk(res.ok === false, 'an unrecognized profession is still rejected (not eligible by accident)');
  assertOk(!!res.reason && !res.reason.includes('labTech'), `the raw unrecognized profession id never appears in the reason (got "${res.reason}")`);
}

console.log('\n=== 16. Sweep: every collected rejection reason reads as English — no camelCase job/station ids leak through ===\n');
{
  assertOk(collectedReasons.length >= 8, `sanity: enough rejection reasons were collected to make this sweep meaningful (got ${collectedReasons.length})`);
  // Only the multi-word job ids (runBeam, labWork, takeData) are actually
  // camelCase-shaped and would look like a leaked identifier if they showed
  // up verbatim. Single-word ids (repair, meet, eat, analyze, ...) are
  // ordinary English nouns/verbs — "repair" legitimately appearing in
  // "No spares available to make the repair." is correct prose, not a
  // leak, so this only flags the shape that's actually wrong: an embedded
  // lowercase-to-uppercase transition, camelCase's own tell.
  const camelCaseJobIds = Object.keys(JOB_TYPES).filter(id => /[a-z][A-Z]/.test(id));
  assertOk(camelCaseJobIds.length > 0, `sanity: at least one job id is actually camelCase-shaped to sweep for (got ${camelCaseJobIds.join(',')})`);
  for (const reason of collectedReasons) {
    assertOk(typeof reason === 'string' && reason.length > 0, `collected reason is a non-empty string (got ${JSON.stringify(reason)})`);
    assertOk(!/[a-z][A-Z]/.test(reason), `reason has no embedded camelCase identifier (got "${reason}")`);
    assertOk(!camelCaseJobIds.some(id => reason.includes(id)), `reason does not contain a raw camelCase job id (got "${reason}")`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
