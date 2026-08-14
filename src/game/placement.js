// src/game/placement.js
//
// Pure placement primitives. No game state mutation lives here except
// inside placePlaceable / removePlaceable, which take game as an argument.

import { isoToGridFloat } from '../renderer/grid.js';
import { sparesCostForFunding } from '../beamline/BeamlineSystem.js';

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
  const w = swap ? placeable.subL : placeable.subW;
  const h = swap ? placeable.subW : placeable.subL;
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

function hasWallOnEdge(wallOccupied, col, row, edge) {
  return !!wallOccupied[`${col},${row},${edge}`];
}

/**
 * Returns true if the footprint's interior crosses any wall edge.
 * Only tile boundaries that have cells on BOTH sides are checked —
 * footprints adjacent to a wall (but not through it) are fine.
 */
function footprintCrossesWall(wallOccupied, cells) {
  const set = new Set(cells.map(cellKey));
  for (const c of cells) {
    if (c.subCol === 3) {
      const nk = cellKey({ col: c.col + 1, row: c.row, subCol: 0, subRow: c.subRow });
      if (set.has(nk)) {
        if (hasWallOnEdge(wallOccupied, c.col, c.row, 'e') ||
            hasWallOnEdge(wallOccupied, c.col + 1, c.row, 'w')) return true;
      }
    }
    if (c.subRow === 3) {
      const nk = cellKey({ col: c.col, row: c.row + 1, subCol: c.subCol, subRow: 0 });
      if (set.has(nk)) {
        if (hasWallOnEdge(wallOccupied, c.col, c.row, 's') ||
            hasWallOnEdge(wallOccupied, c.col, c.row + 1, 'n')) return true;
      }
    }
  }
  return false;
}

/**
 * Check whether the placeable can be placed at (col,row,subCol,subRow,dir).
 * Constraints: subtile footprint collision + wall intersection.
 */
export function canPlace(game, placeable, col, row, subCol, subRow, dir = 0) {
  const cells = placeable.footprintCells(col, row, subCol, subRow, dir);
  const blocked = [];
  for (const c of cells) {
    if (game.state.subgridOccupied[cellKey(c)]) blocked.push(c);
  }
  const wallBlocked = footprintCrossesWall(game.state.wallOccupied, cells);
  return { ok: blocked.length === 0 && !wallBlocked, blockedCells: blocked, cells, wallBlocked };
}

/**
 * Reasons a preview can refuse. Geometry outranks money: a blocked footprint
 * is the more actionable message, and moving the cursor fixes it.
 */
export const PLACE_BLOCKED = 'blocked';
export const PLACE_WALL = 'wall';
export const PLACE_UNAFFORDABLE = 'unaffordable';

/**
 * Whether the ledger covers `cost`. Deliberately outside canPlace so the
 * geometric check stays pure — previews combine the two and tint "can't
 * afford" differently from "blocked". Games without a ledger (test stubs,
 * free placement paths) are treated as always affordable.
 */
export function canAffordCost(game, cost) {
  if (!cost) return true;
  if (typeof game?.canAfford !== 'function') return true;
  return game.canAfford(cost);
}

/**
 * The cost a preview should quote/check for `def` — its bare `.cost` for
 * anything that isn't a beamline component, or that cost widened with a
 * spares line for one that is (fix round 1). Mirrors
 * Game._placePlaceableInner's own `kind === 'beamline'` branch AND
 * BeamlineSystem.placeOnPipe's own (unconditional — everything reaching it
 * is a beamline attachment by construction) spares line, using the SAME
 * shared sparesCostForFunding — this is the fix for a preview and its real
 * placement check having drifted apart: before this, a preview quoted/
 * checked funding only (via `.cost` directly), so something whose funding
 * the player could afford but whose spares they couldn't showed a green
 * "affordable" ghost and then refused at the real check — a repeatable
 * "green ghost, red click" with no visible reason why.
 *
 * Two def shapes reach here (fix round 3 widened this from junction-only):
 * a PLACEABLES entry with `.kind === 'beamline'` (a junction, previewed via
 * previewPlacement below) or a bare COMPONENTS entry with `.role` but no
 * `.kind` at all (an on-pipe attachment — quadrupole, BPM, RF cavity, ...;
 * see components.js's own "legacy shim" header for why those two shapes
 * differ) — used directly by the on-pipe attachment ghost previews in
 * InputHandler.js/BeamlineInputController.js, which used to call
 * canAffordCost with the bare def.cost and so still showed green ghosts for
 * spares-short on-pipe parts even after placeOnPipe itself started charging
 * spares (fix round 1).
 */
export function componentCostFor(def) {
  if (!def?.cost) return def?.cost;
  if (def.kind !== 'beamline' && !def.role) return def.cost;
  return { ...def.cost, spares: sparesCostForFunding(def.cost.funding || 0) };
}

/**
 * canPlace + affordability, i.e. everything Game._placePlaceableInner will
 * reject on. Returns canPlace's shape plus `affordable`, `reason` (null when
 * the placement would succeed), and `cost` — the actual quoted cost object
 * (fix round 1: exposed so a caller can show the spares line, not just
 * funding, alongside the ghost).
 */
export function previewPlacement(game, placeable, col, row, subCol, subRow, dir = 0) {
  const geo = canPlace(game, placeable, col, row, subCol, subRow, dir);
  const cost = componentCostFor(placeable);
  const affordable = canAffordCost(game, cost);
  const reason = !geo.ok
    ? (geo.wallBlocked ? PLACE_WALL : PLACE_BLOCKED)
    : (affordable ? null : PLACE_UNAFFORDABLE);
  return { ...geo, ok: geo.ok && affordable, affordable, reason, cost };
}
