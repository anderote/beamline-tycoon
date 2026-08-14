// src/game/staff/jobEffects/meet.js — the `meet` job's completion effect.
// Task 7 of the staff-professions-3 (jobs-and-gates) plan.
//
// jobs.js's own meetOffers gates a meeting on 3+ idle staff and an admin
// present to run it — a release valve, not a default activity. This is the
// payoff: every CURRENT attendee (everyone whose job is ALSO 'meet' the
// instant this one completes) gets the big bump; everyone else in the
// building gets a smaller one. "Every attendee" includes the member whose
// own job is completing right now — tickJobs calls onJobComplete BEFORE
// abandonJob clears member.job (see registry.js's own onJobComplete +
// jobRunner.js's tickJobs), so `member.job.jobType` still reads 'meet' for
// exactly this member at the moment this handler runs.
//
// "Once, on completion" (the brief's own wording) is what makes this a
// completion effect at all rather than a per-tick one: this handler runs
// exactly once per meeting job that finishes (registry.js's onJobComplete
// contract, shared by every job type), never once per tick the meeting is
// in progress. It is deliberately NOT deduplicated across several
// attendees' own completions landing on different ticks (a meeting's
// several seats need not finish in lockstep, since job.progress accrues by
// each attendee's own efficiency) — each attendee's meeting finishing is
// its own morale event, the same way each analyst's own analyze completion
// is its own contribution to research rather than something to merge
// across staffers.
//
// A leaf module — imports registerJobEffect from jobEffects/registry.js,
// not from jobRunner.js — see repair.js's own header for why that matters.

import { registerJobEffect } from './registry.js';

const ATTENDEE_MORALE_BUMP = 0.15;
const FACILITY_MORALE_BUMP = 0.05;

registerJobEffect('meet', (game, member) => {
  const state = game.state;
  for (const m of state.staffMembers || []) {
    if (!m.needs) continue;
    const bump = m.job?.jobType === 'meet' ? ATTENDEE_MORALE_BUMP : FACILITY_MORALE_BUMP;
    m.needs.morale = Math.min(1, (m.needs.morale || 0) + bump);
  }
});
