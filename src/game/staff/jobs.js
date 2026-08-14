// src/game/staff/jobs.js — the job board.
//
// Task 1 of the staff-professions-3 (jobs-and-gates) plan. Scans the world
// and derives `{ offers, suppressions }` for a job system (Task 2+) to
// assign from. buildJobOffers() itself never reserves a station, never
// assigns anyone, and never writes anything of its own — it only READS
// game/game.state (nav grid, station index, beamline registry, resources).
// The one write that can happen on its call stack isn't this module's:
// getStationIndex (stations.js) prunes dead keys out of
// state.stationReservations whenever it rebuilds, which is that shared
// cache's own documented bookkeeping, not something buildJobOffers does —
// see test-job-board.js's deep-freeze regression test, which is exactly
// why this distinction matters (a naive "nothing here writes to state"
// claim doesn't survive contact with a frozen state that still has live
// reservations to prune).
//
// The eleven job ids below are a closed vocabulary, already authored onto
// placeable defs' `station.jobs` arrays (see facility-lab-furnishings.raw.js,
// facility-room-furnishings.raw.js) or produced only by this module (repair,
// commission have no station — see below). A typo here silently strands a
// station or a target nobody can ever be offered.

import { getStationIndex } from './stations.js';
import { getNavGrid, isReachable } from './nav.js';
import { isBlocked } from '../../networks/rooms.js';
import { PROFESSIONS, SPECIALTY_AXES, professionDef } from '../../data/professions.js';
import { ZONES } from '../../data/facility.js';
import { flattenPath } from '../../beamline/flattener.js';

// --- Job type table ---------------------------------------------------

// Priority ordering, highest first (per task-1-brief.md): eat/rest (need-
// driven — Task 2 injects these offers itself; the board never generates
// them, but they still need a place in this table since the vocabulary is
// closed and Task 2 reads their basePriority/workTicks same as everything
// else), then repair, runBeam, commission, fabricate, takeData, labWork,
// analyze, paperwork, meet.
//
// eat/rest sit at 1000/950 — an order of magnitude above every work
// priority, not just a little above repair's. Repair's own priority is
// this base PLUS an urgency term that grows as health falls (see
// repairOffers), topping out around 90 + 100*0.5 = 140 at zero health, so
// "needs outrank all work" holds NUMERICALLY AND UNCONDITIONALLY — it does
// not depend on repair's urgency term staying below some assumed ceiling.
// An earlier version of this table put eat/rest at 100/95, just above
// repair's 90 base; repair's own urgency term crosses that at 79% health
// (a routine steady state under Game.js's continuous wear, not an edge
// case), which would have let repair — itself `interruptible: false` —
// starve a hungry technician exactly the way the hunger-recovery deadlock
// this codebase already fixed once (see staffSystem.js's tickStaffMember
// comment) started the first time. Clamping repair's urgency instead of
// fixing the base gap would just be a magic number for the next person
// tuning urgency to quietly defeat.
//
// `professions`: which profession ids may take the job (eligibleFor's
// hard gate). `usesSpecialty`: whether this job type's offers can carry a
// non-null `specialty` — only labWork/takeData actually populate one today
// (resolved from the station's zone), but commission will once Task 6 wires
// component flagging through. `workTicks`: null for open-ended jobs (held
// until reassigned — only runBeam), an integer tick count otherwise.
// `interruptible`: whether a higher-priority job may bump a staffer off this
// one before it finishes. Repair and runBeam are not — you don't pull a
// technician off a live fix or an operator off a running beam; eat/rest
// aren't either, for the same "don't do this halfway" reason. Everything
// else can be paused for something more urgent.
export const JOB_TYPES = {
  eat:        { id: 'eat',        name: 'Eat',           professions: Object.keys(PROFESSIONS), usesSpecialty: false, basePriority: 1000, workTicks: 40,  interruptible: false },
  rest:       { id: 'rest',       name: 'Rest',          professions: Object.keys(PROFESSIONS), usesSpecialty: false, basePriority: 950,  workTicks: 80,  interruptible: false },
  repair:     { id: 'repair',     name: 'Repair',        professions: ['technician'],            usesSpecialty: false, basePriority: 90,   workTicks: 60,  interruptible: false },
  runBeam:    { id: 'runBeam',    name: 'Run Beam',      professions: ['operator'],               usesSpecialty: false, basePriority: 80,   workTicks: null, interruptible: false },
  commission: { id: 'commission', name: 'Commissioning', professions: ['engineer'],               usesSpecialty: true,  basePriority: 70,   workTicks: 90,  interruptible: true },
  fabricate:  { id: 'fabricate',  name: 'Fabrication',   professions: ['machinist'],              usesSpecialty: false, basePriority: 60,   workTicks: 150, interruptible: true },
  takeData:   { id: 'takeData',   name: 'Take Data',     professions: ['scientist'],              usesSpecialty: true,  basePriority: 50,   workTicks: 120, interruptible: true },
  labWork:    { id: 'labWork',    name: 'Lab Work',      professions: ['engineer'],               usesSpecialty: true,  basePriority: 40,   workTicks: 120, interruptible: true },
  analyze:    { id: 'analyze',    name: 'Analysis',      professions: ['scientist'],              usesSpecialty: false, basePriority: 30,   workTicks: 100, interruptible: true },
  paperwork:  { id: 'paperwork',  name: 'Paperwork',     professions: ['admin'],                  usesSpecialty: false, basePriority: 20,   workTicks: 80,  interruptible: true },
  meet:       { id: 'meet',       name: 'Meeting',       professions: Object.keys(PROFESSIONS), usesSpecialty: false, basePriority: 10,   workTicks: 60,  interruptible: true },
};

