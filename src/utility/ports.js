// src/utility/ports.js
//
// Port helpers for utility lines. Mirrors src/beamline/junctions.js but is
// parameterized on (placeable, def, ...) so it's trivially testable without
// touching the real COMPONENTS registry. A convenience wrapper at the bottom
// (availablePortsByType) does the COMPONENTS lookup for runtime callers.
//
// A port is "utility" if its spec has a `utility` field, e.g.
//   ports: { powerIn: { side: 'left', utility: 'powerCable' } }
//
// Claimed-port detection looks at line.start.placeableId / line.end.placeableId
// (the utility-line equivalent of pipe.start.junctionId on beam pipes).

import { COMPONENTS } from '../data/components.js';
import { UTILITY_TYPES } from './registry.js';

const SIDE_TO_COMPASS = { back: 'N', front: 'S', left: 'W', right: 'E' };
const COMPASS_CW = ['N', 'E', 'S', 'W'];
const COMPASS_VEC = {
  N: { x: 0, z: -1 },
  E: { x: 1, z: 0 },
  S: { x: 0, z: 1 },
  W: { x: -1, z: 0 },
};
const SIDE_VEC = {
  N: { dCol: 0, dRow: -1 },
  E: { dCol: 1, dRow: 0 },
  S: { dCol: 0, dRow: 1 },
  W: { dCol: -1, dRow: 0 },
};

function normalizeDir(d) { return ((((d | 0) % 4) + 4) % 4); }

function rotateCompass(side, dir) {
  const i = COMPASS_CW.indexOf(side);
  if (i < 0) return null;
  return COMPASS_CW[(i + normalizeDir(dir)) % 4];
}

export function getPortSpec(def, portName) {
  if (!def || !def.ports) return null;
  return def.ports[portName] || null;
}

export function isUtilityPort(def, portName) {
  const spec = getPortSpec(def, portName);
  return !!(spec && spec.utility);
}

export function portSide(def, portName, dir) {
  const spec = getPortSpec(def, portName);
  if (!spec) return null;
  const base = SIDE_TO_COMPASS[spec.side];
  if (!base) return null;
  return rotateCompass(base, dir || 0);
}

/**
 * Does a claimed SOURCE port of this utility stay available for more lines?
 *
 * A manifold outlet genuinely feeds several branches, so fluids fan out. A
 * power socket takes one plug: that is what makes a panel's outlet count a
 * resource rather than decoration, and what stops one transformer port wiring
 * an entire facility. Unknown utilities keep the old permissive behaviour so a
 * test's fake port table is unaffected.
 */
function sourceFansOut(utilityType) {
  const d = UTILITY_TYPES[utilityType];
  return !d || d.fansOut !== false;
}

export function availablePorts(placeable, def, utilityType, lines) {
  if (!placeable || !def || !def.ports) return [];
  const claimed = new Set();
  const iter = lines && typeof lines.values === 'function'
    ? lines.values()
    : (lines || []);
  for (const line of iter) {
    if (line && line.start && line.start.placeableId === placeable.id && line.start.portName) {
      claimed.add(line.start.portName);
    }
    if (line && line.end && line.end.placeableId === placeable.id && line.end.portName) {
      claimed.add(line.end.portName);
    }
  }
  const candidates = Object.entries(def.ports)
    .filter(([_, spec]) => spec && spec.utility === utilityType)
    .map(([name, spec]) => ({ name, spec }));
  const fanOut = sourceFansOut(utilityType);
  return candidates
    .filter(({ name, spec }) => !claimed.has(name) || (fanOut && spec.role === 'source'))
    .map(({ name }) => name);
}

/**
 * The port's outward normal in path-coord space ({dCol, dRow}), i.e. the
 * direction a line must leave it along (or arrive against). Null when the
 * placeable/port has no resolvable side.
 */
export function portApproachVec(placeable, def, portName) {
  const side = portSide(def, portName, (placeable && placeable.dir) || 0);
  return (side && SIDE_VEC[side]) || null;
}

export function portMatchesApproach(placeable, def, portName, approachDir, isEnd) {
  const side = portSide(def, portName, placeable && placeable.dir || 0);
  if (!side) return false;
  const vec = SIDE_VEC[side];
  if (!vec) return false;
  const tgt = isEnd
    ? { dCol: -approachDir.dCol, dRow: -approachDir.dRow }
    : approachDir;
  return vec.dCol === tgt.dCol && vec.dRow === tgt.dRow;
}

