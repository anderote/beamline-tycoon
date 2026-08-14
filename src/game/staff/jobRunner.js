// src/game/staff/jobRunner.js — job assignment and the work state machine.
//
// Task 2 of the staff-professions-3 (jobs-and-gates) plan. Consumes Task 1's
// job board (src/game/staff/jobs.js: JOB_TYPES/buildJobOffers/eligibleFor)
// and Plan 2's station reservations (src/game/staff/stations.js) to actually
// put staff to work: assignJobs() hands out offers, tickJobs() advances
// whoever is already working, and abandonJob() is the one place every exit
// path — completion, interruption, demolition, firing, load — releases a
// held station. See abandonJob's own doc comment for why that matters more
// than it looks.
//
// Travel is NOT this module's problem. `member.job.phase` starts 'travel'
// on assignment and stays there until something reports arrival by writing
// `job.phase = 'work'` directly — in the running game that writer is the
// renderer (src/renderer3d/StaffPawns.js, Task 3 of this plan), which owns
// actual pawn motion and is the one place outside this module allowed to
// touch `job.phase`. tickJobs() only ever READS phase to decide whether to
// accrue work progress; it never advances travel itself. Headless callers
// (tests, or the game before Task 3 lands) that never flip phase simply
// leave a job parked in 'travel' forever — that's correct, not a bug, and
// mirrors "the sim only checks arrival" from this task's own brief.

import { JOB_TYPES, buildJobOffers, eligibleFor } from './jobs.js';
import { getStationIndex, findStation, reserveStation, releaseStation } from './stations.js';
import { getNavGrid, findPath } from './nav.js';

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
const NEEDS_THRESHOLD = 0.8;
// Same magic numbers the deleted onBreak branch used for its cafeteria-less
// case (staffSystem.js history: hunger -0.02/tick, fatigue -0.05/tick) —
// reused verbatim rather than re-derived, so "the current cafeteria-less
// rate" in this task's brief means exactly what it says.
const NO_STATION_RECOVERY_RATE = { hunger: 0.02, fatigue: 0.05 };

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
 *     old cafeteria-less onBreak branch used, and say why in idleReason.
 *     False, so the caller still gets a chance to try the OTHER need.
 */
function tryTakeNeedJob(member, game, jobType, needKey, missingLabel) {
  if (member.job?.jobType === jobType) return true;

  const state = game.state;
  const ref = findStation(state, { jobs: [jobType], fromNode: member.fromNode || null, staffId: member.id });
  if (ref && reserveStation(state, ref.key, member.id)) {
    if (member.job) abandonJob(member, game, null);
    member.job = {
      jobType, target: null, specialty: null, stationKey: ref.key,
      phase: 'travel', progress: 0,
    };
    member.idleReason = null;
    return true;
  }

  member.idleReason = `No reachable ${missingLabel} — recovering slowly while working.`;
  member.needs[needKey] = Math.max(0, member.needs[needKey] - NO_STATION_RECOVERY_RATE[needKey]);
  return false;
}

/**
 * Needs pass for one member, run unconditionally before normal assignment
 * (see assignJobs) — unconditionally meaning regardless of current status
 * or what job (if any) they hold, including a repair or runBeam job whose
 * own JOB_TYPES entry says `interruptible: false`. That flag governs one
 * WORK job bumping another; it says nothing about needs, which this task's
 * brief is explicit outrank work numerically and without exception.
 *
 * Hunger is checked before fatigue (eat's 1000 > rest's 950), and once one
 * need successfully lands a job this tick, the other is skipped — a member
 * can hold exactly one job, so there is nothing left to assign. But a need
 * that hits the DEADLOCK GUARD (no station reachable) does not consume the
 * member's "job slot": tryTakeNeedJob returns false, and the fatigue check
 * still runs, so a facility with a rest station but no cafeteria doesn't
 * also starve fatigue recovery just because hunger happened to be checked
 * first.
 */
function handleNeeds(member, game) {
  if ((member.needs?.hunger ?? 0) > NEEDS_THRESHOLD) {
    if (tryTakeNeedJob(member, game, 'eat', 'hunger', 'cafeteria')) return;
  }
  if ((member.needs?.fatigue ?? 0) > NEEDS_THRESHOLD) {
    tryTakeNeedJob(member, game, 'rest', 'fatigue', 'rest station');
  }
}

