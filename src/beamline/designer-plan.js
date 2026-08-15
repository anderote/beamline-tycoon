// src/beamline/designer-plan.js
//
// The Beamline Designer's PLANNER. Pure: it reads game state and the draft
// stack and returns an ordered operation list. It mutates nothing — not the
// state it is handed, not the draft nodes, not the component registry. Same
// house contract as pipe-drawing.js / pipe-placements.js / pipe-splice.js.
//
//   planDesignerApply(state, { sourceId, draftNodes, originalNodes })
//     → { ok, ops, summary, blockers }
//
// The draft is a statement of the DESIRED END STATE of one linear beam path,
// not a queue of map mutations. The planner re-walks the map with
// flattenPath(), aligns it against the draft by `_sourceRef` identity, and
// works out the smallest set of BeamlineSystem calls that turns one into the
// other.
//
// ---------------------------------------------------------------------------
// OP FORMAT — the contract the executor (BeamlineDesigner._planAndApply) reads
// ---------------------------------------------------------------------------
//
// Every op is `{ kind, nodeIndex, ...args }`. `nodeIndex` is the index in
// `draftNodes` the op serves, or -1 when the op serves no single node (every
// removal, and the affordability check). The UI uses it to point at the
// offending element in the schematic.
//
// SYMBOLIC REFERENCES. Ops run in sequence, and the ids of things created
// mid-sequence do not exist while planning. So an op may DECLARE its outputs:
//
//     { kind: 'splitPipe', pipeId: 'bp_3', ..., out: { head: '$h1', tail: '$t1' } }
//
// and any LATER op may use `'$h1'` anywhere a concrete id is expected — a
// pipeId, a `{junctionId, portName}` endpoint reference, anything. The
// executor keeps a symbol table: after running an op that declares `out`, it
// binds each declared symbol to the real id the mutator returned, and resolves
// symbols in every subsequent op's arguments before dispatching it. A symbol
// is always declared by an EARLIER op than the one referencing it — the
// planner guarantees this and the unit tests assert it.
//
// What each declared symbol binds to, given the mutator's return value:
//
//   splitPipe  → out.head    = ret.headPipeId
//                out.tail    = ret.tailPipeId
//   mergePipes → out.pipe    = ret            (BeamlineSystem reuses pipeIdA,
//                                              so this resolves to pipeIdA)
//   drawPipe   → out.pipe    = ret            (the new pipe id)
//   placeJunction → out.junction = ret        (the new placeable id)
//   placeOnPipe   → out.placement = ret       (the new placement id)
//
// trimPipe and extendPipe declare nothing: both keep the pipe's existing id.
//
// Op kinds, and the BeamlineSystem call each maps onto:
//
//   removeFromPipe { pipeId, placementId }
//       → beam.removeFromPipe(pipeId, placementId)
//   removeJunction { junctionId }
//       → beam.removeJunction(junctionId)
//   mergePipes     { pipeIdA, pipeIdB, out:{ pipe } }
//       → beam.mergePipes(a, b)                          [Task 2.2]
//   splitPipe      { pipeId, atPosition, gapSubL, out:{ head, tail } }
//       → beam.splitPipe(pipeId, atPosition, gapSubL)    [Task 2.2]
//   trimPipe       { pipeId, newSubL }
//       → beam.trimPipe(pipeId, newSubL)                 [Task 2.2]
//   drawPipe       { start, end, path, out:{ pipe } }
//       → beam.drawPipe(start, end, path)
//   extendPipe     { pipeId, additionalPath }
//       → beam.extendPipe(pipeId, additionalPath)
//   placeJunction  { type, col, row, subCol, subRow, dir, params,
//                    connect:[{ pipe, end:'start'|'end', port }], out:{ junction } }
//       → beam.placeJunction({...}), then for each `connect` entry bind that
//         pipe's `start`/`end` endpoint reference to { junctionId, portName }.
//         The bind is the step that actually re-joins the beam path; a split
//         or a trim leaves the fresh pipe end OPEN on purpose so the junction
//         placed into the hole is what closes it.
//   placeOnPipe    { pipeId, type, position, subL, params, mode, out:{ placement } }
//       → beam.placeOnPipe(pipeId, {...})
//   tuneParams     { target:'module'|'placement', junctionId | pipeId+placementId,
//                    params }
//       → shallow-merge `params` over the existing params. No slot mutation.
//
// `moveJunction` is Task 4.2 and is deliberately NOT emitted here.
//
// ORDERING. Ops are listed in EXECUTION order, and the order is load-bearing.
// The shape is removals → geometry → placements → tuneParams, spelled out:
//
//   1. removeFromPipe — first, so dropped attachments free pipe capacity and
//                       pay their refunds before anything is charged.
//   2. mergePipes     — BEFORE the junction removals, not after. This is the
//                       one inversion in the list and it is not cosmetic:
//                       validateMergePipes proves two pipes are adjacent by
//                       the junction reference they SHARE. removeJunction
//                       nulls exactly that reference, and the two stubs are a
//                       whole junction-length apart, so a merge planned after
//                       the removal would be rejected as `not_adjacent` at
//                       execution time.
//   3. removeJunction — now referenced by nothing; frees its sub-grid cells
//                       before anything is placed into them.
//   4. geometry       — splitPipe, trimPipe, drawPipe, extendPipe.
//   5. placements     — placeJunction, placeOnPipe. A placeJunction consumes
//                       the `$head`/`$tail` symbols its splitPipe declared.
//   6. tuneParams     — last; pure field writes that cannot fail.
//
//   One further exception: a `drawPipe` anchored to a junction this same plan
//   creates is emitted in step 5, immediately after the `placeJunction` that
//   declares its symbol, because no op can precede its own producer. Nothing
//   else crosses phases.
//
// ---------------------------------------------------------------------------
// WHAT PHASE 2 SUPPORTS (and what it refuses)
// ---------------------------------------------------------------------------
//
// Supported: append at an open end; append before a terminal endpoint by
// consuming the drift in front of it; insert a module into a drift that has
// room; delete a module and merge the pipes back together; add/remove
// attachments; tune params.
//
// NOT supported yet: anything that would DISPLACE an existing junction. The
// source is anchored, every other junction holds its exact position, and a
// draft that cannot be satisfied without sliding one emits `no_space`. Task
// 4.2 replaces those with `moveJunction` ops and polyline displacement.
//
// The planner never creates or destroys beamline REGISTRY entries. The apply
// transaction (Game.snapshotBeamlineState) deliberately does not roll the
// registry back — rewinding per-entry sim accumulators would turn a failed
// apply into a free facility-wide repair — so ops must stay inside that
// boundary.
//
// INTERNAL SHADOW STATE. Feasibility is decided by running the REAL validators
// (validateSplitPipe, validateDrawPipe, findSlot, canPlace, ...) rather than
// by re-deriving their rules. Since several ops in one plan interact — split a
// pipe, then place into the tail stub — the planner keeps a private deep copy
// of the state and applies each op's effect to that copy as it goes. The
// caller's state is copied once and never touched.
//
// Blocker codes (each carries `{ code, nodeIndex, message }`, message is
// player-facing English):
//
//   no_space                 — the change does not fit without moving hardware
//                              that phase 2 will not move
//   collision                — a new junction's footprint hits an occupied
//                              cell, a wall, or an existing pipe
//   not_straight             — the resulting pipe would not be a legal straight
//                              run, or the module has no straight through-axis
//   unaffordable             — the netted cost exceeds available funding
//   multi_branch_unsupported — the run contains a splitter/merger
//   source_immovable         — the draft asks to remove, displace, or prepend
//                              to the anchored source junction

