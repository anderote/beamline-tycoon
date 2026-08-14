// src/game/staff/jobEffects/fabricate.js — the `fabricate` job's completion
// effect. Task 5 of the staff-professions-3 (jobs-and-gates) plan.
//
// See repair.js's own header for why this lives here (a dispatch hook,
// not jobRunner.js itself) and imports registerJobEffect from
// jobEffects/registry.js rather than from jobRunner.js — jobRunner.js now
// imports this file directly (fix round 3), which the dependency-free
// registry module is what makes safe.
//
// fabricate has no target (it's a plain station job — see jobs.js's
// PLAIN_STATION_JOBS) and nothing that can go stale between assignment and
// completion the way a repair target can, so this handler has no staleness
// check to make.

import { registerJobEffect } from './registry.js';
import { logCareerEvent } from '../careerLog.js';

// Task 7 (staff-professions-3, jobs-and-gates): every hundredth spare gets
// a diary entry (see repair.js's identical HISTORY_LOG_EVERY comment for
// why this is throttled at all, not just capped after the fact).
// `made` can be more than 1 per completion (skilled machinists), so a plain
// `sparesMade % 100 === 0` check can jump straight over an exact multiple —
// the boundary-crossing check below (comparing floor(before/100) against
// floor(after/100)) catches a threshold crossed mid-jump the same as one
// landed on exactly.
const HISTORY_LOG_EVERY = 100;

registerJobEffect('fabricate', (game, member) => {
  const state = game.state;
  const made = 1 + Math.floor((member.skills?.construction ?? 0) / 3);
  state.resources.spares = (state.resources.spares || 0) + made;

  const before = member.stats.sparesMade || 0;
  const after = before + made;
  member.stats.sparesMade = after;
  if (Math.floor(before / HISTORY_LOG_EVERY) < Math.floor(after / HISTORY_LOG_EVERY)) {
    logCareerEvent(member, state.tick, 'fabricate', `Fabricated ${after} spares over their career.`);
  }
});
