// === Pitch / Mode Snap Tests ===

import {
  PITCH_REST,
  PITCH_TOP,
  PITCH_THRESHOLD,
  pickSnapMode,
  targetPitchForMode,
  YAW_STEP,
  YAW_DIVISIONS,
  snapYaw,
} from '../src/renderer3d/free-orbit-math.js';
import { FACE_TO_YAW } from '../src/renderer3d/view-cube.js';

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

console.log('YAW_STEP / YAW_DIVISIONS');
assert(YAW_STEP === Math.PI / 4, 'yaw step = π/4');
assert(YAW_DIVISIONS === 8, 'yaw has 8 divisions');
assert(Math.abs(YAW_STEP * YAW_DIVISIONS - 2 * Math.PI) < 1e-9, 'step × divisions = full turn');

console.log('8-way rotation returns to start (iso and top-down share divisions)');
for (const mode of ['iso', 'top']) {
  let idx = 0;
  for (let i = 0; i < YAW_DIVISIONS; i++) {
    idx = ((idx + 1) % YAW_DIVISIONS + YAW_DIVISIONS) % YAW_DIVISIONS;
  }
  assert(idx === 0, `${mode}: 8 steps of rotation returns to the starting index`);
}

console.log('FACE_TO_YAW lands on cardinal (even) facings');
for (const [face, idx] of Object.entries(FACE_TO_YAW)) {
  assert(idx % 2 === 0, `FACE_TO_YAW.${face} (${idx}) is an even/cardinal index`);
}
assert(
  new Set(Object.values(FACE_TO_YAW)).size === 4,
  'FACE_TO_YAW maps all 4 side faces to distinct indices'
);

console.log('snapYaw with custom step');
assert(Math.abs(snapYaw(0.1, Math.PI / 4) - 0) < 1e-9, 'small yaw snaps to 0 with π/4 step');
assert(Math.abs(snapYaw(Math.PI / 4 + 0.01, Math.PI / 4) - Math.PI / 4) < 1e-9, 'just past π/4 snaps to π/4');
assert(Math.abs(snapYaw(Math.PI / 8 + 0.01, Math.PI / 4) - Math.PI / 4) < 1e-9, 'just past midpoint snaps up');
assert(Math.abs(snapYaw(Math.PI / 8 - 0.01, Math.PI / 4) - 0) < 1e-9, 'just below midpoint snaps down');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
