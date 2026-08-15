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
//   - movePlaceable(id, pose) → boolean: re-poses an existing placeable in
//     place, keeping its id (Game.movePlaceable).
//   - emit(event, data): event bus (same strings Game.js emits today).
//   - log(message, type): soft-reason logger ('bad' on failure).
//   - spend(costs), canAfford(costs): cost hooks.
//   - isUnlocked(componentDef) → boolean: research gate (Game.isComponentUnlocked).
//   - nextPipeId() → string, nextPlacementId() → string.

import { COMPONENTS, commissioningSpecialtyFor } from '../data/components.js';
import { validateDrawPipe, validateExtendPipe } from './pipe-drawing.js';
import {
  validateSplitPipe, validateMergePipes, validateTrimPipe, validateRemovePipeSection,
} from './pipe-splice.js';
import { findSlot, placementContainsPosition } from './pipe-placements.js';
import { seedComponentParams } from './component-params.js';
import { portSide, availablePorts } from './junctions.js';

// 4 sub-units per tile: path distance is measured in tiles, subL in sub-units.
const SUB_PER_TILE = 4;

// Unit path-space direction for each rotated compass side, matching
// pipe-drawing.js's SIDE_VEC. Used by attachPipeEnd to check a terminal
// against the port it is being bound to.
const SIDE_VEC = {
  N: { dCol: 0, dRow: -1 },
  E: { dCol: 1, dRow: 0 },
  S: { dCol: 0, dRow: 1 },
  W: { dCol: -1, dRow: 0 },
};

const DIR_EPS = 1e-6;

// Unit direction from a to b, or null when the step is diagonal or zero.
function segmentDirection(a, b) {
  if (!a || !b) return null;
  const dCol = b.col - a.col;
  const dRow = b.row - a.row;
  if (Math.abs(dCol) > DIR_EPS && Math.abs(dRow) < DIR_EPS) {
    return { dCol: Math.sign(dCol), dRow: 0 };
  }
  if (Math.abs(dRow) > DIR_EPS && Math.abs(dCol) < DIR_EPS) {
    return { dCol: 0, dRow: Math.sign(dRow) };
  }
  return null;
}

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
  // Shared by extendPipe and trimPipe: both need a free terminal, so the
  // wording can't name one verb ("...to extend" reads as a bug on a trim).
  no_open_end: 'pipe has no open end — both ends are attached',
  // Shared by extendPipe and mergePipes, so the wording has to describe the
  // geometry rather than one verb: both reject when the two runs don't lie on
  // a single straight line.
  not_collinear: 'pipes must lie on the same straight line',
  // pipe-splice.js (split / merge / trim).
  invalid_pipe: 'pipe is bent or has no length',
  invalid_position: 'invalid split position or gap size',
  gap_too_large: 'pipe is too short to fit that here',
  stub_too_short: 'no room for a pipe stub on both sides — move the insertion point',
  placement_in_gap: 'something is already mounted where the gap would go',
  placement_beyond_new_end: 'something is mounted on the section being removed',
  not_adjacent: 'pipes must meet end to end',
  invalid_length: 'new length must be shorter than the pipe and at least 1 sub-unit',
  invalid_section: 'that section is not part of this pipe',
  // attachPipeEnd.
  invalid_end_side: "pipe end must be 'start' or 'end'",
  end_taken: 'that pipe end is already attached to a module',
  invalid_junction: 'module missing or invalid',
  port_not_found: 'that module has no such beam port',
};

function reasonMessage(reason) {
  return REASON_MESSAGES[reason] || reason;
}

