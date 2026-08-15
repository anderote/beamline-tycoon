// src/utility/types/cryoTransfer.js
//
// Cryogenic LHe transfer line. Three coupled models live here:
//
//   1. LHe inventory — boil-off scales with heat load, and running the
//      reservoir dry is a hard quench. (Unchanged in kind, but boil-off now
//      keys off the COMPUTED load rather than a declared constant.)
//
//   2. Bath temperature — a real heat balance between what the SRF cavities
//      dissipate and what the cold boxes can remove.
//
//   3. Helium recovery — what fraction of the boiled-off gas comes back as
//      liquid instead of going out the roof vent. See HE_RECOVERY_CONTRIBUTION.
//
// The second is new and is the point of the module. Cryo quality used to be
// `min(1, coldCapacityW / srfHeatW)` where srfHeatW was a hard-coded constant
// per component: a cavity's heat load did not depend on the field it was
// running at, and no temperature existed anywhere in the game. That made
// cryogenic provisioning a box-ticking exercise.
//
// WHY A DESIGN TEMPERATURE RATHER THAN A SOLVED ONE. A helium bath's
// temperature is set by the pressure maintained above it, not by the heat
// going into it — a 2 K plant holds 2 K. Load decides whether the plant can
// MAINTAIN that, not what temperature it settles at. And there is no interior
// equilibrium to solve for anyway: dissipation goes as 1/Q0, which climbs far
// faster with temperature than any plant's capacity does, so
// `capacity - load` decreases monotonically and never re-crosses zero. A
// cryomodule at 20 MV/m dissipates 429 W at 2.0 K and 18.5 kW at 4.5 K.
//
// So: hold T_design while capacity covers load; warm when it does not, at a
// rate set by the net heat. Warming accelerates on its own because Q0 collapses
// as the bath warms — that runaway is the quench mechanic, emergent rather than
// scripted. Back off the gradient and the plant pulls the bath back down.
//
// The counter-pressure already exists in economy.js: 2 K costs 750 W of wall
// power per watt removed versus 250 at 4.5 K. So 2 K buys ~35x the Q0 at 3x the
// electricity, and the operating point is a genuine choice.
//
// The cavity maths lives in src/beamline/cavity-specs.js, mirrored from
// beam_physics/srf.py. See that file for why it is duplicated.

import { CAVITY_SPECS, T_CRITICAL, pDiss } from '../../beamline/cavity-specs.js';
import { endpointsById } from '../endpoint-lookup.js';
import { powerFeedFactor } from '../power-feed.js';

export const BOILOFF_PER_W_PER_TICK = 0.0005;
export const RESERVOIR_MAX_L = 500;
export const QUENCH_THRESHOLD_L = 20;
// Balance (Phase 7): a 250 W cryomodule boils ~0.125 L/tick — a ~$24k LHe
// refill every ~3800 ticks. Rare but painful, as LHe should be.
export const LHE_COST_PER_L = 50;

// --- Helium recovery ---
//
// Boil-off is physics: a watt of heat into a helium bath boils a fixed volume
// of liquid, and no purchase changes that. What a recovery plant changes is
// where the gas GOES. Without one it leaves through the relief header and is
// gone — helium is the one consumable in the building that genuinely cannot be
// remade. With one it is caught, cleaned and re-liquefied, and the only thing
// the player buys back is the difference.
//
// So recovery multiplies the NET inventory loss, not the boil-off rate. The
// thermal model above is untouched: load, capacity, bath temperature and the
// quench mechanic all see the same numbers they saw before. Only the litres
// that actually leave the reservoir change, which is exactly the line item the
// refill bill reads.
//
// WHY FACILITY-WIDE AND KEYED ON TYPE. A recovery plant is one plant. The
// return header, the bag, the purifier and the liquefier are a chain, and a
// facility has one of them serving every cryomodule in the building — it is
// not per-network hardware and there is nothing on a cryo line to attach it
// to. Each TYPE therefore contributes once: five gas bags are five bags on one
// plant, not five plants. The reward is for completing the chain, which is the
// real engineering, rather than for stamping out the cheapest rung.
//
// No recovery plant is closed. Cool-down and warm-up transients, relief lifts,
// purge losses and the purifier's own vent all leave through the roof, and a
// real facility that recovers 90% of its helium is doing very well. 0.90 is
// therefore the ceiling — but it is not the ceiling you get by default.
//
// heRecovery IS A CEILING-RAISER, NOT A CONTRIBUTOR. The four chain parts sum
// to exactly 0.90 on their own, so while heRecovery was a fifth contributor it
// was worth nothing at any price the moment the chain was complete: capped
// before it was counted. That is the same "spend $4M, nothing happens" defect
// the recovery work existed to remove, reintroduced by arithmetic.
//
// So it moved to the other side of the min(). heRecovery is bulk storage, and
// storage is a ceiling by nature — you cannot keep more helium than you have
// somewhere to put. Without it the chain saturates at 0.70 no matter how
// complete it is; the storage plant is what converts a finished chain into
// 0.90. It is never redundant, it is always the last piece, and its value is
// largest exactly when everything else is already built, which is the right
// shape for the most expensive unit in the group.
export const HE_RECOVERY_CONTRIBUTION = {
  heRecoveryHeader: 0.25,  // the manifold that makes recovery possible at all
  heGasBag: 0.15,          // buffers surge so a ramp-down does not blow relief
  hePurifier: 0.20,        // gas you cannot clean is gas you cannot re-use
  heLiquefier: 0.30,       // gas back to liquid — the end of the chain
};
/** Ceiling with bulk storage installed. */
export const HE_RECOVERY_CAP = 0.90;
/** Ceiling without it: recovered gas you cannot store is gas you vent. */
export const HE_RECOVERY_CAP_NO_STORAGE = 0.70;
/** The component that raises the ceiling instead of contributing to the sum. */
export const HE_STORAGE_TYPE = 'heRecovery';

