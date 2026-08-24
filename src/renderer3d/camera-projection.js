// Pure projection math shared by the camera coordinator and its tests.

export const CAMERA_PROJECTION_ISOMETRIC = 'isometric';
export const CAMERA_PROJECTION_PERSPECTIVE = 'perspective';
export const PERSPECTIVE_FOV_DEGREES = 35;

export function normalizeCameraProjection(value) {
  return value === CAMERA_PROJECTION_PERSPECTIVE
    ? CAMERA_PROJECTION_PERSPECTIVE
    : CAMERA_PROJECTION_ISOMETRIC;
}

/** Distance needed for a perspective camera to frame `viewHeight` at target. */
export function perspectiveDistanceForViewHeight(
  viewHeight,
  fovDegrees = PERSPECTIVE_FOV_DEGREES,
) {
  const safeHeight = Math.max(0.001, Number(viewHeight) || 0.001);
  const safeFov = Math.max(1, Math.min(179, Number(fovDegrees) || PERSPECTIVE_FOV_DEGREES));
  return safeHeight / (2 * Math.tan((safeFov * Math.PI) / 360));
}
