// src/utility/UtilityLineSystem.js
//
// Facade over the utility-line pure validator in line-drawing.js. Owns
// mutation of state.utilityLines (a Map<id, UtilityLine>). Mirrors the shape
// of BeamlineSystem: on success it writes to state and emits events; on
// failure it logs and returns null/false.
//
// Collaborators (injected by Game.js):
//   - state: the shared Game state. Must carry `state.utilityLines` (created
//     on first addLine if absent) and the fields line-drawing consumes
//     (placeables, defs, utilityLines).
//   - emit(event, data): event bus.
//   - log(message, type): soft-reason logger ('bad' on failure).
//   - nextLineId() → string: id generator.

import { validateDrawLine } from './line-drawing.js';
import { buildManhattanPath } from './line-geometry.js';

const EPS = 1e-6;

/** Which axis a leg runs along: 'v' (col fixed), 'h' (row fixed), or null. */
function legAxis(a, b) {
  const dc = Math.abs(b.col - a.col);
  const dr = Math.abs(b.row - a.row);
  if (dc < EPS && dr < EPS) return null;
  if (dc < EPS) return 'v';
  if (dr < EPS) return 'h';
  return null;
}

/**
 * Slide the leg that meets `which` terminal so the terminal lands on
 * `newPos`, leaving the rest of the polyline exactly where the player drew
 * it. Returns a fresh path, or null when the original leg was degenerate.
 *
 * Preserving the leg's AXIS is the whole trick: validateDrawLine checks the
 * terminal leg's direction against the port's facing, so a reroute that
 * rebuilt the path from scratch would flip a north-facing feed into a
 * west-facing one and be rejected even where there was plenty of room.
 */
function translateTerminal(path, which, newPos) {
  const n = path.length;
  if (n < 2) return null;
  const t = which === 'start' ? 0 : n - 1;
  const nb = which === 'start' ? 1 : n - 2;
  const axis = legAxis(path[t], path[nb]);
  if (!axis) return null;

  // Two-point path: the far end is the only other vertex and it belongs to a
  // port that is NOT moving, so it can't absorb the offset. Re-route through a
  // single bend instead, placed so the moving end's leg keeps its axis.
  if (n === 2) {
    const far = path[nb];
    const rebuilt = which === 'start'
      ? buildManhattanPath(newPos, far, { preferVerticalFirst: axis === 'v' })
      : buildManhattanPath(far, newPos, { preferVerticalFirst: axis === 'h' });
    return rebuilt;
  }

  const out = path.map(p => ({ col: p.col, row: p.row }));
  out[t] = { col: newPos.col, row: newPos.row };
  // The interior corner rides along on the perpendicular axis, which leaves
  // the segment beyond it untouched.
  if (axis === 'v') out[nb].col = newPos.col;
  else out[nb].row = newPos.row;
  return out;
}

/** Drop vertices that coincide with their predecessor. */
function dropDegenerate(path) {
  const out = [];
  for (const p of path) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.col - p.col) < EPS && Math.abs(prev.row - p.row) < EPS) continue;
    out.push({ col: p.col, row: p.row });
  }
  return out;
}

/**
 * `newPortPos` is either a single `{col, row}` point (line coordinates, i.e.
 * portWorldPosition / 2) or a `portName → {col, row}` record. The record form
 * is what callers need when one placeable anchors both ends of a line, since
 * the two ports sit at different places.
 */
function pickPortPos(newPortPos, portName) {
  if (!newPortPos) return null;
  if (Number.isFinite(newPortPos.col) && Number.isFinite(newPortPos.row)) {
    return { col: newPortPos.col, row: newPortPos.row };
  }
  const p = newPortPos[portName];
  if (p && Number.isFinite(p.col) && Number.isFinite(p.row)) {
    return { col: p.col, row: p.row };
  }
  return null;
}

// Map validator reason codes → player-facing messages. Same pattern as
// BeamlineSystem.REASON_MESSAGES.
const REASON_MESSAGES = {
  invalid_path:         'path has fewer than 2 points',
  not_manhattan:        'path must use 90° bends only',
  overlap_same_type:    'another line of this type already runs here',
  invalid_start:        'starting port is missing or invalid',
  invalid_end:          'ending port is missing or invalid',
  port_type_mismatch:   'port type does not match utility',
  port_taken:           'that port is already connected',
  port_mismatch_start:  "line doesn't align with start port direction",
  port_mismatch_end:    "line doesn't align with end port direction",
};

function reasonMessage(r) { return REASON_MESSAGES[r] || r; }

export class UtilityLineSystem {
  constructor(opts = {}) {
    this.state = opts.state;
    this.emit = opts.emit || (() => {});
    this.log = opts.log || (() => {});
    this.nextLineId = opts.nextLineId
      || (() => 'ul_' + Math.random().toString(36).slice(2));
  }

