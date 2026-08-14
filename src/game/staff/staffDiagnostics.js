// src/game/staff/staffDiagnostics.js — idle legibility.
//
// Task 8 of the staff-professions-3 (jobs-and-gates) plan, and the one that
// makes the other seven debuggable. Every other task in this plan left a
// player-readable trail on member.idleReason (jobRunner.js), on
// buildJobOffers' suppressions channel (jobs.js), and on the beam gate's
// nine-branch message ladder (utility-gate.js) — but none of those reach the
// screen as anything more than a per-staffer tooltip or a console.warn. This
// module is the layer that turns those three sources into one clear banner
// line and a per-staffer breakdown, so "a facility earning nothing" and
// "why" are the same discovery instead of two.
//
// facilityStaffingReport(game) is the whole surface: it groups every idle
// staffer (member.job == null) by their idleReason text, ranks the groups by
// how much they're costing the facility (an idle operator blocks the beam
// outright; an idle technician stalls repairs; everything else is lower
// stakes), and hands back the highest-impact group as `worst` for the HUD
// banner to lead with.
//
// Two corrections happen here, not in jobRunner.js — see reasonFor's own
// doc comment for the full case-by-case reasoning:
//
// 1. An idle operator, whenever the beam gate has independently found
//    coverage short, always reads as the gate's own ladder message
//    (utility-gate.js's tested, nine-branch _unstaffedMessage) rather than
//    whatever jobRunner happened to land on — the gate is the one place
//    "why is the beam short" has a real, complete answer.
// 2. Everyone else falls back to eligibleFor's cross-profession rejection
//    text ("Repair needs a Technician, not an Operator.") only when
//    assignJobs' idleReason precedence chain had nothing better — which
//    happens whenever a member's OWN job type produced zero offers to
//    reject them from at all (nothing left to repair, say). That text was
//    written for pickBestOffer's fallbackReason — a signal for OTHER code,
//    not player copy — and reads as a bug report once it reaches the
//    screen ("Commissioning needs an Engineer, not a Technician" about an
//    idle technician with nothing to fix). This is this plan's hazard 1 in
//    the flesh: a second, unguarded route to the player screen. Detected by
//    shape and substituted with a flat, honest "no work available" instead.

import { JOB_TYPES } from './jobs.js';
import { getStationIndex } from './stations.js';
import { PLACEABLES } from '../../data/placeables/index.js';
import { professionDef } from '../../data/professions.js';

// Matches eligibleFor's two cross-profession rejection templates (jobs.js) —
// the only two idleReason strings that ever name a job/profession OTHER
// than the member's own. Deliberately narrow (both templates share " needs
// " followed by either ", not <role>." or ", and this staffer isn't one.")
// so this can't accidentally swallow a legitimate station-specific reason
// (reservation conflicts, unreachable stations, spares shortages — none of
// which use the word "needs").
const CROSS_PROFESSION_MISMATCH_RE = / needs .+, (?:not .+\.|and this staffer isn't one\.)$/;

// Impact ranking for `worst`: an idle operator is the beam sitting dark
// right now (every tick of downtime is lost income); an idle technician is
// a component wearing further toward failure; everything else is a softer
// cost (a stalled analysis, an unbuilt spare) that doesn't compound the same
// way. Any profession absent from this table (scientist, engineer,
// machinist, admin) ranks lowest.
const CATEGORY_RANK = { operator: 0, technician: 1 };
const DEFAULT_RANK = 2;

function rankFor(member) {
  return CATEGORY_RANK[member?.profession] ?? DEFAULT_RANK;
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

// The reason text an idle member should show the player: their own
// idleReason, verbatim, with two corrections.
//
// 1. An idle OPERATOR, whenever the beam gate has independently found
//    coverage short (beamMsg non-null — utility-gate.js's own
//    operatorCoverage, surfaced as the 'beam_unstaffed' blocker), always
//    shows the gate's ladder message instead of whatever jobRunner landed
//    on. Not just the cross-profession-mismatch case below: jobRunner has
//    no single authoritative "why is the beam short" account of its own —
//    depending on which offer it happened to reject the operator from, its
//    idleReason ranges from accurate-but-narrow ("This staffer can't reach
//    that station from here" — true of THIS operator, silent on whether
//    the beam is short at all) to the outright wrong text corrected below.
//    The gate's ladder is the one place that question has a real, tested
//    answer (test-beam-staffing-gate.js's own 9-scenario suite), so it
//    wins outright whenever it applies — and it never applies once coverage
//    IS achieved (capShortageReason's "All N beamlines already have an
//    operator", for instance, only ever fires once enough operators are
//    already seated to cover every beamline, at which point beamMsg is
//    already null and this branch is a no-op).
// 2. Anyone else: the cross-profession mismatch shape described in this
//    file's header — substitute something that is actually about their own
//    work.
function reasonFor(member, beamMsg) {
  if (member.profession === 'operator' && beamMsg) return beamMsg;

  const raw = member.idleReason || 'Nothing to do right now.';
  if (!CROSS_PROFESSION_MISMATCH_RE.test(raw)) return raw;
  const profName = professionDef(member.profession)?.name || 'staff';
  return `No ${profName} work available right now.`;
}

/**
 * `{ idleCount, byReason, worst }` for every staffer currently without a
 * job. `byReason` is `[{ reason, count, members }]`, one entry per DISTINCT
 * reason text (post cross-profession correction — see this file's header),
 * sorted by impact: beam-blocking reasons first, then repair-stalling ones,
 * then everything else, ties broken by how many staff share the reason (the
 * bigger problem leads) and finally by the reason text itself (deterministic
 * output for identical input, no reliance on Map iteration order).
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
 * — a real cost, but a different one from "not working at all," and this
 * report's job is specifically the latter.
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
    // shared by an idle operator and an idle admin still counts as
    // beam-impact for ordering purposes, because it genuinely is for that
    // operator.
    const r = rankFor(m);
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

const PHASE_LABEL = { travel: 'travelling to', work: 'working at' };

// Friendly name for the station a member's job is anchored to, or null for
// a target-addressed job (repair/commission — no station, no seat) or a
// stale stationKey the index no longer resolves (station demolished out
// from under a travelling member — jobRunner.js's own tickJobs abandons
// those the next tick, but this can be read in the one-tick window before
// that happens).
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

/**
 * `{ status, station }` for one staffer, the inspector's per-staffer
 * summary: `status` is either "<Job name> — <travelling to/working at>" (job
 * held) or the same corrected idle-reason text facilityStaffingReport groups
 * by (no job); `station` is the friendly placeable name the job is anchored
 * to, or null when there isn't one (idle, or a target-addressed repair/
 * commission with no station of its own).
 */
export function describeJob(member, game) {
  const job = member.job;
  if (!job) {
    const state = game?.state || {};
    return { status: reasonFor(member, beamBlockedMessage(state)), station: null };
  }
  const jobDef = JOB_TYPES[job.jobType];
  const name = jobDef?.name || job.jobType;
  const phaseLabel = PHASE_LABEL[job.phase] || null;
  const status = phaseLabel ? `${name} — ${phaseLabel}` : name;
  return { status, station: stationLabel(member, game) };
}
