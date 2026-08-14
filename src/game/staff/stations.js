// src/game/staff/stations.js — the station index, seat matching, and slot
// reservations.
//
// Task 4 of the staff-professions-2 (nav-and-stations) plan. Turns the
// `station`/`seat` blocks Task 3 put on placeable defs (see
// src/data/facility-room-furnishings.raw.js, facility-lab-furnishings.raw.js)
// into concrete, reservable work slots in the world: one `StationRef` per
// def anchor, resolved against the instance's actual position/rotation and
// (for seat-preferring stations) matched to a nearby chair. The next task
// (StaffPawns) drives pawns with this; nothing here touches rendering.
//
// StationRef shape: { key, placeableId, defId, slotIndex, jobs, node, facing,
// seated, seatPlaceableId, zoneType }. `key` is `${placeableId}:${slotIndex}`.
// `node` is a subtile node ({col,row,subCol,subRow}) — see the seated/
// unseated split below for what it means in each case. Callers must treat a
// StationRef as read-only: it is the same object instance held in the
// (memoised) index's byKey/byJob tables, shared across every caller and
// every job offered at that slot — see findStation's doc comment.
//
// zoneType rides state.navRevision like everything else here (see
// getStationIndex), but is itself read from state.zoneOccupied, which does
// NOT bump navRevision on a repaint (Game.addZoneTile et al.). Repainting
// the zone under a station between nav-dirtying edits leaves a stale
// zoneType until something else bumps the revision. Harmless today (nothing
// reads it yet); flagged for whoever wires the job board to filter on it.

import { getNavGrid, isReachable } from './nav.js';
import { PLACEABLES } from '../../data/placeables/index.js';

// Facing letters, in the same rotation order as `dir` (see task-4-brief.md's
// dir/edge/facing table): n=dir0(-Z), e=dir1(+X), s=dir2(+Z), w=dir3(-X).
// Rotating a def-local facing by an instance's `dir` is therefore just
// modular addition of indices into this array.
const FACING_ORDER = ['n', 'e', 's', 'w'];
const FACING_INDEX = { n: 0, e: 1, s: 2, w: 3 };

// Tile delta a facing points toward — identical to src/data/directions.js's
// DIR_DELTA, indexed by facing letter instead of dir number.
const FACING_DELTA = {
  n: { dc: 0, dr: -1 },
  e: { dc: 1, dr: 0 },
  s: { dc: 0, dr: 1 },
  w: { dc: -1, dr: 0 },
};

function rotateFacing(facing, dir) {
  const idx = (FACING_INDEX[facing] + (((dir % 4) + 4) % 4)) % 4;
  return FACING_ORDER[idx];
}

// Absolute subtile coordinate as a single (col, row) pair of integers —
// col*4+subCol, row*4+subRow — so adjacency and distance between two
// subtiles (which may belong to different tiles) is plain integer math
// instead of tile+subtile carrying.
function absSub(n) {
  return { c: n.col * 4 + (n.subCol || 0), r: n.row * 4 + (n.subRow || 0) };
}

/**
 * Rotate a def-local anchor offset (ac,ar), authored against a subW x subL
 * footprint at dir:0, by `dir` steps of 90 degrees — the same convention
 * Placeable.footprintCells uses (dir 1/3 swap subW/subL; rotation pivots
 * around the footprint center). Returns { dc, dr }: an offset from the
 * instance's own (subCol,subRow) origin, in the same units footprintCells
 * consumes. Not clamped to the footprint — anchors deliberately live just
 * outside it (see task-3-report.md's coordinate convention).
 *
 * These are the standard 90-degree grid-rotation index formulas (equivalent
 * to numpy.rot90 on integer cell indices); a derivation via continuous-space
 * rotation about the footprint's center, cross-checked against each of the
 * four cases, lives in the task-4 report.
 */
