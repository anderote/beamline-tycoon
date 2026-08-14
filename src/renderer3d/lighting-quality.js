// Immutable lighting budgets. Runtime preset changes only park pooled effects
// or alter their refresh cadence; they never change shader light topology.

export const MAX_FIXTURE_SHADOWS = 6;
export const MAX_VOLUMETRIC_BEAMS = 6;

const PRESETS = {
  low: {
    fixtureShadowCount: 0,
    fixtureShadowMapSize: 512,
    fixtureShadowHz: 0,
    sunShadowMapSize: 1024,
    sunShadowHz: 6,
    glowScale: 0.25,
    softGlow: false,
    volumetricCount: 0,
  },
  medium: {
    fixtureShadowCount: 2,
    fixtureShadowMapSize: 512,
    fixtureShadowHz: 10,
    sunShadowMapSize: 2048,
    sunShadowHz: 10,
    glowScale: 0.35,
    softGlow: true,
    volumetricCount: 1,
  },
  high: {
    fixtureShadowCount: 4,
    fixtureShadowMapSize: 1024,
    fixtureShadowHz: 15,
    sunShadowMapSize: 4096,
    sunShadowHz: 15,
    glowScale: 0.5,
    softGlow: true,
    volumetricCount: 3,
  },
  ultra: {
    fixtureShadowCount: 6,
    fixtureShadowMapSize: 1024,
    fixtureShadowHz: 30,
    sunShadowMapSize: 4096,
    sunShadowHz: 30,
    glowScale: 0.5,
    softGlow: true,
    volumetricCount: 6,
  },
};

export const LIGHTING_QUALITY_PRESETS = Object.freeze(Object.fromEntries(
  Object.entries(PRESETS).map(([name, value]) => [name, Object.freeze({ name, ...value })]),
));

export const LIGHTING_QUALITY_NAMES = Object.freeze(['auto', 'low', 'medium', 'high', 'ultra']);

export function normalizeLightingQuality(value) {
  const key = String(value || '').toLowerCase();
  return LIGHTING_QUALITY_NAMES.includes(key) ? key : 'auto';
}

/** Pick an initial automatic tier without later overriding an explicit choice. */
export function autoLightingQuality(capabilities = {}) {
  const cores = Number(capabilities.hardwareConcurrency) || 4;
  const memory = Number(capabilities.deviceMemory) || 4;
  const maxTextureSize = Number(capabilities.maxTextureSize) || 4096;
  if (cores <= 2 || memory <= 2 || maxTextureSize < 4096) return 'low';
  if (cores <= 4 || memory <= 4) return 'medium';
  if (cores >= 12 && memory >= 8 && maxTextureSize >= 8192) return 'ultra';
  return 'high';
}

export function resolveLightingQuality(value, capabilities = {}) {
  const requested = normalizeLightingQuality(value);
  const resolvedName = requested === 'auto' ? autoLightingQuality(capabilities) : requested;
  return Object.freeze({ ...LIGHTING_QUALITY_PRESETS[resolvedName], requested });
}

