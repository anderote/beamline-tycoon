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
import {
  RIGID_UTILITY_SERVICE_HEIGHTS,
  RIGID_UTILITY_SUPPORT_MINIMUM_RUN_METERS,
  RIGID_UTILITY_SUPPORT_SPACING_METERS,
} from '../service-heights.js';
import { FLEXIBLE_SUBTILE_ROUTING_PROFILE } from '../routing-contract.js';

export const BOILOFF_PER_W_PER_TICK = 0.0005;
// Compatibility export for callers that mean the central recovery/storage
// unit. Actual capacity is summed from connected cryogenic storage ports.
export const RESERVOIR_MAX_L = 2000;
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
// Recovery is local to the cryogenic network carrying the returned gas. Every
// stage therefore exposes a real cryo port, and powered stages count only while
// their electrical feed is live. Each TYPE contributes once per network: five
// gas bags are parallel vessels on one chain, not five complete plants. The
// reward is for completing the process chain rather than stamping out the
// cheapest rung.
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
 * Pure recovery-chain arithmetic retained for tests and callers that already
 * have a validated set of live, network-local component type ids. The solver
 * obtains that set through networkHeRecovery().
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
 * Legacy aggregate helper for reports/tests that intentionally ask what a set
 * of placed types could contribute. The live solver uses networkHeRecovery()
 * so disconnected or unpowered stages never affect production state.
 */
export function facilityHeRecoveryFraction(worldState) {
  if (!worldState) return 0;
  const types = [];
  for (const p of (worldState.placeables || [])) {
    if (p && p.type) types.push(p.type);
  }
  return heRecoveryFraction(types);
}

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Physical liquid-helium capacity installed on one solved network. */
export function cryoInventoryForNetwork(network) {
  return {
    storageCapacityL: (network?.sources || []).reduce(
      (sum, source) => sum + positive(source.params?.storageCapacityL), 0),
  };
}

/** Keep persistent inventory inside the capacity of the tanks actually wired. */
export function boundCryoPersistentState(persistent, network) {
  const { storageCapacityL } = cryoInventoryForNetwork(network);
  const rawVolume = persistent?.lheVolumeL;
  const lheVolumeL = Number.isFinite(rawVolume)
    ? Math.max(0, Math.min(storageCapacityL, rawVolume))
    : storageCapacityL;
  return {
    ...(persistent || {}),
    lheVolumeL,
    reservoirCapacityL: storageCapacityL,
  };
}

function reservoirLevel(persistent) {
  const capacity = positive(persistent?.reservoirCapacityL);
  const current = Math.max(0, Math.min(
    capacity,
    Number.isFinite(persistent?.lheVolumeL) ? persistent.lheVolumeL : 0,
  ));
  return { current, capacity };
}

