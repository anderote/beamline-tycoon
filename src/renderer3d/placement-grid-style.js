// Visual contract for the placement grid. Kept separate from ThreeRenderer so
// the falloff and line-weight geometry stay deterministic and headlessly
// testable across both renderer backends.

const TILE_SIZE_WORLD = 2;

export const PLACEMENT_GRID_STYLE = Object.freeze({
  radiusTiles: 1.5,
  majorLineWidthWorld: 0.1,
  fadeInnerRadiusWorld: 0.25,
  majorOpacityNear: 0.62,
  majorOpacityFar: 0.025,
  subgridOpacityNear: 0.20,
  subgridOpacityFar: 0.008,
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
 * Append a horizontal ribbon for one major grid-line segment. Unlike WebGL
 * lineWidth, this produces a dependable visible width on every backend.
 */
export function appendPlacementGridRibbon(
  buffers,
  start,
  end,
  width,
  startAlpha,
  endAlpha,
) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length === 0 || width <= 0) return;

  const halfWidth = width / 2;
  const offsetX = (-dz / length) * halfWidth;
  const offsetZ = (dx / length) * halfWidth;
  const base = buffers.positions.length / 3;

  buffers.positions.push(
    start.x + offsetX, start.y, start.z + offsetZ,
    start.x - offsetX, start.y, start.z - offsetZ,
    end.x + offsetX, end.y, end.z + offsetZ,
    end.x - offsetX, end.y, end.z - offsetZ,
  );
  buffers.colors.push(
    1, 1, 1, startAlpha,
    1, 1, 1, startAlpha,
    1, 1, 1, endAlpha,
    1, 1, 1, endAlpha,
  );
  buffers.indices.push(
    base, base + 1, base + 2,
    base + 2, base + 1, base + 3,
  );
}
