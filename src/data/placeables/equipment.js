// src/data/placeables/equipment.js
//
// Equipment = items placed in lab / machine shop / maintenance facility
// zones (oscilloscopes, vacuum pumps, lathes, etc.). Sourced from
// facility-lab-furnishings.raw.js. Together with furnishings.js (room
// items), these populate the Facility build mode.

import { FACILITY_LAB_FURNISHINGS_RAW } from '../facility-lab-furnishings.raw.js';
import { toDims } from './dims.js';

export const EQUIPMENT_DEFS = Object.values(FACILITY_LAB_FURNISHINGS_RAW).map((raw) => {
  const { subW, subL, subH } = toDims(raw);
  return { ...raw, kind: 'equipment', subW, subL, subH, hasSurface: raw.hasSurface ?? true, stackable: raw.stackable ?? false };
});
