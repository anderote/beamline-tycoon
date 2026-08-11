import { COMPONENTS } from './components.js';
import { RESEARCH } from './research.js';

// True if any network of the given utility type has real capacity flowing
// (state.utilityNetworkData: Map<utilityType, Map<networkId, flow>>).
function hasUtilityCapacity(state, utilityType) {
  const perType = state?.utilityNetworkData?.get?.(utilityType);
  if (!perType) return false;
  for (const flow of perType.values()) {
    if (flow && (flow.totalCapacity || 0) > 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Phase 12 — milestone rewards are TIER KEYS, not a bonus on top of passive
// accumulation. Each tier's total funding reward is sized against the
// expansion the player wants next, so completing a tier is what buys the
// capacity that makes the following tier affordable:
//
//   tier 0  $1.35M + $2.5M seed ≈ the first extra beamline ($3.83M all in:
//                   $3.25M of catalogue, $120k of drift pipe and $458k of
//                   wiring), i.e. tier 0 IS the second beamline
//   tier 1  $2.35M  the third beamline, or the first two research nodes
//   tier 2  $6.2M   two more lines
//   tier 3  $14M    the mid-game build-out
//   tier 4  $35M    frontier hardware (a detector alone is $50M)
//   tier 5  $45M    the legacy payout
//
// Old totals were $80k / $270k / $1.18M / $2.15M / $5.4M / $5.5M — a rounding
// error against a $3.83M beamline, which is why milestones read as flavour.
// Reputation rewards moved with them (6/17/52/105/290/360, was 3/11/38/65/150/180)
// because reputation is now a real research gate — see RESEARCH cost.reputation.
// ---------------------------------------------------------------------------
export const OBJECTIVES = [
  // === Tier 0 — Getting Started ===
  {
    id: 'firstBeam',
    name: 'First Beam!',
    desc: 'Build a source and turn on the beam.',
    condition: (state) => state.beamOn && state.beamline.some(n => COMPONENTS[n.type]?.isSource),
    reward: { funding: 550000, reputation: 2 },
    tier: 0,
  },
  {
    id: 'firstMeasurement',
    name: 'First Measurement',
    desc: 'Place a BPM and measure beam position.',
    condition: (state) => state.beamOn && state.beamline.some(n => n.type === 'bpm'),
    reward: { funding: 350000, reputation: 2 },
    tier: 0,
  },
  {
    id: 'stableBeam',
    name: 'Stable Beam',
    desc: 'Run beam for 60 continuous seconds.',
    condition: (state) => state.continuousBeamTicks >= 60,
    reward: { funding: 450000, reputation: 2 },
    tier: 0,
  },

  // === Tier 1 — Basic Competence ===
  {
    id: 'reach100mev',
    name: '100 MeV',
    desc: 'Reach a beam energy of 100 MeV.',
    condition: (state) => state.beamEnergy >= 0.1,
    reward: { funding: 500000, reputation: 3 },
    tier: 1,
  },
  {
    id: 'beamCharacterization',
    name: 'Beam Characterization',
    desc: 'Measure emittance, energy, and current simultaneously.',
    condition: (state) => {
      const types = state.beamline.map(n => n.type);
      // MVP-achievable: wireScanner + bpm + ict (energySpectrometer is deferred)
      return types.includes('wireScanner') && types.includes('bpm') && types.includes('ict');
    },
    reward: { funding: 300000, reputation: 3 },
    tier: 1,
  },
  {
    id: 'firstUser',
    name: 'First User',
    desc: 'Run beam for 60 seconds and deliver data to a detector.',
    // totalBeamHours only accrued via the removed photonPort system;
    // beamOnTicks (1 tick = 1 s of beam) is the live equivalent.
    condition: (state) => (state.beamOnTicks || 0) >= 60 && state.beamline.some(n => n.type === 'detector' || n.type === 'faradayCup'),
    reward: { funding: 600000, reputation: 4 },
    tier: 1,
  },
  {
    id: 'goodVacuum',
    name: 'Good Vacuum',
    desc: 'Achieve average pressure below 1e-8 mbar.',
    condition: (state) => state.avgPressure !== undefined && state.avgPressure < 1e-8,
    reward: { funding: 300000, reputation: 2 },
    tier: 1,
  },
  {
    id: 'firstResearch',
    name: 'Knowledge Seeker',
    desc: 'Complete your first research project.',
    condition: (state) => state.completedResearch.length >= 1,
    reward: { funding: 400000, reputation: 3 },
    tier: 1,
  },
  {
    id: 'firstData',
    name: 'First Light',
    desc: 'Collect 10 units of research data.',
    condition: (state) => state.totalDataCollected >= 10,
    reward: { funding: 250000, reputation: 2 },
    tier: 1,
  },

  // === Tier 2 — Real Facility ===
  {
    id: 'reach1gev',
    name: 'GeV Club',
    desc: 'Reach a beam energy of 1 GeV.',
    condition: (state) => state.beamEnergy >= 1,
    reward: { funding: 1200000, reputation: 8 },
    tier: 2,
  },
  {
    id: 'cwOperation',
    name: 'CW Operation',
    desc: 'Run CW beam for 300 continuous seconds.',
    condition: (state) => state.continuousBeamTicks >= 300,
    reward: { funding: 800000, reputation: 5 },
    tier: 2,
  },
  {
    id: 'subMicronEmittance',
    name: 'Sub-micron Emittance',
    desc: 'Achieve normalized emittance below 1 \u03bcm at >100 MeV.',
    condition: (state) => state.beamEnergy >= 0.1 && state.finalNormEmittanceX !== undefined && state.finalNormEmittanceX < 1e-6,
    reward: { funding: 800000, reputation: 8 },
    tier: 2,
  },
  {
    id: 'fullUtilities',
    name: 'Full Utilities',
    desc: 'Run functional power, vacuum, RF, cooling, and data networks simultaneously.',
    condition: (state) =>
      ['powerCable', 'vacuumPipe', 'rfWaveguide', 'coolingWater', 'dataFiber']
        .every(u => hasUtilityCapacity(state, u)),
    reward: { funding: 1200000, reputation: 12 },
    tier: 2,
  },
  {
    id: 'firstTarget',
    name: 'First Target',
    desc: 'Run beam on a fixed target.',
    condition: (state) => state.beamOn && state.beamline.some(n => COMPONENTS[n.type]?.isEndpoint),
    reward: { funding: 700000, reputation: 6 },
    tier: 2,
  },
  {
    id: 'tenComponents',
    name: 'Growing Machine',
    desc: 'Install 10 components on your beamline.',
    condition: (state) => state.beamline.length >= 10,
    reward: { funding: 400000, reputation: 3 },
    tier: 2,
  },
  {
    id: 'collect100data',
    name: 'Data Hoarder',
    desc: 'Collect 100 units of research data.',
    condition: (state) => state.totalDataCollected >= 100,
    reward: { funding: 500000, reputation: 4 },
    tier: 2,
  },
  {
    id: 'threeResearch',
    name: 'Research Program',
    desc: 'Complete 3 research projects.',
    condition: (state) => state.completedResearch.length >= 3,
    reward: { funding: 600000, reputation: 6 },
    tier: 2,
  },

  // === Tier 3 — World Class ===
  {
    id: 'reach10gev',
    name: '10 GeV',
    desc: 'Reach a beam energy of 10 GeV.',
    condition: (state) => state.beamEnergy >= 10,
    reward: { funding: 2500000, reputation: 18 },
    tier: 3,
  },
  {
    id: 'srfLinac',
    name: 'SRF Linac',
    desc: 'Operate 10 or more SRF cavities simultaneously (a cryomodule counts as 8).',
    condition: (state) => {
      let cavities = 0;
      for (const n of state.beamline) {
        if (n.type === 'halfWaveResonator' || n.type === 'spokeCavity'
            || n.type === 'ellipticalSrfCavity') cavities += 1;
        else if (n.type === 'cryomodule') cavities += 8;
      }
      return cavities >= 10;
    },
    reward: { funding: 2000000, reputation: 12 },
    tier: 3,
  },
  {
    id: 'bunchCompressed',
    name: 'Bunch Compression',
    desc: 'Achieve bunch length below 100 fs.',
    condition: (state) => state.finalBunchLength !== undefined && state.finalBunchLength < 100e-15,
    reward: { funding: 1500000, reputation: 15 },
    tier: 3,
  },
  {
    id: 'felSaturation',
    name: 'FEL Saturation',
    desc: 'Achieve free-electron laser saturation.',
    condition: (state) => state.felSaturated === true,
    reward: { funding: 3000000, reputation: 30 },
    tier: 3,
  },
  {
    id: 'highAvailability',
    name: 'High Availability',
    desc: 'Maintain 95% uptime over 1000 ticks.',
    condition: (state) => state.tick >= 1000 && state.uptimeFraction >= 0.95,
    reward: { funding: 2000000, reputation: 15 },
    tier: 3,
  },
  {
    id: 'collect1000data',
    name: 'Big Data',
    desc: 'Collect 1,000 units of research data.',
    condition: (state) => state.totalDataCollected >= 1000,
    reward: { funding: 1500000, reputation: 15 },
    tier: 3,
  },
  {
    id: 'userFacility',
    name: 'User Facility',
    desc: 'Reach 250 reputation.',
    // 10 was set when reputation topped out in the low hundreds; a facility now
    // ends a full playthrough past 3,000, so 10 fired on tick 2 and this read as
    // a free grant. 250 lands it around the point the second beamline is running.
    condition: (state) => state.resources.reputation >= 250,
    reward: { funding: 1500000 },
    tier: 3,
  },

  // === Tier 4 — Frontier ===
  {
    id: 'reach100gev',
    name: '100 GeV',
    desc: 'Reach a beam energy of 100 GeV.',
    condition: (state) => state.beamEnergy >= 100,
    reward: { funding: 8000000, reputation: 60 },
    tier: 4,
  },
  {
    id: 'particleDiscoveryObj',
    name: 'Particle Discovery',
    desc: 'Observe a new particle.',
    condition: (state) => state.discoveries >= 1,
    reward: { funding: 10000000, reputation: 90 },
    tier: 4,
  },
  {
    id: 'colliderMode',
    name: 'Collision Course',
    desc: 'Run beam into a Collision Point.',
    condition: (state) => state.beamOn && state.beamline.some(n => n.type === 'collisionPoint'),
    reward: { funding: 6000000, reputation: 60 },
    tier: 4,
  },
  {
    id: 'tenPublications',
    name: '10 Publications',
    desc: 'Accumulate 10 research milestone completions.',
    condition: (state) => state.completedResearch.length >= 10,
    reward: { funding: 2000000, reputation: 40 },
    tier: 4,
  },
  {
    id: 'nationalLab',
    name: 'National Lab Status',
    desc: 'Reach 1,000 reputation.',
    // Same rescale as userFacility — 100 fired barely a tenth of the way in.
    condition: (state) => state.resources.reputation >= 1000,
    reward: { funding: 6000000 },
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
    reward: { funding: 3000000, reputation: 40 },
    tier: 4,
  },

  // === Tier 5 — Legacy ===
  {
    id: 'nobelPrize',
    name: 'Nobel Prize',
    desc: 'Discover a fundamental particle at frontier energy.',
    condition: (state) => state.discoveries >= 1 && state.beamEnergy >= 100,
    reward: { funding: 20000000, reputation: 200 },
    tier: 5,
  },
  {
    id: 'userFacilityOfYear',
    name: 'User Facility of the Year',
    desc: 'Deliver 10,000 units of research data to users.',
    condition: (state) => (state.totalDataCollected || 0) >= 10000,
    reward: { funding: 12000000, reputation: 100 },
    tier: 5,
  },
  {
    id: 'fullCatalog',
    name: 'Full Catalog',
    desc: 'Build every beamline component type at least once.',
    condition: (state) => {
      const builtTypes = new Set(state.beamline.map(n => n.type));
      // Only beamline components (junctions + pipe placements) can ever
      // appear on a beamline — infra/bench gear is excluded by role.
      const allTypes = Object.keys(COMPONENTS).filter(t => {
        const role = COMPONENTS[t]?.role;
        return role === 'junction' || role === 'placement';
      });
      return allTypes.every(t => builtTypes.has(t));
    },
    reward: { funding: 13000000, reputation: 60 },
    tier: 5,
  },
];
