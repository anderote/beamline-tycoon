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
