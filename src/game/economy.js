import { COMPONENTS } from '../data/components.js';
import { getUtilityPortsV2 } from '../data/utility-ports-v2.js';
import {
  poweredPlaceables, beamlineEnergyDraw, facilityEnergyDraw,
  pumpCount as countPumps,
} from './aggregates.js';

// ---------------------------------------------------------------------------
// Phase 7 — economy tuning knobs. All per-tick revenue/upkeep coefficients
// live here so balance passes (scripts/balance-sim.mjs) touch one table.
// Loose invariants are pinned by test/test-economy-balance.js:
//   A) a fresh sandbox idles >300 ticks without going broke;
//   B) the smallBeamlineFacility scenario is net-positive once its beam runs;
//   C) a late-game build pays 30-60% of gross income back out as upkeep
//      (staff + power bill + pump service + reservoir refills).
// ---------------------------------------------------------------------------
export const ECON = {
  // Passive institutional grant, $/tick, independent of research. Mostly
  // covers the seeded operator so an empty lab bleeds slowly, not fatally.
  baseGrant: 100,
  // Reputation revenue: $/tick = repIncomeRate * sqrt(reputation). Square
  // root keeps late-game reputation from compounding into free money.
  repIncomeRate: 20,
  // Beam-on revenue: $/tick = quality * (beamIncomeBase +
  // beamIncomePerNode * nodeCount). Scaling with machine size makes bigger
  // beamlines earn like bigger coasters.
  beamIncomeBase: 60,
  //
  // === Phase 12: income scales with hardware DENSITY, not beamline LENGTH ===
  //
  // `nodeCount` is aggregates.hardwareNodeCount — junctions plus on-pipe
  // placements, never the flattener's synthetic drift entries. That makes
  // income a function of how much MACHINE is on the pipe, not how long the
  // pipe is. Until now that was an accident: the 100 -> 180 bump was a
  // compensating constant applied when a drift-double-count bug was fixed. It
  // held the rate steady and silently re-weighted income from length to
  // density. This is the deliberate version of that choice.
  //
  // Why density:
  //   - Length would pay per tile of drift and bellows, the two cheapest parts
  //     in the catalogue ($10k / $15k). A player could mint income by drawing
  //     empty pipe across the map — income with no capital, no power draw and
  //     no utility hookup behind it.
  //   - Every dollar of density income is obliged by a component that costs
  //     capital, draws power (billed below) and demands a utility connection
  //     before the beam will run at all (the Phase 11 gate). Income is
  //     self-limiting because the thing that earns it also bills for itself.
  //   - Consequence to design around: a compact, densely instrumented machine
  //     out-earns a long sparse one. Ambitious transport is rewarded only
  //     indirectly, by the room it makes for more hardware. Long empty runs
  //     are a cost, which is what they should be.
  //
  // Derivation of 240 against the 28,800-tick target (see
  // scripts/balance-playthrough.mjs). The anchor is capital payback, because
  // that is what ties income to the component catalogue rather than to itself:
  //   - the reference extra beamline costs $3.83M all in and carries 8 billed
  //     hardware nodes. All in means what the player is charged at the till:
  //     $3.25M of catalogue, $120k of drift pipe (priced per tile) and $458k of
  //     utility line (priced per sub-unit, both gestures — see
  //     UtilityLineInputController). Wiring is 14% of the hardware it connects,
  //     which is why the model may not quote the catalogue alone;
  //   - measured marginally in the sim, the plant a line obliges eats ~56% of
  //     the gross it earns, so net = 8 * P * 0.99 * 0.44 = 3.49 * P per tick;
  //   - a line should pay itself back in about 1/6 of a full playthrough
  //     (~4,600 ticks) — soon enough that expanding is obviously right, slow
  //     enough that the first expansion is a real commitment of seed capital;
  //   - P = 3,827,800 / (3.49 * 4,600) = 238.
  // Rounded to 240, which is where the compensating constant happened to land.
  // The number did not move; its justification did, and the research ladder is
  // now priced against it rather than the other way round.
  //
  // Known open issue, deliberately NOT fixed here: this is linear in node
  // count with no diminishing return, so building N copies of the same line
  // earns N times as much for N times the cost and run length falls roughly as
  // 1/N. Measured: a player who stops at four extra beamlines takes 2.34x the
  // target, twelve takes 1.15x, twenty-four takes 0.79x (see the table in
  // src/data/research.js). Compressing that spread needs a structural
  // change (per-facility diminishing returns, or rising line prices), not a
  // constant.
  beamIncomePerNode: 240,
  // Detector data fees, $/tick per unit dataRate while collecting.
  dataFeeRate: 5,
  // Electricity, $/tick per kW of energyCost draw. Equipment draws whenever
  // placed; the beamline's own draw is billed only while the beam is on.
  // Halved 2 -> 1 alongside the gate change above. The rate was set when
  // almost no plant was mandatory, so the bill read as the price of a choice;
  // now that the gate obliges an RF source, a cooling loop and a pump before
  // the beam will run at all, the same rate is a flat tax on existing rather
  // than a cost of ambition. Re-checked against the fixed beam: still 1 —
  // at 2 the late-game run pays 74% of gross out in upkeep, past the 70%
  // ceiling test-economy-balance.js holds. Electricity remains the largest
  // non-staff upkeep line in every sim run (623/t of run C's 1970/t).
  powerBillPerKW: 1,
  // Vacuum pump service cost, $/tick each (legacy pump upkeep).
  pumpUpkeepEach: 8,
};

