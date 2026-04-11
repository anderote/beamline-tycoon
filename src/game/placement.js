// src/game/placement.js
//
// Pure placement primitives. No game state mutation lives here except
// inside placePlaceable / removePlaceable, which take game as an argument.

import { isoToGridFloat } from '../renderer/grid.js';

/**
 * Snap a world (x,y) to the nearest subtile center, no clamping.
 * Returns the tile + sub-offset that, when used as a placeable origin
 * with subW=1,subH=1, would put a 1x1 footprint centered on the cursor.
 *
 * For larger footprints, callers shift the origin by half the footprint
 * dimensions; see snapForPlaceable.
 */
export function snapWorldToSubgrid(worldX, worldY) {
  const fc = isoToGridFloat(worldX, worldY);
  const subCenterCol = Math.round(fc.col * 4);
  const subCenterRow = Math.round(fc.row * 4);
  const col = Math.floor(subCenterCol / 4);
  const row = Math.floor(subCenterRow / 4);
  const subCol = ((subCenterCol % 4) + 4) % 4;
  const subRow = ((subCenterRow % 4) + 4) % 4;
  return { col, row, subCol, subRow };
}

/**
 * Like snapWorldToSubgrid but offsets the origin so the placeable's
 * footprint is centered on the cursor.
 */
export function snapForPlaceable(worldX, worldY, placeable, dir = 0) {
  const swap = dir === 1 || dir === 3;
  const w = swap ? placeable.subH : placeable.subW;
  const h = swap ? placeable.subW : placeable.subH;
  const fc = isoToGridFloat(worldX, worldY);
  const subCenterCol = fc.col * 4;
  const subCenterRow = fc.row * 4;
  const topLeftSubCol = Math.round(subCenterCol - w / 2);
  const topLeftSubRow = Math.round(subCenterRow - h / 2);
  const col = Math.floor(topLeftSubCol / 4);
  const row = Math.floor(topLeftSubRow / 4);
  const subCol = ((topLeftSubCol % 4) + 4) % 4;
  const subRow = ((topLeftSubRow % 4) + 4) % 4;
  return { col, row, subCol, subRow };
}

function cellKey(c) {
  return c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
}

/**
 * Check whether the placeable can be placed at (col,row,subCol,subRow,dir).
 * The ONLY constraint is subtile footprint collision.
 */
export function canPlace(game, placeable, col, row, subCol, subRow, dir = 0) {
  const cells = placeable.footprintCells(col, row, subCol, subRow, dir);
  const blocked = [];
  for (const c of cells) {
    if (game.state.subgridOccupied[cellKey(c)]) blocked.push(c);
  }
  return { ok: blocked.length === 0, blockedCells: blocked, cells };
}
