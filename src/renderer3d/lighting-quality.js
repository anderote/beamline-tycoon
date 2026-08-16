// Immutable lighting budgets. Runtime preset changes only park pooled effects
// or alter their refresh cadence; they never change shader light topology.

// Modern renderer budgets: up to 64 real analytic fixture lights are kept in
// DynamicLighting's uniform buffers. The nearest twelve also receive cached
// shadow maps; the rest still light every PBR surface but avoid a shadow-map
// render and sampler each. Legacy WebGL derives a lower shadow cap below.
//
// Keep this topology deliberately modest. WebGPU allocates the shared fixture
// depth array at the full topology depth before any fixtures exist. At the old
// 24 x 1024 budget that one idle texture consumed 96 MiB. Together with the
// built-in sun target's colour + depth textures, a fresh empty map reserved
// 224 MiB for shadows alone, leaving Chromium's GPU process little headroom
// when the browser, OS, or driver comes under additional graphics pressure.
export const MAX_FIXTURE_LIGHTS = 64;
export const MAX_FIXTURE_SHADOWS = 12;
export const MAX_DYNAMIC_POINT_LIGHTS = 32;
export const DYNAMIC_POINT_LIGHT_FLASH_RESERVE = 2;
export const MAX_VOLUMETRIC_BEAMS = 8;
export const MAX_SHADOW_TEXTURE_BUDGET_BYTES = 64 * 1024 * 1024;

/** Worst-case persistent shadow texture bytes for the modern renderer.
 * Fixture shadows use one 32-bit depth-array layer per topology slot. Three's
 * directional ShadowNode currently keeps both a 32-bit colour attachment and
 * a 32-bit depth attachment, so the sun costs eight bytes per texel. */
export function estimateShadowTextureBytes(quality) {
  const fixtureSize = Math.max(1, Math.floor(quality?.fixtureShadowMapSize || 1));
  const sunSize = Math.max(1, Math.floor(quality?.sunShadowMapSize || 1));
  return MAX_FIXTURE_SHADOWS * fixtureSize * fixtureSize * 4
    + sunSize * sunSize * 8;
}

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
    contactAOStrength: 0,
    contactAOSamples: 4,
    contactAOScale: 0.25,
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
    contactAOStrength: 0.48,
    contactAOSamples: 6,
    contactAOScale: 0.3,
  },
  high: {
    fixtureLightCount: 48,
    fixtureShadowCount: 12,
    fixtureShadowMapSize: 768,
    fixtureShadowHz: 15,
    fixtureShadowUpdatesPerFrame: 2,
    sunShadowMapSize: 2048,
    sunShadowHz: 15,
    glowScale: 0.5,
    softGlow: true,
    effectPulseCount: 384,
    volumetricCount: 3,
    contactAOStrength: 0.65,
    contactAOSamples: 8,
    contactAOScale: 0.4,
  },
  ultra: {
    fixtureLightCount: 64,
    fixtureShadowCount: 12,
    fixtureShadowMapSize: 768,
    fixtureShadowHz: 15,
    fixtureShadowUpdatesPerFrame: 1,
    sunShadowMapSize: 2048,
    sunShadowHz: 30,
    glowScale: 0.5,
    softGlow: true,
    effectPulseCount: 512,
    volumetricCount: 8,
    contactAOStrength: 0.72,
    contactAOSamples: 12,
    contactAOScale: 0.5,
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
  // The node renderer's WebGL2 backend includes software/compatibility paths
  // where reported CPU and texture limits substantially overstate practical
  // post-processing throughput. Keep Auto conservative; explicit High/Ultra
  // remain available in Options for strong discrete GPUs.
  if (capabilities.backend === 'webgl2') return cores <= 2 || memory <= 2 ? 'low' : 'medium';
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