function rotateAnchorOffset(ac, ar, subW, subL, dir) {
  switch (((dir % 4) + 4) % 4) {
    case 0: return { dc: ac, dr: ar };
    case 1: return { dc: subL - 1 - ar, dr: ac };
    case 2: return { dc: subW - 1 - ac, dr: subL - 1 - ar };
    case 3: return { dc: ar, dr: subW - 1 - ac };
    default: return { dc: ac, dr: ar };
  }
}

// Normalize an instance-relative subtile offset (which may be negative or
// >= 4) into an absolute subtile node, identical to the col/row-carry math
// Placeable.footprintCells performs per cell.
function absoluteSubtile(entry, dc, dr) {
  const totalCol = (entry.subCol || 0) + dc;
  const totalRow = (entry.subRow || 0) + dr;
  return {
    col: entry.col + Math.floor(totalCol / 4),
    row: entry.row + Math.floor(totalRow / 4),
    subCol: ((totalCol % 4) + 4) % 4,
    subRow: ((totalRow % 4) + 4) % 4,
  };
}

/**
 * Resolve one def-local station anchor against a placed instance: the
 * anchor's absolute subtile node, and its facing rotated by the instance's
 * dir.
 */
function resolveAnchor(entry, def, anchor) {
  const dir = entry.dir || 0;
  const { dc, dr } = rotateAnchorOffset(anchor.subCol, anchor.subRow, def.subW, def.subL, dir);
  return {
    node: absoluteSubtile(entry, dc, dr),
    facing: rotateFacing(anchor.facing, dir),
  };
}

/**
 * Find a chair placeable whose own SUBTILE is cardinally adjacent to
 * `anchorNode`'s subtile, whose resolved seat.facing agrees with the
 * station's own `anchorFacing`, and whose facing points back at the anchor —
 * i.e. chairSub + FACING_DELTA[chairFacing] === anchorSub, in absolute
 * subtile coordinates. `usedChairs` excludes chairs already claimed by an
 * earlier anchor in this same buildStationIndex pass, so one physical chair
 * can never be handed to two slots.
 *
 * Every chair def is subW:1/subL:1 (a chair occupies exactly one subtile),
 * so this must be a subtile-to-subtile test, not a tile-to-tile one: tile
 * granularity conflates all 16 subtiles of a tile into one adjacency
 * question, which both (a) lets a chair match "through" the furniture it's
 * supposed to face (matching a station whose anchor sits on the tile's FAR
 * side, on the opposite side of the object from the chair) and (b) can never
 * expose more than a couple of seats on a station whose whole footprint fits
 * inside one tile (diningTable, 2x2 subtiles) no matter how its four chairs
 * are actually arranged.
 *
 * Requiring chairFacing === anchorFacing (in addition to "points at the
 * anchor") pins the only valid chair position to the single subtile directly
 * behind the anchor, continuing the same line the anchor already looks
 * along (object -> anchor -> chair, all facing the same way) — which is
 * also what rules out the "through the furniture" case, since a chair on
 * the object's far side would need the opposite facing to point at the
 * anchor. Ties (should never occur given the position is pinned to one
 * subtile, since two placeables cannot occupy the same subtile — kept for
 * defensiveness) are broken by nearest subtile distance.
 */
function findMatchingChair(chairs, usedChairs, anchorNode, anchorFacing) {
  const anchorAbs = absSub(anchorNode);
  let best = null;
  let bestDist = Infinity;
  for (const chair of chairs) {
    if (usedChairs.has(chair.id)) continue;
    const def = PLACEABLES[chair.type];
    if (!def?.seat) continue;
    const facing = rotateFacing(def.seat.facing, chair.dir || 0);
    if (facing !== anchorFacing) continue;
    const delta = FACING_DELTA[facing];
    const chairAbs = absSub(chair);
    if (chairAbs.c + delta.dc !== anchorAbs.c || chairAbs.r + delta.dr !== anchorAbs.r) continue;
    const dCol = chairAbs.c - anchorAbs.c;
    const dRow = chairAbs.r - anchorAbs.r;
    const dist = dCol * dCol + dRow * dRow;
    if (dist < bestDist) { bestDist = dist; best = chair; }
  }
  return best;
}

