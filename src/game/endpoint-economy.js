import { COMPONENTS } from '../data/components.js';
import { getBeamlineType } from '../data/beamline-types.js';

// Endpoint contracts are intentionally expressed in player-facing dollars per
// tick. The beamline type supplies the acceptable operating band; the endpoint
// says who is paying and how much a reference delivery is worth.
export const ENDPOINT_CONTRACTS = {
  faradayCup: {
    name: 'Commissioning time', baseRevenue: 35, workload: 'cpu',
    driverLabel: 'Commissioning beam delivery',
    description: 'Commissioning teams rent in-band beam time to qualify sources and upstream hardware.',
  },
  materialsTestStation: {
    name: 'Materials qualification', baseRevenue: 180, workload: 'cpu',
    driverLabel: 'Delivered beam power',
    description: 'Materials labs pay for useful beam power delivered to samples inside the test envelope.',
  },
  xRayConverterStation: {
    name: 'X-ray inspection', baseRevenue: 520, workload: 'balanced', hardEnergyCeiling: true,
    driverLabel: 'X-ray conversion delivery',
    description: 'Inspection customers pay for useful converted X-ray output below the activation ceiling.',
  },
  eBeamIrradiationVault: {
    name: 'Industrial irradiation', baseRevenue: 900, workload: 'cpu', hardEnergyCeiling: true,
    driverLabel: 'Delivered processing power',
    description: 'Sterilisation and materials-processing work is paid on delivered beam power below the regulatory energy ceiling.',
  },
  isotopeProductionTarget: {
    name: 'Medical isotope supply', baseRevenue: 1500, workload: 'cpu',
    driverLabel: 'Isotope production delivery',
    description: 'Isotope customers pay for sustained in-band proton delivery that drives target yield.',
  },
  radiationEffectsStation: {
    name: 'Electronics radiation testing', baseRevenue: 1200, workload: 'cpu',
    driverLabel: 'Test dose / fluence',
    description: 'Aerospace and electronics customers pay for useful dose delivered across the device under test.',
  },
  protonTherapyGantry: {
    name: 'Patient treatments', baseRevenue: 2500, workload: 'cpu',
    availabilityContract: true, hardEnergyCeiling: true,
    driverLabel: 'Safe delivery & availability',
    description: 'Hospitals pay for safe, available treatment delivery; excess current earns nothing extra.',
  },
  target: {
    name: 'Target user programme', baseRevenue: 600, workload: 'cpu',
    driverLabel: 'Target beam delivery',
    description: 'Target users buy useful in-band beam delivery for experiments and production runs.',
  },
  spallationNeutronTarget: {
    name: 'Neutron instrument time', baseRevenue: 1400, workload: 'balanced',
    driverLabel: 'Neutron production delivery',
    description: 'Instrument users pay for neutron production driven by useful beam power on the spallation target.',
  },
  photonScienceHutch: {
    name: 'Synchrotron user time', baseRevenue: 1800, workload: 'balanced',
    driverLabel: 'Useful photon output',
    description: 'Photon-science users pay for useful light delivered to their instruments.',
  },
  xfelEndstation: {
    name: 'XFEL user programme', baseRevenue: 650, workload: 'gpu',
    driverLabel: 'FEL photon performance',
    description: 'XFEL users pay for useful saturated photon performance, not raw electron power.',
  },
  euvCollector: {
    name: 'EUV fab contract', baseRevenue: 5000, workload: 'gpu', availabilityContract: true,
    driverLabel: 'Usable EUV output',
    description: 'The fabrication contract pays for available, usable EUV photon power at the collector.',
  },
  detector: {
    name: 'Fundamental research', baseRevenue: 0, workload: 'gpu',
    driverLabel: 'Discovery data',
    description: 'Collision data creates scientific progress, not commercial endpoint revenue.',
  },
  collisionPoint: {
    name: 'Fundamental research', baseRevenue: 0, workload: 'gpu',
    driverLabel: 'Collision performance',
    description: 'Luminosity creates discoveries, not commercial endpoint revenue.',
  },
  blackHoleChamber: {
    name: 'Fundamental research', baseRevenue: 0, workload: 'gpu',
    driverLabel: 'Discovery yield',
    description: 'Predicted event yield creates scientific progress, not commercial endpoint revenue.',
  },
  hawkingDetector: {
    name: 'Fundamental research', baseRevenue: 0, workload: 'gpu',
    driverLabel: 'Discovery data',
    description: 'Detected events create scientific progress, not commercial endpoint revenue.',
  },
  beamStop: {
    name: 'Beam disposal', baseRevenue: 0, workload: 'cpu',
    driverLabel: 'Safe beam disposal',
    description: 'A beam stop terminates the line safely but has no paying customer.',
  },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function scoreBand(value, band, width = 0.3, hardHigh = false) {
  if (!band || band.length !== 2) return 1;
  const [lo, hi] = band;
  if (!(value > 0)) return 0;
  if (value >= lo && value <= hi) return 1;
  if (hardHigh && value > hi) return 0;
  const edge = value < lo ? lo : hi;
  const decades = Math.abs(Math.log10(value / edge));
  return Math.exp(-0.5 * Math.pow(decades / Math.max(width, 0.01), 2));
}

function referencePowerKw(type) {
  if (type?.fom === 'beamPowerKw') return type.fomRef || 1;
  if (type?.fom === 'beamPowerMw') return (type.fomRef || 1) * 1000;
  const e = type?.spec?.energyGeV;
  const i = type?.spec?.currentMA;
  if (!e || !i) return 1;
  return Math.sqrt(e[0] * e[1]) * Math.sqrt(i[0] * i[1]) * 1000
    * (type.dutyFactor ?? 1);
}

function performanceScore(type, beamState, contract) {
  const quality = clamp(Number.isFinite(beamState?.beamQuality) ? beamState.beamQuality : 0, 0, 1);
  if (contract.availabilityContract || type?.fom === 'doseAvailability') {
    // Clinical and availability contracts are annuities, not an invitation to
    // over-drive the beam. Quality is the live delivery proxy; lifetime uptime
    // makes repeated trips visible without making a new line permanently poor.
    const uptime = clamp(Number.isFinite(beamState?.uptimeFraction) ? beamState.uptimeFraction : 1, 0, 1);
    return clamp(quality * (0.75 + 0.25 * uptime), 0, 1.15);
  }

  const energy = Math.max(0, beamState?.beamEnergy || 0);
  const current = Math.max(0, beamState?.beamCurrent || 0);
  const deliveredPowerKw = energy * current * 1000 * (type?.dutyFactor ?? 1);
  let output = deliveredPowerKw / Math.max(referencePowerKw(type), 1e-12);

  // Photon customers buy useful light rather than electrons at a dump. The
  // physics photonRate has deliberately game-scaled units, so use it as a
  // bounded bonus on top of the transparent E*I delivery score.
  if (['photonFlux', 'felBrilliance', 'euvPhotonPowerW'].includes(type?.fom)) {
    const photonBonus = Math.max(0, beamState?.photonRate || 0);
    output *= 1 + Math.log10(1 + photonBonus);
    if (type.fom === 'felBrilliance' && !beamState?.felSaturated) output *= 0.25;
  }

  return clamp(output * (0.35 + 0.65 * quality), 0, 2.5);
}

/** Find the customer-facing endpoint on a flattened beamline. */
export function endpointForNodes(nodes = []) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const type = nodes[i]?.type;
    if (type && (COMPONENTS[type]?.isEndpoint || COMPONENTS[type]?.category === 'endpoint')) return type;
  }
  return null;
}

