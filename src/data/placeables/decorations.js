// src/data/placeables/decorations.js
//
// Decoration defs derived from the legacy DECORATIONS_RAW registry.

import { DECORATIONS_RAW } from '../decorations.raw.js';

function toSubtiles(raw) {
  if (raw.subW != null && (raw.subL != null || raw.subH != null)) {
    return { subW: raw.subW, subH: raw.subL ?? raw.subH };
  }
  // Decorations are tile-scale; default 1 tile = 4 subtiles.
  return { subW: (raw.gridW ?? 1) * 4, subH: (raw.gridH ?? 1) * 4 };
}

export const DECORATION_DEFS = Object.values(DECORATIONS_RAW).map((raw) => {
  const { subW, subH } = toSubtiles(raw);
  return { ...raw, kind: 'decoration', subW, subH };
});
