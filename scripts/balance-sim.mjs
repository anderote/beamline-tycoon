// scripts/balance-sim.mjs — headless economy balance simulation.
//
// Three steady-state rate measurements printing a tick-by-100 table of funds,
// reputation, and cumulative refill spend.
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
// Run: node scripts/balance-sim.mjs           (A/B/C)
//      node scripts/balance-sim.mjs bc        (pick runs by letter)
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
//   C +1508.5/t 55.8%   upkeep 1907.2/t  (staff 970, power 753, pumps 32, refill 152)
//
import './balance-env.mjs';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { wireUtility } from '../src/data/scenarios/scenario-wiring.js';
import { createStaffMember } from '../src/game/staff/staffSystem.js';
import { computeTickUpkeep } from '../src/game/economy.js';
import { OBJECTIVES } from '../src/data/objectives.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';

function mkGame(seed) {
  return new Game(new BeamlineRegistry(), { seed });
}

const REFILL_TRIGGER = {
  coolingWater: persistent => (persistent?.reservoirVolumeL ?? Infinity) < 100,
  cryoTransfer: persistent => (persistent?.lheVolumeL ?? Infinity) < 60,
};

function autoRefill(game) {
  const state = game.state;
  let spent = 0;
  for (const [utilityType, networks] of state.utilityNetworks || []) {
    const descriptor = UTILITY_TYPES[utilityType];
    const shouldRefill = REFILL_TRIGGER[utilityType];
    if (!descriptor || !shouldRefill || typeof descriptor.refillCost !== 'function') continue;
    for (const network of networks) {
      const persistent = state.utilityNetworkState.get(network.id);
      if (!persistent || !shouldRefill(persistent)) continue;
      const cost = descriptor.refillCost(persistent);
      if (!cost?.funding || state.resources.funding < cost.funding) continue;
      state.resources.funding -= cost.funding;
      spent += cost.funding;
      state.utilityNetworkState.set(network.id, {
        ...persistent,
        ...descriptor.persistentStateDefaults,
      });
    }
  }
  return spent;
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
  const requiredOperators = game.registry.getAll().length;
  for (let i = 0; i < 240; i++) {
    game.tick();
    const seated = game.state.staffMembers.filter(member =>
      member.job?.jobType === 'runBeam' && member.job.phase === 'work').length;
    if (seated >= requiredOperators && game.state.infraCanRun) break;
  }
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
  const buncher2 = onPipe[0];
  const cavities2 = [onPipe[1], onPipe[2], onPipe[3], onPipe[5]];
  const bpm2 = onPipe[7];

  const place = (type, col, row) => {
    const id = game.placePlaceable({ type, col, row, free: true, silent: true });
    if (!id) log('C: placePlaceable failed', type, col, row);
    return id;
  };
  // Service row (8), two north of the line. Sizing, all of it forced by the
  // on-pipe demands that now gate individually:
  //   power ~960 kW (240 of it the four rfCavities, 380 the RF plant) -> the
  //     1500 kW HV transformer plus an HV distributor for the plant feeders;
  //     distribution gear does not add supply;
  //   RF at two frequencies — 2856 MHz cavities and a 162.5 MHz buncher — so a
  //     multibeam klystron for the cavities plus an SSA for the buncher;
  //     see the TODO(balance) on the waveguide wiring below;
  //   cooling 586 kW -> two 300 kW chillers;
  //   data -> an eight-port network switch alongside the IOC.
  const servicePoint = place('gridServicePoint', -26, 8);
  const hv   = place('hvTransformer', -6, 8);
  const hvGear = place('switchgear', -15, 11);
  const dedicatedHv = place('switchgear', -20, 11);
  const mbk  = place('multibeamKlystron', -3, 8);
  // Keep the VHF source west of the S-band gallery so their waveguide trunks
  // leave on different corridors and never join by accidental overlap.
  const ssa2 = place('solidStateAmp', -10, 8);
  const tp   = place('turboPump', 0, 8);
  // A turbo is not a stand-alone atmosphere-to-high-vacuum source. Keep the
  // portable roughing stage on the same header so this scripted facility uses
  // the same staged pump-down rules as a player build.
  // Put the backing pump east of the manifold it joins. Vacuum remains a
  // physical rigid service, so approaching the manifold's right-hand fitting
  // from the open east aisle avoids crossing the turbo pump's left-hand feed.
  const rp   = place('roughingPump', 8, 8);
  const ioc2 = place('rackIoc', 1, 8);
  const nsw  = place('networkSwitch', 2, 8);
  const ch1  = place('chiller', 3, 8);
  // Second chiller on the far side of the line: its drop would otherwise have
  // to share the service row with the west chiller's run to the detector, and
  // two lines of one utility may not overlap unless they share a source.
  const ch2  = place('chiller', 3, 11);
  const plantTank = place('waterTank', -2, 14);
  const tower = place('coolingTower', 6, 14);

  // Distribution row (9), hard against the line. One power bus and one
  // waveguide manifold span the run; vacuum only reaches 5 cells, so it takes
  // two manifolds. Cooling takes two as well, one per chiller — not for reach
  // but so each chiller gets its own drop; both manifolds cover the same
  // middle cavities, which unions them into a single 600 kW loop.
  const pwrBus2  = place('powerBus', 0, 9);
  // Two distribution panels keep eight branch loads near their respective
  // service areas; the three large cooling-plant loads bypass them on HV.
  const mcc1     = place('mcc', -6, 11);
  // The second panel sits with the plant it feeds. Circuits are point to point
  // now, so a panel on the far side of the hall means several long runs sharing one
  // aisle — put distribution where its loads are, which is the decision the
  // chain exists to create.
  const mcc2     = place('mcc', 2, 12);
  const coolW2   = place('coolingManifold', 1, 9);
  const coolE2   = place('coolingManifold', 5, 11);
  const vacW2    = place('vacuumManifold', -3, 9);
  const vacE2    = place('vacuumManifold', 3, 9);
  // The second beamline needs a second staffed console. It is intentionally
  // separate from the starter control room, but it still receives explicit
  // branch power and data like every other active control-room item.
  const secondConsole = place('operatorConsole', -30, 8);

  const wire = (util, from, to) => {
    const id = wireUtility(game, util, from, to);
    if (!id) log('C: wire failed', util, from.id, '->', to.id);
  };
  const sourcePort = (id, index = 0) => ({ id, role: 'source', index });
  const sinkPort = id => ({ id, role: 'sink' });
  const passPort = (id, side) => ({ id, role: 'pass', side });
  // Power runs supply -> transformer -> HV distribution -> dedicated plant
  // loads/panels -> branch circuits. Chillers, the detector, and the authored
  // cooling-tower service use direct HV inputs, so they do not consume MCC
  // branch sockets. The extra distributor supplies enough dedicated feeders.
  if (servicePoint && hv) wire('hvCable', { id: servicePoint, port: 'hv_out_1' }, { id: hv, port: 'hv_in' });
  if (hv && hvGear) wire('hvCable', sourcePort(hv, 0), sinkPort(hvGear));
  if (hv && mbk) wire('hvCable', sourcePort(hv, 1), sinkPort(mbk));
  if (hv && ssa2) wire('hvCable', sourcePort(hv, 2), sinkPort(ssa2));
  if (hv && tower) wire('hvCable', sourcePort(hv, 3), sinkPort(tower));
  if (hvGear && mcc1) wire('hvCable', sourcePort(hvGear, 0), sinkPort(mcc1));
  if (hvGear && mcc2) wire('hvCable', sourcePort(hvGear, 1), sinkPort(mcc2));
  if (hvGear && ch1) wire('hvCable', sourcePort(hvGear, 2), sinkPort(ch1));
  if (hvGear && dedicatedHv) wire('hvCable', sourcePort(hvGear, 3), sinkPort(dedicatedHv));
  if (dedicatedHv && ch2) wire('hvCable', sourcePort(dedicatedHv, 0), sinkPort(ch2));
  if (dedicatedHv && det) wire('hvCable', sourcePort(dedicatedHv, 1), sinkPort(det));
  const westLoads = [sinkPort(src2), sinkPort(tp), sinkPort(ioc2), sinkPort(nsw),
    passPort(pwrBus2, 'back'), sinkPort(secondConsole)];
  const eastLoads = [sinkPort(rp)];
  for (const [panel, loads] of [[mcc1, westLoads], [mcc2, eastLoads]]) {
    loads.forEach((target, i) => {
      if (target.id && panel) wire('powerCable', sourcePort(panel, i), target);
    });
  }
  if (tp) {
    for (const target of [sinkPort(src2), sinkPort(det), passPort(vacW2, 'left'), passPort(vacE2, 'left')]) {
      if (target.id) wire('vacuumPipe', sourcePort(tp), target);
    }
  }
  if (rp && vacE2) wire('vacuumPipe', sourcePort(rp), passPort(vacE2, 'right'));
  // One RF network carries one frequency. Keep the VHF buncher on the SSA and
  // the 2.856 GHz cavities on the multibeam klystron; joining them through one
  // manifold starves the buncher and depresses the entire line's income.
  if (ssa2 && buncher2) wire('rfWaveguide', sourcePort(ssa2), sinkPort(buncher2));
  if (mbk) {
    for (const cavity of cavities2) {
      if (cavity) wire('rfWaveguide', sourcePort(mbk), sinkPort(cavity));
    }
  }
  // Reservoir, chillers, and heat rejection are roles on one cooling-water
  // topology. Join all three plant stages to the same manifolded network.
  if (plantTank && ch1) wire('coolingWater', sourcePort(plantTank), sourcePort(ch1, 1));
  if (tower && ch2) wire('coolingWater', sourcePort(tower), sourcePort(ch2, 1));
  // East chiller first: its drop runs along the same service row as the west
  // chiller's feed to the detector, and lines of one utility may not overlap
  // unless they share a source.
  if (ch2 && coolE2) wire('coolingWater', sourcePort(ch2), passPort(coolE2, 'left'));
  if (ch1) {
    for (const target of [sinkPort(src2), sinkPort(det), passPort(coolW2, 'left')]) {
      if (target.id) wire('coolingWater', sourcePort(ch1), target);
    }
  }
  if (nsw) {
    for (const [index, id] of [det, bpm2, secondConsole].entries()) {
      if (id) wire('dataFiber', { id: nsw, role: 'pass', index }, sinkPort(id));
    }
  }

  // Staff roster on top of the seeded operator: +1 operator (covers fatigue
  // breaks and this second beamline), 2 technicians, 1 scientist, 1 engineer.
  const roles = ['operator', 'technician', 'scientist', 'engineer'];
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
      // The separately wired console was placed with the service equipment
      // above, well clear of everything else this function builds.
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

// Only run the tables when invoked as a script — test/test-economy-balance.js
// imports buildLateGameFacility from here.
if (process.argv[1] && process.argv[1].endsWith('balance-sim.mjs')) {
  const args = process.argv.slice(2);
  const which = args.find(a => !a.startsWith('--')) || 'abc';
  if (which.includes('a')) runA();
  if (which.includes('b')) runB();
  if (which.includes('c')) runC();
}
