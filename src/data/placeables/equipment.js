// src/data/placeables/equipment.js
//
// Equipment = items placed in lab / machine shop / maintenance facility
// zones (oscilloscopes, vacuum pumps, lathes, etc.). Sourced from
// facility-lab-furnishings.raw.js. Together with furnishings.js (room
// items), these populate the Facility build mode.

import { FACILITY_LAB_FURNISHINGS_RAW } from '../facility-lab-furnishings.raw.js';

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

export const EQUIPMENT_DEFS = Object.values(FACILITY_LAB_FURNISHINGS_RAW).map((raw) => {
  const { subW, subL, subH } = toDims(raw);
  return { ...raw, kind: 'equipment', subW, subL, subH };
});
