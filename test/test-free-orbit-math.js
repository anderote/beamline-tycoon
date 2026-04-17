// === Free Orbit Math Tests ===

import {
  PITCH_REST,
  PITCH_MIN,
  PITCH_MAX,
  CAM_D,
  ORBIT_RADIUS,
  clampPitch,
  snapYaw,
  cameraOffset,
  easeInOutQuad,
} from '../src/renderer3d/free-orbit-math.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.log(`  FAIL: ${msg}`); }
}

function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

console.log('PITCH_REST');
// PITCH_REST = atan(1/sqrt(3)) = 30° — the elevation angle of the current
// camera at (D, D·sqrt(6)/3, D) relative to lookAt (0,0,0).
assert(approx(PITCH_REST, Math.atan(1 / Math.sqrt(3))), 'PITCH_REST = atan(1/sqrt(3))');
assert(approx(PITCH_REST, Math.PI / 6), 'PITCH_REST = 30° (π/6)');

console.log('Pitch bounds');
assert(PITCH_MIN > 0 && PITCH_MIN < PITCH_REST, 'PITCH_MIN is below rest');
assert(PITCH_MAX > PITCH_REST && PITCH_MAX < Math.PI / 2, 'PITCH_MAX is above rest, below vertical');
assert(approx(PITCH_MIN, (5 * Math.PI) / 180), 'PITCH_MIN = 5°');
assert(approx(PITCH_MAX, (80 * Math.PI) / 180), 'PITCH_MAX = 80°');

console.log('clampPitch');
assert(clampPitch(PITCH_REST) === PITCH_REST, 'rest pitch passes through');
assert(clampPitch(-1) === PITCH_MIN, 'underflow clamps to min');
assert(clampPitch(2) === PITCH_MAX, 'overflow clamps to max');
assert(clampPitch(PITCH_MIN - 0.01) === PITCH_MIN, 'just below min clamps');
assert(clampPitch(PITCH_MAX + 0.01) === PITCH_MAX, 'just above max clamps');

console.log('snapYaw — nearest π/2 multiple, preserving winding');
assert(snapYaw(0) === 0, 'zero snaps to zero');
assert(approx(snapYaw(Math.PI / 4 - 0.01), 0), 'just under 45° snaps down to 0');
assert(approx(snapYaw(Math.PI / 4 + 0.01), Math.PI / 2), 'just over 45° snaps up to π/2');
assert(approx(snapYaw(Math.PI / 2), Math.PI / 2), 'π/2 is a fixed point');
assert(approx(snapYaw(-Math.PI / 4 - 0.01), -Math.PI / 2), 'just under -45° snaps to -π/2');
// Accumulated rotation — snap should produce a multiple of π/2 closest to input.
assert(approx(snapYaw(3 * Math.PI + 0.05), 3 * Math.PI), 'snaps near 3π (i.e., 6·π/2) stays at 3π');
assert(approx(snapYaw(3 * Math.PI + Math.PI / 4 + 0.01), 3 * Math.PI + Math.PI / 2),
  'snaps past 3π + π/4 to 3π + π/2');

console.log('cameraOffset — rest view reproduces historical camera position');
// The current rest camera is at (CAM_D, CAM_D * sqrt(6)/3, CAM_D) with the
// +π/4 phase baked into the formula so yaw=0 equals the default view.
{
  const o = cameraOffset(0, PITCH_REST);
  assert(approx(o.x, CAM_D), `rest offX = CAM_D (got ${o.x})`);
  assert(approx(o.y, (CAM_D * Math.sqrt(6)) / 3), `rest offY = CAM_D·√6/3 (got ${o.y})`);
  assert(approx(o.z, CAM_D), `rest offZ = CAM_D (got ${o.z})`);
}

console.log('cameraOffset — 90° yaw rotates in the XZ plane');
{
  const o = cameraOffset(Math.PI / 2, PITCH_REST);
  // A 90° yaw around Y sends (CAM_D, h, CAM_D) -> (CAM_D, h, -CAM_D)
  assert(approx(o.x, CAM_D), `90° offX = CAM_D (got ${o.x})`);
  assert(approx(o.z, -CAM_D), `90° offZ = -CAM_D (got ${o.z})`);
  assert(approx(o.y, (CAM_D * Math.sqrt(6)) / 3), 'height unchanged by yaw');
}

console.log('cameraOffset — pitch = PITCH_MAX tilts most toward top-down');
{
  const o = cameraOffset(0, PITCH_MAX);
  // sin(80°) > sin(30°), cos(80°) < cos(30°), so height up, horizontal down.
  const rest = cameraOffset(0, PITCH_REST);
  assert(o.y > rest.y, 'higher at max pitch than rest');
  assert(Math.hypot(o.x, o.z) < Math.hypot(rest.x, rest.z), 'closer horizontally at max pitch');
}

console.log('cameraOffset — ORBIT_RADIUS is distance from origin');
{
  const o = cameraOffset(0, PITCH_REST);
  assert(approx(Math.hypot(o.x, o.y, o.z), ORBIT_RADIUS),
    `|offset| = ORBIT_RADIUS at rest (got ${Math.hypot(o.x, o.y, o.z)}, expected ${ORBIT_RADIUS})`);
}

console.log('easeInOutQuad');
assert(easeInOutQuad(0) === 0, 'ease(0) = 0');
assert(easeInOutQuad(1) === 1, 'ease(1) = 1');
assert(approx(easeInOutQuad(0.5), 0.5), 'ease(0.5) = 0.5');
assert(easeInOutQuad(0.25) < 0.25, 'ease accelerates slowly from 0');
assert(easeInOutQuad(0.75) > 0.75, 'ease decelerates slowly into 1');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
