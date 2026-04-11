// src/renderer3d/materials/index.js
// Public surface for the materials module.

export { MATERIALS } from './tiled.js';
export { DECALS, makeDecal } from './decals.js';

/**
 * Texture pixels per world meter. A 64×64 source texture covers a
 * (64 / TEXEL_SCALE) m × (64 / TEXEL_SCALE) m surface — currently 2m × 2m.
 * Tweak here to change global pixel density of all tiled materials.
 */
export const TEXEL_SCALE = 32;
