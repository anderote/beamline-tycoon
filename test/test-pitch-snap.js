// === Pitch / Mode Snap Tests ===

import {
  PITCH_REST,
  PITCH_TOP,
  PITCH_THRESHOLD,
  pickSnapMode,
  targetPitchForMode,
  yawStepForMode,
  yawDivisionsForMode,
  snapYaw,
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

console.log('yawStepForMode / yawDivisionsForMode');
assert(yawStepForMode('iso') === Math.PI / 2, "'iso' yaw step = π/2");
assert(yawStepForMode('top') === Math.PI / 4, "'top' yaw step = π/4");
assert(yawDivisionsForMode('iso') === 4, "'iso' has 4 divisions");
assert(yawDivisionsForMode('top') === 8, "'top' has 8 divisions");

console.log('snapYaw with custom step');
assert(Math.abs(snapYaw(0.1, Math.PI / 4) - 0) < 1e-9, 'small yaw snaps to 0 with π/4 step');
assert(Math.abs(snapYaw(Math.PI / 4 + 0.01, Math.PI / 4) - Math.PI / 4) < 1e-9, 'just past π/4 snaps to π/4');
assert(Math.abs(snapYaw(Math.PI / 8 + 0.01, Math.PI / 4) - Math.PI / 4) < 1e-9, 'just past midpoint snaps up');
assert(Math.abs(snapYaw(Math.PI / 8 - 0.01, Math.PI / 4) - 0) < 1e-9, 'just below midpoint snaps down');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
