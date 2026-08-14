// src/game/staff/jobRunner.js — job assignment and the work state machine.
//
// Task 2 of the staff-professions-3 (jobs-and-gates) plan. Consumes Task 1's
// job board (src/game/staff/jobs.js: JOB_TYPES/buildJobOffers/eligibleFor)
// and Plan 2's station reservations (src/game/staff/stations.js) to actually
// put staff to work: assignJobs() hands out offers, tickJobs() advances
// whoever is already working, and abandonJob() is the one place every exit
// path — completion, interruption, demolition/destruction, path loss, firing,
// load — releases a held station. See abandonJob's own doc comment for why
// that matters more than it looks.
//
// Walking is NOT this module's problem. `member.job.phase` starts 'travel'
// on assignment and stays there until something reports arrival by writing
// `job.phase = 'work'` directly — in the running game that writer is the
// renderer (src/renderer3d/StaffPawns.js, Task 3 of this plan), which owns
// actual pawn motion and is the one place outside this module allowed to
// touch `job.phase`. tickJobs() only ever READS phase to decide whether to
// accrue work progress; it never advances travel itself. Headless callers
// (tests, or the game before Task 3 lands) that never flip phase simply
// leave a job parked in 'travel' — but tickJobs still re-checks a
// station-addressed travel job's route every tick and abandons it if the
// route disappears (a wall built after assignment, say) or if it's been
// travelling for too long regardless of why — see tickJobs' own doc comment.
// "Never walks anywhere" is not the same guarantee as "never needs to
// notice the walk became impossible."

import {
  JOB_TYPES, buildJobOffers, eligibleFor, footprintCellsOf, approachCandidates,
} from './jobs.js';
import { getStationIndex, findStation, reserveStation, releaseStation } from './stations.js';
import { getNavGrid, findPath, isReachable } from './nav.js';
import { countBeamlines } from '../utility-gate.js';

// --- Needs vs. work — the deadlock guard ----------------------------------
//
// staffSystem.js's tickStaffMember carries a scar comment: hunger used to
// RISE on break with no cafeteria, which made its own recovery condition
// unsatisfiable, so a staffer who ever went on break in a cafeteria-less
// facility could never return to 'working' and permanently tripped the
// beam. That transition (status -> 'onBreak') is deleted; eat/rest are now
// real jobs (JOB_TYPES.eat/rest, priority 1000/950 — see jobs.js's own
// comment on why that margin is numeric and unconditional, not "repair's
// urgency term happens to stay low"). The same trap re-opens here by a new
// route the moment travel is real: a hungry staffer with nowhere to walk
// must not sit there starving forever waiting for a cafeteria that will
// never be built. NEEDS_THRESHOLD / NO_STATION_RECOVERY_RATE below are the
// guard against that — see handleNeeds()'s doc comment.
// Exported for test-job-runner.js's arithmetic guard (see that test's own
// header): "a job must fit in one waking window" is expressed in terms of
// this threshold and staffSystem.js's FATIGUE_PER_TICK, so the guard reads
// the same numbers this module actually runs on rather than a copy that can
// drift.
export const NEEDS_THRESHOLD = 0.8;
// Balance fix round 2: slower than HUNGER_PER_TICK/FATIGUE_PER_TICK
// (staffSystem.js), not faster — the round-1 rates (0.02/0.05, the old
// cafeteria-less onBreak branch's own numbers) recovered FASTER than the
// need accrued, so an unserviced need settled into a slow oscillation just
// under NEEDS_THRESHOLD (measured: hovering around 0.795) — invisible to
// the player and, worse, no different from a serviced need for any purpose
// that reads the raw number. Net accrual while trickling is now POSITIVE
// (hunger +0.0033-0.002=+0.0013/tick, fatigue +0.005-0.002=+0.003/tick), so
// an unserviced need pegs at 1.0 and stays there — a visible, legible
// signal — instead of hiding just under the line. Nothing in the codebase
// blocks work on the raw need level (only STATUS gates assignment/ticking —
// see assignJobs/tickJobs), so this costs no employability by itself; see
// StaffMember.efficiency()'s own unservicedPenalty for the actual cost.
const NO_STATION_RECOVERY_RATE = { hunger: 0.002, fatigue: 0.002 };

// Whether every station offering `jobType` (a cafeteria seat, a rest slot)
// is currently held by someone else — as opposed to none existing at all.
// Balance fix round 3: tryTakeNeedJob's deadlock branch used to say "No
// reachable X" for BOTH cases alike, but they call for different player
// action — "build one" vs "build MORE, this one's just busy" — and the
// first message is flatly false in the second case. findStation (below)
// already filters out anyone-else's-reservation candidates before it ever
// ranks by distance, so it can't make this distinction on its own; this
// reads the raw station index instead, deliberately ignoring reachability
// (a station that's merely unreachable, not reserved, still isn't
// "contention" — the existing "No reachable X" wording is already accurate
// for that case).
function allReservedByOthers(state, jobType) {
  const refs = getStationIndex(state).byJob[jobType] || [];
  if (!refs.length) return false;
  const reservations = state.stationReservations || {};
  return refs.every(ref => !!reservations[ref.key]);
}

/**
 * One member's slice of assignJobs' needs pass: if `needKey` (hunger or
 * fatigue) is over threshold and the member isn't already on the matching
 * job, try to send them to one. Three outcomes:
 *   - already doing it: no-op, true (this need is "handled" for this pass —
 *     the caller must not also try the other need, a member can hold only
 *     one job).
 *   - a reachable eat/rest station exists: abandon whatever they were doing
 *     (even a non-interruptible repair/runBeam — needs outrank work
 *     UNCONDITIONALLY, not just usually) and take it. True.
 *   - no reachable station: THE DEADLOCK GUARD. Do not touch member.job —
 *     they keep whatever they were doing (or stay jobless, if they had
 *     nothing). Recover the need a little anyway, at the same flat rate the
 *     old cafeteria-less onBreak branch used, and say why in idleReason —
 *     naming CONTENTION ("every seat is taken — build more") when every
 *     existing station of this type is someone else's reservation, rather
 *     than the misleading "no reachable X" that used to fire even when a
 *     station genuinely exists, just busy (measured: 1.4% of productive
 *     staff-ticks in the round-2 throughput test's 10-staff facility ran
 *     penalised under a false "build one" message with every seat merely
 *     reserved). False, so the caller still gets a chance to try the OTHER
 *     need.
 */