// A repair/commission node's priority-per-health-point term (see JOB_TYPES'
// comment above). At the extreme (health 0) this adds 50 to repair's base
// of 90, for a ceiling of 140 — still two orders of magnitude below eat/
// rest's 1000/950, by design, not by luck.
const REPAIR_HEALTH_WEIGHT = 0.5;

// Minimum idle staff (see idleStaffCount) required before a meeting is
// offered — a morale release valve, not a default activity, so it only
// fires when there's genuine slack in the roster.
const MEET_MIN_IDLE = 3;

// zoneId -> specialty id, built once from both specialty axes. 'diagnostics'
// appears on BOTH axes (engineering and science) pointing at the same
// diagnosticsLab zone, but shares the same id string on either axis, so the
// second assignment below is a harmless no-op overwrite, not a real
// collision — a labWork offer and a takeData offer at the same diagnostics
// bench both come out specialty:'diagnostics' regardless of which axis
// "owns" the lookup.
const SPECIALTY_BY_ZONE = {};
for (const axis of Object.values(SPECIALTY_AXES)) {
  for (const s of Object.values(axis.specialties)) {
    if (s.zoneId) SPECIALTY_BY_ZONE[s.zoneId] = s.id;
  }
}

function specialtyForZone(zoneType) {
  if (!zoneType || !ZONES[zoneType]) return null;
  return SPECIALTY_BY_ZONE[zoneType] || null;
}

function makeOffer(jobType, target, specialty, priority, stationKey) {
  return { jobType, target, specialty, priority, stationKey };
}

// --- Reachability helpers --------------------------------------------------
//
// Beamline components (repair/commission targets) have no StationRef — no
// pre-resolved anchor just outside their footprint the way stations.js
// gives every furniture-based job. A technician can't stand ON a
// component (it occupies blocked subtiles exactly like any other placed
// equipment — see nav.js's blockedSubtiles), so "reachable" has to mean
// "is there a passable subtile immediately outside the component's actual
// footprint, reachable without a wall in the way" — not "is the
// component's own origin corner passable", which is wrong in both
// directions on a real multi-subtile module (every real beamline module is
// >= 4x4 subtiles, subH >= 4):
//   - false positive: a component against a sealed room's west wall has a
//     passable subtile immediately west of it — OUTSIDE the wall. Probing
//     only "is that neighbor subtile passable" (no isBlocked check) says
//     yes, and the board offers a repair nobody can actually walk to; the
//     pawn commits, findPath returns null, it stalls.
//   - false negative: a multi-subtile component chained between two
//     others has its OWN ORIGIN CORNER boxed in on all four sides even
//     though the rest of its perimeter (the other ~12+ subtiles) opens
//     onto clear floor. Probing only the origin corner's four neighbors
//     reports permanently unreachable, and a damaged module in a dense
//     chain decays to zero forever.
// approachCandidates() below fixes both: it walks the component's REAL
// footprint (placeable.cells — every placed entry has this; see
// Game.js's addPlaceable/_rebuildPlaceableCells), collects every subtile
// cardinally adjacent to ANY footprint cell (excluding neighbors that are
// themselves part of the same footprint), and for each one that would
// cross a tile boundary, actually asks isBlocked() — the same wall/door
// test nav.js's own A* uses — rather than just checking "is this subtile
// occupied by something".

