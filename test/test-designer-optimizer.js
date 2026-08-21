// Contract tests for the Beamline Designer's solver-backed optimizer.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildDesignerOptimizerKnobs,
  describeDesignerOptimizerScopes,
  designerOptimizableParams,
  optimizeDesignerBeamline,
  resolveDesignerOptimizerScope,
  scoreDesignerOptimization,
  summarizeDesignerOptimization,
} from '../src/beamline/designer-optimizer.js';

function physicsResult({
  current = 10,
  transmission = 1,
  quality = 1,
  margin = 0.5,
  beamSize = 0.001,
  bunchLength = 2e-12,
  peakCurrent = 1,
  energySpread = 0.001,
  energy = 0.1,
  emitGrowth = 1,
} = {}) {
  return {
    beamAlive: transmission > 0,
    beamEnergy: energy,
    beamCurrent: current * transmission,
    beamQuality: quality,
    totalLossFraction: 1 - transmission,
    finalNormEmittanceX: 1e-6 * emitGrowth,
    finalNormEmittanceY: 1e-6 * emitGrowth,
    finalBeamSizeX: beamSize,
    finalBeamSizeY: beamSize * 0.8,
    finalBunchLength: bunchLength,
    finalEnergySpread: energySpread,
    envelope: [
      {
        index: 0, s: 0, current, alive: true,
        sigma_x: 0.001, sigma_y: 0.001,
        emit_nx: 1e-6, emit_ny: 1e-6,
        focus_margin: 0.5, energy: 0.001,
        bunch_length: 4e-12, peak_current: 0.5, energy_spread: 0.0005,
      },
      {
        index: 4, s: 10, current: current * transmission, alive: transmission > 0,
        sigma_x: beamSize, sigma_y: beamSize * 0.8,
        emit_nx: 1e-6 * emitGrowth, emit_ny: 1e-6 * emitGrowth,
        focus_margin: margin, energy,
        bunch_length: bunchLength, peak_current: peakCurrent, energy_spread: energySpread,
      },
    ],
  };
}

test('optimizer scopes resolve selected, same-type, optics, RF, and full-beam controls', () => {
  const nodes = [
    { type: 'source', params: {} },
    { type: 'solenoid', params: { fieldStrength: 0.1 } },
    { type: 'quadrupole', params: { gradient: 10, polarity: 0 } },
    { type: 'buncher', params: { voltage: 0.5, rfPhase: -90 } },
    { type: 'buncher', params: { voltage: 1, rfPhase: -70 } },
    { type: 'energyDegrader', params: { outputEnergy: 150 } },
    { type: 'drift', params: {} },
  ];

  assert.deepEqual(resolveDesignerOptimizerScope({ nodes, scope: 'selected', selectedIndex: 3 }), [3]);
  assert.deepEqual(resolveDesignerOptimizerScope({ nodes, scope: 'same-type', selectedIndex: 3 }), [3, 4]);
  assert.deepEqual(resolveDesignerOptimizerScope({ nodes, scope: 'optics', selectedIndex: 3 }), [1, 2, 5]);
  assert.deepEqual(resolveDesignerOptimizerScope({ nodes, scope: 'rf', selectedIndex: 3 }), [3, 4]);
  assert.deepEqual(resolveDesignerOptimizerScope({ nodes, scope: 'all', selectedIndex: 3 }), [0, 1, 2, 3, 4, 5]);

  const scopes = describeDesignerOptimizerScopes({ nodes, selectedIndex: 3 });
  assert.equal(scopes.find(scope => scope.id === 'same-type').label, 'All Buncher components');
  assert.equal(scopes.find(scope => scope.id === 'same-type').count, 2);
  assert.ok(scopes.find(scope => scope.id === 'all').controls > 5);
});

test('only controls that reach the production physics payload become optimizer knobs', () => {
  assert.deepEqual(designerOptimizableParams('quadrupole'), ['gradient', 'polarity']);
  assert.deepEqual(designerOptimizableParams('combinedFunctionMagnet'), ['quadGradient']);
  assert.deepEqual(designerOptimizableParams('dipole'), [],
    'the display-only field-strength slider must not waste solver evaluations');
  assert.deepEqual(designerOptimizableParams('corrector'), [],
    'a control not yet consumed by the solver is not advertised as optimizable');

  const knobs = buildDesignerOptimizerKnobs({
    nodes: [
      { type: 'quadrupole', params: { gradient: 10, polarity: 0 } },
      { type: 'buncher', params: { voltage: 0.5, rfPhase: -90 } },
    ],
    scope: 'all',
  });
  assert.deepEqual(knobs.map(knob => `${knob.index}:${knob.key}`), [
    '0:gradient', '0:polarity', '1:voltage', '1:rfPhase',
  ]);
});

