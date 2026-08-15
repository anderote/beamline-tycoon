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
