// src/data/placeables/infrastructure.js
//
// Infrastructure defs — items placed in Infra build mode.
// Sourced from infrastructure.raw.js (power, vacuum, rfPower, cooling,
// dataControls, ops). Items with placement === 'attachment' (e.g. gauges
// and gate valves that mount on vacuum pipes) are excluded — they are not Placeables.

import { INFRASTRUCTURE_RAW } from '../infrastructure.raw.js';
import { toDims } from './dims.js';

const INFRASTRUCTURE_IDS = Object.keys(INFRASTRUCTURE_RAW).filter((id) => {
  const c = INFRASTRUCTURE_RAW[id];
  return c.placement === 'module' && !c.isDrawnConnection;
});

export const INFRASTRUCTURE_DEFS = INFRASTRUCTURE_IDS.map((id) => {
  const raw = INFRASTRUCTURE_RAW[id];
  const { subW, subL, subH } = toDims(raw);
  return { ...raw, kind: 'infrastructure', subW, subL, subH, hasSurface: raw.hasSurface ?? true, stackable: raw.stackable ?? false };
});
