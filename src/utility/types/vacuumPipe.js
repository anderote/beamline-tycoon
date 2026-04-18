// src/utility/types/vacuumPipe.js
//
// Vacuum pipe utility descriptor. v1 physics: aggregate pressure = total
// outgassing / total pump speed, mapped log-linearly to quality between 1e-8
// (ideal) and 1e-4 (unusable). Hard error when sinks are present but no pump;
// soft error when pressure is merely poor (> 1e-5).

export default {
  type: 'vacuumPipe',
  displayName: 'Vacuum Pipe',
  color: '#888888',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.06,
  capacityUnit: 'mbar\u00b7L/s',
  persistentStateDefaults: {},
  solve(network, persistent, worldState) {
    const totalPumpSpeed = network.sources.reduce(
      (a, s) => a + ((s.params && s.params.pumpSpeed) || 0), 0);
    const totalOutgas = network.sinks.reduce(
      (a, s) => a + ((s.params && s.params.outgassing) || 0), 0);

    let pressure;
    if (totalPumpSpeed === 0 && totalOutgas === 0) pressure = 0;
    else if (totalPumpSpeed === 0) pressure = Infinity;
    else pressure = totalOutgas / totalPumpSpeed;

    let quality = 1;
    if (!isFinite(pressure)) quality = 0;
    else if (pressure <= 1e-8) quality = 1;
    else if (pressure >= 1e-4) quality = 0;
    else quality = 1 - (Math.log10(pressure) - (-8)) / ((-4) - (-8));

    const perSinkQuality = {};
    for (const s of network.sinks) perSinkQuality[s.portKey] = quality;

    const errors = [];
    if (totalPumpSpeed === 0 && network.sinks.length > 0) {
      errors.push({
        severity: 'hard',
        code: 'vacuum_no_pump',
        message: 'Vacuum network has no pump.',
        location: { networkId: network.id },
      });
    } else if (isFinite(pressure) && pressure > 1e-5) {
      errors.push({
        severity: 'soft',
        code: 'vacuum_poor',
        message: `Vacuum pressure high (${pressure.toExponential(2)} mbar).`,
        location: { networkId: network.id },
      });
    }

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        totalCapacity: totalPumpSpeed,
        totalDemand: totalOutgas,
        utilization: totalPumpSpeed > 0
          ? Math.min(1, totalOutgas / totalPumpSpeed)
          : (network.sinks.length > 0 ? 1 : 0),
        perSegmentLoad: [],
        perSinkQuality,
        errors: [...errors],
      },
      nextPersistentState: persistent,
      errors,
    };
  },
  renderInspector() { return null; },
  refillCost() { return null; },
};