test('solver summaries expose comparable target metrics and reject lost-beam minima', () => {
  const baseline = summarizeDesignerOptimization(physicsResult());
  const improved = summarizeDesignerOptimization(physicsResult({
    transmission: 1,
    beamSize: 0.0005,
    bunchLength: 1e-12,
  }));
  const lost = summarizeDesignerOptimization(physicsResult({
    transmission: 0,
    beamSize: 0,
    bunchLength: 0,
  }));

  assert.equal(baseline.transmission, 1);
  assert.equal(baseline.apertureMargin, 0.5);
  assert.equal(baseline.emittance, 1);
  assert.ok(scoreDesignerOptimization(improved, ['beamSize', 'bunchLength'], baseline)
    > scoreDesignerOptimization(baseline, ['beamSize', 'bunchLength'], baseline));
  assert.equal(scoreDesignerOptimization(lost, ['beamSize', 'bunchLength'], baseline), 0,
    'zero beam size from a dead beam is never accepted as an optimum');
});

test('coordinate sweeps optimize the requested family and return before/after evidence', async () => {
  const nodes = [
    { type: 'source', params: { extractionVoltage: 50, cathodeTemperature: 1200 } },
    { type: 'solenoid', params: { fieldStrength: 0.1 } },
    { type: 'quadrupole', params: { gradient: 20, polarity: 0 } },
    { type: 'buncher', params: { voltage: 0.5, rfPhase: -40 } },
  ];
  const evaluate = async candidate => {
    const field = candidate[1].params.fieldStrength;
    const gradient = candidate[2].params.gradient;
    const focusError = Math.abs(field - 0.5) + Math.abs(gradient - 0.01) / 40;
    const transmission = Math.max(0.05, 1 - focusError);
    return physicsResult({
      transmission,
      margin: 0.5 - focusError,
      beamSize: 0.001 + focusError * 0.005,
    });
  };
  const initialResult = await evaluate(nodes);
  let progress = null;
  const result = await optimizeDesignerBeamline({
    nodes,
    initialResult,
    scope: 'optics',
    targets: ['transmission', 'aperture', 'beamSize'],
    evaluate,
    onProgress: value => { progress = value; },
  });

  assert.ok(result.evaluations > 4, 'the coordinator evaluates a real sweep of candidate settings');
  assert.ok(result.after.transmission > result.before.transmission);
  assert.ok(result.scoreAfter > result.scoreBefore);
  assert.equal(result.nodes[1].params.fieldStrength, 0.5);
  assert.equal(result.nodes[2].params.gradient, 0.01);
  assert.deepEqual(result.nodes[3].params, nodes[3].params,
    'an optics scope does not alter a buncher');
  assert.ok(result.updates.some(update => update.index === 1));
  assert.ok(result.updates.some(update => update.index === 2));
  assert.equal(progress.evaluations, result.evaluations);
});

test('same-type optimization sweeps every buncher toward longitudinal targets', async () => {
  const nodes = [
    { type: 'buncher', params: { voltage: 0.1, rfPhase: 0 } },
    { type: 'drift', params: {} },
    { type: 'buncher', params: { voltage: 0.1, rfPhase: 0 } },
  ];
  const evaluate = async candidate => {
    const compression = candidate[0].params.voltage + candidate[2].params.voltage;
    const phaseError = Math.abs(candidate[0].params.rfPhase + 40)
      + Math.abs(candidate[2].params.rfPhase + 40);
    return physicsResult({
      transmission: 1,
      bunchLength: 5e-12 / (1 + compression) + phaseError * 1e-14,
      peakCurrent: 0.5 + compression,
      energySpread: 0.001 + phaseError * 1e-5,
    });
  };
  const result = await optimizeDesignerBeamline({
    nodes,
    initialResult: await evaluate(nodes),
    scope: 'same-type',
    selectedIndex: 0,
    targets: ['bunchLength', 'peakCurrent', 'energySpread'],
    evaluate,
    passes: 1,
  });

  assert.ok(result.nodes[0].params.voltage > nodes[0].params.voltage);
  assert.ok(result.nodes[2].params.voltage > nodes[2].params.voltage);
  assert.equal(result.scopeIndices.length, 2);
  assert.ok(result.after.bunchLength < result.before.bunchLength);
});

test('Designer exposes stack and selected-component entry points with preview-before-apply', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const designer = readFileSync(new URL('../src/ui/BeamlineDesigner.js', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../src/renderer/designer-renderer.js', import.meta.url), 'utf8');
  const dialog = readFileSync(new URL('../src/ui/BeamlineOptimizerDialog.js', import.meta.url), 'utf8');

  assert.match(html, /id="dsgn-open-optimizer"/);
  assert.match(html, /id="dsgn-optimizer-dialog"/);
  assert.match(renderer, /data-designer-optimize-selected/,
    'tunable selected components expose the same optimizer');
  assert.match(designer, /evaluate: nodes => this\._computePhysics\(nodes, 'designer:optimizer'\)/,
    'every candidate uses the ordinary worker-backed Designer physics path');
  assert.match(dialog, /Before[\s\S]*Best/,
    'the workbench compares solver metrics before applying changes');
  assert.match(dialog, /Apply best settings/);
});
