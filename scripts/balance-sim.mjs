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
//   C) A late-game-ish build (second, bigger beamline + detector + chiller
//      loop + a real staff roster + decorations). Target: strong gross income
//      with upkeep (staff + power + pumps + refills) eating 30-60% of gross.
//
// Run: node scripts/balance-sim.mjs
//
// This is the tuning companion to test/test-economy-balance.js, which encodes
// the three targets as loose assertions.

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
// Run C — late-game-ish: second bigger beamline with detector + cooling loop,
// fuller staff roster, decorations. Built on the smallBeamlineFacility map
// (flat terrain, existing starter line keeps running).
// ---------------------------------------------------------------------------
function runC() {
  const game = bootSmallFacility(303);
  const state = game.state;

  // Bigger line on open flat ground south of the building (rows >= 8).
  const src2 = game.beamline.placeJunction({ type: 'source', col: -6, row: 10, dir: 3, free: true, silent: true });
  const det = game.beamline.placeJunction({ type: 'detector', col: 6, row: 10, dir: 3, free: true, silent: true });
  if (!src2 || !det) { console.error('C: junction placement failed', { src2, det }); return; }
  const pipe = game.beamline.drawPipe(
    { junctionId: src2, portName: 'exit' },
    { junctionId: det, portName: 'entry' },
    [{ col: -6, row: 10 }, { col: 6, row: 10 }],
  );
  if (!pipe) { console.error('C: drawPipe failed'); return; }
  for (const [type, position] of [
    ['buncher', 0.06], ['rfCavity', 0.18], ['rfCavity', 0.30], ['rfCavity', 0.42],
    ['quadrupole', 0.54], ['rfCavity', 0.64], ['quadrupole', 0.76], ['bpm', 0.88],
  ]) {
    const ok = game.beamline.placeOnPipe(pipe, { type, position, mode: 'snap', free: true });
    if (!ok) console.error('C: placeOnPipe failed', type, position);
  }

  // Support infra one row north of the line.
  const place = (type, col, row) => {
    const id = game.placePlaceable({ type, col, row, free: true, silent: true });
    if (!id) console.error('C: placePlaceable failed', type, col, row);
    return id;
  };
  const sw = place('switchgear', -5, 8);
  const tp = place('turboPump', 3, 8);
  const ioc2 = place('rackIoc', 1, 8);
  const ch = place('chiller', 5, 8);

  const wire = (util, from, to) => {
    const id = wireUtility(game, util, from, to);
    if (!id) console.error('C: wire failed', util, from.id, '->', to.id);
  };
  if (sw) {
    wire('powerCable', { id: sw, port: 'pwr_out' }, { id: src2, port: 'pwr_in' });
    wire('powerCable', { id: sw, port: 'pwr_out' }, { id: det, port: 'pwr_in' });
  }
  if (tp) {
    wire('vacuumPipe', { id: tp, port: 'vac_out' }, { id: src2, port: 'vac_in' });
    wire('vacuumPipe', { id: tp, port: 'vac_out' }, { id: det, port: 'vac_in' });
  }
  if (ioc2) wire('dataFiber', { id: ioc2, port: 'data_out' }, { id: det, port: 'data_in' });
  if (ch) wire('coolingWater', { id: ch, port: 'cool_out' }, { id: det, port: 'cool_in' });

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
  startAllBeams(game);
  runSim('C: late-game-ish, two beamlines + detector + cooling', game, 2000, { measureFrom: 300 });
}

const which = process.argv[2] || 'abc';
if (which.includes('a')) runA();
if (which.includes('b')) runB();
if (which.includes('c')) runC();
