// Pure helpers for moving and copying a Shift-click selection as one unit.
//
// The UI owns which placeables are selected. This module turns those ids into
// a stable payload, translates every footprint from a primary anchor, and
// validates both the footprints and any utility lines wholly inside the
// selection before InputHandler mutates the game.

import { PLACEABLES } from '../data/placeables/index.js';
import {
  canPlace,
  canAffordCost,
  componentCostFor,
  PLACE_BLOCKED,
  PLACE_UNAFFORDABLE,
  PLACE_WALL,
} from '../game/placement.js';
import { validateDrawLine } from '../utility/line-drawing.js';
import { runWiringCost } from './utility-run-wiring.js';

const SUBS_PER_TILE = 4;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function globalSub(tile, sub = 0) {
  return tile * SUBS_PER_TILE + (sub || 0);
}

function splitGlobalSub(value) {
  const tile = Math.floor(value / SUBS_PER_TILE);
  return { tile, sub: value - tile * SUBS_PER_TILE };
}

function addCost(into, cost) {
  for (const [resource, amount] of Object.entries(cost || {})) {
    into[resource] = (into[resource] || 0) + amount;
  }
  return into;
}

function lineMap(lines) {
  if (!lines) return new Map();
  if (typeof lines.entries === 'function') return new Map(lines.entries());
  return new Map((lines || []).map(line => [line.id, line]));
}

/**
 * Capture a selection without retaining aliases into live game state.
 * Beamline nodes are deliberately excluded: copying those without their beam
 * pipes would create disconnected accelerator hardware. Their existing
 * single-object Place shortcut remains available through MoveTool.
 */
export function captureSelectionGroup(game, ids, { operation = 'move', primaryId = null } = {}) {
  const uniqueIds = [...new Set(ids || [])];
  const entries = uniqueIds.map(id => game.getPlaceable?.(id)).filter(Boolean);
  if (entries.length !== uniqueIds.length || entries.length === 0) {
    return { ok: false, reason: 'Nothing selected' };
  }
  if (entries.some(entry => entry.kind === 'beamline')) {
    return { ok: false, reason: 'Copy beamline hardware from the Designer' };
  }
  if (entries.some(entry => entry.stackParentId || (entry.stackChildren || []).length > 0)) {
    return { ok: false, reason: 'Stacked items must be moved separately' };
  }

  const primary = entries.find(entry => entry.id === primaryId) || entries[entries.length - 1];
  const selected = new Set(entries.map(entry => entry.id));
  const connections = [];
  for (const line of (game.state.utilityLines?.values?.() || [])) {
    if (!line?.start || !line?.end) continue;
    if (selected.has(line.start.placeableId) && selected.has(line.end.placeableId)) {
      connections.push(clone(line));
    }
  }

  return {
    ok: true,
    payload: {
      kind: 'selectionGroup',
      operation,
      primaryId: primary.id,
      anchor: {
        col: primary.col,
        row: primary.row,
        subCol: primary.subCol || 0,
        subRow: primary.subRow || 0,
        dir: primary.dir || 0,
      },
      items: entries.map(entry => ({
        id: entry.id,
        type: entry.type,
        kind: entry.kind,
        col: entry.col,
        row: entry.row,
        subCol: entry.subCol || 0,
        subRow: entry.subRow || 0,
        dir: entry.dir || 0,
        portsFlipped: entry.portsFlipped === true,
        wallMount: clone(entry.wallMount),
        params: clone(entry.params),
        variant: entry.variant ?? 0,
      })),
      connections,
    },
  };
}

/** Translate every selected item by the primary item's snapped displacement. */
export function selectionTargets(payload, anchorPose) {
  if (!payload?.items?.length || !anchorPose) return [];
  const deltaSubCol = globalSub(anchorPose.col, anchorPose.subCol)
    - globalSub(payload.anchor.col, payload.anchor.subCol);
  const deltaSubRow = globalSub(anchorPose.row, anchorPose.subRow)
    - globalSub(payload.anchor.row, payload.anchor.subRow);

  return payload.items.map((item, index) => {
    const x = splitGlobalSub(globalSub(item.col, item.subCol) + deltaSubCol);
    const z = splitGlobalSub(globalSub(item.row, item.subRow) + deltaSubRow);
    return {
      ...item,
      placeholderId: `__selection_copy_${index}`,
      col: x.tile,
      row: z.tile,
      subCol: x.sub,
      subRow: z.sub,
    };
  });
}

