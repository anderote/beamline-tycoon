// Smart energy unit formatter: takes value in GeV, returns {val, unit} scaled to keV/MeV/GeV/TeV
export function formatEnergy(gev, suffix = '') {
  if (gev == null || !isFinite(gev)) return { val: '--', unit: '' };
  const abs = Math.abs(gev);
  const fmt = (v) => {
    const a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.1) return v.toFixed(3);
    return v.toPrecision(3);
  };
  if (abs >= 1000)  return { val: fmt(gev / 1000), unit: `TeV${suffix}` };
  if (abs >= 1)     return { val: fmt(gev), unit: `GeV${suffix}` };
  if (abs >= 1e-4)  return { val: fmt(gev * 1e3), unit: `MeV${suffix}` };
  if (abs >= 1e-7)  return { val: fmt(gev * 1e6), unit: `keV${suffix}` };
  return { val: fmt(gev * 1e9), unit: `eV${suffix}` };
}

// Units for all component properties, stats, and params
export const UNITS = {
  // Component-level properties
  cost:            'funding',
  energyCost:      'kW',
  length:          'm',
  trackLength:     'tiles',
  trackWidth:      'tiles',
  interiorVolume:  'L',
  powerCapacity:   'kW',
  // Beam stats
  beamCurrent:     'mA',
  bendAngle:       'deg',
  focusStrength:   'T/m',
  beamQuality:     'mm·mrad',
  energyGain:      'MeV',
  dataRate:        'pts/s',
  collisionRate:   'events/s',
  photonRate:      'ph/s (×10¹²)',
  bunchCompression:'factor',
  // Source params
  laserWavelength: 'nm',
  cathodeQE:       '%',
  rfFrequency:     'MHz',
  peakField:       'MV/m',
  cathodeType:     '',
  // RF params
  voltage:         'MV',
  gradient:        'MV/m',
  qext:            '',
  // Magnet params
  fieldStrength:   'T',
  kickAngle:       'mrad',
  dipoleField:     'T',
  quadGradient:    'T/m',
  // Insertion device params
  period:          'mm',
  kParameter:      '',
  polarization:    '',
  // Beam manipulation params
  riseTime:        'ns',
  septumThickness: 'mm',
  r56:             'mm',
  offset:          'm',
  material:        '',
  thickness:       'mm',
  // RF power params
  peakPower:       'MW',
  cwPower:         'kW',
  pulseLength:     'µs',
  efficiency:      '',
  bandwidth:       'Hz',
  loopGain:        'dB',
  // Cryo params
  coolingCapacity: 'W',
  temperature:     'K',
  // Laser params
  wavelength:      'nm',
  pulseEnergy:     'µJ',
  crossingAngle:   'deg',
  // Component-physics params
  extractionVoltage: 'kV',
  cathodeTemperature: 'K',
  laserPower:      'W',
  laserSpotSize:   'mm',
  repRate:         'kHz',
  intervaneVoltage: 'kV',
  maxMomentum:     'GeV/c',
  photonEnergy:    'keV',
  energySpread:    '%',
  gap:             'mm',
  polarizationMode: '',
  bunchCharge:     'nC',
  rfPhase:         'deg',
};
