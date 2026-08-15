// Physics-driven insertion recipes and mission plot targets.

import {
  computePlacementHints,
  missionPlotTargets,
} from '../src/beamline/designer-placement-hints.js';
import { BeamlineDesigner } from '../src/ui/BeamlineDesigner.js';
import { ProbePlots } from '../src/ui/probe-plots.js';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function envelope(totalS, opts = {}) {
  const n = opts.n || 120;
  return Array.from({ length: n }, (_, i) => {
    const s = totalS * i / (n - 1);
    return {
      s,
      energy: opts.energy ?? 0.001,
      bunch_frequency: opts.bunchFrequency ?? 1.625e8,
      focus_margin: 0.8 - s / Math.max(totalS, 1),
      focus_urgency: opts.focused ? 0.1 : Math.min(1, s / 20),
    };
  });
}

const drifts = n => Array.from({ length: n }, () => ({ type: 'drift', subL: 4 }));

console.log('1. an electron transport line gets an alternating quad lattice');
{
  const hints = computePlacementHints({
    nodes: [{ type: 'dcGun' }, ...drifts(20)],
    envelope: envelope(40),
    beamlineType: { id: 'testStand', particle: 'e-', spec: {} },
    isAvailable: type => type === 'quadrupole',
  });
  const focus = hints.filter(h => h.kind === 'focus');
  check('more than one focus hint is emitted', focus.length > 1, `got ${focus.length}`);
  check('electron focus hints use quadrupoles', focus.every(h => h.componentType === 'quadrupole'));
  check('quadrupole polarity alternates', focus.every((h, i) => i === 0 ||
    h.params.polarity !== focus[i - 1].params.polarity));
}

console.log('2. slow proton focusing adapts to a solenoid');
{
  const hints = computePlacementHints({
    nodes: [{ type: 'duoplasmatron' }, ...drifts(12)],
    envelope: envelope(24, { energy: 0.00004 }),
    beamlineType: { id: 'therapy', particle: 'p+', spec: {} },
    isAvailable: type => ['solenoid', 'quadrupole'].includes(type),
  });
  const focus = hints.find(h => h.kind === 'focus');
  check('a focus hint exists', !!focus);
  check('the low-energy ion remedy is a solenoid', focus?.componentType === 'solenoid',
    focus?.componentType);
  check('the annotation carries local energy', focus?.state.includes('keV'), focus?.state);
}

console.log('3. a DC proton front end gets an RFQ capture hint');
{
  const hints = computePlacementHints({
    nodes: [{ type: 'duoplasmatron' }, ...drifts(3), { type: 'protonTherapyGantry' }],
    envelope: envelope(8, { energy: 0.00004, bunchFrequency: 0, focused: true }),
    beamlineType: {
      id: 'therapy', particle: 'p+', spec: { energyGeV: [0.07, 0.25] },
    },
    isAvailable: type => ['rfq', 'spokeCavity'].includes(type),
  });
  const capture = hints.find(h => h.kind === 'longitudinal');
  check('the longitudinal hint exists', !!capture);
  check('it chooses the proton RFQ', capture?.componentType === 'rfq', capture?.componentType);
  check('it is a one-click insertion recipe', Number.isInteger(capture?.nodeIndex) &&
    capture?.position === 'after');
}

console.log('4. an already-bunched beam does not get redundant capture hardware');
{
  const hints = computePlacementHints({
    nodes: [{ type: 'dcGun' }, ...drifts(3)],
    envelope: envelope(8, { bunchFrequency: 2.856e9, focused: true }),
    beamlineType: { id: 'testStand', particle: 'e-', spec: {} },
    isAvailable: () => true,
  });
  check('there is no longitudinal capture hint', !hints.some(h => h.kind === 'longitudinal'));
}

console.log('5. missing mission energy selects machine-appropriate acceleration');
{
  const hints = computePlacementHints({
    nodes: [{ type: 'dcGun' }, ...drifts(2), { type: 'eBeamIrradiationVault' }],
    envelope: envelope(6, { energy: 0.001, focused: true }),
    beamlineType: {
      id: 'ebeamProcessing', particle: 'e-', spec: { energyGeV: [0.003, 0.012] },
    },
    isAvailable: type => type === 'industrialLinac',
  });
  const energy = hints.find(h => h.kind === 'energy');
  check('an energy hint exists', !!energy);
  check('it chooses the industrial line structure', energy?.componentType === 'industrialLinac');
  check('it inserts before the terminal endpoint', energy?.position === 'before');
}

console.log('6. accepting a hint uses the ordinary parameterized insert path');
{
  const designer = Object.create(BeamlineDesigner.prototype);
  designer.totalLength = 10;
  designer.draftNodes = [{ type: 'drift' }];
  designer.insertMode = null;
  designer._componentAvailableForHint = () => true;
  designer._updateInsertButtons = () => {};
  designer.game = { log() {} };
  let args = null;
  designer.insertComponent = (...values) => { args = values; };
  designer._acceptPlacementHint({
    componentType: 'quadrupole', s: 4, nodeIndex: 0, position: 'after',
    params: { polarity: -1 },
  });
  check('insertComponent is called', !!args);
  check('the suggested type and position are preserved', args?.[1] === 'quadrupole' && args?.[2] === 'after');
  check('the suggested controls are preserved', args?.[3]?.polarity === -1);
}

console.log('7. mission bands feed the relevant plots');
{
  const targets = missionPlotTargets({
    spec: { energyGeV: [0.07, 0.25], currentMA: [0.001, 0.05], spotSizeMm: [5, 50] },
  });
  check('energy target is retained', targets.energyGeV[0] === 0.07 && targets.energyGeV[1] === 0.25);
  check('energy plot gets a two-channel target domain',
    ProbePlots.targetYDomain('energy-dispersion', targets)?.[0]?.[1] === 0.25);
  check('envelope plot gets the spot-size band',
    ProbePlots.targetYDomain('beam-envelope', targets)?.[0]?.[0] === 5);
  check('current plot gets the mission-current band',
    ProbePlots.targetYDomain('current-loss', targets)?.[0]?.[1] === 0.05);
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
