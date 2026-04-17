// === Pitch / Mode Snap Tests ===

import {
  PITCH_REST,
  PITCH_TOP,
  PITCH_THRESHOLD,
  pickSnapMode,
  targetPitchForMode,
} from '../src/renderer3d/free-orbit-math.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.log(`  FAIL: ${msg}`); }
}

console.log('PITCH_THRESHOLD');
assert(
  Math.abs(PITCH_THRESHOLD - (PITCH_REST + PITCH_TOP) / 2) < 1e-12,
  'PITCH_THRESHOLD is the midpoint of PITCH_REST and PITCH_TOP'
);

console.log('pickSnapMode');
assert(pickSnapMode(PITCH_REST) === 'iso', 'rest pitch picks iso');
assert(pickSnapMode(PITCH_TOP) === 'top', 'top pitch picks top');
assert(pickSnapMode(PITCH_THRESHOLD - 0.001) === 'iso', 'just below threshold picks iso');
assert(pickSnapMode(PITCH_THRESHOLD + 0.001) === 'top', 'just above threshold picks top');
assert(pickSnapMode(PITCH_THRESHOLD) === 'top', 'exactly at threshold picks top (>= boundary)');
assert(pickSnapMode(0) === 'iso', 'pitch=0 picks iso');
assert(pickSnapMode(Math.PI / 2) === 'top', 'pitch=π/2 picks top');

console.log('targetPitchForMode');
assert(targetPitchForMode('iso') === PITCH_REST, "'iso' -> PITCH_REST");
assert(targetPitchForMode('top') === PITCH_TOP, "'top' -> PITCH_TOP");
assert(targetPitchForMode('garbage') === PITCH_REST, 'unknown mode falls back to PITCH_REST');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
