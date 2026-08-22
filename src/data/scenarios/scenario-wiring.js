// src/data/scenarios/scenario-wiring.js
//
// Programmatic utility-line wiring for scenario setup functions and the demo
// auto-build. Under Phase 6/7 gating, beamline junctions hard-require their
// power + vacuum sink ports to be connected before the beam will run, so any
// scripted content that places a beamline must also wire it.
//
// wireUtility() builds the same ranked, obstacle-aware Manhattan route the
// interactive tool uses. Authored port normals rank tidy local fitting wraps;
// every service may take a longer subtile route when compact candidates are
// blocked by installed lines or measured 3D equipment. Coordinates are tile units
// (world/2), matching UtilityLineInputController's paths.

import { COMPONENTS } from '../components.js';
import { portApproachVec, portWorldPosition } from '../../utility/ports.js';
import { findUtilityEndpoint } from '../../utility/utility-endpoints.js';
import { resolveUtilityPortName } from '../../utility/port-contracts.js';
import { UTILITY_TYPES } from '../../utility/registry.js';
import {
  buildPortRoutedPaths,
  findObstacleAwareRoute,
} from '../../utility/line-geometry.js';
import { validateDrawLine } from '../../utility/line-drawing.js';
import { buildUtilityRouteObstacles } from '../../utility/route-obstacles.js';
import { usesFlexibleSubtileRouting } from '../../utility/routing-contract.js';

function portAnchor(state, utilityType, ref, defaultRole) {
  // Endpoints, not state.placeables: components carried on beam pipes declare
  // utility ports too (see utility/utility-endpoints.js).
  const p = findUtilityEndpoint(state, ref.id);
  if (!p) return null;
  const def = COMPONENTS[p.type];
  if (!def) return null;
  const portName = resolveUtilityPortName(def, utilityType, ref, defaultRole);
  if (!portName) return null;
  const wp = portWorldPosition(p, def, portName);
  const vec = portApproachVec(p, def, portName);
  if (!wp || !vec) return null;
  // 1 tile = 2 world metres (4 subtiles of 0.5 m).
  return { portName, tile: { col: wp.x / 2, row: wp.z / 2 }, vec };
}

/**
 * Draw a utility line from one placeable port to another.
 *
 * @param {Game} game
 * @param {string} utilityType  'powerCable' | 'vacuumPipe' | ...
 * @param {{id: string, port?: string, role?: string|string[], side?: string, index?: number}} from
 *   source-end explicit port or capability selector
 * @param {{id: string, port?: string, role?: string|string[], side?: string, index?: number}} to
 *   sink-end explicit port or capability selector
 * @param {{preferVerticalFirst?: boolean}} [opts]
 * @returns {string|null} the new line id, or null on failure (logged).
 */
export function wireUtility(game, utilityType, from, to, opts = {}) {
  const state = game.state;
  const a = portAnchor(state, utilityType, from, ['source', 'pass']);
  const b = portAnchor(state, utilityType, to, ['sink', 'pass']);
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
  const start = { placeableId: from.id, portName: a.portName };
  const end = { placeableId: to.id, portName: b.portName };
  const routeOpts = {
    preferVerticalFirst: !!opts.preferVerticalFirst,
    allowZeroLength: true,
  };
  const candidates = buildPortRoutedPaths(routeStart, a.vec, routeEnd, b.vec, routeOpts);
  let path = candidates.find(candidate => validateDrawLine(state, {
    utilityType, start, end, path: candidate,
  }).ok) || null;
  if (!path && usesFlexibleSubtileRouting(descriptor)) {
    const obstacles = buildUtilityRouteObstacles(state, utilityType, {
      startRef: start,
      endRef: end,
    });
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
  // Unknown/legacy utilities retain the deterministic ranked candidates above;
  // descriptors outside the shared routing profile skip the obstacle search.
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
