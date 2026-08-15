// scripts/balance-sim.mjs — headless economy balance simulation.
//
// Four scripted runs. A/B/C are steady-state rate measurements printing a
// tick-by-100 table of funds / reputation / cumulative refill spend each; D is
// a whole PLAYTHROUGH and is the one progression tuning reads.
//
//   A) Fresh sandbox doing nothing. Target: survives >300 ticks (funds stay
//      positive) on starting money — passive income vs the seeded operator.
//   B) smallBeamlineFacility scenario with its beamline running. Target:
//      net-positive but not explosive; reservoir refills show up as a
//      recurring cost.
//   C) A late-game-ish build (second, bigger beamline + detector + its own RF
//      plant and cooling loop + a real staff roster + decorations). Target:
//      strong gross income with upkeep (staff + power + pumps + refills)
//      eating 20-70% of gross.
//   D) A full playthrough from the starter facility to the top of the tech
//      tree, with a scripted research-purchase and facility-expansion policy.
//      Target: 28,800 ticks (~8 h at 1x). Reports per-tier completion ticks,
//      the funds/reputation/data trajectory, what the run was BLOCKED on, and
//      the ratio against the target. Lives in scripts/balance-playthrough.mjs.
//
// Run: node scripts/balance-sim.mjs           (A/B/C — D is opt-in, it is slow)
//      node scripts/balance-sim.mjs bc        (pick runs by letter)
//      node scripts/balance-sim.mjs d         (the playthrough table)
//      node scripts/balance-sim.mjs d --sweep (run length vs build-out size)
//      node scripts/balance-sim.mjs d --no-expand --max-ticks=400000
//      flags: --seed --max-ticks --sample --max-lines --detectors --no-expand
//
// This is the tuning companion to test/test-economy-balance.js, which encodes
// A/B/C's targets as loose assertions and imports run C's build recipe from
// here so the two cannot describe different facilities.
//
// Last tuned after on-pipe utility gating landed (Phase 11): every component
// on a pipe now has to be fed, which made an RF source, a cooling loop and a
// distribution bus mandatory rather than optional. Re-measured once the gate's
// solved qualities actually reached the physics pass (beamQuality reads 0.99
// here, not the 0.51 the fail-closed floor latched at before
// Game._syncPhysicsToNodeQualities), with beamIncomePerNode re-derived
// 300 -> 240 against the fixed beam:
//   A  -10.0/t          upkeep 119.8/t   (staff only) — idles ~250k ticks
//   B +1306.8/t 15.6%   upkeep 241.2/t   (staff 120, power 98, pumps 16, refill 7)
//   C +2557.0/t 43.5%   upkeep 1970.1/t  (staff 1150, power 623, pumps 24, refill 173)
//
// Run D's baseline, measured before any Phase-12 tuning (`d --sweep`, seed 909;
// "extra lines" is the cap on beamlines the expansion ladder may add):
//   lines | tree done |   ticks | ratio | income/tick | blocked on
//       0 |     54/68 | 150,000+|    -- |       1,843 | funding 97%
//       2 |     68/68 | 114,034 |  3.96 |       5,733 | funding 95%
//       4 |     68/68 |  78,175 |  2.71 |       8,455 | funding 94%
//       8 |     68/68 |  50,264 |  1.75 |      13,435 | funding 91%
//      16 |     68/68 |  32,502 |  1.13 |      21,646 | funding 87%
//      24 |     68/68 |  26,238 |  0.91 |      27,879 | funding 86%
// Read it as: run length is set almost entirely by how many identical beamlines
// the player builds, because beam income is linear in hardware node count with
// no diminishing return. One cup line — $3.37M at the time of this baseline,
// $3.83M now that the drift pipe and the wiring are priced into it — adds
// ~1,100/tick net and pays back in ~3,000 ticks, so line-spam is strictly
// dominant and the tree's price tag is not what paces the game.
//   `d --no-expand` (no labs either): NEVER finishes. 31 of 68 nodes stay
//   unreachable and 95% of the run is blocked on labTier — the shipped starter
//   facility has no opticsLab / coolingLab / diagnosticsLab / machineShop, and
//   RESEARCH_SPEED_TABLE blocks depth-5+ and final nodes below lab tier 1/2.
//   Reputation blocked 0% of every run measured; data under 2%.

