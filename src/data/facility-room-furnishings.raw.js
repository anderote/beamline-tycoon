// Facility room furnishings — items placed inside room zones (control room, office, meeting room, cafeteria).
export const FACILITY_ROOM_FURNISHINGS_RAW = {
  desk: {
    id: 'desk', name: 'Desk', zoneType: 'officeSpace',
    cost: { funding: 30 }, energyCost: 0.2, spriteColor: 0x7a6a4a,
    gridW: 3, gridH: 2, subH: 2, spriteKey: 'desk',
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
    cost: { funding: 20 }, energyCost: 0, spriteColor: 0x8a8c94,
    gridW: 1, gridH: 1, subH: 3, spriteKey: 'filingCabinet',
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
  whiteboard:       { id: 'whiteboard',        name: 'Whiteboard',         zoneType: 'officeSpace', cost: { funding: 25 },   energyCost: 0,   spriteColor: 0xddddee, gridW: 3, gridH: 1, subH: 3, visualSubW: 2.8, visualSubH: 2.4, visualSubL: 0.15, spriteKey: 'whiteboard',       effects: { research: 0.02 }, baseMaterial: 'metal_painted_white' },
  coffeeMachine:    { id: 'coffeeMachine',     name: 'Coffee Machine',     zoneType: 'officeSpace', cost: { funding: 15 },   energyCost: 0.2, spriteColor: 0x664433, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.5, visualSubH: 0.75, visualSubL: 0.7, spriteKey: 'coffeeMachine',    effects: { morale: 2 }, baseMaterial: 'metal_dark' },
  monitorBank:      { id: 'monitorBank',       name: 'Monitor Bank',       zoneType: 'controlRoom', cost: { funding: 150 },  energyCost: 0.8, spriteColor: 0x44bb66, gridW: 4, gridH: 2, subH: 1, spriteKey: 'monitorBank',      effects: { zoneOutput: 0.06 }, baseMaterial: 'metal_painted_white' },
  serverRack: {
    id: 'serverRack', name: 'Server Rack', zoneType: 'controlRoom',
    cost: { funding: 250 }, energyCost: 3.0, spriteColor: 0x1a1c22,
    gridW: 1, gridH: 2, subH: 5, spriteKey: 'serverRack',
    effects: { zoneOutput: 0.08, research: 0.03 }, baseMaterial: 'metal_dark',
    // 1×2 footprint, 2.5 m tall. 19" cabinet full of 1U servers with
    // blinky LEDs. Each server is body + front faceplate + 2 LEDs.
    parts: [
      // Frame
      { name: 'plinth', x: 0, y: 0,   z: 0, w: 1.0, h: 0.15, l: 2.0, material: 'metal_dark' },
      { name: 'cap',    x: 0, y: 4.85, z: 0, w: 1.0, h: 0.15, l: 2.0, material: 'metal_dark' },
      { name: 'railL',  x: -0.46, y: 0.15, z: 0,    w: 0.08, h: 4.7, l: 2.0, material: 'metal_dark' },
      { name: 'railR',  x:  0.46, y: 0.15, z: 0,    w: 0.08, h: 4.7, l: 2.0, material: 'metal_dark' },
      { name: 'back',   x: 0,     y: 0.15, z: 0.96, w: 0.84, h: 4.7, l: 0.04, material: 'metal_dark' },
      // 8 × 1U-ish server units (body + face + 2 LEDs each)
      { name: 's1b', x: 0, y: 0.3,  z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x2c2e36 },
      { name: 's1f', x: 0, y: 0.33, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x16181c },
      { name: 's1a', x: -0.3, y: 0.54, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 's1c', x:  0.3, y: 0.54, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0xffaa40 },

      { name: 's2b', x: 0, y: 0.88, z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x3a3c44 },
      { name: 's2f', x: 0, y: 0.91, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x16181c },
      { name: 's2a', x: -0.3, y: 1.12, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 's2c', x:  0.3, y: 1.12, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },

      { name: 's3b', x: 0, y: 1.46, z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x2c2e36 },
      { name: 's3f', x: 0, y: 1.49, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x16181c },
      { name: 's3a', x: -0.3, y: 1.7, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0xff4040 },
      { name: 's3c', x:  0.3, y: 1.7, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },

      { name: 's4b', x: 0, y: 2.04, z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x3a3c44 },
      { name: 's4f', x: 0, y: 2.07, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x16181c },
      { name: 's4a', x: -0.3, y: 2.28, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 's4c', x:  0.3, y: 2.28, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0xffaa40 },

      { name: 's5b', x: 0, y: 2.62, z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x2c2e36 },
      { name: 's5f', x: 0, y: 2.65, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x16181c },
      { name: 's5a', x: -0.3, y: 2.86, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 's5c', x:  0.3, y: 2.86, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },

      { name: 's6b', x: 0, y: 3.2, z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x3a3c44 },
      { name: 's6f', x: 0, y: 3.23, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x16181c },
      { name: 's6a', x: -0.3, y: 3.44, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0xffaa40 },
      { name: 's6c', x:  0.3, y: 3.44, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },

      { name: 's7b', x: 0, y: 3.78, z: -0.02, w: 0.84, h: 0.5, l: 1.92, color: 0x2c2e36 },
      { name: 's7f', x: 0, y: 3.81, z: -0.95, w: 0.78, h: 0.44, l: 0.02, color: 0x16181c },
      { name: 's7a', x: -0.3, y: 4.02, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 's7c', x:  0.3, y: 4.02, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },

      { name: 's8b', x: 0, y: 4.36, z: -0.02, w: 0.84, h: 0.45, l: 1.92, color: 0x3a3c44 },
      { name: 's8f', x: 0, y: 4.39, z: -0.95, w: 0.78, h: 0.39, l: 0.02, color: 0x16181c },
      { name: 's8a', x: -0.3, y: 4.57, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0x44ff66 },
      { name: 's8c', x:  0.3, y: 4.57, z: -0.97, w: 0.04, h: 0.04, l: 0.02, color: 0xffaa40 },
    ],
  },
  operatorConsole: {
    id: 'operatorConsole', name: 'Operator Console', zoneType: 'controlRoom',
    cost: { funding: 200 }, energyCost: 0.5, spriteColor: 0x2a2c34,
    gridW: 3, gridH: 2, subH: 2, spriteKey: 'operatorConsole',
    effects: { zoneOutput: 0.07 }, baseMaterial: 'metal_painted_white',
    // 3×2 footprint. Console desk + angled monitor bank behind it.
    parts: [
      // Base cabinet (white)
      { name: 'base', x: 0, y: 0, z: 0.2, w: 2.9, h: 1.4, l: 1.4, material: 'metal_painted_white' },
      // Kick plate (dark inset at bottom)
      { name: 'kick', x: 0, y: 0, z: -0.45, w: 2.8, h: 0.1, l: 0.02, color: 0x20222a },
      // Worksurface
      { name: 'top', x: 0, y: 1.4, z: 0.1, w: 3.0, h: 0.08, l: 1.8, material: 'tile_hardwood' },
      // Keyboard tray inset / dark strip near front
      { name: 'kb', x: 0, y: 1.44, z: -0.7, w: 1.8, h: 0.04, l: 0.3, color: 0x1a1c22 },
      // Monitor bank back panel
      { name: 'backPanel', x: 0, y: 1.5, z: 0.92, w: 2.9, h: 1.5, l: 0.08, material: 'metal_dark' },
      // 3 dark monitors mounted on back panel
      { name: 'mon1', x: -1.0, y: 1.7, z: 0.86, w: 0.9, h: 0.55, l: 0.04, color: 0x0c0e14 },
      { name: 'mon2', x:  0.0, y: 1.7, z: 0.86, w: 0.9, h: 0.55, l: 0.04, color: 0x0c0e14 },
      { name: 'mon3', x:  1.0, y: 1.7, z: 0.86, w: 0.9, h: 0.55, l: 0.04, color: 0x0c0e14 },
      // Monitor screens (glowing green)
      { name: 'scr1', x: -1.0, y: 1.72, z: 0.83, w: 0.82, h: 0.47, l: 0.02, color: 0x104018 },
      { name: 'scr2', x:  0.0, y: 1.72, z: 0.83, w: 0.82, h: 0.47, l: 0.02, color: 0x0a2a14 },
      { name: 'scr3', x:  1.0, y: 1.72, z: 0.83, w: 0.82, h: 0.47, l: 0.02, color: 0x104018 },
      // Row of status lamps along top of back panel
      { name: 'lampL', x: -1.3, y: 2.4, z: 0.85, w: 0.06, h: 0.06, l: 0.02, color: 0x44ff66 },
      { name: 'lampM', x:  0.0, y: 2.4, z: 0.85, w: 0.06, h: 0.06, l: 0.02, color: 0xffaa40 },
      { name: 'lampR', x:  1.3, y: 2.4, z: 0.85, w: 0.06, h: 0.06, l: 0.02, color: 0xff4040 },
      // Keyboard + mouse suggestion on worksurface
      { name: 'kybd',  x: -0.1, y: 1.48, z: -0.5, w: 0.9, h: 0.04, l: 0.3, color: 0x20222a },
      { name: 'mouse', x:  0.6, y: 1.48, z: -0.5, w: 0.12, h: 0.05, l: 0.18, color: 0x20222a },
    ],
  },
  alarmPanel:       { id: 'alarmPanel',        name: 'Alarm Panel',        zoneType: 'controlRoom', cost: { funding: 100 },  energyCost: 0.1, spriteColor: 0xcc5544, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.8, visualSubH: 1.2, visualSubL: 0.2, spriteKey: 'alarmPanel',       effects: { zoneOutput: 0.03 }, baseMaterial: 'metal_dark' },
  diningTable: {
    id: 'diningTable', name: 'Dining Table', zoneType: 'cafeteria',
    cost: { funding: 25 }, energyCost: 0, spriteColor: 0xaa7744,
    gridW: 2, gridH: 2, subH: 2, spriteKey: 'diningTable',
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
    cost: { funding: 80 }, energyCost: 5.0, spriteColor: 0xb8bac2,
    gridW: 4, gridH: 1, subH: 2, spriteKey: 'servingCounter',
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
  vendingMachine:   { id: 'vendingMachine',    name: 'Vending Machine',    zoneType: 'cafeteria',   cost: { funding: 40 },   energyCost: 0.3, spriteColor: 0x4488aa, gridW: 1, gridH: 1, subH: 3, spriteKey: 'vendingMachine',   effects: { morale: 1 }, baseMaterial: 'metal_painted_white' },
  microwave:        { id: 'microwave',         name: 'Microwave Station',  zoneType: 'cafeteria',   cost: { funding: 20 },   energyCost: 0.3, spriteColor: 0x666666, gridW: 1, gridH: 1, subH: 1, visualSubW: 1.0, visualSubH: 0.6, visualSubL: 0.75, spriteKey: 'microwave',        effects: { morale: 1 }, baseMaterial: 'metal_painted_white' },
  waterCooler:      { id: 'waterCooler',       name: 'Water Cooler',       zoneType: 'cafeteria',   cost: { funding: 10 },   energyCost: 0.1, spriteColor: 0x66aacc, gridW: 1, gridH: 1, subH: 2, visualSubW: 0.6, visualSubH: 2.1, visualSubL: 0.6, spriteKey: 'waterCooler',      effects: { morale: 1 }, baseMaterial: 'metal_painted_white' },
  conferenceTable: {
    id: 'conferenceTable', name: 'Conference Table', zoneType: 'meetingRoom',
    cost: { funding: 60 }, energyCost: 0, spriteColor: 0x775533,
    gridW: 4, gridH: 2, subH: 2, spriteKey: 'conferenceTable',
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
  projector:        { id: 'projector',          name: 'Projector',          zoneType: 'meetingRoom', cost: { funding: 120 },  energyCost: 0.3, spriteColor: 0x444444, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.6, visualSubH: 0.4, visualSubL: 0.6, spriteKey: 'projector',        effects: { research: 0.04 }, baseMaterial: 'metal_dark' },
  phoneUnit:        { id: 'phoneUnit',          name: 'Conference Phone',   zoneType: 'meetingRoom', cost: { funding: 40 },   energyCost: 0,   spriteColor: 0x333333, gridW: 1, gridH: 1, subH: 1, visualSubW: 0.5, visualSubH: 0.2, visualSubL: 0.5, spriteKey: 'phoneUnit',        effects: {}, baseMaterial: 'metal_dark' },
  whiteboardLarge:  { id: 'whiteboardLarge',    name: 'Large Whiteboard',   zoneType: 'meetingRoom', cost: { funding: 35 },   energyCost: 0,   spriteColor: 0xeeeeee, gridW: 3, gridH: 1, subH: 3, visualSubW: 2.8, visualSubH: 2.4, visualSubL: 0.15, spriteKey: 'whiteboardLarge',  effects: { research: 0.03 }, baseMaterial: 'metal_painted_white' },
};
