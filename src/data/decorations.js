// src/data/decorations.js
//
// LEGACY SHIM: DECORATIONS re-derives from PLACEABLES. Helper functions
// are re-exported from decorations.raw.js unchanged.

import { PLACEABLES } from './placeables/index.js';

export const DECORATIONS = {};
for (const p of Object.values(PLACEABLES)) {
  if (p.kind === 'decoration') {
    DECORATIONS[p.id] = p;
  }
}

export { computeMoraleMultiplier, getReputationTier } from './decorations.raw.js';
