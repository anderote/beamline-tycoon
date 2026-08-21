import { isSelectionCategory } from '../game/selection-targets.js';

export const MOUSE_SELECTION_CATEGORY_STORAGE_KEY =
  'beamlineTycoon.mouseSelectionCategories.v1';

// Structural surfaces and outdoor scenery are easy to catch accidentally
// when clicking through a busy facility or drawing a broad marquee.
export const DEFAULT_MOUSE_SELECTION_CATEGORIES = Object.freeze([
  'beamline',
  'infra',
  'facility',
]);

export function loadMouseSelectionCategories(storage = null) {
  try {
    const source = storage || globalThis.localStorage;
    const raw = source?.getItem?.(MOUSE_SELECTION_CATEGORY_STORAGE_KEY);
    if (raw == null) return new Set(DEFAULT_MOUSE_SELECTION_CATEGORIES);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_MOUSE_SELECTION_CATEGORIES);
    return new Set(parsed.filter(isSelectionCategory));
  } catch (_) {
    return new Set(DEFAULT_MOUSE_SELECTION_CATEGORIES);
  }
}

export function saveMouseSelectionCategories(categories, storage = null) {
  try {
    const target = storage || globalThis.localStorage;
    const keys = [...(categories || [])].filter(isSelectionCategory);
    target?.setItem?.(MOUSE_SELECTION_CATEGORY_STORAGE_KEY, JSON.stringify(keys));
    return true;
  } catch (_) {
    return false;
  }
}

export function mouseSelectionCategoryEnabled(categories, category) {
  if (categories && typeof categories.has === 'function') return categories.has(category);
  return DEFAULT_MOUSE_SELECTION_CATEGORIES.includes(category);
}