import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { flattenPath } from './flattener.js';
import { validateSplitPipe, validateMergePipes, validateTrimPipe } from './pipe-splice.js';
import { validateDrawPipe, validateExtendPipe } from './pipe-drawing.js';
import { findSlot } from './pipe-placements.js';
import { pipeCost, pipeRefund } from './BeamlineSystem.js';
import { portSide, portWorldPosition } from './junctions.js';
import { moduleBeamAxis, axisMatchesDirection } from './module-axis.js';
import { canPlace } from '../game/placement.js';

const SUB_PER_TILE = 4;
// 1 sub-unit is a quarter tile; a pipe waypoint always lands on that grid.
const TILE_PER_SUB = 0.25;
const EPS = 1e-6;

export const NO_SPACE = 'no_space';
export const COLLISION = 'collision';
export const NOT_STRAIGHT = 'not_straight';
export const UNAFFORDABLE = 'unaffordable';
export const MULTI_BRANCH_UNSUPPORTED = 'multi_branch_unsupported';
export const SOURCE_IMMOVABLE = 'source_immovable';

const SIDE_VEC = {
  N: { dCol: 0, dRow: -1 },
  E: { dCol: 1, dRow: 0 },
  S: { dCol: 0, dRow: 1 },
  W: { dCol: -1, dRow: 0 },
};

