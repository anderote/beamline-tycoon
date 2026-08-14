// test/test-admin-and-career.js — admin's two job types
// (src/game/staff/jobEffects/paperwork.js, .../meet.js) and the career
// history writer (src/game/staff/careerLog.js). Task 7 of the
// staff-professions-3 (jobs-and-gates) plan: the last profession's work,
// and the accumulating career history that makes a bio card memorable.
//
// Fixture styles mirror test-repair-and-fabrication.js/
// test-science-and-zone-staffing.js's own split:
//
//   Section A — hand-built state + a fake `game` ({ state, registry:
//   { getAll() } }), real StaffMember instances, real PLACEABLES station
//   defs. Enough surface for jobRunner.js's assignJobs/tickJobs and the
//   REAL jobEffects modules (imported for real via jobRunner.js's own
//   bottom-of-file imports — nothing here re-stubs a handler) to run
//   against. Fixture helpers are duplicated locally rather than imported
//   from a sibling test file, matching that file's own stated convention.
//
//   Section B — a real Game instance, for the one thing Section A's
//   lightweight state cannot exercise honestly: staffHireCost applied
//   through the real hireStaffMember/hireStaff consumers, with the
//   discount actually reducing (and then losing) real funding.
//
// Test list (mirrors the task-7 brief's own):
//   1. paperwork completion: reputation -> funding at a rate scaled by
//      skills.admin (via a real assignJobs/tickJobs run against a real
//      receptionDesk station — the one full board-to-completion path in
//      this file, proving the registration wiring end to end, not just
//      that the handler function does the right math in isolation).
//   2. The next-hire discount builds 5% per paperwork completion, capped
//      at 40%, and actually reduces (then resets after) a real hire's
//      charged cost through BOTH hiring routes (hireStaffMember AND the
//      compat hireStaff) — the two-route gap this task's own hazard
//      review calls out by name.
//   3. meet: attendee morale rises more than non-attendee morale, applied
//      exactly once per completion (not accumulating within one call),
//      and clamps at 1.0.
//   4. logCareerEvent caps history at 50 and collapses consecutive
//      identical (event AND note) entries into one with a count; a
//      different event, or the same event with a different note, is
//      never collapsed.
//   5. careerMilestones is empty for a new hire and non-empty once repairs
//      reaches its threshold (10).
//   6. Wiring into Tasks 5/6's completion effects: first commission only,
//      every tenth repair, every hundredth spare (including a boundary
//      CROSSED mid-jump, not just landed on exactly), and only an
//      analysis that actually finishes the active research item.
//   7. History survives serialize() -> load() on a real Game.
//
// Mutation-verified guards (see task-7-report.md for both outputs):
//   - fabricate.js's boundary-crossing check (floor(before/100) <
//     floor(after/100)) — reverting to a plain `sparesMade % 100 === 0`
//     check misses a threshold jumped over by a >1 `made` value, failing
//     test 6c.
//   - Game.js's hireStaff (the compat route) applying state.staffHireDiscount
//     — reverting to the old flat `staffCosts[profession] * 10` fails test 2c.
//   - careerLog.js's cap (splice on every call, not only when exceeded by
//     one) — removing the splice entirely fails test 4a.

import assert from 'node:assert';
import { StaffMember } from '../src/game/staff/StaffMember.js';
import { assignJobs, tickJobs, onJobComplete } from '../src/game/staff/jobRunner.js';
import { logCareerEvent, careerMilestones } from '../src/game/staff/careerLog.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { COMPONENTS } from '../src/data/components.js';
import { RESEARCH } from '../src/data/research.js';

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// =============================================================================
// Section A fixtures — duplicated from test-repair-and-fabrication.js /
// test-science-and-zone-staffing.js (see header).
// =============================================================================

function makeState(overrides = {}) {
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
    resources: { funding: 0, reputation: 0, data: 0, spares: 0 },
    zoneConnectivity: {},
    navRevision: 0,
    tick: 0,
    ...overrides,
  };
}

