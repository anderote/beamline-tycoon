// src/data/backstories.js
//
// Backstories — mechanically-loaded staff origins, rolled at hire time.
// A backstory sets skill floors/ceilings, scales growth and salary, and
// nudges trait odds, so the hiring screen is a decision rather than a
// button: cheap-and-green vs. expensive-and-ready.
//
// `professions: null` means the backstory can land on any profession.
// `skillFloor`/`skillCap` are partial maps — a skill absent from both is
// left exactly as rolled.

import { SKILLS, PROFESSIONS } from './professions.js';

export const BACKSTORIES = {
  nationalLabVeteran: {
    id: 'nationalLabVeteran', name: '12-Year National Lab Veteran',
    professions: ['technician', 'engineer'],
    skillFloor: { technical: 7 }, skillCap: {},
    growthMult: 0.6, salaryMult: 1.4, traitAffinity: ['perfectionist'],
  },
  freshPhD: {
    id: 'freshPhD', name: 'Fresh PhD, No Beam Time',
    professions: ['scientist', 'engineer'],
    skillFloor: {}, skillCap: {},
    growthMult: 1.5, salaryMult: 0.7, traitAffinity: ['fastLearner'],
  },
  exNavyReactorTech: {
    id: 'exNavyReactorTech', name: 'Ex-Navy Reactor Tech',
    professions: ['technician', 'operator', 'engineer'],
    skillFloor: { technical: 5 }, skillCap: { research: 3 },
    growthMult: 1.0, salaryMult: 1.1, traitAffinity: ['stoic'],
  },
  controlRoomLifer: {
    id: 'controlRoomLifer', name: 'Control Room Lifer',
    professions: ['operator'],
    skillFloor: { operating: 6 }, skillCap: {},
    growthMult: 0.8, salaryMult: 1.2, traitAffinity: ['careful'],
  },
  fieldServiceTech: {
    id: 'fieldServiceTech', name: 'Field Service Technician',
    professions: ['technician'],
    skillFloor: { technical: 4 }, skillCap: {},
    growthMult: 1.0, salaryMult: 1.0, traitAffinity: ['fastLearner'],
  },
  unionMachinist: {
    id: 'unionMachinist', name: 'Union Shop Machinist',
    professions: ['machinist'],
    skillFloor: { construction: 6 }, skillCap: { admin: 2 },
    growthMult: 0.7, salaryMult: 1.3, traitAffinity: ['perfectionist'],
  },
  postdocRefugee: {
    id: 'postdocRefugee', name: 'Postdoc Between Grants',
    professions: ['scientist'],
    skillFloor: { research: 6 }, skillCap: { admin: 2 },
    growthMult: 1.0, salaryMult: 0.85, traitAffinity: ['fastLearner'],
  },
  grantsOfficeVeteran: {
    id: 'grantsOfficeVeteran', name: 'Grants Office Veteran',
    professions: ['admin'],
    skillFloor: { admin: 6 }, skillCap: {},
    growthMult: 0.8, salaryMult: 1.15, traitAffinity: ['careful'],
  },
  hamRadioHobbyist: {
    id: 'hamRadioHobbyist', name: 'Weekend Ham Radio Operator',
    professions: null,
    skillFloor: { technical: 3 }, skillCap: {},
    growthMult: 1.1, salaryMult: 0.9, traitAffinity: ['fastLearner'],
  },
  careerChanger: {
    id: 'careerChanger', name: 'Career Changer',
    professions: null,
    skillFloor: {}, skillCap: {},
    growthMult: 1.3, salaryMult: 0.75, traitAffinity: ['nightOwl'],
  },
  summerIntern: {
    id: 'summerIntern', name: 'Summer Intern Who Stayed',
    professions: null,
    skillFloor: {},
    skillCap: { operating: 4, technical: 4, research: 4, construction: 4, admin: 4 },
    growthMult: 1.4, salaryMult: 0.6, traitAffinity: ['gourmand'],
  },
  burnedOutContractor: {
    id: 'burnedOutContractor', name: 'Burned-Out Contractor',
    professions: null,
    skillFloor: { technical: 4, construction: 4 }, skillCap: {},
    growthMult: 0.9, salaryMult: 1.25, traitAffinity: ['stoic'],
  },
};

// Player-facing bio-card copy, kept in one block so the table above stays
// scannable. One sentence, dry, mechanically true to the fields above.
const BACKSTORY_BLURBS = {
  nationalLabVeteran: 'Twelve years running someone else’s beamline; knows every failure mode by feel.',
  freshPhD: 'Defended six weeks ago and has never actually touched a working machine.',
  exNavyReactorTech: 'Ran a reactor plant at sea; brings unshakeable calm and zero patience for open-ended questions.',
  controlRoomLifer: 'Has personally caused, and personally fixed, every kind of interlock trip there is.',
  fieldServiceTech: 'Spent five years fixing other people’s equipment on-site, on a deadline, with the wrong tools.',
  unionMachinist: 'Thirty years on a factory floor before this facility’s funding agency existed.',
  postdocRefugee: 'Excellent physicist, terrible at writing the renewal proposal that would keep them funded.',
  grantsOfficeVeteran: 'Has read every line of the funding agency’s compliance manual, on purpose.',
  hamRadioHobbyist: 'Built a transmitter in a garage and never quite lost the habit of poking at hardware.',
  careerChanger: 'Left an unrelated industry for physics-adjacent work and is still catching up on the jargon.',
  summerIntern: 'Came for ten weeks, never quite left, and nobody remembers hiring them properly.',
  burnedOutContractor: 'Freelanced across three other labs and negotiates salary like it’s a contract renewal.',
};
for (const [id, blurb] of Object.entries(BACKSTORY_BLURBS)) {
  if (BACKSTORIES[id]) BACKSTORIES[id].blurb = blurb;
}

// Defensive load-time check — mirrors the one in professions.js.
for (const b of Object.values(BACKSTORIES)) {
  if (b.professions !== null) {
    for (const p of b.professions) {
      if (!PROFESSIONS[p]) throw new Error(`backstories: unknown profession '${p}' on backstory '${b.id}'`);
    }
  }
  for (const skill of [...Object.keys(b.skillFloor), ...Object.keys(b.skillCap)]) {
    if (!SKILLS.includes(skill)) throw new Error(`backstories: unknown skill '${skill}' on backstory '${b.id}'`);
  }
}

function eligibleBackstories(professionId) {
  return Object.values(BACKSTORIES).filter(b => b.professions === null || b.professions.includes(professionId));
}

// Chooses uniformly among the backstories eligible for a profession.
export function rollBackstory(professionId, rng = Math.random) {
  const pool = eligibleBackstories(professionId);
  if (pool.length === 0) return undefined;
  const idx = Math.floor(rng() * pool.length) % pool.length;
  return pool[idx];
}

// Mutates member.skills to respect a backstory's floors and caps. Skills
// with neither a floor nor a cap entry are left exactly as rolled.
// Idempotent: applying twice from a floor/cap-respecting state is a no-op.
export function applyBackstory(member, backstory) {
  if (!member.skills) member.skills = {};
  for (const [skill, floor] of Object.entries(backstory.skillFloor || {})) {
    if ((member.skills[skill] ?? 0) < floor) member.skills[skill] = floor;
  }
  for (const [skill, cap] of Object.entries(backstory.skillCap || {})) {
    if ((member.skills[skill] ?? 0) > cap) member.skills[skill] = cap;
  }
}