/**
 * Build a fresh station index from the current state: one StationRef per
 * resolvable def anchor on every placed instance carrying a `station` block.
 */
export function buildStationIndex(state) {
  const byKey = {};
  const byJob = {};
  const placeables = state.placeables || [];
  const zoneOccupied = state.zoneOccupied || {};

  const chairs = placeables.filter(p => PLACEABLES[p.type]?.seat);
  // Global across the whole index build (not per-station/per-entry): once a
  // chair is handed to one slot it is off the table for every other anchor
  // processed afterward, on this station or any other.
  const usedChairs = new Set();

  for (const entry of placeables) {
    const def = PLACEABLES[entry.type];
    if (!def || !def.station) continue;
    const { jobs, seated: seatedPref, anchors } = def.station;
    const zoneType = zoneOccupied[entry.col + ',' + entry.row] ?? null;

    anchors.forEach((anchorDef, slotIndex) => {
      const { node: anchorNode, facing: anchorFacing } = resolveAnchor(entry, def, anchorDef);

      let node = anchorNode;
      let facing = anchorFacing;
      let seated = false;
      let seatPlaceableId = null;

      if (seatedPref !== 'never') {
        const chair = findMatchingChair(chairs, usedChairs, anchorNode, anchorFacing);
        if (chair) {
          usedChairs.add(chair.id);
          seated = true;
          seatPlaceableId = chair.id;
          node = { col: chair.col, row: chair.row, subCol: chair.subCol || 0, subRow: chair.subRow || 0 };
          facing = rotateFacing(PLACEABLES[chair.type].seat.facing, chair.dir || 0);
        }
      }

      // A 'required' seat that found no chair is a dead slot — omit it
      // entirely rather than index a station a pawn can never actually work.
      if (!seated && seatedPref === 'required') return;

      const key = `${entry.id}:${slotIndex}`;
      // node and jobs are each fresh (never-shared-elsewhere) objects built
      // just above/here — Object.freeze on the outer ref alone is shallow
      // and would leave both mutable, so a caller writing e.g. ref.node.col
      // would silently corrupt the shared index entry every other caller
      // reads. Freeze all three levels.
      const ref = Object.freeze({
        key, placeableId: entry.id, defId: entry.type, slotIndex,
        jobs: Object.freeze(jobs.slice()), node: Object.freeze(node), facing, seated, seatPlaceableId, zoneType,
      });
      byKey[key] = ref;
      for (const job of jobs) {
        (byJob[job] || (byJob[job] = [])).push(ref);
      }
    });
  }

  return { revision: state.navRevision || 0, byKey, byJob };
}

const stationCache = new WeakMap();

/**
 * Memoised buildStationIndex: rebuilds only when state.navRevision has moved
 * past the cached index's revision. The station index depends on exactly the
 * same inputs (placeables/dir/position) that invalidate the nav grid, so it
 * rides the same counter rather than owning a second one.
 *
 * Every rebuild also prunes state.stationReservations against the fresh
 * byKey: a key that no longer resolves (its station was demolished, or a
 * 'required' seat's chair was removed/rotated away and the slot dropped out
 * of the index) is deleted on the spot, mid-session — not just at load. A
 * demolished chair coming back later would otherwise resurrect a stale
 * reservation from a job that ended long ago, and nothing else would ever
 * notice: the *station* was never demolished, so the "abandon on target
 * demolished" job-lifecycle hook can't catch it either. This is O(number of
 * reservations), once per navRevision, not per lookup.
 */
export function getStationIndex(state) {
  const cached = stationCache.get(state);
  const revision = state.navRevision || 0;
  if (cached && cached.revision === revision) return cached;
  const index = buildStationIndex(state);
  stationCache.set(state, index);
  const reservations = state.stationReservations;
  if (reservations) {
    for (const key of Object.keys(reservations)) {
      if (!index.byKey[key]) delete reservations[key];
    }
  }
  return index;
}

/**
 * Claim `key` for `staffId`. Fails (returns false) when another staffer
 * already holds it; re-reserving your own slot is a no-op success.
 */
