import { reverseDir } from '../data/directions.js';

// Most placeables use the gameplay direction as their facing marker. These
// models put the hardware the player needs to orient on local +Z instead, so
// their marker follows that physical service face.
const POSITIVE_Z_FACING_PLACEABLES = new Set([
  'switchgear',
]);

/** Direction used by the floor arrow shown while placing a placeable. */
export function placementFacingArrowDir(placeable, direction = 0) {
  const dir = ((((direction | 0) % 4) + 4) % 4);
  return placeable?.isSource || POSITIVE_Z_FACING_PLACEABLES.has(placeable?.id)
    ? reverseDir(dir)
    : dir;
}
