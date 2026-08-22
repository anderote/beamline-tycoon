// Pure presentation policy for electrical spark emitters. Physics and utility
// solvers publish the mutation; this module only chooses a readable amount of
// colour-only particle feedback for the renderer.

import {
  electricalSparkProfile,
  equipmentSparkProfile,
} from './particle-effect-tuning.js';

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
