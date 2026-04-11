// src/data/placeables/furnishings.js
//
// Furnishings = social/office decor: desks, chairs, tables, coffee machines,
// etc. that go in control rooms, offices, cafeterias, and meeting rooms.
// Lab / machine shop / maintenance items live in equipment.js instead.

import { ZONE_FURNISHINGS_RAW } from '../zone-furnishings.raw.js';

const FURNISHING_ZONE_TYPES = new Set([
  'cafeteria',
  'controlRoom',
  'meetingRoom',
  'officeSpace',
]);

function toSubtiles(raw) {
  if (raw.subW != null && (raw.subL != null || raw.subH != null)) {
    return { subW: raw.subW, subH: raw.subL ?? raw.subH };
  }
  return { subW: (raw.gridW ?? 1) * 4, subH: (raw.gridH ?? 1) * 4 };
}

export const FURNISHING_DEFS = Object.values(ZONE_FURNISHINGS_RAW)
  .filter((raw) => FURNISHING_ZONE_TYPES.has(raw.zoneType))
  .map((raw) => {
    const { subW, subH } = toSubtiles(raw);
    return { ...raw, kind: 'furnishing', subW, subH };
  });
