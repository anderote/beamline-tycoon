// src/data/professions.js
//
// Profession data — the six staff professions and the specialty axes two of
// them carry. This is the single source of truth every later staff-work
// task (navigation/stations, jobs/gates, presentation) reads from; nothing
// consumes it yet.
//
// A profession's `homeZone` is null when a single zone can't describe it —
// `engineer` and `scientist` carry a `specialtyAxis` instead, and each
// specialty on that axis names its own `zoneId` (the lab it works, and the
// accent color the presentation layer will read from `ZONES[zoneId].color`).

import { ZONES } from './facility.js';

export const SKILLS = ['operating', 'technical', 'research', 'construction', 'admin'];

export const PROFESSIONS = {
  operator:   { id: 'operator',   name: 'Operator',   plural: 'Operators',   primarySkill: 'operating',   homeZone: 'controlRoom', specialtyAxis: null,          baseSalary: 120, hireMultiplier: 12 },
  technician: { id: 'technician', name: 'Technician', plural: 'Technicians', primarySkill: 'technical',   homeZone: 'maintenance', specialtyAxis: null,          baseSalary: 180, hireMultiplier: 12 },
  engineer:   { id: 'engineer',   name: 'Engineer',   plural: 'Engineers',   primarySkill: 'technical',   homeZone: null,          specialtyAxis: 'engineering', baseSalary: 300, hireMultiplier: 12 },
  scientist:  { id: 'scientist',  name: 'Scientist',  plural: 'Scientists',  primarySkill: 'research',    homeZone: null,          specialtyAxis: 'science',     baseSalary: 250, hireMultiplier: 12 },
  machinist:  { id: 'machinist',  name: 'Machinist',  plural: 'Machinists',  primarySkill: 'construction', homeZone: 'machineShop', specialtyAxis: null,        baseSalary: 200, hireMultiplier: 12 },
  admin:      { id: 'admin',      name: 'Admin',      plural: 'Admins',      primarySkill: 'admin',       homeZone: 'officeSpace', specialtyAxis: null,          baseSalary: 150, hireMultiplier: 12 },
};

// Hiring-card copy, kept in one block so the table above stays scannable.
const PROFESSION_DESCS = {
  operator: 'Sits at the console and keeps the beam on. Skill decides how often it isn’t.',
  technician: 'Walks toward whatever just broke, carrying spares and modest expectations.',
  engineer: 'Tunes the lab that matches their specialty. Outside it, they’re just a person in a coat.',
  scientist: 'Turns beam time into data, and data into papers nobody outside the field will read.',
  machinist: 'Feeds the machine shop’s lathes and mills so the technicians have something to install.',
  admin: 'Files the paperwork that makes the funding, the hires, and the meetings happen.',
};
for (const [id, desc] of Object.entries(PROFESSION_DESCS)) {
  if (PROFESSIONS[id]) PROFESSIONS[id].desc = desc;
}

// Specialty axes. `zoneId` is null only for userScience, which is worked at
// beamline endpoints rather than in a lab.
export const SPECIALTY_AXES = {
  engineering: {
    id: 'engineering',
    specialties: {
      rf:          { id: 'rf',          name: 'RF',          zoneId: 'rfLab' },
      vacuum:      { id: 'vacuum',      name: 'Vacuum',      zoneId: 'vacuumLab' },
      cooling:     { id: 'cooling',     name: 'Cooling',     zoneId: 'coolingLab' },
      diagnostics: { id: 'diagnostics', name: 'Diagnostics', zoneId: 'diagnosticsLab' },
      controls:    { id: 'controls',    name: 'Controls',    zoneId: 'controlRoom' },
    },
  },
  science: {
    id: 'science',
    specialties: {
      optics:      { id: 'optics',      name: 'Optics',       zoneId: 'opticsLab' },
      diagnostics: { id: 'diagnostics', name: 'Diagnostics',  zoneId: 'diagnosticsLab' },
      userScience: { id: 'userScience', name: 'User Science', zoneId: null },
    },
  },
};

// Defensive load-time check — catches a typo'd zone id before it silently
// produces an undefined color or a missing home lab downstream.
for (const p of Object.values(PROFESSIONS)) {
  if (p.homeZone != null && !ZONES[p.homeZone]) {
    throw new Error(`professions: unknown homeZone '${p.homeZone}' on profession '${p.id}'`);
  }
}
for (const axis of Object.values(SPECIALTY_AXES)) {
  for (const s of Object.values(axis.specialties)) {
    if (s.zoneId != null && !ZONES[s.zoneId]) {
      throw new Error(`professions: unknown zoneId '${s.zoneId}' on specialty '${axis.id}.${s.id}'`);
    }
  }
}

// The one crossover number from the spec: a specialist working outside
// their specialty runs at half efficiency and gains no skill.
export const CROSS_SPECIALTY_EFFICIENCY = 0.5;

export function professionDef(id) {
  return PROFESSIONS[id];
}

// Array of specialty defs for a profession's axis, or [] when it has none.
export function specialtiesFor(professionId) {
  const def = PROFESSIONS[professionId];
  if (!def || !def.specialtyAxis) return [];
  const axis = SPECIALTY_AXES[def.specialtyAxis];
  return axis ? Object.values(axis.specialties) : [];
}