// Fix round 1 (staff-professions-3, jobs-and-gates, task 5): a beamline
// component's spares cost, shared by every path that can ever mint one —
// Game._placePlaceableInner (junctions), placeOnPipe below (on-pipe
// placements), DesignPlacer (whole designs, junctions AND placements alike),
// and src/game/placement.js's preview (so the ghost agrees with what the
// real placement will actually charge). One implementation, imported
// everywhere, rather than four copies of `Math.ceil(funding / 5000)` that
// only agreed with each other by convention — which is exactly how the
// preview and the real check drifted apart before this fix round.
// Fix round 3: which resource(s) in `cost` are short against `resources`,
// as player-facing text ("need 30 more spares") — extracted from
// Game._missingResourceLabel (fix round 1) into a pure function so
// BeamlineSystem.placeOnPipe can give the SAME "name the blocker" treatment
// its refusal log gets that Game._placePlaceableInner's already has, without
// reaching into a private method on a class it only ever talks to through
// injected callbacks. Game.js's own _missingResourceLabel is now a thin
// wrapper over this. Only meaningful to call after affordability has
// already failed for this same `cost` against `resources`.
export function missingResourceLabel(resources, cost) {
  const short = [];
  for (const [r, a] of Object.entries(cost || {})) {
    const have = (resources && resources[r]) || 0;
    if (have < a) short.push(`need ${a - have} more ${r}`);
  }
  return short.length ? short.join(', ') : 'insufficient funds';
}

// Per-tile drift cost is the baseline for beam-pipe pricing; fall back to the
// legacy 10000 if the component registry is somehow missing drift.
function driftCostPerTile() {
  const def = COMPONENTS.drift;
  return def && def.cost && typeof def.cost.funding === 'number' ? def.cost.funding : 10000;
}

// Legacy formula from Game.createBeamPipe: max(1, floor(perTile * max(tileDist, 0.25))).
// Clamping tileDist to 0.25 ensures even zero-drag stubs aren't free.
export function pipeCost(tileDist) {
  const perTile = driftCostPerTile();
  return { funding: Math.max(1, Math.floor(perTile * Math.max(tileDist, 0.25))) };
}

// Manhattan tile length of a pipe path — the same measure drawPipe prices.
export function pipeTileDist(path) {
  let d = 0;
  for (let i = 0; i < ((path && path.length) || 0) - 1; i++) {
    d += Math.abs(path[i + 1].col - path[i].col) + Math.abs(path[i + 1].row - path[i].row);
  }
  return d;
}

// Single source of truth for "what does demolishing this pipe pay?". The
// demolish tooltip and Game.removeBeamPipe both call this so the number the
// player is shown is the number they get, and so the refund can never exceed
// what pipeCost() charged.
export function pipeRefund(pipe) {
  return Math.floor(pipeCost(pipeTileDist(pipe && pipe.path)).funding * 0.5);
}

export class BeamlineSystem {
  constructor(opts = {}) {
    this.state = opts.state;
    this.emit = opts.emit || (() => {});
    this.log = opts.log || (() => {});
    this.spend = opts.spend || (() => {});
    this.canAfford = opts.canAfford || (() => true);
    this.isUnlocked = opts.isUnlocked || (() => true);
    this.placePlaceable = opts.placePlaceable;
    this.removePlaceable = opts.removePlaceable;
    this.movePlaceable = opts.movePlaceable;
    // Called with the id of an on-pipe placement that has just ceased to
    // exist. Placements are utility endpoints (utility/utility-endpoints.js),
    // so a dropped one has to release any line wired to it — otherwise the
    // line keeps pointing at a dead id, in state and in every save.
    this.onPlacementRemoved = opts.onPlacementRemoved || (() => {});
    // Fallback id sources are deterministic counters — Game always supplies
    // state-backed generators; these only serve standalone/test construction.
    let pipeCtr = 0, plCtr = 0;
    this.nextPipeId = opts.nextPipeId || (() => 'bp_' + (++pipeCtr));
    this.nextPlacementId = opts.nextPlacementId || (() => 'pl_' + (++plCtr));
  }

  // -------------------------------------------------------------------------
  // Junction lifecycle.
  // -------------------------------------------------------------------------

