// src/beamline/BeamlineSystem.js
//
// Thin facade over the pure validators in junctions.js, pipe-drawing.js, and
// pipe-placements.js. This class owns the mutation side: on successful
// validation it writes into state.beamPipes / state.placeables and emits
// events via the injected callbacks. On failure it calls `log(reason, 'bad')`
// and returns null (or undefined for void methods).
//
// Collaborators (injected by Game.js):
//   - placePlaceable(opts) → id | false: handles footprint/collision (the
//     junction goes through Game.js's sub-grid occupancy pipeline).
//   - removePlaceable(id) → boolean: frees grid cells.
//   - emit(event, data): event bus (same strings Game.js emits today).
//   - log(message, type): soft-reason logger ('bad' on failure).
//   - spend(costs), canAfford(costs): cost hooks (wired up later).
//   - nextPipeId() → string, nextPlacementId() → string.

import { COMPONENTS } from '../data/components.js';
import { validateDrawPipe, validateExtendPipe } from './pipe-drawing.js';
import { findSlot } from './pipe-placements.js';

// 4 sub-units per tile: path distance is measured in tiles, subL in sub-units.
const SUB_PER_TILE = 4;

// Map validator reason codes → player-facing messages. Validators return terse
// identifiers so tests can assert on them; the HUD log needs something a human
// can act on.
const REASON_MESSAGES = {
  invalid_path: 'path has fewer than 2 points',
  not_straight: 'pipe must be a straight run (no corners)',
  invalid_start: 'starting junction missing or invalid',
  invalid_end: 'ending junction missing or invalid',
  port_taken: 'that port is already connected',
  port_mismatch: "pipe doesn't align with port direction",
  overlap: 'pipe overlaps an existing one',
  pipe_not_found: 'pipe no longer exists',
  no_open_end: 'pipe has no open end to extend',
  not_collinear: 'extension must continue in the same direction',
};

function reasonMessage(reason) {
  return REASON_MESSAGES[reason] || reason;
}

// Per-tile drift cost is the baseline for beam-pipe pricing; fall back to the
// legacy 10000 if the component registry is somehow missing drift.
function driftCostPerTile() {
  const def = COMPONENTS.drift;
  return def && def.cost && typeof def.cost.funding === 'number' ? def.cost.funding : 10000;
}

// Legacy formula from Game.createBeamPipe: max(1, floor(perTile * max(tileDist, 0.25))).
// Clamping tileDist to 0.25 ensures even zero-drag stubs aren't free.
function pipeCost(tileDist) {
  const perTile = driftCostPerTile();
  return { funding: Math.max(1, Math.floor(perTile * Math.max(tileDist, 0.25))) };
}

export class BeamlineSystem {
  constructor(opts = {}) {
    this.state = opts.state;
    this.emit = opts.emit || (() => {});
    this.log = opts.log || (() => {});
    this.spend = opts.spend || (() => {});
    this.canAfford = opts.canAfford || (() => true);
    this.placePlaceable = opts.placePlaceable;
    this.removePlaceable = opts.removePlaceable;
    this.nextPipeId = opts.nextPipeId || (() => 'bp_' + Math.random().toString(36).slice(2));
    this.nextPlacementId = opts.nextPlacementId
      || (() => 'pl_' + Math.random().toString(36).slice(2));
  }

  // -------------------------------------------------------------------------
  // Junction lifecycle.
  // -------------------------------------------------------------------------

  /**
   * Register a junction placeable via the injected placePlaceable callback.
   * Returns the new junction id, or null on failure.
   *
   * @param {{type:string, col:number, row:number, subCol?:number,
   *         subRow?:number, dir?:number, params?:object}} opts
   */
  placeJunction(opts) {
    if (!opts || !opts.type) {
      this.log('placeJunction: missing type', 'bad');
      return null;
    }
    if (typeof this.placePlaceable !== 'function') {
      this.log('placeJunction: no placePlaceable callback', 'bad');
      return null;
    }
    const id = this.placePlaceable({
      type: opts.type,
      col: opts.col,
      row: opts.row,
      subCol: opts.subCol || 0,
      subRow: opts.subRow || 0,
      dir: opts.dir || 0,
      params: opts.params || {},
    });
    if (!id) {
      // placePlaceable already logs — but keep it defensive.
      return null;
    }
    this.emit('placeableChanged');
    this.emit('beamlineChanged');
    return id;
  }

  /**
   * Remove a junction. Any pipes whose start/end refer to this junction get
   * that end opened (set to null) but the pipe and its placements remain.
   * Frees grid cells via removePlaceable.
   */
  removeJunction(id) {
    if (!id) return;
    const state = this.state;
    const pipes = (state && state.beamPipes) || [];
    for (const pipe of pipes) {
      if (pipe.start && pipe.start.junctionId === id) pipe.start = null;
      if (pipe.end && pipe.end.junctionId === id) pipe.end = null;
    }
    if (typeof this.removePlaceable === 'function') {
      this.removePlaceable(id);
    }
    this.emit('placeableChanged');
    this.emit('beamlineChanged');
  }

  // -------------------------------------------------------------------------
  // Pipe lifecycle.
  // -------------------------------------------------------------------------

