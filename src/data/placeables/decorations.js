// src/data/placeables/decorations.js
//
// Decoration defs derived from the legacy DECORATIONS_RAW registry.

import { DECORATIONS_RAW } from '../decorations.raw.js';
import { toDims } from './dims.js';

// Decorations rarely author size fields — default subH to a full tile
// (4 sub-tiles) so trees/benches keep their legacy size until authored.
export const DECORATION_DEFS = Object.values(DECORATIONS_RAW).map((raw) => {
  const { subW, subL, subH } = toDims(raw, { subH: 4 });
  return { ...raw, kind: 'decoration', subW, subL, subH };
});
