// Facility room furnishings — items placed inside room zones (control room, offices, cafeteria, kitchen, bathroom, etc.).
export const FACILITY_ROOM_FURNISHINGS_RAW = {
  sharedDesk: {
    id: 'sharedDesk', name: 'Shared Desk', zoneType: 'officeSpace',
    cost: { funding: 700 }, energyCost: 0.1, spriteColor: 0x806b4a,
    gridW: 2, gridH: 2, subH: 2, surfaceY: 1.5, spriteKey: 'desk',
    effects: { morale: 1 }, baseMaterial: 'tile_hardwood',
    // A generic reservable seat. Every profession can use it when their
    // profession-specific station has no current work to claim.
    station: { jobs: ['officeWork'], slots: 1, seated: 'preferred',
      anchors: [{ subCol: 0, subRow: -1, facing: 's' }] },
    parts: [
      { name: 'top', x: 0, y: 1.4, z: 0, w: 2.0, h: 0.1, l: 2.0, material: 'tile_hardwood' },
      { name: 'legL', x: -0.8, y: 0, z: 0, w: 0.12, h: 1.4, l: 0.12, material: 'metal_dark' },
      { name: 'legR', x: 0.8, y: 0, z: 0, w: 0.12, h: 1.4, l: 0.12, material: 'metal_dark' },
    ],
  },
  privateOfficeDesk: {
    id: 'privateOfficeDesk', name: 'Private Office Desk', zoneType: 'privateOffice',
    cost: { funding: 2500 }, energyCost: 0.2, spriteColor: 0x57486f,
    gridW: 3, gridH: 2, subH: 2, surfaceY: 1.5, spriteKey: 'desk',
    effects: { morale: 2, research: 0.02 }, baseMaterial: 'tile_hardwood',
    station: { jobs: ['privateOfficeWork'], slots: 1, seated: 'preferred',
      anchors: [{ subCol: 1, subRow: -1, facing: 's' }] },
    parts: [
      { name: 'top', x: 0, y: 1.4, z: 0, w: 3.0, h: 0.1, l: 2.0, material: 'tile_hardwood' },
      { name: 'modesty', x: 0, y: 0.5, z: 0.9, w: 2.7, h: 0.9, l: 0.06, material: 'tile_hardwood' },
      { name: 'legL', x: -1.3, y: 0, z: 0, w: 0.14, h: 1.4, l: 0.14, material: 'metal_dark' },
      { name: 'legR', x: 1.3, y: 0, z: 0, w: 0.14, h: 1.4, l: 0.14, material: 'metal_dark' },
    ],
  },
  desk: {
    id: 'desk', name: 'Desk', zoneType: 'officeSpace',
    cost: { funding: 500 }, energyCost: 0.2, spriteColor: 0x7a6a4a,
    gridW: 3, gridH: 2, subH: 2, surfaceY: 1.5, spriteKey: 'desk',
    effects: { morale: 1 }, baseMaterial: 'tile_hardwood',
    // Worked from the -Z side (drawerFront parts face -Z, toward the
    // sitter); anchor sits one subtile north of the footprint, looking
    // south back into the desk.
    station: { jobs: ['analyze', 'paperwork'], slots: 1, seated: 'preferred',
      anchors: [{ subCol: 1, subRow: -1, facing: 's' }] },
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
    id: 'filingCabinet', name: 'Filing Cabinet', zoneTypes: ['officeSpace', 'reception', 'storageRoom'],
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
    // Worked from the -Z side (keyboard/mouse parts sit at -Z, in front of
    // the sitter); anchor one subtile north of the footprint, facing south.
    station: { jobs: ['analyze', 'paperwork'], slots: 1, seated: 'preferred',
      anchors: [{ subCol: 1, subRow: -1, facing: 's' }] },
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
      // Pull the display face slightly toward the sitter so it does not share
      // the bezel's front plane at z=0.35 (which causes angle-dependent
      // depth fighting in the orthographic camera).
      { name: 'monScreen', x: 0, y: 2.08, z: 0.33, w: 1.1, h: 0.65, l: 0.02, color: 0x1a3a5a },
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
    id: 'pottedPlant', name: 'Potted Plant', zoneTypes: ['officeSpace', 'meetingRoom', 'reception'],
    cost: { funding: 80 }, energyCost: 0, spriteColor: 0x338844,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'pottedPlant',
    // Parts are deliberately color-authored. A shared dark-metal texture
    // multiplies those colors nearly to black under indoor lighting.
    effects: { morale: 1 }, baseMaterial: null,
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
    id: 'floorPlant', name: 'Floor Plant', zoneTypes: ['officeSpace', 'meetingRoom', 'reception'],
    cost: { funding: 150 }, energyCost: 0, spriteColor: 0x2a7a3a,
    gridW: 1, gridH: 1, subH: 3, spriteKey: 'floorPlant',
    effects: { morale: 2 }, baseMaterial: null,
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
    id: 'receptionDesk', name: 'Reception Desk', zoneTypes: ['officeSpace', 'reception'],
    cost: { funding: 3000 }, energyCost: 0.3, spriteColor: 0x6a5a3a,
    gridW: 4, gridH: 2, subH: 3, surfaceY: 1.5, spriteKey: 'receptionDesk',
    effects: { morale: 3 }, baseMaterial: 'tile_hardwood',
    // Worked from the +Z side (workTop/monitor/keyboard sit at +Z, opposite
    // the visitor-facing frontPanel at -Z); anchor one subtile south of the
    // footprint, looking north back into the desk.
    station: { jobs: ['paperwork'], slots: 1, seated: 'preferred',
      anchors: [{ subCol: 1, subRow: 2, facing: 'n' }] },
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
      // Keep the display face in front of the bezel's front plane at z=0.315
      // to avoid z-fighting while the camera rotates.
      { name: 'monScreen', x: -0.5, y: 1.9, z: 0.29, w: 0.82, h: 0.5, l: 0.02, color: 0x1a3a5a },
      // Keyboard on work surface
      { name: 'keyboard', x: -0.5, y: 1.49, z: -0.05, w: 0.7, h: 0.03, l: 0.22, color: 0x303640 },
      // Decorative sign strip on front
      { name: 'sign', x: 0, y: 1.6, z: -0.89, w: 1.5, h: 0.2, l: 0.02, color: 0xb0a080 },
    ],
  },
  coffeeTable: {
    id: 'coffeeTable', name: 'Coffee Table', zoneTypes: ['officeSpace', 'meetingRoom', 'reception'],
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
  loungeTable: {
    id: 'loungeTable', name: 'Lounge Table', zoneTypes: ['officeSpace', 'meetingRoom', 'reception'],
    cost: { funding: 450 }, energyCost: 0, spriteColor: 0x8a7a5a,
    gridW: 3, gridH: 2, subH: 1, surfaceY: 0.9, spriteKey: 'loungeTable',
    effects: { morale: 2 }, baseMaterial: 'tile_hardwood',
    // 3×2 footprint. Same low-slab family as coffeeTable, widened to sit in
    // front of the 3×1 couch, with a lower shelf tier for the extra cost.
    parts: [
      // Four short legs
      { name: 'legFL', x: -1.3, y: 0, z: -0.8, w: 0.1, h: 0.8, l: 0.1, material: 'tile_hardwood' },
      { name: 'legFR', x:  1.3, y: 0, z: -0.8, w: 0.1, h: 0.8, l: 0.1, material: 'tile_hardwood' },
      { name: 'legBL', x: -1.3, y: 0, z:  0.8, w: 0.1, h: 0.8, l: 0.1, material: 'tile_hardwood' },
      { name: 'legBR', x:  1.3, y: 0, z:  0.8, w: 0.1, h: 0.8, l: 0.1, material: 'tile_hardwood' },
      // Tabletop
      { name: 'top', x: 0, y: 0.8, z: 0, w: 3.0, h: 0.08, l: 2.0, material: 'tile_hardwood' },
      // Lower shelf tier between the legs
      { name: 'shelf', x: 0, y: 0.3, z: 0, w: 2.6, h: 0.06, l: 1.6, material: 'tile_hardwood' },
    ],
  },
  couch: {
    id: 'couch', name: 'Couch', zoneTypes: ['officeSpace', 'reception'],
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
    id: 'bookshelf', name: 'Bookshelf', zoneTypes: ['officeSpace', 'reception'],
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
    id: 'printer', name: 'Office Printer', zoneTypes: ['officeSpace', 'reception'],
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
  standingDesk: {
    id: 'standingDesk', name: 'Sit-Stand Desk', zoneType: 'officeSpace',
    cost: { funding: 900 }, energyCost: 0.08, spriteColor: 0x8a7458,
    gridW: 3, gridH: 2, subH: 3, surfaceY: 2.05, spriteKey: 'standingDesk',
    effects: { morale: 2 }, baseMaterial: 'tile_hardwood_oak',
    station: { jobs: ['analyze', 'paperwork'], slots: 1, seated: 'never',
      anchors: [{ subCol: 1, subRow: -1, facing: 's' }] },
    parts: [
      { name: 'footL', x: -1.05, y: 0, z: 0, w: 0.7, h: 0.08, l: 1.35, material: 'metal_dark' },
      { name: 'footR', x:  1.05, y: 0, z: 0, w: 0.7, h: 0.08, l: 1.35, material: 'metal_dark' },
      { name: 'columnL', x: -1.05, y: 0.08, z: 0.25, w: 0.16, h: 1.88, l: 0.16, material: 'metal_brushed' },
      { name: 'columnR', x:  1.05, y: 0.08, z: 0.25, w: 0.16, h: 1.88, l: 0.16, material: 'metal_brushed' },
      { name: 'crossbar', x: 0, y: 1.45, z: 0.25, w: 2.1, h: 0.12, l: 0.12, material: 'metal_dark' },
      { name: 'top', x: 0, y: 1.96, z: 0, w: 3.0, h: 0.12, l: 1.8, material: 'tile_hardwood_oak' },
      { name: 'cableTray', x: 0, y: 1.76, z: 0.48, w: 1.8, h: 0.12, l: 0.25, material: 'metal_dark' },
      { name: 'control', x: 1.05, y: 1.82, z: -0.78, w: 0.32, h: 0.1, l: 0.12, color: 0x303640 },
      { name: 'controlLed', x: 1.05, y: 1.91, z: -0.85, w: 0.08, h: 0.04, l: 0.02, color: 0x66ddee },
      { name: 'monitorStand', x: 0, y: 2.08, z: 0.35, w: 0.18, h: 0.38, l: 0.16, color: 0x303640 },
      { name: 'monitor', x: 0, y: 2.4, z: 0.38, w: 1.25, h: 0.7, l: 0.08, color: 0x242a32 },
      { name: 'screen', x: 0, y: 2.45, z: 0.33, w: 1.12, h: 0.57, l: 0.02, color: 0x173b55 },
    ],
  },
  acousticPod: {
    id: 'acousticPod', name: 'Acoustic Focus Pod', zoneTypes: ['officeSpace', 'meetingRoom'],
    cost: { funding: 1800 }, energyCost: 0.03, spriteColor: 0x526273,
    gridW: 2, gridH: 2, subH: 5, spriteKey: 'acousticPod',
    effects: { morale: 2 }, baseMaterial: 'metal_dark', hasSurface: false,
    station: { jobs: ['analyze', 'paperwork'], slots: 1, seated: 'never',
      anchors: [{ subCol: 0, subRow: -1, facing: 's' }] },
    parts: [
      { name: 'plinth', x: 0, y: 0, z: 0, w: 1.9, h: 0.08, l: 1.9, color: 0x303840 },
      { name: 'back', x: 0, y: 0.08, z: 0.9, w: 1.9, h: 4.45, l: 0.1, color: 0x44566a },
      { name: 'sideL', x: -0.9, y: 0.08, z: 0.1, w: 0.1, h: 4.45, l: 1.7, color: 0x52677d },
      { name: 'sideR', x: 0.9, y: 0.08, z: 0.1, w: 0.1, h: 4.45, l: 1.7, color: 0x52677d },
      { name: 'roof', x: 0, y: 4.53, z: 0.1, w: 1.9, h: 0.12, l: 1.7, color: 0x303840 },
      { name: 'feltL', x: -0.78, y: 0.45, z: 0.25, w: 0.04, h: 3.45, l: 1.15, color: 0x71869a },
      { name: 'feltR', x: 0.78, y: 0.45, z: 0.25, w: 0.04, h: 3.45, l: 1.15, color: 0x71869a },
      { name: 'desk', x: 0, y: 1.65, z: 0.35, w: 1.45, h: 0.12, l: 0.75, material: 'tile_hardwood_oak' },
      { name: 'light', x: 0, y: 4.38, z: 0.15, w: 0.85, h: 0.04, l: 0.32, color: 0xdff4ff },
      { name: 'status', x: 0.74, y: 3.7, z: -0.05, w: 0.07, h: 0.18, l: 0.05, color: 0x66dd88 },
    ],
  },
  beamlineDisplayCase: {
    id: 'beamlineDisplayCase', name: 'Beamline Model Display', zoneTypes: ['officeSpace', 'meetingRoom', 'reception'],
    cost: { funding: 1250 }, energyCost: 0.02, spriteColor: 0x6f8996,
    gridW: 3, gridH: 1, subH: 3, spriteKey: 'beamlineDisplayCase',
    effects: { morale: 1, research: 0.01 }, baseMaterial: 'metal_dark', hasSurface: false,
    parts: [
      { name: 'base', x: 0, y: 0, z: 0, w: 2.9, h: 0.55, l: 0.9, color: 0x303840 },
      { name: 'deck', x: 0, y: 0.55, z: 0, w: 2.8, h: 0.08, l: 0.82, material: 'metal_brushed' },
      { name: 'glassFront', x: 0, y: 0.63, z: -0.42, w: 2.75, h: 1.7, l: 0.04, color: 0xa9d6e8 },
      { name: 'glassBack', x: 0, y: 0.63, z: 0.42, w: 2.75, h: 1.7, l: 0.04, color: 0x88b8cc },
      { name: 'cap', x: 0, y: 2.33, z: 0, w: 2.85, h: 0.08, l: 0.9, material: 'metal_brushed' },
      { name: 'beamPipe', x: 0, y: 1.18, z: 0, w: 2.45, h: 0.08, l: 0.08, color: 0xd9e4e8 },
      { name: 'source', x: -1.05, y: 0.98, z: 0, w: 0.32, h: 0.48, l: 0.34, color: 0x8a5bb2 },
      { name: 'quad1', x: -0.45, y: 1.02, z: 0, w: 0.22, h: 0.4, l: 0.3, color: 0x4aa56b },
      { name: 'cavity', x: 0.15, y: 0.98, z: 0, w: 0.46, h: 0.48, l: 0.32, color: 0xb87333 },
      { name: 'quad2', x: 0.72, y: 1.02, z: 0, w: 0.22, h: 0.4, l: 0.3, color: 0x4aa56b },
      { name: 'screen', x: 1.06, y: 1.05, z: 0, w: 0.08, h: 0.5, l: 0.42, color: 0x61d9f0 },
      { name: 'label', x: 0, y: 0.2, z: -0.47, w: 1.35, h: 0.18, l: 0.03, color: 0xe8e2c8 },
    ],
  },
  collaborationTable: {
    id: 'collaborationTable', name: 'Collaboration Table', zoneTypes: ['officeSpace', 'meetingRoom'],
    cost: { funding: 1100 }, energyCost: 0.12, spriteColor: 0x647b88,
    gridW: 3, gridH: 2, subH: 3, surfaceY: 2.1, spriteKey: 'collaborationTable',
    effects: { morale: 1, research: 0.01 }, baseMaterial: 'metal_dark',
    station: { jobs: ['meet'], slots: 2, seated: 'never',
      anchors: [
        { subCol: 0, subRow: 2, facing: 'n' },
        { subCol: 2, subRow: -1, facing: 's' },
      ] },
    parts: [
      { name: 'foot', x: 0, y: 0, z: 0, w: 1.4, h: 0.1, l: 1.2, material: 'metal_dark' },
      { name: 'pedestal', x: 0, y: 0.1, z: 0, w: 0.5, h: 1.85, l: 0.5, material: 'metal_brushed' },
      { name: 'top', x: 0, y: 1.95, z: 0, w: 3.0, h: 0.14, l: 1.8, material: 'tile_hardwood_oak' },
      { name: 'screenBezel', x: 0, y: 2.09, z: 0, w: 1.7, h: 0.06, l: 1.05, color: 0x242a32 },
      { name: 'screen', x: 0, y: 2.15, z: 0, w: 1.55, h: 0.03, l: 0.9, color: 0x1a536b },
      { name: 'traceA', x: -0.32, y: 2.19, z: 0, w: 0.06, h: 0.02, l: 0.62, color: 0x65e7ff },
      { name: 'traceB', x: 0.28, y: 2.19, z: 0, w: 0.5, h: 0.02, l: 0.06, color: 0x77e08b },
      { name: 'powerPuck', x: 1.05, y: 2.09, z: 0, w: 0.28, h: 0.08, l: 0.28, color: 0x303640 },
    ],
  },
  areaRug: {
    id: 'areaRug', name: 'Area Rug', zoneTypes: ['officeSpace', 'meetingRoom', 'reception'],
    cost: { funding: 180 }, energyCost: 0, spriteColor: 0x496b8a,
    gridW: 4, gridH: 3, subH: 0.06, spriteKey: 'areaRug', mount: 'floor',
    effects: {}, baseMaterial: null, hasSurface: false,
    variants: ['Orbit Blue', 'Terracotta', 'Graphite'],
    variantPreviewColors: [0x496b8a, 0xa65e43, 0x50545e],
    variantOverrides: [
      {},
      { base: { color: 0xa65e43 }, borderLongA: { color: 0xe2b07b }, borderLongB: { color: 0xe2b07b }, borderShortA: { color: 0xe2b07b }, borderShortB: { color: 0xe2b07b }, stripe: { color: 0xf0c98f } },
      { base: { color: 0x50545e }, borderLongA: { color: 0x9198a2 }, borderLongB: { color: 0x9198a2 }, borderShortA: { color: 0x9198a2 }, borderShortB: { color: 0x9198a2 }, stripe: { color: 0x70c9d6 } },
    ],
    parts: [
      { name: 'base', x: 0, y: 0.01, z: 0, w: 3.9, h: 0.04, l: 2.9, color: 0x496b8a },
      { name: 'borderLongA', x: 0, y: 0.05, z: -1.36, w: 3.65, h: 0.015, l: 0.12, color: 0xa8cce0 },
      { name: 'borderLongB', x: 0, y: 0.05, z: 1.36, w: 3.65, h: 0.015, l: 0.12, color: 0xa8cce0 },
      { name: 'borderShortA', x: -1.86, y: 0.05, z: 0, w: 0.12, h: 0.015, l: 2.6, color: 0xa8cce0 },
      { name: 'borderShortB', x: 1.86, y: 0.05, z: 0, w: 0.12, h: 0.015, l: 2.6, color: 0xa8cce0 },
      { name: 'stripe', x: 0, y: 0.05, z: 0, w: 2.3, h: 0.018, l: 0.1, color: 0x73d8e6 },
    ],
  },
  runnerRug: {
    id: 'runnerRug', name: 'Runner Rug', zoneTypes: ['officeSpace', 'meetingRoom', 'reception'],
    cost: { funding: 95 }, energyCost: 0, spriteColor: 0x67568a,
    gridW: 4, gridH: 1, subH: 0.06, spriteKey: 'runnerRug', mount: 'floor',
    effects: {}, baseMaterial: null, hasSurface: false,
    variants: ['Plum', 'Teal', 'Ochre'],
    variantPreviewColors: [0x67568a, 0x3f7b78, 0xb18135],
    variantOverrides: [
      {},
      { base: { color: 0x3f7b78 }, railA: { color: 0x9bd0c8 }, railB: { color: 0x9bd0c8 }, dash1: { color: 0xd5eee8 }, dash2: { color: 0xd5eee8 }, dash3: { color: 0xd5eee8 } },
      { base: { color: 0xb18135 }, railA: { color: 0xf0d291 }, railB: { color: 0xf0d291 }, dash1: { color: 0xffe5a9 }, dash2: { color: 0xffe5a9 }, dash3: { color: 0xffe5a9 } },
    ],
    parts: [
      { name: 'base', x: 0, y: 0.01, z: 0, w: 3.9, h: 0.04, l: 0.9, color: 0x67568a },
      { name: 'railA', x: 0, y: 0.05, z: -0.34, w: 3.65, h: 0.015, l: 0.08, color: 0xb8a8d9 },
      { name: 'railB', x: 0, y: 0.05, z: 0.34, w: 3.65, h: 0.015, l: 0.08, color: 0xb8a8d9 },
      { name: 'dash1', x: -1.15, y: 0.05, z: 0, w: 0.55, h: 0.018, l: 0.08, color: 0xe0d7f0 },
      { name: 'dash2', x: 0, y: 0.05, z: 0, w: 0.55, h: 0.018, l: 0.08, color: 0xe0d7f0 },
      { name: 'dash3', x: 1.15, y: 0.05, z: 0, w: 0.55, h: 0.018, l: 0.08, color: 0xe0d7f0 },
    ],
  },

  // ── Generic room furniture ──────────────────────────────────────────

  visitorArmchair: {
    id: 'visitorArmchair', name: 'Visitor Armchair', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge'], furnitureGroup: 'seating',
    cost: { funding: 520 }, energyCost: 0, spriteColor: 0x536b78, gridW: 1, gridH: 1, subH: 2, spriteKey: 'visitorArmchair', effects: { morale: 2 }, baseMaterial: null, hasSurface: false,
    parts: [
      { name: 'seat', x: 0, y: 0.68, z: -0.04, w: 0.86, h: 0.28, l: 0.74, color: 0x536b78 }, { name: 'back', x: 0, y: 1.3, z: 0.28, w: 0.88, h: 1.1, l: 0.18, color: 0x49616e },
      { name: 'armL', x: -0.43, y: 0.9, z: 0, w: 0.14, h: 0.58, l: 0.78, color: 0x49616e }, { name: 'armR', x: 0.43, y: 0.9, z: 0, w: 0.14, h: 0.58, l: 0.78, color: 0x49616e },
      { name: 'legL', x: -0.3, y: 0, z: -0.22, w: 0.1, h: 0.18, l: 0.1, color: 0x30343a }, { name: 'legR', x: 0.3, y: 0, z: -0.22, w: 0.1, h: 0.18, l: 0.1, color: 0x30343a },
    ],
  },
  ottoman: {
    id: 'ottoman', name: 'Ottoman', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge'], furnitureGroup: 'seating',
    cost: { funding: 260 }, energyCost: 0, spriteColor: 0x6b4a3c, gridW: 1, gridH: 1, subH: 1, spriteKey: 'ottoman', effects: { morale: 1 }, baseMaterial: null, hasSurface: false,
    parts: [
      { name: 'cushion', x: 0, y: 0.44, z: 0, w: 0.78, h: 0.42, l: 0.62, color: 0x6b4a3c }, { name: 'base', x: 0, y: 0.12, z: 0, w: 0.7, h: 0.22, l: 0.54, color: 0x4a3027 },
      { name: 'footL', x: -0.25, y: 0, z: -0.18, w: 0.1, h: 0.14, l: 0.1, color: 0x30241d }, { name: 'footR', x: 0.25, y: 0, z: -0.18, w: 0.1, h: 0.14, l: 0.1, color: 0x30241d },
    ],
  },
  credenza: {
    id: 'credenza', name: 'Credenza', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge'], furnitureGroup: 'storage',
    cost: { funding: 880 }, energyCost: 0, spriteColor: 0x70482d, gridW: 3, gridH: 1, subH: 2, spriteKey: 'credenza', effects: { morale: 1 }, baseMaterial: 'tile_hardwood',
    parts: [
      { name: 'body', x: 0, y: 0.6, z: 0, w: 2.8, h: 1.1, l: 0.72, color: 0x70482d }, { name: 'top', x: 0, y: 1.22, z: 0, w: 2.94, h: 0.12, l: 0.82, color: 0x9b6638 },
      { name: 'doorL', x: -0.94, y: 0.6, z: -0.38, w: 0.78, h: 0.8, l: 0.04, color: 0x805333 }, { name: 'doorC', x: 0, y: 0.6, z: -0.38, w: 0.78, h: 0.8, l: 0.04, color: 0x805333 }, { name: 'doorR', x: 0.94, y: 0.6, z: -0.38, w: 0.78, h: 0.8, l: 0.04, color: 0x805333 },
      { name: 'footL', x: -1.05, y: 0, z: 0, w: 0.14, h: 0.24, l: 0.14, color: 0x34251d }, { name: 'footR', x: 1.05, y: 0, z: 0, w: 0.14, h: 0.24, l: 0.14, color: 0x34251d },
    ],
  },
  wastebasket: {
    id: 'wastebasket', name: 'Wastebasket', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge', 'cafeteria'], furnitureGroup: 'support',
    cost: { funding: 90 }, energyCost: 0, spriteColor: 0x68727b, gridW: 1, gridH: 1, subH: 1, spriteKey: 'wastebasket', effects: {}, baseMaterial: null, stackable: true,
    parts: [
      { name: 'bin', x: 0, y: 0.38, z: 0, w: 0.52, h: 0.72, l: 0.52, color: 0x68727b }, { name: 'rim', x: 0, y: 0.76, z: 0, w: 0.58, h: 0.08, l: 0.58, color: 0x89939b }, { name: 'liner', x: 0, y: 0.78, z: 0, w: 0.42, h: 0.04, l: 0.42, color: 0x30343a },
    ],
  },
  deskOrganizer: {
    id: 'deskOrganizer', name: 'Desk Organizer', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception'], furnitureGroup: 'support',
    cost: { funding: 85 }, energyCost: 0, spriteColor: 0x5d7180, gridW: 1, gridH: 1, subH: 1, spriteKey: 'deskOrganizer', effects: {}, baseMaterial: null, stackable: true,
    parts: [
      { name: 'tray', x: 0, y: 0.08, z: 0, w: 0.48, h: 0.16, l: 0.34, color: 0x5d7180 }, { name: 'folder1', x: -0.12, y: 0.28, z: 0, w: 0.1, h: 0.36, l: 0.2, color: 0xc38c4e }, { name: 'folder2', x: 0.04, y: 0.28, z: 0, w: 0.1, h: 0.42, l: 0.2, color: 0x648aa0 }, { name: 'cup', x: 0.18, y: 0.2, z: 0, w: 0.12, h: 0.24, l: 0.12, color: 0xd4cab4 },
    ],
  },
  displayScreen: {
    id: 'displayScreen', name: 'Wall Display', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge'], furnitureGroup: 'presentation',
    cost: { funding: 1150 }, energyCost: 0.15, spriteColor: 0x345473, gridW: 3, gridH: 1, subH: 3, spriteKey: 'displayScreen', effects: { morale: 1 }, baseMaterial: 'metal_dark', hasSurface: false,
    parts: [
      { name: 'case', x: 0, y: 1.45, z: 0, w: 2.72, h: 1.65, l: 0.12, color: 0x252c34 }, { name: 'screen', x: 0, y: 1.45, z: -0.08, w: 2.42, h: 1.35, l: 0.03, color: 0x345473 }, { name: 'trace', x: -0.15, y: 1.36, z: -0.1, w: 1.72, h: 0.04, l: 0.02, color: 0x6bd3c4 },
      { name: 'mountL', x: -0.92, y: 0.54, z: 0.02, w: 0.12, h: 0.32, l: 0.12, color: 0x515a63 }, { name: 'mountR', x: 0.92, y: 0.54, z: 0.02, w: 0.12, h: 0.32, l: 0.12, color: 0x515a63 },
    ],
  },
  flipChart: {
    id: 'flipChart', name: 'Flip Chart', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge'], furnitureGroup: 'presentation',
    cost: { funding: 240 }, energyCost: 0, spriteColor: 0xe5dfc9, gridW: 2, gridH: 1, subH: 3, spriteKey: 'flipChart', effects: { morale: 1, research: 0.01 }, baseMaterial: null, hasSurface: false,
    parts: [
      { name: 'paper', x: 0, y: 1.72, z: 0, w: 1.55, h: 1.82, l: 0.08, color: 0xe5dfc9 }, { name: 'header', x: 0, y: 2.58, z: -0.05, w: 1.42, h: 0.08, l: 0.03, color: 0x52778a }, { name: 'line1', x: -0.12, y: 2.05, z: -0.06, w: 0.72, h: 0.04, l: 0.03, color: 0x6c8d9a }, { name: 'line2', x: 0.14, y: 1.72, z: -0.06, w: 0.84, h: 0.04, l: 0.03, color: 0x6c8d9a },
      { name: 'legL', x: -0.62, y: 0, z: 0, w: 0.1, h: 1.62, l: 0.1, color: 0x4c5961 }, { name: 'legR', x: 0.62, y: 0, z: 0, w: 0.1, h: 1.62, l: 0.1, color: 0x4c5961 }, { name: 'tray', x: 0, y: 0.42, z: -0.12, w: 1.18, h: 0.08, l: 0.26, color: 0x596c75 },
    ],
  },
  bulletinBoard: {
    id: 'bulletinBoard', name: 'Bulletin Board', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge', 'cafeteria'], furnitureGroup: 'presentation',
    cost: { funding: 190 }, energyCost: 0, spriteColor: 0x76553d, gridW: 3, gridH: 1, subH: 3, spriteKey: 'bulletinBoard', effects: { morale: 1 }, baseMaterial: null, hasSurface: false,
    parts: [
      { name: 'board', x: 0, y: 1.42, z: 0, w: 2.72, h: 1.82, l: 0.1, color: 0x76553d }, { name: 'frameTop', x: 0, y: 2.38, z: -0.04, w: 2.88, h: 0.1, l: 0.14, color: 0x9a6b40 }, { name: 'frameBottom', x: 0, y: 0.46, z: -0.04, w: 2.88, h: 0.1, l: 0.14, color: 0x9a6b40 },
      { name: 'note1', x: -0.72, y: 1.68, z: -0.08, w: 0.42, h: 0.48, l: 0.03, color: 0xe3cf8b }, { name: 'note2', x: 0.06, y: 1.22, z: -0.08, w: 0.46, h: 0.54, l: 0.03, color: 0xb7d5df }, { name: 'note3', x: 0.76, y: 1.78, z: -0.08, w: 0.38, h: 0.44, l: 0.03, color: 0xe1a38a },
    ],
  },
  umbrellaStand: {
    id: 'umbrellaStand', name: 'Umbrella Stand', zoneTypes: ['reception', 'officeSpace', 'meetingRoom'], furnitureGroup: 'support',
    cost: { funding: 160 }, energyCost: 0, spriteColor: 0x566872, gridW: 1, gridH: 1, subH: 2, spriteKey: 'umbrellaStand', effects: { morale: 1 }, baseMaterial: 'metal_dark', hasSurface: false,
    parts: [
      { name: 'base', x: 0, y: 0.05, z: 0, w: 0.64, h: 0.1, l: 0.64, color: 0x30363b }, { name: 'body', x: 0, y: 0.56, z: 0, w: 0.52, h: 0.96, l: 0.52, color: 0x566872 }, { name: 'rim', x: 0, y: 1.05, z: 0, w: 0.58, h: 0.08, l: 0.58, color: 0x81919a },
      { name: 'umbrella1', x: -0.1, y: 1.5, z: 0, w: 0.05, h: 0.92, l: 0.05, color: 0x26333b }, { name: 'umbrella2', x: 0.1, y: 1.55, z: 0, w: 0.05, h: 1.02, l: 0.05, color: 0x8b4d3a },
    ],
  },
  badgePrinter: {
    id: 'badgePrinter', name: 'Badge Printer', zoneTypes: ['reception'], furnitureGroup: 'support',
    cost: { funding: 640 }, energyCost: 0.1, spriteColor: 0x78838b, gridW: 1, gridH: 1, subH: 2, spriteKey: 'badgePrinter', effects: { morale: 1 }, baseMaterial: 'metal_painted_white', stackable: true,
    parts: [
      { name: 'body', x: 0, y: 0.28, z: 0, w: 0.78, h: 0.52, l: 0.58, color: 0x78838b }, { name: 'top', x: 0, y: 0.56, z: 0.04, w: 0.68, h: 0.12, l: 0.46, color: 0x9ca6ab }, { name: 'badge', x: 0, y: 0.18, z: -0.32, w: 0.28, h: 0.08, l: 0.03, color: 0xe5e0c5 }, { name: 'status', x: 0.22, y: 0.57, z: -0.24, w: 0.06, h: 0.06, l: 0.02, color: 0x55dd88 },
    ],
  },
  dishwasher: {
    id: 'dishwasher', name: 'Dishwasher', zoneTypes: ['cafeteria', 'kitchen'], furnitureGroup: 'support',
    cost: { funding: 1100 }, energyCost: 0.6, spriteColor: 0xb6bbc0, gridW: 1, gridH: 1, subH: 2, spriteKey: 'dishwasher', effects: { morale: 1 }, baseMaterial: 'metal_painted_white',
    parts: [
      { name: 'body', x: 0, y: 0.62, z: 0, w: 0.92, h: 1.24, l: 0.72, color: 0xb6bbc0 }, { name: 'door', x: 0, y: 0.62, z: -0.38, w: 0.76, h: 0.64, l: 0.04, color: 0x737b82 }, { name: 'handle', x: 0, y: 0.96, z: -0.43, w: 0.42, h: 0.06, l: 0.04, color: 0xd5d8da }, { name: 'status', x: 0.25, y: 1.42, z: -0.42, w: 0.06, h: 0.06, l: 0.02, color: 0x55dd88 },
    ],
  },
  warmingCabinet: {
    id: 'warmingCabinet', name: 'Warming Cabinet', zoneTypes: ['cafeteria', 'kitchen'], furnitureGroup: 'hospitality',
    cost: { funding: 1300 }, energyCost: 0.8, spriteColor: 0x8f6240, gridW: 1, gridH: 1, subH: 3, spriteKey: 'warmingCabinet', effects: { morale: 2 }, baseMaterial: 'metal_dark',
    parts: [
      { name: 'body', x: 0, y: 0.9, z: 0, w: 0.92, h: 1.82, l: 0.72, color: 0x8f6240 }, { name: 'door', x: 0, y: 0.94, z: -0.38, w: 0.74, h: 1.48, l: 0.04, color: 0x4d3430 }, { name: 'window', x: 0, y: 1.34, z: -0.42, w: 0.46, h: 0.5, l: 0.03, color: 0xc07143 }, { name: 'handle', x: 0.3, y: 0.94, z: -0.44, w: 0.06, h: 0.42, l: 0.04, color: 0xc8a15c },
    ],
  },
  plateStation: {
    id: 'plateStation', name: 'Plate & Cutlery Station', zoneTypes: ['cafeteria', 'kitchen'], furnitureGroup: 'hospitality',
    cost: { funding: 360 }, energyCost: 0, spriteColor: 0x9a6b40, gridW: 2, gridH: 1, subH: 2, spriteKey: 'plateStation', effects: { morale: 1 }, baseMaterial: 'tile_hardwood',
    parts: [
      { name: 'body', x: 0, y: 0.6, z: 0, w: 1.72, h: 1.08, l: 0.62, color: 0x7a5130 }, { name: 'top', x: 0, y: 1.22, z: 0, w: 1.84, h: 0.12, l: 0.72, color: 0x9a6b40 }, { name: 'plates', x: -0.48, y: 1.36, z: -0.08, w: 0.46, h: 0.18, l: 0.46, color: 0xd9d3c2 }, { name: 'trays', x: 0.22, y: 1.34, z: -0.08, w: 0.58, h: 0.1, l: 0.32, color: 0x78878b }, { name: 'cutlery', x: 0.62, y: 1.4, z: 0.05, w: 0.18, h: 0.24, l: 0.18, color: 0xb7bec0 },
    ],
  },
  readingLamp: {
    id: 'readingLamp', name: 'Reading Lamp', zoneTypes: ['facultyLounge', 'officeSpace', 'privateOffice', 'meetingRoom'], furnitureGroup: 'decor',
    cost: { funding: 240 }, energyCost: 0.08, spriteColor: 0xd0ad62, gridW: 1, gridH: 1, subH: 4, spriteKey: 'readingLamp', effects: { morale: 2 }, baseMaterial: null, hasSurface: false,
    parts: [
      { name: 'base', x: 0, y: 0.05, z: 0, w: 0.46, h: 0.1, l: 0.46, color: 0x4c4030 }, { name: 'stem', x: 0, y: 1.35, z: 0, w: 0.08, h: 2.55, l: 0.08, color: 0xb28d4f }, { name: 'shade', x: 0, y: 2.46, z: 0, w: 0.7, h: 0.38, l: 0.7, color: 0xd0ad62 }, { name: 'cord', x: 0.16, y: 0.16, z: 0, w: 0.04, h: 0.18, l: 0.04, color: 0x24282c },
    ],
  },
  globe: {
    id: 'globe', name: 'Academic Globe', zoneTypes: ['facultyLounge', 'officeSpace', 'privateOffice', 'meetingRoom', 'reception'], furnitureGroup: 'decor',
    cost: { funding: 340 }, energyCost: 0, spriteColor: 0x47758a, gridW: 1, gridH: 1, subH: 2, spriteKey: 'globe', effects: { morale: 2 }, baseMaterial: null, stackable: true,
    parts: [
      { name: 'base', x: 0, y: 0.08, z: 0, w: 0.5, h: 0.12, l: 0.5, color: 0x9a6b40 }, { name: 'stand', x: 0, y: 0.42, z: 0, w: 0.08, h: 0.62, l: 0.08, color: 0x9a6b40 }, { name: 'globe', x: 0, y: 0.76, z: 0, w: 0.58, h: 0.58, l: 0.58, color: 0x47758a }, { name: 'equator', x: 0, y: 0.76, z: -0.3, w: 0.48, h: 0.04, l: 0.03, color: 0xd1b46c },
    ],
  },
  chessTable: {
    id: 'chessTable', name: 'Chess Table', zoneTypes: ['facultyLounge'], furnitureGroup: 'tables',
    cost: { funding: 640 }, energyCost: 0, spriteColor: 0x80532f, gridW: 2, gridH: 2, subH: 2, surfaceY: 1.25, spriteKey: 'chessTable', effects: { morale: 3 }, baseMaterial: 'tile_hardwood',
    parts: [
      { name: 'top', x: 0, y: 1.22, z: 0, w: 1.62, h: 0.12, l: 1.62, color: 0x80532f }, { name: 'board', x: 0, y: 1.3, z: 0, w: 1.12, h: 0.04, l: 1.12, color: 0xd2b783 }, { name: 'pedestal', x: 0, y: 0.56, z: 0, w: 0.28, h: 1.25, l: 0.28, color: 0x4d3021 }, { name: 'foot', x: 0, y: 0.08, z: 0, w: 0.82, h: 0.16, l: 0.82, color: 0x4d3021 },
      { name: 'piece1', x: -0.32, y: 1.38, z: -0.18, w: 0.08, h: 0.18, l: 0.08, color: 0xeee7d3 }, { name: 'piece2', x: 0.24, y: 1.38, z: 0.22, w: 0.08, h: 0.22, l: 0.08, color: 0x332820 },
    ],
  },
  drinksTrolley: {
    id: 'drinksTrolley', name: 'Drinks Trolley', zoneTypes: ['facultyLounge', 'reception', 'meetingRoom'], furnitureGroup: 'hospitality',
    cost: { funding: 580 }, energyCost: 0, spriteColor: 0x9a6b40, gridW: 2, gridH: 1, subH: 2, spriteKey: 'drinksTrolley', effects: { morale: 2 }, baseMaterial: 'tile_hardwood', hasSurface: false,
    parts: [
      { name: 'top', x: 0, y: 1.32, z: 0, w: 1.62, h: 0.12, l: 0.72, color: 0x9a6b40 }, { name: 'lower', x: 0, y: 0.58, z: 0, w: 1.5, h: 0.08, l: 0.64, color: 0x70482d }, { name: 'postL', x: -0.62, y: 0.16, z: 0.2, w: 0.08, h: 1.24, l: 0.08, color: 0x70482d }, { name: 'postR', x: 0.62, y: 0.16, z: 0.2, w: 0.08, h: 1.24, l: 0.08, color: 0x70482d },
      { name: 'bottle1', x: -0.38, y: 1.5, z: 0, w: 0.14, h: 0.42, l: 0.14, color: 0x6b8b55 }, { name: 'bottle2', x: 0, y: 1.5, z: 0, w: 0.14, h: 0.54, l: 0.14, color: 0x9c6b34 }, { name: 'glass', x: 0.42, y: 1.46, z: 0, w: 0.18, h: 0.2, l: 0.18, color: 0xc2d7d2 },
    ],
  },

  // ── Shared room furniture ──────────────────────────────────────────

  sharedCounter: {
    id: 'sharedCounter', name: 'Service Counter', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge', 'cafeteria'], furnitureGroup: 'tables',
    cost: { funding: 780 }, energyCost: 0, spriteColor: 0x80603c, gridW: 3, gridH: 1, subH: 2, surfaceY: 1.55, spriteKey: 'sharedCounter', effects: { morale: 1 }, baseMaterial: 'tile_hardwood',
    parts: [
      { name: 'top', x: 0, y: 1.52, z: 0, w: 2.8, h: 0.14, l: 0.82, color: 0x966a3f }, { name: 'front', x: 0, y: 0.76, z: 0.28, w: 2.65, h: 1.35, l: 0.12, color: 0x614127 },
      { name: 'shelf', x: 0, y: 0.62, z: -0.18, w: 2.45, h: 0.08, l: 0.5, color: 0x7a5130 }, { name: 'legL', x: -1.16, y: 0, z: 0.2, w: 0.14, h: 1.45, l: 0.14, color: 0x3e2b20 }, { name: 'legR', x: 1.16, y: 0, z: 0.2, w: 0.14, h: 1.45, l: 0.14, color: 0x3e2b20 },
    ],
  },
  coffeeStation: {
    id: 'coffeeStation', name: 'Coffee Station', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge', 'cafeteria'], furnitureGroup: 'hospitality',
    cost: { funding: 950 }, energyCost: 0.2, spriteColor: 0x5a4030, gridW: 2, gridH: 1, subH: 2, surfaceY: 1.35, spriteKey: 'coffeeStation', effects: { morale: 3 }, baseMaterial: 'tile_hardwood',
    parts: [
      { name: 'cabinet', x: 0, y: 0.6, z: 0.12, w: 1.75, h: 1.18, l: 0.68, color: 0x63432c }, { name: 'top', x: 0, y: 1.25, z: 0.03, w: 1.9, h: 0.12, l: 0.78, color: 0x986b3d },
      { name: 'machine', x: -0.42, y: 1.5, z: -0.04, w: 0.52, h: 0.42, l: 0.48, color: 0x31373a }, { name: 'carafe', x: 0.28, y: 1.53, z: -0.08, w: 0.22, h: 0.42, l: 0.22, color: 0x9b6d3f }, { name: 'mug1', x: 0.68, y: 1.48, z: -0.1, w: 0.18, h: 0.16, l: 0.18, color: 0xd8cdb7 },
      { name: 'doorL', x: -0.44, y: 0.62, z: -0.36, w: 0.64, h: 0.92, l: 0.03, color: 0x704d31 }, { name: 'doorR', x: 0.44, y: 0.62, z: -0.36, w: 0.64, h: 0.92, l: 0.03, color: 0x704d31 },
    ],
  },
  snackTable: {
    id: 'snackTable', name: 'Snack Table', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge', 'cafeteria'], furnitureGroup: 'hospitality',
    cost: { funding: 420 }, energyCost: 0, spriteColor: 0xc08a4b, gridW: 2, gridH: 1, subH: 2, surfaceY: 1.25, spriteKey: 'snackTable', effects: { morale: 2 }, baseMaterial: 'tile_hardwood',
    parts: [
      { name: 'top', x: 0, y: 1.22, z: 0, w: 1.72, h: 0.12, l: 0.78, color: 0xc08a4b }, { name: 'shelf', x: 0, y: 0.52, z: 0.16, w: 1.48, h: 0.08, l: 0.52, color: 0x8f6136 },
      { name: 'legL', x: -0.68, y: 0, z: 0, w: 0.12, h: 1.15, l: 0.12, color: 0x58402b }, { name: 'legR', x: 0.68, y: 0, z: 0, w: 0.12, h: 1.15, l: 0.12, color: 0x58402b },
      { name: 'bowl', x: -0.42, y: 1.36, z: -0.06, w: 0.36, h: 0.16, l: 0.36, color: 0xd2a35e }, { name: 'plate', x: 0.25, y: 1.3, z: -0.06, w: 0.52, h: 0.06, l: 0.34, color: 0xe0d4bb }, { name: 'napkins', x: 0.62, y: 1.38, z: 0.1, w: 0.24, h: 0.22, l: 0.24, color: 0xb7c8d0 },
    ],
  },
  bookcaseWide: {
    id: 'bookcaseWide', name: 'Wide Bookcase', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge'], furnitureGroup: 'storage',
    cost: { funding: 680 }, energyCost: 0, spriteColor: 0x65432b, gridW: 3, gridH: 1, subH: 4, spriteKey: 'bookcaseWide', effects: { morale: 2 }, baseMaterial: 'tile_hardwood', hasSurface: false,
    parts: [
      { name: 'case', x: 0, y: 0.08, z: 0, w: 2.82, h: 3.7, l: 0.55, color: 0x65432b }, { name: 'shelf1', x: 0, y: 0.7, z: -0.12, w: 2.56, h: 0.08, l: 0.46, color: 0x3e2b20 }, { name: 'shelf2', x: 0, y: 1.52, z: -0.12, w: 2.56, h: 0.08, l: 0.46, color: 0x3e2b20 }, { name: 'shelf3', x: 0, y: 2.34, z: -0.12, w: 2.56, h: 0.08, l: 0.46, color: 0x3e2b20 }, { name: 'shelf4', x: 0, y: 3.16, z: -0.12, w: 2.56, h: 0.08, l: 0.46, color: 0x3e2b20 },
      { name: 'bookA', x: -0.8, y: 0.95, z: -0.3, w: 0.22, h: 0.5, l: 0.08, color: 0x8d4b3e }, { name: 'bookB', x: -0.48, y: 0.98, z: -0.3, w: 0.2, h: 0.56, l: 0.08, color: 0x486f83 }, { name: 'bookC', x: 0.72, y: 1.78, z: -0.3, w: 0.24, h: 0.62, l: 0.08, color: 0x9b7541 }, { name: 'bookD', x: 0.2, y: 2.6, z: -0.3, w: 0.2, h: 0.54, l: 0.08, color: 0x4e775b },
    ],
  },
  glassBookcase: {
    id: 'glassBookcase', name: 'Glass-Front Bookcase', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge'], furnitureGroup: 'storage',
    cost: { funding: 1100 }, energyCost: 0, spriteColor: 0x5d4b3d, gridW: 2, gridH: 1, subH: 4, spriteKey: 'glassBookcase', effects: { morale: 2 }, baseMaterial: 'tile_hardwood', hasSurface: false,
    parts: [
      { name: 'case', x: 0, y: 0.08, z: 0, w: 1.78, h: 3.72, l: 0.58, color: 0x5d4b3d }, { name: 'glass', x: 0, y: 1.76, z: -0.31, w: 1.48, h: 3.0, l: 0.04, color: 0x91aeb2 }, { name: 'shelf1', x: 0, y: 0.85, z: -0.15, w: 1.48, h: 0.07, l: 0.42, color: 0x3e2b20 }, { name: 'shelf2', x: 0, y: 1.65, z: -0.15, w: 1.48, h: 0.07, l: 0.42, color: 0x3e2b20 }, { name: 'shelf3', x: 0, y: 2.45, z: -0.15, w: 1.48, h: 0.07, l: 0.42, color: 0x3e2b20 },
      { name: 'book1', x: -0.4, y: 1.06, z: -0.34, w: 0.22, h: 0.42, l: 0.06, color: 0x9b5444 }, { name: 'book2', x: 0.24, y: 1.86, z: -0.34, w: 0.22, h: 0.5, l: 0.06, color: 0x4e7280 }, { name: 'book3', x: -0.12, y: 2.65, z: -0.34, w: 0.2, h: 0.46, l: 0.06, color: 0xb08245 },
    ],
  },
  sideboard: {
    id: 'sideboard', name: 'Sideboard', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge'], furnitureGroup: 'storage',
    cost: { funding: 720 }, energyCost: 0, spriteColor: 0x74482d, gridW: 3, gridH: 1, subH: 2, spriteKey: 'sideboard', effects: { morale: 1 }, baseMaterial: 'tile_hardwood',
    parts: [
      { name: 'body', x: 0, y: 0.58, z: 0, w: 2.78, h: 1.08, l: 0.72, color: 0x74482d }, { name: 'top', x: 0, y: 1.2, z: 0, w: 2.92, h: 0.12, l: 0.82, color: 0x9a6538 }, { name: 'doorL', x: -0.86, y: 0.62, z: -0.38, w: 0.74, h: 0.78, l: 0.04, color: 0x815333 }, { name: 'doorC', x: 0, y: 0.62, z: -0.38, w: 0.74, h: 0.78, l: 0.04, color: 0x815333 }, { name: 'doorR', x: 0.86, y: 0.62, z: -0.38, w: 0.74, h: 0.78, l: 0.04, color: 0x815333 },
      { name: 'footL', x: -1.05, y: 0, z: 0, w: 0.14, h: 0.25, l: 0.14, color: 0x35271d }, { name: 'footR', x: 1.05, y: 0, z: 0, w: 0.14, h: 0.25, l: 0.14, color: 0x35271d },
    ],
  },
  endTable: {
    id: 'endTable', name: 'End Table', zoneTypes: ['officeSpace', 'privateOffice', 'meetingRoom', 'reception', 'facultyLounge'], furnitureGroup: 'tables',
    cost: { funding: 260 }, energyCost: 0, spriteColor: 0x825331, gridW: 1, gridH: 1, subH: 2, surfaceY: 1.2, spriteKey: 'endTable', effects: { morale: 1 }, baseMaterial: 'tile_hardwood',
    parts: [
      { name: 'top', x: 0, y: 1.18, z: 0, w: 0.82, h: 0.1, l: 0.82, color: 0x9b6638 }, { name: 'shelf', x: 0, y: 0.5, z: 0, w: 0.58, h: 0.07, l: 0.58, color: 0x74482d }, { name: 'leg1', x: -0.28, y: 0, z: -0.28, w: 0.1, h: 1.1, l: 0.1, color: 0x4b3425 }, { name: 'leg2', x: 0.28, y: 0, z: -0.28, w: 0.1, h: 1.1, l: 0.1, color: 0x4b3425 }, { name: 'lamp', x: 0, y: 1.5, z: 0, w: 0.28, h: 0.42, l: 0.28, color: 0xd6b878 },
    ],
  },

  // ── Faculty lounge ─────────────────────────────────────────────────

  clubChair: {
    id: 'clubChair', name: 'Leather Club Chair', zoneType: 'facultyLounge', cost: { funding: 900 }, energyCost: 0,
    spriteColor: 0x2f6f68, gridW: 2, gridH: 2, subH: 2, spriteKey: 'clubChair', effects: { morale: 3 }, baseMaterial: null, hasSurface: false,
    parts: [
      { name: 'seatBase', x: 0, y: 0.12, z: 0, w: 1.82, h: 0.12, l: 0.82, color: 0x183f3c }, { name: 'seat', x: 0, y: 0.72, z: -0.08, w: 1.76, h: 0.28, l: 0.72, color: 0x3e8a80 },
      { name: 'back', x: 0, y: 1.32, z: 0.28, w: 1.82, h: 1.12, l: 0.22, color: 0x2f6962 }, { name: 'armL', x: -0.86, y: 0.92, z: 0.02, w: 0.16, h: 0.66, l: 0.78, color: 0x34766f }, { name: 'armR', x: 0.86, y: 0.92, z: 0.02, w: 0.16, h: 0.66, l: 0.78, color: 0x34766f },
      { name: 'studL1', x: -0.43, y: 1.46, z: 0.14, w: 0.06, h: 0.06, l: 0.04, color: 0xc19a55 }, { name: 'studL2', x: -0.43, y: 1.08, z: 0.14, w: 0.06, h: 0.06, l: 0.04, color: 0xc19a55 }, { name: 'studR1', x: 0.43, y: 1.46, z: 0.14, w: 0.06, h: 0.06, l: 0.04, color: 0xc19a55 }, { name: 'studR2', x: 0.43, y: 1.08, z: 0.14, w: 0.06, h: 0.06, l: 0.04, color: 0xc19a55 },
      { name: 'legL', x: -0.68, y: 0, z: -0.25, w: 0.12, h: 0.18, l: 0.12, color: 0x2b211b }, { name: 'legR', x: 0.68, y: 0, z: -0.25, w: 0.12, h: 0.18, l: 0.12, color: 0x2b211b },
    ],
  },
  tuftedSofa: {
    id: 'tuftedSofa', name: 'Tufted Leather Sofa', zoneType: 'facultyLounge', cost: { funding: 2200 }, energyCost: 0,
    spriteColor: 0x6d405f, gridW: 3, gridH: 1, subH: 2, spriteKey: 'tuftedSofa', effects: { morale: 5 }, baseMaterial: null, hasSurface: false,
    parts: [
      { name: 'base', x: 0, y: 0.15, z: 0, w: 2.8, h: 0.28, l: 0.86, color: 0x43253b }, { name: 'seat', x: 0, y: 0.7, z: -0.08, w: 2.62, h: 0.3, l: 0.7, color: 0x7d4969 }, { name: 'back', x: 0, y: 1.3, z: 0.28, w: 2.72, h: 1.08, l: 0.22, color: 0x693b5b },
      { name: 'armL', x: -1.34, y: 0.88, z: 0, w: 0.2, h: 0.78, l: 0.86, color: 0x713f61 }, { name: 'armR', x: 1.34, y: 0.88, z: 0, w: 0.2, h: 0.78, l: 0.86, color: 0x713f61 },
      { name: 'tuft1', x: -0.7, y: 1.34, z: 0.14, w: 0.12, h: 0.12, l: 0.04, color: 0xa26278 }, { name: 'tuft2', x: 0, y: 1.34, z: 0.14, w: 0.12, h: 0.12, l: 0.04, color: 0xa26278 }, { name: 'tuft3', x: 0.7, y: 1.34, z: 0.14, w: 0.12, h: 0.12, l: 0.04, color: 0xa26278 },
      { name: 'footL', x: -1, y: 0, z: -0.22, w: 0.18, h: 0.2, l: 0.18, color: 0x2b211b }, { name: 'footR', x: 1, y: 0, z: -0.22, w: 0.18, h: 0.2, l: 0.18, color: 0x2b211b },
    ],
  },
  clawFootTable: {
    id: 'clawFootTable', name: 'Claw-Foot Cocktail Table', zoneType: 'facultyLounge', cost: { funding: 1250 }, energyCost: 0,
    spriteColor: 0x6a482d, gridW: 2, gridH: 2, subH: 2, surfaceY: 1.25, spriteKey: 'clawFootTable', effects: { morale: 2 }, baseMaterial: 'tile_hardwood',
    parts: [
      { name: 'top', x: 0, y: 1.25, z: 0, w: 1.72, h: 0.12, l: 1.72, color: 0x754d2d }, { name: 'inlay', x: 0, y: 1.32, z: 0, w: 1.34, h: 0.03, l: 1.34, color: 0xc39a55 }, { name: 'pedestal', x: 0, y: 0.38, z: 0, w: 0.28, h: 1, l: 0.28, color: 0x4d3021 },
      { name: 'footN', x: 0, y: 0.08, z: 0.45, w: 0.18, h: 0.16, l: 0.8, color: 0x4d3021 }, { name: 'footS', x: 0, y: 0.08, z: -0.45, w: 0.18, h: 0.16, l: 0.8, color: 0x4d3021 }, { name: 'footE', x: 0.45, y: 0.08, z: 0, w: 0.8, h: 0.16, l: 0.18, color: 0x4d3021 }, { name: 'footW', x: -0.45, y: 0.08, z: 0, w: 0.8, h: 0.16, l: 0.18, color: 0x4d3021 },
      { name: 'clawN', x: 0, y: 0.18, z: 0.75, w: 0.22, h: 0.24, l: 0.22, color: 0x8a633b }, { name: 'clawS', x: 0, y: 0.18, z: -0.75, w: 0.22, h: 0.24, l: 0.22, color: 0x8a633b },
    ],
  },
  drinksCabinet: {
    id: 'drinksCabinet', name: 'Drinks Cabinet', zoneType: 'facultyLounge', cost: { funding: 1800 }, energyCost: 0.15,
    spriteColor: 0x246b75, gridW: 2, gridH: 1, subH: 3, spriteKey: 'drinksCabinet', effects: { morale: 4 }, baseMaterial: null, hasSurface: false,
    parts: [
      { name: 'body', x: 0, y: 0.08, z: 0, w: 1.8, h: 2.72, l: 0.72, color: 0x1f5962 }, { name: 'top', x: 0, y: 2.8, z: 0, w: 1.94, h: 0.12, l: 0.82, color: 0x3e8a89 }, { name: 'glassL', x: -0.47, y: 1.82, z: -0.38, w: 0.72, h: 1.32, l: 0.03, color: 0x9ed0ca }, { name: 'glassR', x: 0.47, y: 1.82, z: -0.38, w: 0.72, h: 1.32, l: 0.03, color: 0x9ed0ca },
      { name: 'shelf', x: 0, y: 1.35, z: -0.18, w: 1.55, h: 0.06, l: 0.42, color: 0x173b43 }, { name: 'bottle1', x: -0.42, y: 1.52, z: -0.28, w: 0.16, h: 0.58, l: 0.16, color: 0xe0a23b }, { name: 'bottle2', x: -0.12, y: 1.52, z: -0.28, w: 0.16, h: 0.7, l: 0.16, color: 0x79b85b }, { name: 'bottle3', x: 0.3, y: 1.52, z: -0.28, w: 0.16, h: 0.52, l: 0.16, color: 0xd45b55 },
      { name: 'drawerL', x: -0.48, y: 0.52, z: -0.38, w: 0.68, h: 0.48, l: 0.04, color: 0x2b7580 }, { name: 'drawerR', x: 0.48, y: 0.52, z: -0.38, w: 0.68, h: 0.48, l: 0.04, color: 0x2b7580 },
    ],
  },
  facultyBar: {
    id: 'facultyBar', name: 'Faculty Bar', zoneType: 'facultyLounge', cost: { funding: 2600 }, energyCost: 0.1,
    spriteColor: 0x7a3f68, gridW: 4, gridH: 2, subH: 2, surfaceY: 1.5, spriteKey: 'facultyBar', effects: { morale: 5 }, baseMaterial: null,
    parts: [
      { name: 'counter', x: 0, y: 1.45, z: 0, w: 3.8, h: 0.18, l: 0.82, color: 0xc27a5e }, { name: 'front', x: 0, y: 0.7, z: 0.3, w: 3.6, h: 1.38, l: 0.14, color: 0x632d52 }, { name: 'rail', x: 0, y: 0.48, z: -0.42, w: 3.4, h: 0.08, l: 0.08, color: 0xd6b15f }, { name: 'legL', x: -1.65, y: 0, z: 0.2, w: 0.14, h: 1.4, l: 0.14, color: 0x302039 }, { name: 'legR', x: 1.65, y: 0, z: 0.2, w: 0.14, h: 1.4, l: 0.14, color: 0x302039 },
      { name: 'bottle1', x: -1.05, y: 1.62, z: 0.06, w: 0.16, h: 0.52, l: 0.16, color: 0x79b85b }, { name: 'bottle2', x: -0.72, y: 1.62, z: 0.06, w: 0.16, h: 0.68, l: 0.16, color: 0xe0a23b }, { name: 'bottle3', x: 0.84, y: 1.62, z: 0.06, w: 0.16, h: 0.6, l: 0.16, color: 0xd45b55 }, { name: 'glass1', x: 1.2, y: 1.57, z: -0.18, w: 0.18, h: 0.18, l: 0.18, color: 0xd4eee6 }, { name: 'glass2', x: 1.48, y: 1.57, z: -0.18, w: 0.18, h: 0.18, l: 0.18, color: 0xd4eee6 },
    ],
  },
  chalkboard: {
    id: 'chalkboard', name: 'Chalkboard', zoneType: 'facultyLounge', cost: { funding: 320 }, energyCost: 0,
    spriteColor: 0x183f3a, gridW: 3, gridH: 1, subH: 3, spriteKey: 'chalkboard', effects: { morale: 1, research: 0.03 }, baseMaterial: null, hasSurface: false,
    parts: [
      { name: 'board', x: 0, y: 1.65, z: 0, w: 2.72, h: 2.1, l: 0.1, color: 0x183f3a }, { name: 'frameTop', x: 0, y: 2.75, z: -0.02, w: 2.9, h: 0.12, l: 0.16, color: 0x9a7144 }, { name: 'frameBottom', x: 0, y: 0.55, z: -0.02, w: 2.9, h: 0.12, l: 0.16, color: 0x9a7144 },
      { name: 'chalk1', x: -0.82, y: 2, z: -0.08, w: 0.8, h: 0.04, l: 0.03, color: 0xe8e2c9 }, { name: 'chalk2', x: 0.12, y: 1.6, z: -0.08, w: 0.62, h: 0.04, l: 0.03, color: 0xcadbe0 }, { name: 'chalk3', x: 0.52, y: 2.22, z: -0.08, w: 0.5, h: 0.04, l: 0.03, color: 0xe6d1a7 }, { name: 'chalkTray', x: 0, y: 0.42, z: -0.12, w: 2.55, h: 0.1, l: 0.3, color: 0x5b3c28 },
      { name: 'legL', x: -1.1, y: 0, z: 0, w: 0.12, h: 0.52, l: 0.12, color: 0x4b3425 }, { name: 'legR', x: 1.1, y: 0, z: 0, w: 0.12, h: 0.52, l: 0.12, color: 0x4b3425 },
    ],
  },
  newspaperStand: {
    id: 'newspaperStand', name: 'Newspaper Stand', zoneType: 'facultyLounge', cost: { funding: 260 }, energyCost: 0,
    spriteColor: 0x416b82, gridW: 1, gridH: 1, subH: 2, spriteKey: 'newspaperStand', effects: { morale: 2 }, baseMaterial: null, hasSurface: false,
    parts: [
      { name: 'base', x: 0, y: 0.04, z: 0, w: 0.82, h: 0.08, l: 0.5, color: 0x263e52 }, { name: 'post', x: 0, y: 0.12, z: 0.12, w: 0.1, h: 1.45, l: 0.1, color: 0x416b82 }, { name: 'rack', x: 0, y: 1.2, z: 0, w: 0.9, h: 0.8, l: 0.5, color: 0x3b6075 },
      { name: 'paperA', x: -0.2, y: 1.42, z: -0.28, w: 0.26, h: 0.52, l: 0.03, color: 0xe8e3d2 }, { name: 'paperB', x: 0.12, y: 1.38, z: -0.28, w: 0.28, h: 0.58, l: 0.03, color: 0xd9e1e5 }, { name: 'paperC', x: 0.37, y: 1.35, z: -0.28, w: 0.22, h: 0.48, l: 0.03, color: 0xe6d2b6 },
    ],
  },
  cigarAshtray: {
    id: 'cigarAshtray', name: 'Cigar Ashtray', zoneType: 'facultyLounge', cost: { funding: 140 }, energyCost: 0,
    spriteColor: 0x8f9398, gridW: 1, gridH: 1, subH: 1, spriteKey: 'cigarAshtray', effects: { morale: 1 }, baseMaterial: null, stackable: true,
    parts: [
      { name: 'dish', x: 0, y: 0.08, z: 0, w: 0.58, h: 0.12, l: 0.58, color: 0x9da3a7 }, { name: 'rim', x: 0, y: 0.17, z: 0, w: 0.48, h: 0.06, l: 0.48, color: 0xc1a35e }, { name: 'cigar', x: 0.06, y: 0.23, z: 0, w: 0.12, h: 0.08, l: 0.46, color: 0x9b4e2d }, { name: 'ember', x: 0.27, y: 0.24, z: 0, w: 0.08, h: 0.08, l: 0.08, color: 0xe06a32 },
    ],
  },

  // ── Reception ─────────────────────────────────────────────────────

  waitingBench: {
    id: 'waitingBench', name: 'Waiting Bench', zoneTypes: ['reception', 'officeSpace'],
    cost: { funding: 650 }, energyCost: 0, spriteColor: 0x55718a,
    gridW: 3, gridH: 1, subH: 2, spriteKey: 'waitingBench',
    effects: { morale: 2 }, baseMaterial: 'metal_dark', hasSurface: false,
    parts: [
      { name: 'footL', x: -1.05, y: 0, z: 0, w: 0.55, h: 0.08, l: 0.75, material: 'metal_dark' },
      { name: 'footR', x: 1.05, y: 0, z: 0, w: 0.55, h: 0.08, l: 0.75, material: 'metal_dark' },
      { name: 'legL', x: -1.05, y: 0.08, z: 0.18, w: 0.09, h: 0.72, l: 0.09, material: 'metal_brushed' },
      { name: 'legR', x: 1.05, y: 0.08, z: 0.18, w: 0.09, h: 0.72, l: 0.09, material: 'metal_brushed' },
      { name: 'seat', x: 0, y: 0.8, z: -0.08, w: 2.8, h: 0.16, l: 0.72, color: 0x55718a },
      { name: 'back', x: 0, y: 0.96, z: 0.34, w: 2.8, h: 0.78, l: 0.12, color: 0x49657d },
      { name: 'dividerL', x: -0.47, y: 0.82, z: -0.08, w: 0.04, h: 0.18, l: 0.68, color: 0x33475a },
      { name: 'dividerR', x: 0.47, y: 0.82, z: -0.08, w: 0.04, h: 0.18, l: 0.68, color: 0x33475a },
    ],
  },
  visitorKiosk: {
    id: 'visitorKiosk', name: 'Visitor Check-In Kiosk', zoneType: 'reception',
    cost: { funding: 1400 }, energyCost: 0.12, spriteColor: 0x667985,
    gridW: 1, gridH: 1, subH: 3, spriteKey: 'visitorKiosk',
    effects: { morale: 1 }, baseMaterial: 'metal_brushed', hasSurface: false,
    parts: [
      { name: 'base', x: 0, y: 0, z: 0.1, w: 0.75, h: 0.1, l: 0.72, material: 'metal_dark' },
      { name: 'pedestal', x: 0, y: 0.1, z: 0.12, w: 0.34, h: 1.75, l: 0.32, material: 'metal_brushed' },
      { name: 'screenCase', x: 0, y: 1.85, z: 0, w: 0.88, h: 0.9, l: 0.18, color: 0x303842 },
      { name: 'screen', x: 0, y: 1.96, z: -0.1, w: 0.72, h: 0.58, l: 0.03, color: 0x5fc2d4 },
      { name: 'scanShelf', x: 0, y: 1.55, z: -0.24, w: 0.58, h: 0.08, l: 0.35, material: 'metal_brushed' },
      { name: 'scanner', x: 0, y: 1.65, z: -0.28, w: 0.34, h: 0.06, l: 0.22, color: 0x1f2429 },
      { name: 'status', x: 0.33, y: 2.58, z: -0.11, w: 0.08, h: 0.08, l: 0.03, color: 0x66dd88 },
    ],
  },
  brochureRack: {
    id: 'brochureRack', name: 'Brochure Rack', zoneTypes: ['reception', 'officeSpace'],
    cost: { funding: 220 }, energyCost: 0, spriteColor: 0x7b8790,
    gridW: 1, gridH: 1, subH: 3, spriteKey: 'brochureRack',
    effects: { morale: 1 }, baseMaterial: 'metal_brushed', hasSurface: false,
    parts: [
      { name: 'base', x: 0, y: 0, z: 0.12, w: 0.75, h: 0.08, l: 0.62, material: 'metal_dark' },
      { name: 'back', x: 0, y: 0.08, z: 0.22, w: 0.72, h: 2.45, l: 0.08, material: 'metal_brushed' },
      { name: 'pocket1', x: 0, y: 0.35, z: -0.08, w: 0.66, h: 0.55, l: 0.38, color: 0x58656d },
      { name: 'pocket2', x: 0, y: 1.02, z: -0.08, w: 0.66, h: 0.55, l: 0.38, color: 0x65737c },
      { name: 'pocket3', x: 0, y: 1.69, z: -0.08, w: 0.66, h: 0.55, l: 0.38, color: 0x72818a },
      { name: 'leaflet1', x: -0.18, y: 0.68, z: -0.3, w: 0.24, h: 0.38, l: 0.03, color: 0xd98f55 },
      { name: 'leaflet2', x: 0.16, y: 1.35, z: -0.3, w: 0.26, h: 0.38, l: 0.03, color: 0x5ca1c7 },
      { name: 'leaflet3', x: 0, y: 2.02, z: -0.3, w: 0.3, h: 0.38, l: 0.03, color: 0x77ad69 },
    ],
  },
  coatRack: {
    id: 'coatRack', name: 'Coat Rack', zoneTypes: ['reception', 'officeSpace', 'meetingRoom'],
    cost: { funding: 160 }, energyCost: 0, spriteColor: 0x5a4a3a,
    gridW: 1, gridH: 1, subH: 4, spriteKey: 'coatRack',
    effects: { morale: 1 }, baseMaterial: 'metal_dark', hasSurface: false,
    parts: [
      { name: 'baseX', x: 0, y: 0.04, z: 0, w: 0.85, h: 0.08, l: 0.13, material: 'metal_dark' },
      { name: 'baseZ', x: 0, y: 0.04, z: 0, w: 0.13, h: 0.08, l: 0.85, material: 'metal_dark' },
      { name: 'post', x: 0, y: 0.12, z: 0, w: 0.12, h: 3.45, l: 0.12, color: 0x5a4a3a },
      { name: 'armX', x: 0, y: 3.1, z: 0, w: 0.82, h: 0.1, l: 0.1, color: 0x5a4a3a },
      { name: 'armZ', x: 0, y: 3.32, z: 0, w: 0.1, h: 0.1, l: 0.82, color: 0x5a4a3a },
      { name: 'cap', x: 0, y: 3.57, z: 0, w: 0.22, h: 0.16, l: 0.22, color: 0x8a735d },
    ],
  },

  // ── Storage and general back-of-house fixtures ───────────────────

  utilityShelving: {
    id: 'utilityShelving', name: 'Utility Shelving', zoneTypes: ['storageRoom', 'maintenance'],
    cost: { funding: 420 }, energyCost: 0, spriteColor: 0x7a858d,
    gridW: 3, gridH: 1, subH: 5, spriteKey: 'utilityShelving',
    effects: {}, baseMaterial: 'metal_brushed', hasSurface: false,
    parts: [
      { name: 'postFL', x: -1.36, y: 0, z: -0.38, w: 0.1, h: 4.8, l: 0.1, material: 'metal_dark' },
      { name: 'postFR', x: 1.36, y: 0, z: -0.38, w: 0.1, h: 4.8, l: 0.1, material: 'metal_dark' },
      { name: 'postBL', x: -1.36, y: 0, z: 0.38, w: 0.1, h: 4.8, l: 0.1, material: 'metal_dark' },
      { name: 'postBR', x: 1.36, y: 0, z: 0.38, w: 0.1, h: 4.8, l: 0.1, material: 'metal_dark' },
      { name: 'shelf1', x: 0, y: 0.18, z: 0, w: 2.85, h: 0.09, l: 0.9, material: 'metal_brushed' },
      { name: 'shelf2', x: 0, y: 1.32, z: 0, w: 2.85, h: 0.09, l: 0.9, material: 'metal_brushed' },
      { name: 'shelf3', x: 0, y: 2.46, z: 0, w: 2.85, h: 0.09, l: 0.9, material: 'metal_brushed' },
      { name: 'shelf4', x: 0, y: 3.6, z: 0, w: 2.85, h: 0.09, l: 0.9, material: 'metal_brushed' },
      { name: 'boxA', x: -0.82, y: 0.27, z: 0, w: 0.82, h: 0.68, l: 0.72, color: 0xa5794d },
      { name: 'boxB', x: 0.1, y: 1.41, z: 0, w: 1.08, h: 0.7, l: 0.72, color: 0x8e6b46 },
      { name: 'case', x: 0.88, y: 2.55, z: 0, w: 0.72, h: 0.52, l: 0.7, color: 0x404951 },
    ],
  },
  palletRack: {
    id: 'palletRack', name: 'Pallet Rack', zoneTypes: ['storageRoom', 'maintenance'],
    cost: { funding: 1250 }, energyCost: 0, spriteColor: 0xc68a38,
    gridW: 4, gridH: 2, subH: 5, spriteKey: 'palletRack',
    effects: {}, baseMaterial: 'metal_dark', hasSurface: false,
    parts: [
      { name: 'uprightL', x: -1.82, y: 0, z: 0, w: 0.16, h: 4.9, l: 1.75, color: 0x315f86 },
      { name: 'uprightR', x: 1.82, y: 0, z: 0, w: 0.16, h: 4.9, l: 1.75, color: 0x315f86 },
      { name: 'beamLow', x: 0, y: 0.3, z: 0, w: 3.7, h: 0.18, l: 0.16, color: 0xc68a38 },
      { name: 'beamMid', x: 0, y: 2.35, z: 0, w: 3.7, h: 0.18, l: 0.16, color: 0xc68a38 },
      { name: 'beamTop', x: 0, y: 4.35, z: 0, w: 3.7, h: 0.18, l: 0.16, color: 0xc68a38 },
      { name: 'palletLow', x: 0, y: 0.48, z: 0, w: 3.35, h: 0.15, l: 1.65, color: 0x8b633d },
      { name: 'loadLowL', x: -0.86, y: 0.63, z: 0, w: 1.45, h: 1.35, l: 1.45, color: 0xa9794d },
      { name: 'loadLowR', x: 0.86, y: 0.63, z: 0, w: 1.45, h: 1.35, l: 1.45, color: 0x96704d },
      { name: 'palletHigh', x: 0, y: 2.53, z: 0, w: 3.35, h: 0.15, l: 1.65, color: 0x8b633d },
      { name: 'loadHigh', x: 0, y: 2.68, z: 0, w: 2.75, h: 1.25, l: 1.4, color: 0x6d7f8a },
    ],
  },
  partsBinRack: {
    id: 'partsBinRack', name: 'Parts Bin Rack', zoneTypes: ['storageRoom', 'maintenance'],
    cost: { funding: 680 }, energyCost: 0, spriteColor: 0x4f7892,
    gridW: 2, gridH: 1, subH: 4, spriteKey: 'partsBinRack',
    effects: {}, baseMaterial: 'metal_brushed', hasSurface: false,
    parts: [
      { name: 'frame', x: 0, y: 0, z: 0.34, w: 1.9, h: 3.8, l: 0.12, material: 'metal_brushed' },
      { name: 'bin1', x: -0.58, y: 0.25, z: -0.08, w: 0.52, h: 0.62, l: 0.72, color: 0x3f7194 },
      { name: 'bin2', x: 0, y: 0.25, z: -0.08, w: 0.52, h: 0.62, l: 0.72, color: 0x527f45 },
      { name: 'bin3', x: 0.58, y: 0.25, z: -0.08, w: 0.52, h: 0.62, l: 0.72, color: 0xa06d3c },
      { name: 'bin4', x: -0.58, y: 1.08, z: -0.08, w: 0.52, h: 0.62, l: 0.72, color: 0x8a5a76 },
      { name: 'bin5', x: 0, y: 1.08, z: -0.08, w: 0.52, h: 0.62, l: 0.72, color: 0x3f7194 },
      { name: 'bin6', x: 0.58, y: 1.08, z: -0.08, w: 0.52, h: 0.62, l: 0.72, color: 0x527f45 },
      { name: 'bin7', x: -0.58, y: 1.91, z: -0.08, w: 0.52, h: 0.62, l: 0.72, color: 0xa06d3c },
      { name: 'bin8', x: 0, y: 1.91, z: -0.08, w: 0.52, h: 0.62, l: 0.72, color: 0x8a5a76 },
      { name: 'bin9', x: 0.58, y: 1.91, z: -0.08, w: 0.52, h: 0.62, l: 0.72, color: 0x3f7194 },
      { name: 'labelRail', x: 0, y: 3.05, z: -0.05, w: 1.72, h: 0.32, l: 0.5, color: 0x545f68 },
    ],
  },
  lockerBank: {
    id: 'lockerBank', name: 'Locker Bank', zoneTypes: ['storageRoom', 'maintenance'],
    cost: { funding: 850 }, energyCost: 0, spriteColor: 0x78838b,
    gridW: 3, gridH: 1, subH: 4, spriteKey: 'lockerBank',
    effects: { morale: 1 }, baseMaterial: 'metal_painted_white', hasSurface: false,
    parts: [
      { name: 'body', x: 0, y: 0, z: 0, w: 2.9, h: 3.85, l: 0.9, material: 'metal_painted_white' },
      { name: 'doorL', x: -0.96, y: 0.12, z: -0.46, w: 0.86, h: 3.48, l: 0.04, color: 0x737f88 },
      { name: 'doorC', x: 0, y: 0.12, z: -0.46, w: 0.86, h: 3.48, l: 0.04, color: 0x7d8991 },
      { name: 'doorR', x: 0.96, y: 0.12, z: -0.46, w: 0.86, h: 3.48, l: 0.04, color: 0x737f88 },
      { name: 'ventL', x: -0.96, y: 3.08, z: -0.49, w: 0.42, h: 0.16, l: 0.03, color: 0x313840 },
      { name: 'ventC', x: 0, y: 3.08, z: -0.49, w: 0.42, h: 0.16, l: 0.03, color: 0x313840 },
      { name: 'ventR', x: 0.96, y: 3.08, z: -0.49, w: 0.42, h: 0.16, l: 0.03, color: 0x313840 },
      { name: 'handleL', x: -0.67, y: 1.65, z: -0.5, w: 0.08, h: 0.3, l: 0.04, material: 'metal_dark' },
      { name: 'handleC', x: 0.29, y: 1.65, z: -0.5, w: 0.08, h: 0.3, l: 0.04, material: 'metal_dark' },
      { name: 'handleR', x: 1.25, y: 1.65, z: -0.5, w: 0.08, h: 0.3, l: 0.04, material: 'metal_dark' },
    ],
  },
  packingTable: {
    id: 'packingTable', name: 'Packing Table', zoneTypes: ['storageRoom', 'maintenance'],
    cost: { funding: 600 }, energyCost: 0, spriteColor: 0x8d765b,
    gridW: 3, gridH: 2, subH: 3, surfaceY: 1.8, spriteKey: 'packingTable',
    effects: {}, baseMaterial: 'tile_hardwood',
    parts: [
      { name: 'legFL', x: -1.25, y: 0, z: -0.72, w: 0.12, h: 1.7, l: 0.12, material: 'metal_dark' },
      { name: 'legFR', x: 1.25, y: 0, z: -0.72, w: 0.12, h: 1.7, l: 0.12, material: 'metal_dark' },
      { name: 'legBL', x: -1.25, y: 0, z: 0.72, w: 0.12, h: 1.7, l: 0.12, material: 'metal_dark' },
      { name: 'legBR', x: 1.25, y: 0, z: 0.72, w: 0.12, h: 1.7, l: 0.12, material: 'metal_dark' },
      { name: 'top', x: 0, y: 1.7, z: 0, w: 2.9, h: 0.12, l: 1.85, material: 'tile_hardwood' },
      { name: 'lowerShelf', x: 0, y: 0.55, z: 0.28, w: 2.55, h: 0.1, l: 1.1, material: 'metal_brushed' },
      { name: 'box', x: 0.72, y: 1.82, z: 0.18, w: 1.05, h: 0.62, l: 0.82, color: 0xa8794f },
      { name: 'tape', x: -0.75, y: 1.82, z: -0.28, w: 0.34, h: 0.28, l: 0.34, color: 0xd4a43f },
      { name: 'paperRoll', x: -0.15, y: 1.82, z: 0.32, w: 0.68, h: 0.3, l: 0.3, color: 0xd9d0b8 },
    ],
  },
  supplyCart: {
    id: 'supplyCart', name: 'Supply Cart', zoneTypes: ['storageRoom', 'maintenance'],
    cost: { funding: 320 }, energyCost: 0, spriteColor: 0x637d8b,
    gridW: 2, gridH: 1, subH: 3, surfaceY: 1.75, spriteKey: 'supplyCart',
    effects: {}, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'wheelFL', x: -0.75, y: 0, z: -0.3, w: 0.16, h: 0.16, l: 0.16, material: 'metal_dark' },
      { name: 'wheelFR', x: 0.75, y: 0, z: -0.3, w: 0.16, h: 0.16, l: 0.16, material: 'metal_dark' },
      { name: 'wheelBL', x: -0.75, y: 0, z: 0.3, w: 0.16, h: 0.16, l: 0.16, material: 'metal_dark' },
      { name: 'wheelBR', x: 0.75, y: 0, z: 0.3, w: 0.16, h: 0.16, l: 0.16, material: 'metal_dark' },
      { name: 'lowerShelf', x: 0, y: 0.35, z: 0, w: 1.75, h: 0.1, l: 0.8, color: 0x536b78 },
      { name: 'middleShelf', x: 0, y: 0.95, z: 0, w: 1.75, h: 0.1, l: 0.8, color: 0x5c7481 },
      { name: 'top', x: 0, y: 1.65, z: 0, w: 1.9, h: 0.1, l: 0.95, color: 0x637d8b },
      { name: 'postL', x: -0.75, y: 0.16, z: 0.3, w: 0.08, h: 1.49, l: 0.08, material: 'metal_brushed' },
      { name: 'postR', x: 0.75, y: 0.16, z: 0.3, w: 0.08, h: 1.49, l: 0.08, material: 'metal_brushed' },
      { name: 'handle', x: 0.92, y: 1.38, z: 0, w: 0.08, h: 0.55, l: 0.7, material: 'metal_brushed' },
      { name: 'bin', x: -0.45, y: 1.05, z: 0, w: 0.68, h: 0.5, l: 0.62, color: 0x4f7791 },
    ],
  },
  monitorBank: {
    id: 'monitorBank', name: 'Monitor Bank', zoneType: 'controlRoom',
    cost: { funding: 8000 }, energyCost: 0.8, spriteColor: 0x44bb66,
    requiredConnections: ['powerCable', 'dataFiber'],
    gridW: 4, gridH: 2, subH: 3, spriteKey: 'monitorBank',
    effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_painted_white',
    // Wall-mounted with the bracket flush against +Z; screens project
    // toward -Z, so the viewer stands one subtile north of the footprint,
    // facing south at the bank.
    station: { jobs: ['runBeam'], slots: 1, seated: 'preferred',
      anchors: [{ subCol: 1, subRow: -1, facing: 's' }] },
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
    id: 'serverRack', name: 'All-in-One Capture Rack', zoneType: 'controlRoom',
    cost: { funding: 15000 }, energyCost: 3.0, spriteColor: 0x3a3e4a,
    requiredConnections: ['powerCable'],
    gridW: 1, gridH: 2, subH: 5, spriteKey: 'serverRack',
    effects: {
      zoneOutput: 0.08, research: 0.03,
      // The starter control-room data backbone and fiber gateway: it captures
      // detector streams, keeps a raw-data buffer, and has just enough mixed
      // compute for one modest experiment. Larger facilities scale each axis
      // independently with dedicated buffer and compute racks below.
      dataSystem: { kind: 'allInOne', ingest: 8, storage: 240, cpu: 5, gpu: 3 },
    }, baseMaterial: 'metal_dark',
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
  dataAppliance: {
    id: 'dataAppliance', name: 'Compact Capture Appliance', zoneType: 'controlRoom',
    cost: { funding: 8000 }, energyCost: 1.2, spriteColor: 0x3f6274,
    requiredConnections: ['powerCable'],
    gridW: 1, gridH: 1, subH: 3, spriteKey: 'serverRack',
    effects: { zoneOutput: 0.04, dataSystem: { kind: 'allInOne', ingest: 4, storage: 60, cpu: 2, gpu: 1 } },
    baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'server_cluster_front' } },
  },
  dataStorageRack: {
    id: 'dataStorageRack', name: 'Raw Data Buffer', zoneType: 'controlRoom',
    cost: { funding: 45000 }, energyCost: 4.0, spriteColor: 0x426a8a,
    requiredConnections: ['powerCable', 'dataFiber'],
    gridW: 1, gridH: 2, subH: 5, spriteKey: 'serverRack',
    effects: { zoneOutput: 0.04, dataSystem: { kind: 'storage', storage: 3000 } },
    baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'server_cluster_front' } },
  },
  cpuComputeRack: {
    id: 'cpuComputeRack', name: 'CPU Compute Rack', zoneType: 'controlRoom',
    cost: { funding: 70000 }, energyCost: 9.0, spriteColor: 0x56884b,
    requiredConnections: ['powerCable', 'dataFiber'],
    gridW: 1, gridH: 2, subH: 5, spriteKey: 'serverRack',
    effects: { zoneOutput: 0.05, research: 0.02, dataSystem: { kind: 'cpu', cpu: 40 } },
    baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'server_cluster_front' } },
  },
  gpuComputeRack: {
    id: 'gpuComputeRack', name: 'GPU Compute Rack', zoneType: 'controlRoom',
    cost: { funding: 110000 }, energyCost: 16.0, spriteColor: 0x7650a5,
    requiredConnections: ['powerCable', 'dataFiber'],
    gridW: 1, gridH: 2, subH: 5, spriteKey: 'serverRack',
    effects: { zoneOutput: 0.05, research: 0.03, dataSystem: { kind: 'gpu', gpu: 65 } },
    baseMaterial: 'metal_dark', faces: { '+Z': { decal: 'server_cluster_front' } },
  },
  operatorConsole: {
    id: 'operatorConsole', name: 'Operator Console', zoneType: 'controlRoom',
    cost: { funding: 25000 }, energyCost: 0.5, spriteColor: 0x44aa66,
    requiredConnections: ['powerCable', 'dataFiber'],
    gridW: 3, gridH: 2, subH: 3, surfaceY: 1.48, spriteKey: 'operatorConsole',
    effects: { zoneOutput: 0.07 }, baseMaterial: 'metal_painted_white',
    // Worked from the -Z side (keyboard tray sits at -Z, monitor bank rises
    // behind it at +Z); anchor one subtile north of the footprint, facing
    // south into the console.
    station: { jobs: ['runBeam'], slots: 1, seated: 'preferred',
      anchors: [{ subCol: 1, subRow: -1, facing: 's' }] },
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
    requiredConnections: ['powerCable', 'dataFiber'],
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
    // Symmetric table seating four, one on each side, each anchor facing
    // back into the table.
    station: { jobs: ['eat'], slots: 4, seated: 'required',
      anchors: [
        { subCol: 0, subRow: 2, facing: 'n' },
        { subCol: 1, subRow: -1, facing: 's' },
        { subCol: -1, subRow: 0, facing: 'e' },
        { subCol: 2, subRow: 1, facing: 'w' },
      ] },
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
  cafeTable: {
    id: 'cafeTable', name: 'Two-Seat Cafe Table', zoneType: 'cafeteria',
    cost: { funding: 250 }, energyCost: 0, spriteColor: 0xc68b4a,
    gridW: 1, gridH: 2, subH: 2, surfaceY: 1.5, spriteKey: 'cafeTable',
    effects: { morale: 1 }, baseMaterial: 'tile_hardwood',
    // Compact table for narrow break rooms. One chair fits at each short end.
    station: { jobs: ['eat'], slots: 2, seated: 'required',
      anchors: [
        { subCol: 0, subRow: 2, facing: 'n' },
        { subCol: 0, subRow: -1, facing: 's' },
      ] },
    parts: [
      { name: 'baseFront', x: 0, y: 0, z: -0.55, w: 0.65, h: 0.08, l: 0.55, material: 'metal_dark' },
      { name: 'baseBack', x: 0, y: 0, z: 0.55, w: 0.65, h: 0.08, l: 0.55, material: 'metal_dark' },
      { name: 'postFront', x: 0, y: 0.08, z: -0.55, w: 0.18, h: 1.32, l: 0.18, material: 'metal_dark' },
      { name: 'postBack', x: 0, y: 0.08, z: 0.55, w: 0.18, h: 1.32, l: 0.18, material: 'metal_dark' },
      { name: 'top', x: 0, y: 1.4, z: 0, w: 0.95, h: 0.1, l: 1.9, material: 'tile_hardwood' },
      { name: 'edge', x: 0, y: 1.36, z: 0, w: 1.0, h: 0.04, l: 1.95, color: 0x8c562c },
    ],
  },
  breakfastBar: {
    id: 'breakfastBar', name: 'Breakfast Bar', zoneType: 'cafeteria',
    cost: { funding: 750 }, energyCost: 0, spriteColor: 0xa96b3b,
    gridW: 3, gridH: 1, subH: 3, surfaceY: 2.05, spriteKey: 'breakfastBar',
    effects: { morale: 2 }, baseMaterial: 'tile_hardwood',
    // Space-efficient counter with all three seats along its open side.
    station: { jobs: ['eat'], slots: 3, seated: 'required',
      anchors: [
        { subCol: 0, subRow: 1, facing: 'n' },
        { subCol: 1, subRow: 1, facing: 'n' },
        { subCol: 2, subRow: 1, facing: 'n' },
      ] },
    parts: [
      { name: 'backPanel', x: 0, y: 0, z: 0.34, w: 2.9, h: 1.95, l: 0.18, color: 0x725036 },
      { name: 'kick', x: 0, y: 0, z: -0.32, w: 2.8, h: 0.14, l: 0.06, material: 'metal_dark' },
      { name: 'top', x: 0, y: 1.95, z: 0, w: 3.0, h: 0.1, l: 0.95, material: 'tile_hardwood' },
      { name: 'frontEdge', x: 0, y: 1.91, z: -0.49, w: 3.05, h: 0.12, l: 0.05, color: 0x8c562c },
      { name: 'footRail', x: 0, y: 0.55, z: -0.48, w: 2.75, h: 0.07, l: 0.07, material: 'metal_brushed' },
      { name: 'railPostL', x: -1.25, y: 0.22, z: -0.46, w: 0.07, h: 0.4, l: 0.07, material: 'metal_brushed' },
      { name: 'railPostR', x: 1.25, y: 0.22, z: -0.46, w: 0.07, h: 0.4, l: 0.07, material: 'metal_brushed' },
    ],
  },
  servingCounter: {
    id: 'servingCounter', name: 'Serving Counter', zoneTypes: ['cafeteria', 'kitchen'],
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
    id: 'vendingMachine', name: 'Vending Machine', zoneTypes: ['cafeteria', 'kitchen'],
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
    id: 'microwave', name: 'Microwave Station', zoneTypes: ['cafeteria', 'kitchen'],
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
    id: 'waterCooler', name: 'Water Cooler', zoneTypes: ['cafeteria', 'kitchen', 'officeSpace', 'reception', 'storageRoom'],
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
  cafeteriaRefrigerator: {
    id: 'cafeteriaRefrigerator', name: 'Refrigerator', zoneTypes: ['cafeteria', 'kitchen', 'storageRoom'],
    cost: { funding: 1800 }, energyCost: 0.4, spriteColor: 0xc7cbd2,
    gridW: 2, gridH: 1, subH: 4, spriteKey: 'cafeteriaRefrigerator',
    effects: { morale: 1 }, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'body', x: 0, y: 0, z: 0, w: 1.9, h: 3.8, l: 0.9, material: 'metal_brushed' },
      { name: 'leftDoor', x: -0.47, y: 0.08, z: -0.46, w: 0.9, h: 3.55, l: 0.04, color: 0xd9dde2 },
      { name: 'rightDoor', x: 0.47, y: 0.08, z: -0.46, w: 0.9, h: 3.55, l: 0.04, color: 0xd9dde2 },
      { name: 'seam', x: 0, y: 0.08, z: -0.49, w: 0.035, h: 3.55, l: 0.02, color: 0x4b5058 },
      { name: 'handleLeft', x: -0.12, y: 1.1, z: -0.51, w: 0.06, h: 1.35, l: 0.06, material: 'metal_dark' },
      { name: 'handleRight', x: 0.12, y: 1.1, z: -0.51, w: 0.06, h: 1.35, l: 0.06, material: 'metal_dark' },
      { name: 'topVent', x: 0, y: 3.65, z: -0.48, w: 1.7, h: 0.12, l: 0.04, color: 0x555a62 },
      { name: 'statusLight', x: 0.72, y: 3.5, z: -0.51, w: 0.08, h: 0.08, l: 0.02, color: 0x55cc77 },
    ],
  },
  sinkCounter: {
    id: 'sinkCounter', name: 'Sink Counter', zoneTypes: ['cafeteria', 'kitchen'],
    cost: { funding: 900 }, energyCost: 0, spriteColor: 0xb7bbc2,
    gridW: 2, gridH: 1, subH: 2, surfaceY: 1.55, spriteKey: 'sinkCounter',
    effects: { morale: 1 }, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'cabinet', x: 0, y: 0, z: 0.05, w: 1.9, h: 1.42, l: 0.88, color: 0x69737b },
      { name: 'leftDoor', x: -0.48, y: 0.12, z: -0.41, w: 0.82, h: 1.16, l: 0.04, color: 0x7d8991 },
      { name: 'rightDoor', x: 0.48, y: 0.12, z: -0.41, w: 0.82, h: 1.16, l: 0.04, color: 0x7d8991 },
      { name: 'top', x: 0, y: 1.42, z: 0, w: 2.0, h: 0.1, l: 1.0, material: 'metal_brushed' },
      { name: 'basin', x: 0, y: 1.53, z: 0, w: 1.15, h: 0.05, l: 0.62, color: 0x56616a },
      { name: 'faucetPost', x: 0, y: 1.53, z: 0.28, w: 0.08, h: 0.55, l: 0.08, material: 'metal_brushed' },
      { name: 'faucetNeck', x: 0, y: 2.0, z: 0.08, w: 0.08, h: 0.08, l: 0.42, material: 'metal_brushed' },
      { name: 'tapHot', x: -0.24, y: 1.56, z: 0.27, w: 0.16, h: 0.08, l: 0.08, color: 0xcc4b42 },
      { name: 'tapCold', x: 0.24, y: 1.56, z: 0.27, w: 0.16, h: 0.08, l: 0.08, color: 0x4488cc },
    ],
  },
  commercialRange: {
    id: 'commercialRange', name: 'Commercial Range', zoneType: 'kitchen', furnitureGroup: 'hospitality',
    cost: { funding: 4200 }, energyCost: 6.0, spriteColor: 0x8f979c,
    gridW: 3, gridH: 1, subH: 4, surfaceY: 1.5, spriteKey: 'commercialRange',
    effects: { morale: 2 }, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'ovenBody', x: 0, y: 0, z: 0.04, w: 2.9, h: 1.4, l: 0.9, material: 'metal_brushed' },
      { name: 'ovenDoor', x: 0, y: 0.18, z: -0.47, w: 2.45, h: 0.86, l: 0.04, color: 0x2b3034 },
      { name: 'ovenWindow', x: 0, y: 0.34, z: -0.5, w: 1.72, h: 0.48, l: 0.02, color: 0x15191d },
      { name: 'doorHandle', x: 0, y: 1.14, z: -0.52, w: 2.2, h: 0.08, l: 0.08, material: 'metal_dark' },
      { name: 'cooktop', x: 0, y: 1.4, z: 0, w: 3, h: 0.1, l: 1, material: 'metal_dark' },
      { name: 'burner1', x: -1, y: 1.51, z: -0.18, w: 0.55, h: 0.04, l: 0.55, color: 0x22272a },
      { name: 'burner2', x: 0, y: 1.51, z: -0.18, w: 0.55, h: 0.04, l: 0.55, color: 0x22272a },
      { name: 'burner3', x: 1, y: 1.51, z: -0.18, w: 0.55, h: 0.04, l: 0.55, color: 0x22272a },
      { name: 'backsplash', x: 0, y: 1.5, z: 0.43, w: 3, h: 0.7, l: 0.08, material: 'metal_brushed' },
      { name: 'hood', x: 0, y: 3.12, z: 0.16, w: 3.2, h: 0.55, l: 1.18, material: 'metal_brushed' },
      { name: 'hoodVent', x: 0, y: 3.1, z: -0.44, w: 2.6, h: 0.08, l: 0.06, color: 0x40474b },
      { name: 'flue', x: 0, y: 3.67, z: 0.28, w: 0.7, h: 0.33, l: 0.55, material: 'metal_dark' },
    ],
  },
  convectionOven: {
    id: 'convectionOven', name: 'Convection Oven', zoneType: 'kitchen', furnitureGroup: 'hospitality',
    cost: { funding: 5400 }, energyCost: 7.5, spriteColor: 0x939ba0,
    gridW: 2, gridH: 1, subH: 4, spriteKey: 'convectionOven',
    effects: { morale: 2 }, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'body', x: 0, y: 0, z: 0, w: 1.9, h: 3.8, l: 0.92, material: 'metal_brushed' },
      { name: 'upperDoor', x: -0.12, y: 2.02, z: -0.48, w: 1.5, h: 1.42, l: 0.04, color: 0x30373b },
      { name: 'upperGlass', x: -0.12, y: 2.25, z: -0.51, w: 1.12, h: 0.88, l: 0.02, color: 0x171c20 },
      { name: 'lowerDoor', x: -0.12, y: 0.3, z: -0.48, w: 1.5, h: 1.42, l: 0.04, color: 0x30373b },
      { name: 'lowerGlass', x: -0.12, y: 0.53, z: -0.51, w: 1.12, h: 0.88, l: 0.02, color: 0x171c20 },
      { name: 'upperHandle', x: -0.12, y: 3.35, z: -0.54, w: 1.28, h: 0.08, l: 0.08, material: 'metal_dark' },
      { name: 'lowerHandle', x: -0.12, y: 1.63, z: -0.54, w: 1.28, h: 0.08, l: 0.08, material: 'metal_dark' },
      { name: 'controlPanel', x: 0.72, y: 1.42, z: -0.5, w: 0.28, h: 1.1, l: 0.04, color: 0x4e585e },
      { name: 'display', x: 0.72, y: 2.12, z: -0.53, w: 0.18, h: 0.15, l: 0.02, color: 0x66d98b },
      { name: 'status', x: 0.72, y: 1.86, z: -0.53, w: 0.08, h: 0.08, l: 0.02, color: 0xf0b54c },
    ],
  },
  flatTopGrill: {
    id: 'flatTopGrill', name: 'Flat-Top Grill', zoneType: 'kitchen', furnitureGroup: 'hospitality',
    cost: { funding: 3200 }, energyCost: 5.5, spriteColor: 0x7e878c,
    gridW: 3, gridH: 1, subH: 3, surfaceY: 1.55, spriteKey: 'flatTopGrill',
    effects: { morale: 2 }, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'base', x: 0, y: 0, z: 0.05, w: 2.9, h: 1.4, l: 0.9, material: 'metal_brushed' },
      { name: 'griddle', x: 0, y: 1.4, z: -0.02, w: 2.85, h: 0.12, l: 0.88, color: 0x30363a },
      { name: 'backsplash', x: 0, y: 1.5, z: 0.44, w: 3, h: 0.58, l: 0.08, material: 'metal_brushed' },
      { name: 'greaseTray', x: 1.05, y: 1.52, z: -0.23, w: 0.52, h: 0.05, l: 0.38, color: 0x171b1e },
      { name: 'controlRail', x: 0, y: 1.08, z: -0.48, w: 2.72, h: 0.28, l: 0.06, color: 0x515a5f },
      { name: 'knob1', x: -0.92, y: 1.17, z: -0.53, w: 0.18, h: 0.18, l: 0.08, color: 0x25292c },
      { name: 'knob2', x: -0.31, y: 1.17, z: -0.53, w: 0.18, h: 0.18, l: 0.08, color: 0x25292c },
      { name: 'knob3', x: 0.31, y: 1.17, z: -0.53, w: 0.18, h: 0.18, l: 0.08, color: 0x25292c },
      { name: 'knob4', x: 0.92, y: 1.17, z: -0.53, w: 0.18, h: 0.18, l: 0.08, color: 0x25292c },
    ],
  },
  doubleFryer: {
    id: 'doubleFryer', name: 'Double Fryer', zoneType: 'kitchen', furnitureGroup: 'hospitality',
    cost: { funding: 2900 }, energyCost: 5.0, spriteColor: 0x8b9498,
    gridW: 2, gridH: 1, subH: 3, spriteKey: 'doubleFryer',
    effects: { morale: 1 }, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'base', x: 0, y: 0, z: 0.05, w: 1.9, h: 1.42, l: 0.9, material: 'metal_brushed' },
      { name: 'leftVat', x: -0.48, y: 1.42, z: -0.04, w: 0.78, h: 0.22, l: 0.72, color: 0x252a2d },
      { name: 'rightVat', x: 0.48, y: 1.42, z: -0.04, w: 0.78, h: 0.22, l: 0.72, color: 0x252a2d },
      { name: 'leftBasket', x: -0.48, y: 1.7, z: -0.02, w: 0.62, h: 0.45, l: 0.58, color: 0x7f898e },
      { name: 'rightBasket', x: 0.48, y: 1.7, z: -0.02, w: 0.62, h: 0.45, l: 0.58, color: 0x7f898e },
      { name: 'leftHandle', x: -0.48, y: 2.08, z: -0.62, w: 0.12, h: 0.12, l: 0.72, color: 0x24282b },
      { name: 'rightHandle', x: 0.48, y: 2.08, z: -0.62, w: 0.12, h: 0.12, l: 0.72, color: 0x24282b },
      { name: 'backsplash', x: 0, y: 1.48, z: 0.44, w: 2, h: 0.76, l: 0.08, material: 'metal_brushed' },
      { name: 'controls', x: 0, y: 1.06, z: -0.48, w: 1.72, h: 0.28, l: 0.05, color: 0x4a5358 },
    ],
  },
  prepCounter: {
    id: 'prepCounter', name: 'Stainless Prep Counter', zoneType: 'kitchen', furnitureGroup: 'tables',
    cost: { funding: 1200 }, energyCost: 0, spriteColor: 0xaeb6ba,
    gridW: 3, gridH: 1, subH: 2, surfaceY: 1.5, spriteKey: 'prepCounter',
    effects: { morale: 1 }, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'top', x: 0, y: 1.4, z: 0, w: 3, h: 0.1, l: 1, material: 'metal_brushed' },
      { name: 'undershelf', x: 0, y: 0.45, z: 0.04, w: 2.72, h: 0.08, l: 0.78, material: 'metal_brushed' },
      { name: 'legFL', x: -1.34, y: 0, z: -0.38, w: 0.1, h: 1.4, l: 0.1, material: 'metal_dark' },
      { name: 'legFR', x: 1.34, y: 0, z: -0.38, w: 0.1, h: 1.4, l: 0.1, material: 'metal_dark' },
      { name: 'legBL', x: -1.34, y: 0, z: 0.38, w: 0.1, h: 1.4, l: 0.1, material: 'metal_dark' },
      { name: 'legBR', x: 1.34, y: 0, z: 0.38, w: 0.1, h: 1.4, l: 0.1, material: 'metal_dark' },
      { name: 'cuttingBoard', x: -0.62, y: 1.51, z: -0.04, w: 1.15, h: 0.05, l: 0.66, color: 0xe0cfaa },
      { name: 'mixingBowl', x: 0.64, y: 1.52, z: 0, w: 0.62, h: 0.22, l: 0.62, color: 0x8d989e },
    ],
  },
  saladPrepStation: {
    id: 'saladPrepStation', name: 'Salad Prep Station', zoneType: 'kitchen', furnitureGroup: 'hospitality',
    cost: { funding: 2600 }, energyCost: 0.8, spriteColor: 0x79a66a,
    gridW: 3, gridH: 1, subH: 3, surfaceY: 1.5, spriteKey: 'saladPrepStation',
    effects: { morale: 2 }, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'refrigeratedBase', x: 0, y: 0, z: 0.05, w: 2.9, h: 1.4, l: 0.9, material: 'metal_brushed' },
      { name: 'doorL', x: -0.72, y: 0.16, z: -0.47, w: 1.22, h: 1.08, l: 0.04, color: 0x7f898e },
      { name: 'doorR', x: 0.72, y: 0.16, z: -0.47, w: 1.22, h: 1.08, l: 0.04, color: 0x7f898e },
      { name: 'top', x: 0, y: 1.4, z: 0, w: 3, h: 0.1, l: 1, material: 'metal_brushed' },
      { name: 'greensBin', x: -0.92, y: 1.51, z: 0, w: 0.72, h: 0.18, l: 0.66, color: 0x4f8e4d },
      { name: 'tomatoBin', x: 0, y: 1.51, z: 0, w: 0.72, h: 0.18, l: 0.66, color: 0xb94b43 },
      { name: 'toppingsBin', x: 0.92, y: 1.51, z: 0, w: 0.72, h: 0.18, l: 0.66, color: 0xd2b46d },
      { name: 'glass', x: 0, y: 1.66, z: 0.38, w: 2.9, h: 0.72, l: 0.04, color: 0xc6e1e6 },
      { name: 'postL', x: -1.35, y: 1.55, z: 0.38, w: 0.06, h: 0.9, l: 0.06, material: 'metal_brushed' },
      { name: 'postR', x: 1.35, y: 1.55, z: 0.38, w: 0.06, h: 0.9, l: 0.06, material: 'metal_brushed' },
    ],
  },
  pantryShelving: {
    id: 'pantryShelving', name: 'Pantry Shelving', zoneType: 'kitchen', furnitureGroup: 'storage',
    cost: { funding: 850 }, energyCost: 0, spriteColor: 0x8e7956,
    gridW: 3, gridH: 1, subH: 4, spriteKey: 'pantryShelving',
    effects: {}, baseMaterial: 'metal_dark',
    parts: [
      { name: 'postL', x: -1.35, y: 0, z: 0, w: 0.12, h: 3.8, l: 0.12, material: 'metal_dark' },
      { name: 'postR', x: 1.35, y: 0, z: 0, w: 0.12, h: 3.8, l: 0.12, material: 'metal_dark' },
      { name: 'shelf1', x: 0, y: 0.35, z: 0, w: 2.85, h: 0.1, l: 0.82, material: 'metal_brushed' },
      { name: 'shelf2', x: 0, y: 1.35, z: 0, w: 2.85, h: 0.1, l: 0.82, material: 'metal_brushed' },
      { name: 'shelf3', x: 0, y: 2.35, z: 0, w: 2.85, h: 0.1, l: 0.82, material: 'metal_brushed' },
      { name: 'shelf4', x: 0, y: 3.35, z: 0, w: 2.85, h: 0.1, l: 0.82, material: 'metal_brushed' },
      { name: 'flourBox', x: -0.82, y: 0.46, z: 0, w: 0.72, h: 0.68, l: 0.62, color: 0xd2c49b },
      { name: 'riceBox', x: 0.08, y: 0.46, z: 0, w: 0.72, h: 0.68, l: 0.62, color: 0xc9b377 },
      { name: 'cans', x: 0.94, y: 1.46, z: 0, w: 0.64, h: 0.5, l: 0.58, color: 0x68869a },
      { name: 'dryGoods', x: -0.42, y: 2.46, z: 0, w: 1.35, h: 0.54, l: 0.6, color: 0xaa7653 },
    ],
  },
  ingredientBinRack: {
    id: 'ingredientBinRack', name: 'Ingredient Bin Rack', zoneType: 'kitchen', furnitureGroup: 'storage',
    cost: { funding: 680 }, energyCost: 0, spriteColor: 0x80909a,
    gridW: 2, gridH: 1, subH: 3, spriteKey: 'ingredientBinRack',
    effects: {}, baseMaterial: 'metal_dark',
    parts: [
      { name: 'frame', x: 0, y: 0, z: 0.22, w: 1.9, h: 2.8, l: 0.18, material: 'metal_dark' },
      { name: 'bin1', x: -0.5, y: 0.18, z: -0.08, w: 0.78, h: 0.62, l: 0.72, color: 0x718a98 },
      { name: 'bin2', x: 0.5, y: 0.18, z: -0.08, w: 0.78, h: 0.62, l: 0.72, color: 0x8b7356 },
      { name: 'bin3', x: -0.5, y: 1.02, z: -0.08, w: 0.78, h: 0.62, l: 0.72, color: 0x9a8360 },
      { name: 'bin4', x: 0.5, y: 1.02, z: -0.08, w: 0.78, h: 0.62, l: 0.72, color: 0x6e8c68 },
      { name: 'bin5', x: -0.5, y: 1.86, z: -0.08, w: 0.78, h: 0.62, l: 0.72, color: 0xa57055 },
      { name: 'bin6', x: 0.5, y: 1.86, z: -0.08, w: 0.78, h: 0.62, l: 0.72, color: 0x7b8292 },
      { name: 'labelStrip', x: 0, y: 2.62, z: -0.2, w: 1.72, h: 0.18, l: 0.04, color: 0xeee5c8 },
    ],
  },
  mixerStation: {
    id: 'mixerStation', name: 'Commercial Mixer Station', zoneType: 'kitchen', furnitureGroup: 'support',
    cost: { funding: 2400 }, energyCost: 1.8, spriteColor: 0x7e91a2,
    gridW: 2, gridH: 1, subH: 3, surfaceY: 1.42, spriteKey: 'mixerStation',
    effects: { morale: 1 }, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'cabinet', x: 0, y: 0, z: 0.08, w: 1.9, h: 1.35, l: 0.86, material: 'metal_brushed' },
      { name: 'counter', x: 0, y: 1.35, z: 0, w: 2, h: 0.1, l: 1, material: 'metal_brushed' },
      { name: 'mixerBase', x: 0, y: 1.46, z: 0.08, w: 0.92, h: 0.24, l: 0.74, color: 0x546b7b },
      { name: 'mixerColumn', x: 0, y: 1.62, z: 0.3, w: 0.46, h: 1.18, l: 0.42, color: 0x668297 },
      { name: 'mixerHead', x: 0, y: 2.55, z: 0.02, w: 0.86, h: 0.42, l: 0.72, color: 0x668297 },
      { name: 'bowl', x: 0, y: 1.7, z: -0.06, w: 0.72, h: 0.58, l: 0.72, material: 'metal_brushed' },
      { name: 'beater', x: 0, y: 2.02, z: -0.06, w: 0.12, h: 0.52, l: 0.12, material: 'metal_dark' },
      { name: 'controls', x: 0.34, y: 2.62, z: -0.36, w: 0.18, h: 0.22, l: 0.04, color: 0x2d3337 },
    ],
  },
  walkInCooler: {
    id: 'walkInCooler', name: 'Walk-In Cooler', zoneType: 'kitchen', furnitureGroup: 'storage',
    cost: { funding: 8200 }, energyCost: 3.2, spriteColor: 0x9eb2ba,
    gridW: 3, gridH: 2, subH: 4, spriteKey: 'walkInCooler',
    effects: { morale: 1 }, baseMaterial: 'metal_painted_white',
    parts: [
      { name: 'body', x: 0, y: 0, z: 0, w: 2.95, h: 3.9, l: 1.95, material: 'metal_painted_white' },
      { name: 'door', x: 0, y: 0.12, z: -1, w: 1.32, h: 3.34, l: 0.08, color: 0x72878f },
      { name: 'doorInset', x: 0, y: 0.38, z: -1.05, w: 1.02, h: 2.62, l: 0.03, color: 0xaac1c8 },
      { name: 'handle', x: 0.48, y: 1.35, z: -1.11, w: 0.1, h: 1.05, l: 0.1, material: 'metal_dark' },
      { name: 'threshold', x: 0, y: 0.04, z: -1.06, w: 1.42, h: 0.12, l: 0.14, material: 'metal_brushed' },
      { name: 'compressor', x: 0.84, y: 3.18, z: -1.04, w: 0.86, h: 0.58, l: 0.18, color: 0x4c606a },
      { name: 'vent1', x: 0.62, y: 3.38, z: -1.14, w: 0.28, h: 0.08, l: 0.03, color: 0x20272b },
      { name: 'vent2', x: 0.98, y: 3.38, z: -1.14, w: 0.28, h: 0.08, l: 0.03, color: 0x20272b },
      { name: 'status', x: -0.52, y: 2.82, z: -1.09, w: 0.18, h: 0.14, l: 0.03, color: 0x52d5df },
    ],
  },
  condimentStation: {
    id: 'condimentStation', name: 'Condiment Station', zoneTypes: ['cafeteria', 'kitchen'],
    cost: { funding: 350 }, energyCost: 0, spriteColor: 0xa56d3f,
    gridW: 2, gridH: 1, subH: 3, surfaceY: 1.5, spriteKey: 'condimentStation',
    effects: { morale: 1 }, baseMaterial: 'tile_hardwood',
    parts: [
      { name: 'cabinet', x: 0, y: 0, z: 0.05, w: 1.9, h: 1.4, l: 0.86, color: 0x765037 },
      { name: 'top', x: 0, y: 1.4, z: 0, w: 2.0, h: 0.1, l: 0.95, material: 'tile_hardwood' },
      { name: 'backboard', x: 0, y: 1.5, z: 0.39, w: 1.9, h: 0.65, l: 0.08, color: 0x8c6243 },
      { name: 'napkinBin', x: -0.58, y: 1.52, z: 0.02, w: 0.48, h: 0.45, l: 0.5, color: 0xc7cbd0 },
      { name: 'cupBin', x: 0, y: 1.52, z: 0.02, w: 0.42, h: 0.38, l: 0.45, color: 0xb8bdc3 },
      { name: 'packetBin', x: 0.58, y: 1.52, z: 0.02, w: 0.48, h: 0.32, l: 0.5, color: 0x5f6870 },
      { name: 'redBottle', x: -0.18, y: 1.92, z: 0.25, w: 0.12, h: 0.38, l: 0.12, color: 0xcc3f35 },
      { name: 'yellowBottle', x: 0.18, y: 1.92, z: 0.25, w: 0.12, h: 0.38, l: 0.12, color: 0xe5b93f },
    ],
  },
  wasteStation: {
    id: 'wasteStation', name: 'Waste & Recycling Station', zoneTypes: ['cafeteria', 'kitchen', 'reception', 'storageRoom'],
    cost: { funding: 450 }, energyCost: 0, spriteColor: 0x65717a,
    gridW: 2, gridH: 1, subH: 2, spriteKey: 'wasteStation',
    effects: {}, baseMaterial: 'metal_painted_white',
    parts: [
      { name: 'wasteBody', x: -0.49, y: 0, z: 0, w: 0.92, h: 1.65, l: 0.84, color: 0x555e65 },
      { name: 'recycleBody', x: 0.49, y: 0, z: 0, w: 0.92, h: 1.65, l: 0.84, color: 0x356f8a },
      { name: 'wasteTop', x: -0.49, y: 1.65, z: 0, w: 0.96, h: 0.12, l: 0.88, color: 0x343a40 },
      { name: 'recycleTop', x: 0.49, y: 1.65, z: 0, w: 0.96, h: 0.12, l: 0.88, color: 0x26566d },
      { name: 'wasteSlot', x: -0.49, y: 1.58, z: -0.45, w: 0.58, h: 0.22, l: 0.04, color: 0x17191b },
      { name: 'recycleSlot', x: 0.49, y: 1.58, z: -0.45, w: 0.58, h: 0.22, l: 0.04, color: 0x17191b },
      { name: 'wasteLabel', x: -0.49, y: 0.9, z: -0.45, w: 0.52, h: 0.18, l: 0.03, color: 0xf0f0e8 },
      { name: 'recycleLabel', x: 0.49, y: 0.9, z: -0.45, w: 0.52, h: 0.18, l: 0.03, color: 0xd8f2f8 },
    ],
  },
  conferenceTable: {
    id: 'conferenceTable', name: 'Conference Table', zoneType: 'meetingRoom',
    cost: { funding: 2000 }, energyCost: 0, spriteColor: 0x775533,
    gridW: 4, gridH: 2, subH: 2, surfaceY: 1.52, spriteKey: 'conferenceTable',
    effects: { morale: 1, research: 0.02 }, baseMaterial: 'tile_hardwood',
    // Symmetric table seating six around it: four along the long +Z side,
    // two along the long -Z side, each anchor facing back into the table.
    station: { jobs: ['meet'], slots: 6, seated: 'required',
      anchors: [
        { subCol: 0, subRow: 2, facing: 'n' },
        { subCol: 1, subRow: 2, facing: 'n' },
        { subCol: 2, subRow: 2, facing: 'n' },
        { subCol: 3, subRow: 2, facing: 'n' },
        { subCol: 1, subRow: -1, facing: 's' },
        { subCol: 2, subRow: -1, facing: 's' },
      ] },
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
    id: 'officeChair', name: 'Office Chair', zoneTypes: ['officeSpace', 'reception'],
    cost: { funding: 150 }, energyCost: 0, spriteColor: 0x3a3a3a,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'officeChair',
    effects: { morale: 1 }, baseMaterial: 'metal_dark',
    // Backrest sits at local +Z, so the sitter faces -Z. seatY is the seat
    // cushion's own bottom-of-part y (subtiles, same coordinate space as
    // `parts` below) — read off the 'seat' part's own y, not guessed.
    seat: { facing: 'n', seatY: 0.8 },
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
    // Backrest sits at local +Z, so the sitter faces -Z. seatY is the seat
    // cushion's own bottom-of-part y (subtiles) — read off 'seat' below.
    seat: { facing: 'n', seatY: 0.8 },
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
    // Backrest sits at local +Z, so the sitter faces -Z. seatY is the seat
    // cushion's own bottom-of-part y (subtiles) — read off 'seat' below.
    seat: { facing: 'n', seatY: 0.8 },
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
    // Backrest sits at local +Z, so the sitter faces -Z. seatY is the seat
    // cushion's own bottom-of-part y (subtiles) — read off 'seat' below.
    seat: { facing: 'n', seatY: 0.82 },
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
    id: 'meetingChair', name: 'Meeting Chair', zoneTypes: ['meetingRoom', 'reception'],
    cost: { funding: 100 }, energyCost: 0, spriteColor: 0x555555,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'meetingChair',
    effects: { morale: 1 }, baseMaterial: 'metal_dark',
    // Backrest sits at local +Z, so the sitter faces -Z. seatY is the seat
    // cushion's own bottom-of-part y (subtiles) — read off 'seat' below.
    seat: { facing: 'n', seatY: 0.82 },
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

  // Cafeteria — tall stool for counter seating
  barStool: {
    id: 'barStool', name: 'Bar Stool', zoneType: 'cafeteria',
    cost: { funding: 85 }, energyCost: 0, spriteColor: 0xb96b3d,
    gridW: 1, gridH: 1, subH: 3, spriteKey: 'barStool',
    effects: { morale: 1 }, baseMaterial: 'metal_dark',
    // Low back at local +Z; the sitter faces -Z toward a breakfast bar.
    seat: { facing: 'n', seatY: 1.15 },
    parts: [
      { name: 'legFL', x: -0.27, y: 0, z: -0.27, w: 0.05, h: 1.15, l: 0.05, material: 'metal_dark' },
      { name: 'legFR', x: 0.27, y: 0, z: -0.27, w: 0.05, h: 1.15, l: 0.05, material: 'metal_dark' },
      { name: 'legBL', x: -0.27, y: 0, z: 0.27, w: 0.05, h: 1.15, l: 0.05, material: 'metal_dark' },
      { name: 'legBR', x: 0.27, y: 0, z: 0.27, w: 0.05, h: 1.15, l: 0.05, material: 'metal_dark' },
      { name: 'footrestFront', x: 0, y: 0.45, z: -0.27, w: 0.58, h: 0.05, l: 0.05, material: 'metal_brushed' },
      { name: 'footrestBack', x: 0, y: 0.45, z: 0.27, w: 0.58, h: 0.05, l: 0.05, material: 'metal_brushed' },
      { name: 'seat', x: 0, y: 1.15, z: -0.02, w: 0.68, h: 0.1, l: 0.68, color: 0xb96b3d },
      { name: 'backPostL', x: -0.27, y: 1.15, z: 0.27, w: 0.05, h: 0.72, l: 0.05, material: 'metal_dark' },
      { name: 'backPostR', x: 0.27, y: 1.15, z: 0.27, w: 0.05, h: 0.72, l: 0.05, material: 'metal_dark' },
      { name: 'back', x: 0, y: 1.5, z: 0.27, w: 0.58, h: 0.32, l: 0.07, color: 0xb96b3d },
    ],
  },

  // Cafeteria — molded plastic stacking chair
  cafeteriaChair: {
    id: 'cafeteriaChair', name: 'Cafeteria Chair', zoneType: 'cafeteria',
    cost: { funding: 50 }, energyCost: 0, spriteColor: 0xcc6622,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'cafeteriaChair',
    effects: { morale: 1 }, baseMaterial: 'metal_dark',
    // Backrest sits at local +Z, so the sitter faces -Z. seatY is the seat
    // cushion's own bottom-of-part y (subtiles) — read off 'seat' below.
    seat: { facing: 'n', seatY: 0.82 },
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

  // Bathroom — deliberately self-contained fixtures for tiled restroom zones.
  toilet: {
    id: 'toilet', name: 'Toilet', zoneType: 'bathroom', furnitureGroup: 'hygiene',
    cost: { funding: 450 }, energyCost: 0, spriteColor: 0xf1f3f2,
    gridW: 1, gridH: 2, subH: 2, spriteKey: 'toilet', effects: {}, baseMaterial: 'metal_painted_white',
    parts: [
      { name: 'base', x: 0, y: 0, z: 0.18, w: 0.78, h: 0.72, l: 1.08, material: 'metal_painted_white' },
      { name: 'seat', x: 0, y: 0.72, z: -0.1, w: 0.8, h: 0.1, l: 0.82, material: 'metal_painted_white' },
      { name: 'bowl', x: 0, y: 0.82, z: -0.1, w: 0.5, h: 0.06, l: 0.48, color: 0x9bb3bb },
      { name: 'tank', x: 0, y: 0.76, z: 0.54, w: 0.78, h: 1.02, l: 0.3, material: 'metal_painted_white' },
      { name: 'flushButton', x: 0.2, y: 1.45, z: 0.36, w: 0.12, h: 0.12, l: 0.03, material: 'metal_brushed' },
    ],
  },
  urinal: {
    id: 'urinal', name: 'Wall Urinal', zoneType: 'bathroom', furnitureGroup: 'hygiene',
    cost: { funding: 380 }, energyCost: 0, spriteColor: 0xf0f2f1,
    gridW: 1, gridH: 1, subH: 3, spriteKey: 'urinal', effects: {}, baseMaterial: 'metal_painted_white',
    parts: [
      { name: 'bowl', x: 0, y: 0.75, z: 0.16, w: 0.7, h: 1.5, l: 0.42, material: 'metal_painted_white' },
      { name: 'basin', x: 0, y: 1.03, z: -0.04, w: 0.42, h: 0.72, l: 0.1, color: 0x9bb3bb },
      { name: 'flushPipe', x: 0, y: 2.18, z: 0.25, w: 0.1, h: 0.6, l: 0.1, material: 'metal_brushed' },
      { name: 'flushValve', x: 0, y: 2.38, z: 0.08, w: 0.26, h: 0.18, l: 0.12, material: 'metal_brushed' },
    ],
  },
  sinkVanity: {
    id: 'sinkVanity', name: 'Sink Vanity', zoneType: 'bathroom', furnitureGroup: 'hygiene',
    cost: { funding: 760 }, energyCost: 0, spriteColor: 0xd5d9d8,
    gridW: 2, gridH: 1, subH: 3, surfaceY: 1.72, spriteKey: 'sinkVanity', effects: {}, baseMaterial: 'metal_painted_white',
    parts: [
      { name: 'cabinet', x: 0, y: 0, z: 0.12, w: 1.82, h: 1.55, l: 0.78, material: 'metal_painted_white' },
      { name: 'counter', x: 0, y: 1.55, z: 0, w: 2.0, h: 0.16, l: 0.96, color: 0xc7cccd },
      { name: 'basinL', x: -0.48, y: 1.71, z: -0.05, w: 0.55, h: 0.1, l: 0.48, color: 0x8eb3bd },
      { name: 'basinR', x: 0.48, y: 1.71, z: -0.05, w: 0.55, h: 0.1, l: 0.48, color: 0x8eb3bd },
      { name: 'faucetL', x: -0.48, y: 1.78, z: 0.28, w: 0.1, h: 0.35, l: 0.1, material: 'metal_brushed' },
      { name: 'faucetR', x: 0.48, y: 1.78, z: 0.28, w: 0.1, h: 0.35, l: 0.1, material: 'metal_brushed' },
    ],
  },
  bathroomMirror: {
    id: 'bathroomMirror', name: 'Bathroom Mirror', zoneType: 'bathroom', furnitureGroup: 'hygiene',
    cost: { funding: 180 }, energyCost: 0, spriteColor: 0x93b2c2,
    gridW: 2, gridH: 1, subH: 3, spriteKey: 'bathroomMirror', effects: {}, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'frame', x: 0, y: 1.45, z: 0.18, w: 1.92, h: 2.45, l: 0.1, material: 'metal_brushed' },
      { name: 'glass', x: 0, y: 1.48, z: 0.1, w: 1.7, h: 2.2, l: 0.03, color: 0x80a9bc },
    ],
  },
  handDryer: {
    id: 'handDryer', name: 'Hand Dryer', zoneType: 'bathroom', furnitureGroup: 'hygiene',
    cost: { funding: 320 }, energyCost: 0.15, spriteColor: 0xc7cbca,
    gridW: 1, gridH: 1, subH: 2, spriteKey: 'handDryer', effects: {}, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'body', x: 0, y: 1.05, z: 0.2, w: 0.58, h: 1.05, l: 0.28, material: 'metal_brushed' },
      { name: 'nozzle', x: 0, y: 0.75, z: -0.02, w: 0.35, h: 0.18, l: 0.25, color: 0x565e62 },
      { name: 'sensor', x: 0, y: 1.2, z: 0.03, w: 0.14, h: 0.14, l: 0.03, color: 0x1c2830 },
    ],
  },
  toiletStall: {
    id: 'toiletStall', name: 'Toilet Stall Partition', zoneType: 'bathroom', furnitureGroup: 'hygiene',
    cost: { funding: 620 }, energyCost: 0, spriteColor: 0x8ca3ae,
    gridW: 1, gridH: 3, subH: 4, spriteKey: 'toiletStall', effects: {}, baseMaterial: 'metal_painted_white', hasSurface: false,
    parts: [
      { name: 'partition', x: 0, y: 1.9, z: 0, w: 0.12, h: 3.8, l: 2.9, color: 0x8ca3ae },
      { name: 'postFront', x: 0, y: 1.9, z: -1.35, w: 0.16, h: 3.8, l: 0.16, material: 'metal_brushed' },
      { name: 'postBack', x: 0, y: 1.9, z: 1.35, w: 0.16, h: 3.8, l: 0.16, material: 'metal_brushed' },
    ],
  },
  toiletStallWall: {
    id: 'toiletStallWall', name: 'Toilet Stall Wall', zoneType: 'bathroom', furnitureGroup: 'hygiene',
    cost: { funding: 280 }, energyCost: 0, spriteColor: 0x8ca3ae,
    gridW: 1, gridH: 3, subH: 4, spriteKey: 'toiletStallWall', effects: {}, baseMaterial: 'metal_painted_white', hasSurface: false,
    // A free-standing divider: rotate it to build the side and rear walls of
    // an accessible-sized stall around the toilet fixture.
    parts: [
      { name: 'panel', x: 0, y: 1.9, z: 0, w: 0.12, h: 3.8, l: 2.9, color: 0x8ca3ae },
      { name: 'frontPost', x: 0, y: 1.9, z: -1.35, w: 0.16, h: 3.8, l: 0.16, material: 'metal_brushed' },
      { name: 'rearPost', x: 0, y: 1.9, z: 1.35, w: 0.16, h: 3.8, l: 0.16, material: 'metal_brushed' },
      { name: 'topRail', x: 0, y: 3.78, z: 0, w: 0.16, h: 0.1, l: 3.0, material: 'metal_brushed' },
    ],
  },
  toiletStallDoor: {
    id: 'toiletStallDoor', name: 'Toilet Stall Door', zoneType: 'bathroom', furnitureGroup: 'hygiene',
    cost: { funding: 340 }, energyCost: 0, spriteColor: 0x78909c,
    gridW: 2, gridH: 1, subH: 4, spriteKey: 'toiletStallDoor', effects: {}, baseMaterial: 'metal_painted_white', hasSurface: false,
    // The door is a room furnishing rather than a building opening: it
    // visually completes a cubicle and can be rotated to face its partition.
    parts: [
      { name: 'doorLeaf', x: 0, y: 1.9, z: 0, w: 1.82, h: 3.8, l: 0.12, color: 0x78909c },
      { name: 'hingePost', x: -0.86, y: 1.9, z: 0, w: 0.14, h: 3.8, l: 0.16, material: 'metal_brushed' },
      { name: 'topRail', x: 0, y: 3.78, z: 0, w: 2.0, h: 0.1, l: 0.16, material: 'metal_brushed' },
      { name: 'latch', x: 0.62, y: 1.9, z: -0.09, w: 0.18, h: 0.13, l: 0.08, material: 'metal_brushed' },
      { name: 'vacantIndicator', x: 0.38, y: 2.28, z: -0.09, w: 0.22, h: 0.22, l: 0.04, color: 0x4d9d69 },
    ],
  },
  paperTowelBin: {
    id: 'paperTowelBin', name: 'Paper Towel Bin', zoneType: 'bathroom', furnitureGroup: 'hygiene',
    cost: { funding: 90 }, energyCost: 0, spriteColor: 0x6c7375,
    gridW: 1, gridH: 1, subH: 1, spriteKey: 'paperTowelBin', effects: {}, baseMaterial: 'metal_brushed',
    parts: [
      { name: 'body', x: 0, y: 0, z: 0, w: 0.58, h: 0.72, l: 0.58, material: 'metal_brushed' },
      { name: 'opening', x: 0, y: 0.74, z: 0, w: 0.4, h: 0.04, l: 0.4, color: 0x252a2c },
    ],
  },
};