function tryTakeNeedJob(member, game, jobType, needKey, missingLabel) {
  if (member.job?.jobType === jobType) return true;

  const state = game.state;
  const ref = findStation(state, { jobs: [jobType], fromNode: member.fromNode || null, staffId: member.id });
  if (ref && reserveStation(state, ref.key, member.id)) {
    if (member.job) {
      // Park the bumped job's progress before abandonJob zeroes it out —
      // see StaffMember's own doc comment on parkedJob for the full
      // consume-or-discard contract assignOffer applies on the other end.
      // Only real work jobs are worth parking; eat/rest have nothing to
      // resume (bumping one need job for the other only happens when a
      // reachable station exists for both, and there's no "meal in
      // progress" worth remembering either way).
      if (member.job.jobType !== 'eat' && member.job.jobType !== 'rest') {
        member.parkedJob = {
          jobType: member.job.jobType,
          progress: member.job.progress,
          target: member.job.target || null,
        };
      }
      abandonJob(member, game, null);
    }
    member.job = {
      jobType, target: null, specialty: null, stationKey: ref.key, destNode: ref.node,
      phase: 'travel', progress: 0,
    };
    member.idleReason = null;
    return true;
  }

  member.idleReason = allReservedByOthers(state, jobType)
    ? `Every ${missingLabel} is taken — build more.`
    : `No reachable ${missingLabel} — recovering slowly while working.`;
  member.needs[needKey] = Math.max(0, member.needs[needKey] - NO_STATION_RECOVERY_RATE[needKey]);
  // Balance fix round 2: the deadlock guard engaging AT ALL — not the raw
  // need value, which pegs at 1.0 either way now (see NO_STATION_RECOVERY_
  // RATE above) and so can't itself carry any graduated signal — flags this
  // member as running an unserviced need. StaffMember.efficiency() reads
  // this flag for a flat ×0.6 work-rate penalty (see its own comment for
  // why a STATE flag rather than a function of the need's magnitude: a
  // magnitude-based penalty only has ~2.5:1 leverage over a full cycle,
  // because a serviced staffer passes through the same low-need band every
  // time too). Cleared only by a completed eat/rest job (registered at the
  // bottom of this file) — not by the need dropping back under threshold on
  // its own, which the trickle above no longer does anyway.
  member.unservicedPenalty = true;
  return false;
}

/**
 * Needs pass for one member, run unconditionally before normal assignment
 * (see assignJobs) — unconditionally meaning regardless of what job (if
 * any) they hold, including a repair or runBeam job whose own JOB_TYPES
 * entry says `interruptible: false`. That flag governs one WORK job
 * bumping another; it says nothing about needs, which this task's brief is
 * explicit outrank work numerically and without exception. (assignJobs
 * itself still gates WHICH members reach this function on
 * `status === 'working'` — a member mid stress-breakdown ['resting']
 * already recovers both needs for free via staffSystem.js's own resting
 * branch and must not also queue ahead of a working member for the one
 * cafeteria seat.)
 *
 * Any leftover idleReason from a PAST tick's deadlock-guard fallback (see
 * below) is cleared first whenever the member currently holds a job — the
 * only way idleReason can be non-null while job != null is this function's
 * own fallback branch, so once neither need is over threshold anymore
 * there is nothing left to explain and a stale "No reachable cafeteria…"
 * must not sit there forever just because nothing else ever clears it.
 *
 * Hunger is checked before fatigue (eat's 1000 > rest's 950). Once hunger
 * lands (or already holds) the 'eat' job, fatigue does NOT get skipped
 * outright — a member can hold only one job, so fatigue can't ALSO get a
 * real job this pass, but it still gets the same flat cafeteria-less-
 * equivalent trickle the deadlock guard uses. Skipping it entirely was a
 * real bug: a routine ~90-tick meal left fatigue climbing/pegged at 1.0 the
 * whole time — this comment used to go on to say utility-gate.js rejects any
 * operator above fatigue 0.85, but no such check exists there anymore (see
 * that module's own operatorCoverage, which filters only on
 * status/job.jobType/job.phase); the near-50%-duty-cycle framing is stale
 * along with it. Fatigue getting no attention for a whole meal was the real
 * bug regardless of which downstream consumer would have cared. A need
 * that hits the DEADLOCK GUARD proper (no station reachable at all) still
 * gets its own full idleReason/recovery via tryTakeNeedJob, same as before.
 *
 * When BOTH needs hit the deadlock guard the same pass, hunger's message
 * wins (see the hungerDeadlockReason capture below) — matching this
 * function's own "hunger checked before fatigue" precedence rather than
 * leaving it to an accident of call order. Without that, rest's
 * tryTakeNeedJob call always runs last and unconditionally overwrites
 * idleReason with its own message, permanently hiding "no cafeteria" the
 * moment both needs are simultaneously unserviced — which balance fix
 * round 2 made routine: an unserviced need now pegs at 1.0 and stays there
 * (NO_STATION_RECOVERY_RATE's own comment) instead of oscillating just
 * under NEEDS_THRESHOLD, so two needs that cross their own thresholds at
 * different ticks stay BOTH true together for the rest of the run, not
 * just in the rare tick they happen to line up.
 */
function handleNeeds(member, game) {
  if (member.job != null) member.idleReason = null;

  const hungry = (member.needs?.hunger ?? 0) > NEEDS_THRESHOLD;
  const tired = (member.needs?.fatigue ?? 0) > NEEDS_THRESHOLD;
  if (!hungry && !tired) return;

  let jobLanded = false;
  let hungerDeadlockReason = null;
  if (hungry) {
    jobLanded = tryTakeNeedJob(member, game, 'eat', 'hunger', 'cafeteria');
    if (!jobLanded) hungerDeadlockReason = member.idleReason;
  }

  if (tired) {
    if (jobLanded) {
      // fatigue is still genuinely unserviced here (only the trickle, not a
      // real rest job — a member can hold only one job and hunger already
      // took it) — same unservicedPenalty this pass would get from
      // tryTakeNeedJob's own deadlock branch, even though this particular
      // trickle is applied inline rather than by calling that function.
      member.unservicedPenalty = true;
      member.needs.fatigue = Math.max(0, member.needs.fatigue - NO_STATION_RECOVERY_RATE.fatigue);
    } else {
      const fatigueLanded = tryTakeNeedJob(member, game, 'rest', 'fatigue', 'rest station');
      if (!fatigueLanded && hungerDeadlockReason) member.idleReason = hungerDeadlockReason;
    }
  }
}

