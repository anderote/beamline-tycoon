// src/beamline/pipe-splice.js
//
// Pure validators for RESHAPING pipes that already exist: splitting one in two
// around a hole, merging two collinear neighbours back into a single run,
// trimming one back from its open end, and removing an arbitrary interior
// section of one. Same contract as pipe-drawing.js —
// every entry point answers "is this legal, and what would the result be?" and
// mutates nothing. BeamlineSystem owns the writes.
//
// Geometry recap (see pipe-drawing.js / pipe-placements.js):
//   - A pipe is {id, start, end, path, subL, placements}. `start` refers to
//     path[0], `end` to the last path point; either may be null (open end).
//   - Pipes are STRAIGHT ONLY: a single axis, no corners.
//   - subL is measured in sub-units. 4 sub-units = 1 tile = 2 m.
//   - A placement's `position` is a 0..1 arc-length fraction from path[0] and
//     it occupies [position, position + subL / pipe.subL].
//
// Every result path is emitted as a two-point waypoint path (`[from, to]`),
// which is what validateDrawPipe produces and what expandPipePath / the
// renderer / placementPose all consume correctly.
//
// Positions are the subtle part: whenever a pipe's length or its path[0] moves,
// every surviving placement has to be re-expressed in the NEW pipe's 0..1 frame
// or it silently slides along the beamline. Each validator therefore converts
// fractions to absolute arc length, applies the geometric change, and converts
// back against the new length.
//
// Rejection reasons:
//   pipe_not_found           — no pipe with that id in state.beamPipes
//   invalid_pipe             — the pipe's path is missing, zero-length or bent
//   invalid_position         — split: atPosition outside 0..1, or a gap that is
//                              not a positive whole number of sub-units
//   gap_too_large            — split: the hole does not fit in this pipe at ANY
//                              position (gap + two minimum stubs > pipe.subL)
//   stub_too_short           — split: the hole fits somewhere, but not HERE —
//                              a resulting stub would fall below MIN_STUB_SUBL
//   placement_in_gap         — split: an existing placement overlaps the hole
//   not_collinear            — merge: the pipes are not on one straight line
//   not_adjacent             — merge: they do not meet end-to-end (no shared
//                              junction, no shared coordinate), they overlap,
//                              or the same pipe was passed twice
//   no_open_end              — trim: both ends are attached to junctions
//   invalid_length           — trim: newSubL is not a whole number in 1..subL-1
//   placement_beyond_new_end — trim: a placement sits in the removed section
//   invalid_section          — removeSection: [from, to) is not a non-empty
//                              whole-sub-unit range inside 0..subL

// Geometry tolerance (tile coordinates land on 0.25 boundaries).
const EPS = 1e-6;
// Fraction-space tolerance, matching pipe-placements.js interval maths.
const IEPS = 1e-9;

// 4 sub-units per tile: path distance is in tiles, subL in sub-units.
const SUB_PER_TILE = 4;

/**
 * Shortest stub a split may leave behind: 1 sub-unit = 0.25 tile = 0.5 m, the
 * quantum pipes are drawn at (pipe-geometry.js STEP) and the floor
 * computeSubL() already clamps to. Anything below that is a zero-length pipe,
 * which has no direction and cannot host a placement.
 */
export const MIN_STUB_SUBL = 1;

function reject(reason) { return { ok: false, reason }; }

// Kill float dust so emitted waypoints stay on clean 0.25 boundaries.
function roundCoord(v) { return Math.round(v * 1e6) / 1e6; }

function sortByPosition(list) {
  return list.slice().sort((a, b) => a.position - b.position);
}

function findPipe(state, pipeId) {
  const pipes = (state && state.beamPipes) || [];
  return pipes.find(p => p && p.id === pipeId) || null;
}

/**
 * Reduce a pipe to the straight-line description everything here works in:
 *   axis    'col' | 'row' — the coordinate that varies along the run
 *   cross   the constant coordinate
 *   u0, u1  axis coordinate at path[0] and at the last path point
 *   lenTiles, subL
 * Returns null for a missing, zero-length or bent path (dense sub-tile paths
 * are fine — only the axis matters, not the waypoint count).
 */
