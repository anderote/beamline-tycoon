// src/game/staff/jobs.js — the job board.
//
// Task 1 of the staff-professions-3 (jobs-and-gates) plan. Scans the world
// and derives the offers a job system (Task 2+) will assign to staff. This
// module is PURE DERIVATION: buildJobOffers() only reads `game`/`game.state`
// — nav grid, station index, beamline registry, resources — and returns a
// plain array. Nothing here reserves a station, nothing here writes to
// state, nothing here picks who does the work. That's the next task.
//
// The eleven job ids below are a closed vocabulary, already authored onto
// placeable defs' `station.jobs` arrays (see facility-lab-furnishings.raw.js,
// facility-room-furnishings.raw.js) or produced only by this module (repair,
// commission have no station — see below). A typo here silently strands a
// station or a target nobody can ever be offered.

import { getStationIndex } from './stations.js';
import { getNavGrid, isReachable } from './nav.js';
import { PROFESSIONS, SPECIALTY_AXES, professionDef } from '../../data/professions.js';
import { ZONES } from '../../data/facility.js';
import { flattenPath } from '../../beamline/flattener.js';

// --- Job type table ---------------------------------------------------

// Priority ordering, highest first (per task-1-brief.md): eat/rest (need-
// driven — Task 2 injects these offers itself; the board never generates
// them, but they still need a place in this table since the vocabulary is
// closed and Task 2 reads their basePriority/workTicks same as everything
// else), then repair, runBeam, commission, fabricate, takeData, labWork,
// analyze, paperwork, meet. Repair's actual per-offer priority is this base
// PLUS an urgency term that grows as health falls (see repairOffersFor) —
// the base alone is already above runBeam's, so a repair offer always
// outranks a runBeam offer regardless of how mild the damage is.
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
  eat:        { id: 'eat',        name: 'Eat',           professions: Object.keys(PROFESSIONS), usesSpecialty: false, basePriority: 100, workTicks: 40,  interruptible: false },
  rest:       { id: 'rest',       name: 'Rest',          professions: Object.keys(PROFESSIONS), usesSpecialty: false, basePriority: 95,  workTicks: 80,  interruptible: false },
  repair:     { id: 'repair',     name: 'Repair',        professions: ['technician'],            usesSpecialty: false, basePriority: 90,  workTicks: 60,  interruptible: false },
  runBeam:    { id: 'runBeam',    name: 'Run Beam',      professions: ['operator'],               usesSpecialty: false, basePriority: 80,  workTicks: null, interruptible: false },
  commission: { id: 'commission', name: 'Commissioning', professions: ['engineer'],               usesSpecialty: true,  basePriority: 70,  workTicks: 90,  interruptible: true },
  fabricate:  { id: 'fabricate',  name: 'Fabrication',   professions: ['machinist'],              usesSpecialty: false, basePriority: 60,  workTicks: 150, interruptible: true },
  takeData:   { id: 'takeData',   name: 'Take Data',     professions: ['scientist'],              usesSpecialty: true,  basePriority: 50,  workTicks: 120, interruptible: true },
  labWork:    { id: 'labWork',    name: 'Lab Work',      professions: ['engineer'],               usesSpecialty: true,  basePriority: 40,  workTicks: 120, interruptible: true },
  analyze:    { id: 'analyze',    name: 'Analysis',      professions: ['scientist'],              usesSpecialty: false, basePriority: 30,  workTicks: 100, interruptible: true },
  paperwork:  { id: 'paperwork',  name: 'Paperwork',     professions: ['admin'],                  usesSpecialty: false, basePriority: 20,  workTicks: 80,  interruptible: true },
  meet:       { id: 'meet',       name: 'Meeting',       professions: Object.keys(PROFESSIONS), usesSpecialty: false, basePriority: 10,  workTicks: 60,  interruptible: true },
};

// A repair/commission node's priority-per-health-point term (see JOB_TYPES'
// comment above) — small enough that a barely-damaged node still sorts
// below a badly-damaged one, but never large enough to threaten eat/rest's
// injected priority.
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