// --- Assignment-time caps --------------------------------------------------
//
// Two job types are capped at assignment time rather than by the board,
// because the board has no notion of "who's asking" and capping in its own
// (arbitrary) offer order would throw away the nearest option before the
// assigner ever saw it:
//   - runBeam: at most one operator per beamline this facility HAS (see
//     beamlineCount — calls utility-gate.js's exported countBeamlines(state)
//     directly, rather than deriving a second count off the registry). This
//     USED to filter the registry to status === 'running' — "a registered-
//     but-stopped beamline doesn't need continuous operator attention" —
//     but that directly contradicted utility-gate.js's operatorCoverage
//     (staff-professions-3 Task 4), which requires coverage for every
//     isSource placeable regardless of run status. With the two disagreeing,
//     stopping ONE line among several (a redesign, or a line built and never
//     started) shrank this cap out from under an already-seated operator,
//     the board refused to reseat them ("All N beamlines already have an
//     operator" — true of the cap, false of the roster) and the STILL-
//     RUNNING lines went dark with the only on-screen advice (hire/promote)
//     doing nothing, because hiring was never the bottleneck.
//     Fix-round-1 first matched the two counts independently (both landed on
//     "one per registered beamline", since `_ensureBeamlineForSourcePlaceable`
//     keeps one registry entry per isSource placeable 1:1 today) — but two
//     implementations of one rule is exactly the shape of bug the gate
//     exists to close, and they'd only ever agreed by convention. Fix-
//     round-2 makes it one implementation: this cap calls the gate's own
//     countBeamlines(state), so if that correspondence ever breaks (e.g.
//     Game.js:3355's `_removeBeamlineForSourcePlaceable`, currently dead
//     code with no caller — not this task's to fix), the cap and the gate
//     degrade IDENTICALLY instead of drifting apart. Seating an operator
//     against a beamline the moment it's BUILT (not only once it's running)
//     is also what makes a beamline startable from cold at all — no
//     operator job without a running beamline, no running beamline without
//     an operator job, otherwise. The board still offers one slot per free
//     CONSOLE, which can outnumber (or undernumber) this count.
//   - repair: at most one technician per SPARE currently in inventory.
//     repairOffers (jobs.js) reads state.resources.spares once per board
//     scan and suppresses ALL repair offers only when spares is exactly
//     zero — with, say, 1 spare and 10 damaged components it emits all 10
//     offers, because the board can't know how many technicians are about
//     to be dispatched against that 1 spare. Uncapped, this assigns up to
//     10 technicians to a job only one of them can actually complete.
//     Counted directly off `member.job.jobType`, unlike runBeam's station
//     reservation shortcut: repair/commission are target-addressed (no
//     StationRef, no reservation — see jobs.js's header comment) so there
//     is no reservation table to count holders from.
function beamlineCount(game) {
  return countBeamlines(game.state);
}

function capsFor(game) {
  return {
    runBeam: beamlineCount(game),
    repair: game.state.resources?.spares ?? 0,
  };
}

function currentHolders(members) {
  return {
    runBeam: members.filter(m => m.job?.jobType === 'runBeam').length,
    repair: members.filter(m => m.job?.jobType === 'repair').length,
  };
}

// Task 5 (staff-professions-3, jobs-and-gates) fix for a real bug review
// found live: the repair cap above counts HOW MANY technicians hold a
// repair job, not WHICH damaged component each one is working. With 2
// spares and 2 damaged components, nothing stopped two technicians from
// both being routed to the SAME node — repairOffers (jobs.js) emits one
// offer per damaged node, and that one offer object is reused, unmutated,
// across every member's pickBestOffer call this pass, so a second member
// processed after the first already took it saw the identical offer, still
// eligible (eligibleFor has no notion of "someone already has this exact
// target's job" — that check exists for STATION-addressed offers via
// stationReservations, but repair/commission are target-addressed with no
// reservation table at all — see stations.js's own header). The result:
// both complete, double-consuming a spare and double-healing a component
// that's already at 100%, while some OTHER damaged node never gets offered
// to anyone.
//
// The fix mirrors currentHolders' own shape: a set of "already spoken for"
// targets, seeded from every member's CURRENT job before this pass starts,
// and grown in lockstep with holders as assignJobs hands out new ones (see
// its own call site) — so a target claimed within THIS pass is excluded
// from the very next member's offer just as reliably as one claimed on a
// prior tick.
function targetKey(target) {
  return target ? `${target.beamlineId}::${target.nodeId}` : null;
}

function claimedRepairTargets(members) {
  const set = new Set();
  for (const m of members) {
    if (m.job?.jobType === 'repair' && m.job.target) set.add(targetKey(m.job.target));
  }
  return set;
}

function capShortageReason(jobType, cap) {
  if (jobType === 'runBeam') {
    return cap > 0
      ? `All ${cap} beamline${cap === 1 ? '' : 's'} already ${cap === 1 ? 'has' : 'have'} an operator.`
      : 'No beamlines to operate yet.';
  }
  // repair
  return 'No spares left to repair with; a machinist can make more.';
}

// --- Offer selection --------------------------------------------------------
//
// `offers` (from buildJobOffers) is sorted by descending priority, but many
// offers of the SAME job type share the exact same priority (every free
// console, every free lab bench of one type — see jobs.js's
// plainStationOffers/runBeamOffers, whose per-offer priority is just the
// job type's constant basePriority). eligibleFor gates on connectivity, not
// distance — a technician across the map from a reachable node is still
// `ok: true` — so picking the first eligible offer in board order would
// happily send an operator across the whole facility past a console right
// next to them. Ties are broken by real path length whenever the member's
// position is known.
//
// A full findPath per candidate is NOT affordable here: this runs inside
// Game.tick(), once per idle member, and a tier can be dozens of slots wide
// (measured: 803 ms/tick with 12 idle engineers against 40 free labWork
// benches on a 60x40 facility, ~86 ms just for ONE member's own scan).
// stations.js's own findStation solves the identical problem — nearest
// reachable slot out of many — by sorting on cheap SUBTILE distance first
// and only paying for real reachability on the front of that list; this
// mirrors it: sort the tier by subtile distance, then run findPath on only
// the closest PATH_TIEBREAK_CANDIDATES of them.
//
// The optimality guarantee this buys back is real but narrow: it holds only
// AMONG THOSE TOP-K raw-distance candidates, not against the whole tier. A
// station whose real walking path is materially shorter — because its
// detour around a wall is shorter, not because it's raw-distance-closer —
// can sit outside the top-K window and never get pathed at all, so it can
// never win the tie-break even though it's the actually-better choice.
// Reviewer-built worst case: three stations sharing one enclosed pocket
// whose only door is at the far end, where the true optimum (path length
// 59) sat outside the K=3 window and the truncated search picked a path of
// length 231 instead — 3.9x longer. Ruling: keep the truncation anyway —
// 19 ms/tick against the untruncated 606 ms is decisive, and it's the same
// shape stations.js's own findStation already accepts — but the next person
// tuning PATH_TIEBREAK_CANDIDATES up or down should know that's the actual
// trade being made, not "ties are broken correctly, just capped for cost."
const PATH_TIEBREAK_CANDIDATES = 3;

