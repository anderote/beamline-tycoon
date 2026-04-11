// src/data/placeables/equipment.js
//
// Equipment = buildable items in lab / machine shop / maintenance zones.
// These are the things the player places via the facility tabs —
// oscilloscopes, vacuum pumps, lathes, etc. They live in the same raw
// file as furnishings (ZONE_FURNISHINGS_RAW) but are partitioned out by
// zoneType so the unified placement system can treat them as their own
// kind.

import { ZONE_FURNISHINGS_RAW } from '../zone-furnishings.raw.js';

const EQUIPMENT_ZONE_TYPES = new Set([
  'coolingLab',
  'diagnosticsLab',
  'machineShop',
  'maintenance',
  'opticsLab',
  'rfLab',
  'vacuumLab',
]);

function toSubtiles(raw) {
  if (raw.subW != null && (raw.subL != null || raw.subH != null)) {
    return { subW: raw.subW, subH: raw.subL ?? raw.subH };
  }
  return { subW: (raw.gridW ?? 1) * 4, subH: (raw.gridH ?? 1) * 4 };
}

export const EQUIPMENT_DEFS = Object.values(ZONE_FURNISHINGS_RAW)
  .filter((raw) => EQUIPMENT_ZONE_TYPES.has(raw.zoneType))
  .map((raw) => {
    const { subW, subH } = toSubtiles(raw);
    return { ...raw, kind: 'equipment', subW, subH };
  });
