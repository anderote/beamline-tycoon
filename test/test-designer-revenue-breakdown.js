// Designer revenue disclosure: the UI explains the canonical economy terms
// with mission- and endpoint-specific language without recomputing the total.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { getBeamlineType } from '../src/data/beamline-types.js';
import {
  designerRevenueBreakdownHtml,
  designerRevenueBreakdownModel,
} from '../src/ui/designer-revenue-breakdown.js';

function projection(overrides = {}) {
  return {
    total: 257.5,
    operationsRevenue: 48,
    dataFees: 12.5,
    serviceEndpointId: 'materialsTestStation',
    serviceBaseRevenue: 180,
    serviceRevenue: 197,
    serviceContract: 'Materials qualification',
    serviceDriverLabel: 'Delivered beam power',
    serviceDescription: 'Materials labs pay for useful beam power delivered to samples inside the test envelope.',
    serviceEnergyScore: 1,
    serviceCurrentScore: 0.9,
    servicePerformanceScore: 1.22,
    serviceBeamPowerKw: 61,
    photonPortCount: 0,
    photonUserFees: 0,
    ...overrides,
  };
}

test('test-stand disclosure explains endpoint work as delivered beam power', () => {
  const model = designerRevenueBreakdownModel(
    getBeamlineType('testStand'), projection(), 'Materials Test Station',
  );
  assert.equal(model.endpoint, 'Materials Test Station');
  assert.equal(model.contract, 'Materials qualification');
  assert.match(model.story, /pay for useful beam power/i);
  assert.deepEqual(model.factors.map(row => row.label), [
    'Reference contract', 'Energy-band fit', 'Current-band fit', 'Delivered beam power',
  ]);
  assert.match(model.factors.at(-1).value, /61\.0 kW · 122% delivery/);
  assert.deepEqual(model.terms.map(row => row.label), [
    'Materials qualification', 'Beam operations allowance', 'Data collection fees',
  ]);
  assert.equal(model.total, 257.5, 'the published total passes through unchanged');
});

test('mission wording follows the kind of output the customer buys', () => {
  const therapy = designerRevenueBreakdownModel(
    getBeamlineType('therapy'),
    projection({
      serviceEndpointId: 'protonTherapyGantry', serviceContract: 'Patient treatments',
      serviceDriverLabel: 'Safe delivery & availability',
      serviceDescription: 'Hospitals pay for safe, available treatment delivery; excess current earns nothing extra.',
    }),
    'Proton Therapy Gantry',
  );
  assert.match(therapy.story, /safe, available treatment delivery/i);
  assert.equal(therapy.factors.at(-1).label, 'Safe delivery & availability');

  const xfel = designerRevenueBreakdownModel(
    getBeamlineType('xfel'),
    projection({
      serviceEndpointId: 'xfelEndstation', serviceContract: 'XFEL user programme',
      serviceDriverLabel: 'FEL photon performance',
      serviceDescription: 'XFEL users pay for useful saturated photon performance, not raw electron power.',
    }),
    'XFEL Endstation',
  );
  assert.match(xfel.story, /photon performance, not raw electron power/i);
  assert.equal(xfel.factors.at(-1).label, 'FEL photon performance');
});

test('science endpoints and free build do not imply fictional customers', () => {
  const science = designerRevenueBreakdownModel(
    getBeamlineType('collider'),
    projection({
      serviceEndpointId: 'collisionPoint', serviceContract: 'Fundamental research',
      serviceBaseRevenue: 0, serviceRevenue: 0,
      serviceDriverLabel: 'Collision performance',
      serviceDescription: 'Luminosity creates discoveries, not commercial endpoint revenue.',
    }),
    'Collision Point',
  );
  assert.match(science.story, /not commercial endpoint revenue/i);
  assert.equal(science.factors.length, 0);

  const free = designerRevenueBreakdownModel(null, projection(), 'Materials Test Station');
  assert.match(free.story, /Free Build has no mission contract/i);
});

test('rendered disclosure is accessible on focus and visible on hover', () => {
  const html = designerRevenueBreakdownHtml(
    getBeamlineType('testStand'), projection(), 'Materials Test Station',
  );
  assert.match(html, /id="dsgn-revenue-breakdown" role="tooltip"/);
  assert.match(html, /Materials qualification/);
  assert.match(html, /Projected gross/);
  assert.match(html, /full data connectivity/i);

  const renderer = readFileSync(new URL('../src/renderer/designer-renderer.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(renderer, /class="dsgn-plot-mission-metric revenue dsgn-revenue-disclosure" tabindex="0"/);
  assert.match(renderer, /aria-describedby="dsgn-revenue-breakdown"/);
  assert.match(styles, /\.dsgn-revenue-disclosure:hover \.dsgn-revenue-breakdown/);
  assert.match(styles, /\.dsgn-revenue-disclosure:focus-within \.dsgn-revenue-breakdown/);
  assert.match(styles, /\.dsgn-revenue-breakdown\s*\{[^}]*position:\s*absolute/s);
});
