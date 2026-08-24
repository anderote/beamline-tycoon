// Pure presentation policy for electrical spark emitters. Physics and utility
// solvers publish the mutation; this module only chooses a readable amount of
// colour-only particle feedback for the renderer.

import {
  electricalSparkProfile,
  equipmentSparkProfile,
} from './particle-effect-tuning.js';
import { utilityLineHeight } from '../utility/registry.js';
import { sanitizeCablePath } from '../utility/soft-cable.js';

export function utilityConnectionSparkProfile(line) {
  if (!line?.start || !line?.end || line.buried === true) return null;
  if (line.utilityType === 'hvCable') {
    return electricalSparkProfile('hvConnection');
  }
  if (line.utilityType === 'powerCable') {
    return electricalSparkProfile('powerConnection');
  }
  return null;
}

export function equipmentPowerUpSparkProfile(count = 18) {
  return equipmentSparkProfile(count);
}

/** A few pixels rather than the dense shower used for plugging in a feeder. */
export function ambientHvConnectionSparkProfile() {
  const profile = electricalSparkProfile('hvConnection');
  return {
    ...profile,
    count: 4,
    speedMin: profile.speedMin * 0.42,
    speedMax: profile.speedMax * 0.58,
    lifetimeMin: profile.lifetimeMin * 0.34,
    lifetimeMax: profile.lifetimeMax * 0.38,
    size: profile.size * 0.82,
    restitution: Math.min(profile.restitution, 0.48),
  };
}

/** Exposed live conductors arc more visibly than intact connector hardware. */
export function ambientLooseHvSparkProfile() {
  const profile = electricalSparkProfile('hvConnection');
  return {
    ...profile,
    count: 8,
    speedMin: profile.speedMin * 0.52,
    speedMax: profile.speedMax * 0.68,
    lifetimeMin: profile.lifetimeMin * 0.28,
    lifetimeMax: profile.lifetimeMax * 0.36,
    size: profile.size * 0.94,
    restitution: Math.min(profile.restitution, 0.44),
  };
}

/**
 * Locate the rendered loose tip of a one-ended HV cable.
 *
 * Soft-cable rendering preserves the first and last trace samples exactly;
 * an unanchored terminal rests at the utility's route height. Keeping this
 * conversion pure lets the scheduler publish a ready-to-render anchor without
 * reaching into Three.js scene geometry or rediscovering topology.
 */
export function looseHvCableSparkAnchor(line) {
  if (line?.utilityType !== 'hvCable' || line.buried === true
      || !!line.start === !!line.end) return null;
  const trace = sanitizeCablePath(
    Array.isArray(line.cablePath) && line.cablePath.length >= 2
      ? line.cablePath : line.path,
  );
  if (trace.length < 2) return null;
  const looseEnd = line.start ? 'end' : 'start';
  const tipIndex = looseEnd === 'start' ? 0 : trace.length - 1;
  const innerIndex = looseEnd === 'start' ? 1 : trace.length - 2;
  const tip = trace[tipIndex];
  const inner = trace[innerIndex];
  const dx = (tip.col - inner.col) * 2;
  const dz = (tip.row - inner.row) * 2;
  const length = Math.hypot(dx, dz);
  return {
    looseEnd,
    position: {
      x: tip.col * 2,
      y: utilityLineHeight(line.utilityType, line.routeHeightMeters),
      z: tip.row * 2,
    },
    normal: length > 1e-6
      ? { x: dx / length, y: 0.18, z: dz / length }
      : { x: 0, y: 1, z: 0 },
  };
}

/** Slightly fuller near nameplate load, while remaining a small cabinet spit. */
export function ambientDistributorSparkProfile(utilization = 0) {
  const load = Math.max(0, Math.min(1, Number(utilization) || 0));
  const profile = equipmentSparkProfile(2 + Math.round(load * 3));
  return {
    ...profile,
    speedMin: profile.speedMin * 0.62,
    speedMax: profile.speedMax * 0.72,
    lifetimeMin: profile.lifetimeMin * 0.55,
    lifetimeMax: profile.lifetimeMax * 0.62,
    size: profile.size * 0.86,
  };
}