function footprintSub(item) {
  const def = PLACEABLES[item?.type] || {};
  const dir = ((item?.dir || 0) % 4 + 4) % 4;
  const subW = def.subW || 2;
  const subL = def.subL || 2;
  return dir === 1 || dir === 3
    ? { width: subL, depth: subW }
    : { width: subW, depth: subL };
}

function selectionPivotSub(items) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const item of items || []) {
    const originX = globalSub(item.col, item.subCol);
    const originZ = globalSub(item.row, item.subRow);
    const size = footprintSub(item);
    minX = Math.min(minX, originX);
    minZ = Math.min(minZ, originZ);
    maxX = Math.max(maxX, originX + size.width);
    maxZ = Math.max(maxZ, originZ + size.depth);
  }
  return Number.isFinite(minX)
    ? { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }
    : { x: 0, z: 0 };
}

function turnPoint(x, z, pivot, quarterTurns, mirror) {
  let dx = x - pivot.x;
  let dz = z - pivot.z;
  if (mirror) dx = -dx;
  for (let i = 0; i < quarterTurns; i++) {
    [dx, dz] = [-dz, dx];
  }
  return { x: pivot.x + dx, z: pivot.z + dz };
}

/**
 * Rotate or mirror a captured formation around its visual bounding-box centre.
 * Returns a deep copy, leaving a saved hotkey/clipboard payload immutable.
 * Item origins stay on the quarter-tile lattice; cable paths retain their
 * authored fractional precision.
 */
export function transformSelectionGroup(payload, {
  quarterTurns = 0,
  mirror = false,
} = {}) {
  if (!payload?.items?.length) return clone(payload);
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0 && !mirror) return clone(payload);

  const out = clone(payload);
  // A whole-subtile pivot keeps every rotated top-left origin on the same
  // quarter-tile lattice. Persist it across repeated transforms so four turns
  // and two mirrors are exact identities instead of accumulating snap drift.
  const measuredPivot = selectionPivotSub(payload.items);
  const pivot = payload.transformPivotSub || {
    x: Math.round(measuredPivot.x),
    z: Math.round(measuredPivot.z),
  };
  out.transformPivotSub = { ...pivot };
  for (const item of out.items) {
    const oldSize = footprintSub(item);
    const oldCentre = {
      x: globalSub(item.col, item.subCol) + oldSize.width / 2,
      z: globalSub(item.row, item.subRow) + oldSize.depth / 2,
    };
    const nextCentre = turnPoint(oldCentre.x, oldCentre.z, pivot, turns, mirror);
    let nextDir = ((item.dir || 0) % 4 + 4) % 4;
    if (mirror) nextDir = (4 - nextDir) % 4;
    nextDir = (nextDir + turns) % 4;
    item.dir = nextDir;
    const nextSize = footprintSub(item);
    const originX = Math.round(nextCentre.x - nextSize.width / 2);
    const originZ = Math.round(nextCentre.z - nextSize.depth / 2);
    const x = splitGlobalSub(originX);
    const z = splitGlobalSub(originZ);
    item.col = x.tile;
    item.subCol = x.sub;
    item.row = z.tile;
    item.subRow = z.sub;
  }

  const transformPath = path => Array.isArray(path) ? path.map(point => {
    if (!Number.isFinite(point?.col) || !Number.isFinite(point?.row)) return point;
    const next = turnPoint(point.col * SUBS_PER_TILE, point.row * SUBS_PER_TILE,
      pivot, turns, mirror);
    return {
      ...point,
      col: next.x / SUBS_PER_TILE,
      row: next.z / SUBS_PER_TILE,
    };
  }) : path;
  for (const connection of out.connections || []) {
    connection.path = transformPath(connection.path);
    connection.cablePath = transformPath(connection.cablePath);
  }

  const primary = out.items.find(item => item.id === out.primaryId) || out.items[0];
  out.anchor = {
    col: primary.col,
    row: primary.row,
    subCol: primary.subCol || 0,
    subRow: primary.subRow || 0,
    dir: primary.dir || 0,
  };
  return out;
}

/**
 * Validate group footprints, aggregate copy cost, and translated internal
 * utility lines. The returned connection plans are ready for the commit path.
 */