/**
 * Facility-wide passive revenue for one tick: base grant + research passive
 * funding + reputation revenue, all scaled by the decoration reputation
 * tier's funding bonus.
 */
export function computeTickIncome(state, researchPassive = 0) {
  const passive = ECON.baseGrant + researchPassive;
  const rep = Math.max(0, state.resources?.reputation || 0);
  const repIncome = ECON.repIncomeRate * Math.sqrt(rep);
  const repBonus = state?.reputationTier?.fundingBonus || 0;
  return Math.floor((passive + repIncome) * (1 + repBonus));
}

/**
 * The user-fee term of beam income, $/tick, for an already-billed (that is,
 * connectivity-derated) data rate. The UI's "User Fees" readout re-derived
 * this as `dataRate * 0.1` off the raw physics rate, which understated the
 * money by 50x and still quoted a fee for a beamline whose fiber was cut.
 * Anything that bills or displays data fees calls this.
 */
export function dataFeeIncome(billedRate) {
  const rate = billedRate || 0;
  return rate > 0 ? rate * ECON.dataFeeRate : 0;
}

/**
 * Revenue for one tick of one running beamline. `nodeCount` comes from
 * aggregates.hardwareNodeCount — junctions + pipe placements, never the
 * flattener's synthetic 'drift' entries, which are gaps, not machines.
 * `beamState.dataRate` must already be the billed (connectivity-derated)
 * rate — see aggregates.billedDataRate. Income scales with both beam quality
 * and machine size, plus data fees while detectors collect.
 */
export function computeBeamIncome(beamState, nodeCount = 0) {
  // `|| 0.2` here treated a legitimate quality of exactly 0 (lattice.py
  // returns beam_quality 0.0 outright when the emittance ratio degenerates)
  // as 20%, so a fully scrambled beam still earned income forever. The 0.2 is
  // only a stand-in for "physics hasn't reported yet".
  const raw = beamState.beamQuality;
  const q = Number.isFinite(raw) ? raw : 0.2;
  let income = q * (ECON.beamIncomeBase + ECON.beamIncomePerNode * nodeCount);
  income += dataFeeIncome(beamState.dataRate);
  return income;
}

/**
 * Recurring upkeep for one tick: staff salaries, pump service, and the
 * electricity bill (equipment energyCost always; beamline energyCost only
 * while the beam is on). Reservoir refills are event costs paid at the
 * UtilityInspector, not part of this per-tick total.
 */
export function computeTickUpkeep(state) {
  const staffCost = Object.entries(state.staff || {}).reduce((sum, [type, count]) => {
    return sum + count * ((state.staffCosts || {})[type] || 0);
  }, 0);
  const pumpUpkeep = countPumps(state) * ECON.pumpUpkeepEach;
  // facilityEnergyDraw is the same basis computeSystemStats reports as
  // power.totalDraw — the bill and the panel cannot disagree.
  const powerBill = ECON.powerBillPerKW * facilityEnergyDraw(state);
  return { staffCost, pumpUpkeep, powerBill, total: staffCost + pumpUpkeep + powerBill };
}

// Phase 6: the legacy Networks module is gone. computeSystemStats now runs
// only the equipment-count-based fallback paths that used to live behind the
// `if (nets && nets.xyz.length > 0)` guards. This is a deliberate
// simplification — the new utility solver already owns per-network capacity/
// load math; this file just produces rough summary stats for the HUD.

