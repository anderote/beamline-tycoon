// src/game/placement.js
//
// Pure placement primitives. No game state mutation lives here except
// inside placePlaceable / removePlaceable, which take game as an argument.

import { isoToGridFloat } from '../renderer/grid.js';
import { edgeKey, findEdgeKey, findWallKey, mirrorEdge } from './edge-keys.js';
import { WALL_TYPES } from '../data/structure.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { levelOf, normalizeLevel, subtileKey, tileKey, withLevel } from './storeys.js';
import {
  physicalWallFixtureSlotKeys,
  wallFixtureFaceOffset,
} from './wall-fixture-geometry.js';
import { resolveMapEdgeConnection } from './map-edge-connection.js';
import { placeableBusBlockedCells } from '../utility/universal-bus-clearance.js';

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

/**
 * Whether a placeable owns floor subtiles. Overhead and wall fixtures keep
 * footprint/edge data as world-space anchors, while `mount: 'floor'`
 * coverings retain a floor outline without reserving the furniture layer.
 * All three can overlap ordinary equipment without replacing it.
 */
export function usesFloorOccupancy(placeable) {
  return !['overhead', 'wall', 'floor', 'utilityTap'].includes(placeable?.mount);
}

/** Snap a cursor fraction along a wall edge to one of its four sub-slots. */
export function wallFixtureOffFromFrac(frac, span = 1) {
  const f = Number.isFinite(frac) ? frac : 0.5;
  const slots = Math.max(1, Math.min(4, Math.floor(span || 1)));
  const start = Math.floor(f * 4 - (slots - 1) / 2);
  return Math.max(0, Math.min(4 - slots, start));
}

export function normalizeWallMount(site) {
  if (!site || !['n', 'e', 's', 'w'].includes(site.edge)) return null;
  if (!Number.isFinite(site.col) || !Number.isFinite(site.row)) return null;
  return withLevel({
    col: Math.floor(site.col),
    row: Math.floor(site.row),
    edge: site.edge,
    off: Math.max(0, Math.min(3, Math.floor(site.off ?? 1))),
  }, site.level ?? 0);
}

/** Stable identity for a specific slot on one face of a physical wall. */
export function wallFixtureMountKey(site) {
  const mount = normalizeWallMount(site);
  return mount ? `${levelOf(mount)}|${mount.col},${mount.row},${mount.edge},${mount.off}` : null;
}

/** Stable face-local identities for every quarter-wall slot a fixture covers. */
export function wallFixtureMountKeys(site) {
  const mount = normalizeWallMount(site);
  if (!mount) return [];
  const span = Math.max(1, Math.min(4, Math.floor(site?.span ?? 1)));
  const off = Math.max(0, Math.min(4 - span, mount.off));
  return Array.from(
    { length: span },
    (_, i) => `${mount.col},${mount.row},${mount.edge},${off + i}`,
  );
}

/** Alias-independent identity for the wall segment supporting a fixture. */
export function physicalWallKey(site) {
  const mount = normalizeWallMount(site);
  if (!mount) return null;
  const level = levelOf(mount);
  const direct = `${level}|${mount.col},${mount.row},${mount.edge}`;
  const mirror = mirrorEdge(mount.col, mount.row, mount.edge, level);
  if (!mirror) return direct;
  const alias = `${level}|${mirror.col},${mirror.row},${mirror.edge}`;
  return direct < alias ? direct : alias;
}

/** Hangings share wall space with fixtures; only structural openings block them. */
export function isNonBlockingWallHanging(placeable) {
  return placeable?.mount === 'wall' && placeable?.category === 'hangings';
}

/** True when either face of one physical wall edge carries a hanging. */
export function wallEdgeHasHanging(game, col, row, edge, level = 0, ignoreId = null) {
  const wanted = physicalWallKey({ col, row, edge, level });
  if (!wanted) return false;
  return (game?.state?.placeables || []).some((entry) => {
    if (entry.id === ignoreId || !entry.wallMount) return false;
    return isNonBlockingWallHanging(PLACEABLES[entry.type])
      && physicalWallKey(entry.wallMount) === wanted;
  });
}

/** Vertical envelope occupied by one modular automatic utility sleeve. */
export function automaticWallPassThroughInterval(placeable) {
  const spec = placeable?.automaticWallPassThrough;
  if (!spec) return null;
  const centre = Number(spec.heightMeters);
  const radius = Number(spec.radiusMeters);
  if (!Number.isFinite(centre) || !Number.isFinite(radius) || radius <= 0) return null;
  // Collars are intentionally a little broader than the carried service.
  const halfHeight = radius + 0.045;
  return { min: centre - halfHeight, max: centre + halfHeight };
}

