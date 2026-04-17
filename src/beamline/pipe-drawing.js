// src/beamline/pipe-drawing.js
//
// Pure validation helpers for drawing and extending beampipes. No state
// mutation. BeamlineSystem calls these and, on success, pushes/swaps the
// returned pipe into state.
//
// Rules enforced:
//   - Straight-only paths (single axis, no corners).
//   - Port compatibility (pipe axis aligns with port's compass side).
//   - Port-taken check (existing pipes claim ports).
//   - Overlap check against existing pipes (0.25-tile expanded tolerance).
//
// Rejection reasons:
//   invalid_path, not_straight, invalid_start, invalid_end,
//   port_taken, port_mismatch, overlap,
//   pipe_not_found, no_open_end, not_collinear.

import { portSide, availablePorts } from './junctions.js';
import { expandPipePath } from './pipe-geometry.js';

const EPS = 1e-6;

// Map compass side → unit (dCol, dRow) vector. +row = south.
const SIDE_VEC = {
  N: { dCol:  0, dRow: -1 },
  E: { dCol:  1, dRow:  0 },
  S: { dCol:  0, dRow:  1 },
  W: { dCol: -1, dRow:  0 },
};

function reject(reason) { return { ok: false, reason }; }

// -----------------------------------------------------------------------
// Path shape helpers.
// -----------------------------------------------------------------------

function isStraightPath(path) {
  if (!Array.isArray(path) || path.length < 2) return false;
  // Vertical: all cols equal. Horizontal: all rows equal.
  const col0 = path[0].col;
  const row0 = path[0].row;
  let allSameCol = true, allSameRow = true;
  for (const p of path) {
    if (Math.abs(p.col - col0) > EPS) allSameCol = false;
    if (Math.abs(p.row - row0) > EPS) allSameRow = false;
  }
  if (!allSameCol && !allSameRow) return false;
  // Reject zero-length paths (all points identical).
  if (allSameCol && allSameRow) return false;
  return true;
}

function segmentDirection(a, b) {
  const dCol = b.col - a.col;
  const dRow = b.row - a.row;
  if (Math.abs(dCol) > EPS && Math.abs(dRow) < EPS) {
    return { dCol: Math.sign(dCol), dRow: 0 };
  }
  if (Math.abs(dRow) > EPS && Math.abs(dCol) < EPS) {
    return { dCol: 0, dRow: Math.sign(dRow) };
  }
  return null;
}

function pathTotalDist(path) {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    total += Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
  }
  return total;
}

function computeSubL(path) {
  return Math.max(1, Math.round(pathTotalDist(path) * 4));
}

// -----------------------------------------------------------------------
// Port compatibility.
// -----------------------------------------------------------------------

// Port at `start` of pipe: the port faces outward along the pipe's first
// segment — so port's compass vector must equal the first-segment direction.
//
// Port at `end` of pipe: the port faces outward away from the approach
// direction — so port's compass vector must equal the NEGATIVE of the
// last-segment direction.
function portMatchesApproach(placeable, portName, approachDir, isEnd) {
  const side = portSide(placeable, portName);
  if (!side) return false;
  const vec = SIDE_VEC[side];
  if (!vec) return false;
  const target = isEnd
    ? { dCol: -approachDir.dCol, dRow: -approachDir.dRow }
    : approachDir;
  return vec.dCol === target.dCol && vec.dRow === target.dRow;
}

// -----------------------------------------------------------------------
// Overlap check.
// -----------------------------------------------------------------------

function pointsOverlap(a, b) {
  return Math.abs(a.col - b.col) < 0.25 - EPS
      && Math.abs(a.row - b.row) < 0.25 - EPS;
}

function pathOverlapsAny(newPath, pipes, excludePipeId) {
  const newExpanded = expandPipePath(newPath);
  for (const pipe of pipes) {
    if (excludePipeId && pipe.id === excludePipeId) continue;
    const ex = expandPipePath(pipe.path || []);
    for (const np of newExpanded) {
      for (const ep of ex) {
        if (pointsOverlap(np, ep)) return true;
      }
    }
  }
  return false;
}

// -----------------------------------------------------------------------
// Lookup helpers.
// -----------------------------------------------------------------------

function findPlaceable(state, id) {
  const list = state && state.placeables;
  if (!Array.isArray(list)) return null;
  for (const p of list) if (p && p.id === id) return p;
  return null;
}

function isPortTaken(state, junctionId, portName, excludePipeId) {
  const pipes = (state && state.beamPipes) || [];
  for (const pipe of pipes) {
    if (excludePipeId && pipe.id === excludePipeId) continue;
    const s = pipe.start;
    if (s && s.junctionId === junctionId && s.portName === portName) return true;
    const e = pipe.end;
    if (e && e.junctionId === junctionId && e.portName === portName) return true;
  }
  return false;
}

// -----------------------------------------------------------------------
// Public: validateDrawPipe
// -----------------------------------------------------------------------

