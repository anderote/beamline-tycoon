import { MAX_LEVEL, normalizeLevel } from '../game/storeys.js';

export const DEFAULT_FLOOR_WALL_MODE = 'transparent';
export const FLOOR_WALL_MODES = Object.freeze(['up', 'cutaway', 'transparent', 'down']);

export function normalizeFloorWallMode(mode) {
  return FLOOR_WALL_MODES.includes(mode) ? mode : DEFAULT_FLOOR_WALL_MODE;
}

export function createFloorWallModes(defaultMode = DEFAULT_FLOOR_WALL_MODE) {
  const mode = normalizeFloorWallMode(defaultMode);
  return Array.from({ length: MAX_LEVEL + 1 }, () => mode);
}

export function floorWallMode(modes, level) {
  return normalizeFloorWallMode(modes?.[normalizeLevel(level)]);
}

export function rememberFloorWallMode(modes, level, mode) {
  const next = Array.isArray(modes) ? modes.slice(0, MAX_LEVEL + 1) : createFloorWallModes();
  while (next.length <= MAX_LEVEL) next.push(DEFAULT_FLOOR_WALL_MODE);
  next[normalizeLevel(level)] = normalizeFloorWallMode(mode);
  return next;
}

/**
 * Presentation plan for the renderer-owned frames that are not the active
 * construction floor. Selected-floor views ghost lower context and hide
 * upper storeys. Roof overview shows every other storey solid, including its
 * roof, while the active builders render the selected storey itself.
 */
export function storeyFramePlan(activeLevel, overview = false) {
  const active = normalizeLevel(activeLevel);
  return Array.from({ length: MAX_LEVEL + 1 }, (_unused, level) => ({
    level,
    visible: level !== active && (overview || level < active),
    ghosted: !overview && level < active,
    roofsVisible: overview && level !== active,
  }));
}

/** Preview geometry is local to a group already raised to the storey datum. */
export function previewSurfaceCorners(terrainCorners, level) {
  if (normalizeLevel(level) > 0) return { nw: 0, ne: 0, se: 0, sw: 0 };
  return terrainCorners || { nw: 0, ne: 0, se: 0, sw: 0 };
}