// Same 4-neighbor subtile step nav.js's own (unexported) neighborsOf uses:
// `edge` is only set when the step crosses a TILE boundary — the one case
// isBlocked (a wall/door test keyed by tile edge) can ever apply, since
// walls only ever live on tile edges, never mid-tile.
function neighborsOf(n) {
  const out = [];
  if (n.subCol > 0) out.push({ node: { col: n.col, row: n.row, subCol: n.subCol - 1, subRow: n.subRow } });
  else out.push({ node: { col: n.col - 1, row: n.row, subCol: 3, subRow: n.subRow }, edge: 'w' });
  if (n.subCol < 3) out.push({ node: { col: n.col, row: n.row, subCol: n.subCol + 1, subRow: n.subRow } });
  else out.push({ node: { col: n.col + 1, row: n.row, subCol: 0, subRow: n.subRow }, edge: 'e' });
  if (n.subRow > 0) out.push({ node: { col: n.col, row: n.row, subCol: n.subCol, subRow: n.subRow - 1 } });
  else out.push({ node: { col: n.col, row: n.row - 1, subCol: n.subCol, subRow: 3 }, edge: 'n' });
  if (n.subRow < 3) out.push({ node: { col: n.col, row: n.row, subCol: n.subCol, subRow: n.subRow + 1 } });
  else out.push({ node: { col: n.col, row: n.row + 1, subCol: n.subCol, subRow: 0 }, edge: 's' });
  return out;
}

function subtileKey(n) { return `${n.col},${n.row},${n.subCol},${n.subRow}`; }

function nodeSubtile(placeable) {
  if (!placeable || !Number.isFinite(placeable.col) || !Number.isFinite(placeable.row)) return null;
  return {
    col: placeable.col, row: placeable.row,
    subCol: placeable.subCol || 0, subRow: placeable.subRow || 0,
  };
}

// The footprint to walk the perimeter of: a placed entry's real `.cells`
// when present (every real placeable has this), falling back to its own
// single origin subtile for anything hand-built without one.
//
// Exported (staff-professions-3 Task 3, fix round) for jobRunner.js, which
// resolves a walkable destination for a target-addressed offer (repair/
// commission — no StationRef) at ASSIGNMENT time now, rather than leaving
// StaffPawns.js with nowhere to walk for those job types. This is the exact
// perimeter-walk this module's own repairOffers/eligibleFor already use for
// reachability — reused as-is, not reimplemented, so "can a technician
// reach this component" and "where should they stand" never drift apart.
export function footprintCellsOf(placeable) {
  if (Array.isArray(placeable?.cells) && placeable.cells.length) return placeable.cells;
  const single = nodeSubtile(placeable);
  return single ? [single] : [];
}

/**
 * Every passable subtile immediately outside `cells`' footprint that a
 * technician could actually stand on to work it — see this section's
 * header comment for why this has to walk the whole perimeter with a real
 * wall test, not probe one corner. Order is not meaningful; callers reduce
 * this with `.some()`.
 *
 * Exported alongside footprintCellsOf — see that function's comment.
 */
export function approachCandidates(nav, state, cells) {
  const footprint = new Set(cells.map(subtileKey));
  const seen = new Set();
  const out = [];
  for (const cell of cells) {
    for (const { node, edge } of neighborsOf(cell)) {
      const key = subtileKey(node);
      if (footprint.has(key) || seen.has(key)) continue;
      seen.add(key);
      if (edge && isBlocked(cell.col, cell.row, edge, state)) continue;
      if (!nav.passable.has(key)) continue;
      out.push(node);
    }
  }
  return out;
}