import './balance-env.mjs';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { wireUtility } from '../src/data/scenarios/scenario-wiring.js';
import { createStaffMember } from '../src/game/staff/staffSystem.js';
import { computeTickUpkeep } from '../src/game/economy.js';
import { OBJECTIVES } from '../src/data/objectives.js';
import {
  runPlaythrough, printPlaythrough, runSweep, autoRefill,
} from './balance-playthrough.mjs';

function mkGame(seed) {
  return new Game(new BeamlineRegistry(), { seed });
}

// ---------------------------------------------------------------------------
// Run loop with tick-by-100 reporting and upkeep/gross bookkeeping.
// ---------------------------------------------------------------------------
function runSim(name, game, ticks, { refill = true, measureFrom = 0 } = {}) {
  const state = game.state;
  console.log(`\n=== ${name} ===`);
  console.log('tick | funding    | d/tick  | rep    | refills$ | upkeep/t | gross/t | upk%  | up%');
  console.log('-----+------------+---------+--------+----------+----------+---------+-------+-----');

  let refillSpent = 0;
  let windowStartFunds = state.resources.funding;
  let windowRefill = 0;
  let windowUpkeep = 0;
  let windowBeamOn = 0;
  // steady-state accumulators (from measureFrom)
  let ssUpkeep = 0, ssStartFunds = null;
  const ssParts = { staffCost: 0, pumpUpkeep: 0, powerBill: 0 };

  const row = (t) => {
    const dt = t === 0 ? 1 : 100;
    const f = state.resources.funding;
    const d = (f - windowStartFunds) / dt;
    const upk = (windowUpkeep + windowRefill) / dt;
    const gross = d + upk;
    const pct = gross > 0 ? (100 * upk / gross) : NaN;
    console.log(
      String(t).padStart(4) + ' | ' +
      ('$' + Math.round(f).toLocaleString()).padStart(10) + ' | ' +
      d.toFixed(1).padStart(7) + ' | ' +
      state.resources.reputation.toFixed(1).padStart(6) + ' | ' +
      ('$' + Math.round(refillSpent).toLocaleString()).padStart(8) + ' | ' +
      upk.toFixed(1).padStart(8) + ' | ' +
      gross.toFixed(1).padStart(7) + ' | ' +
      (Number.isNaN(pct) ? '  -- ' : pct.toFixed(0).padStart(4) + '%') + ' | ' +
      (100 * windowBeamOn / dt).toFixed(0).padStart(3) + '%');
    windowStartFunds = f;
    windowRefill = 0;
    windowUpkeep = 0;
    windowBeamOn = 0;
  };

  for (let t = 1; t <= ticks; t++) {
    const fundsBefore = state.resources.funding;
    game.tick();
    const upkeep = computeTickUpkeep(state);
    windowUpkeep += upkeep.total;
    if (refill) {
      const s = autoRefill(game);
      refillSpent += s;
      windowRefill += s;
    }
    if (state.beamOn) windowBeamOn++;

    if (t >= measureFrom) {
      if (ssStartFunds === null) ssStartFunds = fundsBefore;
      ssUpkeep += upkeep.total;
      for (const k of Object.keys(ssParts)) ssParts[k] += upkeep[k];
    }
    if (t % 100 === 0) row(t);
  }
  // steady-state summary
  const ssTicks = ticks - measureFrom + 1;
  if (ssStartFunds !== null && ssTicks > 0) {
    const dFunds = state.resources.funding - ssStartFunds;
    const totalUpkeep = ssUpkeep + refillSpent; // refillSpent ~ all after measureFrom for our runs
    const gross = dFunds + totalUpkeep;
    console.log(`steady-state [${measureFrom}..${ticks}]: dFunds=${Math.round(dFunds)} ` +
      `(${(dFunds / ssTicks).toFixed(1)}/t), upkeep=${Math.round(totalUpkeep)} ` +
      `(${(totalUpkeep / ssTicks).toFixed(1)}/t), gross=${Math.round(gross)} ` +
      `(${(gross / ssTicks).toFixed(1)}/t), upkeepFrac=${gross > 0 ? (100 * totalUpkeep / gross).toFixed(1) : '--'}%`);
    // Split the upkeep — tuning needs to know whether the bill is people,
    // electricity or consumables before anyone touches a coefficient.
    console.log('  upkeep split: ' +
      `staff=${(ssParts.staffCost / ssTicks).toFixed(1)}/t ` +
      `power=${(ssParts.powerBill / ssTicks).toFixed(1)}/t ` +
      `pumps=${(ssParts.pumpUpkeep / ssTicks).toFixed(1)}/t ` +
      `refills=${(refillSpent / ssTicks).toFixed(1)}/t`);
  }
  const quality = state.beamQuality ?? 0;
  console.log(`final: funding=$${Math.round(state.resources.funding).toLocaleString()} ` +
    `rep=${state.resources.reputation.toFixed(1)} data=${Math.round(state.resources.data)} ` +
    `beamQuality=${quality.toFixed(2)} blockers=${(state.infraBlockers || []).map(b => b.code).join(',') || 'none'}`);
  return game;
}