function floorRect(state, minCol, maxCol, minRow, maxRow, type = 'concrete') {
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) {
      state.infraOccupied[`${c},${r}`] = type;
    }
  }
}

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
  return {
    state,
    registry: { getAll: () => beamlines },
    sandboxMode: false,
    logs: [],
    log(msg, type) { this.logs.push({ msg, type }); },
    spend(costs) {
      if (this.sandboxMode) return;
      for (const [r, a] of Object.entries(costs)) {
        if (r === 'spares') this.state.resources[r] = Math.max(0, (this.state.resources[r] || 0) - a);
        else this.state.resources[r] -= a;
      }
    },
  };
}

const FLAT_SKILLS = { operating: 5, technical: 5, research: 5, construction: 5, admin: 5 };
function makeMember(profession, id, skillsOverride = {}) {
  return new StaffMember({
    id, profession, traits: [], skills: { ...FLAT_SKILLS, ...skillsOverride }, rng: () => 0.5,
  });
}

// Simulate the renderer reporting arrival — see jobRunner.js's own header
// comment on why only the renderer is allowed to do this in the real game.
function arrive(member) { if (member.job) member.job.phase = 'work'; }

function runUntilComplete(game, member, maxTicks = 500) {
  for (let t = 0; t < maxTicks; t++) {
    tickJobs(game);
    if (member.job === null) return t;
  }
  return -1;
}

// =============================================================================
// 1. paperwork, end to end: a real receptionDesk station, a real admin,
//    reputation converted into funding scaled by their own efficiency.
// =============================================================================
console.log('\n=== 1. paperwork end to end: reputation -> funding, scaled by skills.admin ===\n');
{
  const state = makeState({ resources: { funding: 0, reputation: 50, data: 0, spares: 0 } });
  floorRect(state, 0, 10, 0, 10);
  placeItem(state, 'receptionDesk', 4, 4, 0, 0, 0);
  bump(state);
  const game = makeGame(state, []);

  const admin = makeMember('admin', 'a1');
  state.staffMembers = [admin];

  assignJobs(game);
  assertOk(admin.job?.jobType === 'paperwork', `admin assigned paperwork (got ${admin.job?.jobType})`);
  arrive(admin);

  const efficiency = admin.efficiency(0, admin.job.specialty);
  const expectedConverted = Math.min(state.resources.reputation, 3 * efficiency);
  const beforeReputation = state.resources.reputation;
  const beforeFunding = state.resources.funding;

  const completedAt = runUntilComplete(game, admin);
  assertOk(completedAt >= 0, `paperwork job completed (at tick ${completedAt})`);
  assertOk(Math.abs(state.resources.reputation - (beforeReputation - expectedConverted)) < 1e-9,
    `reputation converted by 3 * efficiency (${efficiency}) -> ${expectedConverted} (got ${beforeReputation - state.resources.reputation})`);
  assertOk(Math.abs(state.resources.funding - (beforeFunding + expectedConverted * 2000)) < 1e-9,
    `funding gained at $2000/reputation converted (got ${state.resources.funding})`);
  assertOk(Math.abs((state.staffHireDiscount || 0) - 0.05) < 1e-9,
    `hire discount builds by 5% on this completion (got ${state.staffHireDiscount})`);

  // Zero reputation on hand: nothing to convert, but the discount still
  // builds — paperwork's two effects are independent (see paperwork.js's
  // own header).
  state.resources.reputation = 0;
  const beforeFunding2 = state.resources.funding;
  onJobComplete(game, admin, { jobType: 'paperwork', specialty: null });
  assertOk(state.resources.funding === beforeFunding2, 'no reputation on hand -> no funding conversion');
  assertOk(Math.abs((state.staffHireDiscount || 0) - 0.10) < 1e-9,
    `discount still builds with zero reputation on hand (got ${state.staffHireDiscount})`);
}

