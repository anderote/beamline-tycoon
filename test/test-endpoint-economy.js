import { computeEndpointService } from '../src/game/endpoint-economy.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const node = type => [{ type }];
const beam = (energy, current, extra = {}) => ({
  beamEnergy: energy, beamCurrent: current, beamQuality: 1, uptimeFraction: 1,
  ...extra,
});

console.log('\n=== Endpoint service economy ===\n');

{
  const low = computeEndpointService(
    'isotopeIrradiation', beam(0.02, 0.2), node('radiationEffectsStation'),
  );
  const highCurrent = computeEndpointService(
    'isotopeIrradiation', beam(0.02, 0.4), node('radiationEffectsStation'),
  );
  const highEnergy = computeEndpointService(
    'isotopeIrradiation', beam(0.04, 0.2), node('radiationEffectsStation'),
  );
  assert(low.revenue > 0, 'radiation testing earns dollars directly');
  assert(highCurrent.revenue > low.revenue, 'radiation revenue rises with beam current');
  assert(highEnergy.revenue > low.revenue, 'radiation revenue rises with beam energy');
  assert(low.contractName === 'Radiation testing', 'endpoint publishes its named contract');
}

{
  const valid = computeEndpointService(
    'ebeamProcessing', beam(0.010, 30), node('eBeamIrradiationVault'),
  );
  const overLimit = computeEndpointService(
    'ebeamProcessing', beam(0.020, 30), node('eBeamIrradiationVault'),
  );
  assert(valid.revenue > 0, 'in-band e-beam processing earns industrial revenue');
  assert(overLimit.revenue === 0, 'regulatory energy ceiling zeros an invalid irradiation contract');
}

{
  const nominal = computeEndpointService(
    'therapy', beam(0.15, 0.01), node('protonTherapyGantry'),
  );
  const moreCurrent = computeEndpointService(
    'therapy', beam(0.15, 0.04), node('protonTherapyGantry'),
  );
  const poorDelivery = computeEndpointService(
    'therapy', beam(0.15, 0.01, { beamQuality: 0.4, uptimeFraction: 0.5 }), node('protonTherapyGantry'),
  );
  assert(nominal.revenue > 0, 'medical endpoint earns treatment revenue directly');
  assert(Math.abs(moreCurrent.revenue - nominal.revenue) < 1e-9,
    'therapy is capped rather than paying for unnecessary extra current');
  assert(poorDelivery.revenue < nominal.revenue, 'therapy pays less for poor delivery and availability');
}

{
  const science = computeEndpointService(
    'collider', beam(100, 0.001), node('detector'),
  );
  assert(science.revenue === 0, 'fundamental detector has no fictional commercial customer');
  assert(science.workload === 'gpu', 'detector data is routed to GPU processing');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