// ---------------------------------------------------------------------------
// Run A — fresh sandbox, do nothing.
// ---------------------------------------------------------------------------
function runA() {
  const game = mkGame(101);
  runSim('A: fresh sandbox, idle', game, 600, { refill: false });
}

// ---------------------------------------------------------------------------
// Run B — smallBeamlineFacility scenario, beam on.
// ---------------------------------------------------------------------------
function bootSmallFacility(seed) {
  const scenario = SCENARIOS.find(s => s.id === 'smallBeamlineFacility');
  const game = mkGame(seed);
  game.applyScenario(scenario.generator());
  scenario.setup(game);
  // Pre-complete every objective: milestone grants are one-time story money
  // and would drown the per-tick economy this sim measures.
  game.state.completedObjectives = OBJECTIVES.map(o => o.id);
  game.recalcAllBeamlines();
  return game;
}

function startAllBeams(game) {
  game.tick(); // let the gate see the wired topology
  for (const entry of game.registry.getAll()) {
    if (entry.status !== 'running') game.toggleBeam(entry.id);
  }
}

function runB() {
  const game = bootSmallFacility(202);
  startAllBeams(game);
  runSim('B: smallBeamlineFacility, beam running', game, 1500, { measureFrom: 200 });
}

// ---------------------------------------------------------------------------
// The late-game build — a second, bigger beamline with a detector, its own RF
// plant and cooling loop, a fuller staff roster and decorations. Built on top
// of a smallBeamlineFacility game (flat terrain, starter line keeps running).
//
// Exported because test/test-economy-balance.js pins its numbers: the test and
// the tuning sim MUST measure the same facility, and when they were two copies
// of the recipe the test's copy silently stopped being wired.
// ---------------------------------------------------------------------------
export function buildLateGameFacility(game, { log = console.error } = {}) {
  const state = game.state;

  // Bigger line on open flat ground south of the building (rows >= 8).
  const src2 = game.beamline.placeJunction({ type: 'source', col: -6, row: 10, dir: 3, free: true, silent: true });
  const det = game.beamline.placeJunction({ type: 'detector', col: 6, row: 10, dir: 3, free: true, silent: true });
  if (!src2 || !det) { log('C: junction placement failed', { src2, det }); return false; }
  const pipe = game.beamline.drawPipe(
    { junctionId: src2, portName: 'exit' },
    { junctionId: det, portName: 'entry' },
    [{ col: -6, row: 10 }, { col: 6, row: 10 }],
  );
  if (!pipe) { log('C: drawPipe failed'); return false; }
  const onPipe = [];
  for (const [type, position] of [
    ['buncher', 0.06], ['rfCavity', 0.18], ['rfCavity', 0.30], ['rfCavity', 0.42],
    ['quadrupole', 0.54], ['rfCavity', 0.64], ['quadrupole', 0.76], ['bpm', 0.88],
  ]) {
    const ok = game.beamline.placeOnPipe(pipe, { type, position, mode: 'snap', free: true });
    if (!ok) log('C: placeOnPipe failed', type, position);
    onPipe.push(ok);
  }
  const bpm2 = onPipe[7];

  const place = (type, col, row) => {
    const id = game.placePlaceable({ type, col, row, free: true, silent: true });
    if (!id) log('C: placePlaceable failed', type, col, row);
    return id;
  };
  // Service row (8), two north of the line. Sizing, all of it forced by the
  // on-pipe demands that now gate individually:
  //   power ~830 kW (240 of it the four rfCavities, 380 the RF plant) -> the
  //     1200 kW HV transformer, not the 400 kW switchgear;
  //   RF at two frequencies — 2856 MHz cavities and a 162.5 MHz buncher — so a
  //     multibeam klystron for the cavities plus an SSA for the buncher;
  //     see the TODO(balance) on the waveguide wiring below;
  //   cooling 586 kW -> two 300 kW chillers;
  //   data 41 -> a 40-capacity network switch alongside the IOC.
  const hv   = place('hvTransformer', -6, 8);
  const mbk  = place('multibeamKlystron', -3, 8);
  const ssa2 = place('solidStateAmp', -1, 8);
  const tp   = place('turboPump', 0, 8);
  const ioc2 = place('rackIoc', 1, 8);
  const nsw  = place('networkSwitch', 2, 8);
  const ch1  = place('chiller', 3, 8);
  // Second chiller on the far side of the line: its drop would otherwise have
  // to share the service row with the west chiller's run to the detector, and
  // two lines of one utility may not overlap unless they share a source.
  const ch2  = place('chiller', 3, 11);

  // Distribution row (9), hard against the line. One power bus and one
  // waveguide manifold span the run; vacuum only reaches 5 cells, so it takes
  // two manifolds. Cooling takes two as well, one per chiller — not for reach
  // but so each chiller gets its own drop; both manifolds cover the same
  // middle cavities, which unions them into a single 600 kW loop.
  const pwrBus2  = place('powerBus', 0, 9);
  // Two distribution panels: eight sockets each, ten loads to feed.
  const mcc1     = place('mcc', -6, 11);
  // The second panel sits with the plant it feeds. Circuits are point to point
  // now, so a panel on the far side of the hall means ten long runs sharing one
  // aisle — put distribution where its loads are, which is the decision the
  // chain exists to create.
  const mcc2     = place('mcc', 2, 12);
  const wgBus2   = place('waveguideManifold', -2, 9);
  const coolW2   = place('coolingManifold', 1, 9);
  const coolE2   = place('coolingManifold', 5, 11);
  const vacW2    = place('vacuumManifold', -3, 9);
  const vacE2    = place('vacuumManifold', 3, 9);

  const wire = (util, from, to) => {
    const id = wireUtility(game, util, from, to);
    if (!id) log('C: wire failed', util, from.id, '->', to.id);
  };
  // Power runs supply -> HV -> distribution -> branch circuits. Ten loads here,
  // and a cable is point to point, so they need ten sockets: two MCCs off two
  // of the transformer's four HV feeders.
  if (hv && mcc1) wire('hvCable', { id: hv, port: 'hv_out_1' }, { id: mcc1, port: 'hv_in' });
  if (hv && mcc2) wire('hvCable', { id: hv, port: 'hv_out_2' }, { id: mcc2, port: 'hv_in' });
  const westLoads = [[src2, 'pwr_in'], [mbk, 'pwr_in'], [ssa2, 'pwr_in'],
    [tp, 'pwr_in'], [ioc2, 'pwr_in'], [nsw, 'pwr_in'], [pwrBus2, 'pwr_in']];
  const eastLoads = [[det, 'pwr_in'], [ch1, 'pwr_in'], [ch2, 'pwr_in']];
  for (const [panel, loads] of [[mcc1, westLoads], [mcc2, eastLoads]]) {
    loads.forEach(([id, port], i) => {
      if (id && panel) wire('powerCable', { id: panel, port: `pwr_out_${i + 1}` }, { id, port });
    });
  }
  if (tp) {
    for (const [id, port] of [[src2, 'vac_in'], [det, 'vac_in'],
      [vacW2, 'bus_left'], [vacE2, 'bus_left']]) {
      if (id) wire('vacuumPipe', { id: tp, port: 'vac_out' }, { id, port });
    }
  }
  // TODO(balance): both RF sources land on the same manifold, which used to be
  // fine when the solver bucketed by frequency. It no longer is — one network
  // now carries ONE frequency, so this network serves the cavities' 2856 MHz
  // (120 kW of demand against the buncher's 2 kW) and the buncher is starved
  // with rf_frequency_split. The SSA on this manifold contributes nothing.
  // Re-laying this as two waveguide networks is a layout change that has to be
  // made and measured together, so it belongs with the balance pass, not here.
  if (wgBus2) {
    if (mbk) wire('rfWaveguide', { id: mbk, port: 'rf_out' }, { id: wgBus2, port: 'bus_left' });
    if (ssa2) wire('rfWaveguide', { id: ssa2, port: 'rf_out' }, { id: wgBus2, port: 'bus_right' });
  }
  // East chiller first: its drop runs along the same service row as the west
  // chiller's feed to the detector, and lines of one utility may not overlap
  // unless they share a source.
  if (ch2 && coolE2) wire('coolingWater', { id: ch2, port: 'cool_out' }, { id: coolE2, port: 'bus_left' });
  if (ch1) {
    for (const [id, port] of [[src2, 'cool_in'], [det, 'cool_in'], [coolW2, 'bus_left']]) {
      if (id) wire('coolingWater', { id: ch1, port: 'cool_out' }, { id, port });
    }
  }
  if (nsw) {
    for (const [id, port] of [[det, 'data_in'], [bpm2, 'data_in']]) {
      if (id) wire('dataFiber', { id: nsw, port: 'data_out' }, { id, port });
    }
  }

  // Staff roster on top of the seeded operator: +1 operator (covers fatigue
  // breaks and this second beamline), 2 technicians, 1 scientist, 1 engineer.
  const roles = ['operator', 'technician', 'technician', 'scientist', 'engineer'];
  for (const role of roles) {
    const m = createStaffMember(role, `staff_${state.staffNextId++}`, state.tick, game.rng);
    if (role === 'operator') {
      m.assignment.zoneId = 'controlRoom';
      // Stagger the shift against the seeded operator so their fatigue
      // breaks alternate instead of tripping the beam in sync.
      m.needs.fatigue = 0.5;
      // One operator needs one console to sit at — the beam gate only
      // counts an operator toward coverage while phase:'work' on a runBeam
      // job, and jobRunner offers at most one runBeam job per free console
      // SLOT (see task-4-brief.md). The starter scenario ships exactly one
      // console for the seeded operator; this second line needs its own.
      // Placed off in its own strip, well clear of everything else this
      // function builds.
      place('operatorConsole', -30, 8);
    }
    state.staffMembers.push(m);
  }
  game._syncStaffCounts();

  // ~35 decorations (reputation tier 'Pleasant', morale bump). Raw push is
  // fine for economy purposes — tick() only counts kind==='decoration'.
  const decTypes = ['oakTree', 'flowerBed', 'parkBench', 'lamppost', 'shrub'];
  for (let i = 0; i < 35; i++) {
    state.placeables.push({
      id: `dec_sim_${i}`, type: decTypes[i % decTypes.length],
      col: -10 + (i % 12), row: 13 + Math.floor(i / 12),
      subCol: 1, subRow: 1, dir: 0, kind: 'decoration',
    });
  }

  // Mid-game bankroll after all that construction.
  state.resources.funding = 1_500_000;
  state.resources.reputation = 30; // an established lab

  game.recalcAllBeamlines();
  return true;
}

