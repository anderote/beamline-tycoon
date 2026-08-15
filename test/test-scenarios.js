// test/test-scenarios.js — scenario content regression net.
//
// Every scenario in src/data/scenarios.js must boot headless and come up
// GREEN under utility gating: apply the generated map, run the optional
// setup(game) hook, tick ~20 times, and assert zero hard infra blockers.
// Scenarios that ship a beamline must also be able to actually START the
// beam (toggleBeam → status 'running' → state.beamOn).
//
// This is the safety net for future content changes: new gating rules, new
// utility demands, or component removals that invalidate a scripted layout
// fail here instead of at scenario load in the browser.
//
// Also sweeps every tutorial step and objective condition against the ticked
// scenario states — conditions referencing removed systems or renamed state
// fields throw here instead of silently breaking the checklist UI.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { TUTORIAL_STEPS } from '../src/data/tutorial.js';
import { OBJECTIVES } from '../src/data/objectives.js';
import { listUtilityEndpoints } from '../src/utility/utility-endpoints.js';
import { declaredSinkQualityFloor, UTILITY_TO_QUALITY_FIELD } from '../src/game/utility-gate.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// Autosave (tick % 10) writes through localStorage; back it with a Map.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// Headless tests have no renderer to report pawn arrival (that's
// StaffPawns.js's job — see jobRunner.js's own header comment on
// job.phase), so every game.tick() call here also instantly completes any
// in-flight walk. Same shim test-job-runner.js's own arrive() helper covers
// for a single member.
function withInstantArrival(game) {
  const rawTick = game.tick.bind(game);
  game.tick = (...args) => {
    const result = rawTick(...args);
    for (const m of (game.state.staffMembers || [])) {
      if (m.job && m.job.phase === 'travel') m.job.phase = 'work';
    }
    return result;
  };
  return game;
}

function bootScenario(scenario) {
  const game = withInstantArrival(new Game(new BeamlineRegistry(), { seed: 1234 }));
  const mapData = scenario.generator();
  game.applyScenario(mapData);
  if (scenario.setup) scenario.setup(game);
  game.recalcAllBeamlines();
  // Deliberately does NOT toggle any beamline on: jobRunner's runBeam cap
  // counts REGISTERED beamlines (src/game/staff/jobRunner.js's
  // beamlineCount), not only running ones, so the seeded operator gets
  // offered — and, over these 20 ticks, seated at — the scenario's console
  // regardless of whether the beamline itself has ever been started. That's
  // what makes `infraCanRun` true below without this helper having to press
  // Start on the player's behalf; the dedicated "beamline is startable"
  // block further down does that itself, from a genuinely cold 'stopped'
  // registry entry.
  for (let i = 0; i < 20; i++) game.tick();
  return game;
}

const tickedGames = [];

for (const scenario of SCENARIOS) {
  if (!scenario.generator) continue; // sandbox = blank game
  console.log(`\n--- Scenario: ${scenario.id} ---`);

  const game = bootScenario(scenario);
  tickedGames.push(game);
  const state = game.state;

  const hard = (state.infraBlockers || []).filter(b => b.severity === 'hard');
  assert(hard.length === 0,
    `no hard infra blockers after 20 ticks (got ${JSON.stringify(hard.map(b => b.code))})`);
  assert(state.infraCanRun === true, 'infraCanRun true');
  assert((state.staffMembers || []).some(m => m.profession === 'operator'),
    'operator pawn seeded');

  // Blocker-free is not the same as served. Unwired sinks fail CLOSED to
  // quality 0, and dataFiber never hard-blocks at all, so a scenario could be
  // green and still run every cavity at zero. Assert the qualities directly,
  // over every endpoint — pipe placements included.
  // Only the 0-1 QUALITY fields are checked. The floor also carries physical
  // quantities (rfPowerW, cryoTempK, coolingDeltaT, vacuumPressure) where
  // "good" is not uniformly "greater than zero" — a well-cooled component sits
  // at coolingDeltaT 0, and a cold cavity wants a LOW cryoTempK. Those have
  // their own directional fail-closed values in UTILITY_PHYSICAL_FIELDS.
  const QUALITY_FIELDS = new Set(Object.values(UTILITY_TO_QUALITY_FIELD));
  const starved = [];
  for (const e of listUtilityEndpoints(state)) {
    const floor = declaredSinkQualityFloor(e.type);
    if (!floor) continue;
    const nq = state.nodeQualities?.[e.id] || {};
    for (const field of Object.keys(floor)) {
      if (!QUALITY_FIELDS.has(field)) continue;
      if (!(nq[field] > 0)) starved.push(`${e.type}.${field}=${nq[field]}`);
    }
  }
  assert(starved.length === 0,
    `every declared sink is served (starved: ${starved.join(', ') || 'none'})`);

  // A wired vacuum network must actually pump down. Pressure comes from the
  // solver's P = Q/S and now includes beam-pipe surface area, so a scenario
  // that ships pumps but under-sizes them for its pipe length would show up
  // here rather than silently running a scattered beam.
  if ((state.beamPipes || []).length > 0) {
    game.computeSystemStats();
    assert(state.avgPressure < 1013,
      `wired vacuum network pumps down (got ${state.avgPressure})`);
  }

  const junctions = state.placeables.filter(p => p.category === 'beamline');
  if (junctions.length > 0) {
    // Scenario ships a beamline — it must be startable. bootScenario never
    // toggles it on (see its own comment), so this starts genuinely cold: a
    // 'stopped' registry entry whose operator is nonetheless already seated
    // (the registered-beamline cap fix means staffing doesn't wait on the
    // toggle at all), so the toggle itself should succeed cleanly.
    const sourceJ = junctions.find(p => COMPONENTS[p.type]?.isSource);
    assert(!!sourceJ, 'beamline has a source junction');
    const entry = game.registry.getAll().find(e => e.sourceId === sourceJ?.id);
    assert(!!entry, 'registry entry exists for the source');
    if (entry) {
      game.toggleBeam(entry.id);
      assert(entry.status === 'running', `beam starts (status=${entry.status})`);
      for (let i = 0; i < 5; i++) game.tick();
      assert(state.beamOn === true, 'state.beamOn true after ticking with beam running');
      assert(entry.status === 'running', 'beam stays running over 5 more ticks');
      // 'running' is not 'producing'. A beam whose elements carry the
      // fail-closed infraQuality floor stays green on status while emitting
      // nothing, which is how the gate-vs-recalc ordering bug shipped once.
      const accelerates = (state.beamline || [])
        .some(n => (COMPONENTS[n.type]?.stats?.energyGain || 0) > 0);
      if (accelerates) {
        assert(entry.beamState.beamEnergy > 0,
          `wired beamline actually produces energy (${entry.beamState.beamEnergy})`);
      }
    }
  }
}