function automaticWallPassThroughsConflict(a, b) {
  const aSpec = a?.automaticWallPassThrough;
  const bSpec = b?.automaticWallPassThrough;
  const pairedWaterCircuits = aSpec?.utilityType === bSpec?.utilityType
    && ['coolingWater', 'waterSupplyPipe'].includes(aSpec?.utilityType)
    && new Set([aSpec.waterCircuit, bSpec.waterCircuit]).size === 2
    && [aSpec.waterCircuit, bSpec.waterCircuit].every(circuit =>
      circuit === 'cold' || circuit === 'hot');
  if (pairedWaterCircuits) return false;
  const ia = automaticWallPassThroughInterval(a);
  const ib = automaticWallPassThroughInterval(b);
  if (!ia || !ib) return true;
  return ia.min < ib.max - 1e-6 && ib.min < ia.max - 1e-6;
}

/** Validate the actual wall and face-slot a wall-mounted fixture needs. */
export function canPlaceWallFixture(game, placeable, site, ignoreId = null) {
  const requestedMount = normalizeWallMount(site);
  const span = Math.max(1, Math.min(4, Math.floor(placeable?.wallSpan ?? 1)));
  const mount = requestedMount
    ? { ...requestedMount, off: Math.min(requestedMount.off, 4 - span), span }
    : null;
  if (placeable?.mount !== 'wall' || !mount) {
    return { ok: false, hasWall: false, occupied: false, wallMount: mount };
  }
  const wallKey = findWallKey(
    game?.state?.wallOccupied, mount.col, mount.row, mount.edge, levelOf(mount),
  );
  const wallType = wallKey ? game.state.wallOccupied[wallKey] : null;
  const hasWall = !!wallKey;
  const openingOccupied = isNonBlockingWallHanging(placeable) && !!(
    findEdgeKey(game?.state?.doorOccupied, mount.col, mount.row, mount.edge, levelOf(mount))
    || findEdgeKey(game?.state?.windowOccupied, mount.col, mount.row, mount.edge, levelOf(mount))
  );
  const keys = new Set(wallFixtureMountKeys(mount));
  const physicalSlots = new Set(physicalWallFixtureSlotKeys(mount));
  const fixtureOccupied = (game?.state?.placeables || []).some((entry) => {
    if (entry.id === ignoreId || !entry.wallMount) return false;
    const otherDef = PLACEABLES[entry.type];
    // A wall hanging neither claims a fixture slot nor prevents another
    // fixture from using it later. Door/window openings are checked above.
    if (isNonBlockingWallHanging(placeable) || isNonBlockingWallHanging(otherDef)) return false;
    const otherMount = {
      ...entry.wallMount,
      span: otherDef?.wallSpan ?? entry.wallMount.span ?? 1,
    };
    const sameFaceOverlap = wallFixtureMountKeys(otherMount).some(key => keys.has(key));
    const physicalOverlap = physicalWallFixtureSlotKeys(otherMount)
      .some(key => physicalSlots.has(key));
    if (!sameFaceOverlap
        && (!(placeable.wallPassThrough === true || otherDef?.wallPassThrough === true)
          || !physicalOverlap)) return false;
    // Automatic sleeves form a service stack in one physical wall station.
    // Only their real collar envelopes collide; the laterally separated cold
    // and hot rigid-water pair deliberately shares one elevation and station.
    // Manual
    // fittings (including 4×4 HV and 2×2 water assemblies) continue to reserve
    // their full authored span on both faces.
    if (physicalOverlap && placeable.automaticWallPassThrough
        && otherDef?.automaticWallPassThrough) {
      return automaticWallPassThroughsConflict(placeable, otherDef);
    }
    return sameFaceOverlap
      || ((placeable.wallPassThrough === true || otherDef?.wallPassThrough === true)
        && physicalOverlap);
  });
  const occupied = openingOccupied || fixtureOccupied;
  return {
    ok: hasWall && !occupied,
    hasWall,
    occupied,
    openingOccupied,
    wallMount: hasWall
      ? { ...mount, faceOffset: wallFixtureFaceOffset(WALL_TYPES[wallType]) }
      : mount,
  };
}

function hasWallOnEdge(wallOccupied, col, row, edge, level = 0) {
  return !!wallOccupied[edgeKey(col, row, edge, level)];
}

/**
 * Returns true if the footprint's interior crosses any wall edge.
 * Only tile boundaries that have cells on BOTH sides are checked —
 * footprints adjacent to a wall (but not through it) are fine.
 */