/**
 * Direct service revenue for a running beamline.
 *
 * The deliberately simple mental model is:
 *   contract rate × valid operating-band score × delivered output score.
 * For irradiation and isotope work, delivered output is proportional to
 * energy × current. Therapy is capped and paid on safe availability instead.
 */
export function computeEndpointService(typeId, beamState, nodes = []) {
  const endpointId = endpointForNodes(nodes);
  const contract = ENDPOINT_CONTRACTS[endpointId] || null;
  const type = getBeamlineType(typeId);
  if (!endpointId || !contract || !type) {
    return {
      endpointId, contractName: contract?.name || null,
      baseRevenue: contract?.baseRevenue || 0,
      driverLabel: contract?.driverLabel || null,
      description: contract?.description || null,
      workload: contract?.workload || 'balanced', revenue: 0,
      energyScore: type ? 0 : 1, currentScore: type ? 0 : 1,
      bandScore: type ? 0 : 1, performanceScore: 0,
    };
  }

  const energy = Math.max(0, beamState?.beamEnergy || 0);
  const current = Math.max(0, beamState?.beamCurrent || 0);
  const energyScore = scoreBand(
    energy, type.spec?.energyGeV, type.bandWidth, contract.hardEnergyCeiling,
  );
  const currentScore = scoreBand(current, type.spec?.currentMA, type.bandWidth);
  const bandScore = energyScore * currentScore;
  const outputScore = performanceScore(type, beamState, contract);
  const revenue = contract.baseRevenue * bandScore * outputScore;

  return {
    endpointId,
    contractName: contract.name,
    baseRevenue: contract.baseRevenue,
    driverLabel: contract.driverLabel,
    description: contract.description,
    workload: contract.workload,
    revenue: Number.isFinite(revenue) ? revenue : 0,
    energyScore,
    currentScore,
    bandScore,
    performanceScore: outputScore,
    beamPowerKw: energy * current * 1000 * (type.dutyFactor ?? 1),
  };
}