// Beam direction → placement `dir`. dir 0 puts a module's `back` face north,
// so the beam runs south (+row); each further dir is one clockwise quarter
// turn. Mirrors module-axis.moduleBeamAxis, which we assert against below.
const DIR_FOR_BEAM = [
  { dCol: 0, dRow: 1 },   // dir 0
  { dCol: -1, dRow: 0 },  // dir 1
  { dCol: 0, dRow: -1 },  // dir 2
  { dCol: 1, dRow: 0 },   // dir 3
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function compDef(type) { return COMPONENTS[type] || null; }

function displayName(type) {
  const def = compDef(type);
  return (def && def.name) || type;
}

function costFunding(type) {
  const def = compDef(type);
  return (def && def.cost && typeof def.cost.funding === 'number') ? def.cost.funding : 0;
}

// Both removePlaceable and removeFromPipe pay the same flat 50%.
function refundFunding(type) {
  return Math.floor(costFunding(type) * 0.5);
}

function subLOf(type, fallback = 2) {
  const def = compDef(type);
  return (def && typeof def.subL === 'number' && def.subL > 0) ? def.subL : fallback;
}

/**
 * How a component joins the beam path. This is `role`, NOT `placement`: a
 * cavity is `placement:'module'` in the palette but `role:'placement'` on the
 * map, i.e. it rides ON a pipe rather than breaking one.
 *   'drift'      — beam pipe itself (isDrawnConnection)
 *   'junction'   — occupies sub-grid cells and terminates two pipe ends
 *   'attachment' — a placement carried at a fraction along one pipe
 */
function joinKind(type) {
  const def = compDef(type);
  if (!def) return null;
  if (def.isDrawnConnection) return 'drift';
  if (def.role === 'junction') return 'junction';
  return 'attachment';
}

function beamPortNames(def) {
  if (!def || !def.ports) return [];
  return Object.keys(def.ports).filter(n => !def.ports[n].utility);
}

function portNameOnSide(def, side) {
  if (!def || !def.ports) return null;
  for (const n of beamPortNames(def)) {
    if (def.ports[n].side === side) return n;
  }
  return null;
}

function entryPortName(def) { return portNameOnSide(def, 'back'); }
function exitPortName(def) { return portNameOnSide(def, 'front'); }

function unitDir(from, to) {
  const dCol = to.col - from.col;
  const dRow = to.row - from.row;
  if (Math.abs(dCol) > EPS && Math.abs(dRow) < EPS) return { dCol: Math.sign(dCol), dRow: 0 };
  if (Math.abs(dRow) > EPS && Math.abs(dCol) < EPS) return { dCol: 0, dRow: Math.sign(dRow) };
  return null;
}

function dirForBeam(beam) {
  for (let d = 0; d < 4; d++) {
    if (DIR_FOR_BEAM[d].dCol === beam.dCol && DIR_FOR_BEAM[d].dRow === beam.dRow) return d;
  }
  return 0;
}

function roundCoord(v) { return Math.round(v * 1e6) / 1e6; }

function stepPoint(pt, dir, tiles) {
  return {
    col: roundCoord(pt.col + dir.dCol * tiles),
    row: roundCoord(pt.row + dir.dRow * tiles),
  };
}

/**
 * Invert the footprint-centre formula portWorldPosition() uses, so a junction
 * can be anchored on a point measured in PIPE coordinates (where an integer is
 * a tile centre and world x = col * 2 + 1).
 *
 * A placeable's footprint centre sits at
 *   worldX = absSubCol * 0.5 + footColSub * 0.25
 * with absSubCol = col * 4 + subCol, so absSubCol = 2 * worldX - footColSub/2.
 */
function junctionAnchorAt(centreTile, def, dir) {
  const swap = dir === 1 || dir === 3;
  const footColSub = swap ? (def.subL || 2) : (def.subW || 2);
  const footRowSub = swap ? (def.subW || 2) : (def.subL || 2);
  const worldX = centreTile.col * 2 + 1;
  const worldZ = centreTile.row * 2 + 1;
  const absSubCol = Math.round(2 * worldX - footColSub / 2);
  const absSubRow = Math.round(2 * worldZ - footRowSub / 2);
  return {
    col: Math.floor(absSubCol / SUB_PER_TILE),
    row: Math.floor(absSubRow / SUB_PER_TILE),
    subCol: ((absSubCol % SUB_PER_TILE) + SUB_PER_TILE) % SUB_PER_TILE,
    subRow: ((absSubRow % SUB_PER_TILE) + SUB_PER_TILE) % SUB_PER_TILE,
  };
}

// Port position expressed in pipe-path coordinates.
function portPipePoint(placeable, portName) {
  const w = portWorldPosition(placeable, portName);
  if (!w) return null;
  return { col: roundCoord((w.x - 1) / 2), row: roundCoord((w.z - 1) / 2) };
}

/** Only the keys the draft actually carries; a draft never deletes params. */
function changedParams(mapParams, draftParams) {
  const out = {};
  let any = false;
  for (const [k, v] of Object.entries(draftParams || {})) {
    if ((mapParams || {})[k] !== v) { out[k] = v; any = true; }
  }
  return any ? out : null;
}

// ---------------------------------------------------------------------------
// Shadow state
// ---------------------------------------------------------------------------

function makeShadow(state) {
  const s = state || {};
  return {
    placeables: (s.placeables || []).map(p => ({
      ...p,
      params: { ...(p.params || {}) },
      cells: (p.cells || []).map(c => ({ ...c })),
    })),
    beamPipes: (s.beamPipes || []).map(p => ({
      ...p,
      start: p.start ? { ...p.start } : null,
      end: p.end ? { ...p.end } : null,
      path: (p.path || []).map(pt => ({ col: pt.col, row: pt.row })),
      placements: (p.placements || []).map(pl => ({ ...pl, params: { ...(pl.params || {}) } })),
    })),
    subgridOccupied: { ...(s.subgridOccupied || {}) },
    wallOccupied: { ...(s.wallOccupied || {}) },
    resources: { ...(s.resources || {}) },
  };
}

function shadowPipe(shadow, pipeId) {
  return shadow.beamPipes.find(p => p && p.id === pipeId) || null;
}

function shadowPlaceable(shadow, id) {
  return shadow.placeables.find(p => p && p.id === id) || null;
}

// ---------------------------------------------------------------------------
// Run structure
// ---------------------------------------------------------------------------

/**
 * Fold the flattener's output into alternating module / pipe segments:
 * module(source), pipe, module, pipe, ... Consecutive drift+placement entries
 * sharing a pipeId are one pipe segment.
 */
function partitionRun(entries) {
  const segs = [];
  for (const e of entries) {
    if (e.kind === 'module') {
      segs.push({ kind: 'module', entry: e });
    } else {
      const last = segs[segs.length - 1];
      if (last && last.kind === 'pipe' && last.pipeId === e.pipeId) last.items.push(e);
      else segs.push({ kind: 'pipe', pipeId: e.pipeId, items: [e] });
    }
  }
  return segs;
}

/** 'forward' when the beam runs from path[0] toward the last path point. */
function directionOf(pipe, upstreamJunctionId) {
  if (!pipe) return 'forward';
  if (pipe.start && pipe.start.junctionId === upstreamJunctionId) return 'forward';
  if (pipe.end && pipe.end.junctionId === upstreamJunctionId) return 'reverse';
  if (pipe.start) return 'forward';
  if (pipe.end) return 'reverse';
  return 'forward';
}

/** Beam-travel unit vector along a pipe, in pipe coordinates. */
function beamVector(pipe, direction) {
  const path = pipe.path || [];
  if (path.length < 2) return null;
  const fwd = unitDir(path[0], path[path.length - 1]);
  if (!fwd) return null;
  return direction === 'forward' ? fwd : { dCol: -fwd.dCol, dRow: -fwd.dRow };
}

/** The point the beam leaves the pipe at. */
function farEndPoint(pipe, direction) {
  const path = pipe.path || [];
  return direction === 'forward' ? path[path.length - 1] : path[0];
}

/** Which endpoint reference sits at the downstream end. */
function farEndSide(direction) { return direction === 'forward' ? 'end' : 'start'; }
function nearEndSide(direction) { return direction === 'forward' ? 'start' : 'end'; }

function farEndRef(pipe, direction) {
  return direction === 'forward' ? pipe.end : pipe.start;
}

// Beam-order offset (sub-units from where the beam enters the pipe).
function placementBeamStart(pipe, pl, direction) {
  const abs = pl.position * pipe.subL;
  return direction === 'forward' ? abs : pipe.subL - (abs + pl.subL);
}

// Beam offset → 0..1 fraction measured from path[0] (what the validators want).
function beamOffsetToPathFraction(pipe, offset, widthSubL, direction) {
  if (!pipe.subL) return 0;
  const lead = direction === 'forward' ? offset : pipe.subL - (offset + widthSubL);
  return lead / pipe.subL;
}

/**
 * The free stretch of pipe (in beam offsets) starting at `from` and ending
 * where the next placement begins.
 */
function freeSpanFrom(pipe, from, direction) {
  let hi = pipe.subL;
  for (const pl of pipe.placements || []) {
    const s = placementBeamStart(pipe, pl, direction);
    if (s >= from - EPS && s < hi) hi = s;
  }
  return { lo: from, hi: Math.max(from, hi) };
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

class Planner {
  constructor(state, opts) {
    this.state = state || {};
    this.shadow = makeShadow(state);
    this.sourceId = opts.sourceId;
    this.draft = opts.draftNodes || [];

    // One bucket per execution phase — see the ORDERING note in the header.
    this.removals = [];          // removeFromPipe
    this.merges = [];            // mergePipes (before the junction removals!)
    this.junctionRemovals = [];  // removeJunction
    this.geometry = [];          // splitPipe / trimPipe / drawPipe / extendPipe
    this.placements = [];        // placeJunction / placeOnPipe
    this.tunes = [];             // tuneParams
    this.blockers = [];

    this.adds = new Map();     // type → { type, count, cost, metres }
    this.removes = new Map();  // type → { type, count, refund }

    this._sym = 0;
  }

  sym(prefix) { return '$' + prefix + (++this._sym); }

  block(code, nodeIndex, message) {
    this.blockers.push({ code, nodeIndex, message });
  }

  addCost(type, funding, metres = 0) {
    const row = this.adds.get(type) || { type, count: 0, cost: 0, metres: 0 };
    row.count += 1;
    row.cost += funding;
    row.metres += metres;
    this.adds.set(type, row);
  }

  addRefund(type, funding) {
    const row = this.removes.get(type) || { type, count: 0, refund: 0 };
    row.count += 1;
    row.refund += funding;
    this.removes.set(type, row);
  }

  // --- op emission + shadow bookkeeping ------------------------------------

  emitRemoveFromPipe(pipeId, placementId, type) {
    this.removals.push({ kind: 'removeFromPipe', nodeIndex: -1, pipeId, placementId });
    const pipe = shadowPipe(this.shadow, pipeId);
    if (pipe) pipe.placements = (pipe.placements || []).filter(pl => pl.id !== placementId);
    this.addRefund(type, refundFunding(type));
  }

  emitRemoveJunction(junctionId, type) {
    this.junctionRemovals.push({ kind: 'removeJunction', nodeIndex: -1, junctionId });
    for (const pipe of this.shadow.beamPipes) {
      if (pipe.start && pipe.start.junctionId === junctionId) pipe.start = null;
      if (pipe.end && pipe.end.junctionId === junctionId) pipe.end = null;
    }
    const p = shadowPlaceable(this.shadow, junctionId);
    if (p) {
      for (const c of p.cells || []) {
        delete this.shadow.subgridOccupied[`${c.col},${c.row},${c.subCol},${c.subRow}`];
      }
      this.shadow.placeables = this.shadow.placeables.filter(x => x.id !== junctionId);
    }
    this.addRefund(type, refundFunding(type));
  }

  /** Returns the merged pipe's symbol, or null (a blocker was raised). */
  emitMergePipes(pipeIdA, pipeIdB, nodeIndex) {
    const res = validateMergePipes(this.shadow, pipeIdA, pipeIdB);
    if (!res.ok) {
      this.block(
        res.reason === 'not_collinear' ? NOT_STRAIGHT : NO_SPACE,
        nodeIndex,
        res.reason === 'not_collinear'
          ? 'Removing that module would leave two beam pipes that do not line up. '
            + 'Straighten the run on the map first.'
          : 'Removing that module would leave beam pipes that cannot be joined back up.',
      );
      return null;
    }
    const symbol = this.sym('m');
    this.merges.push({
      kind: 'mergePipes', nodeIndex, pipeIdA, pipeIdB, out: { pipe: symbol },
    });
    this.shadow.beamPipes = this.shadow.beamPipes.filter(
      p => p.id !== pipeIdA && p.id !== pipeIdB,
    );
    this.shadow.beamPipes.push({
      id: symbol,
      start: res.start ? { ...res.start } : null,
      end: res.end ? { ...res.end } : null,
      path: res.path.map(pt => ({ ...pt })),
      subL: res.subL,
      placements: res.placements.map(pl => ({ ...pl })),
    });
    return symbol;
  }

  /** Returns { head, tail } symbols, or null. */
  emitSplitPipe(pipeId, atPosition, gapSubL, nodeIndex, typeName) {
    const res = validateSplitPipe(this.shadow, pipeId, atPosition, gapSubL);
    if (!res.ok) {
      this.blockForSplit(res.reason, nodeIndex, typeName);
      return null;
    }
    const head = this.sym('h');
    const tail = this.sym('t');
    this.geometry.push({
      kind: 'splitPipe', nodeIndex, pipeId, atPosition, gapSubL,
      out: { head, tail },
    });
    const old = shadowPipe(this.shadow, pipeId);
    this.shadow.beamPipes = this.shadow.beamPipes.filter(p => p.id !== pipeId);
    this.shadow.beamPipes.push({
      id: head,
      start: old && old.start ? { ...old.start } : null,
      end: null,
      path: res.headPath.map(pt => ({ ...pt })),
      subL: res.headSubL,
      placements: res.headPlacements.map(pl => ({ ...pl })),
    });
    this.shadow.beamPipes.push({
      id: tail,
      start: null,
      end: old && old.end ? { ...old.end } : null,
      path: res.tailPath.map(pt => ({ ...pt })),
      subL: res.tailSubL,
      placements: res.tailPlacements.map(pl => ({ ...pl })),
    });
    return { head, tail, gapCenter: res.gapCenter };
  }

  blockForSplit(reason, nodeIndex, typeName) {
    if (reason === 'gap_too_large') {
      this.block(NO_SPACE, nodeIndex,
        `${typeName} is longer than the beam pipe section it would go into. `
        + 'Pick a longer section, or delete something else on this one first.');
    } else if (reason === 'stub_too_short') {
      this.block(NO_SPACE, nodeIndex,
        `${typeName} fits on this beam pipe section, but not at that exact spot — `
        + 'it would leave no pipe on one side. Move it along the section.');
    } else if (reason === 'placement_in_gap') {
      this.block(COLLISION, nodeIndex,
        `${typeName} would land on top of hardware already on that beam pipe.`);
    } else if (reason === 'invalid_pipe' || reason === 'not_collinear') {
      this.block(NOT_STRAIGHT, nodeIndex,
        `That beam pipe section is not a straight run, so ${typeName} cannot be spliced into it.`);
    } else {
      this.block(NO_SPACE, nodeIndex, `${typeName} cannot be added here (${reason}).`);
    }
  }

  /** Place a junction; binds pipe ends via `connect`. Returns its symbol. */
  emitPlaceJunction(node, nodeIndex, centreTile, beam, connect) {
    const type = node.type;
    const def = compDef(type);
    const dir = dirForBeam(beam);

    // module-axis is the authority on which way a two-port module faces; a
    // module with no straight through-axis (a dipole) bends the beam and has
    // no business being spliced into a straight run.
    const axis = moduleBeamAxis(def, dir);
    if (axis && !axisMatchesDirection(axis, beam)) {
      this.block(NOT_STRAIGHT, nodeIndex,
        `${displayName(type)} cannot be oriented along this beam pipe.`);
      return null;
    }

    const anchor = junctionAnchorAt(centreTile, def, dir);
    const placeable = PLACEABLES[type];
    if (!placeable) {
      this.block(COLLISION, nodeIndex, `${displayName(type)} cannot be placed on the map.`);
      return null;
    }
    const geo = canPlace(
      { state: this.shadow }, placeable,
      anchor.col, anchor.row, anchor.subCol, anchor.subRow, dir,
    );
    if (!geo.ok) {
      this.block(COLLISION, nodeIndex,
        geo.wallBlocked
          ? `${displayName(type)} would run through a wall.`
          : `${displayName(type)} would land on something already there.`);
      return null;
    }

    const symbol = this.sym('j');
    this.placements.push({
      kind: 'placeJunction',
      nodeIndex,
      type,
      col: anchor.col, row: anchor.row,
      subCol: anchor.subCol, subRow: anchor.subRow,
      dir,
      params: { ...(node.params || {}) },
      connect: connect.map(c => ({ ...c })),
      out: { junction: symbol },
    });

    this.shadow.placeables.push({
      id: symbol, type, dir,
      col: anchor.col, row: anchor.row, subCol: anchor.subCol, subRow: anchor.subRow,
      params: { ...(node.params || {}) },
      cells: geo.cells.map(c => ({ ...c })),
    });
    for (const c of geo.cells) {
      this.shadow.subgridOccupied[`${c.col},${c.row},${c.subCol},${c.subRow}`] = symbol;
    }
    for (const c of connect) {
      const pipe = shadowPipe(this.shadow, c.pipe);
      if (pipe) pipe[c.end] = { junctionId: symbol, portName: c.port };
    }
    this.addCost(type, costFunding(type));
    return symbol;
  }

  /** Returns true on success. */
  emitPlaceOnPipe(pipeId, node, nodeIndex, position, mode) {
    const type = node.type;
    const subL = subLOf(type);
    const pipe = shadowPipe(this.shadow, pipeId);
    if (!pipe) {
      this.block(NO_SPACE, nodeIndex,
        `${displayName(type)} has no beam pipe to sit on. Add a Beam Pipe first.`);
      return false;
    }
    const symbol = this.sym('pl');
    const res = findSlot(pipe, {
      type,
      requestedPosition: position,
      subL,
      mode,
      params: { ...(node.params || {}) },
      idGenerator: () => symbol,
    });
    if (!res.ok) {
      this.block(res.reason === 'invalid_pipe' ? NOT_STRAIGHT : NO_SPACE, nodeIndex,
        res.reason === 'full' || res.reason === 'overlap'
          ? `There is no room left on that beam pipe for ${displayName(type)}. `
            + 'Remove something else from it, or add pipe at the open end.'
          : `${displayName(type)} cannot be placed there (${res.reason}).`);
      return false;
    }
    this.placements.push({
      kind: 'placeOnPipe', nodeIndex, pipeId, type,
      position, subL, mode,
      params: { ...(node.params || {}) },
      out: { placement: symbol },
    });
    pipe.placements = res.placements.map(pl => ({ ...pl }));
    this.addCost(type, costFunding(type));
    return true;
  }

  /** Grow a pipe outward from its open downstream end. */
  emitExtendPipe(pipeId, direction, tiles, nodeIndex) {
    const pipe = shadowPipe(this.shadow, pipeId);
    const beam = beamVector(pipe, direction);
    const from = farEndPoint(pipe, direction);
    if (!beam || !from) {
      this.block(NOT_STRAIGHT, nodeIndex, 'That beam pipe is not a straight run.');
      return false;
    }
    const additionalPath = [{ ...from }, stepPoint(from, beam, tiles)];
    const res = validateExtendPipe(this.shadow, pipeId, additionalPath);
    if (!res.ok) {
      this.blockForPipeGeometry(res.reason, nodeIndex, 'Beam Pipe');
      return false;
    }
    const oldSubL = pipe.subL || 0;
    const addedSubL = Math.max(0, (res.pipe.subL || 0) - oldSubL);
    this.geometry.push({ kind: 'extendPipe', nodeIndex, pipeId, additionalPath });
    Object.assign(pipe, {
      path: res.pipe.path.map(pt => ({ ...pt })),
      subL: res.pipe.subL,
      placements: res.pipe.placements.map(pl => ({ ...pl })),
    });
    this.addCost('drift', pipeCost(addedSubL / SUB_PER_TILE).funding, addedSubL * 0.5);
    return true;
  }

  /** Shrink a pipe back from its open downstream end. */
  emitTrimPipe(pipeId, removedSubL, nodeIndex) {
    const pipe = shadowPipe(this.shadow, pipeId);
    const newSubL = (pipe.subL || 0) - removedSubL;
    const res = validateTrimPipe(this.shadow, pipeId, newSubL);
    if (!res.ok) {
      this.block(NO_SPACE, nodeIndex,
        res.reason === 'placement_beyond_new_end'
          ? 'Shortening that beam pipe would cut through hardware still mounted on it.'
          : 'That beam pipe cannot be shortened here.');
      return false;
    }
    this.geometry.push({ kind: 'trimPipe', nodeIndex, pipeId, newSubL });
    Object.assign(pipe, {
      path: res.path.map(pt => ({ ...pt })),
      subL: res.subL,
      placements: res.placements.map(pl => ({ ...pl })),
    });
    // pipeRefund only reads path LENGTH, so a synthetic straight path of the
    // removed length prices the refund with the same function the demolish
    // tooltip and Game.removeBeamPipe use.
    this.addRefund('drift', pipeRefund({
      path: [{ col: 0, row: 0 }, { col: res.removedTiles, row: 0 }],
    }));
    return true;
  }

  /**
   * Draw a fresh pipe out of a junction port. `phase` is 'geometry' normally,
   * or 'placement' when the junction is one this plan creates (its symbol is
   * only bound after the placeJunction op runs).
   */
  emitDrawPipe(junctionId, portName, tiles, nodeIndex, phase) {
    const placeable = shadowPlaceable(this.shadow, junctionId);
    const side = placeable ? portSide(placeable, portName) : null;
    const from = placeable ? portPipePoint(placeable, portName) : null;
    const vec = side ? SIDE_VEC[side] : null;
    if (!from || !vec) {
      this.block(NO_SPACE, nodeIndex, 'There is no free beam port to run a beam pipe out of.');
      return null;
    }
    const path = [{ ...from }, stepPoint(from, vec, tiles)];
    const start = { junctionId, portName };
    const res = validateDrawPipe(this.shadow, { start, end: null, path });
    if (!res.ok) {
      this.blockForPipeGeometry(res.reason, nodeIndex, 'Beam Pipe');
      return null;
    }
    const symbol = this.sym('p');
    const op = { kind: 'drawPipe', nodeIndex, start, end: null, path, out: { pipe: symbol } };
    (phase === 'placement' ? this.placements : this.geometry).push(op);
    this.shadow.beamPipes.push({
      id: symbol,
      start: { ...start },
      end: null,
      path: res.pipe.path.map(pt => ({ ...pt })),
      subL: res.pipe.subL,
      placements: [],
    });
    this.addCost('drift', pipeCost(res.pipe.subL / SUB_PER_TILE).funding, res.pipe.subL * 0.5);
    return symbol;
  }

  blockForPipeGeometry(reason, nodeIndex, what) {
    if (reason === 'overlap') {
      this.block(COLLISION, nodeIndex, `${what} would run through an existing beam pipe.`);
    } else if (reason === 'not_straight' || reason === 'not_collinear' || reason === 'invalid_path') {
      this.block(NOT_STRAIGHT, nodeIndex, `${what} would not be a straight run.`);
    } else if (reason === 'port_taken' || reason === 'no_open_end') {
      this.block(NO_SPACE, nodeIndex, `There is no free beam port left to attach ${what} to.`);
    } else {
      this.block(NOT_STRAIGHT, nodeIndex, `${what} cannot be drawn here (${reason}).`);
    }
  }

  emitTuneModule(junctionId, params, nodeIndex) {
    this.tunes.push({ kind: 'tuneParams', nodeIndex, target: 'module', junctionId, params });
  }

  emitTunePlacement(pipeId, placementId, params, nodeIndex) {
    this.tunes.push({
      kind: 'tuneParams', nodeIndex, target: 'placement', pipeId, placementId, params,
    });
  }

  ops() {
    return [
      ...this.removals,
      ...this.merges,
      ...this.junctionRemovals,
      ...this.geometry,
      ...this.placements,
      ...this.tunes,
    ];
  }
}

// ---------------------------------------------------------------------------
// Draft classification
// ---------------------------------------------------------------------------

function draftModuleRef(node) {
  return (node && node._pipeKind === 'module' && node._sourceRef && node._sourceRef.placeableId)
    ? node._sourceRef.placeableId : null;
}

function draftPlacementRef(node) {
  return (node && node._pipeKind === 'placement' && node._sourceRef && node._sourceRef.placementId)
    ? node._sourceRef.placementId : null;
}

function draftPipeRef(node) {
  return (node && node._sourceRef && node._sourceRef.pipeId) ? node._sourceRef.pipeId : null;
}

/**
 * Whether this draft node needs creating on the map.
 *
 * A palette Replace intentionally keeps the node's draft id and map
 * back-reference so undo/selection remain stable. Identity alone therefore
 * is not enough: when the referenced map object has a different type, the old
 * object is a removal and this node is also an addition. Beam Pipe is the one
 * exception. Replacing hardware with a drift means "remove the hardware and
 * leave the underlying/merged pipe", not "buy more pipe at this position".
 */
function isAddition(p, node) {
  const moduleId = draftModuleRef(node);
  const placementId = draftPlacementRef(node);
  const pipeId = draftPipeRef(node);
  const hasIdentity = !!(moduleId || placementId || pipeId);
  if (!hasIdentity) return true;
  if (joinKind(node.type) === 'drift') return false;
  if (moduleId) return p.mapModuleTypes.get(moduleId) !== node.type;
  if (placementId) return p.mapPlacementTypes.get(placementId) !== node.type;
  // A non-drift node retaining a drift's pipe reference is a replacement of
  // that schematic span, so it must be materialised as new hardware.
  return true;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * @param {Object} state       game.state — read only, never mutated
 * @param {Object} opts
 * @param {string} opts.sourceId     source junction the draft was opened from
 * @param {Array}  opts.draftNodes   the desired stack (never mutated)
 * @param {Array}  [opts.originalNodes]  the stack as it was when the designer
 *   opened. Accepted for symmetry with the designer's own bookkeeping and
 *   ignored: the MAP, re-walked here with flattenPath, is authoritative — the
 *   world can have changed since the designer opened.
 * @returns {{ok:boolean, ops:Array, summary:Object, blockers:Array}}
 */
export function planDesignerApply(state, opts = {}) {
  const { sourceId, draftNodes } = opts;
  const p = new Planner(state, { sourceId, draftNodes });

  if (!sourceId) {
    p.block(SOURCE_IMMOVABLE, -1, 'This beamline has no source to plan against.');
    return finish(p);
  }

  const entries = flattenPath(p.state, sourceId);
  if (entries.length === 0) {
    p.block(SOURCE_IMMOVABLE, -1, 'The source this beamline was opened from is gone.');
    return finish(p);
  }
  const segs = partitionRun(entries);
  const mapModules = segs.filter(s => s.kind === 'module').map(s => s.entry);

  if (detectMultiBranch(p, segs)) return finish(p);
  if (!checkSourceInvariants(p, mapModules)) return finish(p);

  planRun(p, segs, mapModules);
  return finish(p);
}

// --- invariants ------------------------------------------------------------

function detectMultiBranch(p, segs) {
  const pipes = p.state.beamPipes || [];
  for (const seg of segs) {
    if (seg.kind !== 'module') continue;
    const id = seg.entry.id;
    let attached = 0;
    for (const pipe of pipes) {
      if (pipe.start && pipe.start.junctionId === id) attached++;
      if (pipe.end && pipe.end.junctionId === id) attached++;
    }
    const routing = (compDef(seg.entry.type) || {}).routing || [];
    const targets = new Set(routing.map(r => r.to));
    if (attached > 2 || targets.size > 1) {
      p.block(MULTI_BRANCH_UNSUPPORTED, draftIndexOfModule(p, id),
        `${displayName(seg.entry.type)} splits the beam into more than one path. `
        + 'The designer cannot plan branching beamlines yet — edit this one on the map.');
      return true;
    }
  }
  return false;
}

function draftIndexOfModule(p, placeableId) {
  for (let i = 0; i < p.draft.length; i++) {
    if (draftModuleRef(p.draft[i]) === placeableId) return i;
  }
  return -1;
}

function checkSourceInvariants(p, mapModules) {
  const source = mapModules[0];
  let sourceIdx = -1;
  for (let i = 0; i < p.draft.length; i++) {
    if (draftModuleRef(p.draft[i]) === source.id) { sourceIdx = i; break; }
  }
  if (sourceIdx < 0) {
    p.block(SOURCE_IMMOVABLE, -1,
      `${displayName(source.type)} anchors this beamline and cannot be removed here. `
      + 'Demolish it on the map if you really mean to.');
    return false;
  }
  if (p.draft[sourceIdx].type !== source.type) {
    p.block(SOURCE_IMMOVABLE, sourceIdx,
      `${displayName(source.type)} anchors this beamline and cannot be replaced here. `
      + 'Demolish it on the map if you really mean to.');
    return false;
  }
  if (sourceIdx !== 0) {
    p.block(SOURCE_IMMOVABLE, 0,
      `Nothing can go in front of ${displayName(source.type)} — the source is anchored `
      + 'where it stands.');
    return false;
  }
  return true;
}

// --- the walk --------------------------------------------------------------

function planRun(p, segs, mapModules) {
  const mapModuleIds = mapModules.map(m => m.id);
  const mapModuleById = new Map(mapModules.map(m => [m.id, m]));
  const mapPlacementById = new Map();
  for (const seg of segs) {
    if (seg.kind !== 'pipe') continue;
    for (const item of seg.items) {
      if (item.kind === 'placement') mapPlacementById.set(item.id, item);
    }
  }
  // Draft classification below must compare retained back-references with
  // the map types they originally named. Keep these on the private planner,
  // never on the caller's draft nodes.
  p.mapModuleTypes = new Map(mapModules.map(m => [m.id, m.type]));
  p.mapPlacementTypes = new Map(
    [...mapPlacementById].map(([id, item]) => [id, item.type]),
  );

  // Surviving module anchors, in draft order. A draft node keeps its identity
  // only while its TYPE still matches the map; swapping a module's type is a
  // delete plus an add, and falls out of the machinery below for free.
  const survivors = [];
  for (let i = 0; i < p.draft.length; i++) {
    const id = draftModuleRef(p.draft[i]);
    if (!id) continue;
    const m = mapModuleById.get(id);
    if (!m || m.type !== p.draft[i].type) continue;
    survivors.push({ id, draftIndex: i });
  }

  // Order must be preserved; reordering existing junctions is displacement.
  let cursor = -1;
  for (const s of survivors) {
    const at = mapModuleIds.indexOf(s.id, cursor + 1);
    if (at < 0) {
      p.block(NO_SPACE, s.draftIndex,
        `Reordering ${displayName(mapModuleById.get(s.id).type)} would mean moving it on the map. `
        + 'That is not supported yet — move it on the map instead.');
      return;
    }
    cursor = at;
  }

  // Between each surviving pair sits exactly one gap in the draft and
  // one-or-more pipes on the map (more when a junction between them was
  // deleted and the pipes have to be merged back together).
  const gaps = survivors.map((upstream, k) => {
    const next = survivors[k + 1] || null;
    return {
      upstream,
      next,
      gapNodes: collectGapNodes(
        p, upstream.draftIndex, next ? next.draftIndex : p.draft.length,
      ),
      mapPipeIds: mapPipesBetween(segs, upstream.id, next ? next.id : null),
      workingId: null,
    };
  });

  // --- 1. dropped attachments ---------------------------------------------
  const survivorIds = new Set(survivors.map(s => s.id));
  const survivingPlacementIds = new Set();
  for (const node of p.draft) {
    const pid = draftPlacementRef(node);
    if (pid && mapPlacementById.get(pid)?.type === node.type) {
      survivingPlacementIds.add(pid);
    }
  }
  for (const seg of segs) {
    if (seg.kind !== 'pipe') continue;
    for (const item of seg.items) {
      if (item.kind !== 'placement') continue;
      if (!survivingPlacementIds.has(item.id)) {
        p.emitRemoveFromPipe(seg.pipeId, item.id, item.type);
      }
    }
  }

  // --- 2. merges, while the doomed junctions still anchor their pipes ------
  for (const gap of gaps) {
    if (gap.mapPipeIds.length === 0) continue;
    let workingId = gap.mapPipeIds[0];
    for (let i = 1; i < gap.mapPipeIds.length; i++) {
      const merged = p.emitMergePipes(workingId, gap.mapPipeIds[i], -1);
      if (!merged) return;
      workingId = merged;
    }
    gap.workingId = workingId;
  }

  // --- 3. junction removals ------------------------------------------------
  for (const seg of segs) {
    if (seg.kind === 'module' && !survivorIds.has(seg.entry.id)) {
      p.emitRemoveJunction(seg.entry.id, seg.entry.type);
    }
  }

  // --- 4-6. geometry, placements, tuning, gap by gap ----------------------
  for (const gap of gaps) {
    tuneModuleIfChanged(p, mapModuleById.get(gap.upstream.id), gap.upstream.draftIndex);
    if (gap.workingId == null) {
      planGapWithNoPipe(p, gap.upstream, gap.gapNodes, gap.next);
      continue;
    }
    planGap(p, {
      workingId: gap.workingId,
      upstreamId: gap.upstream.id,
      gapNodes: gap.gapNodes,
      terminal: !gap.next,
      merged: gap.mapPipeIds.length > 1,
      mapPipeIds: gap.mapPipeIds,
      segs,
    });
  }
}

/** Draft nodes strictly between two module anchors. */
function collectGapNodes(p, fromIdx, toIdx) {
  const out = [];
  for (let i = fromIdx + 1; i < toIdx; i++) out.push({ node: p.draft[i], index: i });
  return out;
}

/** Map pipe ids between two surviving modules (several if one was deleted). */
function mapPipesBetween(segs, upstreamId, downstreamId) {
  const ids = [];
  let seen = false;
  for (const seg of segs) {
    if (seg.kind === 'module') {
      if (seg.entry.id === upstreamId) { seen = true; continue; }
      if (seen && downstreamId && seg.entry.id === downstreamId) break;
      continue;
    }
    if (seen) ids.push(seg.pipeId);
  }
  return ids;
}

function tuneModuleIfChanged(p, mapEntry, draftIndex) {
  if (!mapEntry || draftIndex < 0) return;
  const node = p.draft[draftIndex];
  if (!node) return;
  if (changedParams(mapEntry.params, node.params)) {
    p.emitTuneModule(mapEntry.id, { ...(node.params || {}) }, draftIndex);
  }
}

/**
 * The run ends at a junction with no pipe hanging off it (a bare source, or a
 * beamline whose last pipe was demolished). Anything appended has to start
 * with a Beam Pipe drawn out of that junction's free port.
 */
function planGapWithNoPipe(p, upstream, gapNodes, next) {
  if (gapNodes.length === 0) return;
  if (next) {
    p.block(NO_SPACE, gapNodes[0].index,
      'There is no beam pipe between those two modules to add anything to.');
    return;
  }
  const placeable = shadowPlaceable(p.shadow, upstream.id);
  const def = compDef(placeable ? placeable.type : null);
  const port = exitPortName(def);
  if (!port) {
    p.block(NO_SPACE, gapNodes[0].index,
      `Nothing can follow ${displayName(placeable && placeable.type)} — it has no beam exit.`);
    return;
  }
  const first = gapNodes[0];
  if (joinKind(first.node.type) !== 'drift') {
    p.block(NO_SPACE, first.index,
      `Add a Beam Pipe before ${displayName(first.node.type)} — hardware needs pipe to sit on.`);
    return;
  }
  const pipeSym = p.emitDrawPipe(
    upstream.id, port, subLOf(first.node.type, 4) * TILE_PER_SUB, first.index, 'geometry',
  );
  if (!pipeSym) return;
  planTail(p, {
    workingId: pipeSym,
    upstreamId: upstream.id,
    nodes: gapNodes.slice(1),
  });
}

/**
 * One gap: the draft nodes between two surviving modules (or after the last
 * one), against the single working pipe that spans them.
 */
function planGap(p, ctx) {
  const { workingId, upstreamId, gapNodes, terminal, merged, mapPipeIds, segs } = ctx;

  // Drift accounting. Existing drift nodes are elastic filler — the pipe's own
  // length is authoritative — so only ADDED drift and DELETED drift change the
  // run's length, and only an open downstream end can absorb the change.
  const mapDriftSubL = mapPipeIds.reduce(
    (sum, id) => sum + driftSubLOfPipe(segs, id), 0,
  );
  let draftDriftSubL = 0;
  for (const { node } of gapNodes) {
    // A palette replacement of a schematic drift keeps this original drift
    // back-reference while changing node.type to the requested hardware. The
    // physical pipe remains underneath an attachment, so it still counts as
    // retained drift and must not also schedule a trim of the whole span.
    if (draftPipeRef(node) && node._pipeKind === 'drift') {
      draftDriftSubL += node.subL || 0;
    }
  }
  // Merging reshapes the drift totals (the merged run swallows the deleted
  // junction's footprint), so a shrink is only meaningful without a merge.
  const removedDriftSubL = merged ? 0 : Math.max(0, mapDriftSubL - draftDriftSubL);

  const lastMapItemIdx = lastMapDerivedIndex(p, gapNodes);

  const state = {
    workingId,
    upstreamId,
    // Beam offset reached so far inside the working pipe.
    cursor: 0,
  };

  for (let i = 0; i < gapNodes.length; i++) {
    const { node, index } = gapNodes[i];

    if (!isAddition(p, node)) {
      const plId = draftPlacementRef(node);
      if (plId) {
        const pipe = shadowPipe(p.shadow, state.workingId);
        const pl = pipe && (pipe.placements || []).find(x => x.id === plId);
        if (pl) {
          const dir = directionOf(pipe, state.upstreamId);
          state.cursor = placementBeamStart(pipe, pl, dir) + pl.subL;
          const params = changedParams(pl.params, node.params);
          if (params) p.emitTunePlacement(pipe.id, plId, { ...(node.params || {}) }, index);
        }
      }
      continue;
    }

    const kind = joinKind(node.type);
    const inTail = terminal && i > lastMapItemIdx;

    if (kind === 'drift') {
      if (!inTail) {
        p.block(NO_SPACE, index,
          'Adding beam pipe here would push everything downstream along. '
          + 'That is not supported yet — add it at the open end of the run instead.');
        return;
      }
      if (!appendDrift(p, state, node, index)) return;
      continue;
    }

    if (kind === 'attachment') {
      if (!appendAttachment(p, state, node, index, inTail)) return;
      continue;
    }

    if (kind === 'junction') {
      if (!appendJunction(p, state, node, index, inTail)) return;
      continue;
    }

    p.block(NO_SPACE, index, `${displayName(node.type)} does not belong on a beamline.`);
    return;
  }

  // Net drift change left over after the walk (a deleted Beam Pipe node).
  if (removedDriftSubL > 0) {
    const pipe = shadowPipe(p.shadow, state.workingId);
    const dir = pipe ? directionOf(pipe, state.upstreamId) : 'forward';
    if (terminal && pipe && !farEndRef(pipe, dir)) {
      p.emitTrimPipe(state.workingId, removedDriftSubL, -1);
    } else {
      p.block(NO_SPACE, -1,
        'Shortening this beamline would pull everything downstream back along. '
        + 'That is not supported yet.');
    }
  }
}

function driftSubLOfPipe(segs, pipeId) {
  for (const seg of segs) {
    if (seg.kind !== 'pipe' || seg.pipeId !== pipeId) continue;
    return seg.items.reduce((s, it) => s + (it.kind === 'drift' ? it.subL : 0), 0);
  }
  return 0;
}

function lastMapDerivedIndex(p, gapNodes) {
  let last = -1;
  for (let i = 0; i < gapNodes.length; i++) {
    if (!isAddition(p, gapNodes[i].node)) last = i;
  }
  return last;
}

/** Trailing-only variant used after a fresh drawPipe out of a bare junction. */
function planTail(p, { workingId, upstreamId, nodes }) {
  const state = { workingId, upstreamId, cursor: 0 };
  for (const { node, index } of nodes) {
    const kind = joinKind(node.type);
    if (kind === 'drift') { if (!appendDrift(p, state, node, index)) return; }
    else if (kind === 'attachment') { if (!appendAttachment(p, state, node, index, true)) return; }
    else if (kind === 'junction') { if (!appendJunction(p, state, node, index, true)) return; }
    else {
      p.block(NO_SPACE, index, `${displayName(node.type)} does not belong on a beamline.`);
      return;
    }
  }
}

// --- the three append primitives -------------------------------------------

function appendDrift(p, state, node, index) {
  const tiles = subLOf(node.type, 4) * TILE_PER_SUB;
  if (state.workingId) {
    const pipe = shadowPipe(p.shadow, state.workingId);
    const dir = directionOf(pipe, state.upstreamId);
    if (farEndRef(pipe, dir)) {
      p.block(NO_SPACE, index,
        'That beam pipe already runs into another module, so it cannot be lengthened here.');
      return false;
    }
    return p.emitExtendPipe(state.workingId, dir, tiles, index);
  }
  // Downstream of a junction this plan just placed.
  const def = compDef(shadowPlaceable(p.shadow, state.upstreamId)?.type);
  const port = exitPortName(def);
  if (!port) {
    p.block(NO_SPACE, index,
      `Nothing can follow ${displayName(shadowPlaceable(p.shadow, state.upstreamId)?.type)} — `
      + 'it has no beam exit.');
    return false;
  }
  const sym = p.emitDrawPipe(state.upstreamId, port, tiles, index, 'placement');
  if (!sym) return false;
  state.workingId = sym;
  state.cursor = 0;
  return true;
}

function appendAttachment(p, state, node, index, inTail) {
  if (!state.workingId) {
    p.block(NO_SPACE, index,
      `Add a Beam Pipe before ${displayName(node.type)} — hardware needs pipe to sit on.`);
    return false;
  }
  const pipe = shadowPipe(p.shadow, state.workingId);
  const dir = directionOf(pipe, state.upstreamId);
  const subL = subLOf(node.type);
  const span = freeSpanFrom(pipe, state.cursor, dir);
  const centreOffset = Math.max(state.cursor, (span.lo + span.hi) / 2 - subL / 2) + subL / 2;
  const centreFraction = beamOffsetToPathFraction(pipe, centreOffset - subL / 2, subL, dir)
    + (subL / pipe.subL) / 2;
  const mode = node._insertMode || 'insert';

  // At an open end there is always somewhere to put it: buy the pipe it needs.
  if (inTail && span.hi - span.lo + EPS < subL && !farEndRef(pipe, dir)) {
    const shortfallSub = Math.ceil(subL - (span.hi - span.lo) - EPS);
    if (!p.emitExtendPipe(state.workingId, dir, shortfallSub * TILE_PER_SUB, index)) return false;
    const grown = shadowPipe(p.shadow, state.workingId);
    const gdir = directionOf(grown, state.upstreamId);
    const gspan = freeSpanFrom(grown, state.cursor, gdir);
    const gCentre = beamOffsetToPathFraction(grown, gspan.hi - subL, subL, gdir)
      + (subL / grown.subL) / 2;
    if (!p.emitPlaceOnPipe(state.workingId, node, index, gCentre, mode)) return false;
    state.cursor = gspan.hi;
    return true;
  }

  if (!p.emitPlaceOnPipe(state.workingId, node, index, centreFraction, mode)) return false;
  state.cursor = centreOffset + subL / 2;
  return true;
}

function appendJunction(p, state, node, index, inTail) {
  const def = compDef(node.type);
  if (!def) {
    p.block(NO_SPACE, index, `${node.type} is not a component.`);
    return false;
  }
  if (!state.workingId) {
    p.block(NO_SPACE, index,
      `Add a Beam Pipe before ${displayName(node.type)} — two modules cannot touch directly.`);
    return false;
  }
  const pipe = shadowPipe(p.shadow, state.workingId);
  const dir = directionOf(pipe, state.upstreamId);
  const beam = beamVector(pipe, dir);
  if (!beam) {
    p.block(NOT_STRAIGHT, index, 'That beam pipe is not a straight run.');
    return false;
  }
  const gapSubL = subLOf(node.type, 4);
  const entry = entryPortName(def);
  const exit = exitPortName(def);
  if (!entry) {
    p.block(NOT_STRAIGHT, index,
      `${displayName(node.type)} has no beam entry, so nothing can feed it.`);
    return false;
  }

  // Past the last map-derived item on an OPEN end: park it beyond the pipe's
  // cap and bind the cap to its entry port. Nothing downstream to disturb.
  if (inTail && !farEndRef(pipe, dir)) {
    const cap = farEndPoint(pipe, dir);
    const centre = stepPoint(cap, beam, gapSubL * TILE_PER_SUB / 2);
    const sym = p.emitPlaceJunction(node, index, centre, beam, [
      { pipe: state.workingId, end: farEndSide(dir), port: entry },
    ]);
    if (!sym) return false;
    state.upstreamId = sym;
    state.workingId = null;
    state.cursor = 0;
    return true;
  }

  // Interior: splice it into the drift, which has to have room for it. Two
  // ways that can be wrong before geometry is even considered — a module with
  // no beam exit at all terminates the run, and one whose exit is not on its
  // front face (a dipole) bends the beam, which a straight pipe cannot carry.
  if (!exit) {
    const bends = beamPortNames(def).some(n => n !== entry);
    if (bends) {
      p.block(NOT_STRAIGHT, index,
        `${displayName(node.type)} sends the beam off at an angle, so it cannot be `
        + 'spliced into a straight beam pipe. Place it on the map instead.');
    } else {
      p.block(NO_SPACE, index,
        `${displayName(node.type)} ends the beamline — nothing can come after it. `
        + 'Move it to the end of the stack.');
    }
    return false;
  }
  // Centre the hole in the free stretch: that maximises the shorter stub, so
  // stub_too_short only fires when the drift genuinely cannot be cut here.
  // Clamped into the pipe so validateSplitPipe answers with the geometric
  // reason (gap_too_large / stub_too_short) rather than invalid_position.
  const span = freeSpanFrom(pipe, state.cursor, dir);
  const startOffset = Math.min(
    Math.max(0, pipe.subL - gapSubL),
    Math.round(Math.max(state.cursor, (span.lo + span.hi) / 2 - gapSubL / 2)),
  );
  const atPosition = beamOffsetToPathFraction(pipe, startOffset, gapSubL, dir);
  const split = p.emitSplitPipe(
    state.workingId, atPosition, gapSubL, index, displayName(node.type),
  );
  if (!split) return false;

  // path[0] is the head stub's outer end regardless of beam direction, so the
  // upstream stub is the head only when the beam runs with the path.
  const upstreamStub = dir === 'forward' ? split.head : split.tail;
  const downstreamStub = dir === 'forward' ? split.tail : split.head;
  const sym = p.emitPlaceJunction(node, index, split.gapCenter, beam, [
    { pipe: upstreamStub, end: farEndSide(dir), port: entry },
    { pipe: downstreamStub, end: nearEndSide(dir), port: exit },
  ]);
  if (!sym) return false;
  state.upstreamId = sym;
  state.workingId = downstreamStub;
  state.cursor = 0;
  return true;
}

// --- summary ---------------------------------------------------------------

function finish(p) {
  const adds = [...p.adds.values()].map(r => ({
    type: r.type, count: r.count, cost: r.cost,
    ...(r.metres ? { metres: Math.round(r.metres * 100) / 100 } : {}),
  }));
  const removes = [...p.removes.values()].map(r => ({
    type: r.type, count: r.count, refund: r.refund,
  }));
  const totalCost = adds.reduce((s, r) => s + r.cost, 0)
    - removes.reduce((s, r) => s + r.refund, 0);

  const funding = p.state && p.state.resources && typeof p.state.resources.funding === 'number'
    ? p.state.resources.funding : null;
  if (funding != null && totalCost > funding) {
    p.block(UNAFFORDABLE, -1,
      `This costs $${totalCost.toLocaleString()} and you have $${funding.toLocaleString()}.`);
  }

  return {
    ok: p.blockers.length === 0,
    ops: p.ops(),
    summary: {
      adds,
      removes,
      movedCount: 0,
      movedDistanceM: 0,
      danglingLineCount: 0,
      totalCost,
    },
    blockers: p.blockers,
  };
}

export default planDesignerApply;
