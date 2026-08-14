// src/utility/types/cryoTransfer.js
//
// Cryogenic LHe transfer line. Two coupled models live here:
//
//   1. LHe inventory — boil-off scales with heat load, and running the
//      reservoir dry is a hard quench. (Unchanged in kind, but boil-off now
//      keys off the COMPUTED load rather than a declared constant.)
//
//   2. Bath temperature — a real heat balance between what the SRF cavities
//      dissipate and what the cold boxes can remove.
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

export const BOILOFF_PER_W_PER_TICK = 0.0005;
export const RESERVOIR_MAX_L = 500;
export const QUENCH_THRESHOLD_L = 20;
// Balance (Phase 7): a 250 W cryomodule boils ~0.125 L/tick — a ~$24k LHe
// refill every ~3800 ticks. Rare but painful, as LHe should be.
export const LHE_COST_PER_L = 50;

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
  capacityUnit: 'W@4K',
  // Jacketed, but still pipework — a distribution box tees it.
  allowsTap: true,
  fansOut: true,
  // No adjacency bridging: a vacuum-jacketed LHe line is not something you get
  // by pushing two cryostats together — every cryo sink is wired explicitly.
  bridgesAdjacent: false,
  capacityParam: 'coldCapacityW',
  demandParam: 'srfHeatW',
  // $16,000/tile — a vacuum-jacketed LHe transfer line is the outlier of the
  // ladder by design, and there is no cryo distribution component to undercut
  // it: cryo plant belongs next to what it cools. Ladder: powerCable.js.
  costPerSubUnit: 4000,
  persistentStateDefaults: { lheVolumeL: RESERVOIR_MAX_L, tempK: T_DEFAULT },
  solve(network, persistent, worldState) {
    const ratedCapacity = network.sources.reduce(
      (a, s) => a + ((s.params && s.params.coldCapacityW) || 0), 0);
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

    const boiloff = quenched ? 0 : BOILOFF_PER_W_PER_TICK * totalLoad;
    const nextLhe = Math.max(0, currentLhe - boiloff);

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
