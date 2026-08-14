// src/game/staff/staffSystem.js — needs loop, hiring, assignments

import { StaffMember } from './StaffMember.js';
import { PROFESSIONS, professionDef, specialtiesFor } from '../../data/professions.js';
import { rollBackstory, applyBackstory } from '../../data/backstories.js';

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
  m.history = [{ tick, event: 'hired', note: `Joined as ${profession}` }];
  return m;
}

// Tick needs for one member. Returns true if status changed.
export function tickStaffMember(m, { isNight, cafeteriaTier, zoneTier, rng = Math.random }) {
  const isGourmand = m.traits.includes('gourmand');
  const isStoic = m.traits.includes('stoic');
  const isNightOwl = m.traits.includes('nightOwl');
  let statusChanged = false;

  if (m.status === 'working') {
    let fatigueInc = 0.02;
    if (isNightOwl) fatigueInc *= isNight ? 0.7 : 1.3;
    if (m.traits.includes('perfectionist')) fatigueInc *= 1.1;
    m.needs.fatigue = Math.min(1, m.needs.fatigue + fatigueInc);
    m.needs.hunger = Math.min(1, m.needs.hunger + (isGourmand ? 0.012 : 0.01));
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
    if (m.needs.fatigue > 0.8 || m.needs.hunger > 0.8) {
      m.status = 'onBreak';
      statusChanged = true;
    }
    // breakdown risk when morale very low
    if (m.needs.morale < 0.12 && rng() < 0.01) {
      m.status = 'resting';
      m.stats.breakdowns++;
      m.history.push({ tick: 0, event: 'breakdown', note: 'Stressed breakdown — resting 30 ticks' });
      m._restTimer = 30;
      statusChanged = true;
    }
  } else if (m.status === 'onBreak' || m.status === 'resting') {
    if (m._restTimer != null) {
      m._restTimer--;
      if (m._restTimer <= 0) {
        m._restTimer = null;
        m.status = 'working';
        statusChanged = true;
      }
    }
    m.needs.fatigue = Math.max(0, m.needs.fatigue - 0.05);
    // Hunger always recovers on break — a cafeteria just makes it 4x faster.
    // (It used to *rise* without a cafeteria, which made the recovery
    // condition below unsatisfiable: a staffer who went on break in a
    // cafeteria-less facility could never return to 'working', permanently
    // tripping the beam via the beam_unstaffed gate. Slower recovery keeps the
    // cafeteria valuable as an uptime multiplier without deadlocking.)
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

export function staffHireCost(profession, costs) {
  const def = professionDef(profession);
  const base = (costs && costs[profession] != null) ? costs[profession] : (def?.baseSalary ?? 100);
  return base * (def?.hireMultiplier ?? 12);
}
