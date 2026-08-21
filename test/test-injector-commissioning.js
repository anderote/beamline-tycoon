import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  commissioningReport,
  inferInjectorTargetS,
  optimizeInjectorMagnets,
} from '../src/beamline/injector-commissioning.js';

function envelope({ current = 65, margin = 0.8, emit = 1e-6 } = {}) {
  return [
    {
      s: 0, energy: 0.00005, current: 100,
      sigma_x: 0.003, sigma_y: 0.003,
      emit_nx: 1e-6, emit_ny: 1e-6,
      focus_margin: 0.85, bunch_frequency: 0,
    },
    {
      s: 1, energy: 0.00005, current: 65,
      sigma_x: 0.004, sigma_y: 0.004,
      emit_nx: 1.01e-6, emit_ny: 1.01e-6,
      focus_margin: 0.72, bunch_frequency: 162.5e6,
      rf_capture_efficiency: 0.65,
      rf_current_before: 100,
      rf_current_after: 65,
      rf_bunch_length_after: 4.9e-10,
    },
    {
      s: 3, energy: 0.0052, current,
      sigma_x: 0.002, sigma_y: 0.0025,
      emit_nx: emit, emit_ny: emit,
      focus_margin: margin, bunch_frequency: 162.5e6,
      bunch_length: 2.2e-10, peak_current: 1.15,
    },
    {
      s: 8, energy: 0.03, current: current * 0.98,
      sigma_x: 0.004, sigma_y: 0.004,
      emit_nx: emit * 1.02, emit_ny: emit * 1.02,
      focus_margin: 0.6, bunch_frequency: 162.5e6,
      bunch_length: 2.2e-10, peak_current: 1.1,
    },
  ];
}

test('injector target stops at the first 5 MeV handoff', () => {
  assert.equal(inferInjectorTargetS(envelope()), 3);
});

test('commissioning report explains capture, preservation, and aperture margin', () => {
  const report = commissioningReport(envelope(), { targetS: 3 });

  assert.equal(report.captureEfficiency, 0.65);
  assert.equal(report.transmission, 0.65);
  assert.ok(report.emittancePreservation > 0.98);
  assert.equal(report.minFocusMargin, 0.72);
  assert.equal(report.bunchFrequency, 162.5e6);
  assert.equal(report.bunchLength, 2.2e-10);
  assert.equal(report.peakCurrent, 1.15);
  assert.ok(report.score > 0 && report.score <= 1);
});

test('commissioning optimizer scans solenoids and quad pairs against solved output', async () => {
  const nodes = [
    { type: 'source', subL: 4, params: {} },
    { type: 'solenoid', subL: 2, params: { fieldStrength: 0.004 } },
    { type: 'quadrupole', subL: 2, params: { gradient: 0.01, polarity: 0 } },
    { type: 'drift', subL: 4, params: {} },
    { type: 'quadrupole', subL: 2, params: { gradient: 0.01, polarity: 1 } },
    { type: 'screen', subL: 0, params: {} },
  ];
  let evaluations = 0;
  const evaluate = async candidate => {
    evaluations++;
    const field = candidate[1].params.fieldStrength;
    const g1 = candidate[2].params.gradient;
    const g2 = candidate[4].params.gradient;
    const fieldFit = Math.max(0, 1 - Math.abs(field - 0.008) / 0.008);
    const quadFit = Math.max(0, 1 - (Math.abs(g1 - 0.02) + Math.abs(g2 - 0.02)) / 0.04);
    const fit = fieldFit * quadFit;
    return { envelope: envelope({
      current: 55 + 40 * fit,
      margin: 0.2 + 0.7 * fit,
      emit: 1e-6 * (1.2 - 0.2 * fit),
    }) };
  };

  const result = await optimizeInjectorMagnets({
    nodes,
    initialEnvelope: envelope({ current: 55, margin: 0.2, emit: 1.2e-6 }),
    targetS: 8,
    evaluate,
  });

  assert.ok(evaluations > 2, 'the optimizer evaluates real candidate settings');
  assert.ok(result.after.score > result.before.score);
  assert.equal(result.nodes[1].params.fieldStrength, 0.008);
  assert.equal(result.nodes[2].params.gradient, 0.02);
  assert.equal(result.nodes[4].params.gradient, 0.02,
    'a quad pair is tuned as one optical unit');
  assert.deepEqual(result.nodes[2].params.polarity, 0);
  assert.deepEqual(result.nodes[4].params.polarity, 1);
});

test('Designer exposes the solved injector scorecard and explicit match action', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const designer = readFileSync(new URL('../src/ui/BeamlineDesigner.js', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../src/renderer/designer-renderer.js', import.meta.url), 'utf8');

  assert.match(html, /id="dsgn-commissioning-control"/);
  assert.match(html, /id="dsgn-commissioning-optimize"/);
  assert.match(designer, /optimizeInjectorMagnets\(/,
    'the UI delegates candidate search to the public commissioning coordinator');
  assert.match(designer, /evaluate: nodes => this\._computePhysics\(nodes, 'designer:commissioning'\)/,
    'every candidate uses the ordinary worker-backed Designer physics path');
  assert.match(renderer, /this\._updateCommissioningPanel\(\)/,
    'the scorecard refreshes with the rest of the Designer');
});
