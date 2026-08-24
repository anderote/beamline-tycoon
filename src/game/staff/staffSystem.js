// src/game/staff/staffSystem.js — needs loop, hiring, assignments

import { StaffMember } from './StaffMember.js';
import { PROFESSIONS, professionDef, specialtiesFor } from '../../data/professions.js';
import { BACKSTORIES, rollBackstory, applyBackstory } from '../../data/backstories.js';
import { logCareerEvent } from './careerLog.js';

// Temporary gameplay switch: workers currently stay on productive jobs
// continuously. The underlying needs model remains available so it can be
// revisited later without rebuilding the staff simulation from scratch.
export const STAFF_BREAKS_ENABLED = false;

// Soft staff routines stay enabled while hard needs remain disabled. They
// create the visible desk -> cafeteria/wander -> desk rhythm without making
// hunger or fatigue a production gate.
export const STAFF_ROUTINES_ENABLED = true;

// Base fatigue accrual per tick while 'working' (before trait multipliers).
// Exported so jobRunner.js's own test (test-job-runner.js) can assert, as a
// cheap arithmetic guard, that every work job's workTicks fits inside one
// NEEDS_THRESHOLD-wide waking window at a representative staffer's
// efficiency — see that test's own header for the full "workTicks: 150 met
// fatigue += 0.02" history this constant exists to keep from repeating.
//
// Was 0.02 (threshold crossed at tick 41 — see this task's balance report)
// and left no job of any real duration completable in one window even before
// travel. 0.005 crosses NEEDS_THRESHOLD (0.8) at tick 160. Needs pacing is
// intentionally tick-based and independent of the slower presentation clock.
export const FATIGUE_PER_TICK = 0.005;

// Base hunger accrual per tick while 'working' (before the gourmand trait's
// 1.2x). Balance fix round 2: was 0.01 (crossing NEEDS_THRESHOLD at tick
// 80, i.e. one meal roughly every third of a waking window) — measured
// (independently, then reproduced) as the single largest driver of an
// amenities-equipped facility's throughput deficit relative to the
// deadlock-guard control, and the term real walking distance to a cafeteria
// makes materially worse (a facility with any real travel distance to feed
// pays this cost far more often than the zero-travel headless tests here
// can see). 0.0033 crosses threshold at tick ~242, matching what fix round 1
// already did for sleep via FATIGUE_PER_TICK above. Like fatigue, this remains
// tick-based rather than stretching when the presentation day is retuned.
export const HUNGER_PER_TICK = 0.0033;
const GOURMAND_HUNGER_MULT = 1.2; // unchanged ratio from the old 0.01 -> 0.012

function pickSpecialty(profession, rng) {
  const specs = specialtiesFor(profession);
  if (specs.length === 0) return null;
  const idx = Math.floor(rng() * specs.length) % specs.length;
  return specs[idx].id;
}

export function createStaffMember(profession, id, tick = 0, rng = Math.random, specialty = null) {
  const chosenSpecialty = specialty ?? pickSpecialty(profession, rng);
  const m = new StaffMember({ id, profession, specialty: chosenSpecialty, rng });
  const backstory = rollBackstory(profession, rng);
  if (backstory) {
    m.backstoryId = backstory.id;
    applyBackstory(m, backstory);
  }
  const professionHome = professionDef(profession)?.homeZone ?? null;
  const specialtyHome = specialtiesFor(profession)
    .find(candidate => candidate.id === chosenSpecialty)?.zoneId ?? null;
  m.assignment.zoneId = specialtyHome || professionHome;
  m.history = [{ tick, event: 'hired', note: `Joined as ${profession}` }];
  return m;
}

