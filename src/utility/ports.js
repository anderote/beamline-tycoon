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
import {
  wallFixtureDir,
  wallFixturePose,
  wallPassThroughTerminalOffset,
} from '../game/wall-fixture-geometry.js';

const SIDE_TO_COMPASS = { back: 'N', front: 'S', left: 'W', right: 'E' };
const OPPOSITE_SIDE = { back: 'front', front: 'back', left: 'right', right: 'left' };
const COMPASS_CW = ['N', 'E', 'S', 'W'];
const SIDE_VEC = {
  N: { dCol: 0, dRow: -1 },
  E: { dCol: 1, dRow: 0 },
  S: { dCol: 0, dRow: 1 },
  W: { dCol: -1, dRow: 0 },
};

function normalizeDir(d) { return ((((d | 0) % 4) + 4) % 4); }

/** Wall-mounted hardware always faces away from its actual supporting edge. */
export function placeableDirection(placeable, def = null) {
  if (placeable?.wallMount && def?.mount === 'wall') {
    return wallFixtureDir(placeable.wallMount);
  }
  return normalizeDir(placeable?.dir || 0);
}

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

function effectiveSide(spec, portsFlipped = false) {
  if (!spec) return null;
  // Port flipping is a utility-routing convenience, not a beam-optics
  // mutation. Entry/exit ports share the same side vocabulary but must stay
  // put or an F press would silently change the accelerator graph.
  if (!portsFlipped || !spec.utility) return spec.side;
  return OPPOSITE_SIDE[spec.side] || spec.side;
}

export function portSide(def, portName, dir, portsFlipped = false) {
  const spec = getPortSpec(def, portName);
  if (!spec) return null;
  const base = SIDE_TO_COMPASS[effectiveSide(spec, portsFlipped)];
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
  const side = portSide(
    def, portName,
    placeableDirection(placeable, def),
    placeable?.portsFlipped === true,
  );
  return (side && SIDE_VEC[side]) || null;
}

export function portMatchesApproach(placeable, def, portName, approachDir, isEnd) {
  const spec = getPortSpec(def, portName);
  // A rated wall bushing has a fixed connector location on each face, but
  // flexible HV cable may leave that terminal in any cardinal direction.
  // Keep its side for the rendered anchor while relaxing only draw-path
  // approach validation.
  if (spec?.omnidirectional === true) return true;
  const side = portSide(
    def, portName,
    placeableDirection(placeable, def),
    placeable?.portsFlipped === true,
  );
  if (!side) return false;
  const vec = SIDE_VEC[side];
  if (!vec) return false;
  const tgt = isEnd
    ? { dCol: -approachDir.dCol, dRow: -approachDir.dRow }
    : approachDir;
  return vec.dCol === tgt.dCol && vec.dRow === tgt.dRow;
}

// ---------------------------------------------------------------------------
// The component's local frame.
//
// A placed component is a footprint centred somewhere in the world, rotated in
// 90° steps, with the model drawn in an unrotated local frame: +X across the
// width (subW), +Z along the length (subL), origin at the footprint centre.
// `portWorldPosition` below has always worked in that frame implicitly — it
// picked a side, took the footprint half-extent, and rotated. The three helpers
// here name those steps so the renderer can do the same arithmetic with a
// *measured* offset instead of the footprint one (see utility/port-anchors.js)
// without re-deriving — or worse, re-guessing — the frame.
// ---------------------------------------------------------------------------

const SIDE_TO_LOCAL = {
  left:  { axis: 'x', sign: -1 },
  right: { axis: 'x', sign:  1 },
  back:  { axis: 'z', sign: -1 },
  front: { axis: 'z', sign:  1 },
};

// Keep authored ports off footprint corners, where adjacent faces would
// otherwise become ambiguous. Missing offsets retain the historical midpoint.
function alongOffset(spec) {
  const value = spec && spec.offsetAlong;
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.9, Math.max(0.1, value)) - 0.5;
}

/**
 * World {x, z} of the footprint's centre, or null. This is the point every
 * port on the placeable is measured from.
 *
 * The footprint's own extent swaps with a quarter turn (a 1×4 part occupies
 * 4×1 sub-cells at dir 1), which is why `dir` is read here and nowhere in the
 * local-frame helpers below.
 */