// =============================================================================
// 2. The next-hire discount: caps at 40%, actually reduces a real hire's
//    charged cost through BOTH hiring routes, and resets once spent.
// =============================================================================
console.log('\n=== 2. paperwork discount caps at 40%, discounts a real hire, then resets ===\n');
{
  const { Game } = await import('../src/game/Game.js');
  const { BeamlineRegistry } = await import('../src/beamline/BeamlineRegistry.js');
  const { PARAM_DEFS } = await import('../src/beamline/component-physics.js');
  const { staffHireCost } = await import('../src/game/staff/staffSystem.js');

  globalThis.COMPONENTS = COMPONENTS;
  globalThis.PARAM_DEFS = PARAM_DEFS;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const g = new Game(new BeamlineRegistry(), { seed: 201 });
  g.state.resources.funding = 1e9;

  // The discount lives on game.state, not on any one staffer — driving it
  // doesn't need the admin hired or seated anywhere.
  const admin = makeMember('admin', 'admin-drive');
  for (let i = 0; i < 6; i++) onJobComplete(g, admin, { jobType: 'paperwork', specialty: null });
  assertOk(Math.abs(g.state.staffHireDiscount - 0.3) < 1e-9,
    `6 completions -> 30% discount (got ${g.state.staffHireDiscount})`);
  for (let i = 0; i < 10; i++) onJobComplete(g, admin, { jobType: 'paperwork', specialty: null });
  assertOk(g.state.staffHireDiscount === 0.4, `discount caps at 0.4 (got ${g.state.staffHireDiscount})`);

  // 2a: hireStaffMember charges the discounted cost, then the discount
  // resets — a hire with no further paperwork pays full price again.
  const cand = g.state.staffCandidates[0];
  const fullCost = staffHireCost(cand, g.state.staffCosts);
  const expectedCost = Math.round(fullCost * 0.6);
  const beforeFunding = g.state.resources.funding;
  const res = g.hireStaffMember(cand.id);
  assertOk(res !== false, 'setup: hireStaffMember succeeded');
  assertOk(beforeFunding - g.state.resources.funding === expectedCost,
    `hireStaffMember charged the discounted cost (want ${expectedCost}, got ${beforeFunding - g.state.resources.funding})`);
  assertOk(g.state.staffHireDiscount === 0, 'the discount is spent (reset to 0) after the hire it applied to');

  if (g.state.staffCandidates.length === 0) g._refreshStaffCandidates();
  const cand2 = g.state.staffCandidates[0];
  const fullCost2 = staffHireCost(cand2, g.state.staffCosts);
  const beforeFunding2 = g.state.resources.funding;
  g.hireStaffMember(cand2.id);
  assertOk(beforeFunding2 - g.state.resources.funding === fullCost2,
    `a later hireStaffMember with no discount pays full price (want ${fullCost2}, got ${beforeFunding2 - g.state.resources.funding})`);

  // 2b/2c: the SECOND hiring route (the compat hireStaff, used by the RL
  // agent's action space) must see the exact same discount — this is the
  // "one route charged, one not" hazard this task's own review calls out.
  for (let i = 0; i < 8; i++) onJobComplete(g, admin, { jobType: 'paperwork', specialty: null });
  assertOk(g.state.staffHireDiscount === 0.4, `setup: discount rebuilt to cap (got ${g.state.staffHireDiscount})`);

  const beforeStaffCount = g.state.staffMembers.length;
  const fullCompatCost = Math.round(g.state.staffCosts.operator * 10);
  const expectedCompatCost = Math.round(fullCompatCost * 0.6);
  const beforeFunding3 = g.state.resources.funding;
  const compatRes = g.hireStaff('operator');
  assertOk(compatRes !== false, 'setup: hireStaff (compat route) succeeded');
  assertOk(g.state.staffMembers.length === beforeStaffCount + 1, 'setup: the compat route actually hired someone');
  assertOk(beforeFunding3 - g.state.resources.funding === expectedCompatCost,
    `the compat hireStaff route ALSO charges the discounted cost (want ${expectedCompatCost}, got ${beforeFunding3 - g.state.resources.funding})`);
  assertOk(g.state.staffHireDiscount === 0, 'the compat route also spends the discount');
}

