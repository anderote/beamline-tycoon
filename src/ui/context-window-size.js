// Persistent dimensions for ContextWindow instances.
//
// Dynamic world-object ids share one size preference per window family: a
// player who enlarges one equipment or staff inspector expects the next one
// to open the same way, rather than maintaining hundreds of object-id entries.

export const CONTEXT_WINDOW_SIZE_STORAGE_KEY = 'beamlineTycoon.contextWindowSizes.v1';
export const CONTEXT_WINDOW_MIN_WIDTH = 220;
export const CONTEXT_WINDOW_MIN_HEIGHT = 140;

export function contextWindowSizeKey(id) {
  const value = String(id || 'window');
  if (value.startsWith('bl-')) return 'beamline';
  if (value.startsWith('equip-')) return 'equipment';
  if (value.startsWith('staff-')) return 'staff-inspector';
  if (value.startsWith('util-line-')) return 'utility-line';
  if (value.startsWith('util-network-')) return 'utility-network';
  return value;
}

function sizeCatalogue(storage = globalThis.localStorage) {
  if (!storage?.getItem) return {};
  try {
    const parsed = JSON.parse(storage.getItem(CONTEXT_WINDOW_SIZE_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function finiteDimension(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

export function clampContextWindowSize(size, viewport = {}) {
  const width = finiteDimension(size?.width);
  const height = finiteDimension(size?.height);
  if (width == null || height == null) return null;
  const viewportWidth = finiteDimension(viewport.width) || 10000;
  const viewportHeight = finiteDimension(viewport.height) || 10000;
  const maxWidth = Math.max(CONTEXT_WINDOW_MIN_WIDTH, viewportWidth - 8);
  const maxHeight = Math.max(CONTEXT_WINDOW_MIN_HEIGHT, viewportHeight - 8);
  return {
    width: Math.max(CONTEXT_WINDOW_MIN_WIDTH, Math.min(width, maxWidth)),
    height: Math.max(CONTEXT_WINDOW_MIN_HEIGHT, Math.min(height, maxHeight)),
  };
}

export function readContextWindowSize(
  key,
  { storage = globalThis.localStorage, viewport = {} } = {},
) {
  return clampContextWindowSize(sizeCatalogue(storage)[key], viewport);
}

export function persistContextWindowSize(
  key,
  size,
  { storage = globalThis.localStorage } = {},
) {
  const normalized = clampContextWindowSize(size);
  if (!key || !normalized || !storage?.setItem) return false;
  const catalogue = sizeCatalogue(storage);
  catalogue[key] = normalized;
  try {
    storage.setItem(CONTEXT_WINDOW_SIZE_STORAGE_KEY, JSON.stringify(catalogue));
    return true;
  } catch (_) {
    return false;
  }
}
