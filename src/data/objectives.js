import { COMPONENTS } from './components.js';
import { RESEARCH } from './research.js';

export const OBJECTIVES = [
  // === Tier 0 — Getting Started ===
  {
    id: 'firstBeam',
    name: 'First Beam!',
    desc: 'Build a source and turn on the beam.',
    condition: (state) => state.beamOn && state.beamline.some(n => COMPONENTS[n.type]?.isSource),
    reward: { funding: 500000, reputation: 1 },
    tier: 0,
  },
  {
    id: 'firstMeasurement',
    name: 'First Measurement',
    desc: 'Place a BPM and measure beam position.',
    condition: (state) => state.beamOn && state.beamline.some(n => n.type === 'bpm'),
    reward: { funding: 300000, reputation: 1 },
    tier: 0,
  },
  {
    id: 'stableBeam',
    name: 'Stable Beam',
    desc: 'Run beam for 60 continuous seconds.',
    condition: (state) => state.continuousBeamTicks >= 60,
    reward: { funding: 500000, reputation: 1 },
    tier: 0,
  },

  // === Tier 1 — Basic Competence ===
  {
    id: 'reach100mev',
    name: '100 MeV',
    desc: 'Reach a beam energy of 100 MeV.',
    condition: (state) => state.beamEnergy >= 0.1,
    reward: { funding: 1000000, reputation: 2 },
    tier: 1,
  },
  {
    id: 'beamCharacterization',
    name: 'Beam Characterization',
    desc: 'Measure emittance, energy, and current simultaneously.',
    condition: (state) => {
      const types = state.beamline.map(n => n.type);
      return types.includes('wireScanner') && types.includes('energySpectrometer') && types.includes('ict');
    },
    reward: { funding: 500000, reputation: 2 },
    tier: 1,
  },
  {
    id: 'firstUser',
    name: 'First User',
    desc: 'Build a photon port and deliver beam hours.',
    condition: (state) => state.totalBeamHours >= 1 && state.beamline.some(n => n.type === 'photonPort'),
    reward: { funding: 2000000, reputation: 3 },
    tier: 1,
  },
  {
    id: 'goodVacuum',
    name: 'Good Vacuum',
    desc: 'Achieve average pressure below 1e-8 mbar.',
    condition: (state) => state.avgPressure !== undefined && state.avgPressure < 1e-8,
    reward: { funding: 500000, reputation: 1 },
    tier: 1,
  },
  {
    id: 'firstResearch',
    name: 'Knowledge Seeker',
    desc: 'Complete your first research project.',
    condition: (state) => state.completedResearch.length >= 1,
    reward: { funding: 500000, reputation: 2 },
    tier: 1,
  },
  {
    id: 'firstData',
    name: 'First Light',
    desc: 'Collect 10 units of research data.',
    condition: (state) => state.totalDataCollected >= 10,
    reward: { funding: 300000, reputation: 1 },
    tier: 1,
  },

  // === Tier 2 — Real Facility ===
  {
    id: 'reach1gev',
    name: 'GeV Club',
    desc: 'Reach a beam energy of 1 GeV.',
    condition: (state) => state.beamEnergy >= 1,
    reward: { funding: 5000000, reputation: 5 },
    tier: 2,
  },
  {
    id: 'cwOperation',
    name: 'CW Operation',
    desc: 'Run CW beam for 300 continuous seconds.',
    condition: (state) => state.continuousBeamTicks >= 300,
    reward: { funding: 3000000, reputation: 3 },
    tier: 2,
  },
  {
    id: 'subMicronEmittance',
    name: 'Sub-micron Emittance',
    desc: 'Achieve normalized emittance below 1 \u03bcm at >100 MeV.',
    condition: (state) => state.beamEnergy >= 0.1 && state.finalNormEmittanceX !== undefined && state.finalNormEmittanceX < 1e-6,
    reward: { funding: 3000000, reputation: 5 },
    tier: 2,
  },
  {
    id: 'fiveUsers',
    name: 'Five Users',
    desc: 'Serve 5 simultaneous photon beamline ports.',
    condition: (state) => state.beamline.filter(n => n.type === 'photonPort').length >= 5,
    reward: { funding: 10000000, reputation: 10 },
    tier: 2,
  },
  {
    id: 'firstTarget',
    name: 'First Target',
    desc: 'Run beam on a fixed target.',
    condition: (state) => state.beamOn && state.beamline.some(n => COMPONENTS[n.type]?.isEndpoint),
    reward: { funding: 3000000, reputation: 5 },
    tier: 2,
  },
  {
    id: 'tenComponents',
    name: 'Growing Machine',
    desc: 'Install 10 components on your beamline.',
    condition: (state) => state.beamline.length >= 10,
    reward: { funding: 800000, reputation: 2 },
    tier: 2,
  },
  {
    id: 'collect100data',
    name: 'Data Hoarder',
    desc: 'Collect 100 units of research data.',
    condition: (state) => state.totalDataCollected >= 100,
    reward: { funding: 1500000, reputation: 3 },
    tier: 2,
  },
  {
    id: 'threeResearch',
    name: 'Research Program',
    desc: 'Complete 3 research projects.',
    condition: (state) => state.completedResearch.length >= 3,
    reward: { funding: 2000000, reputation: 5 },
    tier: 2,
  },

  // === Tier 3 — World Class ===
  {
    id: 'reach10gev',
    name: '10 GeV',
    desc: 'Reach a beam energy of 10 GeV.',
    condition: (state) => state.beamEnergy >= 10,
    reward: { funding: 20000000, reputation: 10 },
    tier: 3,
  },
  {
    id: 'srfLinac',
    name: 'SRF Linac',
    desc: 'Operate 10 or more SRF cavities simultaneously.',
    condition: (state) => state.beamline.filter(n => n.type === 'cryomodule' || n.type === 'srf650Cavity').length >= 10,
    reward: { funding: 10000000, reputation: 5 },
    tier: 3,
  },
  {
    id: 'bunchCompressed',
    name: 'Bunch Compression',
    desc: 'Achieve bunch length below 100 fs.',
    condition: (state) => state.finalBunchLength !== undefined && state.finalBunchLength < 100e-15,
    reward: { funding: 5000000, reputation: 10 },
    tier: 3,
  },
  {
    id: 'felSaturation',
    name: 'FEL Saturation',
    desc: 'Achieve free-electron laser saturation.',
    condition: (state) => state.felSaturated === true,
    reward: { funding: 50000000, reputation: 20 },
    tier: 3,
  },
  {
    id: 'highAvailability',
    name: 'High Availability',
    desc: 'Maintain 95% uptime over 1000 ticks.',
    condition: (state) => state.tick >= 1000 && state.uptimeFraction >= 0.95,
    reward: { funding: 10000000, reputation: 10 },
    tier: 3,
  },
  {
    id: 'collect1000data',
    name: 'Big Data',
    desc: 'Collect 1,000 units of research data.',
    condition: (state) => state.totalDataCollected >= 1000,
    reward: { funding: 5000000, reputation: 10 },
    tier: 3,
  },
  {
    id: 'userFacility',
    name: 'User Facility',
    desc: 'Reach 10 reputation.',
    condition: (state) => state.resources.reputation >= 10,
    reward: { funding: 3000000 },
    tier: 3,
  },

  // === Tier 4 — Frontier ===
  {
    id: 'reach100gev',
    name: '100 GeV',
    desc: 'Reach a beam energy of 100 GeV.',
    condition: (state) => state.beamEnergy >= 100,
    reward: { funding: 100000000, reputation: 30 },
    tier: 4,
  },
  {
    id: 'particleDiscoveryObj',
    name: 'Particle Discovery',
    desc: 'Observe a new particle.',
    condition: (state) => state.discoveries >= 1,
    reward: { funding: 200000000, reputation: 50 },
    tier: 4,
  },
  {
    id: 'positronBeam',
    name: 'Positron Beam',
    desc: 'Generate and accelerate positrons.',
    condition: (state) => state.beamline.some(n => n.type === 'positronTarget') && state.beamOn,
    reward: { funding: 50000000, reputation: 30 },
    tier: 4,
  },
  {
    id: 'tenPublications',
    name: '10 Publications',
    desc: 'Accumulate 10 research milestone completions.',
    condition: (state) => state.completedResearch.length >= 10,
    reward: { reputation: 20 },
    tier: 4,
  },
  {
    id: 'nationalLab',
    name: 'National Lab Status',
    desc: 'Reach 100 reputation.',
    condition: (state) => state.resources.reputation >= 100,
    reward: { funding: 500000000 },
    tier: 4,
  },
  {
    id: 'allResearch',
    name: 'Omniscient',
    desc: 'Complete all research projects.',
    condition: (state) => {
      const nonHidden = Object.values(RESEARCH).filter(r => !r.hidden);
      return state.completedResearch.length >= nonHidden.length;
    },
    reward: { funding: 10000000, reputation: 20 },
    tier: 4,
  },

  // === Tier 5 — Legacy ===
  {
    id: 'nobelPrize',
    name: 'Nobel Prize',
    desc: 'Discover a fundamental particle at frontier energy.',
    condition: (state) => state.discoveries >= 1 && state.beamEnergy >= 100,
    reward: { funding: 1000000000, reputation: 100 },
    tier: 5,
  },
  {
    id: 'userFacilityOfYear',
    name: 'User Facility of the Year',
    desc: 'Deliver 10,000 total beam hours.',
    condition: (state) => state.totalBeamHours >= 10000,
    reward: { funding: 200000000, reputation: 50 },
    tier: 5,
  },
  {
    id: 'fullCatalog',
    name: 'Full Catalog',
    desc: 'Build every component type at least once.',
    condition: (state) => {
      const builtTypes = new Set(state.beamline.map(n => n.type));
      const allTypes = Object.keys(COMPONENTS);
      return allTypes.every(t => builtTypes.has(t));
    },
    reward: { funding: 100000000, reputation: 30 },
    tier: 5,
  },
];