function subtileDist2(a, b) {
  const dCol = (a.col * 4 + a.subCol) - (b.col * 4 + b.subCol);
  const dRow = (a.row * 4 + a.subRow) - (b.row * 4 + b.subRow);
  return dCol * dCol + dRow * dRow;
}

// Offers with no resolvable station (repair/commission targets — no
// StationRef, see jobs.js's header comment) fall back to board order within
// their tier. jobs.js now exports approachCandidates (see resolveDestNode,
// below) so a real distance tie-break across a target-addressed tier is no
// longer structurally blocked the way it was when this comment was
// written — but extending THIS tie-break to use it is a separate change
// from resolving a walkable destination at all (this round's actual fix)
// and is left for whoever next touches offer ranking.
function pickNearestInTier(member, tier, state) {
  if (tier.length <= 1 || !member.fromNode) return tier[0];
  const index = getStationIndex(state);
  const withNode = [];
  for (const offer of tier) {
    const ref = offer.stationKey ? index.byKey[offer.stationKey] : null;
    if (ref) withNode.push({ offer, node: ref.node });
  }
  if (!withNode.length) return tier[0];

  withNode.sort((a, b) => subtileDist2(member.fromNode, a.node) - subtileDist2(member.fromNode, b.node));
  const candidates = withNode.slice(0, PATH_TIEBREAK_CANDIDATES);

  const nav = getNavGrid(state);
  let best = candidates[0].offer;
  let bestLen = Infinity;
  for (const { offer, node } of candidates) {
    const path = findPath(nav, member.fromNode, node);
    const len = path ? path.length : Infinity;
    if (len < bestLen) { bestLen = len; best = offer; }
  }
  return best;
}

/**
 * The best offer `member` may take right now, honoring eligibleFor's
 * rejections and the runBeam/repair caps, or `{ offer: null, reason,
 * fallbackReason }` when nothing qualifies — see the two-reason explanation
 * below for why those are two separate fields rather than one. (assignJobs,
 * the only caller, folds in a THIRD source — the board's suppressions
 * channel — between them; this function knows nothing about suppressions
 * at all, since a suppressed offer never reaches it in the first place.)
 *
 * Three checks run per offer, cheapest/most-fundamental first:
 *
 * 1. Profession: is `member.profession` even in this job type's list at
 *    all? A member who fails this was never a real candidate for that job
 *    type regardless of anything else — this is `fallbackReason` territory
 *    (see below), and eligibleFor is only called for the message text, not
 *    to gate anything.
 * 2. The assignment-time cap (runBeam/repair — see capsFor): a job-TYPE-
 *    level constraint, checked before any individual offer's own
 *    eligibleFor call. This has to run before step 3, not after: with two
 *    free consoles and a 1-beamline cap, the FIRST operator processed this
 *    pass reserves one console; when the SECOND operator's scan reaches
 *    that now-reserved console, eligibleFor correctly reports "someone
 *    else is already working that station" — true, but a misleading
 *    ARTIFACT of processing order within this one pass, not the real
 *    reason (the real reason is the cap, which the SECOND free console
 *    would also hit). Checking the cap first means every offer of a capped
 *    job type reports the SAME, actually-informative reason once the cap
 *    is reached, regardless of which specific station a sibling member
 *    happened to grab first.
 * 3. eligibleFor itself: profession/skill already covered by step 1, so in
 *    practice this is the station-specific reservation/reachability check.
 *
 * `reason` is not simply "the first rejection seen in priority order"
 * either. Offers are sorted by priority across ALL job types, so a
 * technician-only repair offer can sort above an operator's own runBeam
 * offer; reporting repair's "needs a Technician" rejection to a capped-out
 * OPERATOR is true but useless — that offer was never relevant to their
 * profession at all (measured: an admin and a scientist were both once
 * told "No spares left to repair with", a job neither can ever hold). Two
 * reasons are tracked and returned separately (as `reason` /
 * `fallbackReason`): `reason` (internally `bestReason`), from an offer
 * whose job type `member`'s profession can actually do; `fallbackReason`, a
 * hard profession mismatch on a job this member could never take. The
 * caller decides how to weigh `fallbackReason` against other signals (see
 * assignJobs) — this function only ever prefers `reason` over it, never the
 * reverse.
 */
function pickBestOffer(member, offers, game, caps, holders, claimedTargets) {
  const state = game.state;
  let bestReason = null;
  let fallbackReason = null;
  let i = 0;
  while (i < offers.length) {
    const priority = offers[i].priority;
    const tier = [];
    while (i < offers.length && offers[i].priority === priority) {
      const offer = offers[i];
      i++;
      const professionOk = !!JOB_TYPES[offer.jobType]?.professions?.includes(member.profession);
      if (!professionOk) {
        if (fallbackReason == null) fallbackReason = eligibleFor(member, offer, game).reason;
        continue;
      }

      const cap = caps[offer.jobType];
      if (cap != null && holders[offer.jobType] >= cap) {
        if (bestReason == null) bestReason = capShortageReason(offer.jobType, cap);
        continue;
      }

      // See claimedRepairTargets' own header for the bug this closes: a
      // repair offer is one per damaged NODE, reused unmutated across every
      // member's scan this pass, so without this a second technician could
      // take the identical target a first technician (this pass or a prior
      // one) already holds.
      if (offer.jobType === 'repair' && offer.target && claimedTargets?.has(targetKey(offer.target))) {
        if (bestReason == null) bestReason = 'Someone else is already repairing that component.';
        continue;
      }

      const res = eligibleFor(member, offer, game);
      if (!res.ok) { if (bestReason == null) bestReason = res.reason; continue; }

      tier.push(offer);
    }
    if (tier.length) return { offer: pickNearestInTier(member, tier, state), reason: null, fallbackReason: null };
  }
  return { offer: null, reason: bestReason, fallbackReason };
}

// The suppressions channel (buildJobOffers' second return value) covers a
// gap `pickBestOffer` structurally cannot: a job.js pre-filter (today, only
// repair's "spares === 0") means the offer never enters `offers` at all, so
// there is nothing for pickBestOffer to reject and nothing for it to report
// — a technician facing a fully-suppressed repair board got "Nothing to do
// right now.", a useless message when the real, actionable answer is "no
// spares — build a machine shop". Reused for any member whose profession
// can do the suppressed job type, same professionOk test pickBestOffer uses
// for its own bestReason/fallbackReason split.
function suppressionReasonFor(member, suppressions) {
  for (const s of suppressions) {
    if (JOB_TYPES[s.jobType]?.professions?.includes(member.profession)) return s.reason;
  }
  return null;
}