// =============================================================================
// 3. meet: attendee morale rises more than non-attendee morale, applied
//    exactly once per completion, clamped at 1.0.
// =============================================================================
console.log('\n=== 3. meet: attendee vs non-attendee morale bump ===\n');
{
  const attendee1 = makeMember('technician', 'att1');
  const attendee2 = makeMember('engineer', 'att2');
  const bystander = makeMember('machinist', 'byst1');
  attendee1.needs.morale = 0.5;
  attendee2.needs.morale = 0.5;
  bystander.needs.morale = 0.5;
  attendee1.job = { jobType: 'meet', target: null, specialty: null, stationKey: 'k1', phase: 'work', progress: 60 };
  attendee2.job = { jobType: 'meet', target: null, specialty: null, stationKey: 'k2', phase: 'work', progress: 60 };
  bystander.job = null;

  const state = { staffMembers: [attendee1, attendee2, bystander], tick: 100 };
  const game = { state };

  // Fires once, as tickJobs itself would call it (before abandonJob clears
  // the completing member's own job) — attendee2's job is untouched here
  // (this is attendee1's OWN completion), which is exactly the "someone
  // else's meeting job is still in progress" case this handler has to see.
  onJobComplete(game, attendee1, attendee1.job);

  assertOk(Math.abs(attendee1.needs.morale - 0.65) < 1e-9,
    `the completing attendee gets the +0.15 bump (got ${attendee1.needs.morale})`);
  assertOk(Math.abs(attendee2.needs.morale - 0.65) < 1e-9,
    `a still-in-progress attendee also gets +0.15 (got ${attendee2.needs.morale})`);
  assertOk(Math.abs(bystander.needs.morale - 0.55) < 1e-9,
    `a non-attendee gets the smaller +0.05 (got ${bystander.needs.morale})`);
  assertOk(bystander.needs.morale < attendee1.needs.morale, 'attendee morale rises more than non-attendee morale');
}
{
  const nearMax = makeMember('operator', 'near-max');
  nearMax.needs.morale = 0.95;
  nearMax.job = { jobType: 'meet', target: null, specialty: null, stationKey: 'k', phase: 'work', progress: 60 };
  const state = { staffMembers: [nearMax], tick: 1 };
  onJobComplete({ state }, nearMax, nearMax.job);
  assertOk(nearMax.needs.morale === 1, `morale clamps at 1.0 rather than overshooting (got ${nearMax.needs.morale})`);
}

// =============================================================================
// 4. logCareerEvent: caps at 50, collapses consecutive identical (event AND
//    note) entries into a count, and does NOT collapse a different event or
//    a same-typed event with a different note.
// =============================================================================
console.log('\n=== 4. logCareerEvent: cap and consecutive-duplicate collapse ===\n');
{
  const member = { history: [] };
  for (let i = 1; i <= 60; i++) logCareerEvent(member, i, 'test', `note-${i}`);
  assertOk(member.history.length === 50, `history is capped at 50 (got ${member.history.length})`);
  assertOk(member.history[0].note === 'note-11',
    `the oldest 10 of 60 distinct entries were trimmed from the front (got "${member.history[0].note}")`);
  assertOk(member.history[49].note === 'note-60', 'the newest entry survived');
}
{
  const member = { history: [] };
  logCareerEvent(member, 1, 'repair', 'Recovered the beam 10 times now.');
  logCareerEvent(member, 5, 'repair', 'Recovered the beam 10 times now.');
  assertOk(member.history.length === 1, 'two consecutive IDENTICAL entries collapse into one');
  assertOk(member.history[0].count === 2, `the collapsed entry counts 2 (got ${member.history[0].count})`);
  assertOk(member.history[0].tick === 5, `the collapsed entry's tick refreshes to the latest occurrence (got ${member.history[0].tick})`);

  logCareerEvent(member, 8, 'commission', 'Commissioned their first component: the Undulator.');
  assertOk(member.history.length === 2, 'a different event is never collapsed into the prior one');

  logCareerEvent(member, 9, 'repair', 'Recovered the beam 20 times now.');
  assertOk(member.history.length === 3,
    'the same event id with a DIFFERENT note is not collapsed either — it is new information');
}

// =============================================================================
// 5. careerMilestones: empty for a new hire, non-empty once repairs
//    reaches its threshold.
// =============================================================================
console.log('\n=== 5. careerMilestones: empty for a new hire, appears at threshold ===\n');
{
  const fresh = makeMember('technician', 'fresh1');
  assertOk(careerMilestones(fresh).length === 0, `a fresh hire has no milestones (got ${JSON.stringify(careerMilestones(fresh))})`);

  fresh.stats.repairs = 9;
  assertOk(careerMilestones(fresh).length === 0, 'still nothing one repair short of the threshold');

  fresh.stats.repairs = 10;
  const lines = careerMilestones(fresh);
  assertOk(lines.length > 0, `a milestone appears once repairs reaches 10 (got ${JSON.stringify(lines)})`);
  assertOk(lines.some(l => l.includes('10')), `the line reports the live count (got ${JSON.stringify(lines)})`);

  fresh.stats.repairs = 47;
  assertOk(careerMilestones(fresh).some(l => l.includes('47')),
    `the line tracks the live count as it climbs, not the threshold (got ${JSON.stringify(careerMilestones(fresh))})`);
}