export function reserveStation(state, key, staffId) {
  if (!state.stationReservations) state.stationReservations = {};
  const held = state.stationReservations[key];
  if (held && held !== staffId) return false;
  state.stationReservations[key] = staffId;
  return true;
}

/**
 * Release `key`, but only if `staffId` is the current holder. Releasing a
 * slot you don't hold (already released, held by someone else, never
 * reserved) is a no-op returning false — never a throw, since every job exit
 * path calls this unconditionally.
 */
export function releaseStation(state, key, staffId) {
  const reservations = state.stationReservations;
  if (!reservations || reservations[key] !== staffId) return false;
  delete reservations[key];
  return true;
}

/**
 * Safety net: release every slot held by one staffer, regardless of key.
 * Called on fire/death/reset so a staffer leaving the roster can never leak
 * a reservation that outlives them.
 */
export function releaseAllFor(state, staffId) {
  const reservations = state.stationReservations;
  if (!reservations) return;
  for (const key of Object.keys(reservations)) {
    if (reservations[key] === staffId) delete reservations[key];
  }
}

/**
 * Drop reservations that no longer point at anything real: a staff id absent
 * from the roster (fired/died), or a key absent from the current station
 * index. The key check normally has nothing left to do here — getStationIndex
 * already prunes dead keys on every rebuild — but load/undo replace
 * staffMembers and navRevision-bumping state in the same pass, and calling
 * getStationIndex first guarantees the index (and its key-pruning side
 * effect) reflects the just-restored placeables before the roster check
 * below runs, rather than racing a stale cached index.
 */
export function sanitizeStationReservations(state) {
  if (!state.stationReservations) { state.stationReservations = {}; return; }
  const index = getStationIndex(state);
  const rosterIds = new Set((state.staffMembers || []).map(m => m.id));
  const reservations = state.stationReservations;
  for (const key of Object.keys(reservations)) {
    if (!index.byKey[key] || !rosterIds.has(reservations[key])) {
      delete reservations[key];
    }
  }
}

/**
 * The nearest free, reachable StationRef offering any of `jobs`, or null.
 * `specialty` is accepted but not consulted here — it is forward-compat
 * with the job board (staff-professions-2's Task 3-of-3 plan), which will
 * use it to rank candidates a specialist is more effective at; the station
 * index itself has no notion of specialty.
 *
 * The returned StationRef is the same frozen object instance held in the
 * index — callers must not mutate it or expect a private copy.
 *
 * isReachable is now an O(1) connected-component lookup (see nav.js), so
 * unlike an earlier version of this function, reachability-testing every
 * candidate is no longer a real cost concern. Candidates are still ordered
 * by cheap subtile distance first and tested in that order, returning the
 * first pass — nearest-first is the behavior that matters, the ordering
 * just happens to also be free.
 */
export function findStation(state, { jobs, fromNode, staffId } = {}) {
  if (!fromNode) return null;
  const index = getStationIndex(state);
  const reservations = state.stationReservations || {};

  const seen = new Set();
  const candidates = [];
  for (const job of jobs || []) {
    for (const ref of index.byJob[job] || []) {
      if (seen.has(ref.key)) continue;
      seen.add(ref.key);
      const heldBy = reservations[ref.key];
      if (heldBy && heldBy !== staffId) continue;
      candidates.push(ref);
    }
  }
  if (candidates.length === 0) return null;

  const subDist2 = (ref) => {
    const dCol = (ref.node.col * 4 + ref.node.subCol) - (fromNode.col * 4 + fromNode.subCol);
    const dRow = (ref.node.row * 4 + ref.node.subRow) - (fromNode.row * 4 + fromNode.subRow);
    return dCol * dCol + dRow * dRow;
  };
  candidates.sort((a, b) => subDist2(a) - subDist2(b));

  const nav = getNavGrid(state);
  for (const ref of candidates) {
    if (isReachable(nav, fromNode, ref.node)) return ref;
  }
  return null;
}