export function validateDrawPipe(state, { start, end, path } = {}) {
  if (!Array.isArray(path) || path.length < 2) return reject('invalid_path');
  if (!isStraightPath(path)) return reject('not_straight');

  // Resolve endpoints if provided.
  if (start) {
    if (!start.junctionId || !start.portName) return reject('invalid_start');
    const p = findPlaceable(state, start.junctionId);
    if (!p) return reject('invalid_start');
    const firstDir = segmentDirection(path[0], path[1]);
    if (!firstDir) return reject('not_straight');
    if (isPortTaken(state, start.junctionId, start.portName)) return reject('port_taken');
    if (!portMatchesApproach(p, start.portName, firstDir, false)) {
      return reject('port_mismatch');
    }
  }

  if (end) {
    if (!end.junctionId || !end.portName) return reject('invalid_end');
    const p = findPlaceable(state, end.junctionId);
    if (!p) return reject('invalid_end');
    const n = path.length;
    const lastDir = segmentDirection(path[n - 2], path[n - 1]);
    if (!lastDir) return reject('not_straight');
    if (isPortTaken(state, end.junctionId, end.portName)) return reject('port_taken');
    if (!portMatchesApproach(p, end.portName, lastDir, true)) {
      return reject('port_mismatch');
    }
  }

  // Overlap check against existing pipes (no self-extension here).
  const pipes = (state && state.beamPipes) || [];
  if (pathOverlapsAny(path, pipes, null)) return reject('overlap');

  return {
    ok: true,
    pipe: {
      id: null,
      start: start || null,
      end: end || null,
      path: path.map(pt => ({ col: pt.col, row: pt.row })),
      subL: computeSubL(path),
      placements: [],
    },
  };
}

// -----------------------------------------------------------------------
// Public: validateExtendPipe
// -----------------------------------------------------------------------

export function validateExtendPipe(state, pipeId, additionalPath) {
  const pipes = (state && state.beamPipes) || [];
  const pipe = pipes.find(p => p && p.id === pipeId);
  if (!pipe) return reject('pipe_not_found');

  const startOpen = pipe.start == null;
  const endOpen = pipe.end == null;
  if (!startOpen && !endOpen) return reject('no_open_end');

  if (!Array.isArray(additionalPath) || additionalPath.length < 2) {
    return reject('invalid_path');
  }
  if (!isStraightPath(additionalPath)) return reject('not_straight');

  const existingPath = pipe.path || [];
  if (existingPath.length < 2) return reject('invalid_path');

  // Determine which end is open and corresponding terminal point + existing
  // last-segment direction.
  let openSide;       // 'start' | 'end'
  let existingDir;    // direction of existing segment adjacent to the open end
  if (endOpen) {
    openSide = 'end';
    existingDir = segmentDirection(
      existingPath[existingPath.length - 2],
      existingPath[existingPath.length - 1]
    );
  } else {
    openSide = 'start';
    // Direction of the first segment, oriented outward from the open end:
    // the open end is at path[0], so "outward" points from path[1] → path[0].
    existingDir = segmentDirection(existingPath[1], existingPath[0]);
  }
  if (!existingDir) return reject('not_straight');

  // additionalPath must be collinear with the existing segment at the open
  // end AND extend OUTWARD (same axis, same sign).
  const addDir = segmentDirection(additionalPath[0], additionalPath[1]);
  if (!addDir) return reject('not_collinear');
  if (addDir.dCol !== existingDir.dCol || addDir.dRow !== existingDir.dRow) {
    return reject('not_collinear');
  }

  // Every pair in additionalPath must also share this axis.
  for (let i = 0; i < additionalPath.length - 1; i++) {
    const d = segmentDirection(additionalPath[i], additionalPath[i + 1]);
    if (!d) return reject('not_collinear');
    if (d.dCol !== addDir.dCol || d.dRow !== addDir.dRow) {
      return reject('not_collinear');
    }
  }

  // Build merged path.
  let newPath;
  if (openSide === 'end') {
    // Drop the shared joint if additionalPath[0] coincides with existing tail.
    const tail = existingPath[existingPath.length - 1];
    const head = additionalPath[0];
    const shared = Math.abs(tail.col - head.col) < EPS && Math.abs(tail.row - head.row) < EPS;
    const tailAddition = shared ? additionalPath.slice(1) : additionalPath.slice();
    newPath = [...existingPath, ...tailAddition];
  } else {
    // start open: additionalPath outward from path[0]; reverse it so the
    // merged path reads tailward-to-junction-to-old-end.
    const firstExisting = existingPath[0];
    const lastAdd = additionalPath[additionalPath.length - 1];
    const shared = Math.abs(firstExisting.col - lastAdd.col) < EPS
                && Math.abs(firstExisting.row - lastAdd.row) < EPS;
    const addRev = additionalPath.slice().reverse();
    const prefix = shared ? addRev.slice(0, -1) : addRev;
    newPath = [...prefix, ...existingPath];
  }

  // Overlap check against OTHER pipes (exclude self).
  if (pathOverlapsAny(newPath, pipes, pipeId)) return reject('overlap');

  // Recompute subL and remap placement positions to preserve absolute metres.
  const oldSubL = pipe.subL || computeSubL(existingPath);
  const newSubL = computeSubL(newPath);
  const placements = (pipe.placements || []).map(pl => ({
    ...pl,
    position: newSubL > 0 ? (pl.position * oldSubL) / newSubL : pl.position,
  }));

  return {
    ok: true,
    pipe: {
      id: pipe.id,
      start: pipe.start || null,
      end: pipe.end || null,
      path: newPath.map(pt => ({ col: pt.col, row: pt.row })),
      subL: newSubL,
      placements,
    },
  };
}
