// Central art-direction controls for the world lighting stack. Keep these
// values renderer-agnostic so the grade can be covered by headless tests.

export const CINEMATIC_LIGHTING = Object.freeze({
  exposure: Object.freeze({ day: 1.08, twilight: 1.18, night: 1.22 }),
  ambient: Object.freeze({ day: 0.72, night: 0.48 }),
  sun: Object.freeze({ dayIntensity: 2.35, orbitRadius: 72, minElevation: 2, maxElevation: 54 }),
  moon: Object.freeze({ maxIntensity: 0.52 }),
  atmosphere: Object.freeze({ dayDensity: 0.0024, nightDensity: 0.0048 }),
  contactAO: Object.freeze({ radius: 1.15, thickness: 1.8, distanceFallOff: 0.72 }),
  fixtures: Object.freeze({ interiorDayFloor: 0.82, overheadDayFloor: 0.28 }),
  bloom: Object.freeze({ strength: 0.52, radius: 0.28, threshold: 0.82 }),
});
