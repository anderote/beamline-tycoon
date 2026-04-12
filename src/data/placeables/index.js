// src/data/placeables/index.js
//
// Single source of truth for every placeable in the game.
// Aggregates per-kind def files and wraps each entry in the right
// Placeable subclass at module load.

import { PLACEABLE_CLASS_BY_KIND } from '../../game/Placeable.js';
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
  const Cls = PLACEABLE_CLASS_BY_KIND[def.kind];
  if (!Cls) {
    throw new Error(`Unknown placeable kind ${def.kind} for ${def.id}`);
  }
  PLACEABLES[def.id] = new Cls(def);
}

export function placeablesByKind(kind) {
  return Object.values(PLACEABLES).filter(p => p.kind === kind);
}
