// src/game/staff/jobEffects/analyze.js — the `analyze` job's completion
// effect. Task 6 of the staff-professions-3 (jobs-and-gates) plan.
//
// Converts accumulated `data` (raw detector output — see takeData's own
// per-tick accrual, wired directly into Game._tickBeamline rather than
// through this dispatch hook, since it is continuous rather than a one-shot
// completion) into research progress and reputation. research.js's own
// tickResearch keeps a small passive trickle (lab tier + beam quality +
// morale, no longer multiplied by raw scientist headcount — see that
// file's own comment on why the old `1 + staff.scientist * 0.05` term had
// to go); this is the second, WORK-gated source the brief calls for.
//
// A leaf module — imports registerJobEffect from jobEffects/registry.js,
// not from jobRunner.js — see repair.js's own header for why that matters.

import { registerJobEffect } from './registry.js';
import { logCareerEvent } from '../careerLog.js';
import { RESEARCH } from '../../../data/research.js';

// Duplicated from jobRunner.js's own (unexported) zoneTierFor — see
// repair.js's identical duplicate and its comment on why this small a
// lookup isn't worth importing across the module boundary for.
function zoneTierFor(state, member) {
  const zoneId = member.assignment?.zoneId;
  if (!zoneId) return 0;
  return state.zoneConnectivity?.[zoneId]?.tier || 0;
}

// Per completed analysis: at most this much `data` is converted, scaled
// down by the analyst's own efficiency the same way repair's heal amount
// and fabricate's spares yield already scale by skill/zone/mood. A
// perfectly efficient analyst (efficiency 1) empties a 20-unit stockpile in
// one sitting; a partly-skilled or badly-specialised one converts less per
// sitting, not more sittings' worth per unit of data.
const DATA_PER_ANALYSIS = 20;
// researchProgress gained per unit of data converted, when research is
// actually active — RESEARCH[id].duration values run into the hundreds
// (see data/research.js), so a single analysis is a meaningful but not
// game-ending chunk of it, the same order of magnitude as the passive
// per-tick trickle accumulates over several minutes.
const RESEARCH_PROGRESS_PER_DATA = 1;
// Reputation gained per unit of data converted, independent of whether any
// research is active — published findings build a facility's reputation
// whether or not THIS team is chasing a specific upgrade with them.
const REPUTATION_PER_DATA = 0.02;

registerJobEffect('analyze', (game, member, job) => {
  const state = game.state;
  const available = state.resources.data || 0;
  // Nothing to analyze: no data, no progress, no reputation, and — like
  // repair's own zero-spares race — no stats credit either. The job still
  // completes (workTicks already ran its course) and will simply be
  // re-offered if data ever accumulates again.
  if (available <= 0) return;

  const efficiency = member.efficiency(zoneTierFor(state, member), job.specialty);
  const consumed = Math.min(available, DATA_PER_ANALYSIS * efficiency);
  state.resources.data -= consumed;

  // Task 7 (staff-professions-3, jobs-and-gates): a diary entry only when
  // THIS analysis is the one that pushes the active research item over its
  // duration — "every analysis that completes a research item", not every
  // analysis (an unconditional push here, the pre-Task-7 behavior, was the
  // same unbounded-growth hazard repair.js/commission.js/fabricate.js also
  // had — see repair.js's HISTORY_LOG_EVERY comment). Determined entirely
  // within this handler's own contribution (before/after around ONLY this
  // completion's own researchProgress addition) rather than waiting to see
  // whether Game.js's later research.tickResearch call actually flips
  // completedResearch this same tick: tickResearch's own completion check
  // is the identical `>= duration` test, runs synchronously later in the
  // same Game.tick() (no other write to researchProgress can land between
  // this effect and that check), so crossing the line here is exactly
  // equivalent to "this analysis completed it."
  if (state.activeResearch) {
    const before = state.researchProgress || 0;
    const duration = RESEARCH[state.activeResearch]?.duration;
    state.researchProgress = before + consumed * RESEARCH_PROGRESS_PER_DATA;
    if (duration != null && before < duration && state.researchProgress >= duration) {
      const label = RESEARCH[state.activeResearch]?.name || 'the active research';
      logCareerEvent(member, state.tick, 'research', `Ran the analysis that finished ${label}.`);
    }
  }
  state.resources.reputation = (state.resources.reputation || 0) + consumed * REPUTATION_PER_DATA;

  member.stats.analyses = (member.stats.analyses || 0) + 1;
});
