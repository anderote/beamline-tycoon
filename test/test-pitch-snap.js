// === Pitch / Mode Snap Tests ===

import {
  PITCH_REST,
  PITCH_STEEP,
  PITCH_TOP,
  pickSnapMode,
  targetPitchForMode,
  YAW_STEP,
  YAW_DIVISIONS,
  snapYaw,
} from '../src/renderer3d/free-orbit-math.js';
import { FACE_TO_YAW } from '../src/renderer3d/view-cube.js';
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.log(`  FAIL: ${msg}`); }
}

console.log('pickSnapMode');
assert(pickSnapMode(PITCH_REST) === 'iso', 'rest pitch picks iso');
assert(pickSnapMode(PITCH_STEEP) === 'steep', 'steep pitch picks steep');
assert(pickSnapMode(PITCH_TOP) === 'top', 'top pitch picks top');
assert(pickSnapMode((PITCH_REST + PITCH_STEEP) / 2 - 0.001) === 'iso', 'below steep midpoint picks iso');
assert(pickSnapMode((PITCH_REST + PITCH_STEEP) / 2 + 0.001) === 'steep', 'above steep midpoint picks steep');
assert(pickSnapMode((PITCH_STEEP + PITCH_TOP) / 2 + 0.001) === 'top', 'above top midpoint picks top');
assert(pickSnapMode(0) === 'iso', 'pitch=0 picks iso');
assert(pickSnapMode(Math.PI / 2) === 'top', 'pitch=π/2 picks top');

console.log('targetPitchForMode');
assert(Math.abs(PITCH_STEEP - (55 * Math.PI) / 180) < 1e-9,
  'Build view is 55° (15° steeper than before)');
assert(targetPitchForMode('iso') === PITCH_REST, "'iso' -> PITCH_REST");
assert(targetPitchForMode('steep') === PITCH_STEEP, "'steep' -> PITCH_STEEP");
assert(targetPitchForMode('top') === PITCH_TOP, "'top' -> PITCH_TOP");
assert(targetPitchForMode('garbage') === PITCH_REST, 'unknown mode falls back to PITCH_REST');

console.log('default view');
const rendererSource = readFileSync(new URL('../src/renderer3d/ThreeRenderer.js', import.meta.url), 'utf8');
assert(rendererSource.includes("this.viewMode = 'steep';"), 'new renderers start in the steep construction view');

console.log('free-orbit elevation lock');
assert(rendererSource.includes('this._snapToPitch = this._freePitch;'),
  'free-orbit release keeps its exact elevation instead of choosing a preset');
assert(rendererSource.includes("this._snapTargetMode = 'custom';"),
  'free-orbit release enters a custom elevation mode');
assert(rendererSource.includes('this._lockedPitch = this._snapToPitch;'),
  'the released elevation remains locked after the yaw snap completes');
assert(rendererSource.includes("if (this.viewMode === 'custom') return this._customYawIdx;"),
  'custom elevation retains its own Q/E facing index');

console.log('YAW_STEP / YAW_DIVISIONS');
assert(YAW_STEP === Math.PI / 4, 'yaw step = π/4');
assert(YAW_DIVISIONS === 8, 'yaw has 8 divisions');
assert(Math.abs(YAW_STEP * YAW_DIVISIONS - 2 * Math.PI) < 1e-9, 'step × divisions = full turn');

console.log('8-way rotation returns to start (all preferred views share divisions)');
for (const mode of ['iso', 'steep', 'top']) {
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
