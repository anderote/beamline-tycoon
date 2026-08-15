// src/beamline/pipe-placements.js
//
// Pure slot-finding for placements on a pipe. Caller passes the pipe (read-
// only), the requested type/position/subL, and a mode ('snap' | 'replace' |
// 'insert'). We return a new `placements` array or a rejection reason.
//
// Position semantics:
//   - `position` is a fraction 0..1 along the pipe's total subL.
//   - An ordinary placement occupies
//     [position, position + subL / pipe.subL].
//   - An `inline: true` placement occupies a point at `position`. Point slots
//     may sit on an ordinary placement's boundary, but not in its interior;
//     two point slots at the same position collide.

const EPS = 1e-9;

function reject(reason) { return { ok: false, reason }; }

/**
 * Longitudinal pipe length claimed by a placement. Inline attachments retain
 * their authored `subL` for their mesh, catalogue dimensions, and save data,
 * but reserve a point slot so they can sit between ordinary components.
 */
export function placementSpanSubL(pl) {
  if (pl?.inline === true) return 0;
  return typeof pl?.subL === 'number' && pl.subL > 0 ? pl.subL : 0;
}

function intervalOf(pipeSubL, pl) {
  const start = pl.position;
  const span = placementSpanSubL(pl) / pipeSubL;
  return { start, end: start + span, point: span === 0 };
}

function conflicts(a, b) {
  if (a.point && b.point) return Math.abs(a.start - b.start) <= EPS;
  if (a.point) return a.start > b.start + EPS && a.start < b.end - EPS;
  if (b.point) return b.start > a.start + EPS && b.start < a.end - EPS;
  return a.start < b.end - EPS && b.start < a.end - EPS;
}

/** Whether two stored/candidate placements compete for the same pipe space. */
export function placementsConflict(pipeSubL, a, b) {
  if (!(pipeSubL > 0) || !a || !b) return false;
  return conflicts(intervalOf(pipeSubL, a), intervalOf(pipeSubL, b));
}

/** Whether a pipe fraction selects this placement (point slots included). */
export function placementContainsPosition(pipeSubL, pl, position) {
  if (!(pipeSubL > 0) || !pl || typeof position !== 'number') return false;
  const iv = intervalOf(pipeSubL, pl);
  if (iv.point) return Math.abs(position - iv.start) <= EPS;
  return position >= iv.start - EPS && position <= iv.end + EPS;
}

/**
 * Cursor fraction → legal placement position. Ordinary bodies start on
 * whole-subtile boundaries; inline point anchors use half-subtile steps so
 * the available positions alternate between subtile centres and edges.
 */
export function quantizePlacementPosition(pipe, cursorPosition, subL, inline = false) {
  const pipeSubL = pipe?.subL;
  if (!(pipeSubL > 0)) return cursorPosition;
  const cursorSubtiles = cursorPosition * pipeSubL;
  if (inline) {
    const anchorSubtiles = Math.round(cursorSubtiles * 2) / 2;
    return Math.max(0, Math.min(pipeSubL, anchorSubtiles)) / pipeSubL;
  }
  const startSubtiles = Math.round(cursorSubtiles - subL / 2);
  const clamped = Math.max(0, Math.min(pipeSubL - subL, startSubtiles));
  return clamped / pipeSubL;
}

function sortByPosition(list) {
  return list.slice().sort((a, b) => {
    const byPosition = a.position - b.position;
    if (Math.abs(byPosition) > EPS) return byPosition;
    // At a shared boundary the beam meets the point attachment before the
    // ordinary component whose interval starts there.
    return placementSpanSubL(a) - placementSpanSubL(b);
  });
}

// Capacity check: sum of claimed spans ≤ pipeSubL. Point slots are free.
function fitsCapacity(existing, newPlacement, pipeSubL) {
  let sum = placementSpanSubL(newPlacement);
  for (const pl of existing) sum += placementSpanSubL(pl);
  return sum <= pipeSubL + EPS;
}

// Given an ordered list of intervals (sorted by start) and a pipe length, find
// the free gaps (as [gapStart, gapEnd] in fraction space) including the ends.
function computeGaps(sorted, pipeSubL) {
  const gaps = [];
  let cursor = 0;
  for (const pl of sorted) {
    const iv = intervalOf(pipeSubL, pl);
    if (iv.start > cursor + EPS) gaps.push({ start: cursor, end: iv.start });
    cursor = Math.max(cursor, iv.end);
  }
  if (cursor < 1 - EPS) gaps.push({ start: cursor, end: 1 });
  return gaps;
}

// Within a gap [gapStart, gapEnd], try to place an interval of width `w` as
// close as possible to `target`. Returns a candidate start position, or null.
function snapIntoGap(gap, w, target) {
  if (gap.end - gap.start + EPS < w) return null;
  const lo = gap.start;
  const hi = gap.end - w;
  if (hi < lo - EPS) return null;
  // Clamp target into [lo, hi].
  const start = Math.max(lo, Math.min(hi, target));
  return start;
}

