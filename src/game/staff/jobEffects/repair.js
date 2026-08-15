// src/game/staff/jobEffects/repair.js — the `repair` job's completion
// effect. Task 5 of the staff-professions-3 (jobs-and-gates) plan.
//
// Registered via jobRunner.js's registerJobEffect hook (see that module's
// own "Completion effects" section) rather than added inline there — the
// hook exists precisely so jobRunner.js does not accrete every job type's
// effect, and later tasks get to add their own modules here alongside this
// one without ever touching jobRunner.js itself.
//
// This module is a leaf: it imports registerJobEffect FROM
// jobEffects/registry.js (fix round 3), not from jobRunner.js — see that
// module's own header for why jobRunner.js importing an effect module that
// pulled registerJobEffect from jobRunner.js ITSELF used to be a real
// module-graph cycle (a TDZ ReferenceError, not a working registration).
// Routing through the dependency-free registry module instead means
// jobRunner.js can now import this file directly, which is exactly what it
// does.
//
// A repair job only ever completes with target = { beamlineId, nodeId }
// (see jobs.js's repairOffers) pointing at a still-live beamline/component:
// tickJobs' own jobStillValid check abandons a job whose target has gone
// stale BEFORE onJobComplete ever runs, so this handler can assume both
// resolve.
//
// Spares availability WAS assumed already enforced upstream (jobs.js's
// repairOffers suppresses an offer at spares === 0, and jobRunner.js's
// pickBestOffer refuses to double-book the same target) — true at
// ASSIGNMENT time, but fix round 1 found the live race those two checks
// can't close: two technicians already mid-repair on two DIFFERENT
// components, spares === 2, a beamline component purchase lands between
// their assignment and their completion and takes spares to 0 — both
// complete anyway, since neither re-checks anything at completion. Both
// healed for free and spares went to -2, and every future repair stayed
// suppressed (spares <= 0) until a machinist fabricated off a debt that was
// never really borrowed.
//
// Ruling (fix round 1): a repair must never *silently* no-op, but a race
// like this is real and has to resolve somehow — so if spares is actually 0
// the instant this handler runs, this does NOT heal and does NOT consume
// (there is nothing to consume), logs it loudly via game.log so it's not
// silent, and simply returns. tickJobs' own abandonJob still clears
// member.job right after this handler returns (same as every other
// completion) and the target is still damaged, so jobs.js's repairOffers
// re-offers it the moment a spare exists again — "re-offered", not lost.

import { registerJobEffect } from './registry.js';
import { COMPONENTS } from '../../../data/components.js';
import { logCareerEvent } from '../careerLog.js';

const HEAL_PER_COMPLETION = 25;
// Task 7 (staff-professions-3, jobs-and-gates): this used to push a
// member.history entry on EVERY repair completion — exactly the unbounded-
// growth hazard careerLog.js's own header warns about (a technician
// running for thousands of ticks racks up thousands of identical-shaped
// entries, capped nowhere). Throttled to every Nth repair — a diary entry,
// not a log line — with careerLog.js's own cap/dedup as the backstop for
// whatever DOES get logged.
const HISTORY_LOG_EVERY = 10;

// Duplicates jobRunner.js's own (unexported) zoneTierFor — the same small
// lookup, not worth importing across the module boundary for.
function zoneTierFor(state, member) {
  const zoneId = member.assignment?.zoneId;
  if (!zoneId) return 0;
  return state.zoneConnectivity?.[zoneId]?.tier || 0;
}

// A repair target's live type, for the history note — a module (a
// state.placeables entry) or, since fix round 1's on-pipe repair fix
// (jobs.js's beamlineComponentNodes/repairOffers), an on-pipe placement
// (inside some pipe's `.placements[]`, not state.placeables at all — see
// jobs.js's own findPipePlacement, duplicated here rather than imported for
// the same small-helper reason zoneTierFor above is).
function resolveComponentType(state, nodeId) {
  const idx = state.placeableIndex?.[nodeId];
  const placeable = idx !== undefined ? state.placeables?.[idx]
    : (state.placeables || []).find(p => p.id === nodeId);
  if (placeable) return placeable.type;
  for (const pipe of state.beamPipes || []) {
    const pl = (pipe.placements || []).find(p => p.id === nodeId);
    if (pl) return pl.type;
  }
  return null;
}

registerJobEffect('repair', (game, member, job) => {
  const state = game.state;
  const target = job.target;
  if (!target) return;

  const entry = (game.registry?.getAll?.() || []).find(e => e.id === target.beamlineId);
  if (!entry || !entry.beamState?.componentHealth) return;

  const type = resolveComponentType(state, target.nodeId);
  const label = COMPONENTS[type]?.name || type || 'component';

  // A job can outlive the inventory that made it eligible (another repair
  // may have completed first), so check again at completion.
  if (!game.sandboxMode && (state.resources.spares || 0) <= 0) {
    game.log(`No spares to repair the ${label} with — the job will be re-offered once some are available.`, 'bad');
    return;
  }

  const efficiency = member.efficiency(zoneTierFor(state, member), job.specialty);
  const health = entry.beamState.componentHealth[target.nodeId] ?? 100;
  entry.beamState.componentHealth[target.nodeId] = Math.min(100, health + HEAL_PER_COMPLETION * efficiency);

  game.spend({ spares: 1 });

  member.stats.repairs = (member.stats.repairs || 0) + 1;
  if (member.stats.repairs % HISTORY_LOG_EVERY === 0) {
    logCareerEvent(member, state.tick, 'repair',
      `Recovered the beam ${member.stats.repairs} times now — most recently the ${label}.`);
  }
});
