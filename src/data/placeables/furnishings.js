// src/data/placeables/furnishings.js
//
// Furnishings = social/office decor placed in room facility zones
// (control room, office, meeting room, cafeteria). Sourced from
// facility-room-furnishings.raw.js. Lab/shop equipment lives in
// equipment.js instead.

import { FACILITY_ROOM_FURNISHINGS_RAW } from '../facility-room-furnishings.raw.js';
import { toDims } from './dims.js';

export const FURNISHING_DEFS = Object.values(FACILITY_ROOM_FURNISHINGS_RAW).map((raw) => {
  const { subW, subL, subH } = toDims(raw);
  return { ...raw, kind: 'furnishing', subW, subL, subH, hasSurface: raw.hasSurface ?? true, stackable: raw.stackable ?? false };
});
