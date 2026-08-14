// test/test-repair-and-fabrication.js — repair, fabrication, and the spares
// economy (src/game/staff/jobEffects/repair.js, .../fabricate.js). Task 5 of
// the staff-professions-3 (jobs-and-gates) plan.
//
// Two fixture styles, matching what each half of the task needs:
//
//   Section A — a lightweight hand-built state + fake `game`
//   ({ state, registry: { getAll() }, spend() }), same convention as
//   test-job-runner.js/test-job-board.js: no real Game instance, just enough
//   surface for jobRunner.js's assignJobs/tickJobs and the jobEffects
//   modules' completion handlers to run against. `spend` is duplicated from
//   Game.spend (src/game/Game.js) rather than imported — it's three lines,
//   and importing Game here would drag in the whole real placement/physics
//   stack section A has no use for. Fixture helpers (placeItem/floorRect/
//   bump/placeDamagedBeamline/makeMember/arrive) are themselves duplicated
//   from test-job-runner.js rather than imported from it, matching that
//   file's own stated convention of not sharing fixtures across test files.
//   Effects are the REAL ones: importing src/game/staff/jobEffects/repair.js
//   and .../fabricate.js registers them for real via jobRunner.js's own
//   registerJobEffect (last registration wins, and nothing in this file
//   re-registers 'repair'/'fabricate' with a stub) — unlike test-job-runner's
//   own repair test, which deliberately overrides the handler to just count
//   completions, this file's whole point is to exercise the real one.
//
//   Section B — a real Game instance (src/game/Game.js), the same
//   construction test-beamline-transaction.js uses, for the one assertion
//   that needs the real placement pipeline: a beamline junction's spares
//   cost, charged through chargeConstruction at the same call site funding
//   already goes through.
//
// Test list (mirrors the task-5 brief's own):
//   1. A damaged node with a technician and spares available heals on job
//      completion, and spares drops by one.
//   2. spares === 0 -> the node stays damaged, and the idle reason names
//      spares (the suppression message jobs.js's repairOffers already
//      produces — Task 1's own work, exercised here through assignJobs).
//   3. A machinist completing fabricate raises spares, more so at higher
//      construction.
//   4. Placing a beamline component deducts the computed spares cost, and
//      placement is refused (with nothing charged) when spares are short.
//   5. _autoRepair no longer exists anywhere in the source tree.
//   6. Nothing repairs while every technician is idle or still travelling.
//   7. Two technicians can never be double-assigned to the same damaged
//      component (the bug this task's own fix in jobRunner.js closes) — one
//      heals it and consumes the one spare it costs; the other gets turned
//      away with a reason naming the conflict, never a job.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { StaffMember } from '../src/game/staff/StaffMember.js';
import { assignJobs, tickJobs } from '../src/game/staff/jobRunner.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { COMPONENTS } from '../src/data/components.js';

// Registers the real completion effects (side effect of import — see header).
import '../src/game/staff/jobEffects/repair.js';
import '../src/game/staff/jobEffects/fabricate.js';

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// =============================================================================
// Section A fixtures (see header) — duplicated from test-job-runner.js.
// =============================================================================

function makeState(spares = 5) {
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
    resources: { funding: 0, reputation: 0, data: 0, spares },
    zoneConnectivity: {},
    navRevision: 0,
    tick: 0,
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
    // Duplicated from Game.spend (src/game/Game.js) — see header comment.
    spend(costs) {
      if (this.sandboxMode) return;
      for (const [r, a] of Object.entries(costs)) this.state.resources[r] -= a;
    },
  };
}

// A real 4x4-subtile 'source' module, registered as its own beamline with a
// seeded componentHealth for that one node — same convention as
// test-job-runner.js/test-job-board.js's placeSourceBeamline.
function placeDamagedBeamline(state, beamlineId, col, row, health) {
  const src = placeItem(state, 'source', col, row, 0, 0, 0);
  bump(state);
  return { id: beamlineId, sourceId: src.id, beamState: { componentHealth: { [src.id]: health } } };
}