// -----------------------------------------------------------------------
// Mode: snap
// -----------------------------------------------------------------------
function doSnap(pipe, existing, { requestedPosition, subL, inline }) {
  const candidate = { position: requestedPosition, subL, inline };
  const w = placementSpanSubL(candidate) / pipe.subL;
  if (w > 1 + EPS) return reject('full');

  // Natural placement at requestedPosition, clamped into [0, 1-w].
  const naturalStart = Math.max(0, Math.min(1 - w, requestedPosition));
  const naturalInterval = { start: naturalStart, end: naturalStart + w, point: w === 0 };
  const collides = existing.some(pl => conflicts(naturalInterval, intervalOf(pipe.subL, pl)));
  if (!collides && requestedPosition >= -EPS && requestedPosition <= 1 + EPS) {
    return { ok: true, position: naturalStart };
  }

  // Search free gaps for the one whose closest snap point is nearest to
  // requestedPosition.
  const sorted = sortByPosition(existing);
  const gaps = computeGaps(sorted, pipe.subL);
  let best = null;
  let bestDist = Infinity;
  for (const g of gaps) {
    const cand = snapIntoGap(g, w, requestedPosition);
    if (cand == null) continue;
    const candInterval = { start: cand, end: cand + w, point: w === 0 };
    if (existing.some(pl => conflicts(candInterval, intervalOf(pipe.subL, pl)))) continue;
    // Distance measured from the start of the candidate interval to request.
    const dist = Math.abs(cand - requestedPosition);
    if (dist < bestDist - EPS) {
      bestDist = dist;
      best = cand;
    }
  }
  if (best == null) return reject('overlap');
  return { ok: true, position: best };
}

// -----------------------------------------------------------------------
// Mode: insert — shift existing neighbors outward to clear the new interval.
// -----------------------------------------------------------------------
function doInsert(pipe, existing, { requestedPosition, subL, inline }) {
  const candidate = { position: requestedPosition, subL, inline };
  const w = placementSpanSubL(candidate) / pipe.subL;
  if (w > 1 + EPS) return reject('full');
  if (!fitsCapacity(existing, candidate, pipe.subL)) return reject('full');

  // Centre new interval on requestedPosition.
  let newStart = requestedPosition - w / 2;
  let newEnd = newStart + w;
  // Clamp into [0, 1].
  if (newStart < 0) { newStart = 0; newEnd = w; }
  if (newEnd > 1) { newEnd = 1; newStart = 1 - w; }

  const sorted = sortByPosition(existing);
  const lefts = [];
  const rights = [];
  const newCenter = newStart + w / 2;
  for (const pl of sorted) {
    const iv = intervalOf(pipe.subL, pl);
    const c = (iv.start + iv.end) / 2;
    if (c < newCenter) lefts.push(pl);
    else rights.push(pl);
  }

  // Shift lefts so the rightmost ends at ≤ newStart. Walk right-to-left.
  const shiftedLefts = [];
  let rightCap = newStart;
  for (let i = lefts.length - 1; i >= 0; i--) {
    const pl = lefts[i];
    const plW = placementSpanSubL(pl) / pipe.subL;
    let pos = Math.min(pl.position, rightCap - plW);
    if (pos < -EPS) return reject('full');
    shiftedLefts.unshift({ ...pl, position: pos });
    rightCap = pos;
  }

  // Shift rights so each starts at ≥ newEnd, propagating rightward.
  const shiftedRights = [];
  let leftCap = newEnd;
  for (let i = 0; i < rights.length; i++) {
    const pl = rights[i];
    const plW = placementSpanSubL(pl) / pipe.subL;
    let pos = Math.max(pl.position, leftCap);
    if (pos + plW > 1 + EPS) return reject('full');
    shiftedRights.push({ ...pl, position: pos });
    leftCap = pos + plW;
  }

  return {
    ok: true,
    position: newStart,
    replaceExisting: [...shiftedLefts, ...shiftedRights],
  };
}

