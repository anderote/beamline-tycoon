// src/data/placeables/furnishings.js
//
// Furnishing defs derived from the legacy ZONE_FURNISHINGS_RAW literal.

import { ZONE_FURNISHINGS_RAW } from '../zone-furnishings.raw.js';
import { COMPONENTS_RAW } from '../components.raw.js';

function toSubtiles(raw) {
  if (raw.subW != null && (raw.subL != null || raw.subH != null)) {
    return { subW: raw.subW, subH: raw.subL ?? raw.subH };
  }
  return { subW: (raw.gridW ?? 1) * 4, subH: (raw.gridH ?? 1) * 4 };
}

// Some furnishing ids historically collide with beamline module ids
// (e.g. 'heatExchanger' exists in both registries as distinct things).
// We skip furnishings that collide; the ZONE_FURNISHINGS shim in
// infrastructure.js falls back to ZONE_FURNISHINGS_RAW for these.
export const FURNISHING_DEFS = Object.values(ZONE_FURNISHINGS_RAW)
  .filter((raw) => !COMPONENTS_RAW[raw.id])
  .map((raw) => {
    const { subW, subH } = toSubtiles(raw);
    return { ...raw, kind: 'furnishing', subW, subH };
  });
