// src/utility/registry.js
// Registry of all utility-type descriptors. Imports each per-utility module and
// exports a {type → descriptor} map. Adding a 7th utility = one import + entry.

import powerCable from './types/powerCable.js';
import vacuumPipe from './types/vacuumPipe.js';
import rfWaveguide from './types/rfWaveguide.js';
import coolingWater from './types/coolingWater.js';
import cryoTransfer from './types/cryoTransfer.js';
import dataFiber from './types/dataFiber.js';

const all = [powerCable, vacuumPipe, rfWaveguide, coolingWater, cryoTransfer, dataFiber];

export const UTILITY_TYPES = Object.fromEntries(all.map(d => [d.type, d]));
export const UTILITY_TYPE_LIST = all.map(d => d.type);
export const UtilityRegistry = { types: UTILITY_TYPES, list: UTILITY_TYPE_LIST };