function footprintCrossesWall(wallOccupied, cells, level = 0) {
  const set = new Set(cells.map(cellKey));
  for (const c of cells) {
    if (c.subCol === 3) {
      const nk = cellKey({ col: c.col + 1, row: c.row, subCol: 0, subRow: c.subRow });
      if (set.has(nk)) {
        if (hasWallOnEdge(wallOccupied, c.col, c.row, 'e', level) ||
            hasWallOnEdge(wallOccupied, c.col + 1, c.row, 'w', level)) return true;
      }
    }
    if (c.subRow === 3) {
      const nk = cellKey({ col: c.col, row: c.row + 1, subCol: c.subCol, subRow: 0 });
      if (set.has(nk)) {
        if (hasWallOnEdge(wallOccupied, c.col, c.row, 's', level) ||
            hasWallOnEdge(wallOccupied, c.col, c.row + 1, 'n', level)) return true;
      }
    }
  }
  return false;
}

/**
 * Check whether the placeable can be placed at (col,row,subCol,subRow,dir).
 * Constraints: subtile footprint collision, wall intersection, and any
 * authored map-edge service band.
 * A move preview/commit may name its existing placeable ID so those owned
 * cells are transparent without weakening collisions against anything else.
 */
export function canPlace(
  game, placeable, col, row, subCol, subRow, dir = 0,
  { ignorePlaceableId = null, level = 0 } = {},
) {
  level = normalizeLevel(level);
  const cells = placeable.footprintCells(col, row, subCol, subRow, dir);
  const blocked = [];
  const usesFloor = usesFloorOccupancy(placeable);
  if (usesFloor) {
    for (const c of cells) {
      if (level > 0 && !game.state.infraOccupied[tileKey(c.col, c.row, level)]) {
        blocked.push(c);
        continue;
      }
      const occupant = game.state.subgridOccupied[subtileKey(
        c.col, c.row, c.subCol, c.subRow, level,
      )];
      if (occupant && occupant.id !== ignorePlaceableId) blocked.push(c);
    }
    // The universal bus is a drawn connection rather than a placeable, so it
    // has no entry in subgridOccupied. Its floor-standing service spine still
    // owns the narrow strip beneath the rack; equipment remains free to build
    // flush alongside that strip.
    if (level === 0) {
      const blockedKeys = new Set(blocked.map(cellKey));
      for (const cell of placeableBusBlockedCells(game.state, cells)) {
        if (!blockedKeys.has(cellKey(cell))) blocked.push(cell);
      }
    }
  }
  const wallBlocked = usesFloor && footprintCrossesWall(game.state.wallOccupied, cells, level);
  const mapEdgeConnection = placeable.mapEdgeConnection
    ? resolveMapEdgeConnection(
        cells, game?.state?.mapHalfExtent, placeable.mapEdgeConnection,
      )
    : null;
  const mapEdgeBlocked = !!mapEdgeConnection && !mapEdgeConnection.valid;
  return {
    ok: blocked.length === 0 && !wallBlocked && !mapEdgeBlocked,
    blockedCells: blocked,
    cells,
    wallBlocked,
    mapEdgeBlocked,
    mapEdgeConnection,
  };
}

/**
 * Reasons a preview can refuse. Geometry outranks money: a blocked footprint
 * is the more actionable message, and moving the cursor fixes it.
 */
export const PLACE_BLOCKED = 'blocked';
export const PLACE_WALL = 'wall';
export const PLACE_MAP_EDGE = 'map_edge';
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
  return def?.cost;
}

/**
 * canPlace + affordability, i.e. everything Game._placePlaceableInner will
 * reject on. Returns canPlace's shape plus `affordable`, `reason` (null when
 * the placement would succeed), and `cost` — the actual quoted cost object
 * (fix round 1: exposed so a caller can show the spares line, not just
 * funding, alongside the ghost).
 */
export function previewPlacement(
  game, placeable, col, row, subCol, subRow, dir = 0,
  options = {},
) {
  const geo = canPlace(game, placeable, col, row, subCol, subRow, dir, options);
  const cost = componentCostFor(placeable);
  // Moving an existing placeable is free. Move previews still use this shared
  // helper for collision/wall validation, but must not turn amber (or refuse)
  // merely because the player could not afford to buy the item again.
  const affordable = options.free === true || canAffordCost(game, cost);
  const reason = !geo.ok
    ? (geo.wallBlocked
        ? PLACE_WALL
        : (geo.blockedCells.length > 0 ? PLACE_BLOCKED : PLACE_MAP_EDGE))
    : (affordable ? null : PLACE_UNAFFORDABLE);
  return { ...geo, ok: geo.ok && affordable, affordable, reason, cost };
}