/**
 * Recovery fraction from an iterable of installed component type ids.
 * Duplicates are ignored by construction — the set is of TYPES, not units.
 */
export function heRecoveryFraction(types) {
  const set = new Set(types || []);
  let total = 0;
  for (const type of set) {
    total += HE_RECOVERY_CONTRIBUTION[type] || 0;
  }
  const cap = set.has(HE_STORAGE_TYPE) ? HE_RECOVERY_CAP : HE_RECOVERY_CAP_NO_STORAGE;
  return Math.min(cap, total);
}

/**
 * Recovery fraction for a whole facility. Walks every placeable rather than
 * the network's own ports: none of this hardware sits on a cryo line.
 */
export function facilityHeRecoveryFraction(worldState) {
  if (!worldState) return 0;
  const types = [];
  for (const p of (worldState.placeables || [])) {
    if (p && p.type) types.push(p.type);
  }
  return heRecoveryFraction(types);
}

// --- Thermal model ---
export const T_SUPERFLUID = 2.0;      // sub-cooled 2 K plant (coldBox2K)
export const T_NORMAL = 4.5;          // 4 K cold box (coldBox4K)
export const T_DEFAULT = T_NORMAL;
// Bath heat capacity, W-ticks per kelvin. Warming accelerates on its own as Q0
// collapses, so nearly all of the elapsed time is spent in the first few tenths
// of a kelvin and this constant effectively sets the whole warning window.
// Measured against one cryomodule on a 300 W plant: a hard over-drive
// (25 MV/m, ~2.2x capacity) quenches at tick 21, a moderate one (22 MV/m) at
// tick 29, and a mild one (16 MV/m) never quenches at all. That is the shape
// wanted — sustained over-driving is fatal, but always with time to react.
export const THERMAL_MASS = 20000;
// Plants that run colder deliver less: roughly the Carnot ratio between the
// two operating points, which is where the 750 vs 250 W/W figures in
// economy.js come from.
export const COLD_CAPACITY_EXPONENT = 1.3;

/** Components that define a network's design temperature. */
const PLANT_DESIGN_TEMP = {
  coldBox2K: T_SUPERFLUID,
  coldBox4K: T_NORMAL,
};

/**
 * Useful cooling power at `tempK` from plant rated `ratedW` at its design
 * temperature. A 2 K plant asked to sit at 2 K delivers its rating; the same
 * hardware run warmer delivers more, which is why 4 K operation is cheap.
 */
export function capacityAt(tempK, ratedW, designTempK) {
  if (!(ratedW > 0)) return 0;
  const t = Math.max(tempK, 1.5);
  return Math.min(ratedW * Math.pow(t / designTempK, COLD_CAPACITY_EXPONENT),
                  ratedW * 3);
}

/**
 * Dynamic heat load at `tempK`, watts, over every SRF cavity on the network.
 * Each cavity dissipates at its LAST ACHIEVED gradient — written back by
 * Game._writeBackCavityResults after the physics pass. A cavity with no
 * recorded gradient yet contributes no dynamic load; its static load still
 * counts, so an idle machine still boils helium.
 */
