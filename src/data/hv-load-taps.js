// HV-fed equipment whose physical roof terminal may sit inline on a feeder.
//
// These remain electrical loads; the tap only permits one arriving and one
// continuing cable segment at the same insulated terminal. Exposed-tube RF
// sources (klystrons, TWTs, IOTs and gyrotrons) deliberately stay off this
// list because their models do not provide a credible cabinet roof mount.

export const HV_LOAD_TAP_IDS = Object.freeze([
  'heCompressor',
  'coldBox4K',
  'coldBox2K',
  'dualCircuitChiller',
  'chiller',
  'dryCoolerBank',
  'coolingTower',
  'magnetron',
  'lowBandBuncherAmp',
  'solidStateAmp',
  'highPowerSSA',
]);

const HV_LOAD_TAP_ID_SET = new Set(HV_LOAD_TAP_IDS);

export function isHvLoadTap(type) {
  return HV_LOAD_TAP_ID_SET.has(type);
}

