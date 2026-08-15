import { WebGPURenderer } from 'three/webgpu';
import { PackedDynamicLighting } from './lighting/packed-dynamic-lighting.js';

export const RENDERER_MODE_STORAGE_KEY = 'beamlineTycoon.renderer';

const MANY_LIGHT_LIMITS = Object.freeze({
  maxDirectionalLights: 4,
  maxPointLights: 128,
  maxSpotLights: 128,
  maxHemisphereLights: 2,
});

function requestedRendererMode(location = globalThis.location, storage = globalThis.localStorage) {
  let queryMode = null;
  try { queryMode = new URLSearchParams(location?.search || '').get('renderer'); } catch (_) {}
  if (queryMode === 'legacy' || queryMode === 'webgl') return 'legacy';
  if (queryMode === 'webgpu' || queryMode === 'modern') return 'modern';

  let storedMode = null;
  try { storedMode = storage?.getItem(RENDERER_MODE_STORAGE_KEY); } catch (_) {}
  return storedMode === 'legacy' || storedMode === 'webgl' ? 'legacy' : 'modern';
}

function modernCapabilities(renderer) {
  const limits = renderer.backend?.device?.limits;
  if (limits) {
    return {
      maxTextureSize: Number(limits.maxTextureDimension2D) || 8192,
      maxTextures: Number(limits.maxSampledTexturesPerShaderStage) || 16,
    };
  }

  // WebGPURenderer's automatic WebGL2 fallback deliberately does not expose
  // WebGLRenderer.capabilities. Query its context when available, otherwise
  // use conservative WebGL2 guarantees.
  const gl = renderer.getContext?.();
  return {
    maxTextureSize: gl?.getParameter?.(gl.MAX_TEXTURE_SIZE) || 4096,
    maxTextures: gl?.getParameter?.(gl.MAX_TEXTURE_IMAGE_UNITS) || 16,
  };
}

async function createNodeRenderer(options, { forceWebGL = false } = {}) {
  const renderer = new WebGPURenderer({ ...options, forceWebGL });
  renderer.lighting = new PackedDynamicLighting(MANY_LIGHT_LIMITS);
  await renderer.init();
  return renderer;
}

/**
 * Create the world renderer. The modern renderer uses WebGPU when available
 * and Three's WebGL2 node-renderer backend otherwise. `?renderer=legacy`
 * remains an instant, reload-only escape hatch while the migration settles.
 */
export async function createWorldRenderer(options = {}) {
  const requestedMode = requestedRendererMode();
  if (requestedMode === 'legacy') {
    // The rollback keeps the node/TSL material graph but forces its proven
    // WebGL 2 backend. Reverting all the way to WebGLRenderer would make the
    // migrated TSL materials and packed-light data unreadable.
    const renderer = await createNodeRenderer(options, { forceWebGL: true });
    return {
      renderer,
      mode: 'modern',
      requestedMode: 'legacy',
      backend: 'webgl2',
      capabilities: modernCapabilities(renderer),
    };
  }

  try {
    const renderer = await createNodeRenderer(options);
    const backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
    return {
      renderer,
      mode: 'modern',
      backend,
      capabilities: modernCapabilities(renderer),
    };
  } catch (error) {
    // A failed adapter/device request must not make a saved game unplayable.
    // Keep the same scene/material graph and retry on the WebGL 2 backend.
    console.warn('[Renderer] WebGPU backend failed; using node WebGL 2.', error);
    const renderer = await createNodeRenderer(options, { forceWebGL: true });
    return {
      renderer,
      mode: 'modern',
      requestedMode: 'fallback',
      backend: 'webgl2',
      fallbackError: error,
      capabilities: modernCapabilities(renderer),
    };
  }
}

export { MANY_LIGHT_LIMITS, requestedRendererMode };
