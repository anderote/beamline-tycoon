// scripts/balance-sim.mjs — headless economy balance simulation.
//
// Three scripted playthroughs, printing a tick-by-100 table of funds /
// reputation / cumulative refill spend each:
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
//
// Run: node scripts/balance-sim.mjs   (or `... a` / `... bc` to pick runs)
//
// This is the tuning companion to test/test-economy-balance.js, which encodes
// the three targets as loose assertions and imports run C's build recipe from
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

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { wireUtility } from '../src/data/scenarios/scenario-wiring.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';
import { createStaffMember } from '../src/game/staff/staffSystem.js';
import { computeTickUpkeep } from '../src/game/economy.js';
import { OBJECTIVES } from '../src/data/objectives.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// Autosave writes through localStorage; back it with a Map.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// Silence the per-tick console.warn spam from the utility gate while keeping
// real errors visible.
const realWarn = console.warn;
console.warn = (...args) => {
  const s = String(args[0] ?? '');
  if (s.startsWith('[utility]') || s.startsWith('[pipe-draw]')) return;
  realWarn(...args);
};

function mkGame(seed) {
  return new Game(new BeamlineRegistry(), { seed });
}

// ---------------------------------------------------------------------------
// Auto-refill: emulate the player pressing the UtilityInspector refill button
// whenever a reservoir runs low. Returns dollars spent this call.
// ---------------------------------------------------------------------------
const REFILL_TRIGGER = {
  coolingWater: (p) => (p?.reservoirVolumeL ?? Infinity) < 100,
  cryoTransfer: (p) => (p?.lheVolumeL ?? Infinity) < 60,
};

function autoRefill(game) {
  const state = game.state;
  let spent = 0;
  const nets = state.utilityNetworks;
  if (!nets) return 0;
  for (const [utilityType, networks] of nets) {
    const desc = UTILITY_TYPES[utilityType];
    const trigger = REFILL_TRIGGER[utilityType];
    if (!desc || !trigger || typeof desc.refillCost !== 'function') continue;
    for (const net of networks) {
      const persistent = state.utilityNetworkState.get(net.id);
      if (!persistent || !trigger(persistent)) continue;
      const cost = desc.refillCost(persistent);
      if (!cost || !cost.funding) continue;
      if (state.resources.funding < cost.funding) continue; // can't afford
      state.resources.funding -= cost.funding;
      spent += cost.funding;
      state.utilityNetworkState.set(net.id, { ...persistent, ...desc.persistentStateDefaults });
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
  //   RF at two frequencies — 2856 MHz cavities and a 200 MHz buncher — so a
  //     multibeam klystron for the cavity bucket plus a broadband SSA for the
  //     buncher, because a fixed-frequency source cannot cross buckets;
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
  const wgBus2   = place('waveguideManifold', -2, 9);
  const coolW2   = place('coolingManifold', 1, 9);
  const coolE2   = place('coolingManifold', 5, 11);
  const vacW2    = place('vacuumManifold', -3, 9);
  const vacE2    = place('vacuumManifold', 3, 9);

  const wire = (util, from, to) => {
    const id = wireUtility(game, util, from, to);
    if (!id) log('C: wire failed', util, from.id, '->', to.id);
  };
  if (hv) {
    for (const [id, port] of [[src2, 'pwr_in'], [det, 'pwr_in'], [mbk, 'pwr_in'],
      [ssa2, 'pwr_in'], [tp, 'pwr_in'], [ioc2, 'pwr_in'], [nsw, 'pwr_in'],
      [ch1, 'pwr_in'], [ch2, 'pwr_in'], [pwrBus2, 'bus_left']]) {
      if (id) wire('powerCable', { id: hv, port: 'pwr_out' }, { id, port });
    }
  }
  if (tp) {
    for (const [id, port] of [[src2, 'vac_in'], [det, 'vac_in'],
      [vacW2, 'bus_left'], [vacE2, 'bus_left']]) {
      if (id) wire('vacuumPipe', { id: tp, port: 'vac_out' }, { id, port });
    }
  }
  // Both RF sources land on the same manifold: the solver buckets by
  // frequency, so the klystron feeds the cavities and the broadband amp tops
  // up the buncher's bucket.
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
  // breaks), 2 technicians, 1 scientist, 1 engineer.
  const roles = ['operator', 'technician', 'technician', 'scientist', 'engineer'];
  for (const role of roles) {
    const m = createStaffMember(role, `staff_${state.staffNextId++}`, state.tick, game.rng);
    if (role === 'operator') {
      m.assignment.zoneId = 'controlRoom';
      // Stagger the shift against the seeded operator so their fatigue
      // breaks alternate instead of tripping the beam in sync.
      m.needs.fatigue = 0.5;
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
  const which = process.argv[2] || 'abc';
  if (which.includes('a')) runA();
  if (which.includes('b')) runB();
  if (which.includes('c')) runC();
}
