// src/utility/registry.js
// Registry of all utility-type descriptors. Imports each per-utility module and
// exports a {type → descriptor} map. Adding a 7th utility = one import + entry.

import powerCable from './types/powerCable.js';
import vacuumPipe from './types/vacuumPipe.js';
import rfWaveguide from './types/rfWaveguide.js';
import coolingWater from './types/coolingWater.js';
import cryoTransfer from './types/cryoTransfer.js';
import dataFiber from './types/dataFiber.js';
import { UTILITY_LINE_Y } from './line-geometry.js';

const all = [powerCable, vacuumPipe, rfWaveguide, coolingWater, cryoTransfer, dataFiber];

export const UTILITY_TYPES = Object.fromEntries(all.map(d => [d.type, d]));

// Clearance between the deck and the underside of a run, in metres. Small and
// non-zero: enough that the geometry does not z-fight the floor it lies on.
const GROUND_CLEARANCE = 0.01;

/**
 * Height in metres at which a utility's lines run.
 *
 * Services are LAID, not flown: a cord, a hose and a pipe all lie on the deck
 * and are stepped over. They used to float at a flat half-metre — the same
 * height for all six regardless of thickness — which read as pipework
 * hovering in mid-air and left every cable disconnected from the floor it was
 * supposed to be resting on.
 *
 * Derived from the pipe's own radius, so a 2 cm cord and a 6 cm vacuum line
 * each rest ON the ground rather than one of them sinking into it. A
 * descriptor can still pin its own `runHeightMeters` for a service that is
 * genuinely carried overhead.
 *
 * Used by the renderer AND by the input tool, which has to pick against the
 * plane it draws on — see UtilityLineTool._cableWorld.
 */
export function utilityLineHeight(utilityType) {
  const d = UTILITY_TYPES[utilityType];
  if (!d) return UTILITY_LINE_Y;
  if (Number.isFinite(d.runHeightMeters)) return d.runHeightMeters;
  const r = d.pipeRadiusMeters;
  return Number.isFinite(r) ? r + GROUND_CLEARANCE : UTILITY_LINE_Y;
}
export const UTILITY_TYPE_LIST = all.map(d => d.type);
export const UtilityRegistry = { types: UTILITY_TYPES, list: UTILITY_TYPE_LIST };
