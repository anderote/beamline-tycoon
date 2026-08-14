// src/renderer3d/day-night.js
//
// Pure day/night lighting grade. No Three.js imports on purpose — ThreeRenderer
// cannot be loaded in Node (THREE is a CDN global there), and this is the one
// piece of the sun-cycle math most likely to be retuned by eye, so it lives on
// its own where `node test/test-day-night-grade.js` can exercise it directly.
//
// ThreeRenderer._updateSunCycle calls dayNightGrade(timeOfDay) once per frame
// and assigns the result to the sun, moon and ambient lights. Everything here
// is numbers/arrays in, numbers/arrays out.
//
// timeOfDay: 0 = midnight, 0.5 = noon (see game/Game.js, DAY_LENGTH_TICKS /
// isNightAt). `darkness` (0 = full day, 1 = deep night) is the one quantity
// every later consumer (fixture emissive, light pools, real point lights)
// reads to stay in lockstep — see design doc §2/§3.

// ---------------------------------------------------------------------------
// Taste knobs. Everything below derives from these; retune by eye.
// ---------------------------------------------------------------------------

// Ambient intensity at deep night. Never 0 — geometry must keep legible form
// at midnight, not go flat black. (Day value, 1.3, matches the intensity the
// renderer used to pin unconditionally.)
export const NIGHT_AMBIENT = 0.35;
const DAY_AMBIENT = 1.3;

// Deep blue-purple the ambient (and, faintly, the sun) colour approaches as
// darkness -> 1. The old code stopped at a soft (0.4, 0.45, 0.6); this
// deepens it — cool blue ambient against warm fixture pools is what sells
// the whole feature (design doc §2).
export const NIGHT_TINT = [0.22, 0.27, 0.48];

// Warm colour at the day/night boundary (dusk/dawn) — this is the "existing
// warm-to-blue shift" the old code produced as the sun neared the horizon,
// kept here as an explicit waypoint instead of a side effect of a cosine.
const AMBIENT_DUSK_COLOR = [0.95, 0.9, 0.8];
const SUN_DUSK_COLOR = [1, 0.9, 0.75];

// Full daylight colour (noon), shared by ambient and sun — matches both of
// the old per-light formulas at dayness = 1.
const DAY_COLOR = [1, 1, 1];

// Sun directional-light intensity range. Falls all the way to 0 at night
// (the old code floored it at 0.8); the moon below stands in for it so the
// scene never goes black.
const SUN_DAY_INTENSITY = 1.8;

// Moon: a weak, cool-blue stand-in light for when the sun is down, so
// midnight has some directionality and geometry keeps its form.
export const MOON_MAX_INTENSITY = 0.25;
export const MOON_COLOR = [0.55, 0.65, 0.95];

// Half-width, in "distance from noon" units (see noonDistance below), of the
// dusk/dawn ease. The transition is centred on noonDistance = 0.25, which is
// exactly the day/night boundary isNightAt (Game.js) uses (timeOfDay 0.25 /
// 0.75) — so the visual dusk/dawn lines up with the sim's own night phase.
const TWILIGHT_HALF_WIDTH = 0.08;

// ---------------------------------------------------------------------------

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Circular distance from noon (0.5), in [0, 0.5]. 0 at noon, 0.5 at
// midnight, increasing monotonically as timeOfDay moves away from noon in
// either direction. No wraparound needed: timeOfDay is always in [0, 1), so
// |timeOfDay - 0.5| never exceeds 0.5.
function noonDistance(timeOfDay) {
  return Math.abs(timeOfDay - 0.5);
}

// White at noon -> duskColor at the day/night boundary -> NIGHT_TINT at
// midnight, each half eased. Shared shape for ambient and sun; only the
// dusk waypoint differs, matching how warm each one got in the old formulas.
function colorRamp(d, duskColor) {
  if (d <= 0.25) {
    return lerpColor(DAY_COLOR, duskColor, smoothstep(0, 0.25, d));
  }
  return lerpColor(duskColor, NIGHT_TINT, smoothstep(0.25, 0.5, d));
}

/**
 * Pure day/night lighting grade.
 *
 * @param {number} timeOfDay - [0, 1), 0 = midnight, 0.5 = noon.
 * @returns {{
 *   darkness: number,
 *   ambientIntensity: number,
 *   ambientColor: [number, number, number],
 *   sunIntensity: number,
 *   sunColor: [number, number, number],
 *   moonIntensity: number,
 * }}
 */
export function dayNightGrade(timeOfDay) {
  const d = noonDistance(timeOfDay);

  // Eased 0 -> 1 across the twilight band straddling the day/night boundary:
  // flat 0 through most of the day, flat 1 through most of the night, smooth
  // (not switched) in between. This is what makes dusk/dawn read as a
  // transition instead of a dimmer knob being turned.
  const darkness = smoothstep(
    0.25 - TWILIGHT_HALF_WIDTH,
    0.25 + TWILIGHT_HALF_WIDTH,
    d
  );

  const ambientIntensity = lerp(DAY_AMBIENT, NIGHT_AMBIENT, darkness);
  const ambientColor = colorRamp(d, AMBIENT_DUSK_COLOR);

  const sunIntensity = SUN_DAY_INTENSITY * (1 - darkness);
  const sunColor = colorRamp(d, SUN_DUSK_COLOR);

  const moonIntensity = MOON_MAX_INTENSITY * darkness;

  return {
    darkness,
    ambientIntensity,
    ambientColor,
    sunIntensity,
    sunColor,
    moonIntensity,
  };
}
