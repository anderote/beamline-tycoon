// src/data/placeables/furnishings.js
//
// Furnishings = social/office decor placed in room facility zones
// (control room, office, meeting room, cafeteria). Sourced from
// facility-room-furnishings.raw.js. Lab/shop equipment lives in
// equipment.js instead.

import { FACILITY_ROOM_FURNISHINGS_RAW } from '../facility-room-furnishings.raw.js';

// All dims are in SUB-TILES (1 sub-tile = 0.5m). gridW/gridH in the raw
// files are authored in sub-tiles too (not whole tiles), matching subW/subL.
// subW = X footprint, subL = Z footprint, subH = Y height.
function toDims(raw) {
  return {
    subW: raw.subW ?? raw.gridW ?? 4,
    subL: raw.subL ?? raw.gridH ?? 4,
    subH: raw.subH ?? 1,
  };
}

export const FURNISHING_DEFS = Object.values(FACILITY_ROOM_FURNISHINGS_RAW).map((raw) => {
  const { subW, subL, subH } = toDims(raw);
  return { ...raw, kind: 'furnishing', subW, subL, subH, hasSurface: raw.hasSurface ?? true, stackable: raw.stackable ?? false };
});