function describePipe(pipe) {
  const path = (pipe && pipe.path) || [];
  if (path.length < 2) return null;
  const first = path[0];
  const last = path[path.length - 1];
  let sameCol = true, sameRow = true;
  for (const p of path) {
    if (!p) return null;
    if (Math.abs(p.col - first.col) > EPS) sameCol = false;
    if (Math.abs(p.row - first.row) > EPS) sameRow = false;
  }
  let axis;
  if (sameCol && !sameRow) axis = 'row';
  else if (sameRow && !sameCol) axis = 'col';
  else return null;  // bent, or every point identical
  const u0 = first[axis];
  const u1 = last[axis];
  const lenTiles = Math.abs(u1 - u0);
  if (lenTiles < EPS) return null;
  const cross = axis === 'row' ? first.col : first.row;
  const subL = (typeof pipe.subL === 'number' && pipe.subL > 0)
    ? pipe.subL
    : Math.max(1, Math.round(lenTiles * SUB_PER_TILE));
  return { axis, cross, u0, u1, lenTiles, subL, first, last };
}

// Point at arc-length fraction `t` (0..1 from path[0]) of a straight pipe.
function pointAt(d, t) {
  const u = d.u0 + (d.u1 - d.u0) * t;
  return d.axis === 'row'
    ? { col: roundCoord(d.cross), row: roundCoord(u) }
    : { col: roundCoord(u), row: roundCoord(d.cross) };
}

function subUnitsToTiles(sub) { return sub / SUB_PER_TILE; }

function placementInterval(pipeSubL, pl) {
  const start = pl.position;
  return { start, end: start + (pl.subL / pipeSubL) };
}

function intervalsOverlap(a, b) {
  return a.start < b.end - IEPS && b.start < a.end - IEPS;
}

// A whole number of sub-units, or null if the input isn't one.
function toSubUnits(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const r = Math.round(n);
  if (Math.abs(n - r) > EPS) return null;
  return r;
}

// -----------------------------------------------------------------------
// Public: validateSplitPipe
// -----------------------------------------------------------------------

/**
 * Can this pipe be divided at arc-length fraction `atPosition`, leaving a hole
 * of `gapSubL` sub-units for a junction to occupy?
 *
 * The hole STARTS at `atPosition` and runs forward `gapSubL` sub-units — the
 * same convention a placement uses (`position` is its leading edge, not its
 * centre). The cut is quantized onto the nearest sub-unit boundary so both
 * stubs come out at whole sub-unit lengths and land on the 0.25 tile grid.
 *
 * On success:
 *   headPath / headSubL / headPlacements — the stub containing path[0]. It
 *     inherits the pipe's `start`; its far end is open (the new junction).
 *   tailPath / tailSubL / tailPlacements — the stub containing the last path
 *     point. It inherits the pipe's `end`; its near end is open.
 *   gapStart / gapEnd — the hole as fractions of the ORIGINAL pipe.
 *   gapCenter — {col, row} midpoint of the hole, where the junction goes.
 *
 * Every surviving placement keeps its id/type/subL/params and is handed back on
 * whichever stub contains it, with `position` re-expressed in that stub's own
 * 0..1 frame (absolute metres along the beamline are preserved).
 */
export function validateSplitPipe(state, pipeId, atPosition, gapSubL) {
  const pipe = findPipe(state, pipeId);
  if (!pipe) return reject('pipe_not_found');
  const d = describePipe(pipe);
  if (!d) return reject('invalid_pipe');

  if (typeof atPosition !== 'number' || !Number.isFinite(atPosition)) {
    return reject('invalid_position');
  }
  if (atPosition < -IEPS || atPosition > 1 + IEPS) return reject('invalid_position');
  const gap = toSubUnits(gapSubL);
  if (gap == null || gap <= 0) return reject('invalid_position');

  const total = d.subL;
  // "Too large" is a property of the gap and the pipe alone: no cut anywhere
  // could work. "Stub too short" is a property of THIS cut. Keeping them
  // distinct lets the planner tell "that module can never fit in this drift"
  // apart from "move the insertion point".
  if (gap + 2 * MIN_STUB_SUBL > total) return reject('gap_too_large');

  const clamped = Math.max(0, Math.min(1, atPosition));
  const headSubL = Math.round(clamped * total);
  const tailSubL = total - headSubL - gap;
  if (headSubL < MIN_STUB_SUBL || tailSubL < MIN_STUB_SUBL) {
    return reject('stub_too_short');
  }

  const gapStart = headSubL / total;
  const gapEnd = (headSubL + gap) / total;
  const gapInterval = { start: gapStart, end: gapEnd };

  const headPlacements = [];
  const tailPlacements = [];
  for (const pl of (pipe.placements || [])) {
    const iv = placementInterval(total, pl);
    if (intervalsOverlap(iv, gapInterval)) return reject('placement_in_gap');
    if (iv.end <= gapStart + IEPS) {
      // Head stub: same path[0], shorter length — rescale against headSubL.
      headPlacements.push({
        ...pl,
        position: Math.max(0, (pl.position * total) / headSubL),
      });
    } else {
      // Tail stub: path[0] moved forward by (headSubL + gap) sub-units, so the
      // consumed length has to come off before rescaling.
      tailPlacements.push({
        ...pl,
        position: Math.max(0, (pl.position * total - (headSubL + gap)) / tailSubL),
      });
    }
  }

  return {
    ok: true,
    headPath: [pointAt(d, 0), pointAt(d, gapStart)],
    tailPath: [pointAt(d, gapEnd), pointAt(d, 1)],
    headSubL,
    tailSubL,
    headPlacements: sortByPosition(headPlacements),
    tailPlacements: sortByPosition(tailPlacements),
    gapStart,
    gapEnd,
    gapCenter: pointAt(d, (headSubL + gap / 2) / total),
  };
}

