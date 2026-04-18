// src/utility/line-drawing.js
//
// Pure validator for drawing a utility line between two ports. Mirrors the
// shape of src/beamline/pipe-drawing.js but with these differences:
//   - Paths may contain 90° Manhattan bends (no diagonals).
//   - Overlap is checked only against existing lines of the SAME utilityType
//     (different utilities route independently).
//   - Endpoints reference placeables via `placeableId` (not `junctionId`).
//   - Rejection reasons are utility-specific and distinguish start/end port
//     alignment failures.
//
// Rejection reasons:
//   invalid_path, not_manhattan, overlap_same_type,
//   invalid_start, invalid_end, port_type_mismatch, port_taken,
//   port_mismatch_start, port_mismatch_end.

import { COMPONENTS } from '../data/components.js';
import {
  getPortSpec,
  availablePorts,
  portMatchesApproach,
} from './ports.js';
import {
  pathLengthSubUnits,
  expandPath,
} from './line-geometry.js';

const EPS = 1e-6;

function reject(reason) { return { ok: false, reason }; }

// ---------------------------------------------------------------------------
// Path shape validators.
// ---------------------------------------------------------------------------

/**
 * Each adjacent pair must be axis-aligned (one of dCol, dRow is zero). Zero
 * length segments are tolerated here (buildManhattanPath never produces them;
 * tests must guard against invalid_path separately).
 */
function isManhattanPath(path) {
  for (let i = 0; i < path.length - 1; i++) {
    const dc = path[i + 1].col - path[i].col;
    const dr = path[i + 1].row - path[i].row;
    if (Math.abs(dc) > EPS && Math.abs(dr) > EPS) return false;
  }
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

// ---------------------------------------------------------------------------
// Overlap check (same-type only).
// ---------------------------------------------------------------------------

function pointsOverlap(a, b) {
  return Math.abs(a.col - b.col) < 0.25 - EPS
      && Math.abs(a.row - b.row) < 0.25 - EPS;
}

function pathOverlapsSameType(newPath, lines, utilityType) {
  const newExpanded = expandPath(newPath);
  const iter = lines && typeof lines.values === 'function'
    ? lines.values()
    : (lines || []);
  for (const line of iter) {
    if (!line || line.utilityType !== utilityType) continue;
    const existing = expandPath(line.path || []);
    for (const np of newExpanded) {
      for (const ep of existing) {
        if (pointsOverlap(np, ep)) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function findPlaceable(state, id) {
  const list = state && state.placeables;
  if (!Array.isArray(list)) return null;
  for (const p of list) if (p && p.id === id) return p;
  return null;
}

function lookupDef(state, type) {
  if (state && state.defs) {
    // Both Map and plain object are acceptable.
    if (typeof state.defs.get === 'function') return state.defs.get(type) || null;
    return state.defs[type] || null;
  }
  return (type && COMPONENTS[type]) || null;
}

function isPortTaken(state, placeableId, portName) {
  const lines = state && state.utilityLines;
  const iter = lines && typeof lines.values === 'function'
    ? lines.values()
    : (lines || []);
  for (const line of iter) {
    if (!line) continue;
    if (line.start && line.start.placeableId === placeableId && line.start.portName === portName) {
      return true;
    }
    if (line.end && line.end.placeableId === placeableId && line.end.portName === portName) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public: validateDrawLine
// ---------------------------------------------------------------------------

export function validateDrawLine(state, { utilityType, start, end, path } = {}) {
  // Path shape.
  if (!Array.isArray(path) || path.length < 2) return reject('invalid_path');
  if (!isManhattanPath(path)) return reject('not_manhattan');

  // Require at least one non-degenerate segment.
  let totalDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    totalDist += Math.abs(path[i + 1].col - path[i].col)
              + Math.abs(path[i + 1].row - path[i].row);
  }
  if (totalDist < EPS) return reject('invalid_path');

  // Resolve start endpoint.
  if (start) {
    if (!start.placeableId || !start.portName) return reject('invalid_start');
    const p = findPlaceable(state, start.placeableId);
    if (!p) return reject('invalid_start');
    const def = lookupDef(state, p.type);
    if (!def) return reject('invalid_start');
    const spec = getPortSpec(def, start.portName);
    if (!spec) return reject('invalid_start');
    if (spec.utility !== utilityType) return reject('port_type_mismatch');
    if (isPortTaken(state, start.placeableId, start.portName)) return reject('port_taken');

    const firstDir = segmentDirection(path[0], path[1]);
    if (!firstDir) return reject('not_manhattan');
    if (!portMatchesApproach(p, def, start.portName, firstDir, false)) {
      return reject('port_mismatch_start');
    }
  }

  // Resolve end endpoint.
  if (end) {
    if (!end.placeableId || !end.portName) return reject('invalid_end');
    const p = findPlaceable(state, end.placeableId);
    if (!p) return reject('invalid_end');
    const def = lookupDef(state, p.type);
    if (!def) return reject('invalid_end');
    const spec = getPortSpec(def, end.portName);
    if (!spec) return reject('invalid_end');
    if (spec.utility !== utilityType) return reject('port_type_mismatch');
    if (isPortTaken(state, end.placeableId, end.portName)) return reject('port_taken');

    const n = path.length;
    const lastDir = segmentDirection(path[n - 2], path[n - 1]);
    if (!lastDir) return reject('not_manhattan');
    if (!portMatchesApproach(p, def, end.portName, lastDir, true)) {
      return reject('port_mismatch_end');
    }
  }

  // Overlap against same-type lines only.
  const lines = state && state.utilityLines;
  if (pathOverlapsSameType(path, lines, utilityType)) return reject('overlap_same_type');

  return {
    ok: true,
    line: {
      utilityType,
      start: start || null,
      end: end || null,
      path: path.map(pt => ({ col: pt.col, row: pt.row })),
      subL: pathLengthSubUnits(path),
    },
  };
}

// Re-export reason codes as a convenience for callers who want to pattern-match
// without magic strings.
export const REASONS = Object.freeze({
  invalid_path: 'invalid_path',
  not_manhattan: 'not_manhattan',
  overlap_same_type: 'overlap_same_type',
  invalid_start: 'invalid_start',
  invalid_end: 'invalid_end',
  port_type_mismatch: 'port_type_mismatch',
  port_taken: 'port_taken',
  port_mismatch_start: 'port_mismatch_start',
  port_mismatch_end: 'port_mismatch_end',
});
