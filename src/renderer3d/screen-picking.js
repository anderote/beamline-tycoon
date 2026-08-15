// Small, screen-space tolerance for mesh picking.
//
// A Three.js mesh ray has zero width. That is technically precise but feels
// unforgiving on thin rails, legs, fittings, and small decorations. These
// samples form three increasingly-wide rings around the pointer. The exact
// ray always wins; the rings are only consulted after it misses.

const DIAGONAL = Math.SQRT1_2;

const SAMPLE_RINGS = [
  [
    [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5],
  ],
  [
    [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5],
  ],
  [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-DIAGONAL, -DIAGONAL], [DIAGONAL, -DIAGONAL],
    [-DIAGONAL, DIAGONAL], [DIAGONAL, DIAGONAL],
  ],
];

/**
 * Whether a raycast intersection belongs to geometry that is actually drawn.
 *
 * Three.js still reports intersections for meshes whose material is hidden.
 * We use those meshes as broad construction proxies in a few builders, but
 * letting them participate in normal picking makes their projected top and
 * side faces selectable well beyond the visible model in an isometric view.
 */
export function isVisiblePickObject(object) {
  if (!object) return false;

  // A hidden ancestor also makes the mesh absent from the rendered scene.
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
  }

  const materials = Array.isArray(object.material)
    ? object.material
    : (object.material ? [object.material] : []);
  return materials.length === 0 || materials.some(material => material?.visible !== false);
}

/**
 * Run an exact screen pick, then retry within `tolerancePx` if it missed.
 * The nearest sample ring wins; hits within a ring are ordered by camera
 * distance so overlapping objects retain normal front-to-back behavior.
 *
 * `castAt` receives client-space pixels and returns a raycast hit or null.
 */
export function pickWithScreenTolerance(screenX, screenY, tolerancePx, castAt) {
  const exact = castAt(screenX, screenY);
  if (exact || !(tolerancePx > 0)) return exact || null;

  for (const ring of SAMPLE_RINGS) {
    let best = null;
    for (const [ux, uy] of ring) {
      const hit = castAt(
        screenX + ux * tolerancePx,
        screenY + uy * tolerancePx,
      );
      if (!hit) continue;
      if (!best || (hit.distance ?? Infinity) < (best.distance ?? Infinity)) {
        best = hit;
      }
    }
    if (best) return best;
  }

  return null;
}
