// src/data/scenarios/scenario-wiring.js
//
// Programmatic utility-line wiring for scenario setup functions and the demo
// auto-build. Under Phase 6/7 gating, beamline junctions hard-require their
// power + vacuum sink ports to be connected before the beam will run, so any
// scripted content that places a beamline must also wire it.
//
// wireUtility() builds the same ranked, obstacle-aware Manhattan route the
// interactive tool uses. Directional services leave and enter along their
// authored port normals; rigid services may take a longer service aisle when
// the compact L/U candidates are blocked. Coordinates are tile units
// (world/2), matching UtilityLineInputController's paths.

import { COMPONENTS } from '../components.js';
import { portSide, portWorldPosition } from '../../utility/ports.js';
import { findUtilityEndpoint } from '../../utility/utility-endpoints.js';
import { UTILITY_TYPES } from '../../utility/registry.js';
import {
  buildPortRoutedPaths,
  findObstacleAwareRoute,
} from '../../utility/line-geometry.js';
import { validateDrawLine } from '../../utility/line-drawing.js';
import { buildRigidRouteObstacles } from '../../utility/route-obstacles.js';

const SIDE_VEC = {
  N: { dCol: 0, dRow: -1 },
  E: { dCol: 1, dRow: 0 },
  S: { dCol: 0, dRow: 1 },
  W: { dCol: -1, dRow: 0 },
};

const EPS = 1e-9;

function portAnchor(state, placeableId, portName) {
  // Endpoints, not state.placeables: components carried on beam pipes declare
  // utility ports too (see utility/utility-endpoints.js).
  const p = findUtilityEndpoint(state, placeableId);
  if (!p) return null;
  const def = COMPONENTS[p.type];
  if (!def) return null;
  const wp = portWorldPosition(p, def, portName);
  const side = portSide(def, portName, p.dir || 0);
  const vec = side ? SIDE_VEC[side] : null;
  if (!wp || !vec) return null;
  // 1 tile = 2 world metres (4 subtiles of 0.5 m).
  return { tile: { col: wp.x / 2, row: wp.z / 2 }, vec };
}

/**
 * Draw a utility line from one placeable port to another.
 *
 * @param {Game} game
 * @param {string} utilityType  'powerCable' | 'vacuumPipe' | ...
 * @param {{id: string, port: string}} from  source-end placeable/port
 * @param {{id: string, port: string}} to    sink-end placeable/port
 * @param {{stub?: number}} [opts]  stub = how far (tiles) the line runs
 *   straight out of each port before bending (default 0.5).
 * @returns {string|null} the new line id, or null on failure (logged).
 */
export function wireUtility(game, utilityType, from, to, opts = {}) {
  const state = game.state;
  const a = portAnchor(state, from.id, from.port);
  const b = portAnchor(state, to.id, to.port);
  if (!a || !b) {
    console.warn('[scenario-wiring] missing port anchor', utilityType, from, to);
    return null;
  }
  const descriptor = UTILITY_TYPES[utilityType] || {};
  const routeStart = {
    col: Math.round(a.tile.col * 4) / 4,
    row: Math.round(a.tile.row * 4) / 4,
  };
  const routeEnd = {
    col: Math.round(b.tile.col * 4) / 4,
    row: Math.round(b.tile.row * 4) / 4,
  };
  const start = { placeableId: from.id, portName: from.port };
  const end = { placeableId: to.id, portName: to.port };
  const routeOpts = {
    preferVerticalFirst: !!opts.preferVerticalFirst,
    portClearance: descriptor.portClearance !== false,
    portTailTiles: opts.stub ?? descriptor.portTailTiles,
    minStraightTiles: descriptor.minStraightTiles,
  };
  const candidates = buildPortRoutedPaths(routeStart, a.vec, routeEnd, b.vec, routeOpts);
  let path = candidates.find(candidate => validateDrawLine(state, {
    utilityType, start, end, path: candidate,
  }).ok) || null;
  if (!path && descriptor.routingProfile === 'rigid') {
    const obstacles = buildRigidRouteObstacles(state, utilityType, { startRef: start, endRef: end });
    const detour = findObstacleAwareRoute(routeStart, a.vec, routeEnd, b.vec, {
      ...routeOpts,
      blocked: obstacles.isBlocked,
      bendPenalty: descriptor.bendPenalty,
      searchMarginTiles: descriptor.searchMarginTiles,
      maxExpanded: descriptor.maxRouteExpanded,
    });
    if (detour && validateDrawLine(state, {
      utilityType, start, end, path: detour,
    }).ok) path = detour;
  }
  // Unknown/legacy utilities keep the historical deterministic route.
  if (!path && !descriptor.routingProfile) {
    const stub = opts.stub ?? 0.5;
    const p0 = a.tile;
    const p1 = { col: p0.col + a.vec.dCol * stub, row: p0.row + a.vec.dRow * stub };
    const p3 = b.tile;
    const p2 = { col: p3.col + b.vec.dCol * stub, row: p3.row + b.vec.dRow * stub };
    const corner = { col: p2.col, row: p1.row };
    const raw = [p0, p1, corner, p2, p3];
    path = raw.filter((pt, i) => i === 0
      || Math.abs(pt.col - raw[i - 1].col) > EPS
      || Math.abs(pt.row - raw[i - 1].row) > EPS);
  }
  if (!path) {
    console.warn('[scenario-wiring] no routed path', utilityType, from, to);
    return null;
  }
  const id = game.utilityLineSystem.addLine({
    utilityType,
    start,
    end,
    path,
  });
  if (!id) {
    console.warn('[scenario-wiring] addLine rejected', utilityType, from, to, path);
  }
  return id;
}
