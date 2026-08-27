import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beamRadiationEvents,
  beamSourceEffect,
  radiationVisualStrength,
} from '../src/renderer3d/beam-radiation-presentation.js';
import {
  cyclotronExtractionContract,
  cyclotronParticlePathPoint,
} from '../src/renderer3d/cyclotron-presentation.js';

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
  const cyclotronContract = cyclotronExtractionContract('cyclotron70');
  assert.equal(cyclotron.kind, 'cyclotronSpiral');
  assert.equal(cyclotron.elementId, 'cyc');
  assert.ok(Math.abs(cyclotron.radius - Math.hypot(
    cyclotronContract.orbitExitSide, cyclotronContract.orbitExitForward,
  )) < 1e-9);
  assert.equal(cyclotron.sourceLength, 5);
  const ecr = beamSourceEffect([{
    kind: 'module', id: 'ecr', type: 'ecrIonSource', subW: 4, subL: 6,
  }]);
  assert.equal(ecr.kind, 'plasmaVortex');
  assert.equal(beamSourceEffect([{ kind: 'module', type: 'electronGun' }]), null);
});

test('every cyclotron spiral joins its authored extraction channel and beam pipe', () => {
  for (const [type, subtiles] of [
    ['cyclotron30', 8], ['cyclotron70', 10], ['cyclotron230', 12],
  ]) {
    const effect = beamSourceEffect([{
      kind: 'module', id: type, type, subW: subtiles, subL: subtiles,
    }]);
    const contract = cyclotronExtractionContract(type);
    const orbitEnd = 0.78;
    const orbitExit = cyclotronParticlePathPoint(effect, {
      progress: orbitEnd, orbitEnd, turns: 4, angularWobble: 0.4,
    });
    assert.ok(Math.abs(orbitExit.side - contract.orbitExitSide) < 1e-9,
      `${type} spiral terminates on the extraction lead's authored local X`);
    assert.ok(Math.abs(orbitExit.forward - contract.orbitExitForward) < 1e-9,
      `${type} spiral terminates on the extraction lead's authored local Z`);
    assert.equal(orbitExit.verticalWobbleScale, 0,
      `${type} settles onto beam height before extraction`);

    const immediatelyExtracted = cyclotronParticlePathPoint(effect, {
      progress: orbitEnd + 1e-8, orbitEnd, turns: 4, angularWobble: 0.4,
    });
    assert.ok(Math.hypot(
      immediatelyExtracted.side - orbitExit.side,
      immediatelyExtracted.forward - orbitExit.forward,
    ) < 1e-6, `${type} has no position jump at the orbit/extraction handoff`);

    const leadLength = Math.hypot(
      contract.orbitExitSide,
      contract.channelJoinForward - contract.orbitExitForward,
    );
    const pipeLength = contract.exitForward - contract.channelJoinForward;
    const joinProgress = orbitEnd + (1 - orbitEnd) * leadLength / (leadLength + pipeLength);
    const join = cyclotronParticlePathPoint(effect, {
      progress: joinProgress, orbitEnd, turns: 4,
    });
    assert.ok(Math.abs(join.side) < 1e-9
      && Math.abs(join.forward - contract.channelJoinForward) < 1e-9,
    `${type} follows the angled extraction lead into the centered pipe`);

    const exit = cyclotronParticlePathPoint(effect, {
      progress: 1, orbitEnd, turns: 4,
    });
    assert.ok(Math.abs(exit.side) < 1e-9
      && Math.abs(exit.forward - contract.exitForward) < 1e-9,
    `${type} finishes exactly on the source exit port axis`);
  }
});
