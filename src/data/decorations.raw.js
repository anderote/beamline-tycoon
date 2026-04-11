// Decoration items — placeable cosmetic/morale items on the map
export const DECORATIONS_RAW = {
  // === Trees & Plants ===
  oakTree: {
    id: 'oakTree', name: 'Oak Tree', cost: 15, removeCost: 10,
    morale: 1, placement: 'outdoor', spriteKey: 'oak_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  mapleTree: {
    id: 'mapleTree', name: 'Maple Tree', cost: 15, removeCost: 10,
    morale: 1, placement: 'outdoor', spriteKey: 'maple_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  elmTree: {
    id: 'elmTree', name: 'Elm Tree', cost: 15, removeCost: 10,
    morale: 1, placement: 'outdoor', spriteKey: 'elm_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  birchTree: {
    id: 'birchTree', name: 'Birch Tree', cost: 15, removeCost: 10,
    morale: 1, placement: 'outdoor', spriteKey: 'birch_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  pineTree: {
    id: 'pineTree', name: 'Pine Tree', cost: 12, removeCost: 8,
    morale: 1, placement: 'outdoor', spriteKey: 'pine_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  cedarTree: {
    id: 'cedarTree', name: 'Cedar Tree', cost: 12, removeCost: 8,
    morale: 1, placement: 'outdoor', spriteKey: 'cedar_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  smallTree: {
    id: 'smallTree', name: 'Small Tree', cost: 8, removeCost: 5,
    morale: 0.5, placement: 'outdoor', spriteKey: 'small_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  willowTree: {
    id: 'willowTree', name: 'Willow Tree', cost: 18, removeCost: 12,
    morale: 1.5, placement: 'outdoor', spriteKey: 'willow_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  shrub: {
    id: 'shrub', name: 'Shrub', cost: 3, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'shrub',
    blocksBuild: false, category: 'treesPlants',
    gridW: 1, gridH: 1,
  },
  flowerBed: {
    id: 'flowerBed', name: 'Flower Bed', cost: 5, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'flower_bed',
    blocksBuild: false, category: 'treesPlants',
    gridW: 2, gridH: 1,
  },
  flowerGarden: {
    id: 'flowerGarden', name: 'Flower Garden', cost: 10, removeCost: 0,
    morale: 1, placement: 'outdoor', spriteKey: 'flower_garden',
    blocksBuild: false, category: 'treesPlants',
    gridW: 2, gridH: 2,
  },

  // (Hedges and fencing moved to wall system — see WALL_TYPES in infrastructure.js)

  // === Furniture ===
  parkBench: {
    id: 'parkBench', name: 'Park Bench', cost: 10, removeCost: 0,
    morale: 1, placement: 'outdoor', spriteKey: 'park_bench',
    blocksBuild: false, category: 'furniture',
    gridW: 3, gridH: 1,
  },
  picnicTable: {
    id: 'picnicTable', name: 'Picnic Table', cost: 15, removeCost: 0,
    morale: 1.5, placement: 'outdoor', spriteKey: 'picnic_table',
    blocksBuild: false, category: 'furniture',
    gridW: 2, gridH: 2,
  },
  fountain: {
    id: 'fountain', name: 'Fountain', cost: 50, removeCost: 0,
    morale: 3, placement: 'outdoor', spriteKey: 'fountain',
    blocksBuild: true, category: 'furniture',
    gridW: 3, gridH: 3,
  },
  statue: {
    id: 'statue', name: 'Statue', cost: 40, removeCost: 0,
    morale: 2, placement: 'outdoor', spriteKey: 'statue',
    blocksBuild: true, category: 'furniture',
    gridW: 2, gridH: 2,
  },

  // === Lighting ===
  lamppost: {
    id: 'lamppost', name: 'Lamppost', cost: 8, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'lamppost',
    blocksBuild: false, category: 'lighting',
    gridW: 1, gridH: 1,
  },
  bollardLight: {
    id: 'bollardLight', name: 'Bollard Light', cost: 6, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'bollard_light',
    blocksBuild: false, category: 'lighting',
    gridW: 1, gridH: 1,
  },
  spotLight: {
    id: 'spotLight', name: 'Spot Light', cost: 12, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'spot_light',
    blocksBuild: false, category: 'lighting',
    gridW: 1, gridH: 1,
  },

  // === Bins & Signs ===
  trashCan: {
    id: 'trashCan', name: 'Trash Can', cost: 5, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'trash_can',
    blocksBuild: false, category: 'bins',
    gridW: 1, gridH: 1,
  },
  recyclingBin: {
    id: 'recyclingBin', name: 'Recycling Bin', cost: 8, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'recycling_bin',
    blocksBuild: false, category: 'bins',
    gridW: 1, gridH: 1,
  },
  infoSign: {
    id: 'infoSign', name: 'Info Sign', cost: 10, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'info_sign',
    blocksBuild: false, category: 'bins',
    gridW: 1, gridH: 1,
  },
  directionSign: {
    id: 'directionSign', name: 'Direction Sign', cost: 8, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'direction_sign',
    blocksBuild: false, category: 'bins',
    gridW: 1, gridH: 1,
  },
  flagpole: {
    id: 'flagpole', name: 'Flagpole', cost: 15, removeCost: 0,
    morale: 1, placement: 'outdoor', spriteKey: 'flagpole',
    blocksBuild: false, category: 'bins',
    gridW: 1, gridH: 1,
  },
};

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
