// src/beamline/junctions.js
//
// Pure helpers for reasoning about junction ports. No state mutation.
// Used by the BeamlineSystem facade and BeamlineInputController.
//
// A "junction" is any placeable whose COMPONENTS[type].role === 'junction'
// (sources, endpoints, dipoles, septa, etc.). Junctions expose named ports
// (entry/exit/linacEntry/...) each with a LOCAL compass side ('back' | 'front'
// | 'left' | 'right'). A placeable's `dir` rotates that layout by k * 90°
// clockwise around the footprint center.

import { COMPONENTS } from '../data/components.js';

// Local side → dir=0 compass side.
const SIDE_TO_COMPASS = {
  back:  'N',
  front: 'S',
  left:  'W',
  right: 'E',
};

// Clockwise compass order, used to rotate by `dir` 90° steps.
const COMPASS_CW = ['N', 'E', 'S', 'W'];

// Unit world-space direction vector for each compass side.
// World coords: +x = east, +z = south (row grows south).
const COMPASS_VEC = {
  N: { x:  0, z: -1 },
  E: { x:  1, z:  0 },
  S: { x:  0, z:  1 },
  W: { x: -1, z:  0 },
};

function normalizeDir(dir) {
  return ((((dir | 0) % 4) + 4) % 4);
}

function rotateCompass(side, dir) {
  const i = COMPASS_CW.indexOf(side);
  if (i < 0) return null;
  return COMPASS_CW[(i + normalizeDir(dir)) % 4];
}

/**
 * Returns true iff COMPONENTS[type] exists and its `role` is 'junction'.
 */
export function isJunctionType(type) {
  if (!type) return false;
  const def = COMPONENTS[type];
  return !!(def && def.role === 'junction');
}

/**
 * Return the rotated compass side ('N'|'E'|'S'|'W') that `portName` faces
 * after the junction is rotated by `placeable.dir`. Returns null if the port
 * (or component def) is unknown.
 */
export function portSide(placeable, portName) {
  if (!placeable || !portName) return null;
  const def = COMPONENTS[placeable.type];
  if (!def || !def.ports) return null;
  const port = def.ports[portName];
  if (!port) return null;
  const base = SIDE_TO_COMPASS[port.side];
  if (!base) return null;
  return rotateCompass(base, placeable.dir || 0);
}

/**
 * Return the array of port names on `placeable` that are NOT currently
 * connected to any pipe endpoint in `beamPipes`. A pipe P connects port `n`
 * iff P.start?.junctionId === placeable.id && P.start.portName === n, or
 * likewise for P.end.
 */
export function availablePorts(placeable, beamPipes) {
  if (!placeable) return [];
  const def = COMPONENTS[placeable.type];
  if (!def || !def.ports) return [];
  // Phase 3 merged utility ports into COMPONENTS[type].ports alongside beam
  // ports. Beam-pipe callers must not see them, so filter on the `utility`
  // marker. Utility-line callers use src/utility/ports.js::availablePorts,
  // which filters by `spec.utility === utilityType` and naturally excludes
  // beam ports.
  const allNames = Object.keys(def.ports).filter(n => !def.ports[n].utility);
  if (allNames.length === 0) return [];

  const connected = new Set();
  const pipes = beamPipes || [];
  for (const pipe of pipes) {
    const s = pipe && pipe.start;
    if (s && s.junctionId === placeable.id && s.portName) connected.add(s.portName);
    const e = pipe && pipe.end;
    if (e && e.junctionId === placeable.id && e.portName) connected.add(e.portName);
  }

  return allNames.filter(n => !connected.has(n));
}

/**
 * Return {x, z} in world coordinates at the center of the specified port on
 * the junction's rotated edge. Returns null if the port or def is missing.
 *
 * Convention (matches InputHandler _attachmentCellsAtProj and placement
 * rendering): with dir=0 the placeable occupies a subW (col-axis) × subL
 * (row-axis) footprint anchored at (col, row, subCol, subRow). A dir of
 * 1 or 3 swaps the two axes.
 *
 * Port position = rotated footprint center plus half the extent along the
 * port's rotated compass side.
 */
export function portWorldPosition(placeable, portName) {
  if (!placeable || !portName) return null;
  const def = COMPONENTS[placeable.type];
  if (!def || !def.ports) return null;
  const port = def.ports[portName];
  if (!port) return null;
  const baseSide = SIDE_TO_COMPASS[port.side];
  if (!baseSide) return null;

  const dir = normalizeDir(placeable.dir || 0);
  const subL = def.subL || 2;
  const subW = def.subW || 2;
  const swap = (dir === 1 || dir === 3);
  const footColSub = swap ? subL : subW;   // sub-unit extent along world x
  const footRowSub = swap ? subW : subL;   // sub-unit extent along world z

  const col = placeable.col || 0;
  const row = placeable.row || 0;
  const subCol = placeable.subCol || 0;
  const subRow = placeable.subRow || 0;

  // Footprint center in world coords (1 sub-unit = 0.5 world units).
  const cx = col * 2 + (subCol + footColSub / 2) * 0.5;
  const cz = row * 2 + (subRow + footRowSub / 2) * 0.5;

  // Rotated compass side the port actually faces in world space.
  const worldSide = rotateCompass(baseSide, dir);
  const vec = COMPASS_VEC[worldSide];
  if (!vec) return null;

  // Half-extent along that side: length/width of the footprint along that
  // world axis, divided by 2, times 0.5 (world-per-sub).
  // If worldSide is N/S (+/-z): extent = footRowSub world units*0.5 = footRowSub * 0.5.
  // Half-extent = footRowSub * 0.25.
  // If worldSide is E/W (+/-x): half-extent = footColSub * 0.25.
  const halfAlongX = footColSub * 0.25;
  const halfAlongZ = footRowSub * 0.25;

  const x = cx + vec.x * halfAlongX;
  const z = cz + vec.z * halfAlongZ;
  return { x, z };
}