// Position-INDEPENDENT reachability: is this subtile connected to the rest
// of the walkable facility at all, by anyone, ever? Used by the board's own
// repair pre-filter (buildJobOffers has no specific staff member in scope —
// it runs once per world scan, not once per staffer). nav.js's connected-
// component labelling treats everything outside the built area as one
// implicit OUTDOOR component (see nav.js's header comment), and a real
// facility's built area almost always touches it somewhere (a front door,
// an unwalled gap) — a node that doesn't is exactly the "sealed room, no
// door" case this exists to catch. Probing all four corners of the nav
// grid's own bounds (guaranteed outdoors — nothing is ever built at the
// literal edge of the map) rather than a single corner is cheap insurance
// against one corner happening to be blocked.
function reachableFromOutdoors(nav, node) {
  const { minCol, maxCol, minRow, maxRow } = nav.bounds;
  const corners = [
    { col: minCol, row: minRow, subCol: 0, subRow: 0 },
    { col: maxCol, row: minRow, subCol: 3, subRow: 0 },
    { col: minCol, row: maxRow, subCol: 0, subRow: 3 },
    { col: maxCol, row: maxRow, subCol: 3, subRow: 3 },
  ];
  return corners.some(c => isReachable(nav, c, node));
}

// --- Offer generation, per job type ------------------------------------

function freeStationsFor(index, reservations, jobId) {
  return (index.byJob[jobId] || []).filter(ref => !reservations[ref.key]);
}

// runBeam: one offer per free runBeam station slot. NOT capped at the
// number of beamlines that currently exist — an earlier version of this
// function did `.slice(0, beamlineCount)`, which silently discards offers
// in INDEX order: with 3 free consoles and 1 beamline, an operator
// standing right next to console #3 would only ever be offered console #1,
// and no amount of "tie-broken by path length" logic downstream can
// recover an offer the slice already threw away before anyone got to rank
// it. The "no more operators than beamlines" cap is a real constraint, but
// it belongs to Task 2's assignment step, which knows who's being assigned
// and can apply it without discarding information the board itself has no
// business throwing away.
function runBeamOffers(index, reservations) {
  return freeStationsFor(index, reservations, 'runBeam')
    .map(ref => makeOffer('runBeam', null, null, JOB_TYPES.runBeam.basePriority, ref.key));
}

// repair + commission both walk every currently-registered beamline's
// flattened path looking at each MODULE node (drift/placement synthetic
// entries carry no placeable position to repair a technician toward, and
// componentHealth is keyed by module placeable ids — see
// Game.js:_applyWearForBeamline). Computed ONCE per buildJobOffers call and
// shared by both — flattenPath rebuilds a full placeable-id map internally
// every time it runs, so calling it once per beamline per job TYPE (an
// earlier version of this file called it separately from repairOffers and
// commissionOffers) is double the real work for no benefit.
//
// Iterating only registry.getAll()'s CURRENT entries is what makes the
// "stale target" rule (a beamline that no longer exists must never appear
// as a target) automatic: a demolished beamline simply never contributes
// nodes to this loop, with no separate staleness check required.
//
// Not deduplicated by node id: if the SAME physical placeable were ever
// reachable from two different registered beamlines' sourceIds (a shared
// junction on an interconnected pipe network — unusual, but not prevented
// by the data model), this produces one repair offer per beamline, each
// targeting a different `beamlineId` against that beamline's OWN
// `componentHealth` dict. That's not a bug to dedupe here: componentHealth
// is namespaced per beamline entry, not globally per placeable, so the two
// offers already address two independently-tracked health values — the
// data model, not this scan, is what makes them two separate facts.
function beamlineComponentNodes(game) {
  const entries = game.registry?.getAll?.() || [];
  const out = [];
  for (const entry of entries) {
    if (!entry.sourceId) continue;
    const nodes = flattenPath(game.state, entry.sourceId);
    for (const node of nodes) {
      if (node.kind !== 'module' || !node.placeable) continue;
      out.push({ entry, node });
    }
  }
  return out;
}

