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
  return Object.entries(def.ports)
    .filter(([_, spec]) => spec && spec.utility === utilityType)
    .map(([name]) => name)
    .filter(n => !claimed.has(n));
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

/**
 * Return {x, z} in world coordinates at the center of the specified port on
 * the placeable's rotated edge. Ported verbatim from
 * src/beamline/junctions.js portWorldPosition (formulas unchanged) but looks
 * up the port spec via the passed-in `def` rather than COMPONENTS.
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

  const x = cx + vec.x * halfAlongX;
  const z = cz + vec.z * halfAlongZ;
  return { x, z };
}

// ---------------------------------------------------------------------------
// Convenience wrappers: look up COMPONENTS for runtime callers.
// ---------------------------------------------------------------------------

export function availablePortsByType(placeable, utilityType, lines) {
  const def = COMPONENTS[placeable && placeable.type];
  return availablePorts(placeable, def, utilityType, lines);
}
