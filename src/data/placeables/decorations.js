// src/data/placeables/decorations.js
//
// Decoration defs derived from the legacy DECORATIONS_RAW registry.

import { DECORATIONS_RAW } from '../decorations.raw.js';

// All dims are in SUB-TILES (1 sub-tile = 0.5m). Decorations rarely author
// size fields — default to a full tile (4 sub-tiles) on all axes so trees/
// benches keep their legacy size until authored explicitly.
function toDims(raw) {
  return {
    subW: raw.subW ?? raw.gridW ?? 4,
    subL: raw.subL ?? raw.gridH ?? 4,
    subH: raw.subH ?? 4,
  };
}

export const DECORATION_DEFS = Object.values(DECORATIONS_RAW).map((raw) => {
  const { subW, subL, subH } = toDims(raw);
  return { ...raw, kind: 'decoration', subW, subL, subH };
});
