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
export const PITCH_MIN = (5 * Math.PI) / 180;
export const PITCH_MAX = (80 * Math.PI) / 180;

// Default tuning. Pixel-to-radian scalars; adjust to taste during playtest.
export const ORBIT_YAW_SENSITIVITY = 0.005;
export const ORBIT_PITCH_SENSITIVITY = 0.005;

export function clampPitch(p) {
  if (p < PITCH_MIN) return PITCH_MIN;
  if (p > PITCH_MAX) return PITCH_MAX;
  return p;
}

// Snap yaw to the nearest multiple of π/2. Preserves large winding numbers
// (e.g. snapYaw(3π + 0.05) = 3π) so _viewRotationAngle stays continuous
// after a release.
export function snapYaw(yaw) {
  const step = Math.PI / 2;
  return Math.round(yaw / step) * step;
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