// --- Destination resolution -------------------------------------------------
//
// StaffPawns.js (Task 3, this fix round) no longer branches on jobType at
// all: every job, station- or target-addressed, is walked to via
// member.job.destNode alone — the same unification StationRef.node already
// gave the seated-vs-standing case (one field, no special-casing at the
// call site). This resolves destNode ONCE, here, at assignment time, and
// caches it on the job:
//   - station-addressed (offer.stationKey set — runBeam/labWork/eat/rest/
//     etc): the StationRef's own node. Exactly what the renderer used to
//     re-resolve itself on every render frame via getStationIndex; hoisting
//     it here means one lookup at assignment instead of one per frame for
//     the whole walk.
//   - target-addressed (offer.target set — repair/commission, no
//     StationRef; see jobs.js's header comment): the nearest REACHABLE
//     subtile immediately outside the target placeable's real footprint,
//     via jobs.js's own (now-exported) approachCandidates — the same
//     wall-aware perimeter walk repairOffers/eligibleFor already use to
//     decide reachability, reused rather than reimplemented so "can this
//     technician reach it" and "where do they stand" can never drift apart.
//     Before this, a repair/commission job had NO resolvable destination at
//     all: StaffPawns had nothing to walk to, the pawn held position
//     forever, and jobRunner's own travel-budget backstop eventually
//     abandoned the job with "Gave up trying to get there." — only for
//     assignJobs to immediately re-offer the identical job next pass. Real
//     repairs could not complete.

// Mirrors jobs.js's own (unexported) resolveTarget — a target-addressed
// job's `{beamlineId, nodeId}` back to the live placeable it addresses.
// Duplicated rather than imported: this round's jobs.js diff is scoped to
// exporting the perimeter-walk helper, not restructuring its internals, and
// jobStillValid (below) already duplicates the same lookup for the same
// reason.
function resolveTargetPlaceable(game, target) {
  const state = game.state;
  const idx = state.placeableIndex?.[target.nodeId];
  return idx !== undefined ? state.placeables?.[idx]
    : (state.placeables || []).find(p => p.id === target.nodeId);
}

/**
 * The best approach node for `member` to work `candidates` from, or null.
 * Mirrors pickNearestInTier's own truncated distance-then-path approach
 * (see that function's header for the accepted trade-off) rather than
 * inventing a second tie-break shape — sort by cheap subtile distance, pay
 * for a real findPath only on the closest PATH_TIEBREAK_CANDIDATES.
 *
 * Falls back to a full isReachable scan (O(1) per candidate — the
 * connected-component check, not a search) when that truncated window
 * misses: eligibleFor already confirmed, via the identical
 * approachCandidates + isReachable pair over the identical footprint, that
 * SOME candidate is reachable before this offer could ever reach
 * pickBestOffer as eligible — so this only returns null when member.fromNode
 * is unknown and there are zero candidates at all (never for an offer
 * eligibleFor actually approved).
 */
function nearestApproachNode(member, nav, candidates) {
  if (!candidates.length) return null;
  const from = member.fromNode;
  if (!from) return candidates[0];

  const sorted = candidates.slice().sort((a, b) => subtileDist2(from, a) - subtileDist2(from, b));
  const top = sorted.slice(0, PATH_TIEBREAK_CANDIDATES);

  let best = null;
  let bestLen = Infinity;
  for (const node of top) {
    const path = findPath(nav, from, node);
    if (path && path.length < bestLen) { bestLen = path.length; best = node; }
  }
  if (best) return best;
  return sorted.find(n => isReachable(nav, from, n)) || null;
}

/**
 * `offer`'s destination node — see this section's header. null only when a
 * target's placeable/footprint can't be resolved at all (should not happen
 * for a live offer buildJobOffers just produced this same tick) or, for a
 * target job specifically, when member.fromNode is known but genuinely
 * nothing is reachable (should not happen for an offer eligibleFor already
 * approved — see nearestApproachNode). assignJobs treats null defensively
 * rather than ever half-assigning a job with nowhere to walk.
 */
function resolveDestNode(game, member, offer) {
  const state = game.state;
  if (offer.stationKey) {
    return getStationIndex(state).byKey[offer.stationKey]?.node || null;
  }
  if (offer.target) {
    const placeable = resolveTargetPlaceable(game, offer.target);
    if (!placeable) return null;
    const cells = footprintCellsOf(placeable);
    if (!cells.length) return null;
    const nav = getNavGrid(state);
    const candidates = approachCandidates(nav, state, cells);
    return nearestApproachNode(member, nav, candidates);
  }
  return null;
}

// Whether `parked` (member.parkedJob) describes the SAME piece of work
// `offer` is about to (re)assign — same job type, and for a target-addressed
// job (repair/commission — parked.target set), the identical target too, so
// resuming never silently reattaches an old technician's progress to a
// different damaged component. Station-addressed jobs carry no target at
// all (parked.target is null and so is offer.target), so they match on job
// type alone — this is what makes "the staffer may return to a different
// desk" true: progress is parked per MEMBER, never per station.
function parkedProgressMatches(parked, offer) {
  if (!parked || parked.jobType !== offer.jobType) return false;
  if (parked.target) {
    return !!offer.target
      && offer.target.beamlineId === parked.target.beamlineId
      && offer.target.nodeId === parked.target.nodeId;
  }
  return !offer.target;
}

function assignOffer(member, game, offer, destNode) {
  if (offer.stationKey) reserveStation(game.state, offer.stationKey, member.id);

  // Consume-or-discard: this assignment is the one and only chance a parked
  // entry gets to be resumed. A match restores its progress; anything else
  // — a genuinely different job type, or the same job type against a
  // different (or now-demolished) target — discards it right here rather
  // than leaving it to linger and possibly reattach to some unrelated later
  // job of the same type. That also means parked progress survives at most
  // ONE need pre-emption in a row before either being spent or thrown away,
  // never accumulating across several.
  let progress = 0;
  if (member.parkedJob) {
    if (parkedProgressMatches(member.parkedJob, offer)) progress = member.parkedJob.progress;
    member.parkedJob = null;
  }

  member.job = {
    jobType: offer.jobType,
    target: offer.target,
    specialty: offer.specialty,
    stationKey: offer.stationKey,
    destNode,
    phase: 'travel',
    progress,
  };
  member.idleReason = null;
}

function statusIdleReason(status) {
  if (status === 'resting') return 'Resting after a stress breakdown.';
  return 'Not currently working.';
}

