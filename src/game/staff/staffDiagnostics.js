// src/game/staff/staffDiagnostics.js — idle legibility.
//
// Task 8 of the staff-professions-3 (jobs-and-gates) plan, and the one that
// makes the other seven debuggable. Every other task in this plan left a
// player-readable trail on member.idleReason (jobRunner.js), on
// buildJobOffers' suppressions channel (jobs.js), and on the beam gate's
// nine-branch message ladder (utility-gate.js) — but none of those reach the
// screen as anything more than a per-staffer tooltip or a console.warn. This
// module is the layer that turns those sources into two things: one clear
// banner line plus a per-staffer breakdown for IDLE staff
// (facilityStaffingReport), and a second signal for the failure mode that is
// invisible to the first by construction — a facility where everyone is
// BUSY and nothing is progressing (facilityProgressReport). Fix round 1
// added the second signal after a review found the first alone silent on
// exactly the two most expensive bugs this plan produced in development: a
// fully-staffed beam nobody ever pressed Start on, and research that can't
// advance because the staff working it are, correctly, "busy."
//
// facilityStaffingReport(game) groups every idle staffer (member.job ==
// null) by their idleReason text, ranks the groups by how much they're
// costing the facility RIGHT NOW (an idle operator blocks the beam only if
// the beam gate itself says so — see rankFor's own comment, fix round 1's
// F2 — an idle technician stalls repairs; everything else is lower stakes),
// and hands back the highest-impact group as `worst` for the HUD banner to
// lead with.
//
// Corrections applied to idleReason before grouping, none of them in
// jobRunner.js — see reasonFor's own doc comment for the full case-by-case
// reasoning:
//
// 1. A weaker, fix-nameless phrasing of a fact another code path already
//    states better ("No spares available to make the repair." vs. "No
//    spares left to repair with; a machinist can make more.") is normalized
//    to the fuller version.
// 2. A needs-deadlock message that claims a jobless member is "recovering
//    ... while working" (self-contradictory once job really is null) has
//    that trailing clause stripped.
// 3. An idle operator, ONLY when their own reason is either the generic
//    catch-all or the cross-profession-mismatch shape (item 4) — NEVER over
//    a station-specific rejection, which is already correct and often more
//    actionable than the gate's coarser account (fix round 1's F1: "can't
//    reach that particular console" is not interchangeable with "hire
//    another operator") — reads the beam gate's own ladder message instead,
//    whenever the gate has independently found coverage short.
// 4. Anyone else, when their idleReason is eligibleFor's cross-profession
//    rejection text ("Repair needs a Technician, not an Operator.") — this
//    plan's hazard 1 in the flesh, a second unguarded route to the player
//    screen (see the header this replaced for the full story) — gets a
//    flat, honest "no work available" instead, with the discarded half
//    (which job type/role WAS waiting) preserved rather than dropped (fix
//    round 1's F12).

import { JOB_TYPES, buildJobOffers } from './jobs.js';
import { getStationIndex } from './stations.js';
import { countBeamlines, operatorCoverage } from '../utility-gate.js';
import { PLACEABLES } from '../../data/placeables/index.js';
import { professionDef } from '../../data/professions.js';

