// Immutable lighting budgets. Runtime preset changes only park pooled effects
// or alter their refresh cadence; they never change shader light topology.

// Modern renderer budgets: up to 64 real analytic fixture lights are kept in
// DynamicLighting's uniform buffers. The nearest twenty-four also receive cached
// shadow maps; the rest still light every PBR surface but avoid a shadow-map
// render and sampler each. Legacy WebGL derives a lower shadow cap below.
export const MAX_FIXTURE_LIGHTS = 64;
export const MAX_FIXTURE_SHADOWS = 24;
export const MAX_VOLUMETRIC_BEAMS = 8;

// On the legacy renderer every fixed fixture SpotLight contributes two
// fragment-shader samplers:
// one for its cookie and one for its shadow map. The sun contributes another
// shadow sampler, and ordinary materials still need room for their own maps.
// WebGL implementations commonly expose only 16 fragment texture units, so
// allocating all eight fixture slots unconditionally can make every lit
// material's shader fail validation before a fixture is even placed.
export const MATERIAL_TEXTURE_UNIT_RESERVE = 5;
export const SUN_SHADOW_TEXTURE_UNITS = 1;
export const FIXTURE_TEXTURE_UNITS = 2;

/**
 * Bound the immutable fixture-light topology to the GPU's fragment sampler
 * budget. The modern renderer instead packs all fixture shadows into one
 * depth-array binding. The returned count is fixed when the legacy renderer is constructed, so
 * runtime quality changes still park lights without recompiling shaders.
 */
export function fixtureShadowTopologyLimit(maxTextureUnits) {
  const reported = Number(maxTextureUnits);
  const total = Number.isFinite(reported) && reported > 0 ? reported : 16;
  const available = total - MATERIAL_TEXTURE_UNIT_RESERVE - SUN_SHADOW_TEXTURE_UNITS;
  return Math.max(0, Math.min(MAX_FIXTURE_SHADOWS, Math.floor(available / FIXTURE_TEXTURE_UNITS)));
}

const PRESETS = {
  low: {
    fixtureLightCount: 16,
    fixtureShadowCount: 0,
    fixtureShadowMapSize: 512,
    fixtureShadowHz: 0,
    fixtureShadowUpdatesPerFrame: 1,
    sunShadowMapSize: 1024,
    sunShadowHz: 6,
    glowScale: 0.25,
    softGlow: false,
    effectPulseCount: 128,
    volumetricCount: 0,
  },
  medium: {
    fixtureLightCount: 32,
    fixtureShadowCount: 6,
    fixtureShadowMapSize: 512,
    fixtureShadowHz: 10,
    fixtureShadowUpdatesPerFrame: 1,
    sunShadowMapSize: 2048,
    sunShadowHz: 10,
    glowScale: 0.35,
    softGlow: true,
    effectPulseCount: 256,
    volumetricCount: 1,
  },
  high: {
    fixtureLightCount: 48,
    fixtureShadowCount: 12,
    fixtureShadowMapSize: 768,
    fixtureShadowHz: 15,
    fixtureShadowUpdatesPerFrame: 2,
    sunShadowMapSize: 4096,
    sunShadowHz: 15,
    glowScale: 0.5,
    softGlow: true,
    effectPulseCount: 384,
    volumetricCount: 3,
  },
  ultra: {
    fixtureLightCount: 64,
    fixtureShadowCount: 24,
    fixtureShadowMapSize: 1024,
    fixtureShadowHz: 15,
    fixtureShadowUpdatesPerFrame: 1,
    sunShadowMapSize: 4096,
    sunShadowHz: 30,
    glowScale: 0.5,
    softGlow: true,
    effectPulseCount: 512,
    volumetricCount: 8,
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
