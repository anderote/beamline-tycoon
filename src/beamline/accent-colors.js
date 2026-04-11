// === BEAMLINE ACCENT COLORS ===
// Canonical lab-inspired paint colors applied to the "accent" role meshes
// of placed beamline components (magnet yokes, RF cavity bodies, etc).
// Players can also pick a custom color per beamline — anything outside this
// list is still valid.

/**
 * @typedef {Object} AccentSwatch
 * @property {string} name  Human-readable label shown in the picker UI.
 * @property {number} hex   24-bit color integer (e.g. 0xc62828).
 */

/** @type {ReadonlyArray<AccentSwatch>} */
export const CANONICAL_ACCENTS = Object.freeze([
  { name: 'APS Red',        hex: 0xc62828 },
  { name: 'Fermilab Blue',  hex: 0x1e4a9e },
  { name: 'SLAC Gold',      hex: 0xe8a417 },
  { name: 'CERN Green',     hex: 0x2e7d32 },
  { name: 'JLab Violet',    hex: 0x6a3d9a },
  { name: 'KEK Orange',     hex: 0xe65100 },
  { name: 'DESY Teal',      hex: 0x00838f },
  { name: 'BNL Graphite',   hex: 0x37474f },
]);

/**
 * Pick the Nth canonical accent (wraps around). Used as the default
 * color when a new beamline is created.
 * @param {number} n  Zero-indexed beamline ordinal.
 * @returns {number} hex integer
 */
export function canonicalAccentFor(n) {
  const idx = ((n % CANONICAL_ACCENTS.length) + CANONICAL_ACCENTS.length) % CANONICAL_ACCENTS.length;
  return CANONICAL_ACCENTS[idx].hex;
}
