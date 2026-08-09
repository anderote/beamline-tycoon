// src/data/placeables/beamline-modules.js
//
// Beamline module defs — items placed in Beamline build mode.
// Sourced from beamline-components.raw.js (source, optics, rf, diagnostic,
// endpoint). Items are filtered to placement === 'module' and
// non-drawn-connection so drift pipes (drawn between nodes) are excluded.

import { BEAMLINE_COMPONENTS_RAW } from '../beamline-components.raw.js';
import { toDims } from './dims.js';

function normalize(raw) {
  const { subW, subL, subH } = toDims(raw);
  return { ...raw, kind: 'beamline', subW, subL, subH };
}

const BEAMLINE_IDS = Object.keys(BEAMLINE_COMPONENTS_RAW).filter((id) => {
  const c = BEAMLINE_COMPONENTS_RAW[id];
  return c.placement === 'module' && !c.isDrawnConnection;
});

export const BEAMLINE_MODULE_DEFS = BEAMLINE_IDS.map((id) => normalize(BEAMLINE_COMPONENTS_RAW[id]));
