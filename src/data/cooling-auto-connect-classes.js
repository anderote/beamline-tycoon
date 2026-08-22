// Cooling-water assisted wiring needs more information than the solver's
// source/sink/pass topology roles. These classes describe which physical
// circuit a port should be paired with when Tab plans nearby pipe runs; they do
// not split networks or change capacity accounting.

export const COOLING_AUTO_CONNECT_CLASS = Object.freeze({
  LOAD: 'coolingLoad',
  LOAD_BRANCH: 'coolingLoadBranch',
  PLANT_LINK: 'coolingPlantLink',
  DISTRIBUTION: 'coolingDistribution',
  DISTRIBUTION_FEED: 'coolingDistributionFeed',
});

export const COOLING_AUTO_CONNECT_CLASSES = new Set(
  Object.values(COOLING_AUTO_CONNECT_CLASS),
);

/** Cooling sinks are load targets by default; every origin class is explicit. */
export function coolingAutoConnectClass(spec) {
  if (spec?.utility !== 'coolingWater') return null;
  if (COOLING_AUTO_CONNECT_CLASSES.has(spec.autoConnectClass)) {
    return spec.autoConnectClass;
  }
  return spec.role === 'sink' ? COOLING_AUTO_CONNECT_CLASS.LOAD : null;
}