/**
 * One assignment pass: every idle, working staffer takes the best offer
 * they're eligible for. See handleNeeds/pickBestOffer for the two pieces
 * that make this more than "take the first thing" — need-driven
 * preemption, and the runBeam/repair caps.
 *
 * handleNeeds only runs for members with `status === 'working'` — a
 * member `'resting'` off a stress breakdown already recovers both needs
 * for free via staffSystem.js's own resting branch and must not ALSO queue
 * ahead of a genuinely working, genuinely hungry member for the one
 * cafeteria seat in the building.
 *
 * Every member ends this call with EITHER a non-null `job` OR a non-empty
 * `idleReason` — the brief's own explicit test — including staffers this
 * pass never even looks at (status !== 'working': resting from a
 * breakdown, or any other non-working status), so nobody is silently left
 * with a stale/blank idleReason from before.
 *
 * idleReason precedence for a member left without a job (most to least
 * specific): `pickBestOffer`'s own `bestReason` (a profession-relevant
 * rejection — a cap, an unreachable/reserved station); the board's
 * suppression reason for a profession-relevant job type the member never
 * even got to reject, because jobs.js filtered it out before it became an
 * offer at all (today, only repair with spares === 0 — see
 * suppressionReasonFor); `pickBestOffer`'s `fallbackReason` (a hard
 * profession mismatch on a job this member could never take, used only
 * when nothing profession-relevant turned up anywhere); whatever handleNeeds
 * already set this pass; and only then the generic fallback.
 */
export function assignJobs(game) {
  const state = game.state;
  const members = state.staffMembers || [];
  if (!members.length) return;

  for (const member of members) {
    if (member.status === 'working') handleNeeds(member, game);
  }

  const { offers, suppressions } = buildJobOffers(game);
  const caps = capsFor(game);
  const holders = currentHolders(members);
  const claimedTargets = claimedRepairTargets(members);

  for (const member of members) {
    if (member.job != null) continue;
    if (member.status !== 'working') {
      if (!member.idleReason) member.idleReason = statusIdleReason(member.status);
      continue;
    }

    const { offer, reason, fallbackReason } = pickBestOffer(member, offers, game, caps, holders, claimedTargets);
    if (offer) {
      // resolveDestNode should not come back null here — eligibleFor
      // already confirmed a reachable destination exists for this exact
      // offer (see resolveDestNode's own doc comment) — but a job is never
      // handed out with nowhere to walk, so this is a defensive floor, not
      // the expected path.
      const destNode = resolveDestNode(game, member, offer);
      if (destNode) {
        assignOffer(member, game, offer, destNode);
        if (holders[offer.jobType] != null) holders[offer.jobType]++;
        if (offer.jobType === 'repair' && offer.target) claimedTargets.add(targetKey(offer.target));
      } else {
        member.idleReason = member.idleReason || 'Could not find anywhere to stand for that job.';
      }
    } else {
      member.idleReason = reason
        || suppressionReasonFor(member, suppressions)
        || fallbackReason
        || member.idleReason
        || 'Nothing to do right now.';
    }
  }
}

// --- Ticking an active job --------------------------------------------------

function zoneTierFor(state, member) {
  const zoneId = member.assignment?.zoneId;
  if (!zoneId) return 0;
  return state.zoneConnectivity?.[zoneId]?.tier || 0;
}

// Whether `job`'s station/target still resolves against the live world.
// getStationIndex already prunes state.stationReservations of dead keys on
// every rebuild (stations.js), but that only cleans the reservation table —
// member.job.stationKey itself is a plain string that keeps pointing at a
// key nobody indexes anymore once the station's placeable is demolished.
// Target-addressed jobs (repair/commission) have no reservation at all, so
// their own staleness has to be checked directly: the beamline still
// registered, and the specific placeable id still present. This mirrors
// jobs.js's own (unexported) resolveTarget — duplicated rather than
// imported, since jobs.js is off-limits to this task (see task-2-brief.md)
// and the check is small.
function jobStillValid(game, job) {
  const state = game.state;
  if (job.stationKey) return !!getStationIndex(state).byKey[job.stationKey];
  if (job.target) {
    const beamlineLive = (game.registry?.getAll?.() || []).some(e => e.id === job.target.beamlineId);
    if (!beamlineLive) return false;
    const idx = state.placeableIndex?.[job.target.nodeId];
    const placeable = idx !== undefined ? state.placeables?.[idx]
      : (state.placeables || []).find(p => p.id === job.target.nodeId);
    return !!placeable;
  }
  return true;
}

function invalidJobReason(job) {
  return job.stationKey ? 'The station was removed.' : 'That job no longer exists.';
}

// The live subtile node a station-addressed job's member is walking toward,
// or null for a target-addressed job (repair/commission — see this file's
// header on why those have no resolvable outside-footprint node here). Used
// only for the live "did the route disappear" re-check below, never for
// eligibility (that's eligibleFor's job at assignment time).
function currentStationNode(state, job) {
  if (!job.stationKey) return null;
  return getStationIndex(state).byKey[job.stationKey]?.node || null;
}

// --- Travel budget (fix-round-2) --------------------------------------------
//
// A flat tick-count backstop is wrong on two independent, compounding axes,
// found live in review: sim ticks fire every TICK_MS/state.speed ms
// (Game.js), so MORE ticks elapse per real second at higher game speed —
// while pawn walking is driven by real wall-clock dt (ThreeRenderer.js),
// entirely independent of state.speed. A fixed tick budget therefore covers
// FEWER real seconds — and so fewer walkable subtiles — the faster the game
// runs: 300 ticks was ~10% headroom over a measured 487-subtile
// corner-to-corner walk on the default 61x61 map at 1x, already fired at
// 2x, fired badly at 4x, and had no headroom left at all against a grown
// map even at 1x. The failure mode is an infinite loop, not just a stuck
// pawn: abandon mid-walk releases the reservation, the very next assignJobs
// reassigns the identical job, and the member never arrives — dropping and
// retaking the reservation every cycle forever.
//
// The fix budgets by DISTANCE, which is both speed- and map-size-invariant
// (unlike a tick count, which is neither): convert the job's own real path
// length (in subtiles, via findPath — not a universal guess) into however
// many ticks the SLOWEST pawn needs to walk it AT THE CURRENT GAME SPEED,
// times a generous safety factor, with a floor for trivially short hops.
// Computed ONCE, lazily, the first tick a job is seen in 'travel' (cached on
// job.travelBudgetTicks) — not every tick, which would mean a findPath call
// per traveling member per tick, the exact cost problem pickNearestInTier
// (above) already had to solve for a different call site.
//
// SUBTILE_UNIT/SLOWEST_PAWN_SPEED are duplicated from StaffPawns.js's own
// SUB_UNIT/WALK_SPEED_MIN rather than imported — that file is a renderer
// module referencing the THREE global, which this headless file must not
// pull in. Keep these two numbers in sync if that file's walk speed ever
// changes.
const SUBTILE_UNIT = 0.5;          // world units per subtile (nav.js's convention)
const SLOWEST_PAWN_SPEED = 0.9;    // world units/sec — StaffPawns.js's WALK_SPEED_MIN
const TRAVEL_BUDGET_SAFETY = 2;    // generous multiplier over the bare "just enough" figure
const MIN_TRAVEL_BUDGET_TICKS = 60; // floor: even a one-subtile hop gets a fair few ticks
const VALID_SPEEDS = [1, 2, 4];    // Game.js's setSpeed()'s own allowed values