  /**
   * Draw a new pipe. Delegates to validateDrawPipe. On success, pushes the
   * pipe into state.beamPipes with a freshly-assigned id and returns it.
   * Returns null on failure.
   */
  drawPipe(start, end, path) {
    const result = validateDrawPipe(this.state, { start, end, path });
    if (!result.ok) {
      console.warn('[pipe-draw] drawPipe REJECTED: ' + result.reason);
      this.log("Can't draw pipe: " + reasonMessage(result.reason), 'bad');
      return null;
    }
    const pipe = result.pipe;
    const cost = pipeCost(pipe.subL / SUB_PER_TILE);
    if (!this.canAfford(cost)) {
      console.warn('[pipe-draw] drawPipe REJECTED: cant_afford');
      this.log("Can't afford beam pipe!", 'bad');
      return null;
    }
    this.spend(cost);
    pipe.id = this.nextPipeId();
    const state = this.state;
    if (!Array.isArray(state.beamPipes)) state.beamPipes = [];
    state.beamPipes.push(pipe);
    this.emit('beamlineChanged');
    return pipe.id;
  }

  /**
   * Extend an existing pipe at its open end. Delegates to validateExtendPipe.
   * On success, replaces the pipe in state.beamPipes.
   * Returns pipeId on success, null on failure.
   */
  extendPipe(pipeId, additionalPath) {
    const result = validateExtendPipe(this.state, pipeId, additionalPath);
    if (!result.ok) {
      console.warn('[pipe-draw] extendPipe REJECTED: ' + result.reason);
      this.log("Can't extend pipe: " + reasonMessage(result.reason), 'bad');
      return null;
    }
    const pipes = this.state.beamPipes || [];
    const idx = pipes.findIndex(p => p && p.id === pipeId);
    if (idx < 0) {
      console.warn('[pipe-draw] extendPipe REJECTED: pipe_not_found');
      this.log("Can't extend pipe: pipe no longer exists", 'bad');
      return null;
    }
    // Charge only the ADDITION: diff in subL between the merged and the old
    // pipe, not the whole merged length.
    const oldSubL = pipes[idx].subL || 0;
    const addedSubL = Math.max(0, (result.pipe.subL || 0) - oldSubL);
    const cost = pipeCost(addedSubL / SUB_PER_TILE);
    if (!this.canAfford(cost)) {
      console.warn('[pipe-draw] extendPipe REJECTED: cant_afford');
      this.log("Can't afford beam pipe!", 'bad');
      return null;
    }
    this.spend(cost);
    pipes[idx] = result.pipe;
    this.emit('beamlineChanged');
    return pipeId;
  }

  /**
   * Remove a pipe and all of its placements. Junctions are NOT touched — their
   * ports are freed by the pipe's disappearance from state.beamPipes.
   */
  removePipe(pipeId) {
    const state = this.state;
    if (!state || !Array.isArray(state.beamPipes)) return;
    const before = state.beamPipes.length;
    state.beamPipes = state.beamPipes.filter(p => p.id !== pipeId);
    if (state.beamPipes.length < before) {
      this.emit('beamlineChanged');
    }
  }

  // -------------------------------------------------------------------------
  // Pipe placements.
  // -------------------------------------------------------------------------

  /**
   * Add a placement to a pipe. Delegates to findSlot. On success, swaps in
   * the new placements array on the pipe and returns the new placement id.
   * Returns null on failure.
   *
   * @param {string} pipeId
   * @param {{type:string, position:number, subL?:number, params?:object,
   *          mode:'snap'|'insert'|'replace'}} opts
   */
  placeOnPipe(pipeId, opts = {}) {
    const state = this.state;
    const pipes = (state && state.beamPipes) || [];
    const pipe = pipes.find(p => p && p.id === pipeId);
    if (!pipe) {
      console.warn('[pipe-draw] placeOnPipe REJECTED: pipe_not_found');
      this.log('placeOnPipe: pipe_not_found', 'bad');
      return null;
    }
    const def = COMPONENTS[opts.type];
    const subL = (typeof opts.subL === 'number' && opts.subL > 0)
      ? opts.subL
      : (def && typeof def.subL === 'number' ? def.subL : 2);

    // Track pre-existing placement ids so we can identify the newly-added one
    // after findSlot returns (findSlot uses idGenerator for the new id; other
    // entries keep their original ids in snap/insert, or get dropped in
    // replace).
    const priorIds = new Set((pipe.placements || []).map(pl => pl.id));

    const result = findSlot(pipe, {
      type: opts.type,
      requestedPosition: opts.position,
      subL,
      mode: opts.mode,
      params: opts.params || {},
      idGenerator: () => this.nextPlacementId(),
    });
    if (!result.ok) {
      console.warn('[pipe-draw] placeOnPipe REJECTED: ' + result.reason);
      this.log("Can't place on pipe: " + reasonMessage(result.reason), 'bad');
      return null;
    }
    pipe.placements = result.placements;
    this.emit('beamlineChanged');
    // The new placement is the one whose id is not in priorIds.
    const newPl = pipe.placements.find(pl => !priorIds.has(pl.id));
    return newPl ? newPl.id : null;
  }

  /**
   * Remove a placement from a pipe.
   */
  removeFromPipe(pipeId, placementId) {
    const state = this.state;
    const pipes = (state && state.beamPipes) || [];
    const pipe = pipes.find(p => p && p.id === pipeId);
    if (!pipe) return;
    const before = (pipe.placements || []).length;
    pipe.placements = (pipe.placements || []).filter(pl => pl.id !== placementId);
    if (pipe.placements.length < before) {
      this.emit('beamlineChanged');
    }
  }

  /**
   * Return the placement (if any) whose interval contains `position`.
   */
  placementAt(pipeId, position) {
    const state = this.state;
    const pipes = (state && state.beamPipes) || [];
    const pipe = pipes.find(p => p && p.id === pipeId);
    if (!pipe || !pipe.subL) return null;
    for (const pl of pipe.placements || []) {
      const start = pl.position;
      const end = pl.position + (pl.subL / pipe.subL);
      if (position >= start && position <= end) return pl;
    }
    return null;
  }
}

export default BeamlineSystem;