export function placeableCenterWorld(placeable, def) {
  if (!placeable) return null;
  if (Number.isFinite(placeable.worldX) && Number.isFinite(placeable.worldZ)) {
    return { x: placeable.worldX, z: placeable.worldZ };
  }
  if (placeable.wallMount && def?.mount === 'wall') {
    const pose = def.wallPassThrough === true
      ? wallFixturePose(placeable.wallMount, 0)
      : wallFixturePose(placeable.wallMount);
    if (pose) return { x: pose.x, z: pose.z };
  }
  const dir = placeableDirection(placeable, def);
  const subL = (def && def.subL) || 2;
  const subW = (def && def.subW) || 2;
  const swap = (dir === 1 || dir === 3);
  const footColSub = swap ? subL : subW;
  const footRowSub = swap ? subW : subL;

  const col = placeable.col || 0;
  const row = placeable.row || 0;
  const subCol = placeable.subCol || 0;
  const subRow = placeable.subRow || 0;

  const x = col * 2 + (subCol + footColSub / 2) * 0.5;
  const z = row * 2 + (subRow + footRowSub / 2) * 0.5;
  return { x, z };
}

/**
 * The axis and direction a port faces in the component's UNROTATED frame, or
 * null when the port has no resolvable side. Matches SIDE_TO_COMPASS + SIDE_VEC
 * evaluated at dir 0, reading dCol as x and dRow as z.
 *
 * @returns {{axis: 'x'|'z', sign: 1|-1}|null}
 */
export function portLocalAxis(def, portName, portsFlipped = false) {
  const spec = getPortSpec(def, portName);
  if (!spec) return null;
  return SIDE_TO_LOCAL[effectiveSide(spec, portsFlipped)] || null;
}

/**
 * Half the footprint's size in metres, in the LOCAL frame — so no dir swap:
 * x is always half the width, z always half the length. The swap belongs to
 * the rotation into world space, which `rotateLocalOffset` does.
 */
export function footprintHalfExtents(def) {
  const subW = (def && def.subW) || 2;
  const subL = (def && def.subL) || 2;
  return { x: subW * 0.25, z: subL * 0.25 };
}

/**
 * Rotate a local {x, z} offset into world space by the placeable's `dir`.
 *
 * Done as a table of exact 90° steps rather than with sin/cos: the fallback
 * path in port-anchors.js has to reproduce `portWorldPosition` to the bit, and
 * Math.sin(Math.PI) is not zero. The steps match `rotateCompass` — dir 1 is a
 * quarter turn that sends +X to +Z, the same sense as the renderer's
 * `rotY = -dir * PI/2`.
 */
export function rotateLocalOffset(off, dir) {
  const x = off.x, z = off.z;
  switch (normalizeDir(dir || 0)) {
    case 1:  return { x: -z, z: x };
    case 2:  return { x: -x, z: -z };
    case 3:  return { x: z, z: -x };
    default: return { x, z };
  }
}

/**
 * Return {x, z} in world coordinates at the center of the specified port on
 * the placeable's rotated edge.
 *
 * This is the sim's answer: snapping, pathing, overlap and pricing all read it,
 * so the numbers it returns must not move. It is expressed through the local
 * frame helpers above — footprint half-extent outward along the port's local
 * axis, rotated by `dir` — which is arithmetically identical to the original
 * "rotate the compass side, then step half the rotated footprint" form.
 */
export function portWorldPosition(placeable, def, portName) {
  if (!placeable || !portName) return null;
  const spec = getPortSpec(def, portName);
  const local = portLocalAxis(def, portName, placeable.portsFlipped === true);
  if (!local) return null;
  const centre = placeableCenterWorld(placeable, def);
  if (!centre) return null;

  const half = footprintHalfExtents(def);
  const halfLat = local.axis === 'x' ? half.x : half.z;
  const lateralExtent = def?.wallPassThrough === true && placeable.wallMount
    ? wallPassThroughTerminalOffset(placeable.wallMount)
    : halfLat;
  const lat = local.sign * lateralExtent;
  // offsetAlong advances clockwise around the unrotated footprint. For an
  // outward normal (x,z), that tangent is (-z,x), scaled by the face length.
  const slide = alongOffset(spec);
  const normal = local.axis === 'x'
    ? { x: local.sign, z: 0 }
    : { x: 0, z: local.sign };
  const faceLength = local.axis === 'x' ? half.z * 2 : half.x * 2;
  const localOffset = local.axis === 'x'
    ? { x: lat, z: normal.x * slide * faceLength }
    : { x: -normal.z * slide * faceLength, z: lat };
  const off = rotateLocalOffset(
    localOffset,
    placeableDirection(placeable, def),
  );
  return { x: centre.x + off.x, z: centre.z + off.z };
}

// ---------------------------------------------------------------------------
// Convenience wrappers: look up COMPONENTS for runtime callers.
// ---------------------------------------------------------------------------

export function availablePortsByType(placeable, utilityType, lines) {
  const def = COMPONENTS[placeable && placeable.type];
  return availablePorts(placeable, def, utilityType, lines);
}
