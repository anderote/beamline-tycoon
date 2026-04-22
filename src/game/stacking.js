// src/game/stacking.js
//
// Pure stacking logic. No game state mutation — callers apply results.

import { PLACEABLES } from '../data/placeables/index.js';

export const MAX_STACK_HEIGHT = 8; // 4m in subtile units

function cellKey(c) {
  return c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
}

/**
 * Check whether `stackableDef` can stack on `targetEntry`.
 * Returns { ok, placeY, reason }.
 *
 * `getEntry(id)` is used to resolve sibling entries on the target so we can
 * check subtile collisions against existing children.
 */
export function canStack(stackableDef, targetEntry, targetDef, col, row, subCol, subRow, dir, getEntry) {
  if (!stackableDef.stackable) {
    return { ok: false, placeY: 0, reason: 'Item is not stackable' };
  }

  if (!targetDef.hasSurface && !targetDef.stackable) {
    return { ok: false, placeY: 0, reason: 'Target has no surface' };
  }

  // Footprint containment: stackable's cells must be a subset of target's cells.
  const targetCells = new Set(
    targetDef.footprintCells(targetEntry.col, targetEntry.row, targetEntry.subCol || 0, targetEntry.subRow || 0, targetEntry.dir || 0)
      .map(cellKey)
  );
  const stackCells = stackableDef.footprintCells(col, row, subCol, subRow, dir);
  for (const c of stackCells) {
    if (!targetCells.has(cellKey(c))) {
      return { ok: false, placeY: 0, reason: 'Does not fit on surface' };
    }
  }

  // Sibling collision: the footprint must not overlap any existing child's cells.
  if (typeof getEntry === 'function' && Array.isArray(targetEntry.stackChildren)) {
    const stackKeys = stackCells.map(cellKey);
    for (const siblingId of targetEntry.stackChildren) {
      const sibling = getEntry(siblingId);
      if (!sibling || !Array.isArray(sibling.cells)) continue;
      const siblingKeys = new Set(sibling.cells.map(cellKey));
      for (const k of stackKeys) {
        if (siblingKeys.has(k)) {
          return { ok: false, placeY: 0, reason: 'Surface subtile occupied' };
        }
      }
    }
  }

  // Height cap
  const surfaceH = targetDef.surfaceY ?? targetDef.subH ?? 1;
  const placeY = (targetEntry.placeY || 0) + surfaceH;
  if (placeY + stackableDef.subH > MAX_STACK_HEIGHT) {
    return { ok: false, placeY, reason: 'Exceeds height limit' };
  }

  return { ok: true, placeY, reason: null };
}

/**
 * Compute the collapse plan when deleting `entryId`. Re-parents children to
 * `entry.stackParentId` (or ground if entry was ground) and shifts their
 * `placeY` down by the removed item's height. Because removal only reduces
 * heights, the result never violates the height cap.
 *
 * Returns an array of { id, newPlaceY, newStackParentId } updates to apply.
 * Returns null only for malformed input (missing entry/def).
 */
export function collapsePlan(entryId, getEntry, getDef) {
  const entry = getEntry(entryId);
  if (!entry) return null;
  const def = getDef(entry.type);
  if (!def) return null;

  const children = (entry.stackChildren || []).slice();
  if (children.length === 0) return [];

  const parentId = entry.stackParentId || null;
  const deletedHeight = def.surfaceY ?? def.subH ?? 1;
  const updates = [];

  function shiftDown(childId, newParentId, yShift) {
    const child = getEntry(childId);
    if (!child) return true;
    const newY = (child.placeY || 0) - yShift;
    if (newY < 0) return false;
    updates.push({ id: childId, newPlaceY: newY, newStackParentId: newParentId });
    for (const grandchildId of (child.stackChildren || [])) {
      // Grandchildren keep their existing parent (the child), but shift down
      // by the same amount since the whole subtree moved down.
      if (!shiftDown(grandchildId, childId, yShift)) return false;
    }
    return true;
  }

  for (const childId of children) {
    if (!shiftDown(childId, parentId, deletedHeight)) return null;
  }

  return updates;
}

/**
 * Cursor-anchored descent. Given the ghost footprint at the snapped cursor
 * position, pick the topmost existing item whose `cells` fully contain the
 * footprint and which has a valid surface. Return `{ targetEntry, placeY }`,
 * or null if no valid stack target.
 *
 * Algorithm (see docs/superpowers/specs/2026-04-17-surface-subtile-placement-design.md):
 *   1. Look up each footprint cell in subgridOccupied.
 *      - All empty → null (ground placement).
 *      - Mixed empty/occupied, or different ground ids → null.
 *      - All same ground id → continue with that ground entry.
 *   2. Descend: among the current node's stackChildren, find one whose cells
 *      contain the footprint. If found and it's a surface/stackable, recurse.
 *   3. Validate on the terminal node via canStack (with getEntry for sibling
 *      check). Success → { targetEntry, placeY }; failure → null.
 */
export function findStackTarget(stackableDef, col, row, subCol, subRow, dir, subgridOccupied, getEntry, getDef) {
  const cells = stackableDef.footprintCells(col, row, subCol, subRow, dir);
  const stackKeys = cells.map(cellKey);

  // Step 1: resolve the ground occupant (or null for a purely-empty footprint).
  let groundId = null;
  let emptyCount = 0;
  for (const k of stackKeys) {
    const occ = subgridOccupied[k];
    if (!occ) { emptyCount++; continue; }
    if (groundId === null) groundId = occ.id;
    else if (occ.id !== groundId) return null; // straddles different ground items
  }
  if (groundId === null) return null;
  if (emptyCount > 0) return null; // mixed empty/occupied

  const groundEntry = getEntry(groundId);
  if (!groundEntry) return null;

  // Step 2: descend into stackChildren, choosing the child (if any) whose cells
  // contain the full footprint. Invariant: at most one per level.
  let current = groundEntry;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const kids = current.stackChildren || [];
    let nextChild = null;
    for (const childId of kids) {
      const child = getEntry(childId);
      if (!child || !Array.isArray(child.cells)) continue;
      const childCells = new Set(child.cells.map(cellKey));
      let contains = true;
      for (const k of stackKeys) {
        if (!childCells.has(k)) { contains = false; break; }
      }
      if (contains) {
        nextChild = child;
        break;
      }
    }
    if (!nextChild) break;
    const nextDef = getDef(nextChild.type);
    if (!nextDef) break;
    // Only descend if the child itself is a surface / stackable. If it's a
    // leaf (plain item), we stop — placement on this node will fail its
    // canStack check (no surface), which turns into a null result.
    if (!nextDef.hasSurface && !nextDef.stackable) break;
    current = nextChild;
  }

  // Step 3: validate on `current` via canStack.
  const currentDef = getDef(current.type);
  if (!currentDef) return null;
  const result = canStack(
    stackableDef, current, currentDef, col, row, subCol, subRow, dir, getEntry,
  );
  if (!result.ok) return null;

  return { targetEntry: current, placeY: result.placeY };
}