// Returns `{ offers, suppressions }`. A suppression is a damaged node the
// board considered and explicitly declined to offer — `{ jobType, target,
// reason }`, the same target shape a real offer would carry, plus WHY.
// This is a second, distinct channel from the returned offers array: a
// silent `continue` here would make "spares === 0 -> no offer" and
// "unreachable -> no offer" indistinguishable from each other, or from a
// node simply not existing, to anything downstream (a later task's UI, or
// this file's own tests) that wants to explain to the player why a known,
// damaged, otherwise-workable component isn't up for repair.
function repairOffers(nodes, nav, state) {
  const spares = state.resources?.spares ?? 0;
  const offers = [];
  const suppressions = [];
  for (const { entry, node } of nodes) {
    const health = entry.beamState?.componentHealth?.[node.id];
    if (health === undefined || health >= 100) continue;
    const target = { beamlineId: entry.id, nodeId: node.id };

    // Rejected before offering — no offer is emitted at all, a suppression
    // is recorded instead — when there's nothing to fix it with, or the
    // node can't be reached. Spares checked first only because it's the
    // cheaper test; neither check has a side effect, so the order carries
    // no other meaning.
    if (spares <= 0) {
      suppressions.push({ jobType: 'repair', target, reason: 'No spares available to make the repair.' });
      continue;
    }
    const cells = footprintCellsOf(node.placeable);
    const reachable = cells.length > 0 && approachCandidates(nav, state, cells).some(n => reachableFromOutdoors(nav, n));
    if (!reachable) {
      suppressions.push({ jobType: 'repair', target, reason: 'Unreachable — no clear path to the component.' });
      continue;
    }

    const priority = JOB_TYPES.repair.basePriority + (100 - health) * REPAIR_HEALTH_WEIGHT;
    offers.push(makeOffer('repair', target, null, priority, null));
  }
  return { offers, suppressions };
}

// commission: one offer per placed component flagged `needsCommissioning`
// (Task 6 sets this, alongside a `specialty` naming which engineering
// specialty is qualified to sign off on it — neither field exists on any
// placeable yet, so this is forward-compatible dead code today, not
// reachable from any current game state). No reachability pre-filter here
// — the brief only specifies one for repair; eligibleFor still gates a
// specific member's reachability to either job type (see below).
function commissionOffers(nodes) {
  const offers = [];
  for (const { entry, node } of nodes) {
    const placeable = node.placeable;
    if (!placeable?.needsCommissioning) continue;
    const priority = JOB_TYPES.commission.basePriority;
    offers.push(makeOffer('commission', { beamlineId: entry.id, nodeId: node.id }, placeable.specialty ?? null, priority, null));
  }
  return offers;
}

// fabricate/labWork/takeData/analyze/paperwork: one offer per free station
// slot of that job type. labWork/takeData additionally carry the specialty
// of the zone the station sits in (StationRef.zoneType, read from
// state.zoneOccupied at index-build time — see stations.js).
const PLAIN_STATION_JOBS = ['fabricate', 'labWork', 'takeData', 'analyze', 'paperwork'];
const ZONE_SPECIALTY_JOBS = new Set(['labWork', 'takeData']);

function plainStationOffers(index, reservations) {
  const offers = [];
  for (const jobId of PLAIN_STATION_JOBS) {
    const jobType = JOB_TYPES[jobId];
    for (const ref of freeStationsFor(index, reservations, jobId)) {
      const specialty = ZONE_SPECIALTY_JOBS.has(jobId) ? specialtyForZone(ref.zoneType) : null;
      offers.push(makeOffer(jobId, null, specialty, jobType.basePriority, ref.key));
    }
  }
  return offers;
}

