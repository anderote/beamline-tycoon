import { COMPONENTS } from '../data/components.js';
import { getUtilityPortsV2 } from '../data/utility-ports-v2.js';
// Imported from the solver module directly, not through the utility registry:
// the registry pulls in every type descriptor and economy.js is imported from
// inside that graph. cryoTransfer.js itself only reaches for cavity-specs and
// endpoint-lookup, both leaves.
import {
  heRecoveryFraction, HE_RECOVERY_CAP, HE_RECOVERY_CAP_NO_STORAGE, HE_STORAGE_TYPE,
} from '../utility/types/cryoTransfer.js';
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
 * Facility-wide passive revenue for one tick, split into the terms the
 * economy panel reports: base grant + research passive funding, and
 * reputation revenue, both scaled by the decoration reputation tier's
 * funding bonus.
 *
 * `total` is the only value anything is allowed to credit, and the terms sum
 * to it exactly — `reputation` carries the rounding residual, because the
 * bill has always been floored once, on the sum. A panel that floors the
 * terms separately would quote a total the balance never moved by.
 */
export function computeTickIncomeBreakdown(state, researchPassive = 0) {
  const passive = ECON.baseGrant + researchPassive;
  const rep = Math.max(0, state.resources?.reputation || 0);
  const repIncome = ECON.repIncomeRate * Math.sqrt(rep);
  const repBonus = state?.reputationTier?.fundingBonus || 0;
  const total = Math.floor((passive + repIncome) * (1 + repBonus));
  const grant = Math.floor(passive * (1 + repBonus));
  return { grant, reputation: total - grant, total };
}

/**
 * Facility-wide passive revenue for one tick. The breakdown's total and
 * nothing else — the two must not be able to disagree.
 */