  /**
   * Draw a new utility line. Delegates to validateDrawLine. On success, stores
   * the line in state.utilityLines with a freshly-assigned id and emits
   * `utilityLinesChanged` with `{utilityType}`. Returns the new line id, or
   * null on validation failure.
   */
  addLine(opts) {
    const result = validateDrawLine(this.state, opts);
    if (!result.ok) {
      this.log("Can't place utility line: " + reasonMessage(result.reason), 'bad');
      return null;
    }
    const line = result.line;
    line.id = this.nextLineId();
    if (!this.state.utilityLines) this.state.utilityLines = new Map();
    this.state.utilityLines.set(line.id, line);
    this.emit('utilityLinesChanged', { utilityType: line.utilityType });
    return line.id;
  }

  /**
   * Remove a line by id. Returns true on success, false if no such line.
   * Emits `utilityLinesChanged` with the removed line's utility type.
   */
  removeLine(id) {
    const lines = this.state && this.state.utilityLines;
    if (!lines) return false;
    const line = lines.get(id);
    if (!line) return false;
    lines.delete(id);
    this.emit('utilityLinesChanged', { utilityType: line.utilityType });
    return true;
  }

  /**
   * Called by Game.removePlaceable after the placeable is gone. Nulls out
   * any line endpoints that referenced this placeable — the line itself
   * persists as a dangling open-ended segment, which the player can later
   * rewire. Emits one event per affected utility type.
   */
  onPlaceableRemoved(placeableId) {
    const lines = this.state && this.state.utilityLines;
    if (!lines) return;
    const affected = new Set();
    for (const line of lines.values()) {
      let changed = false;
      if (line.start && line.start.placeableId === placeableId) {
        line.start = null;
        changed = true;
      }
      if (line.end && line.end.placeableId === placeableId) {
        line.end = null;
        changed = true;
      }
      if (changed) affected.add(line.utilityType);
    }
    for (const t of affected) this.emit('utilityLinesChanged', { utilityType: t });
  }

  /**
   * A placeable this line is wired to has MOVED. Best-effort: slide the leg
   * (or legs) that meet its port(s) onto the new port position and re-validate
   * the whole line. On success the line survives untouched apart from its
   * path; on failure it falls back to the existing convention — endpoint
   * nulled, path kept as a dangling segment the player rewires — which is
   * exactly what onPlaceableRemoved does.
   *
   * Returns `{ok:true}`, `{ok:false, dangled:true}`, or
   * `{ok:false, dangled:false, reason}` when there was nothing to re-anchor.
   * The dangled count is what the designer's Apply preview reports as
   * "N utility lines need rewiring".
   *
   * @param {string} lineId
   * @param {string} placeableId  the placeable that moved
   * @param {{col:number,row:number}|Object<string,{col:number,row:number}>} newPortPos
   */
  reanchorLine(lineId, placeableId, newPortPos) {
    const lines = this.state && this.state.utilityLines;
    const line = lines && typeof lines.get === 'function' ? lines.get(lineId) : null;
    if (!line) return { ok: false, dangled: false, reason: 'line_not_found' };

    const atStart = !!(line.start && line.start.placeableId === placeableId);
    const atEnd = !!(line.end && line.end.placeableId === placeableId);
    if (!atStart && !atEnd) return { ok: false, dangled: false, reason: 'not_anchored' };

    const dangle = () => {
      // Same fallback as onPlaceableRemoved: keep the geometry the player drew
      // so they can see where the feed used to run, but stop claiming it is
      // connected — a line still pointing at a port it no longer reaches would
      // feed the solver a link that does not physically exist.
      if (atStart) line.start = null;
      if (atEnd) line.end = null;
      this.emit('utilityLinesChanged', { utilityType: line.utilityType });
      return { ok: false, dangled: true };
    };

    let path = (line.path || []).map(p => ({ col: p.col, row: p.row }));
    if (path.length < 2) return dangle();

    if (atStart) {
      const pos = pickPortPos(newPortPos, line.start.portName);
      if (!pos) return dangle();
      path = translateTerminal(path, 'start', pos);
      if (!path) return dangle();
    }
    if (atEnd) {
      const pos = pickPortPos(newPortPos, line.end.portName);
      if (!pos) return dangle();
      // Runs on the path the start pass produced, so a line anchored to this
      // placeable at BOTH ends moves both of its legs rather than the last one
      // silently winning.
      path = translateTerminal(path, 'end', pos);
      if (!path) return dangle();
    }

    path = dropDegenerate(path);
    if (path.length < 2) return dangle();

    // Validate against every OTHER line: this line is still in state, so
    // leaving it in would have it collide with its own old path and occupy its
    // own ports — every reanchor would "fail" and dangle.
    const others = [];
    for (const other of lines.values()) if (other !== line) others.push(other);
    const probeState = { ...this.state, utilityLines: others };

    const result = validateDrawLine(probeState, {
      utilityType: line.utilityType,
      start: line.start,
      end: line.end,
      path,
    });
    if (!result.ok) return dangle();

    line.path = result.line.path;
    line.subL = result.line.subL;
    this.emit('utilityLinesChanged', { utilityType: line.utilityType });
    return { ok: true };
  }

  /** All utility lines, in Map insertion order. */
  listLines() {
    const lines = (this.state && this.state.utilityLines) || new Map();
    return Array.from(lines.values());
  }

  /** Lines filtered to a single utility type. */
  listLinesByType(utilityType) {
    return this.listLines().filter(l => l.utilityType === utilityType);
  }
}

export default UtilityLineSystem;