// Worst-case cross-map subtile distance, used when a real path length can't
// be computed yet — no member.fromNode (no pawn has reported a position:
// true of every job the instant it's assigned, before that member's own
// pawn has rendered even one frame) or no node at all (should not happen
// post-destNode-unification: jobRunner never hands out a job without a
// resolved destNode — see resolveDestNode — but this stays a defensive
// fallback rather than a `node` non-null assumption). A Manhattan
// corner-to-corner walk of the whole nav grid on both axes; scales with
// state.mapHalfExtent so a grown map gets a correspondingly larger (never
// tighter) budget.
function worstCaseMapSubtiles(state) {
  const half = Number.isFinite(state.mapHalfExtent) ? state.mapHalfExtent : 30;
  return (half * 2 + 1) * 4 * 2;
}

// game.state.speed, clamped to a known value — the same fallback
// ticksPerSubtile uses, and also what tickJobs compares job.travelBudgetSpeed
// against to decide whether a budget needs recomputing (see fix-round-3
// below).
function normalizedSpeed(game) {
  return VALID_SPEEDS.includes(game.state.speed) ? game.state.speed : 1;
}

// Real seconds to cover one subtile at the slowest pawn speed, converted to
// SIM ticks at the game's current speed multiplier — the exact conversion
// that makes the old flat constant wrong (see this section's header).
function ticksPerSubtile(game) {
  return (SUBTILE_UNIT / SLOWEST_PAWN_SPEED) * normalizedSpeed(game);
}

function computeTravelBudget(game, member, node) {
  const state = game.state;
  let subtiles;
  if (node && member.fromNode) {
    const nav = getNavGrid(state);
    const path = findPath(nav, member.fromNode, node);
    subtiles = path ? path.length : worstCaseMapSubtiles(state);
  } else {
    subtiles = worstCaseMapSubtiles(state);
  }
  return Math.max(MIN_TRAVEL_BUDGET_TICKS, Math.ceil(subtiles * ticksPerSubtile(game) * TRAVEL_BUDGET_SAFETY));
}

// fix-round-3: TRAVEL_BUDGET_SAFETY (2x) covers a speed increase up to
// double whatever the budget was last computed at, but VALID_SPEEDS is
// [1, 2, 4] — a 1x -> 4x jump mid-journey is exactly the uncovered case,
// and a lone speed-up is a completely ordinary player action mid-walk, not
// an edge case. Reproduced live: a job budgeted at 1x and then switched to
// 4x got abandoned once ("Gave up trying to get there."), dropped its
// reservation, and completed fine on reassignment with a freshly computed
// (correct) budget — bounded and self-healing, never the original bug's
// infinite loop, but a visible, avoidable stumble.
//
// Fixed by tracking the speed a budget was computed AT (job.travelBudgetSpeed)
// alongside the budget itself, and recomputing whenever the CURRENT speed
// exceeds it — see the call site in tickJobs. Deliberately NOT fixed by
// raising TRAVEL_BUDGET_SAFETY to 4x instead: that's a blanket change that
// also blunts what the backstop exists for — a genuinely stuck job would
// then take twice as long (543 -> ~1086 ticks at the worst-case-map figure)
// to be caught. This fix is scoped to the one case that actually needs it.
function needsBudgetRecompute(job, speedNow) {
  return job.travelBudgetTicks == null || speedNow > job.travelBudgetSpeed;
}

/**
 * Advance every member's job by one tick.
 *
 * Every member with a job is first checked for staleness (target/station
 * demolished mid-job) — this IS the "target demolition" exit path the
 * brief calls out; there is no separate hook on the demolish call site,
 * because re-checking here every tick is simpler than threading an
 * abandon-on-remove callback through every place a placeable can vanish
 * (direct demolish, undo, load, a beamline getting deleted out from under
 * a repair target) and it's exactly one O(1) index lookup per active job.
 *
 * A `phase: 'travel'` job is not walked here — see this file's header
 * comment, that's the renderer's job — but it IS re-checked for whether
 * the route there still exists, which is a DIFFERENT failure from
 * demolition: an ordinary build action (a wall, a new placeable) can seal
 * off a reachable station without ever touching the station itself, and
 * neither jobStillValid (existence) nor anything else was catching that.
 * Left unchecked, a job stuck mid-travel to a now-unreachable station was
 * never abandoned by ANY of this module's three guards — not tickJobs (only
 * checked phase === 'work'), not assignJobs (`member.job != null` skips
 * it), not handleNeeds (short-circuits once `member.job?.jobType` already
 * matches the need) — so the member sat there forever with the need at 1.0
 * and, worse, the station reservation held forever, silently downgrading
 * every OTHER hungry/tired staffer in the building to the slow fallback
 * too. That is the exact scar-comment deadlock this task exists to prevent,
 * reopened by a route the brief's own abandon list names explicitly
 * ("need threshold crossed, target demolished, station destroyed, or path
 * lost" — this is the fourth one).
 *
 * The live isReachable() re-check applies to every travelling job alike —
 * station-addressed via currentStationNode, target-addressed (repair/
 * commission) via job.destNode, the same subtile StaffPawns.js is walking
 * toward (see the travel-phase branch's own comment). Every job still gets
 * a travel-tick budget as a hard backstop regardless — see this section's
 * header comment for why that budget is computed from the job's own path
 * length and the game's current speed, not a flat constant, and why it's
 * re-derived (needsBudgetRecompute) whenever state.speed rises above
 * whatever speed it was last computed at.
 *
 * Once `phase === 'work'`, progress accrues by the member's own efficiency
 * (skill/mood/zone-tier/specialty-match, all in StaffMember.efficiency) —
 * runBeam's workTicks is null (open-ended, held until something else
 * reassigns the operator), so it accrues but never completes; every other
 * job type completes at workTicks and fires onJobComplete exactly once,
 * then routes through abandonJob like every other exit — see abandonJob's
 * doc comment for why completion belongs on that same single path.
 *
 * Gated on `status === 'working'` (balance fix round 2): a member
 * `'resting'` off a stress breakdown keeps whatever job they were holding
 * (assignJobs already never reassigns them — see this file's own comment on
 * that loop) but this function used to keep TICKING it too, with no status
 * check at all. That made a breakdown strictly better than a cafeteria: 30
 * ticks of free needs recovery (tickStaffMember's own 'resting' branch —
 * unaffected by this gate, and deliberately left as the one morale-recovery
 * path available while working) PLUS 30 ticks of job progress at full
 * efficiency, for free, with no station, no travel, no eat/rest job ever
 * taken. Measured: 30 resting ticks advanced a paperwork job from progress 0
 * to 14.6 while hunger/fatigue/morale all recovered. A member who isn't
 * `'working'` now gets their job frozen exactly as assignJobs already
 * leaves it — no staleness check, no travel-budget consumption, no
 * progress — until status flips back (which happens in tickStaffMember,
 * before this runs, so ticking resumes the same tick it should).
 */