// meet: a morale release valve, not a default activity — only offered when
// an admin is present to run it AND at least MEET_MIN_IDLE staff have
// nothing else going on. "Idle" prefers Task 2's own `m.job` field once a
// StaffMember actually carries one (undefined -> no assignment -> idle;
// any other value -> not idle), falling back to the reservation-based
// heuristic only when the field is absent entirely — so the board and
// Task 2's real assignment runner read the exact same signal and can never
// silently diverge once Task 2 lands. `!m.job ?? !reservedIds.has(m.id)`
// (a literal nullish-coalescing read of this intent) doesn't actually work:
// `!m.job` is always a real boolean, never null/undefined, so `??`'s right
// side would never run — this checks the field's PRESENCE instead. Until
// Task 2 lands, every StaffMember lacks `.job` and this always falls back
// to the reservation heuristic, which — like the pre-fix version — still
// can't see repair/commission's target-addressed work (no stationKey, no
// reservation), so a technician mid-repair currently reads as idle. That's
// a real, known gap in the fallback specifically, closed the moment Task 2
// adds `.job`, not by this task.
function isIdle(member, reservedIds) {
  return 'job' in member ? member.job == null : !reservedIds.has(member.id);
}

function idleStaffCount(state) {
  const reservations = state.stationReservations || {};
  const reservedIds = new Set(Object.values(reservations));
  return (state.staffMembers || []).filter(m => isIdle(m, reservedIds)).length;
}

function meetOffers(index, reservations, state) {
  const adminPresent = (state.staffMembers || []).some(m => m.profession === 'admin');
  if (!adminPresent || idleStaffCount(state) < MEET_MIN_IDLE) return [];
  return freeStationsFor(index, reservations, 'meet')
    .map(ref => makeOffer('meet', null, null, JOB_TYPES.meet.basePriority, ref.key));
}

/**
 * Scan `game`'s world and derive every job offer currently available —
 * reads `game`/`game.state` only (see this file's header comment for the
 * one caveat: getStationIndex's own legitimate cache-pruning side effect).
 * No mutation of its own, no assignment.
 *
 * Returns `{ offers, suppressions }`, not a bare array:
 *   - `offers` — sorted by descending priority.
 *   - `suppressions` — `{ jobType, target, reason }` for every damaged
 *     beamline node the board explicitly declined to offer a repair for
 *     (no spares, or unreachable — see repairOffers). Without this, "no
 *     spares" and "unreachable" and "this node doesn't exist" are all
 *     indistinguishable from the offers list alone; Task 5's player-facing
 *     surfacing of "why isn't X being fixed" reads this channel directly.
 *
 * eat/rest are never generated here (Task 2 injects those directly from
 * staff needs) even though they're in JOB_TYPES.
 */
export function buildJobOffers(game) {
  const state = game.state;
  const index = getStationIndex(state);
  const reservations = state.stationReservations || {};
  const nav = getNavGrid(state);
  const nodes = beamlineComponentNodes(game);
  const repair = repairOffers(nodes, nav, state);

  const offers = [
    ...runBeamOffers(index, reservations),
    ...repair.offers,
    ...commissionOffers(nodes),
    ...plainStationOffers(index, reservations),
    ...meetOffers(index, reservations, state),
  ];

  offers.sort((a, b) => b.priority - a.priority);
  return { offers, suppressions: repair.suppressions };
}

// --- Eligibility ---------------------------------------------------------

// Resolve a repair/commission `target` back to the live placeable it
// addresses — null when either the beamline that owned it is no longer
// registered, or the placeable itself is gone (both read as "stale job").
function resolveTarget(game, target) {
  if (!target) return null;
  const beamlineLive = (game.registry?.getAll?.() || []).some(e => e.id === target.beamlineId);
  if (!beamlineLive) return null;
  const state = game?.state;
  const idx = state?.placeableIndex?.[target.nodeId];
  const placeable = idx !== undefined ? state.placeables?.[idx] : (state?.placeables || []).find(p => p.id === target.nodeId);
  return placeable || null;
}

