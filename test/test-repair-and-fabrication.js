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
//
// Fix round 1 (coordinator review) adds:
//   8. An on-pipe component (role: 'placement' — quadrupole, BPM, RF
//      cavity, ...) that wears down gets a real repair offer, not
//      permanent silent decay — jobs.js's repairOffers used to filter to
//      module-kind nodes only.
//   9. A repair completing with 0 spares on the books (the race a
//      component purchase or a sibling repair can create between
//      assignment and completion) does not heal for free, does not drive
//      spares negative, and logs loudly instead of silently no-op-ing.
//
// Fix round 2 (coordinator review) finishes CRITICAL 1 and proves it:
//  10. The full on-pipe repair path end to end on a real Game: assigned,
//      resolveDestNode lands on a real approach node OUTSIDE the
//      component's footprint (not inside it), phase reaches 'work',
//      completes, consumes exactly one spare, heals a quadrupole (not a
//      module).
//  11. The negative: a fully walled-off on-pipe component gets NO
//      assignment at all, with a reason — not an assignment that then
//      stalls trying to reach somewhere unreachable.

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
    logs: [],
    // Recorded rather than printed — fix round 1's zero-spares race branch
    // (jobEffects/repair.js) logs loudly instead of silently no-op-ing, and
    // tests need to see it fired without polluting this run's own output.
    log(msg, type) { this.logs.push({ msg, type }); },
    // Duplicated from Game.spend (src/game/Game.js) — see header comment.
    // Floors `spares` at 0 (fix round 1) the same way the real one now
    // does, since test 9 below exercises exactly the race that floor exists
    // for.
    spend(costs) {
      if (this.sandboxMode) return;
      for (const [r, a] of Object.entries(costs)) {
        if (r === 'spares') this.state.resources[r] = Math.max(0, (this.state.resources[r] || 0) - a);
        else this.state.resources[r] -= a;
      }
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
  // Task 7 (staff-professions-3, jobs-and-gates) throttled repair's diary
  // entry (src/game/staff/jobEffects/repair.js, via careerLog.js's
  // logCareerEvent) to every TENTH repair, not every one — an unconditional
  // push per completion was itself the unbounded-history-growth hazard that
  // task closes (see repair.js's own HISTORY_LOG_EVERY comment and
  // test/test-admin-and-career.js's section 6a for the dedicated coverage).
  // A single completion therefore leaves history exactly where it started —
  // just the 'hired' entry — which is the assertion this test now makes,
  // in place of the pre-Task-7 "every repair gets its own line" behavior.
  assertOk(technician.history.length === 1 && technician.history[0].event === 'hired',
    `a single repair leaves history untouched — no diary entry until the tenth (got ${JSON.stringify(technician.history)})`);
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
// 8. Fix round 1, CRITICAL 1: an on-pipe component (role: 'placement' —
//    quadrupole, BPM, RF cavity, ...) that wears down gets a real repair
//    offer, not silent, permanent, un-repairable decay. Before this fix,
//    jobs.js's beamlineComponentNodes/repairOffers filtered to
//    `node.kind === 'module'` only, so a damaged on-pipe component (the
//    MAJORITY of the catalogue by count and by funding) never produced an
//    offer OR a suppression at any spares level — _applyWearForBeamline
//    (Game.js) wrote its componentHealth same as any module's, but nothing
//    downstream of that ever looked at it once _autoRepair was gone.
// =============================================================================
console.log('\n=== 8. On-pipe components get real repair offers (fix round 1) ===\n');
{
  const { Game } = await import('../src/game/Game.js');
  const { BeamlineRegistry } = await import('../src/beamline/BeamlineRegistry.js');
  const { DesignPlacer } = await import('../src/ui/DesignPlacer.js');
  const { STOCK_DESIGNS } = await import('../src/data/stock-designs.js');
  const { buildJobOffers, eligibleFor } = await import('../src/game/staff/jobs.js');

  // Small (4-component) real design with a source, a beamStop, and two
  // on-pipe placements (industrialLinac, ict) — built for real via
  // DesignPlacer.confirm() rather than hand-assembled, so the pipe geometry,
  // ports and registry entry are all exactly what the real game produces.
  const design = STOCK_DESIGNS.find(d => d.id === 'ebeam-crosslinker');
  assertOk(!!design, 'setup: ebeam-crosslinker stock design exists');

  const g = new Game(new BeamlineRegistry(), { seed: 55 });
  g.state.resources.funding = 1e9;
  g.state.resources.spares = 1e9;
  const dp = new DesignPlacer(g, { _renderCursors() {} });
  dp.start(design);
  dp.startCol = 2;
  dp.startRow = 2;
  dp._recompute();
  assertOk(dp.valid, `setup: design placement is valid (reason: ${dp.invalidReason})`);
  const placed = dp.confirm();
  assertOk(placed === true, 'setup: design placed for real');

  // Find the on-pipe industrialLinac's placement id.
  let linacId = null;
  for (const pipe of g.state.beamPipes || []) {
    const pl = (pipe.placements || []).find(p => p.type === 'industrialLinac');
    if (pl) { linacId = pl.id; break; }
  }
  assertOk(!!linacId, 'setup: found the on-pipe industrialLinac placement id');

  const entry = (g.registry.getAll() || [])[0];
  assertOk(!!entry?.beamState?.componentHealth, 'setup: the placed beamline has a componentHealth dict');
  entry.beamState.componentHealth[linacId] = 40; // damage it

  const { offers, suppressions } = buildJobOffers(g);
  const offer = offers.find(o => o.jobType === 'repair' && o.target?.nodeId === linacId);
  assertOk(!!offer, 'a repair offer was generated for the damaged on-pipe component');
  assertOk(!suppressions.some(s => s.target?.nodeId === linacId),
    'no suppression was recorded for it either — it is a real, live offer');

  if (offer) {
    const technician = new (await import('../src/game/staff/StaffMember.js')).StaffMember({
      id: 'tOnPipe', profession: 'technician', traits: [],
      skills: { operating: 5, technical: 5, research: 5, construction: 5, admin: 5 },
      rng: () => 0.5,
    });
    // No fromNode set: eligibleFor only runs the reachability probe when a
    // position is known (see its own doc comment), so this checks the
    // profession/skill/staleness gates without needing real pawn placement.
    const res = eligibleFor(technician, offer, g);
    assertOk(res.ok, `a technician is eligible for the on-pipe repair offer (reason: ${res.reason})`);
  }
}

// =============================================================================
// 9. Fix round 1, IMPORTANT 4: spares must never go negative. A repair
//    completing with 0 spares on the books does not heal, does not spend,
//    logs it loudly (not silently), and leaves the component damaged so
//    jobs.js's repairOffers re-offers it once spares exist again.
// =============================================================================
console.log('\n=== 9. Zero-spares race at completion: no negative inventory, no free heal ===\n');
{
  const state = makeState(1);
  floorRect(state, 0, 10, 0, 10);
  const beamline = placeDamagedBeamline(state, 'bl-1', 5, 5, 50);
  const game = makeGame(state, [beamline]);

  const technician = makeMember('technician', 't1');
  state.staffMembers = [technician];

  assignJobs(game);
  assertOk(technician.job?.jobType === 'repair', `setup: technician assigned repair (got ${technician.job?.jobType})`);
  arrive(technician);

  // Simulate the race the fix guards against: a beamline component purchase
  // (or a sibling repair) drains the shared pool to 0 between assignment and
  // this job's own completion tick.
  state.resources.spares = 0;

  const completedAt = runUntilComplete(game, technician);
  assertOk(completedAt >= 0, `the job still completes (tick ${completedAt}) — it is not stuck`);
  assertOk(beamline.beamState.componentHealth[beamline.sourceId] === 50,
    'the component was NOT healed for free when spares hit 0 at completion');
  assertOk(state.resources.spares === 0, 'spares did not go negative (still 0, not -1)');
  assertOk(technician.stats.repairs === 0, 'no repair credit for a completion that healed nothing');
  assertOk(game.logs.some(l => l.type === 'bad' && /no spares/i.test(l.msg)),
    `a loud log line fired for the silent-no-op guard (got ${JSON.stringify(game.logs)})`);
}

// =============================================================================
// 10. Fix round 2, CRITICAL 1 (finished): the whole on-pipe repair path,
//     end to end, on a real Game — the test the brief says was missing, and
//     whose absence is why deleting _autoRepair silently made most of the
//     catalogue unrepairable. Test 8 above proved an offer exists and
//     eligibleFor approves it; this proves assignJobs actually assigns it,
//     resolveDestNode resolves a real approach node OUTSIDE the component's
//     footprint (not the footprint cell itself — jobRunner.js's own
//     resolveTargetPlaceable used to only ever look in state.placeables,
//     where an on-pipe placement never lives, so resolveDestNode silently
//     returned null for exactly this target), the job reaches phase:
//     'work', completes, consumes exactly one spare, and heals the
//     component — a quadrupole, not a module.
// =============================================================================
console.log('\n=== 10. On-pipe repair, end to end: assign, walk, work, complete, heal ===\n');
{
  const { Game } = await import('../src/game/Game.js');
  const { BeamlineRegistry } = await import('../src/beamline/BeamlineRegistry.js');
  const { getNavGrid } = await import('../src/game/staff/nav.js');
  const { footprintCellsForPlacement, approachCandidates } = await import('../src/game/staff/jobs.js');

  // seed 105, cols -6/6 at row 20: the same combination
  // test-review-regressions.js's own "beam income counts hardware" section
  // already proves clear on the starter map.
  const g = new Game(new BeamlineRegistry(), { seed: 105 });
  const src = g.beamline.placeJunction({ type: 'source', col: -6, row: 20, dir: 3, free: true, silent: true });
  const det = g.beamline.placeJunction({ type: 'detector', col: 6, row: 20, dir: 3, free: true, silent: true });
  assertOk(!!src && !!det, 'setup: source and detector placed');
  const pipeId = g.beamline.drawPipe(
    { junctionId: src, portName: 'exit' },
    { junctionId: det, portName: 'entry' },
    [{ col: -6, row: 20 }, { col: 6, row: 20 }],
  );
  assertOk(!!pipeId, 'setup: pipe drawn between them');
  const quadId = g.beamline.placeOnPipe(pipeId, { type: 'quadrupole', position: 0.5, mode: 'snap', free: true });
  assertOk(!!quadId, 'setup: quadrupole mounted on the pipe');

  const entry = (g.registry.getAll() || [])[0];
  assertOk(!!entry?.beamState?.componentHealth, 'setup: registry entry exists with a componentHealth dict');
  entry.beamState.componentHealth[quadId] = 50;

  // Independently compute the real footprint/approach set the SAME way
  // jobRunner.js's targetFootprintCells now does, to cross-check the
  // assignment against it rather than a hardcoded coordinate.
  const pipe = g.state.beamPipes.find(p => p.id === pipeId);
  const placement = (pipe.placements || []).find(p => p.id === quadId);
  const footprint = footprintCellsForPlacement(pipe, placement);
  assertOk(footprint.length === 1, `setup: the on-pipe footprint is a single subtile (got ${footprint.length})`);
  const nav = getNavGrid(g.state);
  const candidates = approachCandidates(nav, g.state, footprint);
  assertOk(candidates.length > 0, 'setup: at least one real approach node exists outside the footprint');

  const technician = new StaffMember({
    id: 't-onpipe', profession: 'technician', traits: [],
    skills: { operating: 5, technical: 5, research: 5, construction: 5, admin: 5 },
    rng: () => 0.5,
  });
  g.state.staffMembers.push(technician);

  assignJobs(g);
  assertOk(technician.job?.jobType === 'repair', `technician assigned repair (got ${technician.job?.jobType})`);
  assertOk(technician.job?.target?.nodeId === quadId, 'the assigned target is the quadrupole, not a module');
  assertOk(!!technician.job?.destNode, 'a destination node was resolved (not stuck at null)');

  const dest = technician.job.destNode;
  const onFootprint = footprint.some(c => c.col === dest.col && c.row === dest.row
    && c.subCol === dest.subCol && c.subRow === dest.subRow);
  assertOk(!onFootprint, 'the technician walks to a node OUTSIDE the footprint, not the component itself');
  const isRealCandidate = candidates.some(c => c.col === dest.col && c.row === dest.row
    && c.subCol === dest.subCol && c.subRow === dest.subRow);
  assertOk(isRealCandidate, 'destNode is one of the real, independently-computed approach candidates');

  assertOk(technician.job.phase === 'travel', 'setup: job starts in phase travel');
  arrive(technician);
  assertOk(technician.job.phase === 'work', 'arrival flips phase to work');

  const beforeSpares = g.state.resources.spares;
  const completedAt = runUntilComplete(g, technician);
  assertOk(completedAt >= 0, `the repair completed (at tick ${completedAt})`);
  assertOk(g.state.resources.spares === beforeSpares - 1,
    `exactly one spare was consumed (got ${beforeSpares - g.state.resources.spares})`);
  assertOk(entry.beamState.componentHealth[quadId] > 50, 'the quadrupole was healed');
  assertOk(technician.stats.repairs === 1, 'stats.repairs credited');
}

// =============================================================================
// 11. The negative half of the same fix: a fully walled-off on-pipe
//     component must produce NO assignment at all, with a reason — not an
//     assignment that then stalls trying to walk somewhere unreachable.
// =============================================================================
console.log('\n=== 11. A walled-off on-pipe component is never assigned (with a reason) ===\n');
{
  const { Game } = await import('../src/game/Game.js');
  const { BeamlineRegistry } = await import('../src/beamline/BeamlineRegistry.js');
  const { footprintCellsForPlacement } = await import('../src/game/staff/jobs.js');

  const g = new Game(new BeamlineRegistry(), { seed: 105 });
  const src = g.beamline.placeJunction({ type: 'source', col: -6, row: 20, dir: 3, free: true, silent: true });
  const det = g.beamline.placeJunction({ type: 'detector', col: 6, row: 20, dir: 3, free: true, silent: true });
  const pipeId = g.beamline.drawPipe(
    { junctionId: src, portName: 'exit' },
    { junctionId: det, portName: 'entry' },
    [{ col: -6, row: 20 }, { col: 6, row: 20 }],
  );
  const quadId = g.beamline.placeOnPipe(pipeId, { type: 'quadrupole', position: 0.5, mode: 'snap', free: true });
  assertOk(!!quadId, 'setup: quadrupole mounted on the pipe');

  const entry = (g.registry.getAll() || [])[0];
  entry.beamState.componentHealth[quadId] = 50;

  // Seal the whole TILE the component's footprint subtile sits in — walling
  // only the subtile itself is not enough (2-3 of its 4 neighbors are
  // same-tile subtiles with no wall boundary to block at all, per
  // jobs.js's own approachCandidates comment); a fully boxed tile with no
  // door is the "sealed room" case reachableFromOutdoors exists to catch.
  const pipe = g.state.beamPipes.find(p => p.id === pipeId);
  const placement = (pipe.placements || []).find(p => p.id === quadId);
  const [{ col, row }] = footprintCellsForPlacement(pipe, placement);
  for (const edge of ['n', 's', 'e', 'w']) {
    g.state.wallOccupied[`${col},${row},${edge}`] = 'officeWall';
  }
  g.state.navRevision = (g.state.navRevision | 0) + 1;

  const technician = new StaffMember({
    id: 't-walled', profession: 'technician', traits: [],
    skills: { operating: 5, technical: 5, research: 5, construction: 5, admin: 5 },
    rng: () => 0.5,
  });
  g.state.staffMembers.push(technician);

  assignJobs(g);
  assertOk(technician.job === null, 'the technician was NOT assigned to the walled-off component');
  assertOk(typeof technician.idleReason === 'string' && technician.idleReason.length > 0,
    `a reason was given instead of a silent non-assignment (got "${technician.idleReason}")`);

  // The failure mode this guards against: an assignment that stalls forever
  // rather than never happening. Tick a while and confirm no job ever
  // appears and nothing heals.
  for (let t = 0; t < 30; t++) tickJobs(g);
  assertOk(technician.job === null, 'still no job after ticking — no assignment that then stalls');
  assertOk(entry.beamState.componentHealth[quadId] === 50, 'the walled-off component is still damaged');
}

// =============================================================================
console.log(`\n${passed}/${passed + failed} assertions passed`);
if (failed > 0) process.exit(1);
