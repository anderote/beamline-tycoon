// src/game/staff/careerLog.js — the career history writer + milestone
// reader. Task 7 of staff-professions-3 (jobs-and-gates).
//
// member.history is a diary, not a log file: the bio card (Plan 1) renders
// it player-facing, so every entry has to read as an event in a life
// ("recovered the beam 47 times"), never a log line naming an internal id.
// This module is the ONLY place allowed to push onto it — every completion
// effect that used to call `member.history.push(...)` directly (repair.js,
// fabricate.js, analyze.js, commission.js — all Task 5/6 work) now goes
// through logCareerEvent instead, and staffSystem.js's breakdown entry does
// too. That matters for a reason this plan has hit before (see this task's
// own brief, hazard 1): a push that bypasses this module bypasses its two
// guarantees below, and "most of the writers respect the cap" is exactly
// the shape of gap the rest of this plan's gates have shipped with.
//
// Two guarantees, independent of which job effect calls in or how often:
//   - member.history never grows without bound. A long game racks up
//     thousands of completions; recording every single one would make a
//     saved StaffMember — and so the whole save file — grow forever. Capped
//     at the most recent MAX_HISTORY_ENTRIES.
//   - a run of the SAME event happening back to back collapses into one
//     entry carrying a count, rather than each occurrence getting its own
//     line — the same reason a chat log shows "x3" instead of three
//     identical messages in a row.

const MAX_HISTORY_ENTRIES = 50;

/**
 * Append one entry — `{ tick, event, note }` — to `member.history`.
 *
 * Collapsing is keyed on the immediately PRECEDING entry only ("consecutive
 * identical", per the brief) matching this one on both `event` and `note`
 * exactly — not "anywhere in history", and not "same event type with a
 * different note" (a repair note naming a different component, or a
 * milestone note whose count advanced, is a genuinely new fact worth its
 * own line, even though its `event` id repeats). A true repeat collapses
 * into the prior entry: `count` increments (starting from 1 on the entry
 * that first got pushed) and `tick` refreshes to the latest occurrence, so
 * the entry always reads as "still true as of this tick", not "true once,
 * a while ago".
 *
 * The cap is enforced every call, not just when it would otherwise be
 * exceeded by more than one — trimming from the front (`splice(0, ...)`)
 * keeps the array itself bounded regardless of how many entries came in
 * since the last check for a member with a large loaded save.
 */
export function logCareerEvent(member, tick, event, note) {
  if (!member.history) member.history = [];
  const history = member.history;
  const last = history[history.length - 1];
  if (last && last.event === event && last.note === note) {
    last.count = (last.count || 1) + 1;
    last.tick = tick;
  } else {
    history.push({ tick, event, note, count: 1 });
  }
  if (history.length > MAX_HISTORY_ENTRIES) {
    history.splice(0, history.length - MAX_HISTORY_ENTRIES);
  }
}

// One milestone per tracked stat category worth surfacing on a bio card —
// see StaffMember.js's STATS_KEYS for the full set this reads from.
// `threshold` is the count at which the line first becomes true; the line
// itself always reports the LIVE count (`n`), not the threshold, so it
// keeps reading correctly as the number climbs — "recovered the beam 47
// times" is what careerMilestones prints once repairs has passed 10 and
// then kept climbing, not a fixed "10" that never updates. Thresholds are
// round numbers chosen so a milestone shows up only once there is a real
// career behind it, not on the very first completion of any kind (which is
// what member.history's own diary entries — logCareerEvent, called directly
// from the job effects below — already cover with their own lower-frequency
// gating: first commission, every tenth repair, every hundredth spare,
// every analysis that finishes a research item).
const MILESTONES = [
  { stat: 'repairs', threshold: 10, label: (n) => `Recovered the beam ${n} time${n === 1 ? '' : 's'}.` },
  { stat: 'commissions', threshold: 5, label: (n) => `Commissioned ${n} component${n === 1 ? '' : 's'}.` },
  { stat: 'sparesMade', threshold: 100, label: (n) => `Fabricated ${n} spares.` },
  { stat: 'analyses', threshold: 10, label: (n) => `Completed ${n} data analyses.` },
  { stat: 'beamHours', threshold: 100, label: (n) => `Logged ${n} hours keeping the beam running.` },
];

/**
 * Player-facing summary lines derived from `member.stats` — never from
 * `member.history` (a milestone is a standing FACT about the career so far,
 * re-derived fresh every call; history is the diary of individual moments).
 * Empty for a brand new hire (every stat starts at 0, below every
 * threshold); grows a line at a time as thresholds are crossed, never
 * shrinks.
 */
export function careerMilestones(member) {
  const stats = member?.stats || {};
  const lines = [];
  for (const m of MILESTONES) {
    const n = stats[m.stat] || 0;
    if (n >= m.threshold) lines.push(m.label(n));
  }
  return lines;
}
