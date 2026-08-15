// Relativistic beta is a cross-layer contract: catalogue windows feed the
// Python payload and the same values are presented by the plots. Pin the
// content ladder and the browser-independent canvas renderer together here.

import { BEAMLINE_COMPONENTS_RAW as COMPONENTS } from '../src/data/beamline-components.raw.js';
import { RESEARCH } from '../src/data/research.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { CAVITY_SPECS } from '../src/beamline/cavity-specs.js';
import { buildPhysicsElements } from '../src/beamline/physics-payload.js';
import { computeStats, getDefaults } from '../src/beamline/component-physics.js';
import { ProbePlots } from '../src/ui/probe-plots.js';

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { passed++; console.log(`  PASS: ${message}`); }
  else { failed++; console.log(`  FAIL: ${message}`); }
}

console.log('\n--- Catalogue beta ladder ---');
{
  const accelerators = Object.values(COMPONENTS)
    .filter(def => def.category === 'rf' && def.stats?.energyGain > 0);
  const missing = accelerators.filter(def => !def.betaAcceptance).map(def => def.id);
  check(missing.length === 0,
    `every accelerating RF component publishes a beta window (missing: ${missing.join(',') || 'none'})`);
  check(COMPONENTS.rfq.betaAcceptance.tracksBeam === true
    && COMPONENTS.rfq.betaAcceptance.max === 0.10,
  'RFQ is an explicitly ramped low-beta capture structure');
  check(COMPONENTS.dtl.betaAcceptance.tracksBeam === true
    && COMPONENTS.dtl.betaAcceptance.min <= COMPONENTS.rfq.betaAcceptance.max,
  'DTL overlaps the RFQ output instead of leaving a beta acceptance gap');
  check(COMPONENTS.spokeCavity.betaAcceptance.min <= COMPONENTS.dtl.betaAcceptance.max
    && COMPONENTS.srf650Cryomodule.betaAcceptance.min <= COMPONENTS.spokeCavity.betaAcceptance.max,
  'spoke and 650 MHz structures continue the low-to-medium-beta ladder');
  check(RESEARCH.protonAcceleration.unlocks.includes('dtl'),
    'proton acceleration research unlocks the DTL alongside the RFQ');
}

console.log('\n--- DTL content/physics infrastructure ---');
{
  const defaults = getDefaults('dtl');
  const stats = computeStats('dtl', defaults);
  check(Math.abs(stats.energyGain - COMPONENTS.dtl.stats.energyGain) < 0.0001,
    'DTL default tuning agrees with its catalogue energy gain');
  check(CAVITY_SPECS.dtl?.kind === 'nc' && CAVITY_SPECS.dtl.f_ghz === 0.325,
    'DTL has a normal-conducting cavity power model');
  const ports = getUtilityPortsV2('dtl');
  check(ports.rf_in?.params?.frequency === 325e6
    && ports.cool_in?.utility === 'coolingWater',
  'DTL exposes matched 325 MHz RF and water-cooling sinks');
  const [payload] = buildPhysicsElements([{ id: 'dtl1', type: 'dtl', params: defaults }]);
  check(payload.betaAcceptance?.design === 0.16
    && payload.betaAcceptance?.tracksBeam === true,
  'physics payload preserves the authored beta contract');
}

function recordingCanvas() {
  const events = { fills: [], text: [], arcs: [] };
  const ctx = {
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', lineWidth: 1,
    clearRect() {},
    fillRect(...args) { events.fills.push({ args, fillStyle: this.fillStyle }); },
    strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    setLineDash() {}, save() {}, restore() {}, translate() {}, rotate() {},
    fill() {}, closePath() {},
    arc(...args) { events.arcs.push(args); },
    fillText(value) { events.text.push(String(value)); },
    measureText(value) { return { width: String(value).length * 5 }; },
  };
  return { canvas: { width: 640, height: 360, getContext: () => ctx }, events };
}

console.log('\n--- Beam beta plot and hover readout ---');
{
  const envelope = [
    { s: 0, rel_beta: 0.009 },
    { s: 2, rel_beta: 0.04, rel_beta_input: 0.009,
      beta_acceptance_min: 0.005, beta_acceptance_design: 0.04,
      beta_synchronous: 0.009, beta_acceptance_max: 0.10,
      beta_accepted: true, beta_ttf: 1 },
    { s: 4, rel_beta: 0.12, rel_beta_input: 0.12,
      beta_acceptance_min: 0.005, beta_acceptance_design: 0.04,
      beta_synchronous: 0.04, beta_acceptance_max: 0.10,
      beta_accepted: false, beta_ttf: 0.62 },
    { s: 6, rel_beta: 0.13 },
  ];
  const { canvas, events } = recordingCanvas();
  ProbePlots.draw(canvas, 'beta-acceptance', envelope, [], 0, [0, 6]);
  check(events.fills.some(event => event.fillStyle.includes('80, 220, 130'))
    && events.fills.some(event => event.fillStyle.includes('255, 68, 68')),
  'plot distinguishes matched and mismatched acceptance bands');
  const cursor = ProbePlots.drawCursor(canvas, 'beta-acceptance', envelope, [0, 6], {
    cursorX: 435, cursorY: 180, yDomain: [[0, 1]],
  });
  check(cursor?.rows.some(row => row.includes('MISMATCH') && row.includes('TTF')),
    'cursor reports numerical beam beta, acceptance state, and transit-time factor');
  check(ProbePlots.secondaryYDomain('rel-beta', envelope, null)?.join(',') === '0,1',
    'beam beta is available as a fixed-domain secondary plot');
}

console.log(`\n${passed}/${passed + failed} assertions passed`);
process.exit(failed > 0 ? 1 : 0);