// Tick needs for one member. Returns true if status changed. `tick` (the
// sim tick this call is running at — Game.js's own state.tick) is used only
// for the breakdown diary entry below; every other caller-supplied field
// was already required.
export function tickStaffMember(m, {
  isNight, cafeteriaTier, zoneTier, tick = 0, rng = Math.random,
  breaksEnabled = true,
}) {
  // When breaks are disabled, also clean up any need/break state carried by
  // an in-progress game. Otherwise a worker who was already tired, hungry,
  // or recovering could remain penalised even though new breaks are off.
  if (!breaksEnabled) {
    const statusChanged = m.status !== 'working';
    m.status = 'working';
    m._restTimer = null;
    m.needs.fatigue = 0;
    m.needs.hunger = 0;
    m.needs.morale = Math.max(0.6, m.needs.morale ?? 0.6);
    m.unservicedPenalty = false;
    const workingProductively = m.job?.phase === 'work'
      && m.job.jobType !== 'eat' && m.job.jobType !== 'rest';
    if (workingProductively) {
      m.stats.ticksWorked++;
      const gain = 0.01 * (m.traits.includes('fastLearner') ? 1.25 : 1);
      const primary = m.primarySkill || 'operating';
      m.skills[primary] = Math.min(10, m.skills[primary] + gain);
    }
    m.updateMood();
    return statusChanged;
  }

  const isGourmand = m.traits.includes('gourmand');
  const isStoic = m.traits.includes('stoic');
  const isNightOwl = m.traits.includes('nightOwl');
  let statusChanged = false;

  if (m.status === 'working') {
    let fatigueInc = FATIGUE_PER_TICK;
    if (isNightOwl) fatigueInc *= isNight ? 0.7 : 1.3;
    if (m.traits.includes('perfectionist')) fatigueInc *= 1.1;
    m.needs.fatigue = Math.min(1, m.needs.fatigue + fatigueInc);
    m.needs.hunger = Math.min(1, m.needs.hunger + (isGourmand ? HUNGER_PER_TICK * GOURMAND_HUNGER_MULT : HUNGER_PER_TICK));
    // morale decay
    let decay = 0.002;
    if (isStoic) decay *= 0.5;
    if (cafeteriaTier === 0) decay += 0.005;
    m.needs.morale = Math.max(0, m.needs.morale - decay);
    m.stats.ticksWorked++;
    // skill gain
    const gain = 0.01 * (m.traits.includes('fastLearner') ? 1.25 : 1);
    const primary = m.primarySkill || 'operating';
    m.skills[primary] = Math.min(10, m.skills[primary] + gain);
    // Hunger/fatigue crossing 0.8 used to flip status to 'onBreak' here —
    // deleted (staff-professions-3 Task 2). That transition is the scar this
    // comment used to explain: hunger *rose* on break with no cafeteria,
    // making its own recovery condition unsatisfiable, so a staffer who ever
    // went on break in a cafeteria-less facility could never return to
    // 'working' and permanently tripped the beam. Recovery is now a real job
    // (JOB_TYPES.eat/rest, assigned and ticked by
    // src/game/staff/jobRunner.js, which needs-preempts whatever the member
    // was doing) rather than a status this function drives — and jobRunner
    // carries its OWN deadlock guard for the exact same no-cafeteria case
    // (see its handleNeeds/tryTakeNeedJob), so this function no longer needs
    // to reason about it at all. status stays 'working' the entire time,
    // including while the member is travelling to or working an eat/rest
    // job — only a stress breakdown (below) still changes status here.
    // breakdown risk when morale very low
    if (m.needs.morale < 0.12 && rng() < 0.01) {
      m.status = 'resting';
      m.stats.breakdowns++;
      // Task 7 (staff-professions-3, jobs-and-gates): routed through
      // careerLog.js's logCareerEvent, same as every job-completion effect —
      // this used to push unconditionally with a hardcoded `tick: 0`
      // (a pre-existing bug this same call site's own rewrite fixes:
      // `tick` is now the sim tick actually passed in, not a placeholder),
      // and a chronically stressed staffer can break down many times in a
      // long game — exactly the unbounded-growth shape logCareerEvent's own
      // header exists to close off.
      //
      // Fix round 2: the note text itself used to read "...resting 30
      // ticks" — a raw sim unit, out of register with every OTHER note this
      // module writes (repair.js/commission.js/fabricate.js/analyze.js all
      // read as prose, no internal unit ever named). This entry lands in
      // the same permanent, capped diary the bio card renders verbatim, so
      // it is held to that same bar now — reworded to describe what
      // happened, not how the sim implements the recovery.
      logCareerEvent(m, tick, 'breakdown', 'Suffered a stress breakdown and stepped away to recover.');
      m._restTimer = 30;
      statusChanged = true;
    }
  } else if (m.status === 'resting') {
    if (m._restTimer != null) {
      m._restTimer--;
      if (m._restTimer <= 0) {
        m._restTimer = null;
        m.status = 'working';
        statusChanged = true;
      }
    }
    m.needs.fatigue = Math.max(0, m.needs.fatigue - 0.05);
    m.needs.hunger = Math.max(0, m.needs.hunger - (cafeteriaTier > 0 ? 0.08 : 0.02));
    m.needs.morale = Math.min(1, m.needs.morale + 0.015);
    if (m._restTimer == null && m.needs.fatigue < 0.25 && m.needs.hunger < 0.35) {
      m.status = 'working';
      statusChanged = true;
    }
  } else {
    // idle
    m.needs.fatigue = Math.max(0, m.needs.fatigue - 0.02);
    m.needs.morale = Math.min(1, m.needs.morale + 0.005);
  }
  m.updateMood();
  return statusChanged;
}

// Keyed by profession id (singular), with a zero entry for every profession.
export function deriveStaffCounts(members) {
  const c = {};
  for (const id of Object.keys(PROFESSIONS)) c[id] = 0;
  for (const m of members) {
    if (c[m.profession] != null) c[m.profession]++;
    else c[m.profession] = (c[m.profession] || 0) + 1;
  }
  return c;
}

// Takes the candidate StaffMember itself (not just a profession id) because
// backstory is mechanically loaded on salary: a veteran costs more to hire
// than a fresh grad of the same profession. Missing/unknown backstoryId
// treats salaryMult as 1 rather than throwing.
export function staffHireCost(member, costs) {
  const def = professionDef(member.profession);
  const base = (costs && costs[member.profession] != null) ? costs[member.profession] : (def?.baseSalary ?? 100);
  const salaryMult = BACKSTORIES[member.backstoryId]?.salaryMult ?? 1;
  return Math.round(base * (def?.hireMultiplier ?? 12) * salaryMult);
}