export function tickJobs(game) {
  const state = game.state;
  for (const member of (state.staffMembers || [])) {
    const job = member.job;
    if (!job) continue;
    if (member.status !== 'working') continue;

    if (!jobStillValid(game, job)) {
      abandonJob(member, game, invalidJobReason(job));
      continue;
    }

    if (job.phase === 'travel') {
      // currentStationNode only ever resolves a station-addressed job's
      // node (see its own comment) — a target-addressed job (repair/
      // commission) falls back to job.destNode, the exact same subtile
      // StaffPawns.js is walking toward (see this round's destNode
      // unification). Before that field existed there was nothing to fall
      // back to here at all, so a target job got NEITHER the live
      // reachability re-check below NOR a real-path-length travel budget —
      // only the worst-case-map fallback (computeTravelBudget) and, on a
      // genuinely severed route, up to ~544 ticks (the map-scale backstop,
      // ≈9 minutes of wall clock at TICK_MS=1000) standing motionless
      // before giving up, versus 1 tick for the identical failure on a
      // station job. destNode being universal now closes that gap for
      // free — same check, same variable, no branch on jobType.
      const node = currentStationNode(state, job) || job.destNode;
      if (node && member.fromNode) {
        const nav = getNavGrid(state);
        if (!isReachable(nav, member.fromNode, node)) {
          abandonJob(member, game, 'The path there was lost.');
          continue;
        }
      }
      const speedNow = normalizedSpeed(game);
      if (needsBudgetRecompute(job, speedNow)) {
        job.travelBudgetTicks = computeTravelBudget(game, member, node);
        job.travelBudgetSpeed = speedNow;
      }
      job.travelTicks = (job.travelTicks || 0) + 1;
      if (job.travelTicks > job.travelBudgetTicks) {
        abandonJob(member, game, 'Gave up trying to get there.');
        continue;
      }
      continue;
    }

    const jobType = JOB_TYPES[job.jobType];
    if (!jobType) { abandonJob(member, game, 'That job no longer exists.'); continue; }

    // eat/rest accrue at a flat 1/tick rather than member.efficiency(): a
    // hungry person does not eat more slowly because they're unskilled or
    // stuck in a tier-0 zone — efficiency modeling belongs to productive
    // WORK, not to satisfying a need. Every other job type keeps scaling by
    // skill/mood/zone-tier/specialty-match as before.
    const flatNeedJob = job.jobType === 'eat' || job.jobType === 'rest';
    const zoneTier = zoneTierFor(state, member);
    job.progress += flatNeedJob ? 1 : member.efficiency(zoneTier, job.specialty);

    if (jobType.workTicks != null && job.progress >= jobType.workTicks) {
      onJobComplete(game, member, job);
      abandonJob(member, game, null);
    }
  }
}

/**
 * The single choke point every job exit path goes through: completion
 * (tickJobs), abandonment (needs preemption bumping a lower-priority job —
 * see handleNeeds/tryTakeNeedJob), and target/station demolition (tickJobs'
 * staleness check).
 *
 * Two related guarantees are deliberately NOT routed through here, each for
 * its own reason:
 *   - the needs deadlock-guard fallback (tryTakeNeedJob, no reachable eat/
 *     rest station) does NOT call this — it leaves the member's current job
 *     untouched on purpose, that's the whole point of the guard.
 *   - staff firing: fireStaffMember (Game.js) already calls stations.js's
 *     releaseAllFor directly as its own safety net. It does not additionally
 *     route through here because the member is deleted from the roster
 *     outright, not left holding a cleared job — there is no live member
 *     object to hand `idleReason` to.
 *   - save load: the equivalent guarantee (a reservation whose holder no
 *     longer exists is dropped) is stations.js's sanitizeStationReservations,
 *     called from Game's own load path, for the same "no live member to
 *     update" reason.
 *
 * Releasing the station (when held) before clearing `job` only matters in
 * that both must happen — order doesn't, since releaseStation is keyed off
 * the key/staffId captured off the job object, not off member.job's
 * current value.
 */
export function abandonJob(member, game, reason = null) {
  const state = game.state;
  const job = member.job;
  if (job?.stationKey) releaseStation(state, job.stationKey, member.id);
  member.job = null;
  member.idleReason = reason;
}

// --- Completion effects ------------------------------------------------------
//
// A dispatch hook, not a hardcoded switch: Tasks 3-6 each register their own
// job type's completion effect (repair heals a component, fabricate makes
// spares, takeData/analyze/labWork/commission move the science/zone-tier
// economy) via registerJobEffect from their OWN modules under
// src/game/staff/jobEffects/, rather than editing this file — see this
// plan's cross-task ruling 24. eat/rest are this task's own concern (the
// deadlock guard above is only half the story; completing the job is what
// actually satisfies the need) and are registered right here.
const jobEffects = new Map();

/** Register `handler(game, member, job)` to run once when a job of
 * `jobType` completes (see tickJobs). Last registration for a given
 * jobType wins — there is exactly one effect per job type by design. */
export function registerJobEffect(jobType, handler) {
  jobEffects.set(jobType, handler);
}

/** Dispatch `job`'s completion effect, if one is registered. Called by
 * tickJobs exactly once per completed job, before abandonJob clears it —
 * effects still see the live target/stationKey. */
export function onJobComplete(game, member, job) {
  const handler = jobEffects.get(job.jobType);
  if (handler) handler(game, member, job);
}

// Either completion clears unservicedPenalty (see tryTakeNeedJob's own
// comment): a completed meal or a completed rest is what "serviced" means,
// regardless of which need the guard originally tripped on.
registerJobEffect('eat', (game, member) => { member.needs.hunger = 0; member.unservicedPenalty = false; });
registerJobEffect('rest', (game, member) => { member.needs.fatigue = 0; member.unservicedPenalty = false; });