export function previewSelectionGroup(game, payload, anchorPose) {
  const targets = selectionTargets(payload, anchorPose);
  if (!targets.length) return { ok: false, reason: PLACE_BLOCKED, targets: [] };

  const moving = payload.operation === 'move';
  const selectedIds = new Set(payload.items.map(item => item.id));
  const occupancy = {};
  for (const [key, occ] of Object.entries(game.state.subgridOccupied || {})) {
    if (moving && selectedIds.has(occ?.id)) continue;
    occupancy[key] = occ;
  }
  const probeGame = { ...game, state: { ...game.state, subgridOccupied: occupancy } };

  let reason = null;
  const targetEntries = [];
  for (const target of targets) {
    const def = PLACEABLES[target.type];
    if (!def) {
      reason = reason || PLACE_BLOCKED;
      continue;
    }
    const geo = canPlace(
      probeGame, def,
      target.col, target.row, target.subCol, target.subRow, target.dir,
    );
    if (!geo.ok && !reason) reason = geo.wallBlocked ? PLACE_WALL : PLACE_BLOCKED;
    const targetId = moving ? target.id : target.placeholderId;
    for (const cell of geo.cells) {
      const key = `${cell.col},${cell.row},${cell.subCol},${cell.subRow}`;
      // Claim even after a collision so later targets also see the group's
      // intended footprint and the entire preview stays consistently red.
      occupancy[key] = { id: targetId, kind: target.kind };
    }
    targetEntries.push({
      ...target,
      id: targetId,
      category: target.kind,
      cells: geo.cells,
      stackParentId: null,
      stackChildren: [],
    });
  }

  const itemCost = {};
  const lineCost = {};
  if (!moving) {
    for (const item of payload.items) addCost(itemCost, componentCostFor(PLACEABLES[item.type]));
    for (const line of payload.connections) addCost(lineCost, runWiringCost(line.utilityType, line.subL));
    const total = addCost({ ...itemCost }, lineCost);
    if (!canAffordCost(game, total) && !reason) reason = PLACE_UNAFFORDABLE;
  }

  const targetByOldId = new Map(targets.map(target => [target.id, target]));
  const replacementByOldId = new Map(targetEntries.map((entry, index) => [payload.items[index].id, entry]));
  const placeables = moving
    ? (game.state.placeables || []).map(entry => replacementByOldId.get(entry.id) || entry)
    : [...(game.state.placeables || []), ...targetEntries];
  const internalLineIds = new Set(payload.connections.map(line => line.id));
  const utilityLines = lineMap(game.state.utilityLines);
  if (moving) {
    for (const id of internalLineIds) utilityLines.delete(id);
  }
  const utilityState = { ...game.state, placeables, utilityLines };

  const deltaCol = targets[0].col + targets[0].subCol / SUBS_PER_TILE
    - (payload.items[0].col + payload.items[0].subCol / SUBS_PER_TILE);
  const deltaRow = targets[0].row + targets[0].subRow / SUBS_PER_TILE
    - (payload.items[0].row + payload.items[0].subRow / SUBS_PER_TILE);
  const connections = [];
  for (let index = 0; index < payload.connections.length; index++) {
    const source = payload.connections[index];
    const remap = (endpoint) => {
      if (!endpoint) return null;
      const target = targetByOldId.get(endpoint.placeableId);
      return {
        ...endpoint,
        placeableId: moving ? endpoint.placeableId : target.placeholderId,
      };
    };
    const plan = {
      sourceId: source.id,
      utilityType: source.utilityType,
      start: remap(source.start),
      end: remap(source.end),
      path: (source.path || []).map(point => ({
        col: point.col + deltaCol,
        row: point.row + deltaRow,
      })),
      cablePath: Array.isArray(source.cablePath)
        ? source.cablePath.map(point => ({
            col: point.col + deltaCol,
            row: point.row + deltaRow,
          }))
        : undefined,
      // A move keeps the fabricated rack elevation. A copy prefers the source
      // elevation but may be lifted if it lands over the original route.
      ...(moving && Number.isFinite(source.routeHeightMeters)
        ? { routeHeightMeters: source.routeHeightMeters }
        : {}),
      ...(!moving && Number.isFinite(source.routeHeightMeters)
        ? { preferredRouteHeightMeters: source.routeHeightMeters }
        : {}),
    };
    const checked = validateDrawLine(utilityState, plan);
    if (!checked.ok) {
      reason = reason || `utility:${checked.reason}`;
      continue;
    }
    const provisional = {
      ...checked.line,
      id: moving ? source.id : `__selection_line_${index}`,
    };
    utilityLines.set(provisional.id, provisional);
    connections.push({
      ...plan,
      subL: checked.line.subL,
      ...(Number.isFinite(checked.line.routeHeightMeters)
        ? { routeHeightMeters: checked.line.routeHeightMeters }
        : {}),
    });
  }

  return {
    ok: !reason && connections.length === payload.connections.length,
    reason,
    targets,
    connections,
    itemCost,
    lineCost,
    internalLineIds,
  };
}