// --- Reachability helpers (board-level, no staff position available yet) --
//
// eligibleFor's "unreachable" check (below) has an actual staff position to
// test against. buildJobOffers does not — it runs once per world scan, not
// once per staffer — so repair's own "don't even offer a sealed-off node"
// pre-filter (task-1-brief.md) needs a position-INDEPENDENT notion of
// reachability: is this node connected to the rest of the walkable facility
// at all, by anyone, ever? nav.js's connected-component labelling already
// treats everything outside the built area as one implicit OUTDOOR
// component (see nav.js's header comment), and a real facility's built
// area almost always touches it somewhere (a front door, an unwalled gap) —
// a node that DOESN'T is exactly the "sealed room, no door" case this is
// meant to catch. Probing all four corners of the nav grid's own bounds
// (guaranteed outdoors — nothing is ever built at the literal edge of the
// map) rather than a single corner is cheap insurance against one corner
// happening to be blocked.
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

// Normalize a subtile offset the same way stations.js's absoluteSubtile
// does (duplicated here rather than imported — it's a few lines of modular
// arithmetic, not worth exporting a private helper across modules for).
function offsetSubtile(node, dc, dr) {
  const totalCol = (node.subCol || 0) + dc;
  const totalRow = (node.subRow || 0) + dr;
  return {
    col: node.col + Math.floor(totalCol / 4),
    row: node.row + Math.floor(totalRow / 4),
    subCol: ((totalCol % 4) + 4) % 4,
    subRow: ((totalRow % 4) + 4) % 4,
  };
}

// A beamline component is solid (occupies a blocked subtile, same as any
// other placed equipment — see nav.js's blockedSubtiles), so a technician
// can never stand ON it; they stand next to it. Returns the component's own
// subtile if that happens to be passable (small/attachment-style parts),
// otherwise the first passable subtile immediately cardinal-adjacent to it,
// or null if the component is boxed in on all four sides.
function approachNode(nav, node) {
  const passableAt = (n) => nav.passable.has(`${n.col},${n.row},${n.subCol},${n.subRow}`);
  if (passableAt(node)) return node;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n2 = offsetSubtile(node, dc, dr);
    if (passableAt(n2)) return n2;
  }
  return null;
}

function nodeSubtile(placeable) {
  if (!placeable || !Number.isFinite(placeable.col) || !Number.isFinite(placeable.row)) return null;
  return {
    col: placeable.col, row: placeable.row,
    subCol: placeable.subCol || 0, subRow: placeable.subRow || 0,
  };
}

// --- Offer generation, per job type ------------------------------------

function freeStationsFor(index, reservations, jobId) {
  return (index.byJob[jobId] || []).filter(ref => !reservations[ref.key]);
}

// runBeam: one offer per free runBeam station slot, capped at the number of
// beamlines that currently exist — a console with no beamline to run is not
// work. Stations are interchangeable (a slot doesn't reference a specific
// beamline), so the cap is just a count, not a per-beamline pairing.
function runBeamOffers(index, reservations, beamlineCount) {
  return freeStationsFor(index, reservations, 'runBeam')
    .slice(0, beamlineCount)
    .map(ref => makeOffer('runBeam', null, null, JOB_TYPES.runBeam.basePriority, ref.key));
}

// repair + commission: both walk every currently-registered beamline's
// flattened path looking at each MODULE node (drift/placement synthetic
// entries carry no placeable position to repair a technician toward, and
// componentHealth is keyed by module placeable ids — see
// Game.js:_applyWearForBeamline). Iterating only registry.getAll()'s
// CURRENT entries is what makes the "stale target" rule (a beamline that no
// longer exists must never appear as a target) automatic: a demolished
// beamline simply never contributes nodes to this loop, with no separate
// staleness check required.
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

function repairOffers(game, nav) {
  const spares = game.state.resources?.spares ?? 0;
  const offers = [];
  for (const { entry, node } of beamlineComponentNodes(game)) {
    const health = entry.beamState?.componentHealth?.[node.id];
    if (health === undefined || health >= 100) continue;
    // Rejected before offering — no offer is emitted at all — when the
    // node can't be reached or there's nothing to fix it with. Both checks
    // run every time (not short-circuited on the cheaper one) only because
    // order doesn't matter here: neither has a side effect.
    if (spares <= 0) continue;
    const subtile = nodeSubtile(node.placeable);
    const approach = subtile && approachNode(nav, subtile);
    if (!approach || !reachableFromOutdoors(nav, approach)) continue;

    const priority = JOB_TYPES.repair.basePriority + (100 - health) * REPAIR_HEALTH_WEIGHT;
    offers.push(makeOffer('repair', { beamlineId: entry.id, nodeId: node.id }, null, priority, null));
  }
  return offers;
}