function runC() {
  const game = bootSmallFacility(303);
  if (!buildLateGameFacility(game)) return;
  startAllBeams(game);
  runSim('C: late-game-ish, two beamlines + detector + cooling', game, 2000, { measureFrom: 300 });
}

// ---------------------------------------------------------------------------
// Run D — the playthrough. A/B/C measure rates; only D measures LENGTH, which
// is the question the progression pass exists to answer. Lives in
// scripts/balance-playthrough.mjs.
// ---------------------------------------------------------------------------
function runD(args) {
  const arg = (name, dflt) => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit ? Number(hit.slice(name.length + 3)) : dflt;
  };
  if (args.includes('--sweep')) {
    runSweep({ seed: arg('seed', 909), maxTicks: arg('max-ticks', 150_000) });
    return;
  }
  printPlaythrough(runPlaythrough({
    seed: arg('seed', 909),
    maxTicks: arg('max-ticks', 400_000),
    sampleEvery: arg('sample', 2000),
    detectors: arg('detectors', undefined),
    maxLines: arg('max-lines', undefined),
    expand: !args.includes('--no-expand'),
  }));
}

// Only run the tables when invoked as a script — test/test-economy-balance.js
// imports buildLateGameFacility from here.
if (process.argv[1] && process.argv[1].endsWith('balance-sim.mjs')) {
  const args = process.argv.slice(2);
  const which = args.find(a => !a.startsWith('--')) || 'abc';
  if (which.includes('a')) runA();
  if (which.includes('b')) runB();
  if (which.includes('c')) runC();
  if (which.includes('d')) runD(args);
}