const FLAT_SKILLS = { operating: 5, technical: 5, research: 5, construction: 5, admin: 5 };
function makeMember(profession, id, skillsOverride = {}) {
  return new StaffMember({
    id, profession, traits: [], skills: { ...FLAT_SKILLS, ...skillsOverride }, rng: () => 0.5,
  });
}

// Simulate the renderer reporting arrival (see jobRunner.js's header
// comment: only the renderer is supposed to flip this in the real game;
// this test stands in for it).
function arrive(member) { if (member.job) member.job.phase = 'work'; }

function runUntilComplete(game, member, maxTicks = 500) {
  for (let t = 0; t < maxTicks; t++) {
    tickJobs(game);
    if (member.job === null) return t;
  }
  return -1;
}

// =============================================================================
// 1. Repair heals the target and consumes exactly one spare.
// =============================================================================
console.log('\n=== 1. Repair heals the target and consumes one spare on completion ===\n');
{
  const state = makeState(5);
  floorRect(state, 0, 10, 0, 10);
  const beamline = placeDamagedBeamline(state, 'bl-1', 5, 5, 50);
  const game = makeGame(state, [beamline]);

  const technician = makeMember('technician', 't1');
  state.staffMembers = [technician];

  assignJobs(game);
  assertOk(technician.job?.jobType === 'repair', `technician assigned repair (got ${technician.job?.jobType})`);
  arrive(technician);

  const efficiency = technician.efficiency(0, technician.job.specialty);
  const expectedHealth = Math.min(100, 50 + 25 * efficiency);

  const completedAt = runUntilComplete(game, technician);
  assertOk(completedAt >= 0, `repair job completed (at tick ${completedAt})`);
  assertOk(
    Math.abs(beamline.beamState.componentHealth[beamline.sourceId] - expectedHealth) < 1e-9,
    `componentHealth healed by 25 * efficiency (${efficiency}) -> ${expectedHealth} (got ${beamline.beamState.componentHealth[beamline.sourceId]})`,
  );
  assertOk(state.resources.spares === 4, `spares dropped by exactly one (5 -> 4, got ${state.resources.spares})`);
  assertOk(technician.stats.repairs === 1, `technician.stats.repairs incremented (got ${technician.stats.repairs})`);
  const lastEntry = technician.history[technician.history.length - 1];
  assertOk(lastEntry?.event === 'repair' && lastEntry.note.includes(COMPONENTS.source.name),
    `history entry names the repaired component (got ${JSON.stringify(lastEntry)})`);
}

// =============================================================================
// 2. spares === 0 -> no repair happens, idle reason names spares.
// =============================================================================
console.log('\n=== 2. spares === 0: node stays damaged, idle reason names spares ===\n');
{
  const state = makeState(0);
  floorRect(state, 0, 10, 0, 10);
  const beamline = placeDamagedBeamline(state, 'bl-1', 5, 5, 50);
  const game = makeGame(state, [beamline]);

  const technician = makeMember('technician', 't1');
  state.staffMembers = [technician];

  assignJobs(game);
  assertOk(technician.job === null, 'technician was not assigned a repair job with zero spares');
  assertOk(technician.idleReason === 'No spares available to make the repair.',
    `idle reason names spares (got "${technician.idleReason}")`);

  for (let t = 0; t < 20; t++) tickJobs(game);
  assertOk(beamline.beamState.componentHealth[beamline.sourceId] === 50, 'component health is untouched');
  assertOk(state.resources.spares === 0, 'spares count is untouched');
}

// =============================================================================
// 3. Fabrication raises spares, more so at higher construction skill.
// =============================================================================
console.log('\n=== 3. Fabricate adds spares, scaling with construction skill ===\n');

