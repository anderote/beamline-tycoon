import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beamRadiationEvents,
  beamSourceEffect,
  radiationVisualStrength,
} from '../src/renderer3d/beam-radiation-presentation.js';

test('running beam presentation emits at dipoles and the terminal absorber', () => {
  const events = beamRadiationEvents([
    { kind: 'module', id: 'source', beamStart: 0, subL: 2 },
    { kind: 'drift', id: 'pipe', beamStart: 1, subL: 4 },
    {
      kind: 'module', id: 'bend', beamStart: 3, subL: 2,
      physicsType: 'dipole', isDipole: true,
    },
    { kind: 'drift', id: 'pipe-2', beamStart: 4, subL: 4 },
    {
      kind: 'module', id: 'stop', beamStart: 6, subL: 4,
      physicsType: 'beamStop', isEndpoint: true,
    },
  ], [
    { s: 0, beam_power_mw: 0.01, rel_beta: 0.1, energy: 0.001 },
    { s: 3.5, beam_power_mw: 4, rel_beta: 0.8, energy: 2 },
    { s: 6, beam_power_mw: 12, rel_beta: 0.98, energy: 8 },
  ], { particle: 'e-' });

  assert.deepEqual(events.map(event => event.kind), ['synchrotron', 'impact']);
  assert.equal(events[0].elementId, 'bend');
  assert.ok(events[0].u > 0 && events[0].u < 1);
  assert.equal(events[1].elementId, 'stop');
  assert.equal(events[1].u, 1);
  assert.ok(events[1].strength > events[0].strength);
});

test('proton dipole radiation stays visible but weaker than electron radiation', () => {
  const elements = [{
    kind: 'module', id: 'bend', beamStart: 0, subL: 2,
    physicsType: 'dipole', isDipole: true,
  }];
  const envelope = [{ s: 0.5, beam_power_mw: 5, rel_beta: 0.8, energy: 1 }];
  const electron = beamRadiationEvents(elements, envelope, { particle: 'e-' })[0];
  const proton = beamRadiationEvents(elements, envelope, { particle: 'p+' })[0];
  assert.ok(proton.strength > 0);
  assert.ok(electron.strength > proton.strength);
});

test('radiation strength maps published beam power monotonically and safely', () => {
  assert.ok(radiationVisualStrength(10) > radiationVisualStrength(0.1));
  assert.ok(radiationVisualStrength(undefined) > 0);
  assert.ok(radiationVisualStrength(1e9) <= 1);
});

test('cyclotron and ECR sources publish internal flow descriptors', () => {
  const cyclotron = beamSourceEffect([{
    kind: 'module', id: 'cyc', type: 'cyclotron70', subW: 10, subL: 10,
  }]);
  assert.equal(cyclotron.kind, 'cyclotronSpiral');
  assert.equal(cyclotron.elementId, 'cyc');
  assert.ok(Math.abs(cyclotron.radius - 1.8) < 1e-9);
  assert.equal(cyclotron.sourceLength, 5);
  const ecr = beamSourceEffect([{
    kind: 'module', id: 'ecr', type: 'ecrIonSource', subW: 4, subL: 6,
  }]);
  assert.equal(ecr.kind, 'plasmaVortex');
  assert.equal(beamSourceEffect([{ kind: 'module', type: 'electronGun' }]), null);
});
