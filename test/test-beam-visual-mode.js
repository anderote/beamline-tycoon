import { beamVisualMode } from '../src/renderer3d/beam-visual-mode.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
