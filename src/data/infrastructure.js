// Infrastructure items — placed freely on the grid, not part of the beamline
export const INFRASTRUCTURE = {
  path: {
    id: 'path',
    name: 'Walkway',
    desc: 'Paved walkway for staff access between buildings.',
    cost: 5,   // funding per tile
    color: 0x887766,
    topColor: 0x998877,
  },
  concrete: {
    id: 'concrete',
    name: 'Concrete Pad',
    desc: 'Reinforced concrete foundation. Drag to place a rectangle.',
    cost: 10,  // funding per tile
    color: 0x777777,
    topColor: 0x999999,
    isDragPlacement: true,
    subsection: 'foundations',
    variants: ['Standard', 'Light', 'Dark', 'Warm'],
  },
  labFloor: {
    id: 'labFloor',
    name: 'Lab Flooring',
    desc: 'Clean epoxy floor for laboratory zones. Requires concrete foundation. Drag to place.',
    cost: 15,
    color: 0xbbbbbb,
    topColor: 0xdddddd,
    isDragPlacement: true,
    subsection: 'surfaces',
    requiresFoundation: 'concrete',
    variants: ['Blue-Gray Epoxy', 'White Epoxy', 'Green Epoxy', 'Dark Epoxy'],
  },
  officeFloor: {
    id: 'officeFloor',
    name: 'Office Flooring',
    desc: 'Carpet tile flooring for office and admin zones. Requires concrete foundation. Drag to place.',
    cost: 12,
    color: 0xaa9977,
    topColor: 0xccbb99,
    isDragPlacement: true,
    subsection: 'surfaces',
    requiresFoundation: 'concrete',
    variants: ['Tan Carpet', 'Blue-Gray Carpet', 'Hardwood', 'Charcoal Carpet'],
  },
  groomedGrass: {
    id: 'groomedGrass',
    name: 'Groomed Grass',
    desc: 'Manicured lawn for campus grounds. Drag to place.',
    cost: 3,
    color: 0x558833,
    topColor: 0x77aa44,
    isDragPlacement: true,
    subsection: 'surfaces',
    variants: ['Groomed Grass', 'Groomed Grass (light)'],
  },
  hallway: {
    id: 'hallway',
    name: 'Hallway',
    desc: 'Checked linoleum hallway connecting zones. Requires concrete foundation. Click and drag a line.',
    cost: 8,
    color: 0xcccccc,
    topColor: 0xeeeeee,
    isLinePlacement: true,
    subsection: 'surfaces',
    requiresFoundation: 'concrete',
    variants: ['Gray Checked', 'Cream Checked', 'Blue Checked', 'Green Checked'],
  },
};

export const ZONES = {
  rfLab:       { id: 'rfLab',       name: 'RF Laboratory',  color: 0xaa8833, requiredFloor: 'labFloor',    gatesCategory: 'rfPower',                   subsection: 'laboratories' },
  coolingLab:  { id: 'coolingLab',  name: 'Cooling Lab',    color: 0x33aaaa, requiredFloor: 'labFloor',    gatesCategory: 'cooling',                   subsection: 'laboratories' },
  vacuumLab:   { id: 'vacuumLab',   name: 'Vacuum Lab',     color: 0x7744aa, requiredFloor: 'labFloor',    gatesCategory: 'vacuum',                    subsection: 'laboratories' },
  officeSpace: { id: 'officeSpace', name: 'Office Space',   color: 0x4466aa, requiredFloor: 'officeFloor', gatesCategory: null,                        subsection: 'operations' },
  controlRoom: { id: 'controlRoom', name: 'Control Room',   color: 0x44aa66, requiredFloor: 'officeFloor', gatesCategory: 'dataControls',              subsection: 'operations' },
  machineShop: { id: 'machineShop', name: 'Machine Shop',   color: 0x886655, requiredFloor: 'labFloor',     gatesCategory: 'beamline',                  subsection: 'industrial' },
  maintenance: { id: 'maintenance', name: 'Maintenance',    color: 0xaa6633, requiredFloor: 'concrete',    gatesCategory: 'ops',                       subsection: 'industrial' },
  opticsLab:   { id: 'opticsLab',   name: 'Optics Lab',     color: 0x44aacc, requiredFloor: 'labFloor',    gatesCategory: null,                        subsection: 'laboratories' },
  diagnosticsLab: { id: 'diagnosticsLab', name: 'Diagnostics Lab', color: 0xaacc44, requiredFloor: 'labFloor', gatesCategory: null,                   subsection: 'laboratories' },
};

