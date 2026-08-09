// src/data/placeables/index.js
//
// Single source of truth for every placeable in the game.
// Aggregates per-kind def files and wraps each entry in a Placeable
// at module load.

import { Placeable } from '../../game/Placeable.js';
import { BEAMLINE_MODULE_DEFS } from './beamline-modules.js';
import { INFRASTRUCTURE_DEFS } from './infrastructure.js';
import { FURNISHING_DEFS } from './furnishings.js';
import { EQUIPMENT_DEFS } from './equipment.js';
import { DECORATION_DEFS } from './decorations.js';

const ALL_DEFS = [
  ...BEAMLINE_MODULE_DEFS,
  ...INFRASTRUCTURE_DEFS,
  ...FURNISHING_DEFS,
  ...EQUIPMENT_DEFS,
  ...DECORATION_DEFS,
];

export const PLACEABLES = {};

for (const def of ALL_DEFS) {
  if (PLACEABLES[def.id]) {
    throw new Error(`Duplicate placeable id: ${def.id}`);
  }
  // Placeable's constructor rejects unknown kinds.
  PLACEABLES[def.id] = new Placeable(def);
}

export function placeablesByKind(kind) {
  return Object.values(PLACEABLES).filter(p => p.kind === kind);
}