function runFabricateOnce(constructionSkill) {
  const state = makeState(0);
  floorRect(state, 0, 10, 0, 10);
  placeItem(state, 'lathe', 4, 4, 0, 0, 0);
  bump(state);
  const game = makeGame(state, []);

  const machinist = makeMember('machinist', 'm1', { construction: constructionSkill });
  state.staffMembers = [machinist];

  assignJobs(game);
  if (machinist.job?.jobType !== 'fabricate') return null;
  arrive(machinist);
  const completedAt = runUntilComplete(game, machinist);
  if (completedAt < 0) return null;
  return { spares: state.resources.spares, sparesMade: machinist.stats.sparesMade };
}

{
  // Skill 1 (efficiency 0.1/tick) would need 1500 ticks to clear fabricate's
  // workTicks:150 — pick low/high values that both land well inside
  // runUntilComplete's default budget instead of chasing the true skill
  // floor.
  const low = runFabricateOnce(5);    // 1 + floor(5/3) = 2
  const high = runFabricateOnce(10);  // 1 + floor(10/3) = 4

  assertOk(!!low && !!high, 'setup: both fabrication jobs completed');
  assertOk(low.spares === 2, `construction 5 -> +2 spares (got ${low?.spares})`);
  assertOk(high.spares === 4, `construction 10 -> +4 spares (got ${high?.spares})`);
  assertOk(high.spares > low.spares, 'higher construction skill produces more spares');
  assertOk(low.sparesMade === 2 && high.sparesMade === 4,
    `stats.sparesMade tracks the amount produced (got ${low?.sparesMade}, ${high?.sparesMade})`);
}

// =============================================================================
// 4. Placing a beamline component charges a spares cost; short spares refuse it.
// =============================================================================
console.log('\n=== 4. Beamline component placement charges spares; refused when short ===\n');
{
  // Real Game instance — see header. Imported lazily (dynamic import) so
  // Section A's lightweight fixtures above never pay for constructing one.
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

  function placeJunctionSomewhere(g, type) {
    for (let row = 2; row < 40; row += 2) {
      for (let col = 2; col < 34; col += 2) {
        const id = g.beamline.placeJunction({ type, col, row, subCol: 0, subRow: 0, dir: 0 });
        if (id) return id;
      }
    }
    return null;
  }

  // source: cost.funding 200000 -> spares cost ceil(200000/5000) = 40.
  const SOURCE_FUNDING = COMPONENTS.source.cost.funding;
  const SOURCE_SPARES = Math.ceil(SOURCE_FUNDING / 5000);
  assertOk(SOURCE_FUNDING === 200000 && SOURCE_SPARES === 40, 'setup: source costs $200,000 / 40 spares');

  {
    const g = new Game(new BeamlineRegistry(), { seed: 101 });
    const beforeFunding = g.state.resources.funding;
    const beforeSpares = g.state.resources.spares;
    assertOk(beforeSpares >= SOURCE_SPARES, 'setup: default spares afford one source junction');

    const id = placeJunctionSomewhere(g, 'source');
    assertOk(!!id, 'setup: source junction placed');
    assertOk(g.state.resources.funding === beforeFunding - SOURCE_FUNDING, 'funding charged the source\'s cost');
    assertOk(g.state.resources.spares === beforeSpares - SOURCE_SPARES,
      `spares charged ceil(funding/5000) (got -${beforeSpares - g.state.resources.spares}, want -${SOURCE_SPARES})`);
  }

  {
    const g = new Game(new BeamlineRegistry(), { seed: 102 });
    g.state.resources.spares = SOURCE_SPARES - 1; // one short
    const beforeFunding = g.state.resources.funding;
    const beforeSpares = g.state.resources.spares;

    const id = placeJunctionSomewhere(g, 'source');
    assertOk(id === null, 'placement refused when spares are one short');
    assertOk(g.state.resources.funding === beforeFunding, 'funding untouched by the refused placement');
    assertOk(g.state.resources.spares === beforeSpares, 'spares untouched by the refused placement');
  }
}

