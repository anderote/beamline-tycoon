// src/game/staff/staffSystem.js — needs loop, hiring, assignments

import { StaffMember, randomName, randomTraits } from './StaffMember.js';

export function createStaffMember(role, id, tick = 0) {
  const m = new StaffMember({ id, role, name: randomName(), traits: randomTraits() });
  m.history = [{ tick, event: 'hired', note: `Joined as ${role}` }];
  return m;
}

// Tick needs for one member. Returns true if status changed.
export function tickStaffMember(m, { isNight, cafeteriaTier, zoneTier }) {
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
    m.ticksWorked++;
    // skill gain
    const gain = 0.01 * (m.traits.includes('fastLearner') ? 1.25 : 1);
    const primary = { operator: 'operating', technician: 'technical', scientist: 'research', engineer: 'construction' }[m.role] || 'operating';
    m.skills[primary] = Math.min(10, m.skills[primary] + gain);
    if (m.needs.fatigue > 0.8 || m.needs.hunger > 0.8) {
      m.status = 'onBreak';
      statusChanged = true;
    }
    // breakdown risk when morale very low
    if (m.needs.morale < 0.12 && Math.random() < 0.01) {
      m.status = 'resting';
      m.breakdowns++;
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
    // hunger: if cafeteria exists, feed; else hunger keeps rising a bit
    if (cafeteriaTier > 0) m.needs.hunger = Math.max(0, m.needs.hunger - 0.08);
    else m.needs.hunger = Math.min(1, m.needs.hunger + 0.005);
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

export function deriveStaffCounts(members) {
  const c = { operators: 0, technicians: 0, scientists: 0, engineers: 0 };
  const map = { operator: 'operators', technician: 'technicians', scientist: 'scientists', engineer: 'engineers' };
  for (const m of members) {
    const key = map[m.role] || m.role;
    if (c[key] != null) c[key]++;
  }
  return c;
}

export function staffHireCost(role, costs) {
  const map = { operator: 'operators', technician: 'technicians', scientist: 'scientists', engineer: 'engineers' };
  const key = map[role] || role;
  return (costs[key] || costs[role] || 100) * 12;
}