// --- Assignment-time caps --------------------------------------------------
//
// Two job types are capped at assignment time rather than by the board,
// because the board has no notion of "who's asking" and capping in its own
// (arbitrary) offer order would throw away the nearest option before the
// assigner ever saw it:
//   - runBeam: at most one operator per beamline that actually exists. The
//     board offers one slot per free CONSOLE, which can outnumber beamlines
//     (or vice versa).
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
  return (game.registry?.getAll?.() || []).length;
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
// next to them. Ties are broken by real path length (findPath, not raw
// subtile distance — a Euclidean-nearest console behind a long wall detour
// is not actually nearest) whenever the member's position is known;
// offers with no resolvable station (repair/commission targets) fall back
// to board order within their tier, since jobs.js exposes no exported way
// to resolve their approach node from here and duplicating its
// perimeter-walk is out of scope for a same-tier tie-break.
function pickNearestInTier(member, tier, state) {
  if (tier.length <= 1 || !member.fromNode) return tier[0];
  const index = getStationIndex(state);
  const nav = getNavGrid(state);
  let best = tier[0];
  let bestLen = Infinity;
  for (const offer of tier) {
    const ref = offer.stationKey ? index.byKey[offer.stationKey] : null;
    if (!ref) continue;
    const path = findPath(nav, member.fromNode, ref.node);
    const len = path ? path.length : Infinity;
    if (len < bestLen) { bestLen = len; best = offer; }
  }
  return best;
}

/**
 * The best offer `member` may take right now, honoring the runBeam/repair
 * caps and eligibleFor's rejections, or `{ offer: null, reason }` when
 * nothing qualifies. `reason` is the rejection from the HIGHEST-priority
 * offer that was actually considered (offers are pre-sorted descending, so
 * that's simply the first non-null reason seen) — "the best rejection they
 * collected", per this task's brief.
 */
function pickBestOffer(member, offers, game, caps, holders) {
  const state = game.state;
  let bestReason = null;
  let i = 0;
  while (i < offers.length) {
    const priority = offers[i].priority;
    const tier = [];
    while (i < offers.length && offers[i].priority === priority) {
      const offer = offers[i];
      i++;
      const cap = caps[offer.jobType];
      if (cap != null && holders[offer.jobType] >= cap) {
        if (bestReason == null) bestReason = capShortageReason(offer.jobType, cap);
        continue;
      }
      const res = eligibleFor(member, offer, game);
      if (res.ok) tier.push(offer);
      else if (bestReason == null) bestReason = res.reason;
    }
    if (tier.length) return { offer: pickNearestInTier(member, tier, state), reason: null };
  }
  return { offer: null, reason: bestReason };
}

function assignOffer(member, game, offer) {
  if (offer.stationKey) reserveStation(game.state, offer.stationKey, member.id);
  member.job = {
    jobType: offer.jobType,
    target: offer.target,
    specialty: offer.specialty,
    stationKey: offer.stationKey,
    phase: 'travel',
    progress: 0,
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
 * Every member ends this call with EITHER a non-null `job` OR a non-empty
 * `idleReason` — the brief's own explicit test — including staffers this
 * pass never even looks at (status !== 'working': resting from a
 * breakdown, or any other non-working status), so nobody is silently left
 * with a stale/blank idleReason from before.
 */
export function assignJobs(game) {
  const state = game.state;
  const members = state.staffMembers || [];
  if (!members.length) return;

  for (const member of members) handleNeeds(member, game);

  const { offers } = buildJobOffers(game);
  const caps = capsFor(game);
  const holders = currentHolders(members);

  for (const member of members) {
    if (member.job != null) continue;
    if (member.status !== 'working') {
      if (!member.idleReason) member.idleReason = statusIdleReason(member.status);
      continue;
    }

    const { offer, reason } = pickBestOffer(member, offers, game, caps, holders);
    if (offer) {
      assignOffer(member, game, offer);
      if (holders[offer.jobType] != null) holders[offer.jobType]++;
    } else {
      member.idleReason = reason || 'Nothing to do right now.';
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
 * Travel is not simulated here — see this file's header comment. A job
 * stuck in `phase: 'travel'` (nothing has reported arrival) is simply
 * skipped this tick, every tick, until something else flips the phase.
 * Once `phase === 'work'`, progress accrues by the member's own efficiency
 * (skill/mood/zone-tier/specialty-match, all in StaffMember.efficiency) —
 * runBeam's workTicks is null (open-ended, held until something else
 * reassigns the operator), so it accrues but never completes; every other
 * job type completes at workTicks and fires onJobComplete exactly once,
 * then routes through abandonJob like every other exit — see abandonJob's
 * doc comment for why completion belongs on that same single path.
 */
export function tickJobs(game) {
  const state = game.state;
  for (const member of (state.staffMembers || [])) {
    const job = member.job;
    if (!job) continue;

    if (!jobStillValid(game, job)) {
      abandonJob(member, game, invalidJobReason(job));
      continue;
    }

    if (job.phase !== 'work') continue;

    const jobType = JOB_TYPES[job.jobType];
    if (!jobType) { abandonJob(member, game, 'That job no longer exists.'); continue; }

    const zoneTier = zoneTierFor(state, member);
    job.progress += member.efficiency(zoneTier, job.specialty);

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

registerJobEffect('eat', (game, member) => { member.needs.hunger = 0; });
registerJobEffect('rest', (game, member) => { member.needs.fatigue = 0; });
