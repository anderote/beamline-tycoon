// src/game/staff/jobEffects/registry.js — the completion-effect dispatch
// hook: `registerJobEffect`/`onJobComplete` and the Map backing them.
//
// Fix round 3 (staff-professions-3, jobs-and-gates, task 5): extracted out
// of jobRunner.js, which used to own this Map directly. That made
// jobRunner.js importing an effect module (repair.js/fabricate.js) a real
// module-graph CYCLE — those modules import `registerJobEffect`, and if
// jobRunner.js imported them back, the engine would evaluate an effect
// module's top-level `registerJobEffect(...)` call while still resolving
// jobRunner.js's OWN dependencies, i.e. before jobRunner.js's body had ever
// reached its `const jobEffects = new Map()` line — a TDZ ReferenceError,
// not a working registration (verified live in an isolated repro during
// fix round 1). The workaround at the time was Game.js importing jobRunner
// .js and every jobEffects/*.js module as SIBLINGS, so jobRunner.js was an
// ordinary (non-circular) dependency of each effect module and therefore
// guaranteed to finish evaluating first.
//
// That workaround had a real cost: registration became a side effect of
// *Game.js specifically* being imported, so any test (or future runtime
// entry point) that imports jobRunner.js without also importing Game.js
// gets a runner with `jobEffects` permanently empty — every repair or
// fabricate completion silently no-ops, with no error anywhere. Confirmed
// live: test/test-target-job-destination.js and
// test/test-pawn-job-integration.js both import jobRunner.js directly.
//
// This module has ZERO dependencies of its own (no import of jobRunner.js,
// no import of any jobEffects/*.js module), so it cannot be part of any
// cycle. jobRunner.js now imports registerJobEffect/onJobComplete FROM
// here (and re-exports them, so its own public API is unchanged) instead
// of defining them, and imports repair.js/fabricate.js directly — those
// modules import registerJobEffect from THIS file, not from jobRunner.js,
// so there is no cycle to break anymore.

const jobEffects = new Map();

/** Register `handler(game, member, job)` to run once when a job of
 * `jobType` completes (see jobRunner.js's tickJobs). Last registration for
 * a given jobType wins — there is exactly one effect per job type by
 * design. */
export function registerJobEffect(jobType, handler) {
  jobEffects.set(jobType, handler);
}

/** Dispatch `job`'s completion effect, if one is registered. Called by
 * jobRunner.js's tickJobs exactly once per completed job, before
 * abandonJob clears it — effects still see the live target/stationKey. */
export function onJobComplete(game, member, job) {
  const handler = jobEffects.get(job.jobType);
  if (handler) handler(game, member, job);
}