// --- smallBeamlineFacility specifics -------------------------------------
{
  console.log('\n--- smallBeamlineFacility: layout details ---');
  const scenario = SCENARIOS.find(s => s.id === 'smallBeamlineFacility');
  const game = bootScenario(scenario);
  const state = game.state;

  assert((state.beamPipes || []).length === 1, 'one beam pipe drawn');
  const placements = (state.beamPipes[0]?.placements || []).map(pl => pl.type).sort();
  assert(placements.length === 6,
    `six pipe placements (got ${placements.join(',')})`);
  assert(placements.filter(t => t === 'pillboxCavity').length === 3,
    'three pillbox cavities on the pipe');

  // Wiring: transformer → main panel is one HV feeder, then eight branch circuits off the main panel.
  // eight sockets (2 junctions + 5 support units + the power bus), 5 vacuum
  // (2 junctions + 2 manifolds + the turbo's tap), 1 RF into the waveguide
  // manifold, 2 cooling, 2 data = 19 lines. Four of them are bus feeds standing
  // in for what would otherwise be 16 per-component stubs.
  assert((state.utilityLines?.size || 0) === 19,
    `nineteen utility lines wired (got ${state.utilityLines?.size})`);
  const hvLines = [...(state.utilityLines?.values() || [])]
    .filter(l => l.utilityType === 'hvCable');
  assert(hvLines.length === 1, `transformer feeds the main panel with one HV feeder (got ${hvLines.length})`);
  const branch = [...(state.utilityLines?.values() || [])]
    .filter(l => l.utilityType === 'powerCable');
  assert(new Set(branch.map(l => l.start.portName)).size === branch.length,
    'every branch circuit takes its own socket on the panel');

  // The buses must be what serves the on-pipe components — that is the whole
  // point of shipping them in the starter layout. Cut the bus feeds and the
  // hard blockers have to come back.
  {
    const cutGame = bootScenario(scenario);
    const busIds = new Set(cutGame.state.placeables
      .filter(p => ['powerBus', 'vacuumManifold', 'waveguideManifold'].includes(p.type))
      .map(p => p.id));
    for (const [id, line] of cutGame.state.utilityLines) {
      if (busIds.has(line.end?.placeableId) || busIds.has(line.start?.placeableId)) {
        cutGame.utilityLineSystem.removeLine(id);
      }
    }
    for (let i = 0; i < 3; i++) cutGame.tick();
    const cutHard = (cutGame.state.infraBlockers || []).filter(b => b.severity === 'hard');
    // 3 power + 5 vacuum + 4 RF. Of the 16 on-pipe sinks the buses were
    // serving, four now ride adjacency bridging instead: the placements that
    // physically touch the wired end junctions pick power and vacuum up from
    // them, and pass it down the string. RF is the control here — it does not
    // bridge (rfWaveguide.bridgesAdjacent = false), so all four RF sinks come
    // back exactly as they did before. The quad's stub-fed cooling and the
    // junctions' own feeds are untouched either way.
    const byUtil = cutHard.reduce((a, b) => {
      a[b.code] = (a[b.code] || 0) + 1; return a;
    }, {});
    assert(cutHard.length === 12,
      `cutting the 4 bus feeds re-blocks 12 on-pipe sinks (got ${cutHard.length}: `
      + `${JSON.stringify(byUtil)})`);
    assert(byUtil.rf_unconnected === 4,
      `every RF sink comes back — RF does not bridge (got ${byUtil.rf_unconnected})`);
  }

  // Prebuilt facility must not eat the starting budget (checked before any
  // ticks so the running economy doesn't muddy the number).
  const fresh = new Game(new BeamlineRegistry(), { seed: 7 });
  const funding0 = fresh.state.resources.funding;
  fresh.applyScenario(scenario.generator());
  scenario.setup(fresh);
  assert(fresh.state.resources.funding === funding0,
    `starting funding preserved by setup (${fresh.state.resources.funding} vs ${funding0})`);

  // Differentiated demands: power network must show real numbers, not the
  // old flat 50-per-sink placeholder. Demand covers the on-pipe sinks the bus
  // pulls in — a bus distributes, it does not generate, so the transformer
  // still has to carry them.
  // Power is a radial two-stage chain: facility transformer → matching main panel.
  const hvFlows = state.utilityNetworkData?.get?.('hvCable');
  const hvFlowValues = hvFlows ? [...hvFlows.values()] : [];
  assert(hvFlowValues.some(f => f.totalCapacity === 400 && f.totalDemand === 400),
    `transformer feeds switchgear at 400 kW (${JSON.stringify(hvFlowValues)})`);
  assert(hvFlowValues.some(f => f.totalCapacity === 400 && f.totalDemand === 400),
    `transformer feeds the main panel's 400 kW rating (${JSON.stringify(hvFlowValues)})`);

  const powerFlows = state.utilityNetworkData?.get?.('powerCable');
  const flow = powerFlows && [...powerFlows.values()][0];
  assert(!!flow && flow.totalCapacity === 160,
    `the busway applies its 160 kW field rating (got ${flow?.totalCapacity})`);
  // gun 50 + cup 1 + buncher 1 + 3x cavity 3 + quad 10 + bpm 1
  //   + skid 3 + amp 70 + ioc 0.5 + roughing 0.5 + turbo 1
  // RF output is supplied by the amp; the buncher/cavity power feeds carry
  // only the separately billed local auxiliaries.
  assert(!!flow && flow.totalDemand === 147,
    `whole-facility demand = 147 kW (got ${flow?.totalDemand})`);

  // The 162.5 MHz cavities have an RF source that actually covers their band
  // (the SSA) — a frequency mismatch is only a SOFT error, so it would
  // otherwise sail past the blocker check at quality 0. totalCapacity counts
  // eligible sources only, so 35 here also proves the SSA is in band.
  const rfFlows = state.utilityNetworkData?.get?.('rfWaveguide');
  const rfFlow = rfFlows && [...rfFlows.values()][0];
  assert(!!rfFlow && rfFlow.totalDemand === 17 && rfFlow.totalCapacity === 35,
    `RF: 17 kW of 162.5 MHz demand against 35 kW of in-band capacity (got ${rfFlow?.totalDemand}/${rfFlow?.totalCapacity})`);
}

