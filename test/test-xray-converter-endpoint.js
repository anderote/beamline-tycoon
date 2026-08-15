import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMPONENTS } from '../src/data/components.js';
import { BEAMLINE_TYPES } from '../src/data/beamline-types.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { computeEndpointService } from '../src/game/endpoint-economy.js';

const beam = (beamEnergy, beamCurrent) => ({
  beamEnergy,
  beamCurrent,
  beamQuality: 1,
  uptimeFraction: 1,
});

test('X-ray converter is a compact, type-compatible processing endpoint', () => {
  const station = COMPONENTS.xRayConverterStation;
  const vault = COMPONENTS.eBeamIrradiationVault;

  assert.equal(station.isEndpoint, true);
  assert.equal(station.physicsType, 'beamStop', 'the conversion target absorbs the electron beam');
  assert.deepEqual(station.beamlineTypes, ['ebeamProcessing']);
  assert.ok(BEAMLINE_TYPES.ebeamProcessing.requiredEndpoint.includes(station.id));
  assert.ok(station.subW * station.subL < vault.subW * vault.subL,
    'the converter occupies less floor area than the conveyor irradiation vault');
});

test('X-ray converter utility declaration is backed by connectable sink ports', () => {
  const station = COMPONENTS.xRayConverterStation;
  const ports = Object.values(getUtilityPortsV2(station.id));

  for (const utility of station.requiredConnections) {
    assert.ok(ports.some(port => port.utility === utility && port.role === 'sink'),
      `${utility} has a routable sink`);
  }

  const cooling = ports.find(port => port.utility === 'coolingWater');
  assert.ok(cooling.params.heatLoad > 50,
    'the converter rejects more heat than the basic beam stop');
  assert.ok(cooling.params.heatLoad < 120,
    'the compact station remains below the full irradiation vault load');
});

test('X-ray inspection pays in band, stays below vault throughput, and stops above 12 MeV', () => {
  const nodes = type => [{ type }];
  const inBand = beam(0.010, 30);
  const inspection = computeEndpointService(
    'ebeamProcessing', inBand, nodes('xRayConverterStation'),
  );
  const vault = computeEndpointService(
    'ebeamProcessing', inBand, nodes('eBeamIrradiationVault'),
  );
  const overLimit = computeEndpointService(
    'ebeamProcessing', beam(0.020, 30), nodes('xRayConverterStation'),
  );

  assert.equal(inspection.contractName, 'X-ray inspection');
  assert.equal(inspection.workload, 'balanced');
  assert.ok(inspection.revenue > 0);
  assert.ok(inspection.revenue < vault.revenue,
    'conversion and inspection earn less than a full-throughput direct irradiation vault');
  assert.equal(overLimit.revenue, 0,
    'the processing-line safety ceiling also applies in X-ray mode');
});