// -----------------------------------------------------------------------
// Public: validateRemovePipeSection
// -----------------------------------------------------------------------

/**
 * Can sub-units `[fromSub, toSub)` be cut out of this pipe, and what is left
 * over? This is the demolish tool's primitive — "delete the 0.5 m of pipe
 * under the cursor" — so unlike its siblings it has to cope with a cut that
 * lands anywhere, including flush against a terminal that is bound to a
 * junction.
 *
 * `action` says which shape the survivor takes:
 *
 *   'removeAll'  the cut is the whole pipe. Nothing survives; the caller
 *                deletes the pipe outright (which is also the only path that
 *                refunds on-pipe hardware and releases its utility endpoints).
 *   'trim'       the cut reaches exactly one terminal. `path` / `subL` /
 *                `placements` describe the single survivor, `trimmedEnd` says
 *                which terminal was eaten, and `detach` is true when that
 *                terminal was BOUND — the caller must null the pipe's
 *                start/end ref, or the junction port stays occupied by
 *                geometry that no longer reaches it. (This is the case
 *                validateTrimPipe refuses outright with `no_open_end`: trim
 *                shortens a free end and leaves refs alone by contract.)
 *   'split'      the cut is interior. Two stubs, same shape validateSplitPipe
 *                emits, both facing inner ends open.
 *
 * `removedPath` / `removedSubL` describe the offcut so the caller can price
 * the refund off real geometry rather than re-deriving one.
 *
 * Placements are never destroyed here: a cut that overlaps mounted hardware is
 * rejected with `placement_in_gap` rather than swallowing it. Survivors keep
 * their own ids (they are utility endpoints) with `position` re-expressed in
 * whichever survivor now carries them.
 *
 * No `stub_too_short` case exists. Both bounds are whole sub-units, so an
 * interior cut leaves at least MIN_STUB_SUBL (1) on each side by construction,
 * and a cut reaching one terminal leaves at least that much on the other.
 */