export function computeTickIncome(state, researchPassive = 0) {
  return computeTickIncomeBreakdown(state, researchPassive).total;
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
 *
 * Split into { beam, dataFees, total } because the economy panel reports the
 * two separately and must report what was paid, not a second derivation of
 * it — the 50x user-fee defect above came from exactly that.
 */
export function computeBeamIncomeBreakdown(beamState, nodeCount = 0, options = {}) {
  // `|| 0.2` here treated a legitimate quality of exactly 0 (lattice.py
  // returns beam_quality 0.0 outright when the emittance ratio degenerates)
  // as 20%, so a fully scrambled beam still earned income forever. The 0.2 is
  // only a stand-in for "physics hasn't reported yet".
  const raw = beamState.beamQuality;
  const q = Number.isFinite(raw) ? raw : 0.2;
  // Typed beamlines earn primarily from the service performed at their
  // endpoint. The small operating allowance keeps a temporarily out-of-band
  // machine from becoming literally valueless while it is tuned. Untyped
  // legacy/scenario lines retain the old node-count economy for save and
  // balance compatibility.
  const beam = options.typed
    ? q * (20 + 10 * nodeCount) + Math.max(0, options.serviceRevenue || 0)
    : q * (ECON.beamIncomeBase + ECON.beamIncomePerNode * nodeCount);
  const dataFees = dataFeeIncome(beamState.dataRate);
  return { beam, dataFees, total: beam + dataFees };
}

/** The breakdown's total, which is the amount one running beamline is paid. */
export function computeBeamIncome(beamState, nodeCount = 0, options = {}) {
  return computeBeamIncomeBreakdown(beamState, nodeCount, options).total;
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

/**
 * Worst residual-gas pressure, mbar, across every vacuum network that actually
 * serves something. Returns atmosphere (1013) when nothing is pumped, which is
 * both the physical truth and the fail-closed answer.
 *
 * Worst-case rather than average: a beamline is only as good as its dirtiest
 * section, and a single unpumped run will scatter the beam regardless of how
 * well the rest of the machine is pumped.
 */
export function worstVacuumPressure(state) {
  let worst = null;
  for (const [utilityType, perType] of (state?.utilityNetworkData || [])) {
    if (utilityType !== 'vacuumPipe') continue;
    for (const flow of perType.values()) {
      // No sinks means this network pumps nothing — it cannot report a
      // meaningful pressure, and counting it would let an unconnected pump
      // claim a perfect vacuum.
      const sinkPressures = flow.perSinkPressure || {};
      if (Object.keys(sinkPressures).length === 0) continue;
      const p = typeof flow.pressure === 'number' ? flow.pressure : 1013;
      if (worst === null || p > worst) worst = p;
    }
  }
  return worst === null ? 1013 : worst;
}

/**
 * Worst RF reflected-power fraction across every cavity in the facility.
 *
 * Cavities are pipe placements, not placeables, so both stores are walked. The
 * 0.02 floor is the ordinary standing-wave mismatch of a well-tuned cavity —
 * VSWR is never exactly 1.
 */
export function worstReflectedFraction(state) {
  let worst = 0.02;
  for (const pipe of (state?.beamPipes || [])) {
    for (const att of (pipe.placements || [])) {
      const r = att && att.reflectedFraction;
      if (typeof r === 'number' && r > worst) worst = r;
    }
  }
  for (const p of (state?.placeables || [])) {
    const r = p && p.reflectedFraction;
    if (typeof r === 'number' && r > worst) worst = r;
  }
  for (const flow of state?.utilityNetworkData?.get?.('rfWaveguide')?.values?.() || []) {
    const r = flow && flow.branchReflectionFraction;
    if (typeof r === 'number' && r > worst) worst = r;
  }
  return Math.min(worst, 0.99);
}

/**
 * Live cryogenic state aggregated across every cryo network.
 *
 * Returns null when no network is solving, so callers can fall back rather
 * than reporting a confident zero. Temperature is worst-case (the warmest
 * bath), loads are summed, because a facility is judged by its weakest plant
 * but pays for all of them.
 */
export function cryoNetworkSummary(state) {
  let tempK = null, staticLoad = 0, dynamicLoad = 0, capacity = 0, rated = 0;
  let quenched = false, warming = false, found = false;
  for (const [utilityType, perType] of (state?.utilityNetworkData || [])) {
    if (utilityType !== 'cryoTransfer') continue;
    for (const flow of perType.values()) {
      if (Object.keys(flow.perSinkQuality || {}).length === 0) continue;
      found = true;
      if (typeof flow.tempK === 'number' && (tempK === null || flow.tempK > tempK)) {
        tempK = flow.tempK;
      }
      staticLoad += flow.staticLoad || 0;
      dynamicLoad += flow.dynamicLoad || 0;
      capacity += flow.totalCapacity || 0;
      rated += flow.ratedCapacity || 0;
      if (flow.quenched) quenched = true;
      if (flow.warming) warming = true;
    }
  }
  if (!found) return null;
  return { tempK, staticLoad, dynamicLoad, capacity, rated, quenched, warming };
}

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
    const matches = typeof portName === 'function'
      ? portName
      : name => name === portName;
    let total = 0;
    for (const e of equip) {
      for (const [name, port] of Object.entries(getUtilityPortsV2(e.type) || {})) {
        const v = port?.params?.[param];
        if (matches(name) && typeof v === 'number') total += v;
      }
    }
    return total;
  };

  // === VACUUM ===
  const gaugeTypes = ['piraniGauge', 'coldCathodeGauge', 'baGauge'];
  const pumpCount = countPumps(state);
  const gaugeCount = gaugeTypes.reduce((s, t) => s + (counts[t] || 0), 0);
  const totalPumpSpeed = portCapacity('vac_out', 'pumpSpeed');
  // Pressure comes from the utility solver, which computes the real
  // steady-state relation P = Q/S over the network's actual gas load and pump
  // speed (src/utility/types/vacuumPipe.js).
  //
  // This panel used to derive its own number instead — `1e-6 / (S/V)`, a
  // volume-based formula with a magic constant that is not P = Q/S. So the
  // pressure the player READ was never the pressure their beam responded to,
  // and the `goodVacuum` objective keyed on the wrong one of the two. There is
  // now a single pressure in the game.
  //
  // Networks with no sinks are skipped, which keeps the old exploit closed: a
  // lone turboPump wired to nothing has zero gas load, and the solver's
  // `pressure = totalOutgas / totalPumpSpeed` would read as a perfect vacuum
  // for a facility that has no beamline at all.
  const avgPressure = worstVacuumPressure(state);
  const pumped = avgPressure < 1013;
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
    'slac5045Klystron', 'pulsedKlystron', 'cwKlystron', 'multibeamKlystron',
    'gyrotron',
  ];
  const rfSourceCount = rfSourceTypes.reduce((s, t) => s + (counts[t] || 0), 0);

  // Some amplifiers expose several physical RF outputs; they are a shared
  // internal combiner whose per-port ratings add to its nameplate output.
  const totalFwdPower = portCapacity(name => name.startsWith('rf_out'), 'capacity');
  // Reflected power comes from real cavity detuning rather than a flat 2%
  // guess. An undercooled normal-conducting cavity expands, walks off
  // resonance, and stops absorbing the power aimed at it — the physics pass
  // stamps that fraction per cavity (beam_physics/srf.py detune_coupling) and
  // Game._writeBackCavityResults puts it on the placement. Worst cavity wins:
  // one badly mismatched load is what the klystron actually sees.
  const reflFraction = worstReflectedFraction(state);
  const totalReflPower = totalFwdPower * reflFraction;

  // RF source energyCost is its wall-plug draw (output / efficiency, rounded
  // for the catalogue). Use the placed sources themselves instead of
  // re-converting all nameplate output through a fictional flat 55%: that
  // estimate disagreed with both the electricity bill and the power gate for
  // every mixed-source facility.
  const rfWallPower = categoryDraw('rfPower', 'supply');
  const avgEfficiency = rfWallPower > 0 ? totalFwdPower / rfWallPower : 0;
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
      klystrons: (counts.slac5045Klystron || 0) + (counts.pulsedKlystron || 0)
        + (counts.cwKlystron || 0) + (counts.multibeamKlystron || 0),
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
  const cryocoolers = counts.cryocooler || 0;
  // "He Recovery: Yes/No" counted a single $4M block and meant nothing to the
  // solver. The recovery chain is now a fraction of boil-off returned instead
  // of vented, contributed once per installed TYPE — so the panel reports the
  // fraction, which is the number that actually shows up on the helium bill.
  // The table and the ceiling live with the solver that applies them. The
  // ceiling is not a constant: bulk storage (heRecovery) raises it from 0.70
  // to 0.90, so the panel prints the fraction AND the ceiling in force —
  // otherwise a player with a finished chain sees 70% and no reason for it.
  const heRecoveryFrac = heRecoveryFraction(Object.keys(counts));
  const heRecoveryCeiling = counts[HE_STORAGE_TYPE]
    ? HE_RECOVERY_CAP : HE_RECOVERY_CAP_NO_STORAGE;

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
  // Live values from the cryo solver when it has run. The fallback split
  // (20% static / 80% dynamic of declared srfHeat) is only for a facility
  // whose networks have not solved yet — it is a guess, and the solver's
  // numbers are real: dynamic load is computed from the gradient each cavity
  // actually reached, at the temperature the bath actually reached.
  const cryoLive = cryoNetworkSummary(state);
  let staticLoad, dynamicLoad, opTemp;
  if (cryoLive) {
    staticLoad = Math.round(cryoLive.staticLoad + cryoHousings * 3);
    dynamicLoad = Math.round(cryoLive.dynamicLoad);
    opTemp = cryoLive.tempK != null ? cryoLive.tempK : 0;
  } else {
    staticLoad = cryoHousings * 3 + Math.round(srfHeat * 0.2);
    dynamicLoad = Math.round(srfHeat * 0.8);
    opTemp = subCooling2K > 0 ? 2.0 : (coldBox4K > 0 ? 4.5 : 0);
  }
  const totalCryoLoad = staticLoad + dynamicLoad;

  // Carnot penalty: removing a watt at 2 K costs about three times what it
  // costs at 4.5 K. This is the counter-pressure that makes the operating
  // point a real choice rather than "always run colder" — 2 K buys ~35x the
  // cavity Q0, and charges for it here.
  const carnot = opTemp > 0 && opTemp <= 2.5 ? 750 : 250;
  const cryoWallPower = totalCryoLoad * carnot / 1000; // kW
  // Margin against the capacity actually available at the bath's current
  // temperature, not the plant's nameplate rating — a 2 K plant delivers well
  // under its 4.5 K number, which is exactly the trade the player is making.
  const availableCryo = cryoLive ? cryoLive.capacity : cryoCapacity;
  const cryoMargin = availableCryo > 0
    ? ((availableCryo - totalCryoLoad) / availableCryo * 100) : 0;

  const cryo = {
    coolingCapacity: cryoLive ? cryoLive.capacity : cryoCapacity,
    heatLoad: totalCryoLoad,
    opTemp,
    wallPower: cryoWallPower,
    margin: Math.max(cryoMargin, 0),
    quenched: !!(cryoLive && cryoLive.quenched),
    warming: !!(cryoLive && cryoLive.warming),
    energyDraw: categoryDraw('cooling', 'cryogenics'),
    detail: {
      compressors,
      coldBox4K,
      subCooling2K,
      cryoHousings,
      ln2Precoolers: ln2Precool,
      heRecoveryFraction: heRecoveryFrac,
      heRecoveryCeiling,
      cryocoolers,
      staticLoad,
      dynamicLoad,
    },
  };

  // === COOLING ===
  // The two entry-tier units are counted on their own row rather than folded
  // into lcwSkids/chillers: they are a different purchase decision (cheap per
  // unit, bad per kW) and a player looking at the panel wants to see how much
  // of their capacity is still coming from the starter gear.
  const fanCoils = counts.fanCoilCooler || 0;
  const packageChillers = counts.packageChiller || 0;
  const lcwSkids = counts.lcwSkid || 0;
  const dualCircuitChillers = counts.dualCircuitChiller || 0;
  const chillers = counts.chiller || 0;
  const dryCoolerBanks = counts.dryCoolerBank || 0;
  const towers = counts.coolingTower || 0;
  const exchangers = counts.heatExchanger || 0;
  const waterLoads = counts.waterLoad || 0;
  const deionizers = counts.deionizer || 0;
  const emergCooling = counts.emergencyCooling || 0;

  // Cooling plants expose several independently routable branches, with the
  // nameplate divided across their cool_out* source ports. Sum the whole
  // internal header rather than reporting only the legacy centre socket.
  const coolingCap = portCapacity(name => name.startsWith('cool_out'), 'capacity');
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
      fanCoils,
      packageChillers,
      lcwSkids,
      dualCircuitChillers,
      chillers,
      dryCoolerBanks,
      coolingTowers: towers,
      heatExchangers: exchangers,
      waterLoads,
      deionizers,
      emergencyCooling: emergCooling,
    },
  };

  // === POWER ===
  const substations = (counts.padMountTransformer || 0)
    + (counts.facilityTransformer || 0)
    + (counts.hvTransformer || 0)
    + (counts.gridIntertieTransformer || 0);
  const panels = counts.powerPanel || 0;
  const laserSystems = counts.laserSystem || 0;

  // Capacity is the sum of every placed SUPPLY's HV outlets — the same ladder
  // the utility solver gates on (padMount 150 → facility 400 → HV 1200 → grid
  // intertie 3000). Switchgear and distribution panels are deliberately not counted: they add no
  // capacity, they convert one feeder into sockets, so counting their ratings
  // here would tell the player they had more power than the solver will give
  // them. (This used to read `state.maxElectricalPower`, a field whose only
  // other reference is the line in Game.load() that deletes it as deprecated,
  // so the panel was pinned to a 500 kW fallback and read 100% utilization on
  // any real facility.)
  let powerCapacity = 0;
  for (const e of equip) {
    const ports = getUtilityPortsV2(e.type) || {};
    for (const spec of Object.values(ports)) {
      if (!spec || spec.utility !== 'hvCable' || spec.role !== 'source') continue;
      const cap = spec.params && spec.params.capacity;
      if (typeof cap === 'number') powerCapacity += cap;
    }
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
  const ds = state.dataSystemSnapshot || {};
  const dc = ds.capacity || {};

  const dataControls = {
    iocs,
    interlocks,
    monitors,
    timingSystems,
    mpsStatus: mpsCount > 0 ? 'Active' : 'None',
    ingestCapacity: dc.ingest || 0,
    storageCapacity: dc.storage || 0,
    cpuCapacity: dc.cpu || 0,
    gpuCapacity: dc.gpu || 0,
    ingestRate: ds.ingested || 0,
    processedRate: ds.processed || 0,
    rawStored: ds.stored || 0,
    droppedRate: ds.dropped || 0,
    energyDraw: categoryDraw('dataControls'),
    detail: {
      rackIocs: iocs,
      ppsInterlocks: interlocks,
      radiationMonitors: monitors,
      timingSystems,
      mps: mpsCount,
      laserSystems,
      dataUnits: dc.units || {},
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
