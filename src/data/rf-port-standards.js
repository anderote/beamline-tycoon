// A few shared RF connector placements.
//
// RF hardware is not uniform enough for one universal port: long accelerating
// structures have couplers near a particular cell, cryomodules carry high
// couplers, and multi-output transmitters need visible flange banks. The two
// common cases below are deliberately narrower:
//
//   standardFeed   compact, ordinary NC loads with one centred side feed
//   singleOutput   RF power sources with one centred output flange
//
// Keeping the memberships here makes an exception an explicit hardware choice
// instead of another almost-centred offset scattered through the port table.

function standard(types, portName, side, offsetAlong, heightMeters = null) {
  return Object.freeze({
    types: Object.freeze(types),
    portName,
    placement: Object.freeze({ side, offsetAlong }),
    ...(Number.isFinite(heightMeters) ? { heightMeters } : {}),
  });
}

export const RF_PORT_STANDARDS = Object.freeze({
  standardFeed: standard(
    ['buncher', 'pillboxCavity', 'rfCavity', 'industrialLinac'],
    'rf_in',
    'right',
    0.5,
    1.2,
  ),
  singleOutput: standard(
    [
      'magnetron', 'widebandDriverAmp', 'lowBandBuncherAmp', 'twt',
      'slac5045Klystron', 'pulsedKlystron', 'cwKlystron', 'iot',
      'multibeamKlystron', 'highPowerSSA', 'gyrotron',
    ],
    'rf_out',
    'right',
    0.5,
  ),
});

export default RF_PORT_STANDARDS;
