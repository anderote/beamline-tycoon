// Dependency-neutral tuning and persistence contract for the camera's
// screen-space tilt-shift effect.

export const TILT_SHIFT_STORAGE_KEY = 'beamlineTycoon.tiltShift';

export const DEFAULT_TILT_SHIFT_SETTINGS = Object.freeze({
  enabled: false,
  strength: 1.2,
  focus: 0.52,
  band: 0.28,
});

const LIMITS = Object.freeze({
  strength: [0.25, 2.5],
  focus: [0, 1],
  band: [0.08, 0.7],
});

function boundedNumber(value, fallback, [min, max]) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function normalizeTiltShiftSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    enabled: source.enabled === true,
    strength: boundedNumber(
      source.strength,
      DEFAULT_TILT_SHIFT_SETTINGS.strength,
      LIMITS.strength,
    ),
    focus: boundedNumber(source.focus, DEFAULT_TILT_SHIFT_SETTINGS.focus, LIMITS.focus),
    band: boundedNumber(source.band, DEFAULT_TILT_SHIFT_SETTINGS.band, LIMITS.band),
  };
}

export function parseTiltShiftSettings(raw) {
  if (!raw) return { ...DEFAULT_TILT_SHIFT_SETTINGS };
  try {
    return normalizeTiltShiftSettings(JSON.parse(raw));
  } catch (_) {
    return { ...DEFAULT_TILT_SHIFT_SETTINGS };
  }
}
