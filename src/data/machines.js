// Machine tier for each beamline component — controls which components are visible
// for each machine type. Components without an entry default to tier 1.
// Tier 1: Electron Linac (basic optics, RF, beam to target)
// Tier 2: Photoinjector (photoguns, solenoid, diagnostics, space charge regime)
// Tier 3: FEL (bunch compression, undulators, photon science)
// Tier 4: Collider (positrons, detectors, beam-beam physics)
export const MACHINE_TIER = {
  // Tier 1 — available from start (default)
  // source, drift, driftVert, bellows, quadrupole, dipole, rfCavity, collimator,
  // target, beamDump, bpm, faradayCup, beamStop, corrector, aperture

  // Tier 2 — Photoinjector
  dcPhotoGun: 2, ncRfGun: 2, srfGun: 2,
  solenoid: 2,
  laserSystem: 2,

  // Tier 3 — FEL
  chicane: 3, harmonicLinearizer: 3, dogleg: 3, laserHeater: 3,
  undulator: 3, helicalUndulator: 3, wiggler: 3, apple2Undulator: 3,
  photonPort: 3,
  bunchLengthMonitor: 3, energySpectrometer: 3,
  cryomodule: 3, srf650Cavity: 3, cbandCavity: 3, xbandCavity: 3,
  sextupole: 3, octupole: 3,
  scQuad: 3, scDipole: 3,
  combinedFunctionMagnet: 3,

  // Tier 4 — Collider
  positronTarget: 4,
  detector: 4,
  kickerMagnet: 4, septumMagnet: 4,
  comptonIP: 4,
  fixedTargetAdv: 4,
  stripperFoil: 4,
};

// Machine type definitions for UI
export const MACHINE_TYPES = {
  linac:          { name: 'Electron Linac',  tier: 1, desc: 'Deliver beam to target' },
  photoinjector:  { name: 'Photoinjector',   tier: 2, desc: 'Maximize beam brightness' },
  fel:            { name: 'Free Electron Laser', tier: 3, desc: 'Achieve FEL saturation' },
  collider:       { name: 'e⁺e⁻ Collider',  tier: 4, desc: 'Accumulate discoveries' },
};
