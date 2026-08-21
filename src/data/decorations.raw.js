// Decoration items — placeable cosmetic/morale items on the map
export const DECORATIONS_RAW = {
  // === Trees & Plants ===
  // -- Flower beds (stone-bordered planter boxes; click for color variants) --
  flowerBed: {
    id: 'flowerBed', name: 'Flower Bed', cost: { funding: 5 }, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'flower_bed',
    blocksBuild: false, category: 'treesPlants',
    subW: 2, subL: 2, subH: 1,
    variants: ['Wildflowers', 'Roses', 'Daisies', 'Tulips', 'Sunflowers', 'Lavender'],
    variantPreviewColors: [
      [0xff66aa, 0xffcc22], // Wildflowers — two-tone to hint at the mixed palette
      0xcc2244,              // Roses
      0xffffff,              // Daisies
      0xff7722,              // Tulips
      0xffcc22,              // Sunflowers
      0x9966cc,              // Lavender
    ],
  },
  largeFlowerBed: {
    id: 'largeFlowerBed', name: 'Large Flower Bed', cost: { funding: 12 }, removeCost: 0,
    morale: 1, placement: 'outdoor', spriteKey: 'flower_bed_large',
    blocksBuild: false, category: 'treesPlants',
    subW: 4, subL: 4, subH: 1,
    variants: ['Wildflowers', 'Roses', 'Daisies', 'Tulips', 'Sunflowers', 'Lavender'],
    variantPreviewColors: [
      [0xff66aa, 0xffcc22],
      0xcc2244,
      0xffffff,
      0xff7722,
      0xffcc22,
      0x9966cc,
    ],
  },
  longFlowerBed: {
    id: 'longFlowerBed', name: 'Long Flower Bed', cost: { funding: 8 }, removeCost: 0,
    morale: 0.75, placement: 'outdoor', spriteKey: 'flower_bed',
    blocksBuild: false, category: 'treesPlants',
    subW: 4, subL: 2, subH: 1,
    variants: ['Wildflowers', 'Roses', 'Daisies', 'Tulips', 'Sunflowers', 'Lavender'],
    variantPreviewColors: [
      [0xff66aa, 0xffcc22],
      0xcc2244,
      0xffffff,
      0xff7722,
      0xffcc22,
      0x9966cc,
    ],
  },
  // -- Trees --
  oakTree: {
    id: 'oakTree', name: 'Oak Tree', cost: { funding: 15 }, removeCost: 10,
    morale: 1, placement: 'outdoor', spriteKey: 'oak_tree',
    blocksBuild: true, category: 'treesPlants',
    subW: 3, subL: 3, subH: 12,
  },
  mapleTree: {
    id: 'mapleTree', name: 'Maple Tree', cost: { funding: 15 }, removeCost: 10,
    morale: 1, placement: 'outdoor', spriteKey: 'maple_tree',
    blocksBuild: true, category: 'treesPlants',
    subW: 3, subL: 3, subH: 10,
  },
  elmTree: {
    id: 'elmTree', name: 'Elm Tree', cost: { funding: 15 }, removeCost: 10,
    morale: 1, placement: 'outdoor', spriteKey: 'elm_tree',
    blocksBuild: true, category: 'treesPlants',
    subW: 2, subL: 2, subH: 14,
  },
  birchTree: {
    id: 'birchTree', name: 'Birch Tree', cost: { funding: 15 }, removeCost: 10,
    morale: 1, placement: 'outdoor', spriteKey: 'birch_tree',
    blocksBuild: true, category: 'treesPlants',
    subW: 2, subL: 2, subH: 10,
  },
  pineTree: {
    id: 'pineTree', name: 'Pine Tree', cost: { funding: 12 }, removeCost: 8,
    morale: 1, placement: 'outdoor', spriteKey: 'pine_tree',
    blocksBuild: true, category: 'treesPlants',
    subW: 2, subL: 2, subH: 16,
  },
  cedarTree: {
    id: 'cedarTree', name: 'Cedar Tree', cost: { funding: 12 }, removeCost: 8,
    morale: 1, placement: 'outdoor', spriteKey: 'cedar_tree',
    blocksBuild: true, category: 'treesPlants',
    subW: 2, subL: 2, subH: 14,
  },
  smallTree: {
    id: 'smallTree', name: 'Small Tree', cost: { funding: 8 }, removeCost: 5,
    morale: 0.5, placement: 'outdoor', spriteKey: 'small_tree',
    blocksBuild: true, category: 'treesPlants',
    subW: 2, subL: 2, subH: 5,
  },
  willowTree: {
    id: 'willowTree', name: 'Willow Tree', cost: { funding: 18 }, removeCost: 12,
    morale: 1.5, placement: 'outdoor', spriteKey: 'willow_tree',
    blocksBuild: true, category: 'treesPlants',
    subW: 3, subL: 3, subH: 10,
  },
  shrub: {
    id: 'shrub', name: 'Shrub', cost: { funding: 3 }, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'shrub',
    blocksBuild: false, category: 'treesPlants',
    subW: 1, subL: 1, subH: 2,
  },
  // (Hedges and fencing live in grounds.js as walls — see GROUNDS_WALLS)

  // === Furniture ===
  // Footprint dims are in SUB-TILES (1 sub-tile = 0.5m). subH is mostly
  // documentation for items whose builders use hard-coded geometry — see
  // ITEM_BUILDERS in decoration-builder.js. parkBench/picnicTable/fountain/
  // statue/lamppost builders DO read these dims and scale to fit.
  parkBench: {
    id: 'parkBench', name: 'Park Bench', cost: { funding: 10 }, removeCost: 0,
    morale: 1, placement: 'outdoor', spriteKey: 'park_bench',
    blocksBuild: false, category: 'furniture',
    subW: 3, subL: 1, subH: 2,
  },
  picnicTable: {
    id: 'picnicTable', name: 'Picnic Table', cost: { funding: 15 }, removeCost: 0,
    morale: 1.5, placement: 'outdoor', spriteKey: 'picnic_table',
    blocksBuild: false, category: 'furniture',
    subW: 3, subL: 3, subH: 2,
  },
  fountain: {
    id: 'fountain', name: 'Fountain', cost: { funding: 50 }, removeCost: 0,
    morale: 3, placement: 'outdoor', spriteKey: 'fountain',
    blocksBuild: true, category: 'furniture',
    subW: 3, subL: 3, subH: 3,
  },
  statue: {
    id: 'statue', name: 'Statue', cost: { funding: 40 }, removeCost: 0,
    morale: 2, placement: 'outdoor', spriteKey: 'statue',
    blocksBuild: true, category: 'furniture',
    subW: 2, subL: 2, subH: 4,
  },

  // === Lighting ===
  // Lighting fixtures (lamppost, bollardLight, floodLight/ex-spotLight, and
  // six new ones) now live in src/data/placeables/lighting.js, which feeds
  // ALL_DEFS directly — see that file for the single source of truth.

  // === Utilities ===
  propaneTank: {
    id: 'propaneTank', name: 'Propane Tank', cost: { funding: 12000 }, removeCost: 1000,
    morale: 0, placement: 'outdoor', spriteKey: 'propane_tank',
    blocksBuild: true, category: 'utilities',
    subW: 6, subL: 3, subH: 4,
  },
  utilityPole: {
    id: 'utilityPole', name: 'Utility Pole', cost: { funding: 4500 }, removeCost: 500,
    morale: 0, placement: 'outdoor', spriteKey: 'utility_pole',
    blocksBuild: true, category: 'utilities',
    subW: 1, subL: 1, subH: 16,
    requires: 'electricalDistribution',
  },
  overheadPowerSpan: {
    id: 'overheadPowerSpan', name: 'Overhead Power Line', cost: { funding: 18000 }, removeCost: 1500,
    morale: 0, placement: 'outdoor', spriteKey: 'overhead_power_span',
    blocksBuild: true, category: 'utilities',
    subW: 12, subL: 2, subH: 16,
    deprecated: true,
  },
  outdoorPipeRack: {
    id: 'outdoorPipeRack', name: 'Outdoor Pipe Rack', cost: { funding: 22000 }, removeCost: 2000,
    morale: 0, placement: 'outdoor', spriteKey: 'outdoor_pipe_rack',
    blocksBuild: true, category: 'utilities',
    subW: 8, subL: 3, subH: 6,
  },
  backupGenerator: {
    id: 'backupGenerator', name: 'Backup Generator', cost: { funding: 45000 }, removeCost: 4000,
    morale: 0, placement: 'outdoor', spriteKey: 'backup_generator',
    blocksBuild: true, category: 'utilities',
    subW: 6, subL: 4, subH: 5,
    requires: 'resilientPower',
    electricalControl: {
      source: { kind: 'generator', fuelTicks: 300 },
      breaker: { utility: 'powerCable', rating: 250, tripDelayTicks: 5 },
    },
  },

  // === Security ===
  guardTower: {
    id: 'guardTower', name: 'Guard Tower', cost: { funding: 65000 }, removeCost: 6000,
    morale: 0.5, placement: 'outdoor', spriteKey: 'guard_tower',
    blocksBuild: true, category: 'security',
    subW: 6, subL: 6, subH: 18,
  },
  securityGatehouse: {
    id: 'securityGatehouse', name: 'Security Gatehouse', cost: { funding: 35000 }, removeCost: 3000,
    morale: 0.25, placement: 'outdoor', spriteKey: 'security_gatehouse',
    blocksBuild: true, category: 'security',
    subW: 6, subL: 5, subH: 6,
  },
  securityCameraMast: {
    id: 'securityCameraMast', name: 'Camera Mast', cost: { funding: 12000 }, removeCost: 1000,
    morale: 0, placement: 'outdoor', spriteKey: 'security_camera_mast',
    blocksBuild: true, category: 'security',
    subW: 2, subL: 2, subH: 12,
  },
  vehicleBarrier: {
    id: 'vehicleBarrier', name: 'Vehicle Barrier', cost: { funding: 8000 }, removeCost: 700,
    morale: 0, placement: 'outdoor', spriteKey: 'vehicle_barrier',
    blocksBuild: true, category: 'security',
    subW: 6, subL: 2, subH: 3,
  },
  securityBollard: {
    id: 'securityBollard', name: 'Security Bollard', cost: { funding: 1200 }, removeCost: 100,
    morale: 0, placement: 'outdoor', spriteKey: 'security_bollard',
    blocksBuild: true, category: 'security',
    subW: 1, subL: 1, subH: 3,
  },

  // === Bins & Signs ===
  trashCan: {
    id: 'trashCan', name: 'Trash Can', cost: { funding: 5 }, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'trash_can',
    blocksBuild: false, category: 'bins',
    subW: 1, subL: 1, subH: 2,
  },
  recyclingBin: {
    id: 'recyclingBin', name: 'Recycling Bin', cost: { funding: 8 }, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'recycling_bin',
    blocksBuild: false, category: 'bins',
    subW: 1, subL: 1, subH: 2,
  },
  infoSign: {
    id: 'infoSign', name: 'Info Sign', cost: { funding: 10 }, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'info_sign',
    blocksBuild: false, category: 'bins',
    subW: 2, subL: 1, subH: 4,
  },
  directionSign: {
    id: 'directionSign', name: 'Direction Sign', cost: { funding: 8 }, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'direction_sign',
    blocksBuild: false, category: 'bins',
    subW: 2, subL: 1, subH: 3,
  },
  flagpole: {
    id: 'flagpole', name: 'Flagpole', cost: { funding: 15 }, removeCost: 0,
    morale: 1, placement: 'outdoor', spriteKey: 'flagpole',
    blocksBuild: false, category: 'bins',
    subW: 1, subL: 1, subH: 12,
  },

  // === Structure / Hangings ===
  // wallSpan is measured in the four quarter-tile slots along one wall
  // segment. mountY is the centre of the hanging in world metres above the
  // floor. These are decoration-kind placeables, but they use the same wall
  // face placement contract as sconces and electrical feedthroughs.
  abstractPainting: {
    id: 'abstractPainting', name: 'Abstract Painting', cost: { funding: 25 }, removeCost: 0,
    morale: 1, placement: 'indoor', spriteKey: 'abstract_painting',
    blocksBuild: false, category: 'hangings', mount: 'wall', wallSpan: 2, mountY: 1.65,
    subW: 2, subL: 1, subH: 2,
    desc: 'A vivid geometric original that makes even a service corridor feel curated.',
  },
  landscapePainting: {
    id: 'landscapePainting', name: 'Landscape Painting', cost: { funding: 35 }, removeCost: 0,
    morale: 1.25, placement: 'indoor', spriteKey: 'landscape_painting',
    blocksBuild: false, category: 'hangings', mount: 'wall', wallSpan: 3, mountY: 1.65,
    subW: 3, subL: 1, subH: 2,
    desc: 'A wide landscape for rooms whose real windows overlook the switchyard.',
  },
  beamlinePhotograph: {
    id: 'beamlinePhotograph', name: 'Beamline Photograph', cost: { funding: 18 }, removeCost: 0,
    morale: 0.75, placement: 'indoor', spriteKey: 'beamline_photograph',
    blocksBuild: false, category: 'hangings', mount: 'wall', wallSpan: 2, mountY: 1.6,
    subW: 2, subL: 1, subH: 2,
    desc: 'A framed photograph of the facility during first beam, before the cable trays filled up.',
  },
  acceleratorBlueprint: {
    id: 'acceleratorBlueprint', name: 'Accelerator Blueprint', cost: { funding: 22 }, removeCost: 0,
    morale: 0.5, placement: 'indoor', spriteKey: 'accelerator_blueprint',
    blocksBuild: false, category: 'hangings', mount: 'wall', wallSpan: 3, mountY: 1.6,
    subW: 3, subL: 1, subH: 2,
    desc: 'A framed technical drawing of an accelerator lattice, complete with optimistic annotations.',
  },
  wallTelevision: {
    id: 'wallTelevision', name: 'Wall TV', cost: { funding: 180 }, removeCost: 10,
    morale: 0.75, placement: 'indoor', spriteKey: 'wall_television',
    blocksBuild: false, category: 'hangings', mount: 'wall', wallSpan: 3, mountY: 1.65,
    subW: 3, subL: 1, subH: 2,
    desc: 'A wall-mounted display for schedules, status dashboards, and the occasional seminar stream.',
  },
  largeWallTelevision: {
    id: 'largeWallTelevision', name: 'Large Wall TV', cost: { funding: 320 }, removeCost: 15,
    morale: 1, placement: 'indoor', spriteKey: 'large_wall_television',
    blocksBuild: false, category: 'hangings', mount: 'wall', wallSpan: 4, mountY: 1.7,
    subW: 4, subL: 1, subH: 2.5,
    desc: 'A room-scale display for control dashboards and presentations with very small axis labels.',
  },
  wallWhiteboard: {
    id: 'wallWhiteboard', name: 'Wall Whiteboard', cost: { funding: 45 }, removeCost: 0,
    morale: 0.5, placement: 'indoor', spriteKey: 'wall_whiteboard',
    blocksBuild: false, category: 'hangings', mount: 'wall', wallSpan: 3, mountY: 1.55,
    subW: 3, subL: 1, subH: 2,
    desc: 'A magnetic whiteboard with marker tray, equations, and one emphatic DO NOT ERASE.',
  },
  wallBlackboard: {
    id: 'wallBlackboard', name: 'Wall Blackboard', cost: { funding: 50 }, removeCost: 0,
    morale: 0.75, placement: 'indoor', spriteKey: 'wall_blackboard',
    blocksBuild: false, category: 'hangings', mount: 'wall', wallSpan: 3, mountY: 1.55,
    subW: 3, subL: 1, subH: 2,
    desc: 'A slate blackboard with a chalk rail and the satisfying permanence of an unfinished derivation.',
  },
  noticeBoard: {
    id: 'noticeBoard', name: 'Notice Board', cost: { funding: 20 }, removeCost: 0,
    morale: 0.25, placement: 'indoor', spriteKey: 'notice_board',
    blocksBuild: false, category: 'hangings', mount: 'wall', wallSpan: 2, mountY: 1.55,
    subW: 2, subL: 1, subH: 2,
    desc: 'A cork notice board layered with shift rotas, seminar flyers, and expired safety reminders.',
  },
};

