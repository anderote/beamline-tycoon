// src/game/staff/jobEffects/paperwork.js — the `paperwork` job's completion
// effect. Task 7 of the staff-professions-3 (jobs-and-gates) plan: admin's
// own gated work, alongside meet.js.
//
// Two things happen on completion, per the brief verbatim:
//   - reputation converts into funding, at a rate scaled by the admin's own
//     skill — via member.efficiency(), the same skill/zone/mood-scaled rate
//     every other completion effect in this directory already uses (see
//     repair.js/analyze.js for the identical pattern). paperwork's
//     JOB_TYPES entry has usesSpecialty: false, so job.specialty is always
//     null here and efficiency's cross-specialty halving never applies —
//     this is a flat skills.admin/zone/mood rate, nothing more.
//   - state.staffHireDiscount builds by a flat amount per completion,
//     capped, independent of efficiency (this is bureaucratic THROUGHPUT —
//     "did the paperwork get filed" — not a quality-scaled amount the way
//     the funding conversion above is). Consumed (reset to 0) the moment a
//     hire actually happens — see Game.js's hireStaffMember/hireStaff, the
//     only two places that read state.staffHireDiscount — so "reduces the
//     NEXT hire's cost" (the brief's own wording) holds literally: this is
//     a one-shot discount spent on whichever hire comes next, not a
//     standing markdown on every future hire.
//
// A leaf module — imports registerJobEffect from jobEffects/registry.js,
// not from jobRunner.js — see repair.js's own header for why that matters.

import { registerJobEffect } from './registry.js';

// Duplicated from jobRunner.js's own (unexported) zoneTierFor — see
// repair.js's identical duplicate and its comment on why this small a
// lookup isn't worth importing across the module boundary for.
function zoneTierFor(state, member) {
  const zoneId = member.assignment?.zoneId;
  if (!zoneId) return 0;
  return state.zoneConnectivity?.[zoneId]?.tier || 0;
}

// Reputation converted per completion at efficiency 1. Reputation accrues
// far more slowly than data does (analyze.js's own REPUTATION_PER_DATA:
// a full 20-data analysis nets only 0.4 reputation), so converting it at
// anything close to data's own per-completion volume would let a single
// admin drain a facility's whole reputation bank in a handful of
// completions. 3 keeps a paperwork completion a meaningful but bounded
// draw against whatever reputation the rest of the facility has actually
// earned.
const REPUTATION_CONVERTED_PER_COMPLETION = 3;
// $ minted per reputation point converted. Hire costs run a few thousand
// dollars (staffHireCost: baseSalary x 12, more with a costly backstory),
// so a fully-efficient completion converting its full cap (3 reputation)
// nets $6,000 — a real bump, not a rounding error, but nowhere near
// grant/beam/data-fee income on its own.
const FUNDING_PER_REPUTATION = 2000;

const HIRE_DISCOUNT_PER_COMPLETION = 0.05;
const HIRE_DISCOUNT_CAP = 0.4;

registerJobEffect('paperwork', (game, member, job) => {
  const state = game.state;
  const efficiency = member.efficiency(zoneTierFor(state, member), job.specialty);

  const available = state.resources.reputation || 0;
  if (available > 0) {
    const converted = Math.min(available, REPUTATION_CONVERTED_PER_COMPLETION * efficiency);
    state.resources.reputation = available - converted;
    state.resources.funding = (state.resources.funding || 0) + converted * FUNDING_PER_REPUTATION;
  }

  // Rounded to the nearest 0.01 before capping: repeated 0.05 additions
  // drift in floating point (8 of them lands on 0.39999999999999997, not
  // 0.4), and Math.min against a slightly-under value never corrects it —
  // the discount would then cap one dollar short of what the brief actually
  // promises ("capped at 40%") forever, on every completion after the 8th.
  const raw = (state.staffHireDiscount || 0) + HIRE_DISCOUNT_PER_COMPLETION;
  state.staffHireDiscount = Math.min(HIRE_DISCOUNT_CAP, Math.round(raw * 100) / 100);
});
