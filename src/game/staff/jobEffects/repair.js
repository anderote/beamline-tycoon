// src/game/staff/jobEffects/repair.js — the `repair` job's completion
// effect. Task 5 of the staff-professions-3 (jobs-and-gates) plan.
//
// Registered via jobRunner.js's registerJobEffect hook (see that module's
// own "Completion effects" section) rather than added inline there — the
// hook exists precisely so jobRunner.js does not accrete every job type's
// effect, and later tasks get to add their own modules here alongside this
// one without ever touching jobRunner.js itself.
//
// This module is a leaf: it imports registerJobEffect FROM jobRunner.js, so
// jobRunner.js itself must never import this file (or fabricate.js) —
// that would be a cycle, and jobRunner.js's own `jobEffects` Map (a `const`)
// would still be in its temporal-dead-zone the moment this module's
// top-level registerJobEffect() call ran. Game.js imports both this module
// and jobRunner.js itself as siblings for exactly that reason — see its own
// comment at the import site.
//
// A repair job only ever completes with target = { beamlineId, nodeId }
// (see jobs.js's repairOffers) pointing at a still-live beamline/component:
// tickJobs' own jobStillValid check abandons a job whose target has gone
// stale BEFORE onJobComplete ever runs, so this handler can assume both
// resolve.
//
// Spares availability is not re-checked here on purpose. jobs.js's
// repairOffers already suppresses a repair offer entirely once spares hit 0
// (with its own player-facing idle-reason message), and jobRunner.js's
// pickBestOffer (this task's own fix to a real bug review found live) now
// refuses to hand the SAME damaged target to a second technician while one
// is already working it — so by the time a repair job actually completes,
// both "was there a spare to start this with" and "is this technician the
// only one working this component" have already been enforced upstream.
// Adding a second, quieter "no spares" branch here would silently swallow a
// completed repair instead of healing it, which is exactly the failure mode
// the brief for this task says not to introduce.

import { registerJobEffect } from '../jobRunner.js';
import { COMPONENTS } from '../../../data/components.js';

const HEAL_PER_COMPLETION = 25;

// Duplicates jobRunner.js's own (unexported) zoneTierFor — the same small
// lookup, not worth importing across the module boundary for.
function zoneTierFor(state, member) {
  const zoneId = member.assignment?.zoneId;
  if (!zoneId) return 0;
  return state.zoneConnectivity?.[zoneId]?.tier || 0;
}

function resolvePlaceable(state, nodeId) {
  const idx = state.placeableIndex?.[nodeId];
  return idx !== undefined ? state.placeables?.[idx]
    : (state.placeables || []).find(p => p.id === nodeId);
}

registerJobEffect('repair', (game, member, job) => {
  const state = game.state;
  const target = job.target;
  if (!target) return;

  const entry = (game.registry?.getAll?.() || []).find(e => e.id === target.beamlineId);
  if (!entry || !entry.beamState?.componentHealth) return;

  const efficiency = member.efficiency(zoneTierFor(state, member), job.specialty);
  const health = entry.beamState.componentHealth[target.nodeId] ?? 100;
  entry.beamState.componentHealth[target.nodeId] = Math.min(100, health + HEAL_PER_COMPLETION * efficiency);

  // Spares are a resource like any other spend — routed through Game.spend
  // (not chargeConstruction, which this plan reserves for build-time
  // placement debits) so sandbox mode's blanket "nothing is charged" still
  // holds for repair the same way it already does for every other spend.
  game.spend({ spares: 1 });

  member.stats.repairs = (member.stats.repairs || 0) + 1;

  const placeable = resolvePlaceable(state, target.nodeId);
  const label = COMPONENTS[placeable?.type]?.name || placeable?.type || 'component';
  member.history.push({ tick: state.tick, event: 'repair', note: `Repaired ${label}` });
});