function coolingFeedFactor(worldState, placeableId) {
  if (!worldState?.utilityNetworks?.get) return 1;
  const key = `${placeableId}:cool_in`;
  for (const flow of worldState.utilityNetworkData?.get?.('coolingWater')?.values?.() || []) {
    const quality = flow?.perSinkQuality?.[key];
    if (Number.isFinite(quality)) return Math.max(0, Math.min(1, quality));
  }
  return 0;
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

/**
 * Network-local plant roles. Unlike the retired model, no role is implied by
 * merely having a cryogenic line: storage, refrigeration and warm-end heat
 * rejection are authored independently and all three must be present.
 */
export function cryoPlantCapabilities(network, worldState, getDefinition = () => null) {
  const byId = endpointsById(worldState);
  let coldCapacityW = 0;
  let heatRejectionCapacityW = 0;
  let designTempK = null;
  let hasLn2Reservoir = false;
  let preCoolingFraction = 0;
  let staticHeatReductionFraction = 0;
  let allColdSourcesSealed = true;
  let allStorageSealed = true;
  let coldSourceCount = 0;

  for (const source of (network?.sources || [])) {
    const params = source.params || {};
    const rec = byId.get(source.placeableId);
    const type = rec?.type;
    const powered = powerFeedFactor(worldState, source.placeableId, getDefinition);
    const cold = positive(params.coldCapacityW) * powered;
    if (cold > 0) {
      coldCapacityW += cold;
      coldSourceCount++;
      if (!params.sealedInventory) allColdSourcesSealed = false;
      const t = positive(params.designTempK);
      if (t > 0 && (designTempK === null || t < designTempK)) designTempK = t;
    }
    let rejectFactor = powered;
    // The central compressor's aftercooler is a real cooling-water load. Its
    // cryogenic heat-rejection role therefore fails closed if that loop is
    // absent or starved; integrated cryocoolers reject directly to air.
    if (type === 'heCompressor') {
      rejectFactor *= coolingFeedFactor(worldState, source.placeableId);
    }
    heatRejectionCapacityW += positive(params.heatRejectionCapacityW) * rejectFactor;
    if (positive(params.storageCapacityL) > 0 && !params.sealedInventory) {
      allStorageSealed = false;
    }
    if (params.ln2Reservoir) hasLn2Reservoir = true;
    if (powered > 0) {
      preCoolingFraction += positive(params.preCoolingFraction);
      staticHeatReductionFraction += positive(params.staticHeatReductionFraction);
    }
  }

  if (!hasLn2Reservoir) preCoolingFraction = 0;
  preCoolingFraction = Math.min(0.30, preCoolingFraction);
  staticHeatReductionFraction = Math.min(0.25, staticHeatReductionFraction);
  const { storageCapacityL } = cryoInventoryForNetwork(network);
  const enhancedColdCapacityW = coldCapacityW * (1 + preCoolingFraction);
  return {
    storageCapacityL,
    coldCapacityW,
    enhancedColdCapacityW,
    heatRejectionCapacityW,
    designTempK: designTempK ?? T_DEFAULT,
    preCoolingFraction,
    staticHeatReductionFraction,
    sealedPlant: coldSourceCount > 0 && allColdSourcesSealed && allStorageSealed,
    plantComplete: storageCapacityL > 0
      && enhancedColdCapacityW > 0 && heatRejectionCapacityW > 0,
  };
}

/** Recovery/refill stages must be wired into this network and powered. */
export function networkHeRecovery(network, worldState, getDefinition = () => null) {
  const byId = endpointsById(worldState);
  const contributions = new Map();
  let hasPoweredStorage = false;
  let liquefactionRateLPerTick = 0;
  for (const source of (network?.sources || [])) {
    const params = source.params || {};
    const rec = byId.get(source.placeableId);
    const key = rec?.type || source.placeableId || source.portKey;
    const powered = powerFeedFactor(worldState, source.placeableId, getDefinition);
    if (params.recoveryStorage && powered > 0) hasPoweredStorage = true;
    if (positive(params.recoveryContribution) > 0 && powered > 0) {
      contributions.set(key, Math.max(
        contributions.get(key) || 0,
        positive(params.recoveryContribution),
      ));
    }
    if (powered > 0) {
      liquefactionRateLPerTick += positive(params.liquefactionRateLPerTick);
    }
  }
  const rawFraction = [...contributions.values()].reduce((sum, value) => sum + value, 0);
  const ceiling = hasPoweredStorage ? HE_RECOVERY_CAP : HE_RECOVERY_CAP_NO_STORAGE;
  return {
    fraction: Math.min(ceiling, rawFraction),
    ceiling,
    liquefactionRateLPerTick,
    stageCount: contributions.size,
  };
}

export default {
  type: 'cryoTransfer',
  displayName: 'Cryo Transfer',
  color: '#44aacc',
  geometryStyle: 'jacketedCylinder',
  pipeRadiusMeters: 0.06,
  // The outer vacuum jacket rides above the slab on periodic steel stands.
  // Stand legs are presentation geometry derived from this centreline height;
  // topology and priced path length remain the authored 2D route.
  runHeightMeters: RIGID_UTILITY_SERVICE_HEIGHTS.cryoTransfer,
  // Cryomodule bayonets frequently sit 2–2.5 m above the deck. The endpoint
  // renderer keeps that transition outside the cryostat body, while every
  // ordinary run and automatic same-type join stays on this low service datum.
  fixedRouteHeight: true,
  supportSpacingMeters: RIGID_UTILITY_SUPPORT_SPACING_METERS,
  supportMinimumRunMeters: RIGID_UTILITY_SUPPORT_MINIMUM_RUN_METERS,
  routeVerticalClearanceMeters: 0.06,
  // Transfer lines share the universal flexible subtile routing contract:
  // horizontal/vertical runs and immediate 90-degree bends.
  routingProfile: FLEXIBLE_SUBTILE_ROUTING_PROFILE,
  // Vacuum-jacketed transfer line is visually broad, so let the cursor acquire
  // it across most of a tile before projecting the actual tee onto the run.
  tapSnapRadiusTiles: 0.9,
  // Compact formed elbows and bayonet collars keep the two-layer jacket
  // continuous through turns and make fabricated joints readable at a glance.
  bendRadiusMeters: 0.30,
  fittingStyle: 'cryoBayonet',
  couplerSpacingMeters: 4,
  capacityUnit: 'W@4K',
  // A free-drag branch fabricates a real vacuum-jacketed tee at the contact.
  // Valve boxes remain useful as high-density four-way headers; they are no
  // longer mandatory for every branch in a small distribution tree.
  allowsTap: true,
  // Same-type contact fabricates a joined vacuum-jacketed header, including a
  // crossing or a collinear stretch shared with an existing route.
  joinsOnContact: true,
  fansOut: true,
  // No adjacency bridging: a vacuum-jacketed LHe line is not something you get
  // by pushing two cryostats together — every cryo sink is wired explicitly.
  bridgesAdjacent: false,
  capacityParam: 'coldCapacityW',
  demandParam: 'srfHeatW',
  // $640/tile — a vacuum-jacketed LHe transfer line remains the outlier, but
  // cryo plant rather than short routing runs is the real capital decision.
  costPerSubUnit: 160,
  // null distinguishes a newly commissioned network from a drained one. The
  // first solve resolves inventory against the storage ports actually wired.
  persistentStateDefaults: {
    lheVolumeL: null, reservoirCapacityL: 0, tempK: null,
  },
  persistentIntensiveFields: ['tempK'],
  solve(network, persistent, worldState, context = {}) {
    const plant = cryoPlantCapabilities(network, worldState, context.getDefinition);
    const ratedCapacity = plant.enhancedColdCapacityW;
    const boundedPersistent = boundCryoPersistentState(persistent, network);
    // Declared srfHeatW is the STATIC load — vessel, transfer line and
    // radiation heat a cavity leaks whether or not it is powered. Taken at
    // face value: it is what the inspector renders as the sink's demand, so
    // rescaling it here would make the panel disagree with the solve. The
    // dynamic RF wall loss, which dominates while running, is computed from
    // the achieved gradient and added below.
    const rawStaticLoad = network.sinks.reduce(
      (a, s) => a + ((s.params && s.params.srfHeatW) || 0), 0);
    const staticLoad = rawStaticLoad * (1 - plant.staticHeatReductionFraction);
    const currentLhe = boundedPersistent.lheVolumeL;
    const designTempK = plant.designTempK;
    const prevTemp = Number.isFinite(boundedPersistent.tempK)
      ? boundedPersistent.tempK : designTempK;

    const cavities = collectCavities(network, worldState);
    const errors = [];
    const perSinkQuality = {};
    const perSinkTemp = {};

    const hasLoads = network.sinks.length > 0;
    const plantOffline = !plant.plantComplete && hasLoads;
    const lheQuench = plant.plantComplete
      && currentLhe < QUENCH_THRESHOLD_L && hasLoads;

    // --- Thermal step ---
    // Net heat into the bath drives temperature. Positive net warms; negative
    // net is the plant pulling back down toward its design point.
    // A quenched cavity is not accelerating: the machine-protection interlock
    // drops the RF the moment it goes normal-conducting. So it contributes no
    // dynamic load, which is what lets the plant pull the bath back down and
    // the operator recover. Without this the quench LATCHES — Q0 falls to the
    // copper value, dissipation goes to megawatts, and the temperature can
    // never come back down no matter what the player does.
    const wasQuenched = plantOffline || prevTemp >= T_CRITICAL;
    const liveCavities = wasQuenched ? [] : cavities;

    const loadNow = staticLoad + dynamicLoadAt(prevTemp, liveCavities);
    const capNow = Math.min(
      capacityAt(prevTemp, ratedCapacity, designTempK),
      plant.heatRejectionCapacityW,
    );
    let tempK = plantOffline
      ? T_CRITICAL
      : prevTemp + (loadNow - capNow) / THERMAL_MASS;
    if (lheQuench || plantOffline) tempK = T_CRITICAL;
    tempK = Math.max(designTempK, Math.min(T_CRITICAL, tempK));

    const dynamicLoad = dynamicLoadAt(tempK, liveCavities);
    const totalLoad = staticLoad + dynamicLoad;
    const availableCapacity = plant.plantComplete
      ? Math.min(
        capacityAt(tempK, ratedCapacity, designTempK),
        plant.heatRejectionCapacityW,
      )
      : 0;
    const warming = totalLoad > availableCapacity;

    // Thermal quench is a second, independent cause alongside the dry
    // reservoir: a cavity driven past what the plant can remove warms until it
    // loses superconductivity, with the reservoir still full.
    const thermalQuench = plant.plantComplete && tempK >= T_CRITICAL;
    const quenched = plantOffline || lheQuench || thermalQuench;

    let quality;
    if (plantOffline) {
      quality = 0;
      errors.push({
        severity: 'hard',
        code: 'cryo_plant_offline',
        message: 'Cryo network needs helium storage, refrigeration, and heat rejection.',
        location: { networkId: network.id },
      });
    } else if (lheQuench || thermalQuench) {
      quality = 0;
      errors.push({
        severity: 'hard',
        code: lheQuench ? 'cryo_quench' : 'cryo_thermal_quench',
        message: lheQuench
          ? `LHe reservoir below quench threshold (${currentLhe.toFixed(1)} L < ${QUENCH_THRESHOLD_L} L).`
          : `Cavities quenched at ${tempK.toFixed(2)} K — plant cannot remove ${totalLoad.toFixed(0)} W.`,
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

    // Boil-off is what the heat load evaporates. Only recovery hardware wired
    // into this network can return it; an unwired or unpowered purifier or
    // liquefier is inert. A sealed cryocooler is the packaged exception.
    const boiloff = (!plant.plantComplete || quenched)
      ? 0 : BOILOFF_PER_W_PER_TICK * totalLoad;
    const recovery = networkHeRecovery(network, worldState, context.getDefinition);
    let recoveredL = plant.sealedPlant ? boiloff : boiloff * recovery.fraction;
    if (!plant.sealedPlant && recovery.liquefactionRateLPerTick > 0) {
      recoveredL = Math.min(recoveredL, recovery.liquefactionRateLPerTick);
    }
    const netLoss = Math.max(0, boiloff - recoveredL);
    // The liquefier is the cryogenic equivalent of cooling-water make-up: it
    // turns the site's stored high-pressure gas into liquid inventory. It can
    // therefore restore a depleted central reservoir even while the beam is
    // idle, but never overfills the physical tank and never feeds the sealed
    // charge inside an integrated cryocooler.
    const afterLoss = Math.max(0, currentLhe - netLoss);
    const makeupL = plant.sealedPlant ? 0 : Math.min(
      recovery.liquefactionRateLPerTick,
      Math.max(0, plant.storageCapacityL - afterLoss),
    );
    const nextLhe = afterLoss + makeupL;

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
        rawStaticLoad,
        dynamicLoad,
        ratedCapacity,
        coldCapacityW: plant.coldCapacityW,
        heatRejectionCapacityW: plant.heatRejectionCapacityW,
        storageCapacityL: plant.storageCapacityL,
        reservoirVolumeL: currentLhe,
        plantComplete: plant.plantComplete,
        sealedPlant: plant.sealedPlant,
        preCoolingFraction: plant.preCoolingFraction,
        staticHeatReductionFraction: plant.staticHeatReductionFraction,
        warming,
        // Litres per tick, before and after network-local recovery, plus the
        // fraction that separates them. Reported separately so production UI
        // can display solver-published values without recreating plant logic.
        boiloffL: boiloff,
        recoveredL,
        makeupL,
        netLheLossL: netLoss,
        heRecoveryFraction: plant.sealedPlant ? 1 : recovery.fraction,
        heRecoveryCeiling: plant.sealedPlant ? 1 : recovery.ceiling,
        liquefactionRateLPerTick: recovery.liquefactionRateLPerTick,
        recoveryStageCount: recovery.stageCount,
        perSegmentLoad: [],
        perSinkQuality,
        perSinkTemp,
        errors: [...errors],
      },
      nextPersistentState: {
        ...boundedPersistent,
        lheVolumeL: nextLhe,
        reservoirCapacityL: plant.storageCapacityL,
        tempK,
      },
      errors,
    };
  },
  renderInspector(_network, flow, persistent) {
    const capacity = positive(flow?.storageCapacityL ?? persistent?.reservoirCapacityL);
    const current = Math.max(0, Math.min(
      capacity,
      Number.isFinite(persistent?.lheVolumeL) ? persistent.lheVolumeL : capacity,
    ));
    const pct = capacity > 0 ? current / capacity * 100 : 0;
    const stage = flow?.plantComplete ? 'online' : 'incomplete';
    return `<div><strong>Plant:</strong> ${stage} (storage + refrigerator + heat rejection)</div>`
      + `<div><strong>LHe inventory:</strong> ${current.toFixed(1)} / ${capacity.toFixed(1)} L (${pct.toFixed(0)}%)</div>`
      + `<div><strong>Cold / rejection:</strong> ${positive(flow?.coldCapacityW).toFixed(0)} / ${positive(flow?.heatRejectionCapacityW).toFixed(0)} W</div>`
      + `<div><strong>Recovery / make-up:</strong> ${positive(flow?.recoveredL).toFixed(3)} / ${positive(flow?.makeupL).toFixed(3)} L/tick (${Math.round(positive(flow?.heRecoveryFraction) * 100)}%)</div>`;
  },
  refillCost(persistent) {
    const { current, capacity } = reservoirLevel(persistent);
    const missing = capacity - current;
    if (missing < 1) return null;
    return { funding: Math.ceil(missing * LHE_COST_PER_L) };
  },
  refilledPersistentState(persistent) {
    const capacity = positive(persistent?.reservoirCapacityL);
    return { ...(persistent || {}), lheVolumeL: capacity };
  },
  reservoirLevel,
  boundPersistentState: boundCryoPersistentState,
};