// Palette-preview descriptions, kept in one block so the data table above
// stays scannable. Every item must have an entry — the HUD preview panel
// shows these on hover/keyboard focus.
const DECORATION_DESCS = {
  flowerBed: 'Stone-bordered planter with a small morale boost. Click for bloom colors. Outdoor only.',
  largeFlowerBed: 'Full flower plot for showpiece landscaping. Click for bloom colors. Outdoor only.',
  longFlowerBed: 'Slim planter strip for edging walkways. Click for bloom colors. Outdoor only.',
  oakTree: 'Broad shade oak. Boosts morale; blocks building beneath its canopy.',
  mapleTree: 'Maple with a generous canopy. Boosts morale; blocks building.',
  elmTree: 'Classic campus elm. Boosts morale; blocks building.',
  birchTree: 'White-barked birch to brighten a dull corner of campus. Blocks building.',
  pineTree: 'Evergreen pine — looks good year-round at a facility with no seasons.',
  cedarTree: 'Dense cedar evergreen for windbreaks and screening.',
  smallTree: 'A modest sapling with ambitions. Greenery on a postdoc budget.',
  willowTree: 'Weeping willow for pond-side contemplation of failed runs.',
  shrub: 'A humble bush. Landscaping at its most affordable.',
  parkBench: 'Outdoor seating for lunch breaks and stress-testing theories.',
  picnicTable: 'Outdoor table for group lunches and journal club in the sun.',
  fountain: 'Ornamental fountain — the only unscheduled water feature allowed on site.',
  statue: 'Commemorates the founder, or possibly the first working klystron.',
  propaneTank: 'Horizontal propane vessel on concrete saddles for heating and emergency plant. Decorative site utility.',
  utilityPole: 'Functional HV distribution pole with an incoming and outgoing crossarm terminal. Draw HV feeders between rotated poles to hang real, sagging conductors.',
  overheadPowerSpan: 'Legacy decorative two-pole span retained for old saves. Use functional Utility Poles and real HV feeders for new construction.',
  outdoorPipeRack: 'Elevated rack carrying color-coded campus service pipes. Decorative site utility.',
  backupGenerator: '250 kW standby generator with finite fuel. Connect it to the backup terminal of an Automatic Transfer Switch; refuel and enable it from its equipment window.',
  guardTower: 'Raised perimeter watch tower with enclosed cabin, railings, ladder, and an excellent view of the switchyard.',
  securityGatehouse: 'Glazed checkpoint booth with canopy and vehicle-control arm.',
  securityCameraMast: 'Tall camera mast with three directional surveillance heads.',
  vehicleBarrier: 'Heavy concrete traffic barrier for protected approaches and checkpoint lanes.',
  securityBollard: 'Impact-rated steel bollard. Shift-drag to protect a curb or entrance.',
  trashCan: 'Keeps the campus tidy. Contents: mostly coffee cups.',
  recyclingBin: 'For paper drafts v1 through v47.',
  infoSign: 'Campus map board so visitors can get lost with confidence.',
  directionSign: 'Points to the cafeteria, the exit, and vaguely toward physics.',
  flagpole: 'Flies the institutional colors above the facility.',
};
for (const [id, desc] of Object.entries(DECORATION_DESCS)) {
  if (DECORATIONS_RAW[id]) DECORATIONS_RAW[id].desc = desc;
}

export function computeMoraleMultiplier(decorations) {
  let total = 0;
  for (const dec of decorations) {
    const def = DECORATIONS_RAW[dec.type];
    if (def) total += def.morale;
  }
  return Math.min(1.25, 1.0 + total * 0.005);
}

export function getReputationTier(decorationCount) {
  if (decorationCount >= 60) return { label: 'Distinguished', fundingBonus: 0.10 };
  if (decorationCount >= 30) return { label: 'Pleasant', fundingBonus: 0.05 };
  if (decorationCount >= 10) return { label: 'Functional', fundingBonus: 0.02 };
  return { label: 'Spartan', fundingBonus: 0 };
}
