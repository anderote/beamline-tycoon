// Machine tier for each beamline component — controls which components are visible
// for each machine type. Components without an entry default to tier 1.
// Tier 1: Electron Linac (basic optics, RF, beam to target)
// Tier 2: Photoinjector (photoguns, solenoid, diagnostics, space charge regime)
// Tier 3: FEL (bunch compression, undulators, photon science)
// Tier 4: Collider (positrons, detectors, beam-beam physics)
export const MACHINE_TIER = {
  // Tier 1 — available from start (default)
  // source, drift, driftVert, bellows, quadrupole, dipole, rfCavity, collimator,
  // target, beamDump, bpm, faradayCup, beamStop, corrector, aperture

  // Tier 2 — Photoinjector
  dcPhotoGun: 2, ncRfGun: 2, srfGun: 2,
  solenoid: 2,
  laserSystem: 2,

  // Tier 3 — FEL
  chicane: 3, harmonicLinearizer: 3, dogleg: 3, laserHeater: 3,
  undulator: 3, helicalUndulator: 3, wiggler: 3, apple2Undulator: 3,
  photonPort: 3,
  bunchLengthMonitor: 3, energySpectrometer: 3,
  cryomodule: 3, srf650Cavity: 3, cbandCavity: 3, xbandCavity: 3,
  sextupole: 3, octupole: 3,
  scQuad: 3, scDipole: 3,
  combinedFunctionMagnet: 3,

  // Tier 4 — Collider
  positronTarget: 4,
  detector: 4,
  kickerMagnet: 4, septumMagnet: 4,
  comptonIP: 4,
  fixedTargetAdv: 4,
  stripperFoil: 4,
};

// Machine type definitions for UI
export const MACHINE_TYPES = {
  linac:          { name: 'Electron Linac',  tier: 1, desc: 'Deliver beam to target' },
  photoinjector:  { name: 'Photoinjector',   tier: 2, desc: 'Maximize beam brightness' },
  fel:            { name: 'Free Electron Laser', tier: 3, desc: 'Achieve FEL saturation' },
  collider:       { name: 'e⁺e⁻ Collider',  tier: 4, desc: 'Accumulate discoveries' },
};

