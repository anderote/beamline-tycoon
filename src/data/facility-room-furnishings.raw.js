// Facility room furnishings — items placed inside room zones (control room, office, meeting room, cafeteria).
export const FACILITY_ROOM_FURNISHINGS_RAW = {
  desk: {
    id: 'desk', name: 'Desk', zoneType: 'officeSpace',
    cost: { funding: 500 }, energyCost: 0.2, spriteColor: 0x7a6a4a,
    gridW: 3, gridH: 2, subH: 2, surfaceY: 1.5, spriteKey: 'desk',
    effects: { morale: 1 }, baseMaterial: 'tile_hardwood',
    // 3×2 footprint. Desk height ~75cm = 1.5 subtiles. Four-leg design
    // with modesty panel and a drawer pedestal on one side.
    parts: [
      // Four legs
      { name: 'legFL', x: -1.4, y: 0, z: -0.9, w: 0.14, h: 1.4, l: 0.14, material: 'metal_dark' },
      { name: 'legFR', x:  1.4, y: 0, z: -0.9, w: 0.14, h: 1.4, l: 0.14, material: 'metal_dark' },
      { name: 'legBL', x: -1.4, y: 0, z:  0.9, w: 0.14, h: 1.4, l: 0.14, material: 'metal_dark' },
      { name: 'legBR', x:  1.4, y: 0, z:  0.9, w: 0.14, h: 1.4, l: 0.14, material: 'metal_dark' },
      // Tabletop
      { name: 'top', x: 0, y: 1.4, z: 0, w: 3.0, h: 0.1, l: 2.0, material: 'tile_hardwood' },
      // Modesty panel at back
      { name: 'modesty', x: 0, y: 0.5, z: 0.92, w: 2.7, h: 0.9, l: 0.06, material: 'tile_hardwood' },
      // Drawer pedestal under the right side
      { name: 'drawerBody', x: 1.0, y: 0.1, z: 0, w: 0.8, h: 1.25, l: 1.5, material: 'tile_hardwood' },
      { name: 'drawerFront1', x: 1.0, y: 1.0, z: -0.78, w: 0.7, h: 0.28, l: 0.02, color: 0x4a3a22 },
      { name: 'drawerFront2', x: 1.0, y: 0.65, z: -0.78, w: 0.7, h: 0.28, l: 0.02, color: 0x4a3a22 },
      { name: 'drawerFront3', x: 1.0, y: 0.2, z: -0.78, w: 0.7, h: 0.38, l: 0.02, color: 0x4a3a22 },
      { name: 'pull1', x: 1.0, y: 1.13, z: -0.8, w: 0.18, h: 0.04, l: 0.04, color: 0xb0a080 },
      { name: 'pull2', x: 1.0, y: 0.78, z: -0.8, w: 0.18, h: 0.04, l: 0.04, color: 0xb0a080 },
      { name: 'pull3', x: 1.0, y: 0.38, z: -0.8, w: 0.18, h: 0.04, l: 0.04, color: 0xb0a080 },
    ],
  },
  filingCabinet: {
    id: 'filingCabinet', name: 'Filing Cabinet', zoneType: 'officeSpace',
    cost: { funding: 200 }, energyCost: 0, spriteColor: 0x8a8c94,
    gridW: 1, gridH: 1, subH: 3, surfaceY: 2.95, spriteKey: 'filingCabinet',
    effects: {}, baseMaterial: 'metal_painted_white',
    // 1×1 footprint, 1.5 m tall. 4-drawer lateral file cabinet.
    parts: [
      // Body
      { name: 'body', x: 0, y: 0, z: 0, w: 0.9, h: 2.9, l: 0.9, material: 'metal_painted_white' },
      // Thin top cap
      { name: 'topCap', x: 0, y: 2.9, z: 0, w: 0.95, h: 0.05, l: 0.95, material: 'metal_dark' },
      // 4 drawer faces
      { name: 'd1', x: 0, y: 2.2, z: -0.46, w: 0.82, h: 0.6, l: 0.02, color: 0x787a82 },
      { name: 'd2', x: 0, y: 1.5, z: -0.46, w: 0.82, h: 0.6, l: 0.02, color: 0x787a82 },
      { name: 'd3', x: 0, y: 0.8, z: -0.46, w: 0.82, h: 0.6, l: 0.02, color: 0x787a82 },
      { name: 'd4', x: 0, y: 0.1, z: -0.46, w: 0.82, h: 0.6, l: 0.02, color: 0x787a82 },
      // Pulls
      { name: 'p1', x: 0, y: 2.5, z: -0.48, w: 0.3, h: 0.05, l: 0.05, color: 0xc4c8d0 },
      { name: 'p2', x: 0, y: 1.8, z: -0.48, w: 0.3, h: 0.05, l: 0.05, color: 0xc4c8d0 },
      { name: 'p3', x: 0, y: 1.1, z: -0.48, w: 0.3, h: 0.05, l: 0.05, color: 0xc4c8d0 },
      { name: 'p4', x: 0, y: 0.4, z: -0.48, w: 0.3, h: 0.05, l: 0.05, color: 0xc4c8d0 },
      // Label strips
      { name: 'l1', x: 0, y: 2.36, z: -0.48, w: 0.28, h: 0.08, l: 0.01, color: 0xfaf4e0 },
      { name: 'l2', x: 0, y: 1.66, z: -0.48, w: 0.28, h: 0.08, l: 0.01, color: 0xfaf4e0 },
      { name: 'l3', x: 0, y: 0.96, z: -0.48, w: 0.28, h: 0.08, l: 0.01, color: 0xfaf4e0 },
      { name: 'l4', x: 0, y: 0.26, z: -0.48, w: 0.28, h: 0.08, l: 0.01, color: 0xfaf4e0 },
    ],
  },
  whiteboard:       { id: 'whiteboard',        name: 'Whiteboard',         zoneType: 'officeSpace', cost: { funding: 150 },   energyCost: 0,   spriteColor: 0xddddee, gridW: 3, gridH: 1, subH: 3, visualSubW: 2.8, visualSubH: 2.4, visualSubL: 0.15, spriteKey: 'whiteboard',       effects: { research: 0.02 }, baseMaterial: 'metal_painted_white' },
  coffeeMachine:    { id: 'coffeeMachine',     name: 'Coffee Machine',     zoneType: 'officeSpace', cost: { funding: 200 },   energyCost: 0.2, spriteColor: 0x664433, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.5, visualSubH: 0.75, visualSubL: 0.7, spriteKey: 'coffeeMachine',    effects: { morale: 2 }, baseMaterial: 'metal_dark', stackable: true },
  workstation: {
    id: 'workstation', name: 'Workstation', zoneType: 'officeSpace',
    cost: { funding: 2500 }, energyCost: 0.5, spriteColor: 0x44aa66,
    gridW: 3, gridH: 2, subH: 3, surfaceY: 1.5, spriteKey: 'workstation',
    effects: { morale: 2, research: 0.02 }, baseMaterial: 'tile_hardwood',
    // 3×2 footprint. Desk with monitor, keyboard, mouse, and desktop tower.
    parts: [
      // Desk legs
      { name: 'legFL', x: -1.4, y: 0, z: -0.9, w: 0.12, h: 1.4, l: 0.12, material: 'metal_dark' },
      { name: 'legFR', x:  1.4, y: 0, z: -0.9, w: 0.12, h: 1.4, l: 0.12, material: 'metal_dark' },
      { name: 'legBL', x: -1.4, y: 0, z:  0.9, w: 0.12, h: 1.4, l: 0.12, material: 'metal_dark' },
      { name: 'legBR', x:  1.4, y: 0, z:  0.9, w: 0.12, h: 1.4, l: 0.12, material: 'metal_dark' },
      // Tabletop
      { name: 'top', x: 0, y: 1.4, z: 0, w: 3.0, h: 0.08, l: 2.0, material: 'tile_hardwood' },
      // Modesty panel at back
      { name: 'modesty', x: 0, y: 0.5, z: 0.92, w: 2.7, h: 0.9, l: 0.06, material: 'tile_hardwood' },
      // Monitor — stand + screen
      { name: 'monStand', x: 0, y: 1.48, z: 0.3, w: 0.25, h: 0.06, l: 0.2, color: 0x2a2c34 },
      { name: 'monNeck', x: 0, y: 1.54, z: 0.35, w: 0.08, h: 0.5, l: 0.08, color: 0x2a2c34 },
      { name: 'monBezel', x: 0, y: 2.04, z: 0.38, w: 1.2, h: 0.75, l: 0.06, color: 0x2a2c34 },
      { name: 'monScreen', x: 0, y: 2.08, z: 0.36, w: 1.1, h: 0.65, l: 0.02, color: 0x1a3a5a },
      // Keyboard
      { name: 'keyboard', x: -0.1, y: 1.50, z: -0.3, w: 0.9, h: 0.03, l: 0.28, color: 0x303640 },
      // Mouse + pad
      { name: 'mousePad', x: 0.65, y: 1.49, z: -0.3, w: 0.4, h: 0.02, l: 0.35, color: 0x222228 },
      { name: 'mouse', x: 0.65, y: 1.51, z: -0.3, w: 0.12, h: 0.04, l: 0.18, color: 0x383c44 },
      // Desktop tower (under desk, right side)
      { name: 'tower', x: 1.0, y: 0.05, z: 0.2, w: 0.4, h: 0.9, l: 0.7, color: 0x303640 },
      { name: 'towerFront', x: 1.0, y: 0.05, z: -0.16, w: 0.36, h: 0.86, l: 0.02, color: 0x3a3e48 },
      { name: 'towerLed', x: 0.88, y: 0.7, z: -0.18, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
    ],
  },
  pottedPlant: {
    id: 'pottedPlant', name: 'Potted Plant', zoneType: 'officeSpace',
    cost: { funding: 80 }, energyCost: 0, spriteColor: 0x338844,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'pottedPlant',
    effects: { morale: 1 }, baseMaterial: 'metal_dark',
    // 1×1 footprint. Tall potted office plant — ceramic pot with leafy plant.
    parts: [
      // Pot
      { name: 'potBase', x: 0, y: 0, z: 0, w: 0.55, h: 0.06, l: 0.55, color: 0x8a6a4a },
      { name: 'pot', x: 0, y: 0.06, z: 0, w: 0.6, h: 0.55, l: 0.6, color: 0x9a7a5a },
      { name: 'potRim', x: 0, y: 0.61, z: 0, w: 0.65, h: 0.06, l: 0.65, color: 0x8a6a4a },
      // Soil
      { name: 'soil', x: 0, y: 0.58, z: 0, w: 0.5, h: 0.06, l: 0.5, color: 0x3a2a1a },
      // Trunk/stem
      { name: 'stem', x: 0, y: 0.64, z: 0, w: 0.08, h: 0.6, l: 0.08, color: 0x5a4a2a },
      // Foliage clusters (green blobs at various heights)
      { name: 'leaf1', x: -0.2, y: 1.1, z: -0.15, w: 0.35, h: 0.3, l: 0.3, color: 0x338844 },
      { name: 'leaf2', x:  0.2, y: 1.3, z:  0.1, w: 0.3, h: 0.35, l: 0.35, color: 0x2a7a3a },
      { name: 'leaf3', x: -0.1, y: 1.5, z:  0.15, w: 0.3, h: 0.25, l: 0.3, color: 0x3a9a4a },
      { name: 'leaf4', x:  0.1, y: 1.6, z: -0.1, w: 0.25, h: 0.3, l: 0.25, color: 0x2e8838 },
    ],
  },
  floorPlant: {
    id: 'floorPlant', name: 'Floor Plant', zoneType: 'officeSpace',
    cost: { funding: 150 }, energyCost: 0, spriteColor: 0x2a7a3a,
    gridW: 1, gridH: 1, subH: 3, spriteKey: 'floorPlant',
    effects: { morale: 2 }, baseMaterial: 'metal_dark',
    // 1×1 footprint, tall. Large floor planter with a ficus-style tree.
    parts: [
      // Square planter box
      { name: 'planter', x: 0, y: 0, z: 0, w: 0.7, h: 0.6, l: 0.7, color: 0x606468 },
      { name: 'planterRim', x: 0, y: 0.6, z: 0, w: 0.75, h: 0.05, l: 0.75, color: 0x505458 },
      { name: 'soil', x: 0, y: 0.55, z: 0, w: 0.6, h: 0.08, l: 0.6, color: 0x3a2a1a },
      // Trunk
      { name: 'trunk', x: 0, y: 0.6, z: 0, w: 0.12, h: 1.4, l: 0.12, color: 0x5a4a2a },
      // Canopy (larger leaf clusters)
      { name: 'canopy1', x: -0.25, y: 1.8, z: -0.2, w: 0.45, h: 0.4, l: 0.4, color: 0x2a7a3a },
      { name: 'canopy2', x:  0.2, y: 2.1, z:  0.15, w: 0.5, h: 0.45, l: 0.45, color: 0x338844 },
      { name: 'canopy3', x: -0.1, y: 2.4, z:  0.1, w: 0.4, h: 0.35, l: 0.4, color: 0x3a9a4a },
      { name: 'canopy4', x:  0.1, y: 2.6, z: -0.1, w: 0.35, h: 0.3, l: 0.35, color: 0x2e8838 },
    ],
  },
  faxMachine: {
    id: 'faxMachine', name: 'Fax Machine', zoneType: 'officeSpace',
    cost: { funding: 100 }, energyCost: 0.1, spriteColor: 0x888888,
    gridW: 1, gridH: 1, subH: 1, visualSubW: 0.8, visualSubH: 0.5, visualSubL: 0.6,
    spriteKey: 'faxMachine', effects: {}, baseMaterial: 'metal_painted_white', stackable: true,
    // Compact fax/printer — boxy body with paper tray and control panel.
    parts: [
      // Main body
      { name: 'body', x: 0, y: 0, z: 0, w: 0.8, h: 0.35, l: 0.6, color: 0xd8dae0 },
      // Paper input tray (angled at back)
      { name: 'tray', x: 0, y: 0.35, z: 0.18, w: 0.6, h: 0.2, l: 0.25, color: 0xc8cad0 },
      // Paper output slot (front)
      { name: 'slot', x: 0, y: 0.22, z: -0.31, w: 0.55, h: 0.04, l: 0.02, color: 0x282828 },
      // Control panel (buttons/display)
      { name: 'panel', x: 0.15, y: 0.36, z: -0.1, w: 0.4, h: 0.04, l: 0.25, color: 0x404448 },
      // Small LCD display
      { name: 'lcd', x: 0.15, y: 0.37, z: -0.18, w: 0.2, h: 0.03, l: 0.08, color: 0x88cc88 },
      // Buttons row
      { name: 'btn1', x: -0.02, y: 0.37, z: -0.02, w: 0.06, h: 0.03, l: 0.06, color: 0x606060 },
      { name: 'btn2', x:  0.08, y: 0.37, z: -0.02, w: 0.06, h: 0.03, l: 0.06, color: 0x606060 },
      { name: 'btn3', x:  0.32, y: 0.37, z: -0.02, w: 0.06, h: 0.03, l: 0.06, color: 0x44aa44 },
    ],
  },
  receptionDesk: {
    id: 'receptionDesk', name: 'Reception Desk', zoneType: 'officeSpace',
    cost: { funding: 3000 }, energyCost: 0.3, spriteColor: 0x6a5a3a,
    gridW: 4, gridH: 2, subH: 3, surfaceY: 1.5, spriteKey: 'receptionDesk',
    effects: { morale: 3 }, baseMaterial: 'tile_hardwood',
    // 4×2 footprint. L-shaped reception counter with a tall front panel,
    // lower work surface behind, and a small monitor.
    parts: [
      // Front counter panel (tall, visitor-facing)
      { name: 'frontPanel', x: 0, y: 0, z: -0.85, w: 4.0, h: 2.2, l: 0.15, material: 'tile_hardwood' },
      // Counter top (visitor side — narrow ledge on front)
      { name: 'counterTop', x: 0, y: 2.2, z: -0.6, w: 4.0, h: 0.08, l: 0.6, color: 0x4a3a22 },
      // Work surface behind (lower, for the receptionist)
      { name: 'workTop', x: 0, y: 1.4, z: 0.4, w: 3.8, h: 0.08, l: 1.1, material: 'tile_hardwood' },
      // Side panels
      { name: 'sideL', x: -1.95, y: 0, z: 0, w: 0.1, h: 2.2, l: 2.0, material: 'tile_hardwood' },
      { name: 'sideR', x:  1.95, y: 0, z: 0, w: 0.1, h: 2.2, l: 2.0, material: 'tile_hardwood' },
      // Kick plate
      { name: 'kick', x: 0, y: 0, z: -0.88, w: 3.8, h: 0.1, l: 0.02, color: 0x303030 },
      // Monitor on work surface
      { name: 'monStand', x: -0.5, y: 1.48, z: 0.3, w: 0.2, h: 0.04, l: 0.15, color: 0x2a2c34 },
      { name: 'monNeck', x: -0.5, y: 1.52, z: 0.32, w: 0.06, h: 0.35, l: 0.06, color: 0x2a2c34 },
      { name: 'monBezel', x: -0.5, y: 1.87, z: 0.34, w: 0.9, h: 0.6, l: 0.05, color: 0x2a2c34 },
      { name: 'monScreen', x: -0.5, y: 1.9, z: 0.32, w: 0.82, h: 0.5, l: 0.02, color: 0x1a3a5a },
      // Keyboard on work surface
      { name: 'keyboard', x: -0.5, y: 1.49, z: -0.05, w: 0.7, h: 0.03, l: 0.22, color: 0x303640 },
      // Decorative sign strip on front
      { name: 'sign', x: 0, y: 1.6, z: -0.89, w: 1.5, h: 0.2, l: 0.02, color: 0xb0a080 },
    ],
  },
  coffeeTable: {
    id: 'coffeeTable', name: 'Coffee Table', zoneType: 'officeSpace',
    cost: { funding: 300 }, energyCost: 0, spriteColor: 0x8a7a5a,
    gridW: 2, gridH: 2, subH: 1, surfaceY: 0.9, spriteKey: 'coffeeTable',
    effects: { morale: 1 }, baseMaterial: 'tile_hardwood',
    // 2×2 footprint. Low coffee table — simple slab top on short legs.
    parts: [
      // Four short legs
      { name: 'legFL', x: -0.8, y: 0, z: -0.8, w: 0.1, h: 0.8, l: 0.1, material: 'tile_hardwood' },
      { name: 'legFR', x:  0.8, y: 0, z: -0.8, w: 0.1, h: 0.8, l: 0.1, material: 'tile_hardwood' },
      { name: 'legBL', x: -0.8, y: 0, z:  0.8, w: 0.1, h: 0.8, l: 0.1, material: 'tile_hardwood' },
      { name: 'legBR', x:  0.8, y: 0, z:  0.8, w: 0.1, h: 0.8, l: 0.1, material: 'tile_hardwood' },
      // Tabletop
      { name: 'top', x: 0, y: 0.8, z: 0, w: 2.0, h: 0.08, l: 2.0, material: 'tile_hardwood' },
    ],
  },
  couch: {
    id: 'couch', name: 'Couch', zoneType: 'officeSpace',
    cost: { funding: 1200 }, energyCost: 0, spriteColor: 0x4a5a7a,
    gridW: 3, gridH: 1, subH: 2, spriteKey: 'couch',
    effects: { morale: 3 }, baseMaterial: 'metal_dark',
    // 3×1 footprint. Three-seat office sofa — boxy upholstered frame.
    parts: [
      // Base frame (dark)
      { name: 'base', x: 0, y: 0, z: 0, w: 3.0, h: 0.15, l: 1.0, color: 0x303030 },
      // Seat cushion
      { name: 'seat', x: 0, y: 0.15, z: -0.08, w: 2.8, h: 0.4, l: 0.85, color: 0x4a5a7a },
      // Backrest
      { name: 'back', x: 0, y: 0.55, z: 0.35, w: 2.8, h: 0.9, l: 0.3, color: 0x4a5a7a },
      // Left armrest
      { name: 'armL', x: -1.35, y: 0.15, z: 0, w: 0.2, h: 0.65, l: 0.95, color: 0x4a5a7a },
      // Right armrest
      { name: 'armR', x:  1.35, y: 0.15, z: 0, w: 0.2, h: 0.65, l: 0.95, color: 0x4a5a7a },
      // Seat cushion dividers (subtle lines)
      { name: 'div1', x: -0.47, y: 0.55, z: -0.08, w: 0.02, h: 0.02, l: 0.8, color: 0x3a4a6a },
      { name: 'div2', x:  0.47, y: 0.55, z: -0.08, w: 0.02, h: 0.02, l: 0.8, color: 0x3a4a6a },
      // Small feet (4)
      { name: 'footFL', x: -1.3, y: 0, z: -0.4, w: 0.08, h: 0.06, l: 0.08, color: 0x222222 },
      { name: 'footFR', x:  1.3, y: 0, z: -0.4, w: 0.08, h: 0.06, l: 0.08, color: 0x222222 },
      { name: 'footBL', x: -1.3, y: 0, z:  0.4, w: 0.08, h: 0.06, l: 0.08, color: 0x222222 },
      { name: 'footBR', x:  1.3, y: 0, z:  0.4, w: 0.08, h: 0.06, l: 0.08, color: 0x222222 },
    ],
  },
  bookshelf: {
    id: 'bookshelf', name: 'Bookshelf', zoneType: 'officeSpace',
    cost: { funding: 350 }, energyCost: 0, spriteColor: 0x7a6a4a,
    gridW: 2, gridH: 1, subH: 4, spriteKey: 'bookshelf',
    effects: { morale: 1, research: 0.01 }, baseMaterial: 'tile_hardwood',
    // 2×1 footprint, ~2m tall. Open bookshelf with 4 shelves of books.
    parts: [
      // Side panels
      { name: 'sideL', x: -0.95, y: 0, z: 0, w: 0.06, h: 3.8, l: 0.8, material: 'tile_hardwood' },
      { name: 'sideR', x:  0.95, y: 0, z: 0, w: 0.06, h: 3.8, l: 0.8, material: 'tile_hardwood' },
      // Back panel
      { name: 'backPanel', x: 0, y: 0, z: 0.38, w: 1.84, h: 3.8, l: 0.04, material: 'tile_hardwood' },
      // Top cap
      { name: 'topCap', x: 0, y: 3.8, z: 0, w: 2.0, h: 0.06, l: 0.84, material: 'tile_hardwood' },
      // 4 shelves
      { name: 'shelf1', x: 0, y: 0.0,  z: 0, w: 1.84, h: 0.06, l: 0.76, material: 'tile_hardwood' },
      { name: 'shelf2', x: 0, y: 0.95, z: 0, w: 1.84, h: 0.06, l: 0.76, material: 'tile_hardwood' },
      { name: 'shelf3', x: 0, y: 1.9,  z: 0, w: 1.84, h: 0.06, l: 0.76, material: 'tile_hardwood' },
      { name: 'shelf4', x: 0, y: 2.85, z: 0, w: 1.84, h: 0.06, l: 0.76, material: 'tile_hardwood' },
      // Books on shelf 1
      { name: 'bk1a', x: -0.6, y: 0.06, z: 0, w: 0.12, h: 0.8, l: 0.55, color: 0x8a2222 },
      { name: 'bk1b', x: -0.4, y: 0.06, z: 0, w: 0.14, h: 0.75, l: 0.55, color: 0x224488 },
      { name: 'bk1c', x: -0.2, y: 0.06, z: 0, w: 0.1,  h: 0.82, l: 0.55, color: 0x228844 },
      { name: 'bk1d', x:  0.0, y: 0.06, z: 0, w: 0.16, h: 0.7,  l: 0.55, color: 0x886622 },
      { name: 'bk1e', x:  0.2, y: 0.06, z: 0, w: 0.1,  h: 0.78, l: 0.55, color: 0x662288 },
      { name: 'bk1f', x:  0.4, y: 0.06, z: 0, w: 0.14, h: 0.83, l: 0.55, color: 0x444444 },
      // Books on shelf 2
      { name: 'bk2a', x: -0.5, y: 1.01, z: 0, w: 0.18, h: 0.78, l: 0.55, color: 0x226688 },
      { name: 'bk2b', x: -0.25, y: 1.01, z: 0, w: 0.12, h: 0.82, l: 0.55, color: 0x882244 },
      { name: 'bk2c', x:  0.05, y: 1.01, z: 0, w: 0.14, h: 0.72, l: 0.55, color: 0x448822 },
      { name: 'bk2d', x:  0.35, y: 1.01, z: 0, w: 0.1,  h: 0.8,  l: 0.55, color: 0x884400 },
      // Books on shelf 3
      { name: 'bk3a', x: -0.55, y: 1.96, z: 0, w: 0.14, h: 0.76, l: 0.55, color: 0x664422 },
      { name: 'bk3b', x: -0.3,  y: 1.96, z: 0, w: 0.16, h: 0.8,  l: 0.55, color: 0x2244aa },
      { name: 'bk3c', x:  0.0,  y: 1.96, z: 0, w: 0.12, h: 0.84, l: 0.55, color: 0xaa4422 },
      { name: 'bk3d', x:  0.25, y: 1.96, z: 0, w: 0.14, h: 0.74, l: 0.55, color: 0x446644 },
      { name: 'bk3e', x:  0.5,  y: 1.96, z: 0, w: 0.1,  h: 0.82, l: 0.55, color: 0x884488 },
      // Books on shelf 4 (fewer — top shelf)
      { name: 'bk4a', x: -0.4, y: 2.91, z: 0, w: 0.16, h: 0.7, l: 0.55, color: 0x335588 },
      { name: 'bk4b', x: -0.15, y: 2.91, z: 0, w: 0.12, h: 0.75, l: 0.55, color: 0x885522 },
    ],
  },
  printer: {
    id: 'printer', name: 'Office Printer', zoneType: 'officeSpace',
    cost: { funding: 800 }, energyCost: 0.2, spriteColor: 0xa0a4ac,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'printer',
    effects: {}, baseMaterial: 'metal_painted_white',
    // 1×1 footprint. Floor-standing office laser printer on a small stand.
    parts: [
      // Stand/table
      { name: 'standLegFL', x: -0.35, y: 0, z: -0.35, w: 0.06, h: 0.7, l: 0.06, color: 0x505050 },
      { name: 'standLegFR', x:  0.35, y: 0, z: -0.35, w: 0.06, h: 0.7, l: 0.06, color: 0x505050 },
      { name: 'standLegBL', x: -0.35, y: 0, z:  0.35, w: 0.06, h: 0.7, l: 0.06, color: 0x505050 },
      { name: 'standLegBR', x:  0.35, y: 0, z:  0.35, w: 0.06, h: 0.7, l: 0.06, color: 0x505050 },
      { name: 'standTop', x: 0, y: 0.7, z: 0, w: 0.85, h: 0.04, l: 0.85, color: 0x606468 },
      // Printer body
      { name: 'body', x: 0, y: 0.74, z: 0, w: 0.8, h: 0.65, l: 0.75, color: 0xd8dae0 },
      // Paper tray (front, slightly protruding)
      { name: 'tray', x: 0, y: 0.76, z: -0.4, w: 0.6, h: 0.15, l: 0.12, color: 0xc0c4cc },
      // Output tray on top
      { name: 'outTray', x: 0, y: 1.39, z: -0.1, w: 0.65, h: 0.03, l: 0.35, color: 0xc8cad0 },
      // Control panel
      { name: 'panel', x: 0.2, y: 1.39, z: -0.32, w: 0.3, h: 0.06, l: 0.15, color: 0x383c44 },
      { name: 'lcd', x: 0.2, y: 1.40, z: -0.38, w: 0.18, h: 0.04, l: 0.02, color: 0x88bbdd },
    ],
  },
  monitorBank: {
    id: 'monitorBank', name: 'Monitor Bank', zoneType: 'controlRoom',
    cost: { funding: 8000 }, energyCost: 0.8, spriteColor: 0x44bb66,
    gridW: 4, gridH: 2, subH: 3, spriteKey: 'monitorBank',
    effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_painted_white',
    // 4×2 footprint. Wall-mount frame holding a 3×2 grid of flat-panel monitors
    // with colorful live displays (beam orbits, status, trending).
    parts: [
      // Mounting frame (white wall bracket)
      { name: 'frame', x: 0, y: 0, z: 0.8, w: 3.9, h: 3.0, l: 0.12, material: 'metal_painted_white' },
      // Frame trim strip along top
      { name: 'topTrim', x: 0, y: 3.0, z: 0.8, w: 3.95, h: 0.06, l: 0.16, color: 0xb0b4bc },
      // Bottom row — 3 monitors
      { name: 'mon1', x: -1.25, y: 0.15, z: 0.72, w: 1.15, h: 1.3, l: 0.06, color: 0x2a2c34 },
      { name: 'mon2', x:  0.0,  y: 0.15, z: 0.72, w: 1.15, h: 1.3, l: 0.06, color: 0x2a2c34 },
      { name: 'mon3', x:  1.25, y: 0.15, z: 0.72, w: 1.15, h: 1.3, l: 0.06, color: 0x2a2c34 },
      // Bottom row screens — orbit plot (green), beam current (cyan), status table (blue)
      { name: 'scr1', x: -1.25, y: 0.2, z: 0.68, w: 1.05, h: 1.2, l: 0.02, color: 0x0c4820 },
      { name: 'scr2', x:  0.0,  y: 0.2, z: 0.68, w: 1.05, h: 1.2, l: 0.02, color: 0x0c3848 },
      { name: 'scr3', x:  1.25, y: 0.2, z: 0.68, w: 1.05, h: 1.2, l: 0.02, color: 0x182858 },
      // Bright trace lines on screens
      { name: 'trace1', x: -1.25, y: 0.7, z: 0.66, w: 0.9, h: 0.03, l: 0.01, color: 0x44ff66 },
      { name: 'trace2', x:  0.0,  y: 0.6, z: 0.66, w: 0.9, h: 0.03, l: 0.01, color: 0x44ddff },
      { name: 'trace3', x:  1.25, y: 0.5, z: 0.66, w: 0.9, h: 0.03, l: 0.01, color: 0x6688ff },
      // Top row — 3 monitors
      { name: 'mon4', x: -1.25, y: 1.55, z: 0.72, w: 1.15, h: 1.3, l: 0.06, color: 0x2a2c34 },
      { name: 'mon5', x:  0.0,  y: 1.55, z: 0.72, w: 1.15, h: 1.3, l: 0.06, color: 0x2a2c34 },
      { name: 'mon6', x:  1.25, y: 1.55, z: 0.72, w: 1.15, h: 1.3, l: 0.06, color: 0x2a2c34 },
      // Top row screens — alarm summary (red tint), trending (green), beam profile (purple)
      { name: 'scr4', x: -1.25, y: 1.6, z: 0.68, w: 1.05, h: 1.2, l: 0.02, color: 0x401818 },
      { name: 'scr5', x:  0.0,  y: 1.6, z: 0.68, w: 1.05, h: 1.2, l: 0.02, color: 0x0c4820 },
      { name: 'scr6', x:  1.25, y: 1.6, z: 0.68, w: 1.05, h: 1.2, l: 0.02, color: 0x281848 },
      // More bright traces on top screens
      { name: 'trace4', x: -1.25, y: 2.0, z: 0.66, w: 0.9, h: 0.03, l: 0.01, color: 0xff4444 },
      { name: 'trace5', x:  0.0,  y: 2.1, z: 0.66, w: 0.9, h: 0.03, l: 0.01, color: 0x66ff88 },
      { name: 'trace6', x:  1.25, y: 1.9, z: 0.66, w: 0.9, h: 0.03, l: 0.01, color: 0xcc66ff },
      // Power indicator LEDs along bottom frame edge
      { name: 'led1', x: -1.25, y: 0.08, z: 0.7, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      { name: 'led2', x:  0.0,  y: 0.08, z: 0.7, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      { name: 'led3', x:  1.25, y: 0.08, z: 0.7, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
    ],
  },
  serverRack: {
    id: 'serverRack', name: 'Server Rack', zoneType: 'controlRoom',
    cost: { funding: 15000 }, energyCost: 3.0, spriteColor: 0x3a3e4a,
    gridW: 1, gridH: 2, subH: 5, spriteKey: 'serverRack',
    effects: { zoneOutput: 0.08, research: 0.03 }, baseMaterial: 'metal_dark',
    // 1×2 footprint, 2.5 m tall. 19" server cabinet — medium-gray body,
    // alternating light/dark server faceplates with visible status LEDs and
    // drive activity lights.
    parts: [
      // Frame — medium gray, not near-black
      { name: 'plinth', x: 0, y: 0,   z: 0, w: 1.0, h: 0.15, l: 2.0, color: 0x484c58 },
      { name: 'cap',    x: 0, y: 4.85, z: 0, w: 1.0, h: 0.15, l: 2.0, color: 0x484c58 },
      { name: 'railL',  x: -0.46, y: 0.15, z: 0,    w: 0.08, h: 4.7, l: 2.0, color: 0x505868 },
      { name: 'railR',  x:  0.46, y: 0.15, z: 0,    w: 0.08, h: 4.7, l: 2.0, color: 0x505868 },
      { name: 'back',   x: 0,     y: 0.15, z: 0.96, w: 0.84, h: 4.7, l: 0.04, color: 0x3c404c },
      // 8 server units — body medium-gray, faceplates lighter, plenty of LEDs
      // Unit 1
      { name: 's1b', x: 0, y: 0.3,  z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x44485a },
      { name: 's1f', x: 0, y: 0.33, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x585e6e },
      { name: 's1a', x: -0.3, y: 0.54, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      { name: 's1c', x: -0.18, y: 0.54, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      { name: 's1d', x:  0.3, y: 0.54, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0xffaa40 },
      // Unit 2
      { name: 's2b', x: 0, y: 0.88, z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x505468 },
      { name: 's2f', x: 0, y: 0.91, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x626878 },
      { name: 's2a', x: -0.3, y: 1.12, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      { name: 's2c', x: -0.18, y: 1.12, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ddff },
      { name: 's2d', x:  0.3, y: 1.12, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      // Unit 3
      { name: 's3b', x: 0, y: 1.46, z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x44485a },
      { name: 's3f', x: 0, y: 1.49, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x585e6e },
      { name: 's3a', x: -0.3, y: 1.7, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0xff4444 },
      { name: 's3c', x: -0.18, y: 1.7, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0xffaa40 },
      { name: 's3d', x:  0.3, y: 1.7, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      // Unit 4
      { name: 's4b', x: 0, y: 2.04, z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x505468 },
      { name: 's4f', x: 0, y: 2.07, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x626878 },
      { name: 's4a', x: -0.3, y: 2.28, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      { name: 's4c', x: -0.18, y: 2.28, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      { name: 's4d', x:  0.3, y: 2.28, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0xffaa40 },
      // Unit 5
      { name: 's5b', x: 0, y: 2.62, z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x44485a },
      { name: 's5f', x: 0, y: 2.65, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x585e6e },
      { name: 's5a', x: -0.3, y: 2.86, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      { name: 's5c', x: -0.18, y: 2.86, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ddff },
      { name: 's5d', x:  0.3, y: 2.86, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      // Unit 6
      { name: 's6b', x: 0, y: 3.2, z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x505468 },
      { name: 's6f', x: 0, y: 3.23, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x626878 },
      { name: 's6a', x: -0.3, y: 3.44, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0xffaa40 },
      { name: 's6c', x: -0.18, y: 3.44, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0xff4444 },
      { name: 's6d', x:  0.3, y: 3.44, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      // Unit 7
      { name: 's7b', x: 0, y: 3.78, z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x44485a },
      { name: 's7f', x: 0, y: 3.81, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x585e6e },
      { name: 's7a', x: -0.3, y: 4.02, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      { name: 's7c', x: -0.18, y: 4.02, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      { name: 's7d', x:  0.3, y: 4.02, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ddff },
      // Unit 8
      { name: 's8b', x: 0, y: 4.36, z: -0.02, w: 0.84, h: 0.45, l: 1.92, color: 0x505468 },
      { name: 's8f', x: 0, y: 4.39, z: -0.95, w: 0.78, h: 0.39, l: 0.02, color: 0x626878 },
      { name: 's8a', x: -0.3, y: 4.57, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
      { name: 's8c', x: -0.18, y: 4.57, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0xffaa40 },
      { name: 's8d', x:  0.3, y: 4.57, z: -0.97, w: 0.05, h: 0.05, l: 0.02, color: 0x44ff66 },
    ],
  },
  operatorConsole: {
    id: 'operatorConsole', name: 'Operator Console', zoneType: 'controlRoom',
    cost: { funding: 25000 }, energyCost: 0.5, spriteColor: 0x44aa66,
    gridW: 3, gridH: 2, subH: 3, surfaceY: 1.48, spriteKey: 'operatorConsole',
    effects: { zoneOutput: 0.07 }, baseMaterial: 'metal_painted_white',
    // 3×2 footprint. Console desk + angled monitor bank behind it.
    parts: [
      // Base cabinet (white)
      { name: 'base', x: 0, y: 0, z: 0.2, w: 2.9, h: 1.4, l: 1.4, material: 'metal_painted_white' },
      // Kick plate (dark inset at bottom)
      { name: 'kick', x: 0, y: 0, z: -0.45, w: 2.8, h: 0.1, l: 0.02, color: 0x505868 },
      // Worksurface
      { name: 'top', x: 0, y: 1.4, z: 0.1, w: 3.0, h: 0.08, l: 1.8, material: 'tile_hardwood' },
      // Keyboard tray inset / dark strip near front
      { name: 'kb', x: 0, y: 1.44, z: -0.7, w: 1.8, h: 0.04, l: 0.3, color: 0x303640 },
      // Monitor bank back panel — medium gray
      { name: 'backPanel', x: 0, y: 1.5, z: 0.92, w: 2.9, h: 2.0, l: 0.08, color: 0x4a5060 },
      // Bottom row — 3 monitors (dark bezels)
      { name: 'mon1', x: -0.95, y: 1.65, z: 0.86, w: 0.88, h: 0.55, l: 0.04, color: 0x2a2c34 },
      { name: 'mon2', x:  0.0,  y: 1.65, z: 0.86, w: 0.88, h: 0.55, l: 0.04, color: 0x2a2c34 },
      { name: 'mon3', x:  0.95, y: 1.65, z: 0.86, w: 0.88, h: 0.55, l: 0.04, color: 0x2a2c34 },
      // Bottom row screens — brighter: orbit (green), beam current (cyan), status (blue)
      { name: 'scr1', x: -0.95, y: 1.67, z: 0.83, w: 0.80, h: 0.47, l: 0.02, color: 0x0c4820 },
      { name: 'scr2', x:  0.0,  y: 1.67, z: 0.83, w: 0.80, h: 0.47, l: 0.02, color: 0x0c3848 },
      { name: 'scr3', x:  0.95, y: 1.67, z: 0.83, w: 0.80, h: 0.47, l: 0.02, color: 0x182858 },
      // Bottom row trace lines
      { name: 'tr1', x: -0.95, y: 1.88, z: 0.81, w: 0.7, h: 0.03, l: 0.01, color: 0x44ff66 },
      { name: 'tr2', x:  0.0,  y: 1.84, z: 0.81, w: 0.7, h: 0.03, l: 0.01, color: 0x44ddff },
      { name: 'tr3', x:  0.95, y: 1.80, z: 0.81, w: 0.7, h: 0.03, l: 0.01, color: 0x6688ff },
      // Top row — 3 monitors
      { name: 'mon4', x: -0.95, y: 2.25, z: 0.86, w: 0.88, h: 0.55, l: 0.04, color: 0x2a2c34 },
      { name: 'mon5', x:  0.0,  y: 2.25, z: 0.86, w: 0.88, h: 0.55, l: 0.04, color: 0x2a2c34 },
      { name: 'mon6', x:  0.95, y: 2.25, z: 0.86, w: 0.88, h: 0.55, l: 0.04, color: 0x2a2c34 },
      // Top row screens — trending (green), alarm summary (red), beam profile (purple)
      { name: 'scr4', x: -0.95, y: 2.27, z: 0.83, w: 0.80, h: 0.47, l: 0.02, color: 0x0c4820 },
      { name: 'scr5', x:  0.0,  y: 2.27, z: 0.83, w: 0.80, h: 0.47, l: 0.02, color: 0x481818 },
      { name: 'scr6', x:  0.95, y: 2.27, z: 0.83, w: 0.80, h: 0.47, l: 0.02, color: 0x281848 },
      // Top row trace lines
      { name: 'tr4', x: -0.95, y: 2.45, z: 0.81, w: 0.7, h: 0.03, l: 0.01, color: 0x66ff88 },
      { name: 'tr5', x:  0.0,  y: 2.48, z: 0.81, w: 0.7, h: 0.03, l: 0.01, color: 0xff4444 },
      { name: 'tr6', x:  0.95, y: 2.42, z: 0.81, w: 0.7, h: 0.03, l: 0.01, color: 0xcc66ff },
      // Status lamps along top — bigger, brighter
      { name: 'lampL', x: -1.3, y: 2.95, z: 0.85, w: 0.08, h: 0.08, l: 0.03, color: 0x44ff66 },
      { name: 'lampM', x:  0.0, y: 2.95, z: 0.85, w: 0.08, h: 0.08, l: 0.03, color: 0xffaa40 },
      { name: 'lampR', x:  1.3, y: 2.95, z: 0.85, w: 0.08, h: 0.08, l: 0.03, color: 0xff4040 },
      // Keyboard + mouse on worksurface
      { name: 'kybd',  x: -0.1, y: 1.50, z: -0.5, w: 0.9, h: 0.04, l: 0.3, color: 0x303640 },
      { name: 'mouse', x:  0.6, y: 1.505, z: -0.5, w: 0.12, h: 0.05, l: 0.18, color: 0x303640 },
    ],
  },
  alarmPanel: {
    id: 'alarmPanel', name: 'Alarm Panel', zoneType: 'controlRoom',
    cost: { funding: 3000 }, energyCost: 0.1, spriteColor: 0xcc5544,
    gridW: 1, gridH: 1, subH: 3, spriteKey: 'alarmPanel',
    effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_painted_white',
    // Wall-mount alarm/annunciator panel — white enclosure with rows of
    // colored indicator windows and a red beacon on top.
    parts: [
      // Main enclosure body (white)
      { name: 'body', x: 0, y: 0.3, z: 0, w: 0.85, h: 2.2, l: 0.2, material: 'metal_painted_white' },
      // Thin border trim
      { name: 'trim', x: 0, y: 0.3, z: -0.11, w: 0.9, h: 2.25, l: 0.02, color: 0xb0b4bc },
      // Dark faceplate inset
      { name: 'face', x: 0, y: 0.5, z: -0.12, w: 0.75, h: 1.8, l: 0.02, color: 0x3a3e4a },
      // Row 1 — top alarm indicators (red/amber/green windows)
      { name: 'a1', x: -0.25, y: 2.1, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0xff4444 },
      { name: 'a2', x: -0.08, y: 2.1, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0xff4444 },
      { name: 'a3', x:  0.08, y: 2.1, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0xffaa40 },
      { name: 'a4', x:  0.25, y: 2.1, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ff66 },
      // Row 2
      { name: 'b1', x: -0.25, y: 1.9, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0xffaa40 },
      { name: 'b2', x: -0.08, y: 1.9, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ff66 },
      { name: 'b3', x:  0.08, y: 1.9, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ff66 },
      { name: 'b4', x:  0.25, y: 1.9, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ff66 },
      // Row 3
      { name: 'c1', x: -0.25, y: 1.7, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ff66 },
      { name: 'c2', x: -0.08, y: 1.7, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ff66 },
      { name: 'c3', x:  0.08, y: 1.7, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0xff4444 },
      { name: 'c4', x:  0.25, y: 1.7, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0xffaa40 },
      // Row 4
      { name: 'd1', x: -0.25, y: 1.5, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ff66 },
      { name: 'd2', x: -0.08, y: 1.5, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0xffaa40 },
      { name: 'd3', x:  0.08, y: 1.5, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ff66 },
      { name: 'd4', x:  0.25, y: 1.5, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ff66 },
      // Row 5
      { name: 'e1', x: -0.25, y: 1.3, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ff66 },
      { name: 'e2', x: -0.08, y: 1.3, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ff66 },
      { name: 'e3', x:  0.08, y: 1.3, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ff66 },
      { name: 'e4', x:  0.25, y: 1.3, z: -0.14, w: 0.12, h: 0.12, l: 0.02, color: 0x44ddff },
      // Acknowledge button (large, yellow)
      { name: 'ackBtn', x: 0, y: 0.7, z: -0.14, w: 0.2, h: 0.2, l: 0.04, color: 0xffcc00 },
      // Silence button (small, blue)
      { name: 'silBtn', x: 0.28, y: 0.7, z: -0.14, w: 0.12, h: 0.12, l: 0.04, color: 0x4488cc },
      // Test button (small, white)
      { name: 'tstBtn', x: -0.28, y: 0.7, z: -0.14, w: 0.12, h: 0.12, l: 0.04, color: 0xdddddd },
      // Red beacon dome on top
      { name: 'beaconBase', x: 0, y: 2.5, z: 0, w: 0.2, h: 0.06, l: 0.2, color: 0x606060 },
      { name: 'beacon', x: 0, y: 2.56, z: 0, w: 0.16, h: 0.2, l: 0.16, color: 0xff2222 },
    ],
  },
  diningTable: {
    id: 'diningTable', name: 'Dining Table', zoneType: 'cafeteria',
    cost: { funding: 400 }, energyCost: 0, spriteColor: 0xaa7744,
    gridW: 2, gridH: 2, subH: 2, surfaceY: 1.5, spriteKey: 'diningTable',
    effects: { morale: 2 }, baseMaterial: 'tile_hardwood',
    // 2×2 footprint. Pedestal-style cafeteria table, ~75cm tall.
    parts: [
      // Pedestal base (wide disc-ish)
      { name: 'base', x: 0, y: 0, z: 0, w: 1.2, h: 0.08, l: 1.2, material: 'metal_dark' },
      // Center column
      { name: 'column', x: 0, y: 0.08, z: 0, w: 0.3, h: 1.32, l: 0.3, material: 'metal_dark' },
      // Round-ish top (square approximation)
      { name: 'top', x: 0, y: 1.4, z: 0, w: 2.0, h: 0.1, l: 2.0, material: 'tile_hardwood' },
      // Subtle top-edge trim
      { name: 'trim', x: 0, y: 1.35, z: 0, w: 2.1, h: 0.04, l: 2.1, material: 'metal_dark' },
    ],
  },
  servingCounter: {
    id: 'servingCounter', name: 'Serving Counter', zoneType: 'cafeteria',
    cost: { funding: 5000 }, energyCost: 5.0, spriteColor: 0xb8bac2,
    gridW: 4, gridH: 1, subH: 2, surfaceY: 1.46, spriteKey: 'servingCounter',
    effects: { morale: 3 }, baseMaterial: 'metal_painted_white',
    // 4×1 footprint. Stainless cafeteria counter with tray rail,
    // heated well inserts on top, and a glass sneeze guard.
    parts: [
      // Base cabinet
      { name: 'base', x: 0, y: 0, z: 0.05, w: 3.9, h: 1.4, l: 0.9, material: 'metal_brushed' },
      // Kick toe recess (dark)
      { name: 'kick', x: 0, y: 0, z: -0.44, w: 3.85, h: 0.12, l: 0.02, color: 0x18181c },
      // Worksurface
      { name: 'top',  x: 0, y: 1.4, z: 0, w: 4.0, h: 0.06, l: 1.0, material: 'metal_brushed' },
      // 3 heated well inserts (dark rectangles on top)
      { name: 'well1', x: -1.2, y: 1.46, z: 0.1, w: 1.0, h: 0.02, l: 0.6, color: 0x2a1a14 },
      { name: 'well2', x:  0.0, y: 1.46, z: 0.1, w: 1.0, h: 0.02, l: 0.6, color: 0x2a1a14 },
      { name: 'well3', x:  1.2, y: 1.46, z: 0.1, w: 1.0, h: 0.02, l: 0.6, color: 0x2a1a14 },
      // Sneeze guard glass (vertical translucent-looking pane)
      { name: 'glass', x: 0, y: 1.5, z: 0.35, w: 3.9, h: 0.7, l: 0.04, color: 0xc8e0ec },
      // Glass support posts
      { name: 'postL', x: -1.9, y: 1.5, z: 0.35, w: 0.06, h: 0.7, l: 0.06, material: 'metal_brushed' },
      { name: 'postR', x:  1.9, y: 1.5, z: 0.35, w: 0.06, h: 0.7, l: 0.06, material: 'metal_brushed' },
      // Tray rail in front (chrome tube)
      { name: 'rail',    x: 0, y: 1.25, z: -0.55, w: 3.9, h: 0.05, l: 0.05, color: 0xc4c8d0 },
      { name: 'bracket1', x: -1.6, y: 1.25, z: -0.5, w: 0.05, h: 0.1, l: 0.12, material: 'metal_brushed' },
      { name: 'bracket2', x:  0.0, y: 1.25, z: -0.5, w: 0.05, h: 0.1, l: 0.12, material: 'metal_brushed' },
      { name: 'bracket3', x:  1.6, y: 1.25, z: -0.5, w: 0.05, h: 0.1, l: 0.12, material: 'metal_brushed' },
    ],
  },
  vendingMachine: {
    id: 'vendingMachine', name: 'Vending Machine', zoneType: 'cafeteria',
    cost: { funding: 3000 }, energyCost: 0.3, spriteColor: 0x4488aa,
    gridW: 1, gridH: 1, subH: 3, spriteKey: 'vendingMachine',
    effects: { morale: 1 }, baseMaterial: 'metal_painted_white',
    // 1×1 footprint, ~1.8m tall. Boxy vending machine with a blue front panel,
    // glass display window showing product rows, coin slot, and lit branding strip.
    parts: [
      // Main body (white sides)
      { name: 'body', x: 0, y: 0, z: 0, w: 0.95, h: 3.6, l: 0.85, material: 'metal_painted_white' },
      // Blue front panel
      { name: 'front', x: 0, y: 0.05, z: -0.44, w: 0.9, h: 3.5, l: 0.02, color: 0x2266aa },
      // Glass display window (upper portion)
      { name: 'glass', x: 0, y: 1.4, z: -0.46, w: 0.78, h: 1.8, l: 0.02, color: 0x88bbdd },
      // Product shelves visible through glass (3 rows)
      { name: 'shelf1', x: 0, y: 2.8, z: -0.2, w: 0.74, h: 0.04, l: 0.4, color: 0xc0c4cc },
      { name: 'shelf2', x: 0, y: 2.2, z: -0.2, w: 0.74, h: 0.04, l: 0.4, color: 0xc0c4cc },
      { name: 'shelf3', x: 0, y: 1.6, z: -0.2, w: 0.74, h: 0.04, l: 0.4, color: 0xc0c4cc },
      // Products on shelves (colored blocks suggesting cans/bottles)
      { name: 'prod1a', x: -0.2, y: 2.84, z: -0.25, w: 0.12, h: 0.28, l: 0.12, color: 0xdd3333 },
      { name: 'prod1b', x:  0.0, y: 2.84, z: -0.25, w: 0.12, h: 0.28, l: 0.12, color: 0x3366cc },
      { name: 'prod1c', x:  0.2, y: 2.84, z: -0.25, w: 0.12, h: 0.28, l: 0.12, color: 0x33aa55 },
      { name: 'prod2a', x: -0.2, y: 2.24, z: -0.25, w: 0.12, h: 0.28, l: 0.12, color: 0xeeaa22 },
      { name: 'prod2b', x:  0.0, y: 2.24, z: -0.25, w: 0.12, h: 0.28, l: 0.12, color: 0xdd3333 },
      { name: 'prod2c', x:  0.2, y: 2.24, z: -0.25, w: 0.12, h: 0.28, l: 0.12, color: 0x8844cc },
      { name: 'prod3a', x: -0.2, y: 1.64, z: -0.25, w: 0.12, h: 0.28, l: 0.12, color: 0x3366cc },
      { name: 'prod3b', x:  0.0, y: 1.64, z: -0.25, w: 0.12, h: 0.28, l: 0.12, color: 0x33aa55 },
      { name: 'prod3c', x:  0.2, y: 1.64, z: -0.25, w: 0.12, h: 0.28, l: 0.12, color: 0xeeaa22 },
      // Retrieval bin at bottom (dark slot)
      { name: 'bin', x: 0, y: 0.15, z: -0.44, w: 0.6, h: 0.6, l: 0.02, color: 0x181818 },
      { name: 'binFlap', x: 0, y: 0.45, z: -0.46, w: 0.58, h: 0.04, l: 0.04, color: 0xb0b4bc },
      // Coin/card panel (right side of front)
      { name: 'coinPanel', x: 0.3, y: 1.0, z: -0.46, w: 0.2, h: 0.3, l: 0.02, color: 0x888888 },
      { name: 'coinSlot',  x: 0.3, y: 1.1, z: -0.48, w: 0.08, h: 0.02, l: 0.02, color: 0x222222 },
      // Lit branding strip along top
      { name: 'brandStrip', x: 0, y: 3.3, z: -0.46, w: 0.82, h: 0.2, l: 0.02, color: 0x66ccff },
      // Top cap
      { name: 'cap', x: 0, y: 3.6, z: 0, w: 0.97, h: 0.04, l: 0.87, color: 0x606468 },
    ],
  },
  microwave: {
    id: 'microwave', name: 'Microwave Station', zoneType: 'cafeteria',
    cost: { funding: 150 }, energyCost: 0.3, spriteColor: 0x666666,
    gridW: 1, gridH: 1, subH: 1, visualSubW: 1.0, visualSubH: 0.6, visualSubL: 0.75,
    spriteKey: 'microwave', effects: { morale: 1 }, baseMaterial: 'metal_painted_white',
    stackable: true,
    // Countertop microwave — boxy white body, dark glass door, handle,
    // control panel on right with buttons and a small digital display.
    parts: [
      // Main body (white)
      { name: 'body', x: 0, y: 0, z: 0, w: 1.0, h: 0.55, l: 0.7, material: 'metal_painted_white' },
      // Dark glass door (front left portion)
      { name: 'door', x: -0.12, y: 0.06, z: -0.36, w: 0.6, h: 0.42, l: 0.02, color: 0x1a1a22 },
      // Door handle (chrome bar)
      { name: 'handle', x: 0.22, y: 0.27, z: -0.38, w: 0.04, h: 0.26, l: 0.04, color: 0xb0b4bc },
      // Control panel (right side of front, light gray)
      { name: 'panel', x: 0.36, y: 0.06, z: -0.36, w: 0.22, h: 0.42, l: 0.02, color: 0xd0d4dc },
      // Digital display (green LCD)
      { name: 'display', x: 0.36, y: 0.35, z: -0.38, w: 0.16, h: 0.08, l: 0.01, color: 0x44cc66 },
      // Button column
      { name: 'btn1', x: 0.36, y: 0.24, z: -0.38, w: 0.1, h: 0.06, l: 0.01, color: 0xe8e8e8 },
      { name: 'btn2', x: 0.36, y: 0.16, z: -0.38, w: 0.1, h: 0.06, l: 0.01, color: 0xe8e8e8 },
      { name: 'startBtn', x: 0.36, y: 0.08, z: -0.38, w: 0.1, h: 0.06, l: 0.01, color: 0x44bb66 },
      // Ventilation slots on top
      { name: 'vent1', x: -0.15, y: 0.55, z: 0.05, w: 0.4, h: 0.01, l: 0.04, color: 0xc0c0c0 },
      { name: 'vent2', x: -0.15, y: 0.55, z: 0.15, w: 0.4, h: 0.01, l: 0.04, color: 0xc0c0c0 },
      // Feet
      { name: 'footFL', x: -0.4, y: 0, z: -0.28, w: 0.06, h: 0.02, l: 0.06, color: 0x444444 },
      { name: 'footFR', x:  0.4, y: 0, z: -0.28, w: 0.06, h: 0.02, l: 0.06, color: 0x444444 },
      { name: 'footBL', x: -0.4, y: 0, z:  0.28, w: 0.06, h: 0.02, l: 0.06, color: 0x444444 },
      { name: 'footBR', x:  0.4, y: 0, z:  0.28, w: 0.06, h: 0.02, l: 0.06, color: 0x444444 },
    ],
  },
  waterCooler: {
    id: 'waterCooler', name: 'Water Cooler', zoneType: 'cafeteria',
    cost: { funding: 300 }, energyCost: 0.1, spriteColor: 0x66aacc,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'waterCooler',
    effects: { morale: 1 }, baseMaterial: 'metal_painted_white',
    // Floor-standing water cooler — white body, blue water jug on top,
    // hot/cold taps, drip tray.
    parts: [
      // Base/stand (slightly wider at bottom)
      { name: 'base', x: 0, y: 0, z: 0, w: 0.6, h: 0.1, l: 0.6, color: 0x606468 },
      // Main body (white)
      { name: 'body', x: 0, y: 0.1, z: 0, w: 0.55, h: 1.6, l: 0.55, material: 'metal_painted_white' },
      // Top platform (where jug sits)
      { name: 'top', x: 0, y: 1.7, z: 0, w: 0.58, h: 0.06, l: 0.58, color: 0xd0d4dc },
      // Water jug (blue translucent)
      { name: 'jugBody', x: 0, y: 1.76, z: 0, w: 0.42, h: 1.0, l: 0.42, color: 0x88ccee },
      // Jug cap
      { name: 'jugCap', x: 0, y: 2.76, z: 0, w: 0.3, h: 0.06, l: 0.3, color: 0x4488aa },
      // Water level line inside jug (lighter blue)
      { name: 'waterLine', x: 0, y: 2.2, z: 0, w: 0.38, h: 0.5, l: 0.38, color: 0xaaddff },
      // Tap panel (front face, recessed)
      { name: 'tapPanel', x: 0, y: 1.1, z: -0.28, w: 0.3, h: 0.3, l: 0.02, color: 0xd8dce4 },
      // Hot tap (red)
      { name: 'tapHot', x: -0.08, y: 1.22, z: -0.3, w: 0.06, h: 0.06, l: 0.04, color: 0xdd3333 },
      // Cold tap (blue)
      { name: 'tapCold', x:  0.08, y: 1.22, z: -0.3, w: 0.06, h: 0.06, l: 0.04, color: 0x3366cc },
      // Drip tray
      { name: 'tray', x: 0, y: 0.85, z: -0.3, w: 0.28, h: 0.04, l: 0.12, color: 0x888888 },
      // Drip grate
      { name: 'grate', x: 0, y: 0.89, z: -0.3, w: 0.24, h: 0.01, l: 0.1, color: 0xb0b4bc },
      // Hot/cold indicator dots
      { name: 'dotHot',  x: -0.08, y: 1.15, z: -0.3, w: 0.04, h: 0.04, l: 0.01, color: 0xff4444 },
      { name: 'dotCold', x:  0.08, y: 1.15, z: -0.3, w: 0.04, h: 0.04, l: 0.01, color: 0x4488ff },
      // Power indicator LED
      { name: 'led', x: 0.2, y: 1.55, z: -0.28, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
    ],
  },
  conferenceTable: {
    id: 'conferenceTable', name: 'Conference Table', zoneType: 'meetingRoom',
    cost: { funding: 2000 }, energyCost: 0, spriteColor: 0x775533,
    gridW: 4, gridH: 2, subH: 2, surfaceY: 1.52, spriteKey: 'conferenceTable',
    effects: { morale: 1, research: 0.02 }, baseMaterial: 'tile_hardwood',
    // 4×2 footprint. Twin-pedestal boardroom table, ~75cm tall.
    parts: [
      // Two pedestal bases
      { name: 'baseL', x: -1.4, y: 0, z: 0, w: 1.0, h: 0.08, l: 1.3, material: 'metal_dark' },
      { name: 'baseR', x:  1.4, y: 0, z: 0, w: 1.0, h: 0.08, l: 1.3, material: 'metal_dark' },
      // Two pedestal columns
      { name: 'colL', x: -1.4, y: 0.08, z: 0, w: 0.4, h: 1.32, l: 0.7, material: 'metal_dark' },
      { name: 'colR', x:  1.4, y: 0.08, z: 0, w: 0.4, h: 1.32, l: 0.7, material: 'metal_dark' },
      // Connecting under-beam
      { name: 'underBeam', x: 0, y: 0.5, z: 0, w: 2.2, h: 0.15, l: 0.2, material: 'metal_dark' },
      // Tabletop
      { name: 'top', x: 0, y: 1.4, z: 0, w: 4.0, h: 0.12, l: 2.0, material: 'tile_hardwood' },
      // Cable tray strip along center (flavor)
      { name: 'cable', x: 0, y: 1.4, z: 0, w: 3.6, h: 0.13, l: 0.2, material: 'metal_dark' },
    ],
  },
  projector:        { id: 'projector',          name: 'Projector',          zoneType: 'meetingRoom', cost: { funding: 1500 },  energyCost: 0.3, spriteColor: 0x444444, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.6, visualSubH: 0.4, visualSubL: 0.6, spriteKey: 'projector',        effects: { research: 0.04 }, baseMaterial: 'metal_dark', stackable: true },
  phoneUnit:        { id: 'phoneUnit',          name: 'Conference Phone',   zoneType: 'meetingRoom', cost: { funding: 500 },   energyCost: 0,   spriteColor: 0x333333, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.5, visualSubH: 0.2, visualSubL: 0.5, spriteKey: 'phoneUnit',        effects: {}, baseMaterial: 'metal_dark', stackable: true },
  whiteboardLarge:  { id: 'whiteboardLarge',    name: 'Large Whiteboard',   zoneType: 'meetingRoom', cost: { funding: 250 },   energyCost: 0,   spriteColor: 0xeeeeee, gridW: 3, gridH: 1, subH: 3, visualSubW: 2.8, visualSubH: 2.4, visualSubL: 0.15, spriteKey: 'whiteboardLarge',  effects: { research: 0.03 }, baseMaterial: 'metal_painted_white' },

  // ── Chairs ──────────────────────────────────────────────────────────

  // Office chairs — three tiers
  officeChair: {
    id: 'officeChair', name: 'Office Chair', zoneType: 'officeSpace',
    cost: { funding: 150 }, energyCost: 0, spriteColor: 0x3a3a3a,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'officeChair',
    effects: { morale: 1 }, baseMaterial: 'metal_dark',
    // Basic swivel chair: 5-star base, gas cylinder, fabric seat + low back
    parts: [
      // 5-star base (simplified as cross)
      { name: 'baseX', x: 0, y: 0.04, z: 0, w: 0.9, h: 0.06, l: 0.12, color: 0x303030 },
      { name: 'baseZ', x: 0, y: 0.04, z: 0, w: 0.12, h: 0.06, l: 0.9, color: 0x303030 },
      // 5 casters
      { name: 'c1', x: -0.42, y: 0, z: 0, w: 0.1, h: 0.08, l: 0.1, color: 0x222222 },
      { name: 'c2', x:  0.42, y: 0, z: 0, w: 0.1, h: 0.08, l: 0.1, color: 0x222222 },
      { name: 'c3', x: 0, y: 0, z: -0.42, w: 0.1, h: 0.08, l: 0.1, color: 0x222222 },
      { name: 'c4', x: 0, y: 0, z:  0.42, w: 0.1, h: 0.08, l: 0.1, color: 0x222222 },
      // Gas cylinder
      { name: 'stem', x: 0, y: 0.1, z: 0, w: 0.08, h: 0.7, l: 0.08, color: 0x444444 },
      // Seat pan
      { name: 'seat', x: 0, y: 0.8, z: -0.02, w: 0.85, h: 0.12, l: 0.85, color: 0x3a3e46 },
      // Low backrest
      { name: 'backFrame', x: 0, y: 0.92, z: 0.38, w: 0.06, h: 0.9, l: 0.06, color: 0x303030 },
      { name: 'back', x: 0, y: 1.2, z: 0.38, w: 0.7, h: 0.6, l: 0.08, color: 0x3a3e46 },
    ],
  },
  ergonomicChair: {
    id: 'ergonomicChair', name: 'Ergonomic Chair', zoneType: 'officeSpace',
    cost: { funding: 600 }, energyCost: 0, spriteColor: 0x2a5a8a,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'ergonomicChair',
    effects: { morale: 2 }, baseMaterial: 'metal_dark',
    // Mid-range mesh-back chair with lumbar support, adjustable arms, headrest
    parts: [
      // 5-star base
      { name: 'baseX', x: 0, y: 0.04, z: 0, w: 0.95, h: 0.06, l: 0.14, color: 0x303030 },
      { name: 'baseZ', x: 0, y: 0.04, z: 0, w: 0.14, h: 0.06, l: 0.95, color: 0x303030 },
      { name: 'c1', x: -0.44, y: 0, z: 0, w: 0.1, h: 0.08, l: 0.1, color: 0x222222 },
      { name: 'c2', x:  0.44, y: 0, z: 0, w: 0.1, h: 0.08, l: 0.1, color: 0x222222 },
      { name: 'c3', x: 0, y: 0, z: -0.44, w: 0.1, h: 0.08, l: 0.1, color: 0x222222 },
      { name: 'c4', x: 0, y: 0, z:  0.44, w: 0.1, h: 0.08, l: 0.1, color: 0x222222 },
      // Gas cylinder
      { name: 'stem', x: 0, y: 0.1, z: 0, w: 0.08, h: 0.7, l: 0.08, color: 0x444444 },
      // Seat pan (contoured)
      { name: 'seat', x: 0, y: 0.8, z: -0.02, w: 0.88, h: 0.1, l: 0.88, color: 0x2a5a8a },
      // Armrests
      { name: 'armPostL', x: -0.4, y: 0.92, z: 0.05, w: 0.06, h: 0.4, l: 0.06, color: 0x303030 },
      { name: 'armPostR', x:  0.4, y: 0.92, z: 0.05, w: 0.06, h: 0.4, l: 0.06, color: 0x303030 },
      { name: 'armPadL',  x: -0.4, y: 1.32, z: -0.05, w: 0.08, h: 0.04, l: 0.28, color: 0x222222 },
      { name: 'armPadR',  x:  0.4, y: 1.32, z: -0.05, w: 0.08, h: 0.04, l: 0.28, color: 0x222222 },
      // Tall mesh backrest
      { name: 'backFrame', x: 0, y: 0.9, z: 0.4, w: 0.08, h: 1.1, l: 0.08, color: 0x303030 },
      { name: 'back', x: 0, y: 1.25, z: 0.4, w: 0.72, h: 0.7, l: 0.06, color: 0x3a6a9a },
      // Lumbar pad
      { name: 'lumbar', x: 0, y: 1.05, z: 0.36, w: 0.5, h: 0.2, l: 0.06, color: 0x2a5a8a },
      // Headrest
      { name: 'headrestPost', x: 0, y: 2.0, z: 0.42, w: 0.06, h: 0.15, l: 0.06, color: 0x303030 },
      { name: 'headrest', x: 0, y: 2.12, z: 0.4, w: 0.38, h: 0.2, l: 0.08, color: 0x2a5a8a },
    ],
  },
  executiveChair: {
    id: 'executiveChair', name: 'Executive Chair', zoneType: 'officeSpace',
    cost: { funding: 2000 }, energyCost: 0, spriteColor: 0x1a1412,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'executiveChair',
    effects: { morale: 3 }, baseMaterial: 'metal_dark',
    // High-back leather executive chair with padded arms and tilt
    parts: [
      // 5-star base (chrome)
      { name: 'baseX', x: 0, y: 0.04, z: 0, w: 0.95, h: 0.07, l: 0.14, color: 0xa0a4ac },
      { name: 'baseZ', x: 0, y: 0.04, z: 0, w: 0.14, h: 0.07, l: 0.95, color: 0xa0a4ac },
      { name: 'c1', x: -0.44, y: 0, z: 0, w: 0.1, h: 0.08, l: 0.1, color: 0x555555 },
      { name: 'c2', x:  0.44, y: 0, z: 0, w: 0.1, h: 0.08, l: 0.1, color: 0x555555 },
      { name: 'c3', x: 0, y: 0, z: -0.44, w: 0.1, h: 0.08, l: 0.1, color: 0x555555 },
      { name: 'c4', x: 0, y: 0, z:  0.44, w: 0.1, h: 0.08, l: 0.1, color: 0x555555 },
      // Gas cylinder (chrome)
      { name: 'stem', x: 0, y: 0.11, z: 0, w: 0.08, h: 0.7, l: 0.08, color: 0xa0a4ac },
      // Thick padded seat
      { name: 'seat', x: 0, y: 0.8, z: -0.02, w: 0.92, h: 0.16, l: 0.92, color: 0x1a1412 },
      // Padded armrests
      { name: 'armPostL', x: -0.42, y: 0.96, z: 0.05, w: 0.08, h: 0.4, l: 0.08, color: 0xa0a4ac },
      { name: 'armPostR', x:  0.42, y: 0.96, z: 0.05, w: 0.08, h: 0.4, l: 0.08, color: 0xa0a4ac },
      { name: 'armPadL',  x: -0.42, y: 1.36, z: -0.02, w: 0.12, h: 0.06, l: 0.32, color: 0x1a1412 },
      { name: 'armPadR',  x:  0.42, y: 1.36, z: -0.02, w: 0.12, h: 0.06, l: 0.32, color: 0x1a1412 },
      // Tall padded backrest (leather look)
      { name: 'back', x: 0, y: 1.0, z: 0.4, w: 0.82, h: 1.3, l: 0.14, color: 0x1a1412 },
      // Pillow headrest at top
      { name: 'headrest', x: 0, y: 2.2, z: 0.4, w: 0.5, h: 0.22, l: 0.12, color: 0x1a1412 },
      // Decorative stitching line (lighter strip)
      { name: 'stitch', x: 0, y: 1.6, z: 0.34, w: 0.6, h: 0.02, l: 0.02, color: 0x3a3028 },
    ],
  },

  // Control room — operator chair (heavy-duty 24/7)
  operatorChair: {
    id: 'operatorChair', name: 'Operator Chair', zoneType: 'controlRoom',
    cost: { funding: 1200 }, energyCost: 0, spriteColor: 0x446688,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'operatorChair',
    effects: { morale: 2, zoneOutput: 0.02 }, baseMaterial: 'metal_dark',
    // Heavy-duty 24/7 operator chair — chrome base, navy/teal upholstery,
    // contrasting arm pads
    parts: [
      // Heavy 5-star base (chrome)
      { name: 'baseX', x: 0, y: 0.04, z: 0, w: 1.0, h: 0.08, l: 0.16, color: 0x9098a8 },
      { name: 'baseZ', x: 0, y: 0.04, z: 0, w: 0.16, h: 0.08, l: 1.0, color: 0x9098a8 },
      { name: 'c1', x: -0.46, y: 0, z: 0, w: 0.12, h: 0.08, l: 0.12, color: 0x555555 },
      { name: 'c2', x:  0.46, y: 0, z: 0, w: 0.12, h: 0.08, l: 0.12, color: 0x555555 },
      { name: 'c3', x: 0, y: 0, z: -0.46, w: 0.12, h: 0.08, l: 0.12, color: 0x555555 },
      { name: 'c4', x: 0, y: 0, z:  0.46, w: 0.12, h: 0.08, l: 0.12, color: 0x555555 },
      // Gas cylinder (chrome)
      { name: 'stem', x: 0, y: 0.12, z: 0, w: 0.1, h: 0.7, l: 0.1, color: 0x9098a8 },
      // Wide padded seat (navy blue)
      { name: 'seat', x: 0, y: 0.82, z: -0.02, w: 0.95, h: 0.14, l: 0.92, color: 0x2a4468 },
      // Fixed armrests — chrome posts, dark pads
      { name: 'armPostL', x: -0.44, y: 0.96, z: 0.05, w: 0.07, h: 0.42, l: 0.07, color: 0x9098a8 },
      { name: 'armPostR', x:  0.44, y: 0.96, z: 0.05, w: 0.07, h: 0.42, l: 0.07, color: 0x9098a8 },
      { name: 'armPadL',  x: -0.44, y: 1.38, z: -0.02, w: 0.1, h: 0.05, l: 0.3, color: 0x383838 },
      { name: 'armPadR',  x:  0.44, y: 1.38, z: -0.02, w: 0.1, h: 0.05, l: 0.3, color: 0x383838 },
      // Tall backrest (navy blue, lighter outer frame)
      { name: 'backFrame', x: 0, y: 1.0, z: 0.44, w: 0.82, h: 1.25, l: 0.06, color: 0x505868 },
      { name: 'back', x: 0, y: 1.05, z: 0.42, w: 0.72, h: 1.1, l: 0.08, color: 0x2a4468 },
      // Headrest (matching navy)
      { name: 'headrest', x: 0, y: 2.15, z: 0.42, w: 0.45, h: 0.22, l: 0.1, color: 0x2a4468 },
      // Lumbar adjustment knob (bright accent)
      { name: 'knob', x: 0.35, y: 1.15, z: 0.5, w: 0.07, h: 0.07, l: 0.04, color: 0xffaa40 },
    ],
  },

  // Meeting room — stackable meeting chair
  meetingChair: {
    id: 'meetingChair', name: 'Meeting Chair', zoneType: 'meetingRoom',
    cost: { funding: 100 }, energyCost: 0, spriteColor: 0x555555,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'meetingChair',
    effects: { morale: 1 }, baseMaterial: 'metal_dark',
    // Cantilever-base meeting chair — chrome sled frame, upholstered seat+back
    parts: [
      // Sled base (U-shape from side, two parallel rails)
      { name: 'railL', x: -0.3, y: 0, z: 0, w: 0.06, h: 0.06, l: 0.8, color: 0xa0a4ac },
      { name: 'railR', x:  0.3, y: 0, z: 0, w: 0.06, h: 0.06, l: 0.8, color: 0xa0a4ac },
      // Front uprights
      { name: 'uprightL', x: -0.3, y: 0, z: -0.37, w: 0.06, h: 0.85, l: 0.06, color: 0xa0a4ac },
      { name: 'uprightR', x:  0.3, y: 0, z: -0.37, w: 0.06, h: 0.85, l: 0.06, color: 0xa0a4ac },
      // Rear uprights (taller, for backrest)
      { name: 'rearL', x: -0.3, y: 0, z: 0.37, w: 0.06, h: 1.8, l: 0.06, color: 0xa0a4ac },
      { name: 'rearR', x:  0.3, y: 0, z: 0.37, w: 0.06, h: 1.8, l: 0.06, color: 0xa0a4ac },
      // Seat
      { name: 'seat', x: 0, y: 0.82, z: 0, w: 0.7, h: 0.08, l: 0.7, color: 0x4a4a54 },
      // Backrest
      { name: 'back', x: 0, y: 1.2, z: 0.34, w: 0.64, h: 0.55, l: 0.06, color: 0x4a4a54 },
    ],
  },

  // Cafeteria — molded plastic stacking chair
  cafeteriaChair: {
    id: 'cafeteriaChair', name: 'Cafeteria Chair', zoneType: 'cafeteria',
    cost: { funding: 50 }, energyCost: 0, spriteColor: 0xcc6622,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'cafeteriaChair',
    effects: { morale: 1 }, baseMaterial: 'metal_dark',
    // Simple 4-leg cafeteria chair — tubular steel frame, molded seat+back
    parts: [
      // Four tubular legs
      { name: 'legFL', x: -0.3, y: 0, z: -0.3, w: 0.05, h: 0.82, l: 0.05, color: 0xa0a4ac },
      { name: 'legFR', x:  0.3, y: 0, z: -0.3, w: 0.05, h: 0.82, l: 0.05, color: 0xa0a4ac },
      { name: 'legBL', x: -0.3, y: 0, z:  0.3, w: 0.05, h: 0.82, l: 0.05, color: 0xa0a4ac },
      { name: 'legBR', x:  0.3, y: 0, z:  0.3, w: 0.05, h: 0.82, l: 0.05, color: 0xa0a4ac },
      // Cross brace (front-back)
      { name: 'braceL', x: -0.3, y: 0.3, z: 0, w: 0.04, h: 0.04, l: 0.55, color: 0xa0a4ac },
      { name: 'braceR', x:  0.3, y: 0.3, z: 0, w: 0.04, h: 0.04, l: 0.55, color: 0xa0a4ac },
      // Molded seat (colored plastic)
      { name: 'seat', x: 0, y: 0.82, z: -0.02, w: 0.68, h: 0.06, l: 0.68, color: 0xcc6622 },
      // Back legs extend up to support backrest
      { name: 'backPostL', x: -0.3, y: 0.82, z: 0.3, w: 0.05, h: 1.0, l: 0.05, color: 0xa0a4ac },
      { name: 'backPostR', x:  0.3, y: 0.82, z: 0.3, w: 0.05, h: 1.0, l: 0.05, color: 0xa0a4ac },
      // Molded backrest (colored plastic)
      { name: 'back', x: 0, y: 1.25, z: 0.3, w: 0.58, h: 0.5, l: 0.05, color: 0xcc6622 },
    ],
  },
};
