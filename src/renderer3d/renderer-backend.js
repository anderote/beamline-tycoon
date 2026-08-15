import { WebGPURenderer } from 'three/webgpu';
import { PackedDynamicLighting } from './lighting/packed-dynamic-lighting.js';

export const RENDERER_MODE_STORAGE_KEY = 'beamlineTycoon.renderer';
export const RENDERER_RECOVERY_MODE_STORAGE_KEY = 'beamlineTycoon.rendererRecovery';
export const RENDERER_RECOVERY_RELOAD_AT_STORAGE_KEY = 'beamlineTycoon.rendererRecoveryReloadAt';
export const RENDERER_RECOVERY_COOLDOWN_MS = 5 * 60_000;

const MANY_LIGHT_LIMITS = Object.freeze({
  maxDirectionalLights: 4,
  maxPointLights: 128,
  maxSpotLights: 128,
  maxHemisphereLights: 2,
});

function readStorage(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch (_) { return null; }
}

function writeStorage(storage, key, value) {
  try { storage?.setItem(key, value); } catch (_) {}
}

function removeStorage(storage, key) {
  try { storage?.removeItem(key); } catch (_) {}
}

function requestedRendererMode(
  location = globalThis.location,
  storage = globalThis.localStorage,
  recoveryStorage = globalThis.sessionStorage,
) {
  let queryMode = null;
  try { queryMode = new URLSearchParams(location?.search || '').get('renderer'); } catch (_) {}
  if (queryMode === 'legacy' || queryMode === 'webgl') return 'legacy';
  if (queryMode === 'webgpu' || queryMode === 'modern') return 'modern';

  const recoveryMode = readStorage(recoveryStorage, RENDERER_RECOVERY_MODE_STORAGE_KEY);
  if (recoveryMode === 'legacy' || recoveryMode === 'webgl') return 'legacy';

  const storedMode = readStorage(storage, RENDERER_MODE_STORAGE_KEY);
  return storedMode === 'legacy' || storedMode === 'webgl' ? 'legacy' : 'modern';
}

/**
 * Build the one-shot callback used when Three reports a device/context loss.
 * The first loss saves live game state and reloads so WebGPU gets a fresh
 * adapter/device and every GPU resource is rebuilt. If that replacement dies
 * during the cooldown, the second reload pins this tab to WebGL 2. A loss on
 * the fallback backend is surfaced to the UI instead of creating a loop.
 */
export function createRendererRecovery({
  sessionStorage = globalThis.sessionStorage,
  location = globalThis.location,
  save = null,
  onReloadSuppressed = null,
  now = () => Date.now(),
  defer = (callback) => globalThis.setTimeout(callback, 0),
  cooldownMs = RENDERER_RECOVERY_COOLDOWN_MS,
} = {}) {
  let handled = false;

  return (info = {}) => {
    if (handled) return { reloaded: false, reason: 'already-handled' };
    handled = true;

    try { save?.(); } catch (_) {}

    const timestamp = Number(now()) || Date.now();
    const previousReloadAt = Number(readStorage(
      sessionStorage,
      RENDERER_RECOVERY_RELOAD_AT_STORAGE_KEY,
    )) || 0;
    const recoveryMode = readStorage(sessionStorage, RENDERER_RECOVERY_MODE_STORAGE_KEY);
    const recoveringRecently = previousReloadAt > 0
      && timestamp - previousReloadAt < cooldownMs;

    if (recoveringRecently && recoveryMode === 'legacy') {
      try { onReloadSuppressed?.(info); } catch (_) {}
      return { reloaded: false, reason: 'cooldown' };
    }

    if (recoveringRecently) {
      writeStorage(sessionStorage, RENDERER_RECOVERY_MODE_STORAGE_KEY, 'legacy');
      writeStorage(sessionStorage, RENDERER_RECOVERY_RELOAD_AT_STORAGE_KEY, String(timestamp));
      defer(() => location?.reload?.());
      return { reloaded: true, reason: 'fallback-webgl' };
    }

    // A stale fallback should not permanently exile this tab from WebGPU.
    // Its next device-loss recovery gets one fresh native attempt again.
    removeStorage(sessionStorage, RENDERER_RECOVERY_MODE_STORAGE_KEY);
    writeStorage(sessionStorage, RENDERER_RECOVERY_RELOAD_AT_STORAGE_KEY, String(timestamp));

    defer(() => location?.reload?.());
    return { reloaded: true, reason: 'retry-webgpu' };
  };
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

async function createNodeRenderer(options, { forceWebGL = false, onDeviceLost = null } = {}) {
  const renderer = new WebGPURenderer({ ...options, forceWebGL });
  if (onDeviceLost) {
    const reportDeviceLost = renderer.onDeviceLost.bind(renderer);
    renderer.onDeviceLost = (info) => {
      reportDeviceLost(info);
      onDeviceLost(info);
    };
  }
  renderer.lighting = new PackedDynamicLighting(MANY_LIGHT_LIMITS);
  await renderer.init();
  return renderer;
}

/**
 * Create the world renderer. The modern renderer uses WebGPU when available
 * and Three's WebGL2 node-renderer backend otherwise. `?renderer=legacy`
 * remains an instant, reload-only escape hatch while the migration settles.
 */
export async function createWorldRenderer(options = {}, { onDeviceLost = null } = {}) {
  const requestedMode = requestedRendererMode();
  if (requestedMode === 'legacy') {
    // The rollback keeps the node/TSL material graph but forces its proven
    // WebGL 2 backend. Reverting all the way to WebGLRenderer would make the
    // migrated TSL materials and packed-light data unreadable.
    const renderer = await createNodeRenderer(options, { forceWebGL: true, onDeviceLost });
    return {
      renderer,
      mode: 'modern',
      requestedMode: 'legacy',
      backend: 'webgl2',
      capabilities: modernCapabilities(renderer),
    };
  }

  try {
    const renderer = await createNodeRenderer(options, { onDeviceLost });
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
    const renderer = await createNodeRenderer(options, { forceWebGL: true, onDeviceLost });
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