export const MACHINES = {
  // === Stall Machines (available at start) ===
  vanDeGraaff: {
    id: 'vanDeGraaff',
    name: 'Van de Graaff Generator',
    icon: '\u26A1',
    desc: 'A classic electrostatic accelerator. Cheap and reliable.',
    category: 'stall',
    cost: { funding: 200000 },
    w: 2, h: 2,
    baseFunding: 0.5,
    baseData: 0.2,
    energyCost: 2,
    requires: null,
    maxCount: null,
    canLink: false,
    operatingModes: null,
    modeMultipliers: null,
    upgrades: {
      voltage: {
        name: 'Terminal Voltage',
        levels: [
          { label: '1 MV', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: '3 MV', cost: { funding: 200000, data: 3 }, fundingMult: 1.5, dataMult: 1.4, energyMult: 1.2 },
          { label: '5 MV', cost: { funding: 600000, data: 8 }, fundingMult: 2.0, dataMult: 1.8, energyMult: 1.5 },
        ],
      },
      belt: {
        name: 'Belt Material',
        levels: [
          { label: 'Rubber belt', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Silk belt', cost: { funding: 150000, data: 2 }, fundingMult: 1.2, dataMult: 1.3, energyMult: 1.0 },
          { label: 'Pelletron chain', cost: { funding: 500000, data: 6 }, fundingMult: 1.5, dataMult: 1.6, energyMult: 1.1 },
        ],
      },
    },
  },

  cockcroftWalton: {
    id: 'cockcroftWalton',
    name: 'Cockcroft-Walton Generator',
    icon: '\u2301',
    desc: 'Voltage multiplier cascade. The machine that first split the atom.',
    category: 'stall',
    cost: { funding: 500000 },
    w: 3, h: 2,
    baseFunding: 1,
    baseData: 0.5,
    energyCost: 4,
    requires: null,
    maxCount: null,
    canLink: false,
    operatingModes: null,
    modeMultipliers: null,
    upgrades: {
      stages: {
        name: 'Stage Count',
        levels: [
          { label: '2-stage (200 kV)', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: '4-stage (500 kV)', cost: { funding: 400000, data: 5 }, fundingMult: 1.5, dataMult: 1.4, energyMult: 1.3 },
          { label: '8-stage (1 MV)', cost: { funding: 1200000, data: 12 }, fundingMult: 2.0, dataMult: 1.8, energyMult: 1.6 },
        ],
      },
      voltage: {
        name: 'Voltage Regulation',
        levels: [
          { label: 'Basic', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Stabilized', cost: { funding: 300000, data: 3 }, fundingMult: 1.3, dataMult: 1.5, energyMult: 1.0 },
          { label: 'Precision', cost: { funding: 800000, data: 8 }, fundingMult: 1.5, dataMult: 2.0, energyMult: 1.1 },
        ],
      },
    },
  },

  tabletopLaser: {
    id: 'tabletopLaser',
    name: 'Tabletop Laser Plasma',
    icon: '\u2604',
    desc: 'Cutting-edge laser-driven plasma wakefield accelerator. Compact but powerful.',
    category: 'stall',
    cost: { funding: 15000000 },
    w: 3, h: 3,
    baseFunding: 5,
    baseData: 8,
    energyCost: 15,
    requires: 'plasmaAcceleration',
    maxCount: null,
    canLink: false,
    operatingModes: null,
    modeMultipliers: null,
    upgrades: {
      laserPower: {
        name: 'Laser Power',
        levels: [
          { label: '10 TW', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: '100 TW', cost: { funding: 8000000, data: 30 }, fundingMult: 1.5, dataMult: 1.8, energyMult: 1.4 },
          { label: '1 PW', cost: { funding: 25000000, data: 80 }, fundingMult: 2.5, dataMult: 3.0, energyMult: 2.0 },
        ],
      },
      plasmaDensity: {
        name: 'Plasma Density',
        levels: [
          { label: 'Low density', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Medium density', cost: { funding: 5000000, data: 20 }, fundingMult: 1.3, dataMult: 1.5, energyMult: 1.2 },
          { label: 'High density', cost: { funding: 12000000, data: 50 }, fundingMult: 1.6, dataMult: 2.0, energyMult: 1.5 },
        ],
      },
      staging: {
        name: 'Staging',
        levels: [
          { label: 'Single stage', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Double stage', cost: { funding: 10000000, data: 40 }, fundingMult: 1.5, dataMult: 1.5, energyMult: 1.3 },
          { label: 'Triple stage', cost: { funding: 30000000, data: 100 }, fundingMult: 2.0, dataMult: 2.0, energyMult: 1.6 },
        ],
      },
    },
  },

  // === Ring Machines ===
  smallCyclotron: {
    id: 'smallCyclotron',
    name: 'Small Cyclotron',
    icon: '\uD83C\uDF00',
    desc: 'Compact cyclotron for isotope production and basic nuclear research.',
    category: 'ring',
    cost: { funding: 2000000 },
    w: 5, h: 5,
    baseFunding: 3,
    baseData: 0.5,
    energyCost: 10,
    requires: 'cyclotronTech',
    maxCount: null,
    canLink: false,
    operatingModes: ['isotopes', 'research'],
    modeMultipliers: {
      isotopes: { fundingMult: 1.5, dataMult: 0.5 },
      research: { fundingMult: 0.3, dataMult: 2.0 },
    },
    upgrades: {
      magneticField: {
        name: 'Magnetic Field',
        levels: [
          { label: '1.2 T / 12 MeV', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: '1.5 T / 18 MeV', cost: { funding: 1500000, data: 10 }, fundingMult: 1.4, dataMult: 1.3, energyMult: 1.3 },
          { label: '1.8 T / 25 MeV', cost: { funding: 4000000, data: 30 }, fundingMult: 1.8, dataMult: 1.6, energyMult: 1.6 },
        ],
      },
      rfSystem: {
        name: 'RF System',
        levels: [
          { label: 'Single dee', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Dual dee, 2x current', cost: { funding: 1000000, data: 8 }, fundingMult: 1.5, dataMult: 1.3, energyMult: 1.2 },
          { label: 'High-Q resonator', cost: { funding: 3000000, data: 20 }, fundingMult: 2.0, dataMult: 1.5, energyMult: 1.4 },
        ],
      },
      extraction: {
        name: 'Extraction',
        levels: [
          { label: '40% efficiency', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: '60% efficiency', cost: { funding: 800000, data: 5 }, fundingMult: 1.5, dataMult: 1.2, energyMult: 1.0 },
          { label: '85% efficiency', cost: { funding: 2500000, data: 15 }, fundingMult: 2.0, dataMult: 1.4, energyMult: 1.0 },
        ],
      },
      shielding: {
        name: 'Shielding',
        levels: [
          { label: 'Basic', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Improved', cost: { funding: 600000, data: 5 }, fundingMult: 1.0, dataMult: 1.5, energyMult: 1.0 },
          { label: 'Full containment', cost: { funding: 2000000, data: 12 }, fundingMult: 1.0, dataMult: 2.0, energyMult: 1.0 },
        ],
      },
    },
  },

  largeCyclotron: {
    id: 'largeCyclotron',
    name: 'Large Cyclotron',
    icon: '\uD83C\uDF00',
    desc: 'Isochronous sector-focused cyclotron. Higher energy, multiple uses.',
    category: 'ring',
    cost: { funding: 8000000 },
    w: 7, h: 7,
    baseFunding: 8,
    baseData: 2,
    energyCost: 25,
    requires: 'isochronousCyclotron',
    maxCount: null,
    canLink: false,
    operatingModes: ['isotopes', 'research', 'therapy'],
    modeMultipliers: {
      isotopes: { fundingMult: 1.5, dataMult: 0.5 },
      research: { fundingMult: 0.3, dataMult: 2.0 },
      therapy: { fundingMult: 1.0, dataMult: 1.0 },
    },
    upgrades: {
      sectorMagnets: {
        name: 'Sector Magnets',
        levels: [
          { label: 'Standard iron', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Shimmed poles', cost: { funding: 3000000, data: 15 }, fundingMult: 1.3, dataMult: 1.4, energyMult: 1.2 },
          { label: 'Superconducting coils', cost: { funding: 10000000, data: 40 }, fundingMult: 1.8, dataMult: 1.8, energyMult: 1.5 },
        ],
      },
      rfSystem: {
        name: 'RF System',
        levels: [
          { label: 'Single cavity', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Dual cavity', cost: { funding: 2000000, data: 12 }, fundingMult: 1.4, dataMult: 1.3, energyMult: 1.2 },
          { label: 'Flat-topping', cost: { funding: 6000000, data: 30 }, fundingMult: 1.8, dataMult: 1.6, energyMult: 1.4 },
        ],
      },
      ionSourceInternal: {
        name: 'Internal Ion Source',
        levels: [
          { label: 'Basic PIG source', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'ECR source', cost: { funding: 2500000, data: 15 }, fundingMult: 1.5, dataMult: 1.3, energyMult: 1.1 },
          { label: 'Multicusp source', cost: { funding: 5000000, data: 25 }, fundingMult: 2.0, dataMult: 1.5, energyMult: 1.2 },
        ],
      },
      extractionPorts: {
        name: 'Extraction Ports',
        levels: [
          { label: '1 port', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: '2 ports', cost: { funding: 2000000, data: 10 }, fundingMult: 1.8, dataMult: 1.3, energyMult: 1.1 },
          { label: '3 ports', cost: { funding: 5000000, data: 25 }, fundingMult: 2.5, dataMult: 1.5, energyMult: 1.2 },
        ],
      },
    },
  },

  synchrotronBooster: {
    id: 'synchrotronBooster',
    name: 'Synchrotron Booster',
    icon: '\u25CE',
    desc: 'A ramped synchrotron that boosts beam to high energy. Link to a linac for best performance.',
    category: 'ring',
    cost: { funding: 12000000 },
    w: 6, h: 6,
    baseFunding: 15,
    baseData: 5,
    energyCost: 35,
    requires: 'synchrotronTech',
    maxCount: null,
    canLink: true,
    operatingModes: ['production', 'machineStudies'],
    modeMultipliers: {
      production: { fundingMult: 1.0, dataMult: 1.0 },
      machineStudies: { fundingMult: 0.0, dataMult: 3.0 },
    },
    upgrades: {
      dipoleField: {
        name: 'Dipole Field',
        levels: [
          { label: '0.8 T / 1 GeV', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: '1.2 T / 3 GeV', cost: { funding: 5000000, data: 20 }, fundingMult: 1.5, dataMult: 1.4, energyMult: 1.3 },
          { label: '1.8 T / 6 GeV', cost: { funding: 15000000, data: 50 }, fundingMult: 2.0, dataMult: 1.8, energyMult: 1.6 },
        ],
      },
      rfVoltage: {
        name: 'RF Voltage',
        levels: [
          { label: 'Low voltage', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Medium voltage', cost: { funding: 3000000, data: 15 }, fundingMult: 1.3, dataMult: 1.3, energyMult: 1.2 },
          { label: 'High voltage', cost: { funding: 8000000, data: 35 }, fundingMult: 1.6, dataMult: 1.6, energyMult: 1.4 },
        ],
      },
      injection: {
        name: 'Injection System',
        levels: [
          { label: 'Single-turn', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Multi-turn', cost: { funding: 4000000, data: 18 }, fundingMult: 1.4, dataMult: 1.2, energyMult: 1.0 },
          { label: 'Charge-exchange', cost: { funding: 10000000, data: 40 }, fundingMult: 1.8, dataMult: 1.5, energyMult: 1.0 },
        ],
      },
      extractionKickers: {
        name: 'Extraction Kickers',
        levels: [
          { label: 'Slow extraction', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Fast extraction', cost: { funding: 3000000, data: 15 }, fundingMult: 1.3, dataMult: 1.4, energyMult: 1.1 },
          { label: 'Resonant extraction', cost: { funding: 8000000, data: 35 }, fundingMult: 1.6, dataMult: 1.8, energyMult: 1.2 },
        ],
      },
    },
  },

  storageRing: {
    id: 'storageRing',
    name: 'Storage Ring / Light Source',
    icon: '\u2B55',
    desc: 'A full storage ring with insertion devices. The ultimate user facility. Link to an injector for best performance.',
    category: 'ring',
    cost: { funding: 30000000 },
    w: 10, h: 10,
    baseFunding: 25,
    baseData: 10,
    energyCost: 50,
    requires: 'storageRingTech',
    maxCount: null,
    canLink: true,
    reputationPerTick: 0.01,
    operatingModes: ['userOps', 'machineStudies'],
    modeMultipliers: {
      userOps: { fundingMult: 2.0, dataMult: 0.5 },
      machineStudies: { fundingMult: 0.0, dataMult: 3.0 },
    },
    upgrades: {
      lattice: {
        name: 'Lattice',
        levels: [
          { label: 'DBA lattice', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'TBA lattice', cost: { funding: 10000000, data: 30 }, fundingMult: 1.3, dataMult: 1.5, energyMult: 1.1 },
          { label: 'MBA lattice (4th gen)', cost: { funding: 30000000, data: 80 }, fundingMult: 1.8, dataMult: 2.0, energyMult: 1.3 },
        ],
      },
      insertionDevices: {
        name: 'Insertion Devices',
        levels: [
          { label: '2 beamline ports', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: '6 beamline ports', cost: { funding: 15000000, data: 40 }, fundingMult: 2.5, dataMult: 1.5, energyMult: 1.2 },
          { label: '12 beamline ports', cost: { funding: 40000000, data: 100 }, fundingMult: 5.0, dataMult: 2.0, energyMult: 1.5 },
        ],
      },
      vacuumSystem: {
        name: 'Vacuum System',
        levels: [
          { label: 'Standard UHV', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'NEG-coated', cost: { funding: 8000000, data: 25 }, fundingMult: 1.2, dataMult: 1.4, energyMult: 0.9 },
          { label: 'In-vacuum undulators', cost: { funding: 20000000, data: 60 }, fundingMult: 1.5, dataMult: 1.8, energyMult: 1.0 },
        ],
      },
      topUpInjection: {
        name: 'Top-up Injection',
        levels: [
          { label: 'Decay mode', fundingMult: 1.0, dataMult: 1.0, energyMult: 1.0 },
          { label: 'Periodic top-up', cost: { funding: 12000000, data: 35 }, fundingMult: 1.5, dataMult: 1.3, energyMult: 1.1 },
          { label: 'Continuous top-up', cost: { funding: 25000000, data: 70 }, fundingMult: 2.0, dataMult: 1.5, energyMult: 1.2 },
        ],
      },
    },
  },
};