export function dynamicLoadAt(tempK, cavities) {
  let total = 0;
  for (const cav of cavities) {
    total += pDiss(cav.gradient, cav.spec, tempK) * cav.spec.n_cav;
  }
  return total;
}

/**
 * SRF cavities on this network, with their last achieved gradient.
 *
 * Endpoints come from endpoint-lookup, which walks pipe placements too: every
 * cryo sink in the game is a role-'placement' module living inside
 * pipe.placements, so a placeables-only lookup would find none of them.
 */
function collectCavities(network, worldState) {
  const byId = endpointsById(worldState);

  const cavities = [];
  for (const sink of network.sinks) {
    const rec = byId.get(sink.placeableId);
    if (!rec) continue;
    const spec = CAVITY_SPECS[rec.type];
    if (!spec || spec.kind !== 'srf') continue;
    cavities.push({
      id: rec.id,
      spec,
      gradient: typeof rec.gradientAchieved === 'number' ? rec.gradientAchieved : 0,
    });
  }
  return cavities;
}

/** Coldest design temperature among the plants feeding this network. */
function designTemp(network, worldState) {
  const byId = endpointsById(worldState);
  let coldest = null;
  for (const src of network.sources) {
    if (powerFeedFactor(worldState, src.placeableId) <= 0) continue;
    const rec = byId.get(src.placeableId);
    const t = rec && PLANT_DESIGN_TEMP[rec.type];
    if (t != null && (coldest === null || t < coldest)) coldest = t;
  }
  return coldest === null ? T_DEFAULT : coldest;
}

