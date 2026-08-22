import {
  beamVisualIntensity,
  sampleBeamEnvelope,
} from '../src/renderer3d/beam-visual-mode.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

assert(beamVisualIntensity(0, 10) > 0,
  'zero current retains a faint visible trace');
assert(beamVisualIntensity(10, 10) > beamVisualIntensity(1, 10),
  'higher current is brighter');
assert(beamVisualIntensity(1, 10) > beamVisualIntensity(0, 10),
  'log mapping separates weak current from the floor');
assert(beamVisualIntensity(0, 1) > 0 && beamVisualIntensity(1, 1) <= 1,
  'brightness stays bounded while the empty case remains visible');

const envelope = [
  { s: 0, current: 10, peak_current: 12, bunch_frequency: 0 },
  { s: 5, current: 4, peak_current: 18, bunch_frequency: 162.5e6 },
  { s: 10, current: 0.5, peak_current: 2, bunch_frequency: 162.5e6 },
];
const mid = sampleBeamEnvelope(envelope, 0.5);
assert(Math.abs(mid.current - 4) < 1e-9 && mid.bunch_frequency > 0,
  'envelope sampling follows the published beam transition');
assert(sampleBeamEnvelope(envelope, 0)?.s === 0
    && sampleBeamEnvelope(envelope, 1)?.s === 10,
  'envelope sampling covers both beamline ends');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
