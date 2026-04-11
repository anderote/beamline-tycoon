// Placement modes — each mode has its own set of category tabs
export const MODES = {
  beamline: {
    name: 'Beamline',
    categories: {
      source:     { name: 'Sources',     color: '#4c4', subsections: { electron: { name: 'Electron' }, utility: { name: 'Utility' } } },
      focusing:   { name: 'Focusing',    color: '#48c', subsections: { normalConducting: { name: 'Normal' }, superconducting: { name: 'Superconducting' } } },
      rf:         { name: 'RF / Accel',  color: '#c44', subsections: { normalConducting: { name: 'Normal Conducting' }, superconducting: { name: 'Superconducting' } } },
      diagnostic: { name: 'Diagnostics', color: '#eee', subsections: { monitors: { name: 'Beam Monitors' }, spectrometers: { name: 'Spectrometers' } } },
      beamOptics: { name: 'Beam Optics', color: '#4ac', subsections: { insertionDevices: { name: 'Insertion Devices' }, manipulation: { name: 'Manipulation' } } },
      endpoint:   { name: 'Endpoints',   color: '#999', subsections: { detectors: { name: 'Detectors' }, targets: { name: 'Targets' }, photon: { name: 'Photon' } } },
    },
  },
  infra: {
    name: 'Infra',
    categories: {
      power:        { name: 'Power',           color: '#4c4', subsections: { distribution: { name: 'Distribution' }, electrical: { name: 'Electrical' }, specialty: { name: 'Specialty' } } },
      vacuum:       { name: 'Vacuum',          color: '#999', subsections: { distribution: { name: 'Distribution' }, pumps: { name: 'Pumps' }, gauges: { name: 'Gauges' }, hardware: { name: 'Hardware' } } },
      rfPower:      { name: 'RF Power',        color: '#c44', subsections: { distribution: { name: 'Distribution' }, sources: { name: 'RF Sources' }, controls: { name: 'Controls' } } },
      cooling:      { name: 'Cooling',         color: '#48c', subsections: { distribution: { name: 'Distribution' }, plant: { name: 'Plant' }, cryogenics: { name: 'Cryogenics' } } },
      dataControls: { name: 'Data & Controls', color: '#eee', subsections: { distribution: { name: 'Distribution' }, controls: { name: 'Controls' }, safety: { name: 'Safety' } } },
      ops:          { name: 'Ops',             color: '#888', subsections: { radiationSafety: { name: 'Radiation Safety' }, materialHandling: { name: 'Material Handling' } } },
    },
  },
  facility: {
    name: 'Facility',
    categories: {
      // --- Labs ---
      rfLab:       { name: 'RF Lab',         color: '#a83', isZoneTab: true, zoneType: 'rfLab',        group: 'labs' },
      coolingLab:  { name: 'Cooling Lab',    color: '#3aa', isZoneTab: true, zoneType: 'coolingLab',   group: 'labs' },
      vacuumLab:   { name: 'Vacuum Lab',     color: '#74a', isZoneTab: true, zoneType: 'vacuumLab',    group: 'labs' },
      opticsLab:   { name: 'Optics Lab',     color: '#4ac', isZoneTab: true, zoneType: 'opticsLab',    group: 'labs' },
      diagnosticsLab: { name: 'Diagnostics Lab', color: '#ac4', isZoneTab: true, zoneType: 'diagnosticsLab', group: 'labs' },
      machineShop: { name: 'Machine Shop',   color: '#865', isZoneTab: true, zoneType: 'machineShop',  group: 'labs' },
      maintenance: { name: 'Maintenance',    color: '#a63', isZoneTab: true, zoneType: 'maintenance',  group: 'labs' },
      // --- Rooms ---
      controlRoom: { name: 'Control Room',   color: '#4a6', isZoneTab: true, zoneType: 'controlRoom',  group: 'rooms' },
      officeSpace: { name: 'Office',         color: '#46a', isZoneTab: true, zoneType: 'officeSpace',  group: 'rooms' },
      meetingRoom: { name: 'Meeting',        color: '#649', isZoneTab: true, zoneType: 'meetingRoom',  group: 'rooms' },
      cafeteria:   { name: 'Cafeteria',      color: '#a64', isZoneTab: true, zoneType: 'cafeteria',    group: 'rooms' },
    },
  },
  structure: {
    name: 'Structure',
    categories: {
      flooring:    { name: 'Flooring',      color: '#999', subsections: { foundations: { name: 'Foundations' }, surfaces: { name: 'Surfaces' } } },
      walls:       { name: 'Walls',         color: '#887', subsections: { exterior: { name: 'Exterior' }, interior: { name: 'Interior' }, shielding: { name: 'Shielding' } } },
      doors:       { name: 'Doors',         color: '#689', subsections: { exterior: { name: 'Exterior' }, interior: { name: 'Interior' }, gates: { name: 'Fence Gates' } } },
    },
  },
  grounds: {
    name: 'Grounds',
    categories: {
      surfaces:    { name: 'Surfaces',       color: '#997', isSurfaceTab: true },
      treesPlants: { name: 'Trees & Plants', color: '#4a4', isDecorationTab: true },
      hedges:      { name: 'Hedges',         color: '#5a5', isWallTab: true, wallSubsection: 'hedges' },
      fencing:     { name: 'Fencing',        color: '#686', isWallTab: true, wallSubsection: 'fencing' },
      furniture:   { name: 'Furniture',      color: '#864', isDecorationTab: true },
      lighting:    { name: 'Lighting',       color: '#aa8', isDecorationTab: true },
      bins:        { name: 'Bins & Signs',   color: '#888', isDecorationTab: true },
    },
  },
  demolish: {
    name: 'Demolish',
    categories: {
      demolish: { name: 'Demolish', color: '#a44' },
    },
  },
};

// Flat lookup for backwards compat — used by palette rendering, etc.
export const CATEGORIES = {};
for (const mode of Object.values(MODES)) {
  Object.assign(CATEGORIES, mode.categories);
}

// Map each infra category to its relevant connection/pipe types
export const INFRA_DISTRIBUTION = {
  vacuum:       ['vacuumPipe'],
  rfPower:      ['rfWaveguide'],
  cooling:      ['coolingWater', 'cryoTransfer'],
  dataControls: ['dataFiber'],
  power:        ['powerCable'],
};

// Utility connection types drawn as thin lines between facility equipment and beamline
export const CONNECTION_TYPES = {
  vacuumPipe:   { name: 'Vacuum Pipe',   color: 0x555555, validTargets: 'any' },
  rfWaveguide:  { name: 'RF Waveguide',  color: 0xcc4444, validTargets: { categoryMatch: ['rf'] } },
  coolingWater: { name: 'Cooling Water',  color: 0x4488cc, validTargets: { categoryMatch: ['rf', 'focusing'], idMatch: ['target', 'fixedTargetAdv', 'positronTarget', 'beamStop', 'detector'] } },
  cryoTransfer: { name: 'Cryo Transfer', color: 0x44aacc, validTargets: { idMatch: ['cryomodule', 'tesla9Cell', 'srf650Cavity', 'halfWaveResonator', 'spokeCavity', 'harmonicLinearizer', 'scQuad', 'scDipole'] } },
  powerCable:   { name: 'Power Cable',   color: 0x44cc44, validTargets: 'any' },
  dataFiber:    { name: 'Data/Fiber',    color: 0xeeeeee, validTargets: { categoryMatch: ['diagnostic', 'endpoint'] } },
};
