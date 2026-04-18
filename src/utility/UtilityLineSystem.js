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
   * Cascade removal — called by Game.removePlaceable after the placeable is
   * gone. Removes all lines that referenced this placeable as start or end.
   * Emits one event per affected utility type.
   */
  onPlaceableRemoved(placeableId) {
    const lines = this.state && this.state.utilityLines;
    if (!lines) return;
    const affected = new Set();
    for (const [id, line] of lines) {
      if ((line.start && line.start.placeableId === placeableId) ||
          (line.end   && line.end.placeableId   === placeableId)) {
        lines.delete(id);
        affected.add(line.utilityType);
      }
    }
    for (const t of affected) this.emit('utilityLinesChanged', { utilityType: t });
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