/**
 * Whether `member` may currently take `offer`. Always returns
 * `{ ok, reason }` — never a bare boolean — because `reason` survives to the
 * player-facing UI (a later task): it must read as English, never leak a
 * camelCase job/station id or a raw unrecognized profession id, and never
 * be empty when `ok` is false.
 *
 * `member` needs `.profession`, `.specialty`, `.skills`, and — only when
 * reachability matters — `.fromNode` (a subtile node, the member's current
 * position; the same shape findStation's `fromNode` takes). Task 2's
 * assignment loop resolves this from the staffer's live pawn position
 * before calling in; omitting it simply skips the reachability check
 * rather than rejecting; StaffMember itself carries no position field
 * today (see StaffPawns.js), so this cannot be tightened to "always
 * required" without that task.
 *
 * `game` supplies the world context (station index, nav grid, reservations,
 * beamline registry) that reachability/reservation/staleness checks need —
 * the brief's two-arg summary of this function elides it, but none of
 * those checks are answerable without it. Reachability is checked for
 * BOTH station-addressed offers (runBeam/labWork/etc, via the StationRef's
 * resolved node) and target-addressed ones (repair/commission, via the
 * same approachCandidates() perimeter walk buildJobOffers's own repair
 * pre-filter uses) — a technician on the far side of the map is not
 * eligible for a repair five tiles away just because there's no
 * StationRef to hang the check off of.
 *
 * Never rejects on specialty mismatch alone: a specialist working outside
 * their specialty runs at CROSS_SPECIALTY_EFFICIENCY (half rate, applied by
 * StaffMember.efficiency() when the job is actually worked), not zero — so
 * eligibility only cares whether the member's profession is relevant at
 * all, not which specialty they happen to carry.
 */
export function eligibleFor(member, offer, game) {
  const jobType = JOB_TYPES[offer.jobType];
  if (!jobType) return { ok: false, reason: 'That job no longer exists.' };

  if (!jobType.professions.includes(member.profession)) {
    const roleNames = jobType.professions.map(id => professionDef(id)?.name || 'that role').join(' or ');
    const memberRole = professionDef(member.profession)?.name || null;
    return {
      ok: false,
      reason: memberRole
        ? `${jobType.name} needs ${article(roleNames)} ${roleNames}, not ${article(memberRole)} ${memberRole}.`
        : `${jobType.name} needs ${article(roleNames)} ${roleNames}, and this staffer isn't one.`,
    };
  }

  // Defensive floor, not exercised by any profession/skill combination the
  // game currently hands out (every hired StaffMember starts with a
  // nonzero primary skill) — kept because "the member has no relevant
  // skill at all" is its own distinct rejection reason from a profession
  // mismatch, per the brief, and skill values CAN reach 0 in principle.
  const primarySkill = professionDef(member.profession)?.primarySkill;
  if (primarySkill && (member.skills?.[primarySkill] ?? 0) <= 0) {
    return { ok: false, reason: `${memberLabel(member)} has no proficiency for this kind of work yet.` };
  }

  const state = game?.state;
  if (!state) return { ok: true, reason: null };

  if (offer.stationKey) {
    const index = getStationIndex(state);
    const ref = index.byKey[offer.stationKey];
    if (!ref) return { ok: false, reason: 'That station is gone.' };

    const reservations = state.stationReservations || {};
    const heldBy = reservations[ref.key];
    if (heldBy && heldBy !== member.id) {
      return { ok: false, reason: 'Someone else is already working that station.' };
    }

    if (member.fromNode) {
      const nav = getNavGrid(state);
      if (!isReachable(nav, member.fromNode, ref.node)) {
        return { ok: false, reason: `${memberLabel(member)} can't reach that station from here.` };
      }
    }
  } else if (offer.target) {
    const placeable = resolveTarget(game, offer.target);
    if (!placeable) return { ok: false, reason: 'That job no longer exists.' };

    if (member.fromNode) {
      const nav = getNavGrid(state);
      const cells = footprintCellsOf(placeable);
      const reachable = cells.length > 0
        && approachCandidates(nav, state, cells).some(n => isReachable(nav, member.fromNode, n));
      if (!reachable) {
        return { ok: false, reason: `${memberLabel(member)} can't reach that job from here.` };
      }
    }
  }

  return { ok: true, reason: null };
}

function article(word) {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function memberLabel(member) {
  return member?.name || (member?.firstName ? `${member.firstName} ${member.lastName || ''}`.trim() : null) || 'This staffer';
}