// commission: one offer per placed component flagged `needsCommissioning`
// (Task 6 sets this, alongside a `specialty` naming which engineering
// specialty is qualified to sign off on it — neither field exists on any
// placeable yet, so this is forward-compatible dead code today, not
// reachable from any current game state).
function commissionOffers(game) {
  const offers = [];
  for (const { entry, node } of beamlineComponentNodes(game)) {
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
// nothing else reserved. "Idle" is read off state.stationReservations
// (nobody holding any slot) rather than StaffMember.status: status only
// distinguishes working/onBreak/resting, none of which is "unassigned",
// and a reservation is the one signal this board can already see without
// a real job-assignment system (that's Task 2).
function idleStaffCount(state) {
  const reservations = state.stationReservations || {};
  const reservedIds = new Set(Object.values(reservations));
  return (state.staffMembers || []).filter(m => !reservedIds.has(m.id)).length;
}

function meetOffers(index, reservations, state) {
  const adminPresent = (state.staffMembers || []).some(m => m.profession === 'admin');
  if (!adminPresent || idleStaffCount(state) < MEET_MIN_IDLE) return [];
  return freeStationsFor(index, reservations, 'meet')
    .map(ref => makeOffer('meet', null, null, JOB_TYPES.meet.basePriority, ref.key));
}

/**
 * Scan `game`'s world and derive every job offer currently available —
 * pure function of `game`/`game.state`, no mutation, no assignment. Sorted
 * by descending priority. eat/rest are never generated here (Task 2 injects
 * those directly from staff needs) even though they're in JOB_TYPES.
 */
export function buildJobOffers(game) {
  const state = game.state;
  const index = getStationIndex(state);
  const reservations = state.stationReservations || {};
  const nav = getNavGrid(state);
  const beamlineCount = (game.registry?.getAll?.() || []).length;

  const offers = [
    ...runBeamOffers(index, reservations, beamlineCount),
    ...repairOffers(game, nav),
    ...commissionOffers(game),
    ...plainStationOffers(index, reservations),
    ...meetOffers(index, reservations, state),
  ];

  offers.sort((a, b) => b.priority - a.priority);
  return offers;
}

// --- Eligibility ---------------------------------------------------------

/**
 * Whether `member` may currently take `offer`. Always returns
 * `{ ok, reason }` — never a bare boolean — because `reason` survives to the
 * player-facing UI (a later task): it must read as English, never leak a
 * camelCase job/station id, and never be empty when `ok` is false.
 *
 * `member` needs `.profession`, `.specialty`, `.skills`, and — only when
 * `offer.stationKey` is set and reachability matters — `.fromNode` (a
 * subtile node, the member's current position; the same shape findStation's
 * `fromNode` takes). Task 2's assignment loop resolves this from the
 * staffer's live pawn position before calling in; omitting it simply skips
 * the reachability check rather than rejecting; StaffMember itself carries
 * no position field today (see StaffPawns.js), so this cannot be tightened
 * to "always required" without that task.
 *
 * `game` supplies the world context (station index, nav grid, reservations)
 * that reachability/reservation checks need — the brief's two-arg summary
 * of this function elides it, but neither check is answerable without
 * `game.state`.
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
    const roleNames = jobType.professions.map(id => professionDef(id)?.name || id).join(' or ');
    const memberRole = professionDef(member.profession)?.name || member.profession;
    return { ok: false, reason: `${jobType.name} needs ${article(roleNames)} ${roleNames}, not ${article(memberRole)} ${memberRole}.` };
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
  if (offer.stationKey && state) {
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
  }

  return { ok: true, reason: null };
}

function article(word) {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function memberLabel(member) {
  return member?.name || (member?.firstName ? `${member.firstName} ${member.lastName || ''}`.trim() : null) || 'This staffer';
}
