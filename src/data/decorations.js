// Decoration items — placeable cosmetic/morale items on the map
export const DECORATIONS = {
  // === Outdoor (grass-only) ===
  oakTree: {
    id: 'oakTree', name: 'Oak Tree', cost: 15, removeCost: 10,
    morale: 1, placement: 'outdoor', spriteKey: 'oak_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  pineTree: {
    id: 'pineTree', name: 'Pine Tree', cost: 12, removeCost: 8,
    morale: 1, placement: 'outdoor', spriteKey: 'pine_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  smallTree: {
    id: 'smallTree', name: 'Small Tree', cost: 8, removeCost: 5,
    morale: 0.5, placement: 'outdoor', spriteKey: 'small_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  shrub: {
    id: 'shrub', name: 'Shrub', cost: 3, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'shrub',
    blocksBuild: false, category: 'treesPlants',
  },
  flowerBed: {
    id: 'flowerBed', name: 'Flower Bed', cost: 5, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'flower_bed',
    blocksBuild: false, category: 'treesPlants',
  },
  parkBench: {
    id: 'parkBench', name: 'Park Bench', cost: 10, removeCost: 0,
    morale: 1, placement: 'outdoor', spriteKey: 'park_bench',
    blocksBuild: false, category: 'furniture',
  },
  lamppost: {
    id: 'lamppost', name: 'Lamppost', cost: 8, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'lamppost',
    blocksBuild: false, category: 'lighting',
  },
  ironFence: {
    id: 'ironFence', name: 'Iron Fence', cost: 4, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'iron_fence',
    blocksBuild: false, category: 'fencing',
  },
  hedge: {
    id: 'hedge', name: 'Hedge', cost: 6, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'hedge_0',
    blocksBuild: false, category: 'fencing',
  },
};

export function computeMoraleMultiplier(decorations) {
  let total = 0;
  for (const dec of decorations) {
    const def = DECORATIONS[dec.type];
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
