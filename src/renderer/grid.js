// === COORDINATE UTILITIES ===
// Isometric grid coordinate conversion functions.

import { TILE_W, TILE_H } from '../data/directions.js';

/**
 * Convert grid coordinates (col, row) to isometric screen position.
 */
export function gridToIso(col, row) {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}

/**
 * Convert isometric screen position back to grid coordinates (col, row).
 */
export function isoToGrid(screenX, screenY) {
  return {
    col: Math.floor((screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2),
    row: Math.floor((screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2),
  };
}

/**
 * Convert isometric screen position to fractional grid coordinates (no rounding).
 * Used for edge detection — determines which edge of a tile the cursor is nearest to.
 */
export function isoToGridFloat(screenX, screenY) {
  return {
    col: (screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2,
    row: (screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2,
  };
}

/**
 * Return the isometric screen position of the CENTER of grid cell (col, row).
 * gridToIso gives the top vertex; this offsets by half a tile in each axis.
 */
export function tileCenterIso(col, row) {
  return gridToIso(col + 0.5, row + 0.5);
}
