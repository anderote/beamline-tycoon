// Placement modes — each mode has its own set of category tabs
export const MODES = {
  beamline: {
    name: 'Beamline',
    categories: {
      source:     { name: 'Sources',     color: '#4c4', subsections: { electron: { name: 'Electron' }, utility: { name: 'Utility' } } },
      focusing:   { name: 'Focusing',    color: '#48c', subsections: { normalConducting: { name: 'Normal' }, superconducting: { name: 'Superconducting' } } },
      rf:         { name: 'RF / Accel',  color: '#c44', subsections: { lowEnergy: { name: 'Low Energy' }, highEnergy: { name: 'High Energy' } } },
      diagnostic: { name: 'Diagnostics', color: '#eee', subsections: { monitors: { name: 'Beam Monitors' }, spectrometers: { name: 'Spectrometers' } } },
      beamOptics: { name: 'Beam Optics', color: '#4ac', subsections: { insertionDevices: { name: 'Insertion Devices' }, manipulation: { name: 'Manipulation' } } },
      endpoint:   { name: 'Endpoints',   color: '#999', subsections: { detectors: { name: 'Detectors' }, targets: { name: 'Targets' }, photon: { name: 'Photon' } } },
    },
  },
  facility: {
    name: 'Facility',
    categories: {
      vacuum:       { name: 'Vacuum',          color: '#999', subsections: { pumps: { name: 'Pumps' }, gauges: { name: 'Gauges' }, hardware: { name: 'Hardware' } } },
      rfPower:      { name: 'RF Power',        color: '#c44', subsections: { sources: { name: 'RF Sources' }, distribution: { name: 'Distribution' }, controls: { name: 'Controls' } } },
      cooling:      { name: 'Cooling',         color: '#48c', subsections: { plant: { name: 'Plant' }, distribution: { name: 'Distribution' }, cryogenics: { name: 'Cryogenics' } } },
      dataControls: { name: 'Data & Controls', color: '#eee', subsections: { controls: { name: 'Controls' }, safety: { name: 'Safety' } } },
      power:        { name: 'Power',           color: '#4c4', subsections: { electrical: { name: 'Electrical' }, specialty: { name: 'Specialty' } } },
      ops:          { name: 'Ops',             color: '#888', subsections: { radiationSafety: { name: 'Radiation Safety' }, materialHandling: { name: 'Material Handling' } } },
    },
  },
  structure: {
    name: 'Structure',
    categories: {
      flooring:    { name: 'Flooring',      color: '#999', subsections: { surfaces: { name: 'Surfaces' }, foundations: { name: 'Foundations' } } },
      rfLab:       { name: 'RF Lab',         color: '#a83', isZoneTab: true, zoneType: 'rfLab' },
      coolingLab:  { name: 'Cooling Lab',    color: '#3aa', isZoneTab: true, zoneType: 'coolingLab' },
      vacuumLab:   { name: 'Vacuum Lab',     color: '#74a', isZoneTab: true, zoneType: 'vacuumLab' },
      officeSpace: { name: 'Office',         color: '#46a', isZoneTab: true, zoneType: 'officeSpace' },
      controlRoom: { name: 'Control Room',   color: '#4a6', isZoneTab: true, zoneType: 'controlRoom' },
      machineShop: { name: 'Machine Shop',   color: '#865', isZoneTab: true, zoneType: 'machineShop' },
      opticsLab:   { name: 'Optics Lab',     color: '#4ac', isZoneTab: true, zoneType: 'opticsLab' },
      diagnosticsLab: { name: 'Diagnostics Lab', color: '#ac4', isZoneTab: true, zoneType: 'diagnosticsLab' },
      maintenance: { name: 'Maintenance',    color: '#a63', isZoneTab: true, zoneType: 'maintenance' },
      treesPlants: { name: 'Trees & Plants', color: '#4a4', isDecorationTab: true },
      furniture:   { name: 'Furniture',      color: '#864', isDecorationTab: true },
      lighting:    { name: 'Lighting',       color: '#aa8', isDecorationTab: true },
      fencing:     { name: 'Fencing',        color: '#686', isDecorationTab: true },
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

// Utility connection types drawn as thin lines between facility equipment and beamline
export const CONNECTION_TYPES = {
  vacuumPipe:   { name: 'Vacuum Pipe',   color: 0x555555, validTargets: 'any' },
  rfWaveguide:  { name: 'RF Waveguide',  color: 0xcc4444, validTargets: { categoryMatch: ['rf'] } },
  coolingWater: { name: 'Cooling Water',  color: 0x4488cc, validTargets: { categoryMatch: ['rf', 'focusing'], idMatch: ['target', 'fixedTargetAdv', 'positronTarget', 'beamStop', 'detector'] } },
  cryoTransfer: { name: 'Cryo Transfer', color: 0x44aacc, validTargets: { idMatch: ['cryomodule', 'tesla9Cell', 'srf650Cavity', 'scQuad', 'scDipole'] } },
  powerCable:   { name: 'Power Cable',   color: 0x44cc44, validTargets: 'any' },
  dataFiber:    { name: 'Data/Fiber',    color: 0xeeeeee, validTargets: { categoryMatch: ['diagnostic', 'endpoint'] } },
};
