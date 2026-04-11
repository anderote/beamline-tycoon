// src/data/placeables/equipment.js
//
// Equipment defs derived from COMPONENTS_RAW entries that are not modules,
// not attachments, and not drawn connections. In the current data, no
// entry matches these criteria, so EQUIPMENT_DEFS is empty. Kept for
// future use.

import { COMPONENTS_RAW } from '../components.raw.js';

function toSubtiles(raw) {
  if (raw.subW != null && (raw.subL != null || raw.subH != null)) {
    return { subW: raw.subW, subH: raw.subL ?? raw.subH };
  }
  return { subW: (raw.gridW ?? 1) * 4, subH: (raw.gridH ?? 1) * 4 };
}

const EQUIPMENT_IDS = Object.keys(COMPONENTS_RAW).filter((id) => {
  const c = COMPONENTS_RAW[id];
  return c.placement !== 'module' && !c.isDrawnConnection && c.placement !== 'attachment';
});

export const EQUIPMENT_DEFS = EQUIPMENT_IDS.map((id) => {
  const raw = COMPONENTS_RAW[id];
  const { subW, subH } = toSubtiles(raw);
  return { ...raw, kind: 'equipment', subW, subH };
});