export function validateRemovePipeSection(state, pipeId, fromSub, toSub) {
  const pipe = findPipe(state, pipeId);
  if (!pipe) return reject('pipe_not_found');
  const d = describePipe(pipe);
  if (!d) return reject('invalid_pipe');

  const total = d.subL;
  const from = toSubUnits(fromSub);
  const to = toSubUnits(toSub);
  if (from == null || to == null) return reject('invalid_section');
  if (from < 0 || to > total || to <= from) return reject('invalid_section');

  const cutStart = from / total;
  const cutEnd = to / total;
  const cut = { start: cutStart, end: cutEnd };
  for (const pl of (pipe.placements || [])) {
    if (intervalsOverlap(placementInterval(total, pl), cut)) {
      return reject('placement_in_gap');
    }
  }

  const removedSubL = to - from;
  const common = {
    ok: true,
    removedPath: [pointAt(d, cutStart), pointAt(d, cutEnd)],
    removedSubL,
    removedTiles: subUnitsToTiles(removedSubL),
  };

  if (from === 0 && to === total) {
    return { ...common, action: 'removeAll' };
  }

  if (from === 0) {
    // Head eaten: path[0] moves forward by `to` sub-units, so surviving
    // placements shift as well as rescale (same maths as a start-side trim).
    const n = total - to;
    return {
      ...common,
      action: 'trim',
      trimmedEnd: 'start',
      detach: pipe.start != null,
      path: [pointAt(d, cutEnd), pointAt(d, 1)],
      subL: n,
      placements: sortByPosition((pipe.placements || []).map(pl => ({
        ...pl,
        position: Math.max(0, (pl.position * total - to) / n),
      }))),
    };
  }

  if (to === total) {
    // Tail eaten: path[0] is unchanged, so placements only rescale.
    const n = from;
    return {
      ...common,
      action: 'trim',
      trimmedEnd: 'end',
      detach: pipe.end != null,
      path: [pointAt(d, 0), pointAt(d, cutStart)],
      subL: n,
      placements: sortByPosition((pipe.placements || []).map(pl => ({
        ...pl,
        position: Math.max(0, (pl.position * total) / n),
      }))),
    };
  }

  // Interior cut: two stubs. Each placement lands on exactly one of them —
  // the overlap check above already ruled out anything straddling the cut.
  const headPlacements = [];
  const tailPlacements = [];
  for (const pl of (pipe.placements || [])) {
    if (placementInterval(total, pl).end <= cutStart + IEPS) {
      headPlacements.push({ ...pl, position: Math.max(0, (pl.position * total) / from) });
    } else {
      tailPlacements.push({
        ...pl,
        position: Math.max(0, (pl.position * total - to) / (total - to)),
      });
    }
  }
  return {
    ...common,
    action: 'split',
    headPath: [pointAt(d, 0), pointAt(d, cutStart)],
    tailPath: [pointAt(d, cutEnd), pointAt(d, 1)],
    headSubL: from,
    tailSubL: total - to,
    headPlacements: sortByPosition(headPlacements),
    tailPlacements: sortByPosition(tailPlacements),
  };
}

// -----------------------------------------------------------------------
// Public: validateMergePipes
// -----------------------------------------------------------------------

// The two terminals of a pipe, each with the endpoint reference that belongs
// to it. path[0] is the `start` end; the last path point is the `end` end.
function terminals(pipe, d) {
  return [
    { pt: d.first, ref: pipe.start || null, isHead: true },
    { pt: d.last, ref: pipe.end || null, isHead: false },
  ];
}

function sameCoord(a, b) {
  return Math.abs(a.col - b.col) < EPS && Math.abs(a.row - b.row) < EPS;
}

function sharesJunction(refA, refB) {
  return !!(refA && refB && refA.junctionId && refA.junctionId === refB.junctionId);
}

/**
 * Are these two pipes collinear, adjacent, and mergeable into one legal
 * straight run?
 *
 * Adjacent means the two pipes meet end-to-end, either because a terminal of
 * each references the SAME junction (the usual case — deleting that junction
 * is what makes the merge interesting; its footprint becomes part of the
 * merged run) or because their terminals sit on the same coordinate.
 *
 * On success returns the merged `path` (a two-point waypoint path running from
 * A's free terminal to B's free terminal, spanning any junction gap between
 * them), `subL`, the merged `start`/`end` endpoint references, and every
 * placement from both pipes with `position` re-expressed in the merged 0..1
 * frame. A pipe whose path runs opposite to the merged direction has its
 * placements mirrored, not just offset.
 */
