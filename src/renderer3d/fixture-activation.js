import { CINEMATIC_LIGHTING } from './lighting-tuning.js';

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Shared activation policy for emitter surfaces, painted pools, analytic
 * lights, and volumetrics. Outdoor fixtures follow the sun. A fixture placed
 * in an authored room zone stays useful during the day, while an unzoned
 * overhead fixture keeps a faint practical floor for partially built halls.
 */
export function fixtureActivationFactor(def, darkness, context = {}) {
  const night = clamp01(darkness);
  const authoredDayFloor = clamp01(def?.light?.dayFloor);
  if (context.indoors) return Math.max(
    night, authoredDayFloor, CINEMATIC_LIGHTING.fixtures.interiorDayFloor,
  );
  if (def?.mount === 'overhead') {
    return Math.max(night, authoredDayFloor, CINEMATIC_LIGHTING.fixtures.overheadDayFloor);
  }
  return Math.max(night, authoredDayFloor);
}