export default {
  type: 'cryoTransfer',
  displayName: 'Cryo Transfer',
  color: '#44aacc',
  geometryStyle: 'jacketedCylinder',
  pipeRadiusMeters: 0.06,
  // The fitting itself supplies the transition; routing may turn immediately
  // without reserving an extra quarter-tile tail on the deck.
  portClearance: false,
  capacityUnit: 'W@4K',
  // Cryogenic transfer is run port-to-port through a valve box; an improvised
  // tee would be a heat leak and is not a player routing shortcut.
  allowsTap: false,
  fansOut: false,
  // No adjacency bridging: a vacuum-jacketed LHe line is not something you get
  // by pushing two cryostats together — every cryo sink is wired explicitly.
  bridgesAdjacent: false,
  capacityParam: 'coldCapacityW',
  demandParam: 'srfHeatW',
  // $640/tile — a vacuum-jacketed LHe transfer line remains the outlier, but
  // cryo plant rather than short routing runs is the real capital decision.
  costPerSubUnit: 160,
  persistentStateDefaults: { lheVolumeL: RESERVOIR_MAX_L, tempK: T_DEFAULT },
  solve(network, persistent, worldState) {
    const ratedCapacity = network.sources.reduce(
      (a, s) => a + ((s.params && s.params.coldCapacityW) || 0)
        * powerFeedFactor(worldState, s.placeableId), 0);
    // Declared srfHeatW is the STATIC load — vessel, transfer line and
    // radiation heat a cavity leaks whether or not it is powered. Taken at
    // face value: it is what the inspector renders as the sink's demand, so
    // rescaling it here would make the panel disagree with the solve. The
    // dynamic RF wall loss, which dominates while running, is computed from
    // the achieved gradient and added below.
    const staticLoad = network.sinks.reduce(
      (a, s) => a + ((s.params && s.params.srfHeatW) || 0), 0);
    const currentLhe = (persistent && persistent.lheVolumeL) || 0;
    const designTempK = designTemp(network, worldState);
    const prevTemp = (persistent && persistent.tempK) || designTempK;

    const cavities = collectCavities(network, worldState);
    const errors = [];
    const perSinkQuality = {};
    const perSinkTemp = {};

    const lheQuench = currentLhe < QUENCH_THRESHOLD_L && network.sinks.length > 0;

    // --- Thermal step ---
    // Net heat into the bath drives temperature. Positive net warms; negative
    // net is the plant pulling back down toward its design point.
    // A quenched cavity is not accelerating: the machine-protection interlock
    // drops the RF the moment it goes normal-conducting. So it contributes no
    // dynamic load, which is what lets the plant pull the bath back down and
    // the operator recover. Without this the quench LATCHES — Q0 falls to the
    // copper value, dissipation goes to megawatts, and the temperature can
    // never come back down no matter what the player does.
    const wasQuenched = prevTemp >= T_CRITICAL;
    const liveCavities = wasQuenched ? [] : cavities;

    const loadNow = staticLoad + dynamicLoadAt(prevTemp, liveCavities);
    const capNow = capacityAt(prevTemp, ratedCapacity, designTempK);
    let tempK = prevTemp + (loadNow - capNow) / THERMAL_MASS;
    if (lheQuench) tempK = T_CRITICAL;
    tempK = Math.max(designTempK, Math.min(T_CRITICAL, tempK));

    const dynamicLoad = dynamicLoadAt(tempK, liveCavities);
    const totalLoad = staticLoad + dynamicLoad;
    const availableCapacity = capacityAt(tempK, ratedCapacity, designTempK);
    const warming = totalLoad > availableCapacity;

    // Thermal quench is a second, independent cause alongside the dry
    // reservoir: a cavity driven past what the plant can remove warms until it
    // loses superconductivity, with the reservoir still full.
    const thermalQuench = tempK >= T_CRITICAL;
    const quenched = lheQuench || thermalQuench;

    let quality;
    if (quenched) {
      quality = 0;
      errors.push({
        severity: 'hard',
        code: lheQuench ? 'cryo_quench' : 'cryo_thermal_quench',
        message: lheQuench
          ? `LHe reservoir below quench threshold (${currentLhe.toFixed(1)} L < ${QUENCH_THRESHOLD_L} L).`
          : `Cavities quenched at ${tempK.toFixed(2)} K — plant cannot remove ${totalLoad.toFixed(0)} W.`,
        location: { networkId: network.id },
      });
    } else if (ratedCapacity === 0 && totalLoad > 0) {
      quality = 0;
      errors.push({
        severity: 'soft',
        code: 'cryo_starved',
        message: 'Cryo network has no cold-box capacity.',
        location: { networkId: network.id },
      });
    } else {
      quality = totalLoad > 0
        ? Math.max(0, Math.min(1, availableCapacity / totalLoad))
        : 1;
      if (warming) {
        errors.push({
          severity: 'soft',
          code: 'cryo_warming',
          message: `Heat load ${totalLoad.toFixed(0)} W exceeds ${availableCapacity.toFixed(0)} W capacity — bath warming (${tempK.toFixed(2)} K).`,
          location: { networkId: network.id },
        });
      }
    }

    for (const s of network.sinks) {
      perSinkQuality[s.portKey] = quality;
      perSinkTemp[s.portKey] = tempK;
    }

    // Boil-off is what the heat load evaporates; net loss is what the player
    // has to buy back. A recovery plant only ever moves the second number.
    const boiloff = quenched ? 0 : BOILOFF_PER_W_PER_TICK * totalLoad;
    const recoveryFraction = facilityHeRecoveryFraction(worldState);
    const netLoss = boiloff * (1 - recoveryFraction);
    const nextLhe = Math.max(0, currentLhe - netLoss);

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        totalCapacity: availableCapacity,
        totalDemand: totalLoad,
        utilization: availableCapacity > 0
          ? Math.min(1, totalLoad / availableCapacity)
          : (totalLoad > 0 ? 1 : 0),
        // Consumed by UtilityGate._aggregateNodeQualities, which raises
        // cryoQuenched on sink placeables so the Python side converts
        // quenched SRF cavities to drifts.
        quenched,
        tempK,
        designTempK,
        staticLoad,
        dynamicLoad,
        ratedCapacity,
        warming,
        // Litres per tick, before and after recovery, plus the fraction that
        // separates them. Reported separately so a panel can show what the
        // plant is saving rather than only the number that survived it; the
        // HUD's own row is derived from the placed types in economy.js, since
        // recovery is facility-wide and exists whether or not a cryo network
        // has solved yet.
        boiloffL: boiloff,
        netLheLossL: netLoss,
        heRecoveryFraction: recoveryFraction,
        perSegmentLoad: [],
        perSinkQuality,
        perSinkTemp,
        errors: [...errors],
      },
      nextPersistentState: { ...persistent, lheVolumeL: nextLhe, tempK },
      errors,
    };
  },
  renderInspector() { return null; },
  refillCost(persistent) {
    const current = (persistent && persistent.lheVolumeL) || 0;
    const missing = RESERVOIR_MAX_L - current;
    if (missing < 1) return null;
    return { funding: Math.ceil(missing * LHE_COST_PER_L) };
  },
};
