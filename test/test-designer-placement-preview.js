// Beamline Designer placement previews are a read model over published solver
// results. Pin the player-facing comparison without constructing DOM or
// reaching through BeamlineDesigner private helpers.

import { summarizeDesignerPlacement } from '../src/beamline/designer-placement-preview.js';
import { BeamlineDesigner } from '../src/ui/BeamlineDesigner.js';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

function row(summary, label) {
  return summary.rows.find(item => item.label === label);
}

const component = {
  apertureRadius: 10,
  betaAcceptance: { min: 0.2, design: 0.4, max: 0.8 },
};

console.log('\n--- Lossy placement ---');
{
  const summary = summarizeDesignerPlacement({
    component,
    componentIndex: 1,
    action: 'insert',
    positionS: 12.25,
    beforeResult: { singlePassLossFraction: 0.02 },
    previewResult: {
      singlePassLossFraction: 0.10,
      envelope: [
        {
          index: 0, current: 100, sigma_x: 0.004, sigma_y: 0.005,
          energy_spread: 0.001, emit_nx: 1e-6, emit_ny: 1e-6,
        },
        {
          index: 1, current: 92, sigma_x: 0.012, sigma_y: 0.008,
          energy_spread: 0.002, emit_nx: 1.5e-6, emit_ny: 1.5e-6,
          rel_beta: 0.9, beta_accepted: false, beta_ttf: 0.62,
          focus_margin: -0.2,
        },
      ],
    },
  });

  check(summary.heading === 'Insert at s=12.3 m', 'names the exact insertion position');
  check(row(summary, 'Line transmission')?.value.includes('90.0%')
    && row(summary, 'Line transmission')?.tone === 'bad',
  'shows the solver transmission and marks a loss increase red');
  check(row(summary, 'Loss in this component')?.value.includes('8.0%')
    && row(summary, 'Loss in this component')?.tone === 'bad',
  'isolates current lost through the hovered component');
  check(row(summary, '\u03b2 acceptance')?.value.includes('outside')
    && row(summary, '\u03b2 acceptance')?.tone === 'bad',
  'shows rejected beam beta and TTF as a bad placement');
  check(row(summary, 'Acceptance beam spot (1\u03c3)')?.value.includes('120% of r=10.0 mm')
    && row(summary, 'Acceptance beam spot (1\u03c3)')?.tone === 'bad',
  'compares the predicted beam spot with the component aperture');
  check(row(summary, 'Energy spread')?.tone === 'bad'
    && row(summary, 'Optical spread (\u03b5n)')?.tone === 'bad',
  'marks increased energy and optical spread red');
  check(row(summary, 'Aperture margin')?.tone === 'bad',
    'marks a negative published aperture margin red');
}

console.log('\n--- Helpful placement ---');
{
  const summary = summarizeDesignerPlacement({
    component,
    componentIndex: 1,
    action: 'replace',
    positionS: 4,
    beforeResult: { totalLossFraction: 0.1 },
    previewResult: {
      totalLossFraction: 0.05,
      envelope: [
        {
          index: 0, current: 100, sigma_x: 0.007, sigma_y: 0.007,
          energy_spread: 0.002, emit_nx: 2e-6, emit_ny: 2e-6,
        },
        {
          index: 1, current: 100, sigma_x: 0.005, sigma_y: 0.006,
          energy_spread: 0.001, emit_nx: 1e-6, emit_ny: 1e-6,
          rel_beta: 0.5, beta_accepted: true, beta_ttf: 0.99,
          focus_margin: 0.4,
        },
      ],
    },
  });

  check(summary.heading === 'Replace at s=4.0 m', 'distinguishes replace from insert');
  check(row(summary, 'Line transmission')?.tone === 'good'
    && row(summary, 'Line transmission')?.value.includes('+5.0 pt'),
  'marks improved line transmission green');
  check(row(summary, 'Loss in this component')?.value === 'None detected'
    && row(summary, 'Loss in this component')?.tone === 'good',
  'marks loss-free transport green');
  check(row(summary, '\u03b2 acceptance')?.tone === 'good'
    && row(summary, 'Acceptance beam spot (1\u03c3)')?.tone === 'good',
  'marks accepted beta and a fitting beam spot green');
  check(row(summary, 'Energy spread')?.tone === 'good'
    && row(summary, 'Optical spread (\u03b5n)')?.tone === 'good',
  'marks reduced spread green');
}

console.log('\n--- No beam result ---');
{
  const summary = summarizeDesignerPlacement({
    component,
    componentIndex: 2,
    previewResult: null,
    positionS: 9,
  });
  check(summary.state === 'unavailable'
    && row(summary, 'Beam solver')?.tone === 'warn',
  'distinguishes an unavailable solver result from predicted beam loss');
}

console.log('\n--- Public Designer preview seam ---');
{
  const designer = Object.create(BeamlineDesigner.prototype);
  designer.isOpen = true;
  designer.insertMode = 'nearest';
  designer.markerS = 2;
  designer.totalLength = 4;
  designer._draftPhysicsRevision = 7;
  designer.draftPhysicsResult = { totalLossFraction: 0 };
  designer.draftEnvelope = [{ s: 2, energy: 0.01 }];
  designer.draftNodes = [
    { id: 'source', type: 'source', subL: 4, params: {} },
    { id: 'drift', type: 'drift', subL: 4, params: {} },
  ];
  let solvedNodes = null;
  designer._computePhysics = async nodes => {
    solvedNodes = nodes;
    return {
      totalLossFraction: 0,
      envelope: [
        { index: 0, current: 10 },
        { index: 1, current: 10, sigma_x: 0.001, sigma_y: 0.001 },
      ],
    };
  };

  const original = JSON.stringify(designer.draftNodes);
  const summary = await designer.previewComponentPlacement('buncher');
  check(solvedNodes?.[1]?.type === 'buncher'
    && solvedNodes[1].params.voltage === 0.01,
  'public preview inserts the hovered component with canonical default params');
  check(summary?.heading === 'Insert at s=2.0 m',
    'public preview uses the exact marker edge a click would use');
  check(JSON.stringify(designer.draftNodes) === original,
    'public preview does not mutate the draft');
}

console.log(`\n${passed}/${passed + failed} assertions passed`);
process.exit(failed > 0 ? 1 : 0);