export function validateMergePipes(state, pipeIdA, pipeIdB) {
  const a = findPipe(state, pipeIdA);
  const b = findPipe(state, pipeIdB);
  if (!a || !b) return reject('pipe_not_found');
  if (a === b) return reject('not_adjacent');  // a pipe is not its own neighbour

  const da = describePipe(a);
  const db = describePipe(b);
  if (!da || !db) return reject('not_collinear');
  if (da.axis !== db.axis) return reject('not_collinear');
  if (Math.abs(da.cross - db.cross) > EPS) return reject('not_collinear');

  // Find the pair of terminals that meet.
  const termA = terminals(a, da);
  const termB = terminals(b, db);
  let joinA = null, joinB = null;
  for (const ta of termA) {
    for (const tb of termB) {
      if (sharesJunction(ta.ref, tb.ref) || sameCoord(ta.pt, tb.pt)) {
        joinA = ta; joinB = tb;
        break;
      }
    }
    if (joinA) break;
  }
  if (!joinA) return reject('not_adjacent');

  // The merged run spans the two FREE terminals.
  const freeA = joinA.isHead ? termA[1] : termA[0];
  const freeB = joinB.isHead ? termB[1] : termB[0];
  const axis = da.axis;
  const m0 = freeA.pt;
  const m1 = freeB.pt;
  const mergedLenTiles = Math.abs(m1[axis] - m0[axis]);
  if (mergedLenTiles < EPS) return reject('not_adjacent');
  // If the two runs overlap (or one doubles back over the other) the span is
  // shorter than their combined length — not a legal single straight run.
  if (da.lenTiles + db.lenTiles > mergedLenTiles + EPS) return reject('not_adjacent');

  const mergedSubL = Math.max(1, Math.round(mergedLenTiles * SUB_PER_TILE));
  const dirSign = Math.sign(m1[axis] - m0[axis]);
  const originU = m0[axis];
  // Arc length in tiles from the merged path[0], measured along merged direction.
  const arcOf = (pt) => (pt[axis] - originU) * dirSign;

  // Re-express one pipe's placements in the merged frame.
  const remap = (pipe, d) => {
    const sHead = arcOf(d.first);
    const sTail = arcOf(d.last);
    const runsWithMerged = sTail > sHead;
    return (pipe.placements || []).map(pl => {
      const wTiles = (pl.subL / d.subL) * d.lenTiles;
      const aTiles = pl.position * d.lenTiles;             // leading edge from d.first
      const startTiles = runsWithMerged
        ? sHead + aTiles
        : sHead - (aTiles + wTiles);                       // mirrored: trailing edge leads
      return { ...pl, position: Math.max(0, startTiles / mergedLenTiles) };
    });
  };

  const placements = sortByPosition([...remap(a, da), ...remap(b, db)]);

  return {
    ok: true,
    path: [
      { col: roundCoord(m0.col), row: roundCoord(m0.row) },
      { col: roundCoord(m1.col), row: roundCoord(m1.row) },
    ],
    subL: mergedSubL,
    placements,
    start: freeA.ref || null,
    end: freeB.ref || null,
  };
}

// -----------------------------------------------------------------------
// Public: validateTrimPipe
// -----------------------------------------------------------------------

/**
 * Shorten a pipe to `newSubL` sub-units, taking the length off its OPEN end —
 * the end whose `start`/`end` reference is null. A pipe open at both ends is
 * trimmed from its `end` (the last path point), matching validateExtendPipe's
 * preference for the tail side.
 *
 * On success returns the new two-point `path`, the new `subL`, and every
 * placement with `position` re-expressed in the shortened pipe's 0..1 frame.
 * Trimming the `start` side moves path[0] forward, so those positions shift as
 * well as rescale. `trimmedEnd` and `removedSubL` are reported so the caller
 * can price the refund. The pipe's endpoint references are unaffected.
 */
export function validateTrimPipe(state, pipeId, newSubL) {
  const pipe = findPipe(state, pipeId);
  if (!pipe) return reject('pipe_not_found');
  const d = describePipe(pipe);
  if (!d) return reject('invalid_pipe');

  const endOpen = pipe.end == null;
  const startOpen = pipe.start == null;
  if (!endOpen && !startOpen) return reject('no_open_end');

  const n = toSubUnits(newSubL);
  if (n == null || n <= 0 || n >= d.subL) return reject('invalid_length');

  const total = d.subL;
  const removed = total - n;
  const trimmedEnd = endOpen ? 'end' : 'start';

  let path;
  const placements = [];
  if (trimmedEnd === 'end') {
    const keepEnd = n / total;
    for (const pl of (pipe.placements || [])) {
      const iv = placementInterval(total, pl);
      if (iv.end > keepEnd + IEPS) return reject('placement_beyond_new_end');
      // path[0] is unchanged: rescale against the shorter length.
      placements.push({ ...pl, position: Math.max(0, (pl.position * total) / n) });
    }
    path = [pointAt(d, 0), pointAt(d, keepEnd)];
  } else {
    const keepStart = removed / total;
    for (const pl of (pipe.placements || [])) {
      const iv = placementInterval(total, pl);
      if (iv.start < keepStart - IEPS) return reject('placement_beyond_new_end');
      // path[0] moved forward by `removed` sub-units: shift, then rescale.
      placements.push({ ...pl, position: Math.max(0, (pl.position * total - removed) / n) });
    }
    path = [pointAt(d, keepStart), pointAt(d, 1)];
  }

  return {
    ok: true,
    path,
    subL: n,
    placements: sortByPosition(placements),
    trimmedEnd,
    removedSubL: removed,
    removedTiles: subUnitsToTiles(removed),
  };
}
