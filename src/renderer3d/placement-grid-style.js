// Visual contract for the placement grid. Kept separate from ThreeRenderer so
// the falloff and dotted-line geometry stay deterministic and headlessly
// testable across both renderer backends.

const TILE_SIZE_WORLD = 2;

export const PLACEMENT_GRID_STYLE = Object.freeze({
  radiusTiles: 1.5,
  colorHex: 0x88ccff,
  majorDotSpacingWorld: 0.25,
  majorDotLengthWorld: 0.06,
  subgridDotSpacingWorld: 0.25,
  subgridDotLengthWorld: 0.025,
  fadeInnerRadiusWorld: 0.25,
  majorOpacityNear: 0.68,
  majorOpacityFar: 0.02,
  subgridOpacityNear: 0.26,
  subgridOpacityFar: 0.006,
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/** Smooth cubic interpolation with zero slope at both ends. */
function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/**
 * Opacity at a world-space point around the cursor tile centre.
 *
 * Chebyshev distance follows the square grid footprint: every point on the
 * outer border reaches the quietest opacity, avoiding a visible hard edge at
 * the midpoint of that border while alpha still interpolates along segments.
 */
export function placementGridAlphaAt(kind, x, z, cursorCenterX, cursorCenterZ) {
  const style = PLACEMENT_GRID_STYLE;
  const outerRadius = style.radiusTiles * TILE_SIZE_WORLD;
  const distance = Math.max(
    Math.abs(x - cursorCenterX),
    Math.abs(z - cursorCenterZ),
  );
  const fadeRange = outerRadius - style.fadeInnerRadiusWorld;
  const progress = smoothstep01((distance - style.fadeInnerRadiusWorld) / fadeRange);
  const isMajor = kind === 'major';
  const near = isMajor ? style.majorOpacityNear : style.subgridOpacityNear;
  const far = isMajor ? style.majorOpacityFar : style.subgridOpacityFar;
  return near + (far - near) * progress;
}

/**
 * Append evenly spaced, short linelets for one section of a dotted grid line.
 * `patternOffsetWorld` keeps the cadence continuous when a terrain-draped line
 * is split at a tile's triangle fold.
 */
export function appendPlacementGridDots(
  buffers,
  start,
  end,
  {
    spacing,
    dotLength,
    patternOffsetWorld = 0,
    startAlpha = 1,
    endAlpha = 1,
  },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const horizontalLength = Math.hypot(dx, dz);
  if (horizontalLength === 0 || spacing <= 0 || dotLength <= 0) return;

  const halfDot = Math.min(dotLength, spacing) / 2;
  const patternStart = patternOffsetWorld;
  const patternEnd = patternStart + horizontalLength;
  const firstDot = Math.ceil((patternStart - halfDot) / spacing);
  const lastDot = Math.floor((patternEnd + halfDot) / spacing);

  for (let dot = firstDot; dot <= lastDot; dot++) {
    const center = dot * spacing;
    const clippedStart = Math.max(patternStart, center - halfDot);
    const clippedEnd = Math.min(patternEnd, center + halfDot);
    if (clippedEnd - clippedStart <= 1e-9) continue;

    const t0 = (clippedStart - patternStart) / horizontalLength;
    const t1 = (clippedEnd - patternStart) / horizontalLength;
    const alpha0 = startAlpha + (endAlpha - startAlpha) * t0;
    const alpha1 = startAlpha + (endAlpha - startAlpha) * t1;
    buffers.positions.push(
      start.x + dx * t0, start.y + dy * t0, start.z + dz * t0,
      start.x + dx * t1, start.y + dy * t1, start.z + dz * t1,
    );
    buffers.colors.push(
      1, 1, 1, alpha0,
      1, 1, 1, alpha1,
    );
  }
}
