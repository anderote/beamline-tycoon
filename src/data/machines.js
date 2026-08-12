// MACHINE_TIER lived here: a component -> tier map that decided palette
// visibility per machine type. It was deleted along with Wave 1 of the
// beamline-types work, which replaces it properly.
//
// It had been dead for a long time before that. Nothing ever set machineType to
// anything but 'linac', so the gate never fired; its only lasting effect was
// that the ids it named were kept alive in test-registry-integrity.js's
// UNIMPLEMENTED_CONTENT allowlist purely so the map itself would validate.
// Component visibility is now decided by the `beamlineTypes` allowlist on each
// component and the `excludes` denylist on each type — see
// src/data/beamline-types.js and beamlineTypeHidesComponent().

// Machine type definitions for UI
export const MACHINE_TYPES = {
  linac:          { name: 'Electron Linac',  tier: 1, desc: 'Deliver beam to target' },
  photoinjector:  { name: 'Photoinjector',   tier: 2, desc: 'Maximize beam brightness' },
  fel:            { name: 'Free Electron Laser', tier: 3, desc: 'Achieve FEL saturation' },
  collider:       { name: 'e⁺e⁻ Collider',  tier: 4, desc: 'Accumulate discoveries' },
};