// =============================================================================
// 6. Wiring into Tasks 5/6's completion effects.
// =============================================================================
console.log('\n=== 6a. repair: a diary entry only on every tenth repair ===\n');
{
  const state = makeState({ resources: { funding: 0, reputation: 0, data: 0, spares: 10 } });
  floorRect(state, 0, 10, 0, 10);
  const src = placeItem(state, 'source', 5, 5, 0, 0, 0);
  bump(state);
  const beamline = { id: 'bl-1', sourceId: src.id, beamState: { componentHealth: { [src.id]: 50 } } };
  const game = makeGame(state, [beamline]);

  const technician = makeMember('technician', 't1');
  state.staffMembers = [technician];

  const baselineLen = technician.history.length; // just the 'hired' entry
  for (let n = 1; n <= 10; n++) {
    beamline.beamState.componentHealth[src.id] = 50; // re-damage between repairs
    assignJobs(game);
    arrive(technician);
    const t = runUntilComplete(game, technician);
    assertOk(t >= 0, `setup: repair #${n} completed`);
    if (n < 10) {
      assertOk(technician.history.length === baselineLen,
        `no diary entry yet after repair #${n} (history length ${technician.history.length})`);
    }
  }
  assertOk(technician.stats.repairs === 10, `stats.repairs counts every completion (got ${technician.stats.repairs})`);
  assertOk(technician.history.length === baselineLen + 1,
    `exactly one diary entry appears on the tenth repair (got ${technician.history.length})`);
  const entry = technician.history[technician.history.length - 1];
  assertOk(entry.event === 'repair' && /10/.test(entry.note), `the entry names the tally (got ${JSON.stringify(entry)})`);
}

console.log('\n=== 6b. commission: a diary entry only on the FIRST commission ===\n');
{
  const engineer = makeMember('engineer', 'e1');
  const state = { tick: 1, resources: {} };
  const game = { state };
  const target = { needsCommissioning: true, type: 'undulator', specialty: null };
  state.placeables = [{ id: 'comp-1', ...target }];
  state.placeableIndex = { 'comp-1': 0 };
  state.beamPipes = [];

  const baselineLen = engineer.history.length;
  onJobComplete(game, engineer, { jobType: 'commission', target: { beamlineId: 'bl-1', nodeId: 'comp-1' }, specialty: null });
  assertOk(engineer.stats.commissions === 1, 'setup: first commission counted');
  assertOk(engineer.history.length === baselineLen + 1, `the first commission gets a diary entry (got ${engineer.history.length})`);
  assertOk(engineer.history[engineer.history.length - 1].event === 'commission', 'the entry is event "commission"');

  // A second component, second commission: stats still climb, but no
  // second diary entry.
  state.placeables.push({ id: 'comp-2', needsCommissioning: true, type: 'quadrupole', specialty: null });
  state.placeableIndex['comp-2'] = 1;
  onJobComplete(game, engineer, { jobType: 'commission', target: { beamlineId: 'bl-1', nodeId: 'comp-2' }, specialty: null });
  assertOk(engineer.stats.commissions === 2, `stats.commissions keeps counting (got ${engineer.stats.commissions})`);
  assertOk(engineer.history.length === baselineLen + 1,
    `the SECOND commission gets no additional diary entry (got ${engineer.history.length})`);
}

