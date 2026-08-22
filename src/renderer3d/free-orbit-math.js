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
// A slightly steeper construction view: more of each machine's top face is
// visible while retaining the diagonal, isometric-style presentation.
export const PITCH_STEEP = (40 * Math.PI) / 180;
// Top-down view sits just below π/2 to avoid the lookAt(up=+Y) gimbal
// degeneracy. cos(89°) ≈ 0.0175, nonzero, so the look direction stays
// well-defined and yaw remains meaningful.
export const PITCH_TOP = (89 * Math.PI) / 180;
export const PITCH_MIN = (2 * Math.PI) / 180;
// Free-orbit drag can now reach top-down so MMB-release can snap into the
// the nearest of the three preferred pitches.
export const PITCH_MAX = PITCH_TOP;

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

// Yaw step/division count for rest facings. Both view modes (iso and
// top-down) snap to 8 cardinal+intercardinal facings (45° apart) — iso used
// to be limited to 4 cardinal-only facings, but the geometry supports the
// same 8-way snapping the top-down view already had, so there is no longer a
// per-mode distinction here.
export const YAW_STEP = Math.PI / 4;
export const YAW_DIVISIONS = 8;

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
// the pitch at release time. This keeps the release behavior useful around
// the new in-between preferred angle as well as at the two existing extremes.
export function pickSnapMode(pitch) {
  const modes = [
    ['iso', PITCH_REST],
    ['steep', PITCH_STEEP],
    ['top', PITCH_TOP],
  ];
  return modes.reduce((closest, candidate) =>
    Math.abs(candidate[1] - pitch) < Math.abs(closest[1] - pitch) ? candidate : closest
  )[0];
}

export function targetPitchForMode(mode) {
  if (mode === 'top') return PITCH_TOP;
  if (mode === 'steep') return PITCH_STEEP;
  return PITCH_REST;
}

/** Cycle through the preferred camera elevations without changing heading. */
export function toggledViewMode(mode) {
  if (mode === 'iso') return 'steep';
  if (mode === 'steep') return 'top';
  return 'iso';
}
