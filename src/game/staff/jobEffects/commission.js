// src/game/staff/jobEffects/commission.js — the `commission` job's
// completion effect. Task 6 of the staff-professions-3 (jobs-and-gates)
// plan.
//
// A component placed after this task (see Game._placePlaceableInner and
// BeamlineSystem.placeOnPipe, the two choke points that mint one) starts
// with `needsCommissioning: true` and, per physics-payload.js's
// COMMISSIONING_DERATE, contributes at 0.7 of its rated stats until this
// effect clears the flag. Cross-specialty accrual is NOT this file's
// concern — job.progress already accrues at member.efficiency(zoneTier,
// job.specialty) in jobRunner.js's tickJobs, the same as every other work
// job, and StaffMember.efficiency already halves that for a specialty
// mismatch. A mismatched engineer commissions the same component this
// handler would for a matching one, just after roughly twice as many
// worked ticks.
//
// Registered via jobEffects/registry.js's registerJobEffect, imported as a
// leaf (no dependency on jobRunner.js) — see repair.js's own header for why
// that matters (the module-graph cycle fix-round-3 closed).

import { registerJobEffect } from './registry.js';
import { COMPONENTS } from '../../../data/components.js';

// A commission target's live, MUTABLE record — the same placeable object
// Game._placePlaceableInner stamped needsCommissioning onto for a module, or
// the same on-pipe placement object BeamlineSystem.placeOnPipe stamped it
// onto for a placement. Deliberately not imported from jobs.js's own
// resolveTarget/findPipePlacement — see repair.js's resolveComponentType for
// why a small lookup like this is duplicated across the jobs.js/jobEffects
// module boundary rather than shared.
function resolveComponentRecord(state, nodeId) {
  const idx = state.placeableIndex?.[nodeId];
  const placeable = idx !== undefined ? state.placeables?.[idx]
    : (state.placeables || []).find(p => p.id === nodeId);
  if (placeable) return placeable;
  for (const pipe of state.beamPipes || []) {
    const pl = (pipe.placements || []).find(p => p.id === nodeId);
    if (pl) return pl;
  }
  return null;
}

registerJobEffect('commission', (game, member, job) => {
  const state = game.state;
  const target = job.target;
  if (!target) return;

  const record = resolveComponentRecord(state, target.nodeId);
  // Already commissioned (a second engineer finished a stale offer, or the
  // target's flag was cleared some other way between assignment and
  // completion) or gone entirely: nothing to do, and — unlike repair's
  // spares race — nothing to log either, since there is no resource being
  // silently over/under-spent here, just a flag with nothing left to clear.
  if (!record?.needsCommissioning) return;

  record.needsCommissioning = false;
  member.stats.commissions = (member.stats.commissions || 0) + 1;
  const label = COMPONENTS[record.type]?.name || record.type || 'component';
  member.history.push({ tick: state.tick, event: 'commission', note: `Commissioned ${label}` });
});