export const ZONE_TIER_THRESHOLDS = [4, 8, 16, 20]; // Tier 1: 4 tiles, Tier 2: 8, Tier 3: 16, Tier 4: 20

// Zone furnishings — purchasable items placed inside zones
export const ZONE_FURNISHINGS = {
  // RF Lab furnishings
  rfWorkbench:      { id: 'rfWorkbench',      name: 'RF Workbench',       zoneType: 'rfLab',       cost: 50,   spriteColor: 0xbb9944 },
  oscilloscope:     { id: 'oscilloscope',      name: 'Oscilloscope',       zoneType: 'rfLab',       cost: 120,  spriteColor: 0x44aa44 },
  signalGenerator:  { id: 'signalGenerator',   name: 'Signal Generator',   zoneType: 'rfLab',       cost: 200,  spriteColor: 0xcc6644 },
  spectrumAnalyzer: { id: 'spectrumAnalyzer',  name: 'Spectrum Analyzer',  zoneType: 'rfLab',       cost: 350,  spriteColor: 0x4488cc },
  networkAnalyzer:  { id: 'networkAnalyzer',   name: 'Network Analyzer',   zoneType: 'rfLab',       cost: 500,  spriteColor: 0x8844cc },

  // Cooling Lab furnishings
  coolantPump:      { id: 'coolantPump',       name: 'Coolant Pump',       zoneType: 'coolingLab',  cost: 80,   spriteColor: 0x33bbbb },
  heatExchanger:    { id: 'heatExchanger',     name: 'Heat Exchanger',     zoneType: 'coolingLab',  cost: 150,  spriteColor: 0x4499aa },
  pipeRack:         { id: 'pipeRack',          name: 'Pipe Rack',          zoneType: 'coolingLab',  cost: 40,   spriteColor: 0x667788 },
  chillerUnit:      { id: 'chillerUnit',       name: 'Chiller Unit',       zoneType: 'coolingLab',  cost: 300,  spriteColor: 0x2288aa },
  flowMeter:        { id: 'flowMeter',         name: 'Flow Meter',         zoneType: 'coolingLab',  cost: 100,  spriteColor: 0x55cccc },

  // Vacuum Lab furnishings
  testChamber:      { id: 'testChamber',       name: 'Test Chamber',       zoneType: 'vacuumLab',   cost: 200,  spriteColor: 0x8855bb },
  leakDetector:     { id: 'leakDetector',      name: 'Leak Detector',      zoneType: 'vacuumLab',   cost: 180,  spriteColor: 0x6644aa },
  pumpCart:         { id: 'pumpCart',           name: 'Pump Cart',          zoneType: 'vacuumLab',   cost: 60,   spriteColor: 0x9966cc },
  gasManifold:      { id: 'gasManifold',       name: 'Gas Manifold',       zoneType: 'vacuumLab',   cost: 120,  spriteColor: 0x7755aa },
  rga:              { id: 'rga',               name: 'Residual Gas Analyzer', zoneType: 'vacuumLab', cost: 400,  spriteColor: 0xaa77dd },

  // Office Space furnishings
  desk:             { id: 'desk',              name: 'Desk',               zoneType: 'officeSpace', cost: 30,   spriteColor: 0x5577aa },
  filingCabinet:    { id: 'filingCabinet',     name: 'Filing Cabinet',     zoneType: 'officeSpace', cost: 20,   spriteColor: 0x667799 },
  whiteboard:       { id: 'whiteboard',        name: 'Whiteboard',         zoneType: 'officeSpace', cost: 25,   spriteColor: 0xddddee },
  coffeeMachine:    { id: 'coffeeMachine',     name: 'Coffee Machine',     zoneType: 'officeSpace', cost: 15,   spriteColor: 0x664433 },

  // Control Room furnishings
  monitorBank:      { id: 'monitorBank',       name: 'Monitor Bank',       zoneType: 'controlRoom', cost: 150,  spriteColor: 0x44bb66 },
  serverRack:       { id: 'serverRack',        name: 'Server Rack',        zoneType: 'controlRoom', cost: 250,  spriteColor: 0x338855 },
  operatorConsole:  { id: 'operatorConsole',   name: 'Operator Console',   zoneType: 'controlRoom', cost: 200,  spriteColor: 0x55cc77 },
  alarmPanel:       { id: 'alarmPanel',        name: 'Alarm Panel',        zoneType: 'controlRoom', cost: 100,  spriteColor: 0xcc5544 },

  // Machine Shop furnishings
  lathe:            { id: 'lathe',             name: 'Lathe',              zoneType: 'machineShop', cost: 120,  spriteColor: 0x997755 },
  millingMachine:   { id: 'millingMachine',    name: 'Milling Machine',    zoneType: 'machineShop', cost: 180,  spriteColor: 0x887766 },
  drillPress:       { id: 'drillPress',        name: 'Drill Press',        zoneType: 'machineShop', cost: 80,   spriteColor: 0x776655 },
  toolCabinet:      { id: 'toolCabinet',       name: 'Tool Cabinet',       zoneType: 'machineShop', cost: 40,   spriteColor: 0xaa8866 },
  weldingStation:   { id: 'weldingStation',    name: 'Welding Station',    zoneType: 'machineShop', cost: 200,  spriteColor: 0xcc7744 },
  cncMill:          { id: 'cncMill',           name: 'CNC Mill',           zoneType: 'machineShop', cost: 350,  spriteColor: 0x998877 },
  assemblyCrane:    { id: 'assemblyCrane',     name: 'Assembly Crane',     zoneType: 'machineShop', cost: 400,  spriteColor: 0xddaa44 },

  // Optics Lab furnishings
  opticalTable:     { id: 'opticalTable',      name: 'Optical Table',           zoneType: 'opticsLab', cost: 250,  spriteColor: 0x44aacc },
  laserAlignment:   { id: 'laserAlignment',    name: 'Laser Alignment System',  zoneType: 'opticsLab', cost: 400,  spriteColor: 0xcc4444 },
  mirrorMount:      { id: 'mirrorMount',       name: 'Mirror Mount Station',    zoneType: 'opticsLab', cost: 150,  spriteColor: 0xaaaacc },
  beamProfiler:     { id: 'beamProfiler',      name: 'Beam Profiler',           zoneType: 'opticsLab', cost: 300,  spriteColor: 0x44cc88 },
  interferometer:   { id: 'interferometer',     name: 'Interferometer',          zoneType: 'opticsLab', cost: 500,  spriteColor: 0x8844cc },

  // Diagnostics Lab furnishings
  scopeStation:     { id: 'scopeStation',      name: 'Scope Station',           zoneType: 'diagnosticsLab', cost: 100,  spriteColor: 0x44aa44 },
  wireScannerBench: { id: 'wireScannerBench',  name: 'Wire Scanner Bench',      zoneType: 'diagnosticsLab', cost: 200,  spriteColor: 0x888888 },
  bpmTestFixture:   { id: 'bpmTestFixture',    name: 'BPM Test Fixture',        zoneType: 'diagnosticsLab', cost: 300,  spriteColor: 0xcccc44 },
  daqRack:          { id: 'daqRack',           name: 'DAQ Rack',                zoneType: 'diagnosticsLab', cost: 250,  spriteColor: 0x44cc44 },
  serverCluster:    { id: 'serverCluster',     name: 'Server Cluster',          zoneType: 'diagnosticsLab', cost: 500,  spriteColor: 0x448844 },

  // Maintenance furnishings
  toolChest:        { id: 'toolChest',         name: 'Tool Chest',         zoneType: 'maintenance', cost: 50,   spriteColor: 0xbb7744 },
  partsShelf:       { id: 'partsShelf',        name: 'Parts Shelf',        zoneType: 'maintenance', cost: 35,   spriteColor: 0xaa6633 },
  workCart:         { id: 'workCart',           name: 'Work Cart',          zoneType: 'maintenance', cost: 25,   spriteColor: 0xcc8855 },
  craneHoist:       { id: 'craneHoist',        name: 'Crane Hoist',        zoneType: 'maintenance', cost: 300,  spriteColor: 0xddaa44 },
};

// Furnishing count -> tier thresholds for research tier calculation
export const FURNISHING_TIER_THRESHOLDS = [1, 3, 5]; // Tier 1: 1-2, Tier 2: 3-4, Tier 3: 5+
