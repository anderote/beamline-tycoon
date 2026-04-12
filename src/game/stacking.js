// src/game/stacking.js
//
// Pure stacking logic. No game state mutation — callers apply results.

import { PLACEABLES } from '../data/placeables/index.js';

export const MAX_STACK_HEIGHT = 8; // 4m in subtile units

function cellKey(c) {
  return c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
}

/**
 * Given a ground-level placeable instance, walk stackChildren to the topmost item.
 * Returns the topmost instance in the chain.
 */
export function topmostInStack(groundEntry, placeablesById) {
  let current = groundEntry;
  while (current.stackChildren && current.stackChildren.length > 0) {
    const lastChildId = current.stackChildren[current.stackChildren.length - 1];
    const child = placeablesById(lastChildId);
    if (!child) break;
    current = child;
  }
  return current;
}

/**
 * Check whether `stackableDef` can stack on `targetEntry`.
 * Returns { ok, placeY, reason }.
 */
export function canStack(stackableDef, targetEntry, targetDef, col, row, subCol, subRow, dir) {
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

  // Height cap
  const surfaceH = targetDef.surfaceY ?? targetDef.subH ?? 1;
  const placeY = (targetEntry.placeY || 0) + surfaceH;
  if (placeY + stackableDef.subH > MAX_STACK_HEIGHT) {
    return { ok: false, placeY, reason: 'Exceeds height limit' };
  }

  return { ok: true, placeY, reason: null };
}

/**
 * Compute the collapse plan when deleting `entryId`. Returns null if the
 * deletion would violate constraints, otherwise returns an array of
 * { id, newPlaceY, newStackParentId } updates to apply.
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
    const childDef = getDef(child.type);
    if (childDef && newY + childDef.subH > MAX_STACK_HEIGHT) return false;
    updates.push({ id: childId, newPlaceY: newY, newStackParentId: newParentId });
    for (const grandchildId of (child.stackChildren || [])) {
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
 * Find the stack target at a given XZ position. Looks up the ground-level
 * occupant, walks to the top of the stack, and checks if we can stack on it.
 * Returns { targetEntry, placeY } or null if no valid stack target.
 */
export function findStackTarget(stackableDef, col, row, subCol, subRow, dir, subgridOccupied, getEntry, getDef) {
  const cells = stackableDef.footprintCells(col, row, subCol, subRow, dir);
  let groundId = null;
  for (const c of cells) {
    const k = cellKey(c);
    const occ = subgridOccupied[k];
    if (!occ) return null;
    if (groundId === null) groundId = occ.id;
    else if (occ.id !== groundId) return null;
  }

  const groundEntry = getEntry(groundId);
  if (!groundEntry) return null;

  const topEntry = topmostInStack(groundEntry, getEntry);
  const topDef = getDef(topEntry.type);
  if (!topDef) return null;

  const result = canStack(stackableDef, topEntry, topDef, col, row, subCol, subRow, dir);
  if (!result.ok) return null;

  return { targetEntry: topEntry, placeY: result.placeY };
}
