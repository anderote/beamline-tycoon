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

registerJobEffect('fabricate', (game, member) => {
  const made = 1 + Math.floor((member.skills?.construction ?? 0) / 3);
  game.state.resources.spares = (game.state.resources.spares || 0) + made;
  member.stats.sparesMade = (member.stats.sparesMade || 0) + made;
});