export function computeSystemStats(state) {
  // Same population computeTickUpkeep bills — see aggregates.js.
  const equip = poweredPlaceables(state);
  const beamline = state.beamline || [];

  // Count facility equipment by type
  const counts = {};
  for (const e of equip) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }

  // Helper: sum energyCost for equipment types in a category (optionally filtered by subsection)
  const categoryDraw = (cat, sub) => {
    let draw = 0;
    for (const e of equip) {
      const comp = COMPONENTS[e.type];
      if (!comp || comp.category !== cat) continue;
      if (sub && comp.subsection !== sub) continue;
      draw += (comp.energyCost || 0);
    }
    return draw;
  };

  // Helper: total beamline interior volume
  const totalVolume = beamline.reduce((sum, n) => {
    const c = COMPONENTS[n.type];
    return sum + (c ? (c.interiorVolume || 0) : 0);
  }, 0);

  // Helper: sum a declared utility-port param over every placed unit. The
  // panels MUST quote the same ladder the solver gates the beam on
  // (src/data/utility-ports-v2.js) — hand-written capacity tables here drifted
  // 400x on RF and inverted the pump ranking, so the panel a player plans from
  // recommended the wrong hardware.
  const portCapacity = (portName, param) => {
    let total = 0;
    for (const e of equip) {
      const v = getUtilityPortsV2(e.type)?.[portName]?.params?.[param];
      if (typeof v === 'number') total += v;
    }
    return total;
  };

  // === VACUUM ===
  const gaugeTypes = ['piraniGauge', 'coldCathodeGauge', 'baGauge'];
  const pumpCount = countPumps(state);
  const gaugeCount = gaugeTypes.reduce((s, t) => s + (counts[t] || 0), 0);
  const totalPumpSpeed = portCapacity('vac_out', 'pumpSpeed');
  // Derived fresh every call. This used to read `state.avgPressure ||` first
  // — but Game.computeSystemStats writes this very result back to
  // state.avgPressure, so the first value (1013 mbar, no pumps yet) latched
  // forever and adding pumps never moved the readout.
  //
  // A pumped volume is required, not just a pump: clamping totalVolume to 1
  // meant a single turboPump placed anywhere, wired to nothing, with no
  // beamline at all, reported 3.3e-9 mbar / "Good" and auto-completed the
  // `goodVacuum` objective for $30k and a reputation point.
  const pumped = pumpCount > 0 && totalVolume > 0;
  const avgPressure = pumped
    ? 1e-6 / Math.max(totalPumpSpeed / totalVolume, 0.01)
    : 1013;
  let pressureQuality = 'None';
  if (pumped) {
    if (avgPressure < 1e-9) pressureQuality = 'Excellent';
    else if (avgPressure < 1e-7) pressureQuality = 'Good';
    else if (avgPressure < 1e-4) pressureQuality = 'Marginal';
    else pressureQuality = 'Poor';
  }

  const vacuum = {
    avgPressure,
    totalPumpSpeed,
    beamlineVolume: totalVolume,
    pumpCount,
    gaugeCount,
    energyDraw: categoryDraw('vacuum'),
    pressureQuality,
    detail: {
      roughingPumps: counts.roughingPump || 0,
      turboPumps: counts.turboPump || 0,
      ionPumps: counts.ionPump || 0,
      negPumps: counts.negPump || 0,
      tiSubPumps: counts.tiSubPump || 0,
      piraniGauges: counts.piraniGauge || 0,
      ccGauges: counts.coldCathodeGauge || 0,
      baGauges: counts.baGauge || 0,
      gateValves: counts.gateValve || 0,
      bakeoutSystems: counts.bakeoutSystem || 0,
    },
  };

  // === RF POWER ===
  // Keys MUST be real COMPONENTS ids. They were once 'klystron' / 'ssa',
  // which no longer exist, so every klystron- and SSA-class source the player
  // placed (and was billed for) counted as zero here — the panel reported
  // "Sources 0 / Fwd 0 kW" next to a non-zero draw.
  const rfSourceTypes = [
    'magnetron', 'iot', 'solidStateAmp', 'highPowerSSA', 'twt',
    'pulsedKlystron', 'cwKlystron', 'multibeamKlystron', 'gyrotron',
  ];
  const rfSourceCount = rfSourceTypes.reduce((s, t) => s + (counts[t] || 0), 0);

  const totalFwdPower = portCapacity('rf_out', 'capacity');
  const reflFraction = 0.02;
  const totalReflPower = totalFwdPower * reflFraction;

  const avgEfficiency = rfSourceCount > 0 ? 0.55 : 0; // rough average
  const rfWallPower = avgEfficiency > 0 ? totalFwdPower / avgEfficiency : 0;
  const reflShown = totalFwdPower > 0 ? totalReflPower / totalFwdPower : 0;
  const vswr = reflShown > 0 ? ((1 + Math.sqrt(reflShown)) / (1 - Math.sqrt(reflShown))).toFixed(2) : '1.00';

  const rfPower = {
    totalFwdPower,
    totalReflPower,
    wallPower: rfWallPower,
    vswr,
    sourceCount: rfSourceCount,
    avgEfficiency: avgEfficiency * 100,
    energyDraw: categoryDraw('rfPower'),
    detail: {
      klystrons: (counts.pulsedKlystron || 0) + (counts.cwKlystron || 0)
        + (counts.multibeamKlystron || 0),
      ssas: (counts.solidStateAmp || 0) + (counts.highPowerSSA || 0),
      iots: counts.iot || 0,
      magnetrons: counts.magnetron || 0,
      twts: counts.twt || 0,
      gyrotrons: counts.gyrotron || 0,
      modulators: counts.modulator || 0,
      circulators: counts.circulator || 0,
      couplers: counts.rfCoupler || 0,
      llrfControllers: counts.llrfController || 0,
    },
  };

  // === CRYO ===
  // Real COMPONENTS ids: 'heliumCompressor' / 'subCooling2K' never existed,
  // so a 2 K cryoplant reported zero capacity and "--" for temperature.
  const compressors = counts.heCompressor || 0;
  const coldBox4K = counts.coldBox4K || 0;
  const subCooling2K = counts.coldBox2K || 0;
  const cryoHousings = counts.cryomoduleHousing || 0;
  const ln2Precool = counts.ln2Precooler || 0;
  const heRecovery = counts.heRecovery || 0;
  const cryocoolers = counts.cryocooler || 0;

  const cryoCapacity = portCapacity('cryo_out', 'coldCapacityW');
  // Every cryo sink counts, not just `cryomodule`: halfWaveResonator,
  // spokeCavity and ellipticalSrfCavity declare cryo_in.srfHeatW too, so a
  // pure non-cryomodule SRF linac used to report zero cryo load forever while
  // the solver was starving it. Load is the declared heat, split into the
  // static (housing/transfer) and dynamic (RF) halves the panel shows.
  const srfHeat = beamline.reduce((s, n) => {
    const w = getUtilityPortsV2(n.type)?.cryo_in?.params?.srfHeatW;
    return s + (typeof w === 'number' ? w : 0);
  }, 0);
  const srfCavities = beamline.filter(
    n => typeof getUtilityPortsV2(n.type)?.cryo_in?.params?.srfHeatW === 'number',
  ).length;
  let staticLoad = cryoHousings * 3 + Math.round(srfHeat * 0.2);
  let dynamicLoad = Math.round(srfHeat * 0.8);
  const totalCryoLoad = staticLoad + dynamicLoad;
  const opTemp = subCooling2K > 0 ? 2.0 : (coldBox4K > 0 ? 4.5 : 0);

  const carnot = opTemp === 2.0 ? 750 : 250;
  const cryoWallPower = totalCryoLoad * carnot / 1000; // kW
  const cryoMargin = cryoCapacity > 0 ? ((cryoCapacity - totalCryoLoad) / cryoCapacity * 100) : 0;

  const cryo = {
    coolingCapacity: cryoCapacity,
    heatLoad: totalCryoLoad,
    opTemp,
    wallPower: cryoWallPower,
    margin: Math.max(cryoMargin, 0),
    energyDraw: categoryDraw('cooling', 'cryogenics'),
    detail: {
      compressors,
      coldBox4K,
      subCooling2K,
      cryoHousings,
      ln2Precoolers: ln2Precool,
      heRecovery,
      cryocoolers,
      staticLoad,
      dynamicLoad,
    },
  };

  // === COOLING ===
  const lcwSkids = counts.lcwSkid || 0;
  const chillers = counts.chiller || 0;
  const towers = counts.coolingTower || 0;
  const exchangers = counts.heatExchanger || 0;
  const waterLoads = counts.waterLoad || 0;
  const deionizers = counts.deionizer || 0;
  const emergCooling = counts.emergencyCooling || 0;

  const coolingCap = portCapacity('cool_out', 'capacity');
  const coolingLoad = beamlineEnergyDraw(state) * 0.6; // ~60% of electrical becomes heat

  const flowRate = coolingCap > 0 ? coolingCap / (4.18 * 10) * 60 : 0; // L/min assuming 10C delta-T
  const coolingMargin = coolingCap > 0 ? ((coolingCap - coolingLoad) / coolingCap * 100) : 0;

  const cooling = {
    coolingCapacity: coolingCap,
    heatLoad: coolingLoad,
    flowRate,
    energyDraw: categoryDraw('cooling'),
    margin: Math.max(coolingMargin, 0),
    detail: {
      lcwSkids,
      chillers,
      coolingTowers: towers,
      heatExchangers: exchangers,
      waterLoads,
      deionizers,
      emergencyCooling: emergCooling,
    },
  };

  // === POWER ===
  const substations = (counts.hvTransformer || 0) + (counts.padMountTransformer || 0);
  const panels = counts.powerPanel || 0;
  const laserSystems = counts.laserSystem || 0;

  // Capacity is the sum of every placed power source's declared `pwr_out`
  // capacity — the same ladder the utility solver uses (powerPanel 40 →
  // hvTransformer 1200). This used to read `state.maxElectricalPower`, a
  // field whose only other reference in the tree is the line in Game.load()
  // that deletes it as deprecated, so the panel was permanently pinned to the
  // 500 kW fallback and read 100% utilization on any real facility.
  let powerCapacity = 0;
  for (const e of equip) {
    const cap = getUtilityPortsV2(e.type)?.pwr_out?.params?.capacity;
    if (typeof cap === 'number') powerCapacity += cap;
  }
  // Draw is the sum over every placed unit plus the running beamlines — the
  // SAME accessor computeTickUpkeep bills on. Adding the per-category draws
  // instead both under- and over-counted: it omitted the dataControls, ops and
  // power categories and the 34 lab items that have no `category` at all
  // (~68 kW on an ordinary build), while double-counting cryogenics, which is
  // a subsection of cooling and was added twice. A facility drawing 74 kW
  // against a 100 kW supply displayed a green 6%.
  const totalDraw = facilityEnergyDraw(state);
  const powerUtil = powerCapacity > 0 ? (totalDraw / powerCapacity * 100) : 0;

  const power = {
    capacity: powerCapacity,
    totalDraw,
    utilization: Math.min(powerUtil, 100),
    substations,
    panels,
    laserSystems,
    detail: {
      vacuumDraw: vacuum.energyDraw,
      rfDraw: rfPower.energyDraw,
      cryoDraw: cryo.energyDraw,
      coolingDraw: cooling.energyDraw,
      beamlineDraw: beamlineEnergyDraw(state),
    },
  };

  // === DATA & CONTROLS ===
  const iocs = counts.rackIoc || 0;
  const interlocks = counts.ppsInterlock || 0;
  const monitors = counts.areaMonitor || 0;
  const timingSystems = counts.timingSystem || 0;
  const mpsCount = counts.mps || 0;

  const dataControls = {
    iocs,
    interlocks,
    monitors,
    timingSystems,
    mpsStatus: mpsCount > 0 ? 'Active' : 'None',
    energyDraw: categoryDraw('dataControls'),
    detail: {
      rackIocs: iocs,
      ppsInterlocks: interlocks,
      radiationMonitors: monitors,
      timingSystems,
      mps: mpsCount,
      laserSystems,
    },
  };

  // === OPS ===
  const shieldingCount = counts.shielding || 0;
  const targetHandlingCount = counts.targetHandling || 0;
  const beamDumpCount = counts.beamDump || 0;
  const radWasteCount = counts.radWasteStorage || 0;

  const ops = {
    shielding: shieldingCount,
    targetHandling: targetHandlingCount,
    beamDumps: beamDumpCount,
    radWasteStorage: radWasteCount,
    energyDraw: categoryDraw('ops'),
    detail: {
      shielding: shieldingCount,
      targetHandling: targetHandlingCount,
      beamDumps: beamDumpCount,
      radWasteStorage: radWasteCount,
    },
  };

  return { vacuum, rfPower, cryo, cooling, power, dataControls, ops, avgPressure };
}