// Matches eligibleFor's two cross-profession rejection templates (jobs.js) —
// the only two idleReason strings that ever name a job/profession OTHER
// than the member's own. Captures the job type's own name and the role it
// actually needs, so the corrected message (see reasonFor) can keep both
// halves instead of discarding the actionable one (fix round 1's F12).
const CROSS_PROFESSION_MISMATCH_RE =
  /^(.+?) needs (.+?), (?:not .+\.|and this staffer isn't one\.)$/;

// The fully-generic catch-alls jobRunner.js's own idleReason precedence
// chain falls back to when NOTHING else — not even a cross-profession
// offer — was available to explain a member's idleness (assignJobs' final
// `|| 'Nothing to do right now.'`, and resolveDestNode's defensive floor).
// Like the mismatch shape above, these carry no real information of their
// own and are safe to replace with the beam gate's ladder for an idle
// operator when the gate applies.
const GENERIC_FALLBACK_REASONS = new Set([
  'Nothing to do right now.',
  'Could not find anywhere to stand for that job.',
]);

// A weaker phrasing of a fact a sibling code path already states with the
// fix named — fix round 1's "F5's sibling": jobs.js's repair-suppression
// channel says "No spares available to make the repair." (true, but names
// no fix); jobRunner.js's capShortageReason says "No spares left to repair
// with; a machinist can make more." for the identical underlying fact.
// Normalized to the latter wherever it's seen, regardless of which code
// path produced it.
const REASON_NORMALIZATION = new Map([
  ['No spares available to make the repair.', 'No spares left to repair with; a machinist can make more.'],
]);

// Strips a needs-deadlock message's trailing "— recovering slowly while
// working" clause (jobRunner.js's tryTakeNeedJob) when it reaches a member
// who, in fact, has no job at all — every call site in this file only ever
// invokes reasonFor for an idle (job == null) member (facilityStaffingReport
// filters to `idle` before calling it; describeJob only calls it from its
// `!job` branch), so the phrase is ALWAYS self-contradictory here: it was
// written for the OTHER branch of tryTakeNeedJob's deadlock guard, where
// the member keeps holding a real job while one need goes unserviced (see
// describeJob's own unservicedPenalty handling below for THAT case, fix
// round 1's F7). "No reachable cafeteria — recovering slowly while
// working." becomes "No reachable cafeteria." — still true, no longer
// claiming a busy state this member isn't in (fix round 1's F11).
const RECOVERING_WHILE_WORKING_RE = / — recovering slowly while working\.$/;

// Impact ranking for `worst`. An idle TECHNICIAN is always a component
// wearing further toward failure — technician's only job type is repair, so
// idle unconditionally means repairs are stalled. An idle OPERATOR, by
// contrast, is only actually costing the beam money when the beam gate
// itself has independently concluded coverage is short (`beamMsg` non-null)
// — fix round 1's F2: an operator idle merely because the facility has zero
// beamlines yet ("No beamlines to operate yet.") is not blocking anything,
// and ranking them above six technicians stalled on a genuine spares
// shortage got the "what's costing money" framing exactly backwards.
// Everyone else ranks lowest.
const DEFAULT_RANK = 2;

function rankFor(member, beamMsg) {
  if (member?.profession === 'technician') return 1;
  if (member?.profession === 'operator' && beamMsg) return 0;
  return DEFAULT_RANK;
}

// The beam gate's own player-facing explanation for why it can't run right
// now (utility-gate.js's _unstaffedMessage, published each tick on
// state.infraBlockers as the 'beam_unstaffed' hard error) — or null when the
// beam isn't staffing-blocked at all. Reused rather than re-derived: it is
// already the authoritative, tested account of "no console / console
// unreachable / nobody hired / everyone's on break / short on coverage",
// and re-implementing any slice of that ladder here would just be a second
// copy to keep in sync.
function beamBlockedMessage(state) {
  const blocker = (state.infraBlockers || []).find(b => b.code === 'beam_unstaffed');
  return blocker ? blocker.message : null;
}

// The reason text an idle member should show the player — see this file's
// header for the four corrections applied, in the order they're checked.
function reasonFor(member, beamMsg) {
  let raw = member.idleReason || 'Nothing to do right now.';
  raw = REASON_NORMALIZATION.get(raw) || raw;
  if (RECOVERING_WHILE_WORKING_RE.test(raw)) raw = raw.replace(RECOVERING_WHILE_WORKING_RE, '.');

  const mismatch = raw.match(CROSS_PROFESSION_MISMATCH_RE);
  const correctable = !!mismatch || GENERIC_FALLBACK_REASONS.has(raw);

  // Fix round 1's F1: the gate's coarse "can ANY operator reach ANY
  // console" ladder must never outrank a station-specific rejection about
  // THIS operator (e.g. "can't reach that station from here" — a sealed
  // console a second console elsewhere doesn't fix) — only ever substituted
  // when this member's own reason was already uninformative.
  if (member.profession === 'operator' && beamMsg && correctable) return beamMsg;

  if (!mismatch) return raw;
  // mismatch[1] = the job type name that needed someone else (e.g.
  // "Fabrication"); mismatch[2] = the role it needed (e.g. "a Machinist").
  // Fix round 1's F12: keep both halves — WHO can't work right now, and
  // WHAT is sitting there waiting for a profession this roster doesn't
  // have on shift — rather than collapsing to a flat, un-actionable "no
  // work available".
  const profName = professionDef(member.profession)?.name || 'staff';
  return `No ${profName} work available right now — ${mismatch[1]} needs ${mismatch[2]}.`;
}

/**
 * `{ idleCount, byReason, worst }` for every staffer currently without a
 * job. `byReason` is `[{ reason, count, members }]`, one entry per DISTINCT
 * reason text (post correction — see this file's header), sorted by impact:
 * beam-blocking reasons first, then repair-stalling ones, then everything
 * else, ties broken by how many staff share the reason (the bigger problem
 * leads) and finally by the reason text itself (deterministic output for
 * identical input, no reliance on Map iteration order).
 *
 * `worst` is `byReason[0]`, or `null` when nobody is idle — the HUD banner's
 * entire input: `idleCount === 0` hides it, otherwise it leads with
 * `worst.reason` and `worst.count`, self-correcting the moment the
 * underlying cause (the count for that specific reason) changes, same as
 * every other tick-derived HUD panel in this codebase.
 *
 * Idle means `member.job == null` — NOT "member.idleReason is set", since
 * the hunger/fatigue deadlock guard (jobRunner.js's tryTakeNeedJob) can
 * leave idleReason non-empty on a member who is still actively holding and
 * working a real job (a technician mid-repair with no reachable cafeteria).
 * That member is unservicedPenalty-tagged and running at reduced efficiency
 * — a real cost, but a different one from "not working at all," and THIS
 * report's job is specifically the latter (see describeJob for the other —
 * fix round 1's F7 put it on the inspector instead, per the review: "the
 * inspector's whole job is why is this person not producing").
 */
export function facilityStaffingReport(game) {
  const state = game?.state || {};
  const members = state.staffMembers || [];
  const idle = members.filter(m => m.job == null);
  const beamMsg = beamBlockedMessage(state);

  const groups = new Map(); // reason -> { reason, count, members, rank }
  for (const m of idle) {
    const reason = reasonFor(m, beamMsg);
    let g = groups.get(reason);
    if (!g) {
      g = { reason, count: 0, members: [], rank: DEFAULT_RANK };
      groups.set(reason, g);
    }
    g.count++;
    g.members.push(m);
    // A group's rank is the BEST (lowest-number) rank among the staff who
    // share its reason text — a generic reason ("Not currently working.")
    // shared by an idle operator (with the beam genuinely short) and an
    // idle admin still counts as beam-impact for ordering purposes, because
    // it genuinely is for that operator. MUST be a running minimum, not a
    // last-write-wins assignment — see test-staff-diagnostics.js's own
    // mutation-guard test for why this line specifically is load-bearing.
    const r = rankFor(m, beamMsg);
    if (r < g.rank) g.rank = r;
  }

  const byReason = [...groups.values()]
    .sort((a, b) => a.rank - b.rank || b.count - a.count || a.reason.localeCompare(b.reason))
    .map(({ reason, count, members: ms }) => ({ reason, count, members: ms }));

  return {
    idleCount: idle.length,
    byReason,
    worst: byReason[0] || null,
  };
}

const PHASE_WORD = { travel: 'travelling', work: 'working' };

// Friendly name for the station a member's job is anchored to, or null for
// a target-addressed job (repair/commission — no station, no seat) or a
// stale stationKey the index no longer resolves (station demolished out
// from under a travelling member — jobRunner.js's own tickJobs abandons
// those the next tick, but this can be read in the one-tick window before
// that happens — fix round 1's F10 is exactly that window: the label must
// degrade gracefully, not print a dangling preposition).
function stationLabel(member, game) {
  const job = member.job;
  if (!job) return null;
  if (job.stationKey) {
    const ref = getStationIndex(game.state).byKey[job.stationKey];
    const def = ref ? PLACEABLES[ref.defId] : null;
    return def?.name || null;
  }
  if (job.target) return 'the beamline';
  return null;
}

// Fix round 1's F4 (BLOCKING): a facility can be fully staffed — an
// operator seated, phase:'work', operatorCoverage(state).covered true — and
// STILL earn nothing, because nobody ever pressed Start. The old gate never
// caught this: it only asks "is staffing the reason the beam can't run",
// and staffing is fine here. Checked directly against the beamline
// registry's own `status` field (Game._registerBeamline's source of truth
// for "running" vs "stopped"), which is the one place that fact actually
// lives — countBeamlines/operatorCoverage both read placeables/staff, never
// registry status, so neither would ever see this on their own.
//
// Returns the player-facing sentence, or null when either staffing itself
// is the (already differently-surfaced) problem, there are no beamlines to
// run at all, or at least one registered beamline IS running.
function beamNotStartedMessage(game) {
  const state = game.state;
  if (countBeamlines(state) === 0) return null;
  if (!operatorCoverage(state).covered) return null;
  const entries = game.registry?.getAll?.() || [];
  if (entries.length === 0) return null; // no registry wired up (e.g. a bare fixture) — nothing to confirm against
  if (entries.some(e => e.status === 'running')) return null;
  return 'The beam is fully staffed but has never been started — press Start to begin operation.';
}

/**
 * `{ status, station }` for one staffer, the inspector's per-staffer
 * summary: `status` is either "<Job name> — <travelling/working>[ <prep>
 * <station>]" (job held) or the same corrected idle-reason text
 * facilityStaffingReport groups by (no job); `station` is the friendly
 * placeable name the job is anchored to, or null when there isn't one
 * (idle, or a target-addressed repair/commission with no station of its
 * own).
 *
 * Two things a held job can ALSO be true of, both folded into `status`
 * rather than requiring a second read — fix round 1's F4 and F7, the
 * review's own framing that "the inspector's whole job is why is this
 * person not producing" applies even to staff who technically hold a job:
 *   - an operator seated and working (`job.jobType === 'runBeam'`,
 *     `phase === 'work'`) whose facility is otherwise fully staffed but has
 *     never been started reads as still "working" today with nothing after
 *     it to say otherwise — corrected to name the real fact and the fix.
 *   - `member.unservicedPenalty` (set by jobRunner.js's tryTakeNeedJob
 *     deadlock guard — StaffMember.efficiency()'s own ×0.6 flat penalty)
 *     was invisible on every surface: a staffer working at reduced output
 *     with `member.idleReason` already carrying WHY (a needs-deadlock
 *     message — see this file's header, correction 2) showed nothing at
 *     all. Appended verbatim; these messages are never the cross-profession
 *     mismatch shape (only eligibleFor's rejections are), so no further
 *     correction is needed here.
 */
export function describeJob(member, game) {
  const job = member.job;
  if (!job) {
    const state = game?.state || {};
    return { status: reasonFor(member, beamBlockedMessage(state)), station: null };
  }

  const jobDef = JOB_TYPES[job.jobType];
  const name = jobDef?.name || job.jobType;
  const station = stationLabel(member, game);
  const phaseWord = PHASE_WORD[job.phase] || null;
  let status = name;
  if (phaseWord) {
    status += ` — ${phaseWord}`;
    if (station) status += job.phase === 'travel' ? ` to ${station}` : ` at ${station}`;
  }

  if (job.jobType === 'runBeam' && job.phase === 'work') {
    const notStarted = beamNotStartedMessage(game);
    if (notStarted) status += ` — but the beam has never been started (press Start)`;
  }
  if (member.unservicedPenalty && member.idleReason) {
    status += ` — reduced output: ${member.idleReason}`;
  }

  return { status, station };
}

// --- Facility progress stall (fix round 1's F5) -----------------------
//
// facilityStaffingReport can only ever speak about IDLE staff — by
// construction, it has nothing to say about a facility where everyone is
// BUSY and nothing is progressing (an engineer endlessly running labWork
// while the zone tier it feeds never climbs high enough to matter, say).
// That is the shape of the two most expensive bugs this plan produced in
// development. This is the second, independent signal: not keyed on
// idleness at all, keyed on whether anything has actually COMPLETED
// recently, with the facility's own best guess at why once it hasn't.
//
// Two kinds of check, run in order:
//   1. Immediate, structural facts that are already fully known the
//      instant they're true and need no waiting at all — currently just
//      beamNotStartedMessage (fix round 1's F4). Cheap, checked every call.
//   2. A generic productivity fingerprint or a fixed number of ticks
//      (STALL_WINDOW_TICKS) — the general "nothing has completed in N
//      ticks" signal fix round 1 asked for, covering every OTHER shape of
//      stall this file doesn't have a named check for (a labWork-only
//      facility included: labWork contributes to no StaffMember stats key
//      at all — see STATS_KEYS, StaffMember.js — so a facility where
//      engineers are the only staff working anything leaves the
//      fingerprint flat, exactly matching the review's own example).
//
// The fingerprint/since-tick pair is cached per `state` object identity in
// a module-level WeakMap — the same pattern stations.js's stationCache and
// utility-gate.js's own _topoCache already use for per-tick state, not
// something that needs to survive a save/load (a freshly loaded facility
// simply starts its stall clock over, same as a freshly loaded game starts
// every other in-memory cache over).
const STALL_WINDOW_TICKS = 240; // one in-game day (Game.js's DAY_LENGTH_TICKS) — comfortably longer than the longest single job (fabricate, 150 ticks), so one still-in-flight job can never look like a stall.
const progressCache = new WeakMap(); // state -> { fingerprint, sinceTick }

// Sum of every roster member's completion-bearing stats — repairs,
// commissions, spares, analyses, beam-hours (STATS_KEYS minus
// ticksWorked/breakdowns, neither of which signals PROGRESS: ticksWorked
// increments for merely being status:'working', breakdowns is a bad thing
// happening, not a good one) — plus completedResearch's own length. Any
// completion anywhere bumps this; a facility where every job in flight is
// labWork (contributes to no stats key — see STATS_KEYS) or a stalled
// runBeam (beamHours only accrues while the beam is ACTUALLY running — see
// utility-gate.js's _accrueBeamHours) leaves it flat.
function progressFingerprint(state) {
  let total = (state.completedResearch || []).length * 1000;
  for (const m of state.staffMembers || []) {
    const s = m.stats || {};
    total += (s.repairs || 0) + (s.commissions || 0) + (s.sparesMade || 0) + (s.analyses || 0) + (s.beamHours || 0);
  }
  return total;
}

/**
 * `{ stalled, reason }` — the facility's second, non-idleness-keyed
 * legibility signal (fix round 1's F5). `reason` is null whenever `stalled`
 * is false. See this section's own header for the two check kinds and why
 * the fingerprint is safe to cache per state identity rather than persist.
 */
export function facilityProgressReport(game) {
  const state = game?.state || {};
  if (!(state.staffMembers || []).length) return { stalled: false, reason: null };

  const notStarted = beamNotStartedMessage(game);
  if (notStarted) return { stalled: true, reason: notStarted };

  const tick = state.tick || 0;
  const fp = progressFingerprint(state);
  let cache = progressCache.get(state);
  if (!cache || cache.fingerprint !== fp) {
    cache = { fingerprint: fp, sinceTick: tick };
    progressCache.set(state, cache);
  }

  if (tick - cache.sinceTick < STALL_WINDOW_TICKS) return { stalled: false, reason: null };

  // Best guess, most-specific first: the job board's own suppression
  // channel (a damaged component nobody can fix because there's nothing to
  // fix it with, true regardless of whether any technician happens to be
  // idle right now); any live hard infra blocker; a generic fallback that
  // still names the fact rather than staying silent.
  const { suppressions } = buildJobOffers(game);
  if (suppressions.length) return { stalled: true, reason: suppressions[0].reason };
  const blocker = (state.infraBlockers || [])[0];
  if (blocker) return { stalled: true, reason: blocker.message || blocker.code };
  return { stalled: true, reason: `Nothing has completed in over ${STALL_WINDOW_TICKS} ticks — check staffing, stations, and construction.` };
}