// =============================================================================
// 5. _autoRepair no longer exists anywhere in the source tree.
// =============================================================================
console.log('\n=== 5. _autoRepair is gone ===\n');
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const gameSrc = readFileSync(path.join(here, '..', 'src', 'game', 'Game.js'), 'utf8');
  assertOk(!gameSrc.includes('_autoRepair'), 'the _autoRepair symbol does not appear in src/game/Game.js');
}

// =============================================================================
// 6. Nothing repairs while every technician is idle or still travelling.
// =============================================================================
console.log('\n=== 6. No repair effect while idle or travelling ===\n');
{
  // Idle: never assigned at all.
  const state = makeState(5);
  floorRect(state, 0, 10, 0, 10);
  const beamline = placeDamagedBeamline(state, 'bl-1', 5, 5, 50);
  const game = makeGame(state, [beamline]);
  const idleTech = makeMember('technician', 't-idle');
  state.staffMembers = [idleTech];

  for (let t = 0; t < 20; t++) tickJobs(game);
  assertOk(idleTech.job === null, 'setup: idle technician was never assigned a job');
  assertOk(beamline.beamState.componentHealth[beamline.sourceId] === 50, 'idle technician heals nothing');
  assertOk(state.resources.spares === 5, 'idle technician consumes no spares');
}
{
  // Travelling: assigned, but arrive() is deliberately never called.
  const state = makeState(5);
  floorRect(state, 0, 10, 0, 10);
  const beamline = placeDamagedBeamline(state, 'bl-1', 5, 5, 50);
  const game = makeGame(state, [beamline]);
  const travellingTech = makeMember('technician', 't-travel');
  state.staffMembers = [travellingTech];

  assignJobs(game);
  assertOk(travellingTech.job?.jobType === 'repair', 'setup: technician assigned repair');
  assertOk(travellingTech.job?.phase === 'travel', 'setup: job starts in phase travel');

  for (let t = 0; t < 20; t++) tickJobs(game);
  assertOk(travellingTech.job?.phase === 'travel', 'still travelling after ticking (arrive() never called)');
  assertOk(beamline.beamState.componentHealth[beamline.sourceId] === 50, 'a travelling technician heals nothing');
  assertOk(state.resources.spares === 5, 'a travelling technician consumes no spares');
}

// =============================================================================
// 7. Two technicians can never be double-assigned to the same damaged
//    component — the bug this task's jobRunner.js fix closes.
// =============================================================================
console.log('\n=== 7. Same damaged component is never double-assigned ===\n');
{
  const state = makeState(5);
  floorRect(state, 0, 10, 0, 10);
  const beamline = placeDamagedBeamline(state, 'bl-1', 5, 5, 50);
  const game = makeGame(state, [beamline]);

  const tech1 = makeMember('technician', 't1');
  const tech2 = makeMember('technician', 't2');
  state.staffMembers = [tech1, tech2];

  assignJobs(game);
  assertOk(tech1.job?.jobType === 'repair', `tech1 assigned repair (got ${tech1.job?.jobType})`);
  assertOk(tech2.job === null, 'tech2 was NOT also assigned repair on the same target');
  assertOk(tech2.idleReason === 'Someone else is already repairing that component.',
    `tech2's idle reason names the conflict (got "${tech2.idleReason}")`);

  arrive(tech1);
  const completedAt = runUntilComplete(game, tech1);
  assertOk(completedAt >= 0, `tech1's repair completed (at tick ${completedAt})`);
  assertOk(state.resources.spares === 4, `exactly one spare consumed total (got ${state.resources.spares})`);
  assertOk(tech1.stats.repairs === 1 && tech2.stats.repairs === 0,
    `only tech1 gets credit for the repair (got ${tech1.stats.repairs}, ${tech2.stats.repairs})`);
}

// =============================================================================
console.log(`\n${passed}/${passed + failed} assertions passed`);
if (failed > 0) process.exit(1);
