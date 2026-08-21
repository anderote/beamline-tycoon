import { computeEndpointService } from '../src/game/endpoint-economy.js';
import { computeBeamlineRevenueBreakdown } from '../src/game/economy.js';

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
  assert(low.contractName === 'Electronics radiation testing', 'endpoint publishes its named contract');
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

{
  const beamState = beam(0.010, 30, { beamQuality: 0.8, dataRate: 12 });
  const nodes = [
    { kind: 'module', type: 'thermionicGun' },
    { kind: 'drift', type: 'drift' },
    { kind: 'placement', type: 'eBeamIrradiationVault' },
  ];
  const full = computeBeamlineRevenueBreakdown('ebeamProcessing', beamState, nodes);
  const cut = computeBeamlineRevenueBreakdown('ebeamProcessing', beamState, nodes, {
    dataConnectivity: 0,
  });
  const service = computeEndpointService('ebeamProcessing', beamState, nodes);
  assert(full.total === full.beam + full.dataFees,
    'canonical beamline revenue terms sum to the projected gross rate');
  assert(full.serviceRevenue === service.revenue,
    'the canonical revenue breakdown uses the endpoint contract result');
  assert(full.dataFees > 0 && cut.dataFees === 0,
    'the shared billing and projection path honors data connectivity');
  assert(full.beam === cut.beam,
    'cut data changes data fees without changing beam and service revenue');
}

{
  const withPhotonPort = computeBeamlineRevenueBreakdown(
    'testStand',
    beam(0.02, 2, { beamQuality: 0.8, dataRate: 0 }),
    [{ kind: 'module', type: 'thermionicGun' }, { kind: 'placement', type: 'photonPort' }],
  );
  assert(Math.abs(withPhotonPort.photonUserFees - 1.6) < 1e-9,
    'the canonical gross rate includes photon-port user fees exactly once');
  assert(withPhotonPort.total === withPhotonPort.beam + withPhotonPort.dataFees,
    'photon user fees remain part of the beam-income term');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
