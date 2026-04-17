// src/renderer3d/free-orbit-math.js
// Pure math helpers for the free-orbit camera. No Three.js, no DOM —
// unit-testable in plain Node.

// Camera rig constants. The current dimetric camera sits at
// (CAM_D, CAM_D·√6/3, CAM_D) looking at (0,0,0). From this geometry:
//   horizontal distance from origin = CAM_D·√2
//   height                          = CAM_D·√6/3
//   pitch (elevation)               = atan(height / horizontal)
//                                    = atan((√6/3) / √2) = atan(1/√3) = 30°
//   orbit radius                    = |(CAM_D, CAM_D·√6/3, CAM_D)|
//                                    = 2·CAM_D·√6 / 3
export const CAM_D = 50;
export const ORBIT_RADIUS = (2 * CAM_D * Math.sqrt(6)) / 3;

export const PITCH_REST = Math.atan(1 / Math.sqrt(3));
// Top-down view sits just below π/2 to avoid the lookAt(up=+Y) gimbal
// degeneracy. cos(89°) ≈ 0.0175, nonzero, so the look direction stays
// well-defined and yaw remains meaningful.
export const PITCH_TOP = (89 * Math.PI) / 180;
export const PITCH_MIN = (5 * Math.PI) / 180;
// Free-orbit drag can now reach top-down so MMB-release can snap into the
// top mode (it picks the closer of PITCH_REST / PITCH_TOP by midpoint).
export const PITCH_MAX = PITCH_TOP;
// Midpoint between the two preset pitches; used by pickSnapMode to decide
// which mode the player landed closer to during a free-orbit drag.
export const PITCH_THRESHOLD = (PITCH_REST + PITCH_TOP) / 2;

// Default tuning. Pixel-to-radian scalars; adjust to taste during playtest.
export const ORBIT_YAW_SENSITIVITY = 0.005;
export const ORBIT_PITCH_SENSITIVITY = 0.005;

export function clampPitch(p) {
  if (p < PITCH_MIN) return PITCH_MIN;
  if (p > PITCH_MAX) return PITCH_MAX;
  return p;
}

// Snap yaw to the nearest multiple of `step` (default π/2 for iso). Preserves
// large winding numbers (e.g. snapYaw(3π + 0.05) = 3π) so _viewRotationAngle
// stays continuous after a release.
export function snapYaw(yaw, step = Math.PI / 2) {
  return Math.round(yaw / step) * step;
}

// Yaw step for each view mode: iso uses 4 cardinal facings (90°), top-down
// uses 8 cardinal+intercardinal facings (45°) for finer in-plan rotation.
export function yawStepForMode(mode) {
  return mode === 'top' ? Math.PI / 4 : Math.PI / 2;
}

export function yawDivisionsForMode(mode) {
  return mode === 'top' ? 8 : 4;
}

// Camera position relative to lookAt, on a sphere of radius ORBIT_RADIUS.
// The +π/4 phase is chosen so (yaw=0, pitch=PITCH_REST) produces the
// historical rest position (CAM_D, CAM_D·√6/3, CAM_D).
//   At yaw=0, pitch=PITCH_REST:
//     cos(pitch) = √3/2, sin(pitch) = 1/2
//     offX = R·(√3/2)·sin(π/4) = R·(√3/2)·(√2/2) = R·√6/4 = CAM_D  ✓
//     offY = R·(1/2)            = R/2            = CAM_D·√6/3    ✓
//     offZ = R·(√3/2)·cos(π/4) = R·√6/4          = CAM_D          ✓
export function cameraOffset(yaw, pitch) {
  const r = ORBIT_RADIUS;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const ang = yaw + Math.PI / 4;
  return {
    x: r * cp * Math.sin(ang),
    y: r * sp,
    z: r * cp * Math.cos(ang),
  };
}

// Matches the easing used by _tickViewRotation in ThreeRenderer.
export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// Decide which preset view a free-orbit release should land in, based on
// the pitch at release time. Crossing PITCH_THRESHOLD flips the mode.
export function pickSnapMode(pitch) {
  return pitch < PITCH_THRESHOLD ? 'iso' : 'top';
}

export function targetPitchForMode(mode) {
  return mode === 'top' ? PITCH_TOP : PITCH_REST;
}