// Palette-preview descriptions, kept in one block so the data table above
// stays scannable. Every item must have an entry — the HUD preview panel
// shows these on hover/keyboard focus.
const ROOM_FURNISHING_DESCS = {
  visitorArmchair: 'Comfortable guest seating for offices, reception areas, and meeting rooms. Shared room furniture.',
  ottoman: 'Compact footstool that turns a chair corner into a proper lounge. Shared room furniture.',
  credenza: 'Low storage cabinet for presentation supplies, linens, and office overflow. Shared room furniture.',
  wastebasket: 'Small wastebasket for desks, meeting rooms, and reception corners. Shared room furniture.',
  deskOrganizer: 'Tray, folders, and pen cup for making a desk look intentionally occupied. Shared room furniture.',
  displayScreen: 'Wall-mounted display for schedules, plots, visitor information, or a tasteful loop of beam footage. Shared room furniture.',
  flipChart: 'Portable paper board for agendas, sketches, and ideas that escape the meeting. Shared room furniture.',
  bulletinBoard: 'Pinned notices, room schedules, and the one poster nobody takes down. Shared room furniture.',
  umbrellaStand: 'Reception-side stand for umbrellas and wet-weather visitors. Shared room furniture.',
  badgePrinter: 'Small reception printer for visitor badges and temporary access cards. Reception.',
  dishwasher: 'Keeps the mug economy moving. Cafeteria or Kitchen.',
  warmingCabinet: 'Hot-holding cabinet for catered meals and the late shift. Cafeteria or Kitchen.',
  plateStation: 'Plates, trays, and cutlery arranged before the queue begins. Cafeteria or Kitchen.',
  readingLamp: 'Tall pool of warm light for reading journals and arguing over footnotes. Faculty Lounge or office.',
  globe: 'Academic globe for pointing at places where the next collaboration might happen. Shared room furniture.',
  chessTable: 'A small chess table for the long pause between seminars. Faculty Lounge.',
  drinksTrolley: 'Rolling drinks service for receptions, meetings, and faculty-lounge diplomacy. Shared room furniture.',
  sharedCounter: 'A neutral service counter for forms, refreshments, check-in, and meeting-room supplies. Shared room furniture.',
  coffeeStation: 'Compact coffee service with machine, carafe, mugs, and cabinet storage. Shared room furniture.',
  snackTable: 'Small self-service table for fruit, pastries, napkins, and the emergency meeting biscuit. Shared room furniture.',
  bookcaseWide: 'Broad open bookcase for manuals, journals, proceedings, and office references. Shared room furniture.',
  glassBookcase: 'Glass-front bookcase for curated references, awards, and books that should not wander. Shared room furniture.',
  sideboard: 'Low sideboard for serving ware, presentation supplies, linens, and concealed storage. Shared room furniture.',
  endTable: 'Small lamp and coffee table for beside a sofa, chair, or reception seating. Shared room furniture.',
  desk: 'Flat surface for keyboards, papers, and cold coffee. Office Space.',
  filingCabinet: 'Four drawers for records, visitor forms, or spare-part paperwork. Office Space, Reception, or Storage Room.',
  whiteboard: 'Half equations, half "DO NOT ERASE" from 2019. Boosts research. Office Space.',
  coffeeMachine: 'Converts funding into morale at remarkable efficiency. Office Space.',
  workstation: 'Dual monitors: one for analysis, one for the log viewer. Office Space.',
  pottedPlant: 'Desk-scale greenery; survives neglect better than the grad students. Office Space, Meeting Room, or Reception.',
  floorPlant: 'Large potted plant standing in for a window view. Office Space, Meeting Room, or Reception.',
  faxMachine: 'Nobody knows why it is still here. Nobody dares unplug it. Office Space.',
  receptionDesk: 'First impressions for visiting funding agencies. Office Space or Reception.',
  coffeeTable: 'Holds journals nobody reads and coasters nobody uses. Office Space, Meeting Room, or Reception.',
  loungeTable: 'A larger low table with a shelf tier for the magazines nobody reads either. Office Space, Meeting Room, or Reception.',
  couch: 'For visitors, informal discussions, and "quick naps" during 36-hour beam runs. Office Space or Reception.',
  bookshelf: 'Textbooks, proceedings, and one long-overdue library book. Office Space or Reception.',
  printer: 'Prints fine until the moment you urgently need it to. Office Space or Reception.',
  standingDesk: 'Motorized desk for paperwork, analysis, and pretending to improve posture. Office Space.',
  acousticPod: 'A compact quiet booth for focused work and calls that should not fill the whole room. Office Space or Meeting Room.',
  beamlineDisplayCase: 'A miniature accelerator under glass for tours, proposals, and pointing at during reviews. Office Space, Meeting Room, or Reception.',
  collaborationTable: 'Standing-height touch table for quick design reviews around a live lattice display. Office Space or Meeting Room.',
  areaRug: 'A large low-profile rug that layers beneath furniture without blocking the room layout. Office Space, Meeting Room, or Reception.',
  runnerRug: 'A narrow patterned runner for glazed corridors, office aisles, and visitor approaches. Office Space, Meeting Room, or Reception.',
  waitingBench: 'Durable three-seat waiting-room bench for tours, interviews, and delayed access checks. Reception or Office Space.',
  visitorKiosk: 'Self-service check-in terminal for badges, orientations, and visitor acknowledgements. Reception.',
  brochureRack: 'Tiered display for facility maps, safety leaflets, and beamtime brochures. Reception or Office Space.',
  coatRack: 'Freestanding rack for coats, umbrellas, and the occasional abandoned lanyard. Reception, Office Space, or Meeting Room.',
  utilityShelving: 'Open shelving for boxed consumables and equipment that should remain easy to reach. Storage Room or Maintenance.',
  palletRack: 'Heavy-duty rack for bulk deliveries and large spares awaiting their moment of crisis. Storage Room or Maintenance.',
  partsBinRack: 'Labeled small-parts bins for fasteners, fittings, and adapters that never fit the first time. Storage Room or Maintenance.',
  lockerBank: 'Secure lockers for tools, PPE, and personal gear. Storage Room or Maintenance.',
  packingTable: 'Broad work surface for receiving, sorting, labeling, and repacking supplies. Storage Room or Maintenance.',
  supplyCart: 'Mobile cart for moving tools, consumables, and small components between work areas. Storage Room or Maintenance.',
  monitorBank: 'Wall of status displays — more screens, more control. Works anywhere; the Control Room grants its bonus.',
  serverRack: 'Starter fiber gateway with raw storage and mixed compute. Works anywhere; the Control Room grants its bonus.',
  dataAppliance: 'Compact DAQ, memory, CPU and GPU for one low-rate endpoint. Works anywhere; the Control Room grants its bonus.',
  dataStorageRack: 'Dense raw-data buffer. Works anywhere; the Control Room grants its bonus.',
  cpuComputeRack: 'General CPU nodes for controls, accounting and reconstruction. Works anywhere; the Control Room grants its bonus.',
  gpuComputeRack: 'Accelerator GPUs for imaging, detector events and photon science. Works anywhere; the Control Room grants its bonus.',
  operatorConsole: 'Where operators drive the machine and log the excuses. Works anywhere; the Control Room grants its bonus.',
  alarmPanel: 'Annunciator panel. Green is good; you will learn the other colors. Works anywhere; the Control Room grants its bonus.',
  diningTable: 'Shared meals, shared gossip, shared crumbs. Cafeteria.',
  cafeTable: 'A compact two-seat table for narrow break rooms. Cafeteria.',
  breakfastBar: 'Space-efficient counter seating for coffee and quick meals. Cafeteria.',
  servingCounter: 'Hot food line — taco Tuesday moves morale measurably. Cafeteria or Kitchen.',
  vendingMachine: 'Emergency calories for the night shift. Cafeteria or Kitchen.',
  microwave: 'Reheats leftovers. Please stop microwaving fish. Cafeteria or Kitchen.',
  waterCooler: 'Hydration station and facility rumor mill. Cafeteria, Kitchen, Office Space, Reception, or Storage Room.',
  cafeteriaRefrigerator: 'Cold storage for lunches, temperature-sensitive supplies, and increasingly stern labels. Cafeteria, Kitchen, or Storage Room.',
  sinkCounter: 'Wash-up counter for mugs, trays, and one suspiciously permanent spoon. Cafeteria or Kitchen.',
  commercialRange: 'Six-burner commercial range with oven and extraction hood. Kitchen.',
  convectionOven: 'Double-deck convection oven for roasts, trays, bread, and the late shift. Kitchen.',
  flatTopGrill: 'Wide griddle for breakfast, sandwiches, and high-throughput hot food. Kitchen.',
  doubleFryer: 'Twin-basket fryer with enough capacity to make the salad station feel virtuous. Kitchen.',
  prepCounter: 'Stainless worktable with cutting board, mixing bowl, and open undershelf. Kitchen.',
  saladPrepStation: 'Refrigerated cold-prep line with greens, toppings, and a sneeze guard. Kitchen.',
  pantryShelving: 'Four-tier dry-goods shelving stocked with flour, rice, cans, and boxes. Kitchen.',
  ingredientBinRack: 'Labeled bins for bulk ingredients and the things the recipe calls “a pinch.” Kitchen.',
  mixerStation: 'Heavy commercial mixer on a dedicated stainless cabinet. Kitchen.',
  walkInCooler: 'Insulated cold room for produce, dairy, and enough leftovers to start negotiations. Kitchen.',
  condimentStation: 'Napkins, cups, packets, and the good hot sauce. Cafeteria or Kitchen.',
  wasteStation: 'Side-by-side waste and recycling with optimistic labels. Cafeteria, Kitchen, Reception, or Storage Room.',
  conferenceTable: 'Big table for design reviews and doughnut distribution. Meeting Room.',
  projector: 'Shows slides at the wrong aspect ratio for the first five minutes. Meeting Room.',
  phoneUnit: 'Starfish-shaped speakerphone. "Can everyone see my screen?" Meeting Room.',
  whiteboardLarge: 'Wall-sized whiteboard for wall-sized derivations. Boosts research. Meeting Room.',
  officeChair: 'Standard swivel chair with one mystery lever. Office Space or Reception.',
  ergonomicChair: 'Mesh-backed with lumbar support; your spine sends thanks. Office Space.',
  executiveChair: 'High-backed leather chair for PI-grade sitting. Office Space.',
  operatorChair: '24/7-rated seating for around-the-clock shifts. Control Room.',
  meetingChair: 'Stackable chair, comfortable for exactly one hour. Meeting Room or Reception.',
  clubChair: 'Studded leather club chair for reading, arguing, or holding court. Faculty Lounge.',
  tuftedSofa: 'Deep button-tufted leather sofa for post-seminar decompression. Faculty Lounge.',
  clawFootTable: 'Polished cocktail table with ornate claw feet and brass inlay. Faculty Lounge.',
  drinksCabinet: 'Glazed cabinet stocked with bottles, glasses, and questionable provenance. Faculty Lounge.',
  facultyBar: 'A proper faculty bar for after-hours discussion and suspiciously good morale. Faculty Lounge.',
  chalkboard: 'A chalkboard for equations, agendas, and ideas that become grant proposals. Faculty Lounge.',
  newspaperStand: 'Fresh journals and newspapers, arranged for maximum professorial browsing. Faculty Lounge.',
  cigarAshtray: 'Brass-edged ashtray for the era before smoke alarms acquired opinions. Faculty Lounge.',
  barStool: 'Tall counter seating with a foot rail. Cafeteria.',
  cafeteriaChair: 'Simple cafeteria seating; wipes clean. Cafeteria.',
  toilet: 'Commercial porcelain fixture for a facility restroom. Bathroom.',
  urinal: 'Wall-mounted, water-saving fixture for compact restroom layouts. Bathroom.',
  sinkVanity: 'Double basin for handwashing before returning to the beamline. Bathroom.',
  bathroomMirror: 'Wide, durable mirror above the sinks. Bathroom.',
  handDryer: 'Automatic hand dryer; no towel-roll logistics required. Bathroom.',
  toiletStall: 'Privacy partition for arranging individual restroom stalls. Bathroom.',
  toiletStallWall: 'Freestanding partition wall for building individual restroom cubicles. Bathroom.',
  toiletStallDoor: 'Locking cubicle door that completes a toilet stall. Bathroom.',
  paperTowelBin: 'Small stainless bin for the inevitable paper-towel backup. Bathroom.',
};
for (const [id, desc] of Object.entries(ROOM_FURNISHING_DESCS)) {
  if (FACILITY_ROOM_FURNISHINGS_RAW[id]) FACILITY_ROOM_FURNISHINGS_RAW[id].desc = desc;
}