  /**
   * Register a junction placeable via the injected placePlaceable callback.
   * Returns the new junction id, or null on failure.
   *
   * @param {{type:string, col:number, row:number, subCol?:number,
   *         subRow?:number, dir?:number, params?:object,
   *         free?:boolean, silent?:boolean}} opts
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
      portsFlipped: opts.portsFlipped === true,
      // Forward cost/log suppression so free/silent placements (tests, move
      // mode, scenario builders) behave like every other placeable kind.
      free: !!opts.free,
      silent: !!opts.silent,
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

  /**
   * Slide an existing junction to a new pose WITHOUT destroying it. Returns
   * true on success; on refusal nothing is mutated and false comes back after
   * Game.movePlaceable has logged why (occupied cells, a wall, a bad
   * destination).
   *
   * This is the primitive the designer's downstream displacement runs on: an
   * insertion that needs 2 m of room pushes everything after it 2 m along the
   * polyline. Doing that as removeJunction + placeJunction would mint a new id
   * for every displaced module, and the id is what utility lines, pipe
   * start/end refs and the beamline registry all anchor to — a "make room"
   * edit would silently unwire the machine it was rearranging.
   *
   * Deliberately NOT done here:
   *   - money. A move is not a purchase; charging or refunding would let a
   *     player mint funding by nudging a module back and forth.
   *   - state.beamPipes. The junction's pipes almost certainly need redrawing,
   *     but the planner emits explicit trim/extend/draw ops for that; guessing
   *     here would fight the plan it is executing.
   *
   * @param {string} id
   * @param {{col:number, row:number, subCol?:number, subRow?:number,
   *          dir?:number}} pose  `dir` omitted keeps the current rotation.
   */
  moveJunction(id, pose = {}) {
    if (!id) {
      this.log('moveJunction: missing junction id', 'bad');
      return false;
    }
    if (typeof this.movePlaceable !== 'function') {
      this.log('moveJunction: no movePlaceable callback', 'bad');
      return false;
    }
    if (!this.movePlaceable(id, pose)) return false;
    this.emit('placeableChanged');
    this.emit('beamlineChanged');
    return true;
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
      this.log("Can't draw pipe: " + reasonMessage(result.reason), 'bad');
      return null;
    }
    const pipe = result.pipe;
    const cost = pipeCost(pipe.subL / SUB_PER_TILE);
    if (!this.canAfford(cost)) {
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
      this.log("Can't extend pipe: " + reasonMessage(result.reason), 'bad');
      return null;
    }
    const pipes = this.state.beamPipes || [];
    const idx = pipes.findIndex(p => p && p.id === pipeId);
    if (idx < 0) {
      this.log("Can't extend pipe: pipe no longer exists", 'bad');
      return null;
    }
    // Charge only the ADDITION: diff in subL between the merged and the old
    // pipe, not the whole merged length.
    const oldSubL = pipes[idx].subL || 0;
    const addedSubL = Math.max(0, (result.pipe.subL || 0) - oldSubL);
    const cost = pipeCost(addedSubL / SUB_PER_TILE);
    if (!this.canAfford(cost)) {
      this.log("Can't afford beam pipe!", 'bad');
      return null;
    }
    this.spend(cost);
    pipes[idx] = result.pipe;
    this.emit('beamlineChanged');
    return pipeId;
  }

  /**
   * Bind one OPEN terminal of an existing pipe to a junction port.
   * Returns true on success, false on failure.
   *
   * drawPipe is the only other way a pipe end acquires a junction reference,
   * and it can only do it while the pipe is being created. splitPipe and
   * trimPipe deliberately leave the fresh end OPEN — the junction that closes
   * the hole does not exist yet at that moment — so without this method the
   * designer's apply plan could cut a run in two and place a module in the
   * gap, but never re-join the beam path: the flattener would stop at the
   * first stub and everything downstream would drop off the beamline.
   *
   * Validation mirrors validateDrawPipe's endpoint rules, so a pipe end can
   * never reach a state drawPipe would have refused: the port must exist, be
   * free, and face the way the pipe actually arrives. Like validateDrawPipe
   * this is a DIRECTION check, not a distance one — neither path asserts the
   * terminal point sits exactly on the port.
   *
   * @param {string} pipeId
   * @param {'start'|'end'} end   which terminal to bind
   * @param {string} junctionId
   * @param {string} portName
   */
  attachPipeEnd(pipeId, end, junctionId, portName) {
    const fail = (reason) => {
      this.log("Can't attach pipe: " + reasonMessage(reason), 'bad');
      return false;
    };
    if (end !== 'start' && end !== 'end') return fail('invalid_end_side');

    const state = this.state;
    const pipes = (state && state.beamPipes) || [];
    const pipe = pipes.find(p => p && p.id === pipeId);
    if (!pipe) return fail('pipe_not_found');
    if (pipe[end]) return fail('end_taken');

    const junction = ((state && state.placeables) || []).find(p => p && p.id === junctionId);
    if (!junction) return fail('invalid_junction');

    // portSide() answers null for an unknown port and for a component with no
    // ports at all, which is the same "there is nothing to bind to" answer.
    const side = portSide(junction, portName);
    if (!side) return fail('port_not_found');
    if (!availablePorts(junction, pipes).includes(portName)) return fail('port_taken');

    const path = pipe.path || [];
    if (path.length < 2) return fail('invalid_path');
    // A port faces OUTWARD from its junction. At the pipe's start the pipe
    // leaves along that outward vector; at its end the pipe arrives against
    // it, so the approach direction is negated before comparing.
    const approach = end === 'start'
      ? segmentDirection(path[0], path[1])
      : segmentDirection(path[path.length - 2], path[path.length - 1]);
    if (!approach) return fail('not_straight');
    const outward = end === 'start'
      ? approach
      : { dCol: -approach.dCol, dRow: -approach.dRow };
    const vec = SIDE_VEC[side];
    if (!vec || vec.dCol !== outward.dCol || vec.dRow !== outward.dRow) {
      return fail('port_mismatch');
    }

    pipe[end] = { junctionId, portName };
    this.emit('beamlineChanged');
    return true;
  }

  /**
   * Remove a pipe and all of its placements. Junctions are NOT touched — their
   * ports are freed by the pipe's disappearance from state.beamPipes.
   */
  removePipe(pipeId) {
    const state = this.state;
    if (!state || !Array.isArray(state.beamPipes)) return;
    const doomed = state.beamPipes.find(p => p.id === pipeId);
    if (!doomed) return;
    for (const pl of (doomed.placements || [])) this.onPlacementRemoved(pl.id);
    state.beamPipes = state.beamPipes.filter(p => p.id !== pipeId);
    this.emit('beamlineChanged');
  }

  // -------------------------------------------------------------------------
  // Pipe reshaping (pipe-splice.js). These are what the designer's apply plan
  // executes when a module is inserted into a drift, deleted out of one, or a
  // run is shortened.
  //
  // Money: split and merge are deliberately free in both directions. A split
  // destroys `gapSubL` of drift to make room for a junction; a merge recreates
  // exactly that much when the junction goes away. Pricing either one would
  // make an insert/delete round-trip leak (or mint) funding, and the junction
  // itself is already charged/refunded through placePlaceable. Only trimPipe
  // moves money, because a trim destroys length that nothing replaces.
  // -------------------------------------------------------------------------

  /**
   * Divide a pipe in two around a `gapSubL` hole at arc-length fraction
   * `atPosition`, so a junction can be dropped into the hole.
   *
   * Returns `{headPipeId, tailPipeId, gapCenter}` — two fresh pipe ids and the
   * map point the junction belongs at — or null on failure.
   *
   * The two stubs are new pipes with new ids, but every surviving placement
   * keeps its OWN id (the validator carries them across with positions already
   * re-expressed in each stub's frame). That matters because placements are
   * utility endpoints: reissuing their ids would orphan every utility line
   * wired to hardware on this pipe.
   *
   * No placement can be lost here, so there is nothing to release via
   * onPlacementRemoved: validateSplitPipe rejects with `placement_in_gap`
   * rather than dropping anything the hole would swallow, and every placement
   * that survives that check is assigned to the head or the tail stub.
   */
  splitPipe(pipeId, atPosition, gapSubL) {
    const result = validateSplitPipe(this.state, pipeId, atPosition, gapSubL);
    if (!result.ok) {
      this.log("Can't split pipe: " + reasonMessage(result.reason), 'bad');
      return null;
    }
    const pipes = (this.state && this.state.beamPipes) || [];
    const idx = pipes.findIndex(p => p && p.id === pipeId);
    if (idx < 0) {
      this.log("Can't split pipe: " + reasonMessage('pipe_not_found'), 'bad');
      return null;
    }
    const original = pipes[idx];
    // The two facing inner ends are open: the caller places the junction in the
    // gap and attaches them. Leaving the ORIGINAL refs on the inner ends would
    // hand both stubs the same junction port and make the flattener walk a
    // loop.
    const head = {
      ...original,
      id: this.nextPipeId(),
      start: original.start || null,
      end: null,
      path: result.headPath,
      subL: result.headSubL,
      placements: result.headPlacements,
    };
    const tail = {
      ...original,
      id: this.nextPipeId(),
      start: null,
      end: original.end || null,
      path: result.tailPath,
      subL: result.tailSubL,
      placements: result.tailPlacements,
    };
    // Splice in place so the stubs inherit the original's ordering in
    // state.beamPipes — pipe order is part of the save and of the flattener's
    // deterministic walk.
    pipes.splice(idx, 1, head, tail);
    this.emit('beamlineChanged');
    return { headPipeId: head.id, tailPipeId: tail.id, gapCenter: result.gapCenter };
  }

  /**
   * Fuse two collinear, end-to-end pipes into one straight run, swallowing any
   * junction footprint between them. Returns the merged pipe id, or null.
   *
   * The merged pipe REUSES pipeIdA rather than taking a fresh id. Merge is
   * extendPipe's sibling — A grown to absorb B — and extendPipe keeps its id,
   * so anything holding a pipe reference (designer `_targetPipeId`, demolish
   * hover, selection) survives on the A side instead of both sides going
   * stale. B's id is necessarily gone either way. All placements from both
   * pipes keep their own ids, so utility lines stay wired regardless of which
   * pipe they were mounted on.
   */
  mergePipes(pipeIdA, pipeIdB) {
    const result = validateMergePipes(this.state, pipeIdA, pipeIdB);
    if (!result.ok) {
      this.log("Can't merge pipes: " + reasonMessage(result.reason), 'bad');
      return null;
    }
    const pipes = (this.state && this.state.beamPipes) || [];
    const idxA = pipes.findIndex(p => p && p.id === pipeIdA);
    const idxB = pipes.findIndex(p => p && p.id === pipeIdB);
    if (idxA < 0 || idxB < 0) {
      this.log("Can't merge pipes: " + reasonMessage('pipe_not_found'), 'bad');
      return null;
    }
    pipes[idxA] = {
      ...pipes[idxA],
      id: pipeIdA,
      start: result.start,
      end: result.end,
      path: result.path,
      subL: result.subL,
      placements: result.placements,
    };
    // Drop B by identity, not by index: idxB shifts if it preceded idxA.
    this.state.beamPipes = pipes.filter(p => p.id !== pipeIdB);
    this.emit('beamlineChanged');
    return pipeIdA;
  }

  /**
   * Shorten a pipe to `newSubL` sub-units, taking the length off its open end.
   * Returns pipeId on success, null on failure.
   *
   * The removed section is refunded through pipeRefund() — the same function
   * the demolish hover tooltip and Game.removeBeamPipe call — priced on the
   * actual removed geometry. Anything else would let the trim path quote one
   * number and pay another.
   */
  trimPipe(pipeId, newSubL) {
    const result = validateTrimPipe(this.state, pipeId, newSubL);
    if (!result.ok) {
      this.log("Can't trim pipe: " + reasonMessage(result.reason), 'bad');
      return null;
    }
    const state = this.state;
    const pipes = (state && state.beamPipes) || [];
    const idx = pipes.findIndex(p => p && p.id === pipeId);
    if (idx < 0) {
      this.log("Can't trim pipe: " + reasonMessage('pipe_not_found'), 'bad');
      return null;
    }
    const pipe = pipes[idx];
    // The offcut, as a path: from the surviving terminal out to the old one.
    // Feeding the real geometry to pipeRefund (rather than re-deriving a price
    // from removedSubL) keeps trim on exactly one pricing path with demolish.
    const oldPath = pipe.path || [];
    const removedPath = result.trimmedEnd === 'end'
      ? [result.path[result.path.length - 1], oldPath[oldPath.length - 1]]
      : [oldPath[0], result.path[0]];
    const refund = pipeRefund({ path: removedPath });

    pipes[idx] = {
      ...pipe,
      path: result.path,
      subL: result.subL,
      placements: result.placements,
    };
    if (state.resources) {
      state.resources.funding = (state.resources.funding || 0) + refund;
    }
    this.emit('beamlineChanged');
    return pipeId;
  }

  /**
   * Cut sub-units `[fromSub, toSub)` out of a pipe — the demolish tool's
   * section primitive. Returns null on failure, otherwise
   * `{action, refund, pipeIds}`:
   *
   *   'removeAll'  the cut is the whole pipe. NOTHING is mutated here and the
   *                refund is 0: tearing a pipe down also has to refund its
   *                on-pipe hardware and release those placements' utility
   *                endpoints, and Game.removeBeamPipe is the only path that
   *                does. The caller delegates to it rather than this facade
   *                growing a second, subtly different teardown.
   *   'trim'       one terminal was eaten. `pipeIds` is the surviving pipe,
   *                which keeps its id. If that terminal was BOUND, its
   *                start/end ref is nulled — the pipe no longer reaches the
   *                junction, and port occupancy is derived from these refs
   *                (see junctions.availablePorts), so leaving it would keep a
   *                port booked by geometry that isn't there.
   *   'split'      an interior cut. `pipeIds` is [head, tail], two fresh ids
   *                whose facing inner ends are open, spliced into the
   *                original's slot. Placements keep their OWN ids for the same
   *                reason splitPipe does: they are utility endpoints.
   *
   * Unlike splitPipe/mergePipes, this DOES move money. Those two are free
   * because they conserve length across an insert/delete round-trip; a section
   * cut destroys length that nothing replaces, so it refunds the offcut
   * through pipeRefund() — the one function the demolish hover tooltip and
   * Game.removeBeamPipe also price from, so the quote can't drift from the
   * payout.
   */
  removePipeSection(pipeId, fromSub, toSub) {
    const result = validateRemovePipeSection(this.state, pipeId, fromSub, toSub);
    if (!result.ok) {
      this.log("Can't remove pipe section: " + reasonMessage(result.reason), 'bad');
      return null;
    }
    if (result.action === 'removeAll') {
      return { action: 'removeAll', refund: 0, pipeIds: [] };
    }

    const state = this.state;
    const pipes = (state && state.beamPipes) || [];
    const idx = pipes.findIndex(p => p && p.id === pipeId);
    if (idx < 0) {
      this.log("Can't remove pipe section: " + reasonMessage('pipe_not_found'), 'bad');
      return null;
    }
    const original = pipes[idx];
    const refund = pipeRefund({ path: result.removedPath });

    let pipeIds;
    if (result.action === 'trim') {
      pipes[idx] = {
        ...original,
        start: result.trimmedEnd === 'start' ? null : original.start,
        end: result.trimmedEnd === 'end' ? null : original.end,
        path: result.path,
        subL: result.subL,
        placements: result.placements,
      };
      pipeIds = [pipeId];
    } else {
      const head = {
        ...original,
        id: this.nextPipeId(),
        start: original.start || null,
        end: null,
        path: result.headPath,
        subL: result.headSubL,
        placements: result.headPlacements,
      };
      const tail = {
        ...original,
        id: this.nextPipeId(),
        start: null,
        end: original.end || null,
        path: result.tailPath,
        subL: result.tailSubL,
        placements: result.tailPlacements,
      };
      // Splice in place: pipe order is part of the save and of the
      // flattener's deterministic walk.
      pipes.splice(idx, 1, head, tail);
      pipeIds = [head.id, tail.id];
    }

    if (state.resources) {
      state.resources.funding = (state.resources.funding || 0) + refund;
    }
    this.emit('beamlineChanged');
    return { action: result.action, refund, pipeIds };
  }

  // -------------------------------------------------------------------------
  // Pipe placements.
  // -------------------------------------------------------------------------

  /**
   * Add a placement to a pipe. Delegates to findSlot. On success, swaps in
   * the new placements array on the pipe and returns the new placement id.
   * Returns null on failure.
   *
   * `free: true` skips the research gate and the cost — used by scenario
   * setup and by DesignPlacer, which collects the whole design's cost itself.
   *
   * @param {string} pipeId
   * @param {{type:string, position:number, subL?:number, params?:object,
   *          inline?:boolean,
   *          mode:'snap'|'insert'|'replace', free?:boolean}} opts
   */
  placeOnPipe(pipeId, opts = {}) {
    const state = this.state;
    const pipes = (state && state.beamPipes) || [];
    const pipe = pipes.find(p => p && p.id === pipeId);
    if (!pipe) {
      this.log('placeOnPipe: pipe_not_found', 'bad');
      return null;
    }
    const def = COMPONENTS[opts.type];
    // Research gate + affordability. placeJunction gets both for free by
    // routing through Game.placePlaceable; this path owns the mutation
    // directly, so it has to charge itself.
    //
    // Fix round 1: every on-pipe component (quadrupole, BPM, RF cavity,
    // etc — the majority of the catalogue by count and by funding, see
    // sparesCostForFunding's own header) now costs spares alongside
    // funding, the same as a junction does at Game._placePlaceableInner.
    // Before this, placeOnPipe charged funding only — with the shared spares
    // pool at zero, this path still happily mounted parts for money, which
    // meant a player who only ever built through the designer (see
    // DesignPlacer, also on-pipe-and-junction free:true through here) never
    // met the spares gate at all.
    const cost = (def && def.cost) || {};
    if (!opts.free) {
      if (def && !this.isUnlocked(def)) {
        this.log(`${def.name || opts.type} is not researched yet!`, 'bad');
        return null;
      }
      if (!this.canAfford(cost)) {
        // Fix round 3: names the missing resource(s), same as Game.js's own
        // "Can't afford X!" already does for a hand-placed junction — this
        // path never had it, so a spares-short on-pipe placement (fix round
        // 1's own gap) refused with no hint that spares, not funding, was
        // the actual blocker.
        this.log(`Can't afford ${(def && def.name) || opts.type}! (${missingResourceLabel(this.state?.resources, cost)})`, 'bad');
        return null;
      }
    }
    const subL = (typeof opts.subL === 'number' && opts.subL > 0)
      ? opts.subL
      : (def && typeof def.subL === 'number' ? def.subL : 2);
    const inline = opts.inline === true || def?.attachmentKind === 'inline';

    // Track pre-existing placement ids so we can identify the newly-added one
    // after findSlot returns (findSlot uses idGenerator for the new id; other
    // entries keep their original ids in snap/insert, or get dropped in
    // replace).
    const priorIds = new Set((pipe.placements || []).map(pl => pl.id));

    const result = findSlot(pipe, {
      type: opts.type,
      requestedPosition: opts.position,
      subL,
      inline,
      mode: opts.mode,
      // Seed defaults, not the bare overrides. This path used to pass
      // `opts.params || {}` through untouched while Game._placePlaceableInner
      // ran the full three-step seed for junction-mounted components — the
      // same component got different physics depending on how it was mounted.
      // It bit hardest on catalogue-only params: spokeCavity's 325 MHz and
      // gradient 8 live in COMPONENTS and in no PARAM_DEFS entry, so on a pipe
      // it arrived empty and rf_acceleration.py used its 1.3 GHz fallback.
      // Every RF cavity in the game is role 'placement' and comes through
      // here. See src/beamline/component-params.js.
      params: seedComponentParams(opts.type, opts.params),
      portsFlipped: opts.portsFlipped === true,
      idGenerator: () => this.nextPlacementId(),
    });
    if (!result.ok) {
      this.log("Can't place on pipe: " + reasonMessage(result.reason), 'bad');
      return null;
    }
    // 'replace' mode drops whatever the new placement covers. Those ids are
    // gone from the model, so release their utility endpoints before the
    // topology re-solves.
    const survivingIds = new Set(result.placements.map(pl => pl.id));
    for (const id of priorIds) {
      if (!survivingIds.has(id)) this.onPlacementRemoved(id);
    }
    pipe.placements = result.placements;
    if (!opts.free) this.spend(cost);
    this.emit('beamlineChanged');
    // The new placement is the one whose id is not in priorIds.
    const newPl = pipe.placements.find(pl => !priorIds.has(pl.id));
    if (newPl) {
      // Task 6 (staff-professions-3, jobs-and-gates): the other of the two
      // choke points that can ever mint a new beamline component — see
      // Game._placePlaceableInner's identical stamp for junctions/modules.
      newPl.needsCommissioning = true;
      newPl.specialty = commissioningSpecialtyFor(opts.type);
    }
    return newPl ? newPl.id : null;
  }

  /**
   * Remove a placement from a pipe, crediting the same 50% refund the
   * demolish hover tooltip promises (InputHandler._updateDemolishHover) and
   * that Game.removeBeamPipe pays when the whole pipe goes.
   * Returns true if a placement was removed.
   */
  removeFromPipe(pipeId, placementId) {
    const state = this.state;
    const pipes = (state && state.beamPipes) || [];
    const pipe = pipes.find(p => p && p.id === pipeId);
    if (!pipe) return false;
    const removed = (pipe.placements || []).find(pl => pl.id === placementId);
    if (!removed) return false;
    pipe.placements = (pipe.placements || []).filter(pl => pl.id !== placementId);
    this.onPlacementRemoved(placementId);
    const def = COMPONENTS[removed.type];
    if (def && def.cost && state.resources) {
      // Fix round 3: mirror placeOnPipe's own cost — a spares line alongside
      // funding — for the refund, not the bare def.cost. Before this,
      // removing ONE attachment (this method) refunded funding only while
      // removeBeamPipe's own per-placement refund (Game.js's
      // _refundCostFor, fix round 1) already refunded both — so tearing out
      // a single $200k/40-spare quadrupole returned $100k and 0 spares,
      // while demolishing the whole pipe underneath the identical
      // attachment returned $100k AND 20 spares. Two refund paths for the
      // same removed part must agree, or the cheaper move is always to
      // destroy more.
      for (const [r, a] of Object.entries(def.cost)) {
        state.resources[r] = (state.resources[r] || 0) + Math.floor(a * 0.5);
      }
    }
    this.emit('beamlineChanged');
    return true;
  }

  /**
   * Return the placement (if any) whose interval contains `position`.
   */
  placementAt(pipeId, position) {
    const state = this.state;
    const pipes = (state && state.beamPipes) || [];
    const pipe = pipes.find(p => p && p.id === pipeId);
    if (!pipe || !pipe.subL) return null;
    const placements = pipe.placements || [];
    // Exact inline points win over ordinary intervals that share their edge.
    for (const pl of placements) {
      if (pl.inline === true && placementContainsPosition(pipe.subL, pl, position)) return pl;
    }
    for (const pl of placements) {
      if (placementContainsPosition(pipe.subL, pl, position)) return pl;
    }
    return null;
  }
}

export default BeamlineSystem;
