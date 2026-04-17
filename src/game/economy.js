import { COMPONENTS } from '../data/components.js';
import { Networks } from '../networks/networks.js';

export function computeSystemStats(state) {
  const equip = (state.placeables || []).filter(p => p.category === 'equipment');
  const beamline = state.beamline || [];
  const nets = state.networkData; // may be null if Networks not loaded yet

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

  // === VACUUM ===
  const pumpTypes = ['roughingPump', 'turboPump', 'ionPump', 'negPump', 'tiSubPump'];
  const gaugeTypes = ['piraniGauge', 'coldCathodeGauge', 'baGauge'];
  const pumpCount = pumpTypes.reduce((s, t) => s + (counts[t] || 0), 0);
  const gaugeCount = gaugeTypes.reduce((s, t) => s + (counts[t] || 0), 0);
  const pumpSpeeds = { roughingPump: 10, turboPump: 300, ionPump: 100, negPump: 200, tiSubPump: 500 };

  // If network validation data is available, use vacuum conductance calculations
  let avgPressure, totalPumpSpeed, pressureQuality;
  if (nets && nets.vacuumPipe && nets.vacuumPipe.length > 0) {
    const vacNets = nets.vacuumPipe.map(net => Networks.validateVacuumNetwork(net, beamline));
    totalPumpSpeed = vacNets.reduce((s, n) => s + n.effectivePumpSpeed, 0);
    const gasLoad = Math.max(totalVolume, 1) * Networks.OUTGASSING_RATE;
    avgPressure = totalPumpSpeed > 0 ? gasLoad / totalPumpSpeed : (pumpCount > 0 ? 1013 : 1013);
    // Derive quality from the computed pressure
    if (totalPumpSpeed === 0) pressureQuality = 'None';
    else if (avgPressure < 1e-9) pressureQuality = 'Excellent';
    else if (avgPressure < 1e-7) pressureQuality = 'Good';
    else if (avgPressure < 1e-4) pressureQuality = 'Marginal';
    else pressureQuality = 'Poor';
  } else {
    // Fallback to old estimation from equipment counts
    totalPumpSpeed = pumpTypes.reduce((s, t) => s + (counts[t] || 0) * (pumpSpeeds[t] || 0), 0);
    avgPressure = state.avgPressure || (pumpCount > 0 ? 1e-6 / Math.max(totalPumpSpeed / Math.max(totalVolume, 1), 0.01) : 1013);
    pressureQuality = 'None';
    if (pumpCount > 0) {
      if (avgPressure < 1e-9) pressureQuality = 'Excellent';
      else if (avgPressure < 1e-7) pressureQuality = 'Good';
      else if (avgPressure < 1e-4) pressureQuality = 'Marginal';
      else pressureQuality = 'Poor';
    }
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
  const rfSourceTypes = ['klystron', 'ssa', 'iot', 'magnetron'];
  const rfSupportTypes = ['modulator', 'circulator', 'waveguide', 'llrfController', 'masterOscillator', 'vectorModulator'];
  const rfSourceCount = rfSourceTypes.reduce((s, t) => s + (counts[t] || 0), 0);

  // If network data exists, sum forward/reflected power from RF network validations
  let totalFwdPower, totalReflPower;
  if (nets && nets.rfWaveguide && nets.rfWaveguide.length > 0) {
    const rfNets = nets.rfWaveguide.map(net => Networks.validateRfNetwork(net));
    totalFwdPower = rfNets.reduce((s, n) => s + n.forwardPower, 0);
    totalReflPower = rfNets.reduce((s, n) => s + n.reflectedPower, 0);
  } else {
    // Fallback to old estimation from equipment counts
    const rfPowerPerSource = { klystron: 5000, ssa: 100, iot: 80, magnetron: 2000 };
    totalFwdPower = rfSourceTypes.reduce((s, t) => s + (counts[t] || 0) * (rfPowerPerSource[t] || 0), 0);
    const reflFraction = 0.02;
    totalReflPower = totalFwdPower * reflFraction;
  }

  const avgEfficiency = rfSourceCount > 0 ? 0.55 : 0; // rough average
  const rfWallPower = avgEfficiency > 0 ? totalFwdPower / avgEfficiency : 0;
  const reflFraction = totalFwdPower > 0 ? totalReflPower / totalFwdPower : 0;
  const vswr = reflFraction > 0 ? ((1 + Math.sqrt(reflFraction)) / (1 - Math.sqrt(reflFraction))).toFixed(2) : '1.00';

  const rfPower = {
    totalFwdPower,
    totalReflPower,
    wallPower: rfWallPower,
    vswr,
    sourceCount: rfSourceCount,
    avgEfficiency: avgEfficiency * 100,
    energyDraw: categoryDraw('rfPower'),
    detail: {
      klystrons: counts.klystron || 0,
      ssas: counts.ssa || 0,
      iots: counts.iot || 0,
      magnetrons: counts.magnetron || 0,
      modulators: counts.modulator || 0,
      circulators: counts.circulator || 0,
      waveguides: counts.waveguide || 0,
      llrfControllers: counts.llrfController || 0,
      masterOscillators: counts.masterOscillator || 0,
      vectorModulators: counts.vectorModulator || 0,
    },
  };

  // === CRYO ===
  const compressors = counts.heliumCompressor || 0;
  const coldBox4K = counts.coldBox4K || 0;
  const subCooling2K = counts.subCooling2K || 0;
  const cryoHousings = counts.cryomoduleHousing || 0;
  const ln2Precool = counts.ln2Precooler || 0;
  const heRecovery = counts.heRecovery || 0;
  const cryocoolers = counts.cryocooler || 0;

  let cryoCapacity, totalCryoLoad, opTemp, staticLoad, dynamicLoad;
  if (nets && nets.cryoTransfer && nets.cryoTransfer.length > 0) {
    const cryoNets = nets.cryoTransfer.map(net => Networks.validateCryoNetwork(net));
    cryoCapacity = cryoNets.reduce((s, n) => s + n.capacity, 0);
    totalCryoLoad = cryoNets.reduce((s, n) => s + n.heatLoad, 0);
    // Use best (lowest nonzero) opTemp from networks
    opTemp = 0;
    for (const cn of cryoNets) {
      if (cn.opTemp > 0 && (opTemp === 0 || cn.opTemp < opTemp)) opTemp = cn.opTemp;
    }
    // Decompose load into static/dynamic for detail (estimate from counts)
    const srfCavities = beamline.filter(n => n.type === 'cryomodule').length;
    staticLoad = cryoHousings * 3 + srfCavities * 3;
    dynamicLoad = totalCryoLoad - staticLoad;
    if (dynamicLoad < 0) { staticLoad = totalCryoLoad; dynamicLoad = 0; }
  } else {
    // Fallback to old estimation from equipment counts
    cryoCapacity = coldBox4K * 500 + subCooling2K * 200 + cryocoolers * 50;
    const srfCavities = beamline.filter(n => n.type === 'cryomodule').length;
    staticLoad = cryoHousings * 3 + srfCavities * 3;
    dynamicLoad = srfCavities * 15;
    totalCryoLoad = staticLoad + dynamicLoad;
    opTemp = subCooling2K > 0 ? 2.0 : (coldBox4K > 0 ? 4.5 : 0);
  }

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

  let coolingCap, coolingLoad;
  if (nets && nets.coolingWater && nets.coolingWater.length > 0) {
    const coolNets = nets.coolingWater.map(net => Networks.validateCoolingNetwork(net));
    coolingCap = coolNets.reduce((s, n) => s + n.capacity, 0);
    coolingLoad = coolNets.reduce((s, n) => s + n.heatLoad, 0);
  } else {
    // Fallback to old estimation from equipment counts
    coolingCap = lcwSkids * 100 + chillers * 200 + towers * 500;
    coolingLoad = (state.totalEnergyCost || 0) * 0.6; // ~60% of electrical becomes heat
  }

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

  let powerCapacity, totalDraw;
  if (nets && nets.powerCable && nets.powerCable.length > 0) {
    const pwrNets = nets.powerCable.map(net => Networks.validatePowerNetwork(net));
    powerCapacity = pwrNets.reduce((s, n) => s + n.capacity, 0);
    totalDraw = pwrNets.reduce((s, n) => s + n.draw, 0);
  } else {
    // Fallback to old estimation
    powerCapacity = state.maxElectricalPower || 500;
    totalDraw = (state.totalEnergyCost || 0) + vacuum.energyDraw + rfPower.energyDraw + cryo.energyDraw + cooling.energyDraw;
  }

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
      beamlineDraw: state.totalEnergyCost || 0,
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
