// Contract tests for the Beamline Designer's opt-in automatic matcher.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isDesignerAutoManagedParam,
  planDesignerAutoTune,
  recommendedSolenoidField,
} from '../src/beamline/designer-auto-tuning.js';

function apply(nodes, plan) {
  for (const update of plan.updates) {
    nodes[update.index].params = {
      ...(nodes[update.index].params || {}),
      ...update.params,
    };
  }
}

test('quadrupoles alternate from the larger incoming plane and follow local rigidity', () => {
  const nodes = [
    { type: 'source', params: {} },
    { type: 'quadrupole', subL: 2, params: { gradient: 20, polarity: 0 } },
    { type: 'cbandStructure', params: { gradient: 40, rfPhase: 0, rfFrequency: 5712 } },
    { type: 'quadrupole', subL: 2, params: { gradient: 20, polarity: 0 } },
  ];
  const envelope = [
    { index: 0, energy: 0.039, sigma_x: 0.001, sigma_y: 0.003 },
    { index: 1, energy: 0.039, sigma_x: 0.002, sigma_y: 0.002 },
    { index: 2, energy: 0.159, sigma_x: 0.003, sigma_y: 0.002 },
    { index: 3, energy: 0.159, sigma_x: 0.002, sigma_y: 0.002 },
  ];

  const plan = planDesignerAutoTune({ nodes, envelope, particle: 'e-' });
  const first = {
    ...nodes[1].params,
    ...(plan.updates.find(update => update.index === 1)?.params || {}),
  };
  const second = {
    ...nodes[3].params,
    ...(plan.updates.find(update => update.index === 3)?.params || {}),
  };

  assert.equal(plan.managedMagnets, 2);
  assert.equal(first.polarity, 1, 'the first quad focuses the larger Y plane');
  assert.equal(second.polarity, 0, 'the next quad alternates back to X');
  assert.equal(first.gradient, 0.02, '39 MeV uses the gentle low-rigidity setting');
  assert.ok(second.gradient > first.gradient, 'downstream acceleration raises required gradient');
});

test('solenoid field follows particle momentum and the component range', () => {
  const lowElectron = recommendedSolenoidField({ kineticEnergyGeV: 0.00025, particle: 'e-' });
  const proton = recommendedSolenoidField({ kineticEnergyGeV: 0.005, particle: 'p+' });

  assert.equal(lowElectron, 0.003);
  assert.ok(proton > lowElectron, 'the heavier beam needs more field at the same kinetic scale');
  assert.ok(proton <= 0.5, 'the result remains inside the hardware range');
});

test('RF matching restores hardware frequency and type-specific synchronous phase', () => {
  const nodes = [
    {
      type: 'buncher',
      params: { voltage: 0.2, rfPhase: 0, rfFrequency: 400 },
    },
    {
      type: 'cbandStructure',
      params: { gradient: 999, rfPhase: -33, rfFrequency: 1300 },
    },
    {
      type: 'spokeCavity',
      params: { gradient: 9, rfPhase: 17, rfFrequency: 162.5 },
    },
  ];
  const original = structuredClone(nodes);
  const plan = planDesignerAutoTune({ nodes, envelope: [] });

  assert.deepEqual(nodes, original, 'the planner does not mutate the draft');
  apply(nodes, plan);

  assert.deepEqual(nodes[0].params, {
    voltage: 0.2,
    rfPhase: -90,
    rfFrequency: 162.5,
  });
  assert.equal(nodes[1].params.rfFrequency, 5712);
  assert.equal(nodes[1].params.rfPhase, 0);
  assert.equal(nodes[1].params.gradient, 50, 'an out-of-range amplitude is clamped');
  assert.equal(nodes[2].params.rfFrequency, 325);
  assert.equal(nodes[2].params.rfPhase, 0);
  assert.equal(nodes[2].params.gradient, 9, 'a valid player amplitude is preserved');

  const settled = planDesignerAutoTune({ nodes, envelope: [] });
  assert.equal(settled.updates.length, 0, 'a matched draft is stable on the next pass');
});

test('auto-owned controls are explicit and RF amplitude remains manually tunable', () => {
  assert.equal(isDesignerAutoManagedParam('quadrupole', 'gradient'), true);
  assert.equal(isDesignerAutoManagedParam('quadrupole', 'polarity'), true);
  assert.equal(isDesignerAutoManagedParam('solenoid', 'fieldStrength'), true);
  assert.equal(isDesignerAutoManagedParam('cbandStructure', 'rfPhase'), true);
  assert.equal(isDesignerAutoManagedParam('cbandStructure', 'rfFrequency'), true);
  assert.equal(isDesignerAutoManagedParam('cbandStructure', 'gradient'), false);
  assert.equal(isDesignerAutoManagedParam('drift', 'rfPhase'), false);
});
