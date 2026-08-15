// Pure math shared by renderer effects. No THREE dependency so path motion,
// budgets and phase continuity stay unit-testable without WebGL.

export function positiveModulo(value, divisor) {
  if (!Number.isFinite(divisor) || divisor <= 0) return 0;
  return ((value % divisor) + divisor) % divisor;
}

/** Build an immutable-enough path record from Vector3-like points. */
export function prepareEffectPath(points) {
  const clean = [];
  for (const p of points || []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    const prev = clean[clean.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) < 1e-6) continue;
    clean.push({ x: p.x, y: p.y, z: p.z });
  }
  const cumulative = [0];
  for (let i = 1; i < clean.length; i++) {
    const a = clean[i - 1], b = clean[i];
    cumulative.push(cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return { points: clean, cumulative, length: cumulative[cumulative.length - 1] || 0 };
}

/** Sample a prepared polyline at absolute distance, clamped to its ends. */
export function sampleEffectPath(path, distance, out = {}) {
  if (!path?.points?.length) return null;
  if (path.points.length === 1 || path.length <= 0) return Object.assign(out, path.points[0]);
  const d = Math.max(0, Math.min(path.length, Number(distance) || 0));
  let hi = 1;
  while (hi < path.cumulative.length && path.cumulative[hi] < d) hi++;
  hi = Math.min(hi, path.points.length - 1);
  const lo = hi - 1;
  const start = path.cumulative[lo];
  const span = path.cumulative[hi] - start;
  const t = span > 0 ? (d - start) / span : 0;
  const a = path.points[lo], b = path.points[hi];
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

/**
 * Distances of travelling crests currently present on a path. Matches the
 * utility shader's `mod(distance - time * speed, period) == 0` convention.
 */
export function travellingPulseDistances(pathLength, period, speed, timeSeconds, phase = 0) {
  const length = Math.max(0, Number(pathLength) || 0);
  const spacing = Math.max(0.05, Number(period) || 0);
  if (length <= 0) return [];
  const first = positiveModulo((Number(timeSeconds) || 0) * (Number(speed) || 0) + phase, spacing);
  const result = [];
  for (let d = first; d <= length + 1e-6; d += spacing) result.push(Math.min(d, length));
  // Short paths would otherwise go empty while the next crest is outside.
  // Wrap that single crest over the path length so every live run communicates
  // flow continuously without changing the period on longer runs.
  if (!result.length) result.push(positiveModulo(first, length));
  return result;
}

function hashUnit(value) {
  const text = String(value ?? 'effect');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/** Deterministic per-machine emissive modulation. Presentation only. */
export function surfaceGlowFactor(profile, id, timeSeconds, state = 'on') {
  if (state === 'off' || state === 'hard') return 0.06;
  const t = Math.max(0, Number(timeSeconds) || 0);
  const phase = hashUnit(id) * Math.PI * 2;
  switch (profile) {
    case 'statusBlink': {
      const cycle = positiveModulo(t + hashUnit(id) * 1.7, 2.4);
      return cycle < 0.12 || (cycle > 0.22 && cycle < 0.3) ? 1.25 : 0.72;
    }
    case 'screen':
      return 0.9 + 0.1 * Math.sin(t * 2.1 + phase)
        + 0.025 * Math.sin(t * 17.3 + phase * 3);
    case 'arc':
      return 0.88 + 0.09 * Math.sin(t * 23 + phase)
        + 0.05 * Math.sin(t * 41 + phase * 2.7);
    default:
      return 1;
  }
}