console.log('\n=== 6c. fabricate: a diary entry only when the hundredth-spare boundary is CROSSED ===\n');
{
  // construction 8 -> made = 1 + floor(8/3) = 3 per completion: 33 * 3 = 99,
  // the 34th completion lands on 102 — jumping OVER the 100 boundary rather
  // than landing on it exactly. A naive `sparesMade % 100 === 0` check
  // would miss this entirely; the real check compares
  // floor(before/100) < floor(after/100).
  const machinist = makeMember('machinist', 'm1', { construction: 8 });
  const state = { tick: 1, resources: { spares: 0 } };
  const game = { state };

  const fabJob = { jobType: 'fabricate' };
  const baselineLen = machinist.history.length;
  for (let n = 1; n <= 33; n++) onJobComplete(game, machinist, fabJob);
  assertOk(machinist.stats.sparesMade === 99, `setup: 33 completions -> 99 spares (got ${machinist.stats.sparesMade})`);
  assertOk(machinist.history.length === baselineLen, 'no diary entry before the boundary is crossed');

  onJobComplete(game, machinist, fabJob);
  assertOk(machinist.stats.sparesMade === 102, `the 34th completion jumps over 100 to 102 (got ${machinist.stats.sparesMade})`);
  assertOk(machinist.history.length === baselineLen + 1,
    `a diary entry appears on the completion that CROSSES 100, even though it did not land on it (got ${machinist.history.length})`);
}

console.log('\n=== 6d. analyze: a diary entry only for the analysis that finishes the active research item ===\n');
{
  const duration = RESEARCH.beamOptics.duration; // 30
  const scientist = makeMember('scientist', 's1');
  const state = { tick: 1, resources: { data: 100, reputation: 0 }, activeResearch: 'beamOptics', researchProgress: 0 };
  const game = { state };
  const job = { jobType: 'analyze', specialty: null };

  const baselineLen = scientist.history.length;
  // efficiency 0.5 (skill 5, zoneTier 0) -> consumes 10 data/completion,
  // +10 researchProgress/completion. 0 -> 10 -> 20 -> 30: the THIRD
  // completion is the one that reaches `duration` exactly.
  onJobComplete(game, scientist, job);
  assertOk(scientist.history.length === baselineLen, `setup: no entry after completion 1 (progress ${state.researchProgress})`);
  onJobComplete(game, scientist, job);
  assertOk(scientist.history.length === baselineLen, `setup: no entry after completion 2 (progress ${state.researchProgress})`);
  onJobComplete(game, scientist, job);
  assertOk(state.researchProgress >= duration, `setup: the third completion reaches duration ${duration} (progress ${state.researchProgress})`);
  assertOk(scientist.history.length === baselineLen + 1,
    `a diary entry appears on the completion that finishes the research item (got ${scientist.history.length})`);
  assertOk(scientist.history[scientist.history.length - 1].event === 'research', 'the entry is event "research"');
  assertOk(scientist.stats.analyses === 3, `stats.analyses counts every completion regardless (got ${scientist.stats.analyses})`);

  // A fourth completion with no active research left (still capped-out
  // researchProgress, activeResearch untouched by this handler — clearing
  // it is research.tickResearch's own job, not analyze.js's) logs nothing
  // further either, since the boundary was already crossed once.
  onJobComplete(game, scientist, job);
  assertOk(scientist.history.length === baselineLen + 1, 'no repeated entry once the boundary has already been crossed');
}

// =============================================================================
// 7. History survives serialize() -> load() on a real Game.
// =============================================================================
console.log('\n=== 7. History survives serialize() -> load() ===\n');
{
  const { Game } = await import('../src/game/Game.js');
  const { BeamlineRegistry } = await import('../src/beamline/BeamlineRegistry.js');
  const { PARAM_DEFS } = await import('../src/beamline/component-physics.js');
  globalThis.COMPONENTS = COMPONENTS;
  globalThis.PARAM_DEFS = PARAM_DEFS;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const gA = new Game(new BeamlineRegistry(), { seed: 301 });
  const member = gA.state.staffMembers[0];
  logCareerEvent(member, 10, 'repair', 'Recovered the beam 10 times now.');
  logCareerEvent(member, 20, 'commission', 'Commissioned their first component: the Undulator.');
  const before = JSON.parse(JSON.stringify(member.history));

  localStorage.setItem('beamlineTycoon', gA.serialize());
  const gB = new Game(new BeamlineRegistry(), { seed: 302 });
  assertOk(gB.load(), 'load() succeeds on the saved payload');
  const after = gB.state.staffMembers[0].history;

  try {
    assert.deepStrictEqual(after, before);
    assertOk(true, 'history round-trips through serialize()/load() exactly, including the count field');
  } catch (e) {
    assertOk(false, 'history round-trips through serialize()/load() exactly\n' + e.message);
  }
}

// =============================================================================
console.log(`\n${passed}/${passed + failed} assertions passed`);
if (failed > 0) process.exit(1);
