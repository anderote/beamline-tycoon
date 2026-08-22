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