// A port's `offsetAlong` is authored as a fraction of its face, and the range
// the registry documents is [0.1, 0.9]. Clamping to that here is not about
// tidiness: an offset of 0 or 1 puts the fitting exactly on a footprint CORNER,
// which is a point the adjacent face owns too, so two ports on two different
// faces would silently merge — and on an abutting neighbour's footprint the
// corner is shared outright. Staying a tenth of a face short of each end keeps
// every port unambiguously on the face that declared it.
const MIN_OFFSET_ALONG = 0.1;
const MAX_OFFSET_ALONG = 0.9;

/**
 * How far to slide a port off its face's midpoint, as a signed fraction of the
 * face length. Anything that has not declared an offset — beam ports, older
 * specs, test fixtures — reads as dead centre, so this change moves only the
 * ports that asked to be moved.
 */
function alongOffset(spec) {
  const o = spec && spec.offsetAlong;
  if (!Number.isFinite(o)) return 0;
  return Math.min(MAX_OFFSET_ALONG, Math.max(MIN_OFFSET_ALONG, o)) - 0.5;
}

/**
 * Return {x, z} in world coordinates for the specified port on the placeable's
 * rotated edge.
 *
 * The point is the face's midpoint pushed out to the edge, then slid ALONG the
 * edge by the spec's `offsetAlong` (0 = face start, 0.5 = midpoint, 1 = face
 * end). A port with no `offsetAlong` — every beam entry/exit, and the fixtures
 * in the tests — takes 0.5 and lands exactly where it always did.
 *
 * Which way "along" points is the part worth explaining. `offsetAlong` is
 * authored in the component's own frame, so it has to rotate WITH the body:
 * two ports on one face must keep the same arrangement relative to the machine
 * at all four `dir` values, never mirroring at two of them. That falls out for
 * free by defining the tangent as the outward normal turned one compass step
 * clockwise — i.e. offsets count clockwise around the footprint's perimeter
 * seen from above. Rotation commutes with "turn one step clockwise", so
 * deriving the tangent from the already-rotated WORLD normal gives exactly the
 * same layout the local frame would, with no per-rotation sign table to get
 * wrong.
 *
 * Note the sub-tile routing grid does not have the resolution to keep every
 * pair apart: path coords quantise to 0.5 m, so on a face only 1 m long the
 * two ports draw in separate places but still route from one point. That is a
 * property of the grid, not of the offsets — see test-utility-port-offsets.js.
 */
export function portWorldPosition(placeable, def, portName) {
  if (!placeable || !portName) return null;
  const spec = getPortSpec(def, portName);
  if (!spec) return null;
  const baseSide = SIDE_TO_COMPASS[spec.side];
  if (!baseSide) return null;

  const dir = normalizeDir(placeable.dir || 0);
  const subL = def.subL || 2;
  const subW = def.subW || 2;
  const swap = (dir === 1 || dir === 3);
  const footColSub = swap ? subL : subW;
  const footRowSub = swap ? subW : subL;

  const col = placeable.col || 0;
  const row = placeable.row || 0;
  const subCol = placeable.subCol || 0;
  const subRow = placeable.subRow || 0;

  const cx = col * 2 + (subCol + footColSub / 2) * 0.5;
  const cz = row * 2 + (subRow + footRowSub / 2) * 0.5;

  const worldSide = rotateCompass(baseSide, dir);
  const vec = COMPASS_VEC[worldSide];
  if (!vec) return null;

  const halfAlongX = footColSub * 0.25;
  const halfAlongZ = footRowSub * 0.25;

  // One sub-tile is 0.5 m, so the face's own length in metres is whichever
  // footprint extent runs perpendicular to the normal. `tan` is perpendicular
  // to `vec` by construction, so only one of these two terms is ever non-zero.
  const tan = COMPASS_VEC[rotateCompass(worldSide, 1)];
  const slide = alongOffset(spec);
  const alongX = tan.x * slide * footColSub * 0.5;
  const alongZ = tan.z * slide * footRowSub * 0.5;

  const x = cx + vec.x * halfAlongX + alongX;
  const z = cz + vec.z * halfAlongZ + alongZ;
  return { x, z };
}

// ---------------------------------------------------------------------------
// Convenience wrappers: look up COMPONENTS for runtime callers.
// ---------------------------------------------------------------------------

export function availablePortsByType(placeable, utilityType, lines) {
  const def = COMPONENTS[placeable && placeable.type];
  return availablePorts(placeable, def, utilityType, lines);
}
