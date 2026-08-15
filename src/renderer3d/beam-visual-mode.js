// src/renderer3d/beam-visual-mode.js
//
// A deliberately small rendering policy. Simulation may operate at RF and
// optical frequencies, but the world view needs a legible representation at
// human time scales: a steady core for continuous delivery, travelling packets
// when the machine has pulse structure or deliberately bunches the beam.

const BUNCHING_COMPONENTS = new Set([
  'buncher', 'rfq', 'bunchCompressor', 'rfAccelerationModule',
  'sbandStructure', 'cbandStructure', 'xbandStructure',
]);

/** Returns 'continuous' or 'bunched' for a running beamline visual. */
export function beamVisualMode(beamlineType, elements = []) {
  // Low duty beamlines are visibly delivered as a pulse train. A CW machine
  // becomes visibly bunched once its lattice intentionally captures/compresses
  // the beam; an electrostatic/DC transport otherwise stays a steady core.
  if (Number.isFinite(beamlineType?.dutyFactor) && beamlineType.dutyFactor < 0.75) {
    return 'bunched';
  }
  return elements.some(el => BUNCHING_COMPONENTS.has(el?.type))
    ? 'bunched'
    : 'continuous';
}
