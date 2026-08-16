import {
  beamVisualMode,
  beamVisualProfile,
  beamVisualSpeed,
  relativisticBeta,
  sampleBeamVisualProfile,
} from '../src/renderer3d/beam-visual-mode.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

assert(beamVisualMode({ dutyFactor: 1 }, []) === 'continuous',
  'CW beamlines use a steady core');
assert(beamVisualMode({ dutyFactor: 0.05 }, []) === 'bunched',
  'low-duty beamlines use visible travelling packets');
assert(beamVisualMode({ dutyFactor: 1 }, [{ type: 'buncher' }]) === 'bunched',
  'a CW beam becomes visibly bunched after a buncher');
assert(beamVisualMode({ dutyFactor: 1 }, [{ type: 'solenoid' }]) === 'continuous',
  'ordinary DC transport stays visually continuous');

const beta40kevProton = relativisticBeta(0.00004, 0.938);
const beta180mevProton = relativisticBeta(0.180, 0.938);
assert(Math.abs(beta40kevProton - 0.00923) < 0.0001,
  'fallback beta derivation handles a slow 40 keV proton');
assert(Math.abs(beta180mevProton - 0.546) < 0.002,
  'fallback beta derivation handles an accelerated 180 MeV proton');
assert(beamVisualSpeed(beta180mevProton) > beamVisualSpeed(beta40kevProton),
  'visual speed rises with relativistic beta');
assert(beamVisualSpeed(0) === 0.8 && beamVisualSpeed(1) === 4,
  'compressed speed curve remains readable from stopped to light speed');

const mixedProfile = beamVisualProfile(
  { dutyFactor: 1, particle: 'p+' },
  [{ type: 'ionSource' }, { type: 'buncher' }],
  [
    { s: 1, rel_beta: 0.05, bunch_frequency: 0 },
    { s: 5, rel_beta: 0.30, bunch_frequency: 0 },
    { s: 6, rel_beta: 0.35, bunch_frequency: 162.5e6 },
    { s: 10, rel_beta: 0.65, bunch_frequency: 162.5e6 },
  ],
);
assert(mixedProfile[0].u === 0 && mixedProfile.at(-1).u === 1,
  'visual profile covers the complete rendered path');
assert(sampleBeamVisualProfile(mixedProfile, 0.2).speed
    < sampleBeamVisualProfile(mixedProfile, 0.9).speed,
  'profile interpolation accelerates highlights downstream');
assert(sampleBeamVisualProfile(mixedProfile, 0.5).bunch === 0
    && sampleBeamVisualProfile(mixedProfile, 0.8).bunch === 1,
  'CW presentation changes to indicative packets after bunch capture');

const pulsedProfile = beamVisualProfile(
  { dutyFactor: 0.05, particle: 'p+' },
  [],
  [{ s: 0, rel_beta: 0.1, bunch_frequency: 0 }, { s: 2, rel_beta: 0.2, bunch_frequency: 0 }],
);
assert(pulsedProfile.every(sample => sample.bunch === 1),
  'low-duty machines use packets across the whole line');

const oldEnvelopeProfile = beamVisualProfile(
  { dutyFactor: 1, particle: 'p+' },
  [],
  [{ s: 0, energy: 0.00004 }, { s: 2, energy: 0.180 }],
);
assert(oldEnvelopeProfile[0].beta < oldEnvelopeProfile.at(-1).beta,
  'old envelopes derive beta from kinetic energy and particle species');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
