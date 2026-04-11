// src/data/placeables/beamline-modules.js
//
// Beamline module defs derived from the legacy COMPONENTS_RAW registry.
// Each entry is normalized to the unified placeable shape (kind/subW/subH).

import { COMPONENTS_RAW } from '../components.raw.js';

function toSubtiles(raw) {
  if (raw.subW != null && (raw.subL != null || raw.subH != null)) {
    return { subW: raw.subW, subH: raw.subL ?? raw.subH };
  }
  return { subW: (raw.gridW ?? 1) * 4, subH: (raw.gridH ?? 1) * 4 };
}

function normalize(raw) {
  const { subW, subH } = toSubtiles(raw);
  return { ...raw, kind: 'beamline', subW, subH };
}

const BEAMLINE_IDS = Object.keys(COMPONENTS_RAW).filter((id) => {
  const c = COMPONENTS_RAW[id];
  return c.placement === 'module' && !c.isDrawnConnection;
});

export const BEAMLINE_MODULE_DEFS = BEAMLINE_IDS.map((id) => normalize(COMPONENTS_RAW[id]));