// --- tutorial + objective conditions run without throwing -----------------
{
  console.log('\n--- tutorial/objective condition sweep ---');
  // Sweep against every ticked scenario state AND a blank game (fresh-boot
  // shape), so conditions can't depend on fields only scenarios create.
  const blank = new Game(new BeamlineRegistry(), { seed: 99 });
  for (let i = 0; i < 3; i++) blank.tick();
  const states = [...tickedGames.map(g => g.state), blank.state];

  let stepThrew = null;
  for (const st of states) {
    for (const step of TUTORIAL_STEPS) {
      try { step.condition(st); }
      catch (e) { stepThrew = `${step.id}: ${e.message}`; }
    }
  }
  assert(!stepThrew, `tutorial conditions evaluate cleanly${stepThrew ? ` (${stepThrew})` : ''}`);

  let objThrew = null;
  for (const st of states) {
    for (const obj of OBJECTIVES) {
      try { obj.condition(st); }
      catch (e) { objThrew = `${obj.id}: ${e.message}`; }
    }
  }
  assert(!objThrew, `objective conditions evaluate cleanly${objThrew ? ` (${objThrew})` : ''}`);

  // No objective may reference a component type that no longer exists.
  const objectivesSrc = OBJECTIVES.map(o => o.condition.toString()).join('\n');
  const typeRefs = [...objectivesSrc.matchAll(/type === '([A-Za-z0-9]+)'/g)].map(m => m[1]);
  const missing = typeRefs.filter(t => !COMPONENTS[t]);
  assert(missing.length === 0,
    `objective component references all exist (missing: ${missing.join(',') || 'none'})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
