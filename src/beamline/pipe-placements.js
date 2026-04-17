// src/beamline/pipe-placements.js
//
// Pure slot-finding for placements on a pipe. Caller passes the pipe (read-
// only), the requested type/position/subL, and a mode ('snap' | 'replace' |
// 'insert'). We return a new `placements` array or a rejection reason.
//
// Position semantics:
//   - `position` is a fraction 0..1 along the pipe's total subL.
//   - A placement occupies [position, position + subL / pipe.subL].
//   - Two placements collide iff their intervals overlap.

const EPS = 1e-9;

function reject(reason) { return { ok: false, reason }; }

function intervalOf(pipeSubL, pl) {
  const start = pl.position;
  const end = pl.position + (pl.subL / pipeSubL);
  return { start, end };
}

function overlaps(a, b) {
  return a.start < b.end - EPS && b.start < a.end - EPS;
}

function sortByPosition(list) {
  return list.slice().sort((a, b) => a.position - b.position);
}

// Capacity check: sum of all placement subL + newSubL ≤ pipeSubL.
function fitsCapacity(existing, newSubL, pipeSubL) {
  let sum = newSubL;
  for (const pl of existing) sum += pl.subL;
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
function doSnap(pipe, existing, { requestedPosition, subL }) {
  const w = subL / pipe.subL;
  if (w > 1 + EPS) return reject('full');

  // Natural placement at requestedPosition, clamped into [0, 1-w].
  const naturalStart = Math.max(0, Math.min(1 - w, requestedPosition));
  const naturalInterval = { start: naturalStart, end: naturalStart + w };
  const collides = existing.some(pl => overlaps(naturalInterval, intervalOf(pipe.subL, pl)));
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
function doInsert(pipe, existing, { requestedPosition, subL }) {
  const w = subL / pipe.subL;
  if (w > 1 + EPS) return reject('full');
  if (!fitsCapacity(existing, subL, pipe.subL)) return reject('full');

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
    const plW = pl.subL / pipe.subL;
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
    const plW = pl.subL / pipe.subL;
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
function doReplace(pipe, existing, { requestedPosition, subL }) {
  const w = subL / pipe.subL;
  if (w > 1 + EPS) return reject('full');

  // Locate placement whose interval contains requestedPosition.
  let targetIdx = -1;
  for (let i = 0; i < existing.length; i++) {
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

  if (subL <= old.subL) {
    // Anchor at old.position (task spec: "Keep the same position").
    const newStart = Math.max(0, Math.min(1 - w, old.position));
    const newIv = { start: newStart, end: newStart + w };
    const collides = others.some(pl => overlaps(newIv, intervalOf(pipe.subL, pl)));
    if (collides) return reject('overlap');
    return { ok: true, position: newStart, replaceExisting: others };
  }

  // New subL > old subL: centre on old's centre and try insert-style shift.
  const insertResult = doInsert(
    pipe,
    others,
    { requestedPosition: oldCenter, subL }
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
  } = opts;

  if (!pipe || typeof pipe.subL !== 'number' || pipe.subL <= 0) {
    return reject('invalid_pipe');
  }
  if (typeof subL !== 'number' || subL <= 0) return reject('invalid_subL');
  if (typeof requestedPosition !== 'number') return reject('invalid_position');
  if (typeof idGenerator !== 'function') return reject('invalid_idGenerator');

  const existing = (pipe.placements || []).map(pl => ({ ...pl }));

  let result;
  if (mode === 'snap') result = doSnap(pipe, existing, { requestedPosition, subL });
  else if (mode === 'insert') result = doInsert(pipe, existing, { requestedPosition, subL });
  else if (mode === 'replace') result = doReplace(pipe, existing, { requestedPosition, subL });
  else return reject('invalid_mode');

  if (!result.ok) return result;

  const kept = result.replaceExisting != null ? result.replaceExisting : existing;
  const newPl = {
    id: idGenerator(),
    type,
    position: result.position,
    subL,
    params: params || {},
  };
  const placements = sortByPosition([...kept, newPl]);
  return { ok: true, placements };
}
