// Facility lab furnishings — items placed inside lab zones (RF, cooling, vacuum, optics, diagnostics, machine shop, maintenance).
export const FACILITY_LAB_FURNISHINGS_RAW = {
  rfWorkbench:      {
    id: 'rfWorkbench', name: 'RF Workbench', zoneType: 'rfLab',
    cost: { funding: 2000 }, energyCost: 1.5, spriteColor: 0xbb9944,
    gridW: 4, gridH: 2, subH: 2, surfaceY: 1.52, spriteKey: 'rfWorkbench',
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
  oscilloscope:     { id: 'oscilloscope',      name: 'Oscilloscope',       zoneType: 'rfLab',       cost: { funding: 2000 },  energyCost: 0.5, spriteColor: 0xc6bea8, gridW: 1, gridH: 1, subH: 1, visualSubW: 1.5, visualSubH: 1.0, visualSubL: 0.8, spriteKey: 'oscilloscope',     effects: { zoneOutput: 0.05 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'oscilloscope_front' }, '-X': { decal: 'oscilloscope_side' }, '+X': { decal: 'oscilloscope_side' } }, stackable: true },
  signalGenerator:  { id: 'signalGenerator',   name: 'Signal Generator',   zoneType: 'rfLab',       cost: { funding: 5000 },  energyCost: 0.8, spriteColor: 0x3a3e46, gridW: 1, gridH: 1, subH: 1, visualSubW: 1.6, visualSubH: 0.6, visualSubL: 0.9, spriteKey: 'signalGenerator',  effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_dark',     faces: { '+Z': { decal: 'signal_generator_front' }, '-X': { decal: 'signal_generator_side' }, '+X': { decal: 'signal_generator_side' } }, stackable: true },
  spectrumAnalyzer: { id: 'spectrumAnalyzer',  name: 'Spectrum Analyzer',  zoneType: 'rfLab',       cost: { funding: 15000 },  energyCost: 1.0, spriteColor: 0x888c94, gridW: 1, gridH: 1, subH: 1, visualSubW: 1.8, visualSubH: 1.2, visualSubL: 1.0, spriteKey: 'spectrumAnalyzer', effects: { zoneOutput: 0.08 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'spectrum_analyzer_front' }, '-X': { decal: 'spectrum_analyzer_side' }, '+X': { decal: 'spectrum_analyzer_side' } }, stackable: true },
  networkAnalyzer:  { id: 'networkAnalyzer',   name: 'Network Analyzer',   zoneType: 'rfLab',       cost: { funding: 50000 },  energyCost: 1.2, spriteColor: 0xd2c4a0, gridW: 1, gridH: 1, subH: 1, visualSubW: 2.0, visualSubH: 1.5, visualSubL: 1.2, spriteKey: 'networkAnalyzer',  effects: { zoneOutput: 0.10 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'network_analyzer_front' }, '-X': { decal: 'network_analyzer_side' }, '+X': { decal: 'network_analyzer_side' } }, stackable: true },
  coolantPump:      { id: 'coolantPump',       name: 'Coolant Pump',       zoneType: 'coolingLab',  cost: { funding: 3000 },   energyCost: 2.0, spriteColor: 0x33bbbb, gridW: 2, gridH: 2, subH: 2, spriteKey: 'coolantPump',      effects: { zoneOutput: 0.04 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'coolant_pump_front' }, '-X': { decal: 'coolant_pump_side' }, '+X': { decal: 'coolant_pump_side' } }, hasSurface: false },
  heatExchanger:    { id: 'heatExchanger',     name: 'Heat Exchanger',     zoneType: 'coolingLab',  cost: { funding: 8000 },  energyCost: 3.0, spriteColor: 0x4499aa, gridW: 3, gridH: 2, subH: 2, spriteKey: 'heatExchanger',    effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'heat_exchanger_front' }, '-X': { decal: 'heat_exchanger_side' }, '+X': { decal: 'heat_exchanger_side' } } },
  pipeRack:         { id: 'pipeRack',          name: 'Pipe Rack',          zoneType: 'coolingLab',  cost: { funding: 500 },   energyCost: 0,   spriteColor: 0x667788, gridW: 1, gridH: 3, subH: 5, spriteKey: 'pipeRack',         effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'pipe_rack_front' } }, hasSurface: false },
  chillerUnit:      { id: 'chillerUnit',       name: 'Chiller Unit',       zoneType: 'coolingLab',  cost: { funding: 25000 },  energyCost: 10.0, spriteColor: 0x2288aa, gridW: 4, gridH: 3, subH: 4, spriteKey: 'chillerUnit',      effects: { zoneOutput: 0.12 }, baseMaterial: 'metal_painted_white', faces: { '+Z': { decal: 'chiller_unit_front' }, '-X': { decal: 'chiller_unit_side' }, '+X': { decal: 'chiller_unit_side' } } },
  flowMeter:        { id: 'flowMeter',         name: 'Flow Meter',         zoneType: 'coolingLab',  cost: { funding: 800 },  energyCost: 0.1, spriteColor: 0x55cccc, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.35, visualSubH: 0.4, visualSubL: 0.35, spriteKey: 'flowMeter',        effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'flow_meter_front' } }, stackable: true },
  testChamber:      { id: 'testChamber',       name: 'Test Chamber',       zoneType: 'vacuumLab',   cost: { funding: 15000 },  energyCost: 4.0, spriteColor: 0x8855bb, gridW: 3, gridH: 3, subH: 2, spriteKey: 'testChamber',      effects: { zoneOutput: 0.08 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'test_chamber_front' }, '-X': { decal: 'test_chamber_side' }, '+X': { decal: 'test_chamber_side' } } },
  leakDetector:     { id: 'leakDetector',      name: 'Leak Detector',      zoneType: 'vacuumLab',   cost: { funding: 12000 },  energyCost: 0.8, spriteColor: 0x6644aa, gridW: 2, gridH: 1, subH: 1, visualSubW: 1.3, visualSubH: 0.7, visualSubL: 0.75, spriteKey: 'leakDetector',     effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'leak_detector_front' } }, stackable: true },
  pumpCart:         { id: 'pumpCart',           name: 'Pump Cart',          zoneType: 'vacuumLab',   cost: { funding: 5000 },   energyCost: 2.0, spriteColor: 0x9966cc, gridW: 2, gridH: 1, subH: 2, spriteKey: 'pumpCart',         effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'pump_cart_front' }, '-X': { decal: 'pump_cart_side' }, '+X': { decal: 'pump_cart_side' } } },
  gasManifold:      { id: 'gasManifold',       name: 'Gas Manifold',       zoneType: 'vacuumLab',   cost: { funding: 2000 },  energyCost: 0.5, spriteColor: 0x7755aa, gridW: 3, gridH: 1, subH: 1, spriteKey: 'gasManifold',      effects: { zoneOutput: 0.04 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'gas_manifold_front' } } },
  rga:              { id: 'rga',               name: 'Residual Gas Analyzer', zoneType: 'vacuumLab', cost: { funding: 20000 },  energyCost: 2.5, spriteColor: 0xaa77dd, gridW: 1, gridH: 2, subH: 2, spriteKey: 'rga',              effects: { zoneOutput: 0.10 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'rga_front' }, '-X': { decal: 'rga_side' }, '+X': { decal: 'rga_side' } } },
  lathe: {
    id: 'lathe', name: 'Lathe', zoneType: 'machineShop',
    cost: { funding: 30000 }, energyCost: 5.0, spriteColor: 0x997755,
    gridW: 1, gridH: 4, subH: 2, spriteKey: 'lathe',
    effects: { zoneOutput: 0.05 }, baseMaterial: 'metal_brushed',
    parts: [
      // Chip pan / base tray
      { name: 'pan', x: 0, y: 0, z: 0, w: 1.0, h: 0.15, l: 3.9, color: 0x686c74 },
      // Bed (precision ways — long rail)
      { name: 'bed', x: 0, y: 0.15, z: 0, w: 0.7, h: 0.2, l: 3.8, color: 0x80848c },
      { name: 'bedTop', x: 0, y: 0.35, z: 0, w: 0.72, h: 0.03, l: 3.8, color: 0x98a0ac },
      // Lead screw underneath bed
      { name: 'leadScrew', x: 0.3, y: 0.08, z: 0, w: 0.06, h: 0.06, l: 3.4, color: 0xb0b4bc },
      // Headstock (left end — houses spindle)
      { name: 'headBody', x: 0, y: 0.38, z: -1.6, w: 0.9, h: 1.2, l: 0.7, color: 0x6ab86a },
      { name: 'headTop',  x: 0, y: 1.58, z: -1.6, w: 0.92, h: 0.04, l: 0.72, color: 0x5a9a5a },
      // Spindle nose / chuck
      { name: 'spindleFlange', x: 0, y: 0.9, z: -1.22, w: 0.45, h: 0.45, l: 0.06, color: 0xa0a8b0 },
      { name: 'chuck',   x: 0, y: 0.9, z: -1.15, w: 0.5, h: 0.5, l: 0.12, color: 0x8a8e96 },
      { name: 'jaws1',   x: 0, y: 1.15, z: -1.14, w: 0.08, h: 0.12, l: 0.08, color: 0xb0b4bc },
      { name: 'jaws2',   x: -0.18, y: 0.78, z: -1.14, w: 0.08, h: 0.12, l: 0.08, color: 0xb0b4bc },
      { name: 'jaws3',   x: 0.18, y: 0.78, z: -1.14, w: 0.08, h: 0.12, l: 0.08, color: 0xb0b4bc },
      // Carriage / saddle (rides on bed)
      { name: 'carriage', x: 0, y: 0.38, z: -0.3, w: 0.8, h: 0.3, l: 0.6, color: 0x6ab86a },
      // Cross-slide
      { name: 'crossSlide', x: 0, y: 0.68, z: -0.3, w: 0.55, h: 0.12, l: 0.5, color: 0x70747c },
      // Tool post
      { name: 'toolPost', x: 0, y: 0.8, z: -0.3, w: 0.2, h: 0.2, l: 0.2, color: 0x80848c },
      { name: 'cuttingTool', x: 0.15, y: 0.85, z: -0.3, w: 0.15, h: 0.06, l: 0.06, color: 0xd0d4dc },
      // Tailstock (right end)
      { name: 'tailBase', x: 0, y: 0.38, z: 1.4, w: 0.65, h: 0.35, l: 0.5, color: 0x6ab86a },
      { name: 'tailBody', x: 0, y: 0.73, z: 1.4, w: 0.4, h: 0.4, l: 0.4, color: 0x6ab86a },
      { name: 'tailQuill', x: 0, y: 0.85, z: 1.15, w: 0.08, h: 0.08, l: 0.2, color: 0xb0b4bc },
      // Motor housing behind headstock
      { name: 'motor', x: 0, y: 0.5, z: -1.85, w: 0.6, h: 0.5, l: 0.25, color: 0x70747c },
      // Hand wheels
      { name: 'hwCarriage', x: -0.45, y: 0.5, z: -0.3, w: 0.06, h: 0.25, l: 0.25, color: 0x303038 },
      { name: 'hwTail',     x: 0.25, y: 0.93, z: 1.65, w: 0.2, h: 0.2, l: 0.06, color: 0x303038 },
    ],
  },
  millingMachine: {
    id: 'millingMachine', name: 'Milling Machine', zoneType: 'machineShop',
    cost: { funding: 25000 }, energyCost: 7.0, spriteColor: 0x887766,
    gridW: 2, gridH: 2, subH: 2, spriteKey: 'millingMachine',
    effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_brushed',
    parts: [
      // Heavy base
      { name: 'base', x: 0, y: 0, z: 0, w: 1.8, h: 0.2, l: 1.6, color: 0x686c74 },
      // Column (vertical, rear)
      { name: 'column', x: 0, y: 0.2, z: 0.5, w: 0.8, h: 1.7, l: 0.6, color: 0x6ab86a },
      { name: 'colCap', x: 0, y: 1.9, z: 0.5, w: 0.82, h: 0.04, l: 0.62, color: 0x5a9a5a },
      // Knee (elevating, front of column)
      { name: 'knee', x: 0, y: 0.2, z: -0.1, w: 1.2, h: 0.6, l: 0.7, color: 0x6ab86a },
      // Saddle (on top of knee)
      { name: 'saddle', x: 0, y: 0.8, z: -0.1, w: 1.3, h: 0.12, l: 0.8, color: 0x70747c },
      // Table (X-Y travel, T-slots)
      { name: 'table', x: 0, y: 0.92, z: -0.15, w: 1.9, h: 0.1, l: 0.7, color: 0x80848c },
      { name: 'tableTop', x: 0, y: 1.02, z: -0.15, w: 1.92, h: 0.02, l: 0.72, color: 0x98a0ac },
      // T-slot grooves
      { name: 'slot1', x: 0, y: 1.03, z: -0.35, w: 1.8, h: 0.01, l: 0.04, color: 0x585c64 },
      { name: 'slot2', x: 0, y: 1.03, z: -0.15, w: 1.8, h: 0.01, l: 0.04, color: 0x585c64 },
      { name: 'slot3', x: 0, y: 1.03, z:  0.05, w: 1.8, h: 0.01, l: 0.04, color: 0x585c64 },
      // Head (overarm, spindle housing)
      { name: 'head', x: 0, y: 1.5, z: 0.1, w: 0.6, h: 0.4, l: 0.8, color: 0x6ab86a },
      // Ram / overarm extending forward
      { name: 'ram', x: 0, y: 1.5, z: -0.3, w: 0.35, h: 0.3, l: 0.5, color: 0x6ab86a },
      // Spindle / quill
      { name: 'quill', x: 0, y: 1.2, z: -0.3, w: 0.12, h: 0.3, l: 0.12, color: 0xb0b4bc },
      // Collet/end mill
      { name: 'endmill', x: 0, y: 1.08, z: -0.3, w: 0.04, h: 0.12, l: 0.04, color: 0xd0d4dc },
      // Hand wheels
      { name: 'hwX', x: -0.95, y: 0.85, z: -0.15, w: 0.06, h: 0.2, l: 0.2, color: 0x303038 },
      { name: 'hwY', x: 0, y: 0.85, z: -0.6, w: 0.2, h: 0.2, l: 0.06, color: 0x303038 },
      { name: 'hwZ', x: -0.65, y: 0.4, z: -0.1, w: 0.06, h: 0.2, l: 0.2, color: 0x303038 },
      // Motor on top
      { name: 'motor', x: 0, y: 1.7, z: 0.3, w: 0.35, h: 0.22, l: 0.35, color: 0x70747c },
    ],
  },
  drillPress: {
    id: 'drillPress', name: 'Drill Press', zoneType: 'machineShop',
    cost: { funding: 3000 }, energyCost: 1.5, spriteColor: 0x776655,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'drillPress',
    effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_brushed',
    parts: [
      // Base plate
      { name: 'base', x: 0, y: 0, z: 0, w: 0.9, h: 0.12, l: 0.7, color: 0x686c74 },
      // Column (vertical post)
      { name: 'column', x: 0.2, y: 0.12, z: 0.15, w: 0.14, h: 1.7, l: 0.14, color: 0x8a8e96 },
      // Table (round-ish, adjustable height)
      { name: 'tableArm', x: 0, y: 0.7, z: 0.15, w: 0.5, h: 0.06, l: 0.08, color: 0x686c74 },
      { name: 'table', x: -0.1, y: 0.76, z: 0.05, w: 0.6, h: 0.06, l: 0.6, color: 0x80848c },
      { name: 'tableTop', x: -0.1, y: 0.82, z: 0.05, w: 0.62, h: 0.02, l: 0.62, color: 0x98a0ac },
      // Head / motor housing
      { name: 'head', x: 0, y: 1.5, z: 0.1, w: 0.4, h: 0.3, l: 0.35, color: 0x6ab86a },
      { name: 'headCap', x: 0, y: 1.8, z: 0.1, w: 0.42, h: 0.04, l: 0.37, color: 0x5a9a5a },
      // Pulley cover
      { name: 'pulleyCover', x: 0, y: 1.55, z: 0.15, w: 0.3, h: 0.35, l: 0.15, color: 0x70747c },
      // Quill / spindle
      { name: 'quill', x: 0, y: 1.2, z: 0, w: 0.08, h: 0.3, l: 0.08, color: 0xb0b4bc },
      // Chuck
      { name: 'chuck', x: 0, y: 1.1, z: 0, w: 0.12, h: 0.1, l: 0.12, color: 0x8a8e96 },
      // Drill bit
      { name: 'bit', x: 0, y: 0.88, z: 0, w: 0.025, h: 0.22, l: 0.025, color: 0xd0d4dc },
      // Feed lever handle (3 spokes)
      { name: 'lever1', x: -0.25, y: 1.4, z: -0.15, w: 0.2, h: 0.04, l: 0.04, color: 0x303038 },
      { name: 'lever2', x: -0.28, y: 1.52, z: -0.15, w: 0.2, h: 0.04, l: 0.04, color: 0x303038 },
      // Depth stop
      { name: 'depthRod', x: 0.15, y: 1.25, z: -0.1, w: 0.03, h: 0.3, l: 0.03, color: 0xb0b4bc },
    ],
  },
  toolCabinet: {
    id: 'toolCabinet', name: 'Tool Cabinet', zoneType: 'machineShop',
    cost: { funding: 500 }, energyCost: 0, spriteColor: 0x8a3a2a,
    gridW: 2, gridH: 1, subH: 2, surfaceY: 1.89, spriteKey: 'toolCabinet',
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
  weldingStation: {
    id: 'weldingStation', name: 'Welding Station', zoneType: 'machineShop',
    cost: { funding: 8000 }, energyCost: 8.0, spriteColor: 0xcc7744,
    gridW: 2, gridH: 2, subH: 2, spriteKey: 'weldingStation',
    effects: { zoneOutput: 0.07 }, baseMaterial: 'metal_brushed',
    parts: [
      // Heavy steel welding table with fixture holes
      { name: 'legFL', x: -0.8, y: 0, z: -0.7, w: 0.15, h: 1.0, l: 0.15, material: 'metal_dark' },
      { name: 'legFR', x:  0.8, y: 0, z: -0.7, w: 0.15, h: 1.0, l: 0.15, material: 'metal_dark' },
      { name: 'legBL', x: -0.8, y: 0, z:  0.7, w: 0.15, h: 1.0, l: 0.15, material: 'metal_dark' },
      { name: 'legBR', x:  0.8, y: 0, z:  0.7, w: 0.15, h: 1.0, l: 0.15, material: 'metal_dark' },
      // Cross-braces
      { name: 'braceF', x: 0, y: 0.25, z: -0.7, w: 1.5, h: 0.08, l: 0.08, material: 'metal_dark' },
      { name: 'braceB', x: 0, y: 0.25, z:  0.7, w: 1.5, h: 0.08, l: 0.08, material: 'metal_dark' },
      { name: 'braceL', x: -0.8, y: 0.25, z: 0, w: 0.08, h: 0.08, l: 1.3, material: 'metal_dark' },
      // Lower shelf
      { name: 'shelf', x: 0, y: 0.3, z: 0, w: 1.5, h: 0.06, l: 1.3, color: 0x686c74 },
      // Thick slab top (cast iron style)
      { name: 'slab', x: 0, y: 1.0, z: 0, w: 1.9, h: 0.2, l: 1.8, color: 0x78808c },
      { name: 'slabTop', x: 0, y: 1.2, z: 0, w: 1.92, h: 0.02, l: 1.82, color: 0x8a9098 },
      // Fixture holes pattern (dark dots on surface)
      { name: 'h1', x: -0.6, y: 1.22, z: -0.5, w: 0.06, h: 0.01, l: 0.06, color: 0x50545c },
      { name: 'h2', x:  0.0, y: 1.22, z: -0.5, w: 0.06, h: 0.01, l: 0.06, color: 0x50545c },
      { name: 'h3', x:  0.6, y: 1.22, z: -0.5, w: 0.06, h: 0.01, l: 0.06, color: 0x50545c },
      { name: 'h4', x: -0.6, y: 1.22, z:  0.0, w: 0.06, h: 0.01, l: 0.06, color: 0x50545c },
      { name: 'h5', x:  0.0, y: 1.22, z:  0.0, w: 0.06, h: 0.01, l: 0.06, color: 0x50545c },
      { name: 'h6', x:  0.6, y: 1.22, z:  0.0, w: 0.06, h: 0.01, l: 0.06, color: 0x50545c },
      { name: 'h7', x: -0.6, y: 1.22, z:  0.5, w: 0.06, h: 0.01, l: 0.06, color: 0x50545c },
      { name: 'h8', x:  0.0, y: 1.22, z:  0.5, w: 0.06, h: 0.01, l: 0.06, color: 0x50545c },
      { name: 'h9', x:  0.6, y: 1.22, z:  0.5, w: 0.06, h: 0.01, l: 0.06, color: 0x50545c },
      // Welder unit (box on shelf underneath)
      { name: 'welderBody', x: -0.3, y: 0.36, z: 0.1, w: 0.7, h: 0.45, l: 0.5, color: 0xb85020 },
      { name: 'welderFace', x: -0.3, y: 0.5, z: -0.17, w: 0.66, h: 0.28, l: 0.02, color: 0x903818 },
      { name: 'welderKnob', x: -0.15, y: 0.6, z: -0.19, w: 0.08, h: 0.08, l: 0.04, color: 0x18181c },
      { name: 'welderLed',  x: -0.45, y: 0.65, z: -0.19, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      // Ground clamp on table edge
      { name: 'clamp', x: 0.85, y: 1.22, z: -0.7, w: 0.12, h: 0.08, l: 0.12, color: 0xb85020 },
      // Cable from welder
      { name: 'cable', x: -0.3, y: 0.36, z: -0.2, w: 0.05, h: 0.05, l: 0.4, color: 0x18181c },
    ],
  },
  cncMill: {
    id: 'cncMill', name: 'CNC Mill', zoneType: 'machineShop',
    cost: { funding: 75000 }, energyCost: 4.0, spriteColor: 0x998877,
    gridW: 3, gridH: 2, subH: 2, spriteKey: 'cncMill',
    effects: { zoneOutput: 0.10 }, baseMaterial: 'metal_brushed',
    parts: [
      // Main enclosure body
      { name: 'body', x: 0, y: 0, z: 0, w: 2.9, h: 1.85, l: 1.9, color: 0xe8e8ec },
      { name: 'bodyTrim', x: 0, y: 0, z: 0, w: 2.92, h: 0.08, l: 1.92, color: 0x70747c },
      { name: 'topTrim',  x: 0, y: 1.85, z: 0, w: 2.92, h: 0.08, l: 1.92, color: 0x70747c },
      // Viewing window (front face)
      { name: 'window', x: 0, y: 0.7, z: -0.97, w: 1.4, h: 0.8, l: 0.02, color: 0x2a3a4a },
      { name: 'windowFrame', x: 0, y: 0.7, z: -0.96, w: 1.44, h: 0.84, l: 0.01, color: 0x60646c },
      // Inside visible through window: spindle + table suggestion
      { name: 'innerTable', x: 0, y: 0.4, z: -0.5, w: 1.2, h: 0.08, l: 0.6, color: 0x80848c },
      { name: 'innerSpindle', x: 0, y: 1.1, z: -0.5, w: 0.1, h: 0.35, l: 0.1, color: 0xb0b4bc },
      // Control panel (right side, angled)
      { name: 'ctrlPanel', x: 1.2, y: 0.8, z: -0.8, w: 0.4, h: 1.0, l: 0.3, color: 0x60646c },
      { name: 'ctrlScreen', x: 1.42, y: 1.2, z: -0.8, w: 0.02, h: 0.4, l: 0.25, color: 0x0a2a14 },
      // Control buttons below screen
      { name: 'btn1', x: 1.42, y: 0.95, z: -0.88, w: 0.02, h: 0.06, l: 0.06, color: 0x44ff66 },
      { name: 'btn2', x: 1.42, y: 0.95, z: -0.78, w: 0.02, h: 0.06, l: 0.06, color: 0xff4040 },
      { name: 'btn3', x: 1.42, y: 0.95, z: -0.68, w: 0.02, h: 0.06, l: 0.06, color: 0xffaa40 },
      // Status LEDs
      { name: 'led1', x: 1.42, y: 1.65, z: -0.88, w: 0.02, h: 0.04, l: 0.04, color: 0x44ff66 },
      { name: 'led2', x: 1.42, y: 1.65, z: -0.80, w: 0.02, h: 0.04, l: 0.04, color: 0x44ff66 },
      { name: 'led3', x: 1.42, y: 1.65, z: -0.72, w: 0.02, h: 0.04, l: 0.04, color: 0xffaa40 },
      // Chip conveyor at base front
      { name: 'chipConveyor', x: 0, y: 0.08, z: -0.98, w: 0.8, h: 0.25, l: 0.04, color: 0x686c74 },
      { name: 'chipTray', x: 0, y: 0, z: -1.1, w: 0.6, h: 0.15, l: 0.2, color: 0x80848c },
      // Coolant hose (right side)
      { name: 'hose', x: 1.3, y: 0.1, z: 0.5, w: 0.08, h: 0.08, l: 0.5, color: 0x3060b0 },
      // Warning stripes on enclosure edges
      { name: 'warn1', x: -1.46, y: 0.93, z: -0.97, w: 0.02, h: 1.0, l: 0.02, color: 0xdcb830 },
      { name: 'warn2', x:  1.0, y: 0.93, z: -0.97, w: 0.02, h: 1.0, l: 0.02, color: 0xdcb830 },
    ],
  },
  assemblyCrane: {
    id: 'assemblyCrane', name: 'Assembly Crane', zoneType: 'machineShop',
    cost: { funding: 50000 }, energyCost: 12.0, spriteColor: 0xddaa44,
    gridW: 4, gridH: 4, subH: 5, spriteKey: 'assemblyCrane',
    effects: { zoneOutput: 0.12 }, baseMaterial: 'metal_brushed', hasSurface: false,
    parts: [
      // 4 vertical columns
      { name: 'colFL', x: -1.8, y: 0, z: -1.8, w: 0.25, h: 4.9, l: 0.25, color: 0xdcb830 },
      { name: 'colFR', x:  1.8, y: 0, z: -1.8, w: 0.25, h: 4.9, l: 0.25, color: 0xdcb830 },
      { name: 'colBL', x: -1.8, y: 0, z:  1.8, w: 0.25, h: 4.9, l: 0.25, color: 0xdcb830 },
      { name: 'colBR', x:  1.8, y: 0, z:  1.8, w: 0.25, h: 4.9, l: 0.25, color: 0xdcb830 },
      // Top horizontal bridge beams (X direction)
      { name: 'beamF', x: 0, y: 4.6, z: -1.8, w: 3.8, h: 0.3, l: 0.25, color: 0xdcb830 },
      { name: 'beamB', x: 0, y: 4.6, z:  1.8, w: 3.8, h: 0.3, l: 0.25, color: 0xdcb830 },
      // Bridge girders (Z direction, connecting front/back)
      { name: 'girder1', x: -0.5, y: 4.6, z: 0, w: 0.2, h: 0.3, l: 3.8, color: 0xdcb830 },
      { name: 'girder2', x:  0.5, y: 4.6, z: 0, w: 0.2, h: 0.3, l: 3.8, color: 0xdcb830 },
      // Cross-bracing (diagonal struts on sides)
      { name: 'braceFL', x: -1.8, y: 1.5, z: -0.9, w: 0.08, h: 0.08, l: 2.0, color: 0xb09828 },
      { name: 'braceFR', x:  1.8, y: 1.5, z: -0.9, w: 0.08, h: 0.08, l: 2.0, color: 0xb09828 },
      { name: 'braceBL', x: -1.8, y: 3.0, z:  0.9, w: 0.08, h: 0.08, l: 2.0, color: 0xb09828 },
      { name: 'braceBR', x:  1.8, y: 3.0, z:  0.9, w: 0.08, h: 0.08, l: 2.0, color: 0xb09828 },
      // Trolley (rides on bridge girders)
      { name: 'trolley', x: 0, y: 4.3, z: 0, w: 0.8, h: 0.3, l: 1.2, color: 0x686c74 },
      { name: 'trolleyWheels', x: 0, y: 4.25, z: 0, w: 1.0, h: 0.08, l: 0.2, color: 0x303038 },
      // Hoist motor
      { name: 'hoist', x: 0, y: 4.0, z: 0, w: 0.4, h: 0.3, l: 0.4, color: 0xdcb830 },
      // Cable
      { name: 'cable', x: 0, y: 2.5, z: 0, w: 0.03, h: 1.5, l: 0.03, color: 0x80848c },
      // Hook
      { name: 'hookBlock', x: 0, y: 2.3, z: 0, w: 0.15, h: 0.15, l: 0.15, color: 0x303038 },
      { name: 'hook',      x: 0, y: 2.05, z: 0, w: 0.12, h: 0.25, l: 0.06, color: 0xdcb830 },
      // Warning stripes at base of columns
      { name: 'warnFL', x: -1.8, y: 0, z: -1.8, w: 0.27, h: 0.3, l: 0.27, color: 0x303038 },
      { name: 'warnFR', x:  1.8, y: 0, z: -1.8, w: 0.27, h: 0.3, l: 0.27, color: 0x303038 },
      { name: 'warnBL', x: -1.8, y: 0, z:  1.8, w: 0.27, h: 0.3, l: 0.27, color: 0x303038 },
      { name: 'warnBR', x:  1.8, y: 0, z:  1.8, w: 0.27, h: 0.3, l: 0.27, color: 0x303038 },
    ],
  },
  gasCylinders: {
    id: 'gasCylinders', name: 'Gas Cylinders', zoneType: 'machineShop',
    cost: { funding: 200 }, energyCost: 0, spriteColor: 0x446688,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'gasCylinders',
    effects: { zoneOutput: 0.01 }, baseMaterial: 'metal_brushed',
    parts: [
      // Argon cylinder (tall, dark blue-grey)
      { name: 'argonBody', x: -0.18, y: 0, z: 0, w: 0.28, h: 1.6, l: 0.28, color: 0x3a5a7a },
      { name: 'argonShldr', x: -0.18, y: 1.6, z: 0, w: 0.22, h: 0.12, l: 0.22, color: 0x4a6a8a },
      { name: 'argonValve', x: -0.18, y: 1.72, z: 0, w: 0.1, h: 0.12, l: 0.1, color: 0xb0b4bc },
      { name: 'argonCap',   x: -0.18, y: 1.84, z: 0, w: 0.14, h: 0.06, l: 0.14, color: 0x3a5a7a },
      // CO2 / mix cylinder (shorter, grey)
      { name: 'co2Body', x: 0.18, y: 0, z: 0, w: 0.24, h: 1.3, l: 0.24, color: 0x70747c },
      { name: 'co2Shldr', x: 0.18, y: 1.3, z: 0, w: 0.18, h: 0.1, l: 0.18, color: 0x80848c },
      { name: 'co2Valve', x: 0.18, y: 1.4, z: 0, w: 0.08, h: 0.1, l: 0.08, color: 0xb0b4bc },
      { name: 'co2Cap',   x: 0.18, y: 1.5, z: 0, w: 0.12, h: 0.05, l: 0.12, color: 0x70747c },
      // Regulator on argon (front)
      { name: 'reg', x: -0.18, y: 1.55, z: -0.18, w: 0.1, h: 0.12, l: 0.08, color: 0xb0b4bc },
      { name: 'regGauge', x: -0.18, y: 1.6, z: -0.23, w: 0.07, h: 0.07, l: 0.02, color: 0xe8e8ec },
      // Safety chain across both
      { name: 'chain', x: 0, y: 1.0, z: -0.2, w: 0.5, h: 0.03, l: 0.03, color: 0xa0a4ac },
      // Wall bracket (behind)
      { name: 'bracket', x: 0, y: 0.9, z: 0.22, w: 0.6, h: 0.15, l: 0.06, material: 'metal_dark' },
    ],
  },
  opticalTable: {
    id: 'opticalTable', name: 'Optical Table', zoneType: 'opticsLab',
    cost: { funding: 15000 }, energyCost: 0.5, spriteColor: 0x2a2c34,
    gridW: 4, gridH: 2, subH: 2, surfaceY: 1.87, spriteKey: 'opticalTable',
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
  laserAlignment:   { id: 'laserAlignment',    name: 'Laser Alignment System',  zoneType: 'opticsLab', cost: { funding: 40000 },  energyCost: 2.0, spriteColor: 0xcc4444, gridW: 4, gridH: 1, subH: 2, spriteKey: 'laserAlignment',   effects: { zoneOutput: 0.10, beamPhysics: { emittanceReduction: 0.02 } }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'laser_alignment_front' }, '-X': { decal: 'laser_alignment_side' }, '+X': { decal: 'laser_alignment_side' } }, hasSurface: false },
  mirrorMount:      { id: 'mirrorMount',       name: 'Mirror Mount Station',    zoneType: 'opticsLab', cost: { funding: 500 },  energyCost: 0.1, spriteColor: 0xaaaacc, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.3, visualSubH: 0.6, visualSubL: 0.3, spriteKey: 'mirrorMount',      effects: { zoneOutput: 0.04 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'mirror_mount_front' } }, stackable: true },
  beamProfiler:     { id: 'beamProfiler',      name: 'Beam Profiler',           zoneType: 'opticsLab', cost: { funding: 8000 },  energyCost: 1.0, spriteColor: 0x44cc88, gridW: 2, gridH: 1, subH: 1, visualSubW: 1.3, visualSubH: 0.5, visualSubL: 0.7, spriteKey: 'beamProfiler',     effects: { zoneOutput: 0.07, beamPhysics: { diagnosticAccuracy: 0.05 } }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'beam_profiler_front' } }, stackable: true },
  interferometer:   { id: 'interferometer',     name: 'Interferometer',          zoneType: 'opticsLab', cost: { funding: 30000 },  energyCost: 1.5, spriteColor: 0x8844cc, gridW: 2, gridH: 1, subH: 1, visualSubW: 1.4, visualSubH: 0.6, visualSubL: 0.8, spriteKey: 'interferometer',   effects: { zoneOutput: 0.12 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'interferometer_front' } } },
  photodetector:    { id: 'photodetector',      name: 'Photodetector',           zoneType: 'opticsLab', cost: { funding: 1500 },   energyCost: 0.05, spriteColor: 0x4466aa, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.25, visualSubH: 0.35, visualSubL: 0.25, spriteKey: 'photodetector',    effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'photodetector_front' } } },
  polarizer:        { id: 'polarizer',          name: 'Polarizer Mount',         zoneType: 'opticsLab', cost: { funding: 800 },   energyCost: 0,    spriteColor: 0x9999bb, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.3, visualSubH: 0.5, visualSubL: 0.3, spriteKey: 'polarizer',        effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'polarizer_front' } } },
  fiberCoupler:     { id: 'fiberCoupler',       name: 'Fiber Coupler',           zoneType: 'opticsLab', cost: { funding: 1200 },  energyCost: 0,    spriteColor: 0x336688, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.35, visualSubH: 0.2, visualSubL: 0.25, spriteKey: 'fiberCoupler',     effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'fiber_coupler_front' } } },
  opticalChopper:   { id: 'opticalChopper',     name: 'Optical Chopper',         zoneType: 'opticsLab', cost: { funding: 3000 },  energyCost: 0.2,  spriteColor: 0x556677, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.4, visualSubH: 0.4, visualSubL: 0.35, spriteKey: 'opticalChopper',   effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'optical_chopper_front' } } },
  powerMeter:       { id: 'powerMeter',         name: 'Power Meter',             zoneType: 'opticsLab', cost: { funding: 2500 },   energyCost: 0.1,  spriteColor: 0x445566, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.3, visualSubH: 0.4, visualSubL: 0.2, spriteKey: 'powerMeter',       effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'power_meter_front' } } },
  spatialFilter:    { id: 'spatialFilter',      name: 'Spatial Filter',          zoneType: 'opticsLab', cost: { funding: 600 },   energyCost: 0,    spriteColor: 0x8899aa, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.25, visualSubH: 0.5, visualSubL: 0.25, spriteKey: 'spatialFilter',    effects: { zoneOutput: 0.02 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'spatial_filter_front' } } },
  scopeStation:     { id: 'scopeStation',      name: 'Scope Station',           zoneType: 'diagnosticsLab', cost: { funding: 2000 },  energyCost: 0.2, spriteColor: 0x44aa44, gridW: 1, gridH: 1, subH: 2, visualSubW: 0.9, visualSubH: 1.8, visualSubL: 0.9, spriteKey: 'scopeStation',     effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_painted_white', faces: { '+Z': { decal: 'scope_station_front' } }, stackable: true },
  wireScannerBench: { id: 'wireScannerBench',  name: 'Wire Scanner Readout',    zoneType: 'diagnosticsLab', cost: { funding: 5000 },  energyCost: 1.5, spriteColor: 0x888888, gridW: 1, gridH: 1, subH: 1, visualSubW: 1.6, visualSubH: 0.8, visualSubL: 1.0, spriteKey: 'wireScannerBench', effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_brushed', faces: { '+Z': { decal: 'wire_scanner_bench_front' }, '-X': { decal: 'wire_scanner_bench_side' }, '+X': { decal: 'wire_scanner_bench_side' } } },
  bpmTestFixture:   { id: 'bpmTestFixture',    name: 'BPM Electronics',         zoneType: 'diagnosticsLab', cost: { funding: 10000 },  energyCost: 1.0, spriteColor: 0xcccc44, gridW: 1, gridH: 1, subH: 1, visualSubW: 1.8, visualSubH: 1.0, visualSubL: 1.0, spriteKey: 'bpmTestFixture',   effects: { zoneOutput: 0.08 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'bpm_test_fixture_front' }, '-X': { decal: 'bpm_test_fixture_side' }, '+X': { decal: 'bpm_test_fixture_side' } } },
  daqRack: {
    id: 'daqRack', name: 'DAQ Rack', zoneType: 'diagnosticsLab',
    cost: { funding: 15000 }, energyCost: 1.5, spriteColor: 0x2a2c30,
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
  serverCluster:    { id: 'serverCluster',     name: 'Server Cluster',          zoneType: 'diagnosticsLab', cost: { funding: 50000 },  energyCost: 5.0, spriteColor: 0x448844, gridW: 3, gridH: 2, subH: 5, spriteKey: 'serverCluster',    effects: { research: 0.08 }, baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'server_cluster_front' }, '-X': { decal: 'server_cluster_side' }, '+X': { decal: 'server_cluster_side' } } },
  toolChest:        { id: 'toolChest',         name: 'Tool Chest',         zoneType: 'maintenance', cost: { funding: 2000 },   energyCost: 0,   spriteColor: 0xbb7744, gridW: 2, gridH: 1, subH: 2, spriteKey: 'toolChest',        effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_dark' },
  partsShelf: {
    id: 'partsShelf', name: 'Parts Shelf', zoneType: 'maintenance',
    cost: { funding: 300 }, energyCost: 0, spriteColor: 0x6a5838,
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
    cost: { funding: 200 }, energyCost: 0, spriteColor: 0xb8bac2,
    gridW: 2, gridH: 1, subH: 2, surfaceY: 1.71, spriteKey: 'workCart',
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
  craneHoist:       { id: 'craneHoist',        name: 'Crane Hoist',        zoneType: 'maintenance', cost: { funding: 40000 },  energyCost: 12.0, spriteColor: 0xddaa44, gridW: 4, gridH: 4, subH: 5, spriteKey: 'craneHoist',       effects: { zoneOutput: 0.10 }, baseMaterial: 'metal_brushed', hasSurface: false },
};