// -----------------------------------------------------------------------
// Mode: replace — swap the placement covering requestedPosition.
// -----------------------------------------------------------------------
function doReplace(pipe, existing, { requestedPosition, subL, inline }) {
  const candidate = { position: requestedPosition, subL, inline };
  const w = placementSpanSubL(candidate) / pipe.subL;
  if (w > 1 + EPS) return reject('full');

  // Locate placement whose interval contains requestedPosition.
  // Prefer an exact point slot over an ordinary interval that merely shares
  // its boundary, so replacing a tiny attachment never removes its neighbour.
  let targetIdx = existing.findIndex((pl) => {
    const iv = intervalOf(pipe.subL, pl);
    return iv.point && Math.abs(requestedPosition - iv.start) <= EPS;
  });
  for (let i = 0; targetIdx < 0 && i < existing.length; i++) {
    const iv = intervalOf(pipe.subL, existing[i]);
    if (requestedPosition >= iv.start - EPS && requestedPosition <= iv.end + EPS) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx < 0) return reject('nothing_to_replace');

  const old = existing[targetIdx];
  const others = existing.filter((_, i) => i !== targetIdx);
  const oldIv = intervalOf(pipe.subL, old);
  const oldCenter = (oldIv.start + oldIv.end) / 2;

  if (placementSpanSubL(candidate) <= placementSpanSubL(old)) {
    // Anchor at old.position (task spec: "Keep the same position").
    const newStart = Math.max(0, Math.min(1 - w, old.position));
    const newIv = { start: newStart, end: newStart + w };
    const collides = others.some(pl => conflicts(
      { ...newIv, point: w === 0 }, intervalOf(pipe.subL, pl),
    ));
    if (collides) return reject('overlap');
    return { ok: true, position: newStart, replaceExisting: others };
  }

  // New subL > old subL: centre on old's centre and try insert-style shift.
  const insertResult = doInsert(
    pipe,
    others,
    { requestedPosition: oldCenter, subL, inline }
  );
  if (!insertResult.ok) {
    // Map 'full' to 'overlap' for the "can't fit" replace case per spec.
    return reject(insertResult.reason === 'full' ? 'overlap' : insertResult.reason);
  }
  return insertResult;
}

// -----------------------------------------------------------------------
// Public entrypoint.
// -----------------------------------------------------------------------
export function findSlot(pipe, opts = {}) {
  const {
    type,
    requestedPosition,
    subL,
    mode,
    idGenerator,
    params,
    portsFlipped = false,
    inline = false,
  } = opts;

  if (!pipe || typeof pipe.subL !== 'number' || pipe.subL <= 0) {
    return reject('invalid_pipe');
  }
  if (typeof subL !== 'number' || subL <= 0) return reject('invalid_subL');
  if (typeof requestedPosition !== 'number') return reject('invalid_position');
  if (typeof idGenerator !== 'function') return reject('invalid_idGenerator');

  const existing = (pipe.placements || []).map(pl => ({ ...pl }));
  const slotPosition = inline
    ? quantizePlacementPosition(pipe, requestedPosition, subL, true)
    : requestedPosition;

  let result;
  if (mode === 'snap') result = doSnap(pipe, existing, { requestedPosition: slotPosition, subL, inline });
  else if (mode === 'insert') result = doInsert(pipe, existing, { requestedPosition: slotPosition, subL, inline });
  else if (mode === 'replace') result = doReplace(pipe, existing, { requestedPosition: slotPosition, subL, inline });
  else return reject('invalid_mode');

  if (!result.ok) return result;

  const kept = result.replaceExisting != null ? result.replaceExisting : existing;
  const candidate = {
    type,
    position: result.position,
    subL,
    inline: inline === true,
    params: params || {},
    portsFlipped: portsFlipped === true,
  };
  const prospective = [...kept, candidate];
  for (let i = 0; i < prospective.length; i++) {
    for (let j = i + 1; j < prospective.length; j++) {
      if (placementsConflict(pipe.subL, prospective[i], prospective[j])) {
        return reject('overlap');
      }
    }
  }
  const newPl = { id: idGenerator(), ...candidate };
  const placements = sortByPosition([...kept, newPl]);
  return { ok: true, placements };
}

/**
 * Where a placement sits in the world: the pipe path sampled at the midpoint
 * of an ordinary placement's claimed interval, or directly at an inline
 * attachment's point anchor,
 * plus the direction of the segment it lands on (0=NE, 1=SE, 2=SW, 3=NW —
 * the same `dir` convention placeables use).
 *
 * The mesh is drawn centered on this point, and utility ports are resolved
 * from it, so both the renderer and the utility system must sample the same
 * way. Returns null for a pipe with no path.
 */
export function placementPose(pipe, att) {
  const path = (pipe && pipe.path) || [];
  if (path.length === 0 || !att) return null;

  const halfW = (pipe.subL > 0 && typeof att.subL === 'number')
    ? (placementSpanSubL(att) / pipe.subL) / 2
    : 0;
  const t = Math.max(0, Math.min(1, (att.position ?? 0) + halfW));
  const exactIdx = t * (path.length - 1);
  const idx0 = Math.floor(exactIdx);
  const idx1 = Math.min(idx0 + 1, path.length - 1);
  const frac = exactIdx - idx0;

  const p0 = path[idx0];
  const p1 = path[idx1];
  const col = p0.col + (p1.col - p0.col) * frac;
  const row = p0.row + (p1.row - p0.row) * frac;

  const dc = p1.col - p0.col;
  const dr = p1.row - p0.row;
  let dir = 0;
  if (dc > 0) dir = 1;       // SE
  else if (dc < 0) dir = 3;  // NW
  else if (dr > 0) dir = 2;  // SW
  else if (dr < 0) dir = 0;  // NE

  return { col, row, dir };
}
