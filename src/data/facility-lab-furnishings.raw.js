// Facility lab furnishings — items placed inside lab zones (RF, cooling, vacuum, optics, diagnostics, machine shop, maintenance).
export const FACILITY_LAB_FURNISHINGS_RAW = {
  rfWorkbench:      {
    id: 'rfWorkbench', name: 'RF Workbench', zoneType: 'rfLab',
    cost: { funding: 50 }, energyCost: 1.5, spriteColor: 0xbb9944,
    gridW: 4, gridH: 2, subH: 2, spriteKey: 'rfWorkbench',
    effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_brushed',
    // Part coords are in subtile units, centered on the footprint.
    // y=0 is the floor (it's the BOTTOM of the part). Footprint = 4×2.
    parts: [
      // Four legs
      { name: 'legFL', x: -1.85, y: 0,    z: -0.85, w: 0.2,  h: 1.4, l: 0.2, material: 'metal_dark' },
      { name: 'legFR', x:  1.85, y: 0,    z: -0.85, w: 0.2,  h: 1.4, l: 0.2, material: 'metal_dark' },
      { name: 'legBL', x: -1.85, y: 0,    z:  0.85, w: 0.2,  h: 1.4, l: 0.2, material: 'metal_dark' },
      { name: 'legBR', x:  1.85, y: 0,    z:  0.85, w: 0.2,  h: 1.4, l: 0.2, material: 'metal_dark' },
      // Cross brace under-frame (front + back) for rigidity look
      { name: 'braceF', x: 0, y: 0.3,  z: -0.85, w: 3.6, h: 0.1, l: 0.1, material: 'metal_dark' },
      { name: 'braceB', x: 0, y: 0.3,  z:  0.85, w: 3.6, h: 0.1, l: 0.1, material: 'metal_dark' },
      // Lower storage shelf
      { name: 'shelf',  x: 0, y: 0.35, z:  0,    w: 3.6, h: 0.08, l: 1.7, material: 'metal_brushed' },
      // Tabletop
      { name: 'top',    x: 0, y: 1.4,  z:  0,    w: 4.0, h: 0.12, l: 2.0, material: 'metal_brushed' },
      // Backsplash / pegboard
      { name: 'backsplash', x: 0, y: 1.52, z: -0.94, w: 4.0, h: 0.7, l: 0.1, material: 'metal_painted_white' },
    ],
  },
  oscilloscope:     { id: 'oscilloscope',      name: 'Oscilloscope',       zoneType: 'rfLab',       cost: { funding: 120 },  energyCost: 0.5, spriteColor: 0xc6bea8, gridW: 1, gridH: 1, subH: 1, visualSubW: 1.5, visualSubH: 1.0, visualSubL: 0.8, spriteKey: 'oscilloscope',     effects: { zoneOutput: 0.05 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'oscilloscope_front' }, '-X': { decal: 'oscilloscope_side' }, '+X': { decal: 'oscilloscope_side' } }, stackable: true },
  signalGenerator:  { id: 'signalGenerator',   name: 'Signal Generator',   zoneType: 'rfLab',       cost: { funding: 200 },  energyCost: 0.8, spriteColor: 0x3a3e46, gridW: 1, gridH: 1, subH: 1, visualSubW: 1.6, visualSubH: 0.6, visualSubL: 0.9, spriteKey: 'signalGenerator',  effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_dark',     faces: { '+Z': { decal: 'signal_generator_front' }, '-X': { decal: 'signal_generator_side' }, '+X': { decal: 'signal_generator_side' } }, stackable: true },
  spectrumAnalyzer: { id: 'spectrumAnalyzer',  name: 'Spectrum Analyzer',  zoneType: 'rfLab',       cost: { funding: 350 },  energyCost: 1.0, spriteColor: 0x888c94, gridW: 1, gridH: 1, subH: 1, visualSubW: 1.8, visualSubH: 1.2, visualSubL: 1.0, spriteKey: 'spectrumAnalyzer', effects: { zoneOutput: 0.08 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'spectrum_analyzer_front' }, '-X': { decal: 'spectrum_analyzer_side' }, '+X': { decal: 'spectrum_analyzer_side' } }, stackable: true },
  networkAnalyzer:  { id: 'networkAnalyzer',   name: 'Network Analyzer',   zoneType: 'rfLab',       cost: { funding: 500 },  energyCost: 1.2, spriteColor: 0xd2c4a0, gridW: 1, gridH: 1, subH: 1, visualSubW: 2.0, visualSubH: 1.5, visualSubL: 1.2, spriteKey: 'networkAnalyzer',  effects: { zoneOutput: 0.10 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'network_analyzer_front' }, '-X': { decal: 'network_analyzer_side' }, '+X': { decal: 'network_analyzer_side' } }, stackable: true },
  coolantPump:      { id: 'coolantPump',       name: 'Coolant Pump',       zoneType: 'coolingLab',  cost: { funding: 80 },   energyCost: 2.0, spriteColor: 0x33bbbb, gridW: 2, gridH: 2, subH: 2, spriteKey: 'coolantPump',      effects: { zoneOutput: 0.04 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'coolant_pump_front' }, '-X': { decal: 'coolant_pump_side' }, '+X': { decal: 'coolant_pump_side' } }, hasSurface: false },
  heatExchanger:    { id: 'heatExchanger',     name: 'Heat Exchanger',     zoneType: 'coolingLab',  cost: { funding: 150 },  energyCost: 3.0, spriteColor: 0x4499aa, gridW: 3, gridH: 2, subH: 2, spriteKey: 'heatExchanger',    effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'heat_exchanger_front' }, '-X': { decal: 'heat_exchanger_side' }, '+X': { decal: 'heat_exchanger_side' } } },
  pipeRack:         { id: 'pipeRack',          name: 'Pipe Rack',          zoneType: 'coolingLab',  cost: { funding: 40 },   energyCost: 0,   spriteColor: 0x667788, gridW: 1, gridH: 3, subH: 5, spriteKey: 'pipeRack',         effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'pipe_rack_front' } }, hasSurface: false },
  chillerUnit:      { id: 'chillerUnit',       name: 'Chiller Unit',       zoneType: 'coolingLab',  cost: { funding: 300 },  energyCost: 10.0, spriteColor: 0x2288aa, gridW: 4, gridH: 3, subH: 4, spriteKey: 'chillerUnit',      effects: { zoneOutput: 0.12 }, baseMaterial: 'metal_painted_white', faces: { '+Z': { decal: 'chiller_unit_front' }, '-X': { decal: 'chiller_unit_side' }, '+X': { decal: 'chiller_unit_side' } } },
  flowMeter:        { id: 'flowMeter',         name: 'Flow Meter',         zoneType: 'coolingLab',  cost: { funding: 100 },  energyCost: 0.1, spriteColor: 0x55cccc, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.35, visualSubH: 0.4, visualSubL: 0.35, spriteKey: 'flowMeter',        effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'flow_meter_front' } }, stackable: true },
  testChamber:      { id: 'testChamber',       name: 'Test Chamber',       zoneType: 'vacuumLab',   cost: { funding: 200 },  energyCost: 4.0, spriteColor: 0x8855bb, gridW: 3, gridH: 3, subH: 2, spriteKey: 'testChamber',      effects: { zoneOutput: 0.08 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'test_chamber_front' }, '-X': { decal: 'test_chamber_side' }, '+X': { decal: 'test_chamber_side' } } },
  leakDetector:     { id: 'leakDetector',      name: 'Leak Detector',      zoneType: 'vacuumLab',   cost: { funding: 180 },  energyCost: 0.8, spriteColor: 0x6644aa, gridW: 2, gridH: 1, subH: 1, visualSubW: 1.3, visualSubH: 0.7, visualSubL: 0.75, spriteKey: 'leakDetector',     effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'leak_detector_front' } }, stackable: true },
  pumpCart:         { id: 'pumpCart',           name: 'Pump Cart',          zoneType: 'vacuumLab',   cost: { funding: 60 },   energyCost: 2.0, spriteColor: 0x9966cc, gridW: 2, gridH: 1, subH: 2, spriteKey: 'pumpCart',         effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'pump_cart_front' }, '-X': { decal: 'pump_cart_side' }, '+X': { decal: 'pump_cart_side' } } },
  gasManifold:      { id: 'gasManifold',       name: 'Gas Manifold',       zoneType: 'vacuumLab',   cost: { funding: 120 },  energyCost: 0.5, spriteColor: 0x7755aa, gridW: 3, gridH: 1, subH: 1, spriteKey: 'gasManifold',      effects: { zoneOutput: 0.04 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'gas_manifold_front' } } },
  rga:              { id: 'rga',               name: 'Residual Gas Analyzer', zoneType: 'vacuumLab', cost: { funding: 400 },  energyCost: 2.5, spriteColor: 0xaa77dd, gridW: 1, gridH: 2, subH: 2, spriteKey: 'rga',              effects: { zoneOutput: 0.10 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'rga_front' }, '-X': { decal: 'rga_side' }, '+X': { decal: 'rga_side' } } },
  lathe:            { id: 'lathe',             name: 'Lathe',              zoneType: 'machineShop', cost: { funding: 120 },  energyCost: 5.0, spriteColor: 0x997755, gridW: 1, gridH: 4, subH: 2, spriteKey: 'lathe',            effects: { zoneOutput: 0.05 }, baseMaterial: 'metal_dark' },
  millingMachine:   { id: 'millingMachine',    name: 'Milling Machine',    zoneType: 'machineShop', cost: { funding: 180 },  energyCost: 7.0, spriteColor: 0x887766, gridW: 2, gridH: 2, subH: 2, spriteKey: 'millingMachine',   effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_dark' },
  drillPress:       { id: 'drillPress',        name: 'Drill Press',        zoneType: 'machineShop', cost: { funding: 80 },   energyCost: 1.5, spriteColor: 0x776655, gridW: 1, gridH: 1, subH: 2, spriteKey: 'drillPress',       effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_dark' },
  toolCabinet: {
    id: 'toolCabinet', name: 'Tool Cabinet', zoneType: 'machineShop',
    cost: { funding: 40 }, energyCost: 0, spriteColor: 0x8a3a2a,
    gridW: 2, gridH: 1, subH: 2, spriteKey: 'toolCabinet',
    effects: { zoneOutput: 0.01 }, baseMaterial: 'metal_painted_white',
    // 2×1 footprint. Rollaway red machinist's chest: body + 6 drawer
    // faces (graduated heights) + pulls + 4 caster wheels.
    parts: [
      // 4 caster wheels
      { name: 'whFL', x: -0.85, y: 0, z: -0.35, w: 0.18, h: 0.18, l: 0.18, color: 0x18181c },
      { name: 'whFR', x:  0.85, y: 0, z: -0.35, w: 0.18, h: 0.18, l: 0.18, color: 0x18181c },
      { name: 'whBL', x: -0.85, y: 0, z:  0.35, w: 0.18, h: 0.18, l: 0.18, color: 0x18181c },
      { name: 'whBR', x:  0.85, y: 0, z:  0.35, w: 0.18, h: 0.18, l: 0.18, color: 0x18181c },
      // Cabinet body (red)
      { name: 'body', x: 0, y: 0.18, z: 0, w: 1.95, h: 1.7, l: 0.9, color: 0xa23a2a },
      // Top edge rail
      { name: 'topRail', x: 0, y: 1.82, z: 0, w: 2.0, h: 0.07, l: 0.95, color: 0x18181c },
      // Drawers (graduated: small on top, big on bottom)
      { name: 'dr1', x: 0, y: 1.55, z: -0.47, w: 1.8, h: 0.22, l: 0.02, color: 0x7a2a20 },
      { name: 'dr2', x: 0, y: 1.25, z: -0.47, w: 1.8, h: 0.24, l: 0.02, color: 0x7a2a20 },
      { name: 'dr3', x: 0, y: 0.93, z: -0.47, w: 1.8, h: 0.26, l: 0.02, color: 0x7a2a20 },
      { name: 'dr4', x: 0, y: 0.58, z: -0.47, w: 1.8, h: 0.28, l: 0.02, color: 0x7a2a20 },
      { name: 'dr5', x: 0, y: 0.22, z: -0.47, w: 1.8, h: 0.3,  l: 0.02, color: 0x7a2a20 },
      // Chrome pulls
      { name: 'p1', x: 0, y: 1.64, z: -0.49, w: 0.7, h: 0.04, l: 0.04, color: 0xc0c4cc },
      { name: 'p2', x: 0, y: 1.34, z: -0.49, w: 0.7, h: 0.04, l: 0.04, color: 0xc0c4cc },
      { name: 'p3', x: 0, y: 1.02, z: -0.49, w: 0.7, h: 0.04, l: 0.04, color: 0xc0c4cc },
      { name: 'p4', x: 0, y: 0.68, z: -0.49, w: 0.7, h: 0.04, l: 0.04, color: 0xc0c4cc },
      { name: 'p5', x: 0, y: 0.34, z: -0.49, w: 0.7, h: 0.04, l: 0.04, color: 0xc0c4cc },
    ],
  },
  weldingStation:   { id: 'weldingStation',    name: 'Welding Station',    zoneType: 'machineShop', cost: { funding: 200 },  energyCost: 8.0, spriteColor: 0xcc7744, gridW: 2, gridH: 2, subH: 2, spriteKey: 'weldingStation',   effects: { zoneOutput: 0.07 }, baseMaterial: 'metal_dark' },
  cncMill:          { id: 'cncMill',           name: 'CNC Mill',           zoneType: 'machineShop', cost: { funding: 350 },  energyCost: 4.0, spriteColor: 0x998877, gridW: 3, gridH: 2, subH: 2, spriteKey: 'cncMill',          effects: { zoneOutput: 0.10 }, baseMaterial: 'metal_dark' },
  assemblyCrane:    { id: 'assemblyCrane',     name: 'Assembly Crane',     zoneType: 'machineShop', cost: { funding: 400 },  energyCost: 12.0, spriteColor: 0xddaa44, gridW: 4, gridH: 4, subH: 5, spriteKey: 'assemblyCrane',    effects: { zoneOutput: 0.12 }, baseMaterial: 'metal_brushed', hasSurface: false },
  opticalTable: {
    id: 'opticalTable', name: 'Optical Table', zoneType: 'opticsLab',
    cost: { funding: 800 }, energyCost: 0.5, spriteColor: 0x2a2c34,
    gridW: 4, gridH: 2, subH: 2, spriteKey: 'opticalTable',
    effects: { zoneOutput: 0.08 }, baseMaterial: 'metal_dark',
    // 4×2 footprint. Vibration-isolated breadboard: 4 chunky pneumatic
    // legs with white damping collars + thick dark perforated top.
    parts: [
      // Pneumatic isolator legs
      { name: 'legFL', x: -1.8, y: 0, z: -0.85, w: 0.35, h: 1.55, l: 0.35, material: 'metal_dark' },
      { name: 'legFR', x:  1.8, y: 0, z: -0.85, w: 0.35, h: 1.55, l: 0.35, material: 'metal_dark' },
      { name: 'legBL', x: -1.8, y: 0, z:  0.85, w: 0.35, h: 1.55, l: 0.35, material: 'metal_dark' },
      { name: 'legBR', x:  1.8, y: 0, z:  0.85, w: 0.35, h: 1.55, l: 0.35, material: 'metal_dark' },
      // White damping collars near top of each leg
      { name: 'cuffFL', x: -1.8, y: 1.25, z: -0.85, w: 0.55, h: 0.25, l: 0.55, material: 'metal_painted_white' },
      { name: 'cuffFR', x:  1.8, y: 1.25, z: -0.85, w: 0.55, h: 0.25, l: 0.55, material: 'metal_painted_white' },
      { name: 'cuffBL', x: -1.8, y: 1.25, z:  0.85, w: 0.55, h: 0.25, l: 0.55, material: 'metal_painted_white' },
      { name: 'cuffBR', x:  1.8, y: 1.25, z:  0.85, w: 0.55, h: 0.25, l: 0.55, material: 'metal_painted_white' },
      // Thick dark breadboard top
      { name: 'top', x: 0, y: 1.5, z: 0, w: 4.0, h: 0.35, l: 2.0, material: 'metal_dark' },
      // Matte top surface suggesting M6 tapped-hole pattern
      { name: 'surface', x: 0, y: 1.85, z: 0, w: 3.9, h: 0.02, l: 1.95, color: 0x14141a },
    ],
  },
  laserAlignment:   { id: 'laserAlignment',    name: 'Laser Alignment System',  zoneType: 'opticsLab', cost: { funding: 1500 },  energyCost: 2.0, spriteColor: 0xcc4444, gridW: 4, gridH: 1, subH: 2, spriteKey: 'laserAlignment',   effects: { zoneOutput: 0.10, beamPhysics: { emittanceReduction: 0.02 } }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'laser_alignment_front' }, '-X': { decal: 'laser_alignment_side' }, '+X': { decal: 'laser_alignment_side' } }, hasSurface: false },
  mirrorMount:      { id: 'mirrorMount',       name: 'Mirror Mount Station',    zoneType: 'opticsLab', cost: { funding: 250 },  energyCost: 0.1, spriteColor: 0xaaaacc, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.3, visualSubH: 0.6, visualSubL: 0.3, spriteKey: 'mirrorMount',      effects: { zoneOutput: 0.04 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'mirror_mount_front' } }, stackable: true },
  beamProfiler:     { id: 'beamProfiler',      name: 'Beam Profiler',           zoneType: 'opticsLab', cost: { funding: 600 },  energyCost: 1.0, spriteColor: 0x44cc88, gridW: 2, gridH: 1, subH: 1, visualSubW: 1.3, visualSubH: 0.5, visualSubL: 0.7, spriteKey: 'beamProfiler',     effects: { zoneOutput: 0.07, beamPhysics: { diagnosticAccuracy: 0.05 } }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'beam_profiler_front' } }, stackable: true },
  interferometer:   { id: 'interferometer',     name: 'Interferometer',          zoneType: 'opticsLab', cost: { funding: 1200 },  energyCost: 1.5, spriteColor: 0x8844cc, gridW: 2, gridH: 1, subH: 1, visualSubW: 1.4, visualSubH: 0.6, visualSubL: 0.8, spriteKey: 'interferometer',   effects: { zoneOutput: 0.12 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'interferometer_front' } } },
  photodetector:    { id: 'photodetector',      name: 'Photodetector',           zoneType: 'opticsLab', cost: { funding: 200 },   energyCost: 0.05, spriteColor: 0x4466aa, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.25, visualSubH: 0.35, visualSubL: 0.25, spriteKey: 'photodetector',    effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'photodetector_front' } } },
  polarizer:        { id: 'polarizer',          name: 'Polarizer Mount',         zoneType: 'opticsLab', cost: { funding: 300 },   energyCost: 0,    spriteColor: 0x9999bb, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.3, visualSubH: 0.5, visualSubL: 0.3, spriteKey: 'polarizer',        effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'polarizer_front' } } },
  fiberCoupler:     { id: 'fiberCoupler',       name: 'Fiber Coupler',           zoneType: 'opticsLab', cost: { funding: 400 },  energyCost: 0,    spriteColor: 0x336688, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.35, visualSubH: 0.2, visualSubL: 0.25, spriteKey: 'fiberCoupler',     effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'fiber_coupler_front' } } },
  opticalChopper:   { id: 'opticalChopper',     name: 'Optical Chopper',         zoneType: 'opticsLab', cost: { funding: 350 },  energyCost: 0.2,  spriteColor: 0x556677, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.4, visualSubH: 0.4, visualSubL: 0.35, spriteKey: 'opticalChopper',   effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'optical_chopper_front' } } },
  powerMeter:       { id: 'powerMeter',         name: 'Power Meter',             zoneType: 'opticsLab', cost: { funding: 500 },   energyCost: 0.1,  spriteColor: 0x445566, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.3, visualSubH: 0.4, visualSubL: 0.2, spriteKey: 'powerMeter',       effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'power_meter_front' } } },
  spatialFilter:    { id: 'spatialFilter',      name: 'Spatial Filter',          zoneType: 'opticsLab', cost: { funding: 200 },   energyCost: 0,    spriteColor: 0x8899aa, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.25, visualSubH: 0.5, visualSubL: 0.25, spriteKey: 'spatialFilter',    effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'spatial_filter_front' } } },
  scopeStation:     { id: 'scopeStation',      name: 'Scope Station',           zoneType: 'diagnosticsLab', cost: { funding: 100 },  energyCost: 0.2, spriteColor: 0x44aa44, gridW: 1, gridH: 1, subH: 2, visualSubW: 0.9, visualSubH: 1.8, visualSubL: 0.9, spriteKey: 'scopeStation',     effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_painted_white', faces: { '+Z': { decal: 'scope_station_front' } }, stackable: true },
  wireScannerBench: { id: 'wireScannerBench',  name: 'Wire Scanner Readout',    zoneType: 'diagnosticsLab', cost: { funding: 200 },  energyCost: 1.5, spriteColor: 0x888888, gridW: 1, gridH: 1, subH: 1, visualSubW: 1.6, visualSubH: 0.8, visualSubL: 1.0, spriteKey: 'wireScannerBench', effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'wire_scanner_bench_front' }, '-X': { decal: 'wire_scanner_bench_side' }, '+X': { decal: 'wire_scanner_bench_side' } } },
  bpmTestFixture:   { id: 'bpmTestFixture',    name: 'BPM Electronics',         zoneType: 'diagnosticsLab', cost: { funding: 300 },  energyCost: 1.0, spriteColor: 0xcccc44, gridW: 1, gridH: 1, subH: 1, visualSubW: 1.8, visualSubH: 1.0, visualSubL: 1.0, spriteKey: 'bpmTestFixture',   effects: { zoneOutput: 0.08 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'bpm_test_fixture_front' }, '-X': { decal: 'bpm_test_fixture_side' }, '+X': { decal: 'bpm_test_fixture_side' } } },
  daqRack: {
    id: 'daqRack', name: 'DAQ Rack', zoneType: 'diagnosticsLab',
    cost: { funding: 250 }, energyCost: 1.5, spriteColor: 0x2a2c30,
    gridW: 1, gridH: 2, subH: 5, spriteKey: 'daqRack',
    effects: { zoneOutput: 0.07, research: 0.02 }, baseMaterial: 'metal_dark',
    parts: [
      { name: 'plinth', x: 0, y: 0,   z: 0, w: 1.0, h: 0.1, l: 2.0, material: 'metal_dark' },
      { name: 'cap',    x: 0, y: 4.9, z: 0, w: 1.0, h: 0.1, l: 2.0, material: 'metal_dark' },
      { name: 'railL', x: -0.45, y: 0.1, z: 0, w: 0.08, h: 4.8, l: 2.0, material: 'metal_dark' },
      { name: 'railR', x:  0.45, y: 0.1, z: 0, w: 0.08, h: 4.8, l: 2.0, material: 'metal_dark' },
      { name: 'back',  x: 0, y: 0.1, z: 0.96, w: 0.82, h: 4.8, l: 0.04, material: 'metal_dark' },
      // 4U digitizer chassis — dark face with 8 channel activity LEDs
      { name: 'daq1',     x: 0, y: 0.35, z: -0.02, w: 0.82, h: 0.75, l: 1.9, color: 0x46484e },
      { name: 'daq1Face', x: 0, y: 0.4,  z: -0.95, w: 0.78, h: 0.65, l: 0.02, color: 0x20222a },
      { name: 'daq1L1', x: -0.30, y: 0.72, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 'daq1L2', x: -0.22, y: 0.72, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 'daq1L3', x: -0.14, y: 0.72, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0xffaa40 },
      { name: 'daq1L4', x: -0.06, y: 0.72, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 'daq1L5', x:  0.02, y: 0.72, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 'daq1L6', x:  0.10, y: 0.72, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 'daq1L7', x:  0.18, y: 0.72, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0xffaa40 },
      { name: 'daq1L8', x:  0.26, y: 0.72, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      // 6U waveform display unit — green phosphor screen + status LEDs
      { name: 'daq2',     x: 0, y: 1.2, z: -0.02, w: 0.82, h: 1.0, l: 1.9, color: 0x3a3c42 },
      { name: 'daq2Scr',  x: -0.05, y: 1.5, z: -0.95, w: 0.55, h: 0.5, l: 0.02, color: 0x0a2a14 },
      { name: 'daq2L1',   x:  0.32, y: 1.85, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 'daq2L2',   x:  0.32, y: 1.75, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 'daq2L3',   x:  0.32, y: 1.65, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0xffaa40 },
      { name: 'daq2L4',   x:  0.32, y: 1.55, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      // Patch panel with fiber link indicators
      { name: 'patch',    x: 0, y: 2.3, z: -0.02, w: 0.82, h: 0.35, l: 1.9, color: 0x2c2e34 },
      { name: 'pL1',  x: -0.30, y: 2.42, z: -0.97, w: 0.03, h: 0.03, l: 0.02, color: 0x40b0ff },
      { name: 'pL2',  x: -0.22, y: 2.42, z: -0.97, w: 0.03, h: 0.03, l: 0.02, color: 0x40b0ff },
      { name: 'pL3',  x: -0.14, y: 2.42, z: -0.97, w: 0.03, h: 0.03, l: 0.02, color: 0x44ff66 },
      { name: 'pL4',  x: -0.06, y: 2.42, z: -0.97, w: 0.03, h: 0.03, l: 0.02, color: 0x44ff66 },
      { name: 'pL5',  x:  0.02, y: 2.42, z: -0.97, w: 0.03, h: 0.03, l: 0.02, color: 0xffaa40 },
      { name: 'pL6',  x:  0.10, y: 2.42, z: -0.97, w: 0.03, h: 0.03, l: 0.02, color: 0x40b0ff },
      { name: 'pL7',  x:  0.18, y: 2.42, z: -0.97, w: 0.03, h: 0.03, l: 0.02, color: 0x44ff66 },
      { name: 'pL8',  x:  0.26, y: 2.42, z: -0.97, w: 0.03, h: 0.03, l: 0.02, color: 0x40b0ff },
      // Timing / trigger controller with small LCD + status grid
      { name: 'ctrl',     x: 0, y: 2.75, z: -0.02, w: 0.82, h: 0.6, l: 1.9, color: 0x48484c },
      { name: 'ctrlScr',  x: -0.12, y: 2.95, z: -0.95, w: 0.30, h: 0.18, l: 0.02, color: 0x102818 },
      { name: 'cL1', x:  0.20, y: 3.05, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 'cL2', x:  0.28, y: 3.05, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 'cL3', x:  0.20, y: 2.95, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0xffaa40 },
      { name: 'cL4', x:  0.28, y: 2.95, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0xff4040 },
      // UPS with LCD status + battery LEDs
      { name: 'ups',      x: 0, y: 3.45, z: -0.02, w: 0.82, h: 0.9, l: 1.9, color: 0x4a4a52 },
      { name: 'upsLcd',   x: -0.05, y: 3.75, z: -0.95, w: 0.35, h: 0.2, l: 0.02, color: 0xd0b840 },
      { name: 'uL1',  x:  0.28, y: 3.85, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 'uL2',  x:  0.28, y: 3.75, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 'uL3',  x:  0.28, y: 3.65, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      // Alarm status panel at top — 6 indicator lamps
      { name: 'lampArea', x: 0, y: 4.45, z: -0.02, w: 0.82, h: 0.35, l: 1.9, color: 0x2a2a30 },
      { name: 'lamp1', x: -0.30, y: 4.58, z: -0.97, w: 0.06, h: 0.06, l: 0.02, color: 0x44ff66 },
      { name: 'lamp2', x: -0.18, y: 4.58, z: -0.97, w: 0.06, h: 0.06, l: 0.02, color: 0x44ff66 },
      { name: 'lamp3', x: -0.06, y: 4.58, z: -0.97, w: 0.06, h: 0.06, l: 0.02, color: 0xffaa40 },
      { name: 'lamp4', x:  0.06, y: 4.58, z: -0.97, w: 0.06, h: 0.06, l: 0.02, color: 0x44ff66 },
      { name: 'lamp5', x:  0.18, y: 4.58, z: -0.97, w: 0.06, h: 0.06, l: 0.02, color: 0xff4040 },
      { name: 'lamp6', x:  0.30, y: 4.58, z: -0.97, w: 0.06, h: 0.06, l: 0.02, color: 0x44ff66 },
    ],
  },
  serverCluster:    { id: 'serverCluster',     name: 'Server Cluster',          zoneType: 'diagnosticsLab', cost: { funding: 500 },  energyCost: 5.0, spriteColor: 0x448844, gridW: 3, gridH: 2, subH: 5, spriteKey: 'serverCluster',    effects: { research: 0.08 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'server_cluster_front' }, '-X': { decal: 'server_cluster_side' }, '+X': { decal: 'server_cluster_side' } } },
  toolChest:        { id: 'toolChest',         name: 'Tool Chest',         zoneType: 'maintenance', cost: { funding: 50 },   energyCost: 0,   spriteColor: 0xbb7744, gridW: 2, gridH: 1, subH: 2, spriteKey: 'toolChest',        effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_dark' },
  partsShelf: {
    id: 'partsShelf', name: 'Parts Shelf', zoneType: 'maintenance',
    cost: { funding: 35 }, energyCost: 0, spriteColor: 0x6a5838,
    gridW: 4, gridH: 1, subH: 5, spriteKey: 'partsShelf',
    effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_brushed',
    // 4×1 footprint, 2.5 m tall. Industrial steel shelving: 4 corner
    // uprights, a back diagonal brace, 5 shelves, plus a few visible
    // crates to sell the "parts storage" read.
    parts: [
      // Uprights
      { name: 'upFL', x: -1.92, y: 0, z: -0.42, w: 0.12, h: 5.0, l: 0.12, material: 'metal_dark' },
      { name: 'upFR', x:  1.92, y: 0, z: -0.42, w: 0.12, h: 5.0, l: 0.12, material: 'metal_dark' },
      { name: 'upBL', x: -1.92, y: 0, z:  0.42, w: 0.12, h: 5.0, l: 0.12, material: 'metal_dark' },
      { name: 'upBR', x:  1.92, y: 0, z:  0.42, w: 0.12, h: 5.0, l: 0.12, material: 'metal_dark' },
      // Shelves
      { name: 'shelf1', x: 0, y: 0.1, z: 0, w: 3.9, h: 0.08, l: 0.95, material: 'metal_brushed' },
      { name: 'shelf2', x: 0, y: 1.1, z: 0, w: 3.9, h: 0.08, l: 0.95, material: 'metal_brushed' },
      { name: 'shelf3', x: 0, y: 2.1, z: 0, w: 3.9, h: 0.08, l: 0.95, material: 'metal_brushed' },
      { name: 'shelf4', x: 0, y: 3.1, z: 0, w: 3.9, h: 0.08, l: 0.95, material: 'metal_brushed' },
      { name: 'shelf5', x: 0, y: 4.1, z: 0, w: 3.9, h: 0.08, l: 0.95, material: 'metal_brushed' },
      // Back cross-brace
      { name: 'brace',  x: 0, y: 4.85, z: 0.42, w: 3.9, h: 0.1, l: 0.06, material: 'metal_dark' },
      // A few parts crates on shelves
      { name: 'crate1', x: -1.3, y: 0.18, z:  0,   w: 0.8, h: 0.5, l: 0.7, color: 0x8a6a3a },
      { name: 'crate2', x:  0.2, y: 0.18, z: -0.1, w: 1.0, h: 0.4, l: 0.6, color: 0x5c4624 },
      { name: 'bin1',   x:  1.3, y: 1.18, z:  0,   w: 0.7, h: 0.35, l: 0.7, color: 0x4a5a72 },
      { name: 'bin2',   x: -1.0, y: 1.18, z:  0,   w: 0.9, h: 0.3,  l: 0.7, color: 0x4a5a72 },
      { name: 'box1',   x:  0.0, y: 2.18, z:  0,   w: 1.1, h: 0.45, l: 0.7, color: 0x7a6a4a },
    ],
  },
  workCart: {
    id: 'workCart', name: 'Work Cart', zoneType: 'maintenance',
    cost: { funding: 25 }, energyCost: 0, spriteColor: 0xb8bac2,
    gridW: 2, gridH: 1, subH: 2, spriteKey: 'workCart',
    effects: { zoneOutput: 0.01 }, baseMaterial: 'metal_brushed',
    // 2×1 footprint. 3-tier lab utility cart: 4 posts, 3 shelves,
    // 4 caster wheels, and a push handle at one end.
    parts: [
      // Caster wheels
      { name: 'whFL', x: -0.85, y: 0, z: -0.35, w: 0.14, h: 0.16, l: 0.14, color: 0x18181c },
      { name: 'whFR', x:  0.85, y: 0, z: -0.35, w: 0.14, h: 0.16, l: 0.14, color: 0x18181c },
      { name: 'whBL', x: -0.85, y: 0, z:  0.35, w: 0.14, h: 0.16, l: 0.14, color: 0x18181c },
      { name: 'whBR', x:  0.85, y: 0, z:  0.35, w: 0.14, h: 0.16, l: 0.14, color: 0x18181c },
      // 4 posts
      { name: 'postFL', x: -0.85, y: 0.16, z: -0.35, w: 0.08, h: 1.7, l: 0.08, material: 'metal_brushed' },
      { name: 'postFR', x:  0.85, y: 0.16, z: -0.35, w: 0.08, h: 1.7, l: 0.08, material: 'metal_brushed' },
      { name: 'postBL', x: -0.85, y: 0.16, z:  0.35, w: 0.08, h: 1.7, l: 0.08, material: 'metal_brushed' },
      { name: 'postBR', x:  0.85, y: 0.16, z:  0.35, w: 0.08, h: 1.7, l: 0.08, material: 'metal_brushed' },
      // 3 shelves
      { name: 'shelf1', x: 0, y: 0.22, z: 0, w: 1.85, h: 0.06, l: 0.85, material: 'metal_brushed' },
      { name: 'shelf2', x: 0, y: 0.95, z: 0, w: 1.85, h: 0.06, l: 0.85, material: 'metal_brushed' },
      { name: 'shelf3', x: 0, y: 1.65, z: 0, w: 1.85, h: 0.06, l: 0.85, material: 'metal_brushed' },
      // Push handle at right end
      { name: 'hUp',    x:  1.0, y: 1.85, z: 0, w: 0.06, h: 0.3, l: 0.7, material: 'metal_brushed' },
      { name: 'hBar',   x:  1.1, y: 2.1,  z: 0, w: 0.12, h: 0.06, l: 0.75, material: 'metal_brushed' },
      // Flavor: a toolbox on the top shelf
      { name: 'toolbox', x: -0.3, y: 1.71, z: 0, w: 0.7, h: 0.3, l: 0.45, color: 0xcc5522 },
    ],
  },
  craneHoist:       { id: 'craneHoist',        name: 'Crane Hoist',        zoneType: 'maintenance', cost: { funding: 300 },  energyCost: 12.0, spriteColor: 0xddaa44, gridW: 4, gridH: 4, subH: 5, spriteKey: 'craneHoist',       effects: { zoneOutput: 0.10 }, baseMaterial: 'metal_brushed', hasSurface: false },
};
