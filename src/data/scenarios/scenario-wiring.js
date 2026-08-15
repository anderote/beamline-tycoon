// src/data/scenarios/scenario-wiring.js
//
// Programmatic utility-line wiring for scenario setup functions and the demo
// auto-build. Under Phase 6/7 gating, beamline junctions hard-require their
// power + vacuum sink ports to be connected before the beam will run, so any
// scripted content that places a beamline must also wire it.
//
// wireUtility() builds a Manhattan path between two placeable ports that
// satisfies validateDrawLine's port-approach rules: the path leaves the start
// port along its outward side vector, bends at most twice, and enters the end
// port against its outward side vector. Coordinates are tile units (world/2),
// matching UtilityLineInputController's paths.

import { COMPONENTS } from '../components.js';
import { portSide, portWorldPosition } from '../../utility/ports.js';
import { findUtilityEndpoint } from '../../utility/utility-endpoints.js';
import { resolveUtilityPortName } from '../../utility/port-contracts.js';

const SIDE_VEC = {
  N: { dCol: 0, dRow: -1 },
  E: { dCol: 1, dRow: 0 },
  S: { dCol: 0, dRow: 1 },
  W: { dCol: -1, dRow: 0 },
};

const EPS = 1e-9;

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
  const side = portSide(def, portName, p.dir || 0);
  const vec = side ? SIDE_VEC[side] : null;
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
 * @param {{stub?: number}} [opts]  stub = how far (tiles) the line runs
 *   straight out of each port before bending (default 0.5).
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
  const stub = opts.stub ?? 0.5;
  const p0 = a.tile;
  const p1 = { col: p0.col + a.vec.dCol * stub, row: p0.row + a.vec.dRow * stub };
  const p3 = b.tile;
  const p2 = { col: p3.col + b.vec.dCol * stub, row: p3.row + b.vec.dRow * stub };
  // Try both legal one-corner orders. Scripted layouts should use the same
  // routing flexibility the interactive tool provides; pinning one bend order
  // made unrelated equipment moves silently invalidate scenario wiring.
  const candidateRaws = [
    [p0, p1, { col: p2.col, row: p1.row }, p2, p3],
    [p0, p1, { col: p1.col, row: p2.row }, p2, p3],
  ];
  // Dense scripted facilities can occupy both direct elbows. Try a small set
  // of deterministic outer corridors before giving up; this mirrors a player
  // dragging the run around an existing tray without introducing a pathfinder
  // or nondeterminism into scenario generation.
  for (const clearance of [0.5, 1, 1.5, 2, 3, 4]) {
    for (const row of [Math.min(p1.row, p2.row) - clearance, Math.max(p1.row, p2.row) + clearance]) {
      candidateRaws.push([
        p0, p1, { col: p1.col, row }, { col: p2.col, row }, p2, p3,
      ]);
    }
    for (const col of [Math.min(p1.col, p2.col) - clearance, Math.max(p1.col, p2.col) + clearance]) {
      candidateRaws.push([
        p0, p1, { col, row: p1.row }, { col, row: p2.row }, p2, p3,
      ]);
    }
  }
  let lastPath = null;
  for (const raw of candidateRaws) {
    // Drop consecutive duplicate points (degenerate zero-length segments).
    const path = raw.filter((pt, i) => i === 0
      || Math.abs(pt.col - raw[i - 1].col) > EPS
      || Math.abs(pt.row - raw[i - 1].row) > EPS);
    lastPath = path;
    const id = game.utilityLineSystem.addLine({
      utilityType,
      start: { placeableId: from.id, portName: a.portName },
      end: { placeableId: to.id, portName: b.portName },
      path,
    });
    if (id) return id;
  }
  console.warn('[scenario-wiring] addLine rejected', utilityType, from, to, lastPath);
  return null;
}
