// src/data/placeables/infrastructure.js
//
// Infrastructure defs — items placed in Infra build mode.
// Sourced from infrastructure.raw.js (power, vacuum, rfPower, cooling,
// dataControls, ops). Items with placement === 'attachment' (e.g. gauges
// and gate valves that mount on vacuum pipes) are excluded — they are not Placeables.

import { INFRASTRUCTURE_RAW } from '../infrastructure.raw.js';

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

const INFRASTRUCTURE_IDS = Object.keys(INFRASTRUCTURE_RAW).filter((id) => {
  const c = INFRASTRUCTURE_RAW[id];
  return c.placement === 'module' && !c.isDrawnConnection;
});

export const INFRASTRUCTURE_DEFS = INFRASTRUCTURE_IDS.map((id) => {
  const raw = INFRASTRUCTURE_RAW[id];
  const { subW, subL, subH } = toDims(raw);
  return { ...raw, kind: 'infrastructure', subW, subL, subH, hasSurface: raw.hasSurface ?? true, stackable: raw.stackable ?? false };
});
