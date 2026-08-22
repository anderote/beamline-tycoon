// Placement modes — each mode has its own set of category tabs
export const ROOM_FURNITURE_GROUPS = {
  seating: { name: 'Seating' },
  tables: { name: 'Tables & Counters' },
  storage: { name: 'Storage & Shelves' },
  hospitality: { name: 'Coffee & Snacks' },
  presentation: { name: 'Presentation & Communication' },
  decor: { name: 'Decor & Accessories' },
  support: { name: 'Support & Operations' },
  other: { name: 'Other Furniture' },
};

export const MODES = {
  beamline: {
    name: 'Beamline',
    categories: {
      source:     { name: 'Sources',     color: '#4c4', subsections: { transport: { name: 'Transport' }, electron: { name: 'Electron' }, proton: { name: 'Proton' } } },
      rf:         { name: 'RF / Accel',  color: '#c44', subsections: { normalConducting: { name: 'Normal Conducting' }, superconducting: { name: 'Superconducting' } } },
      optics:     { name: 'Optics',      color: '#48c', subsections: { focusing: { name: 'Focusing' }, manipulation: { name: 'Manipulation' }, insertionDevices: { name: 'Insertion Devices' } } },
      diagnostic: { name: 'Diagnostics', color: '#eee', subsections: { monitors: { name: 'Beam Monitors' }, spectrometers: { name: 'Spectrometers' } } },
      endpoint:   { name: 'Endpoints',   color: '#999', subsections: { detectors: { name: 'Detectors' }, targets: { name: 'Targets' }, photon: { name: 'Photon' } } },
    },
  },
  infra: {
    name: 'Infra',
    categories: {
      // Each infra category leads with a `transport` subsection containing
      // the utility-line tools for that category's utility type(s). Physical
      // equipment (supply, distribution, etc.) follows.
      // Put the everyday branch cable first; the upstream HV feeder remains
      // beside it but is the less frequently selected transport tool.
      power:        { name: 'Power',           color: '#4c4',
                      utilityLineTools: ['powerCable', 'hvCable'],
                      subsections: { transport: { name: 'Transport' }, hvSupply: { name: 'HV Supply' }, distribution: { name: 'Distribution' }, fieldDistribution: { name: 'Field Distribution' }, specialty: { name: 'Specialty' } } },
      rfPower:      { name: 'RF Power',        color: '#c44',
                      utilityLineTools: ['rfWaveguide', 'hvCable'],
                      subsections: { transport: { name: 'Transport' }, supply: { name: 'RF Sources' }, distribution: { name: 'Distribution' }, controls: { name: 'Controls' } } },
      vacuum:       { name: 'Vacuum',          color: '#999',
                      utilityLineTools: ['vacuumPipe'],
                      subsections: { transport: { name: 'Transport' }, supply: { name: 'Pumps & Supply' }, distribution: { name: 'Distribution' }, instruments: { name: 'Instruments' }, hardware: { name: 'Hardware' } } },
      experimentalSystems: { name: 'Experimental Systems', color: '#b56',
                      subsections: { lasers: { name: 'Laser Systems' } } },
      cooling:      { name: 'Cooling',         color: '#48c',
                      utilityLineTools: ['coolingWater', 'cryoTransfer'],
                      subsections: {
                        transport: { name: 'Pipes' },
                        waterSupply: { name: 'Water Supply' },
                        integratedCooling: { name: 'Self-Contained Cooling' },
                        processCooling: { name: 'Central Chillers' },
                        heatRejection: { name: 'Heat Rejection' },
                        waterTreatment: { name: 'Water & Treatment' },
                        distribution: { name: 'Distribution' },
                        support: { name: 'Support Equipment' },
                        cryogenics: { name: 'Cryogenics' },
                      } },
      dataControls: { name: 'Data & Controls', color: '#eee',
                      utilityLineTools: ['dataFiber'],
                      subsections: { transport: { name: 'Transport' }, distribution: { name: 'Distribution' }, controls: { name: 'Controls' }, safety: { name: 'Safety' } } },
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
      controlRoom: { name: 'Control Room',   color: '#4a6', isZoneTab: true, zoneType: 'controlRoom',  group: 'rooms', utilityLineTools: ['dataFiber', 'powerCable'], furnitureGroups: ROOM_FURNITURE_GROUPS },
      officeSpace: { name: 'Office',         color: '#46a', isZoneTab: true, zoneType: 'officeSpace',  group: 'rooms', furnitureGroups: ROOM_FURNITURE_GROUPS },
      privateOffice: { name: 'Private Office', color: '#658', isZoneTab: true, zoneType: 'privateOffice', group: 'rooms', furnitureGroups: ROOM_FURNITURE_GROUPS },
      reception:   { name: 'Reception',      color: '#b85', isZoneTab: true, zoneType: 'reception',    group: 'rooms', furnitureGroups: ROOM_FURNITURE_GROUPS },
      meetingRoom: { name: 'Meeting',        color: '#649', isZoneTab: true, zoneType: 'meetingRoom',  group: 'rooms', furnitureGroups: ROOM_FURNITURE_GROUPS },
      facultyLounge: { name: 'Faculty Lounge', color: '#865', isZoneTab: true, zoneType: 'facultyLounge', group: 'rooms', furnitureGroups: ROOM_FURNITURE_GROUPS },
      cafeteria:   { name: 'Cafeteria',      color: '#a64', isZoneTab: true, zoneType: 'cafeteria',    group: 'rooms', furnitureGroups: ROOM_FURNITURE_GROUPS },
      kitchen:     { name: 'Kitchen',        color: '#c73', isZoneTab: true, zoneType: 'kitchen',      group: 'rooms', furnitureGroups: ROOM_FURNITURE_GROUPS },
      storageRoom: { name: 'Storage',        color: '#687', isZoneTab: true, zoneType: 'storageRoom',  group: 'rooms', furnitureGroups: ROOM_FURNITURE_GROUPS },
    },
  },
  structure: {
    name: 'Structure',
    categories: {
      flooring:    { name: 'Flooring',      color: '#999', subsections: { foundations: { name: 'Foundations' }, surfaces: { name: 'Surfaces' }, roofs: { name: 'Roofs' } } },
      walls:       { name: 'Walls',         color: '#887', subsections: { walls: { name: 'Walls' }, shielding: { name: 'Shielding' }, paint: { name: 'Paint' }, wallpaper: { name: 'Wallpaper' } } },
      doors:       { name: 'Doors',         color: '#689', subsections: { interior: { name: 'Interior' }, exterior: { name: 'Exterior' }, gates: { name: 'Fence Gates' } } },
      windows:     { name: 'Windows',       color: '#8cf', subsections: { interior: { name: 'Interior' }, exterior: { name: 'Exterior' }, shielded: { name: 'Shielded' } } },
      hangings:    { name: 'Hangings',      color: '#b88', isDecorationTab: true },
      // Indoor floor, wall, ceiling, and task fixtures are building fabric,
      // unlike Grounds' outdoor lamp families. The key is deliberately
      // distinct so category-keyed lookups cannot collide across tabs.
      structureLights: { name: 'Lights',    color: '#a98', isDecorationTab: true,
                         subsections: {
                           floorLamps: { name: 'Floor Lamps' },
                           deskTask: { name: 'Desk & Task Lamps' },
                           ceilingLights: { name: 'Ceiling Lights' },
                           wallLights: { name: 'Wall Lights' },
                           utilityWarning: { name: 'Utility & Warning Lights' },
                         } },
    },
  },
  grounds: {
    name: 'Grounds',
    categories: {
      surfaces:    { name: 'Surfaces',       color: '#997', isSurfaceTab: true },
      treesPlants: { name: 'Trees & Plants', color: '#4a4', isDecorationTab: true },
      fencing:     { name: 'Fencing',        color: '#5a5', isWallTab: true,
                     subsections: { hedges: { name: 'Hedges' }, fencing: { name: 'Fences' } } },
      furniture:   { name: 'Furniture',      color: '#864', isDecorationTab: true },
      lighting:    { name: 'Lighting',       color: '#aa8', isDecorationTab: true,
                     subsections: {
                       pathLandscape: { name: 'Path & Landscape Lights' },
                       areaSecurity: { name: 'Area & Security Lights' },
                     } },
      utilities:   { name: 'Utilities',      color: '#789', isDecorationTab: true,
                     utilityLineTools: ['hvCable', 'powerCable', 'coolingWater'],
                     linkedPlaceables: [
                       'gridServicePoint', 'gridServicePointHighCapacity', 'padMountTransformer', 'facilityTransformer',
                       'hvTransformer', 'gridIntertieTransformer', 'poleMountTransformer',
                       'disconnectSwitch', 'hvDuctBankVault',
                       'waterTank', 'facilityWaterSupply', 'bulkWaterTank',
                     ] },
      security:    { name: 'Security',       color: '#b76', isDecorationTab: true,
                     linkedPlaceables: ['floodLight'] },
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

// Infra category -> its utility-line tools, DERIVED from the category
// definitions above. hud.js reads a category's own `utilityLineTools` first
// and falls back to this, so the two were the same list written twice — and
// since every category declares its own, this copy was dead. Adding hvCable to
// it changed nothing at all, and the HV feeder had no tool in the palette
// while existing in the data, the solver and the port tables.
//
// Deriving it means the fallback cannot disagree with what it falls back to.
// There used to be a `distribution:` catch-all here listing all six utilities;
// `distribution` is a *subsection* name, never a category, so it was never
// looked up either.
export const INFRA_DISTRIBUTION = Object.fromEntries(
  Object.entries(MODES.infra.categories)
    .filter(([, def]) => Array.isArray(def.utilityLineTools))
    .map(([key, def]) => [key, def.utilityLineTools]),
);
