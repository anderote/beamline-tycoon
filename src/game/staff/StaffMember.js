// src/game/staff/StaffMember.js — individual pawn, RimWorld-lite

import { SKILLS, professionDef, CROSS_SPECIALTY_EFFICIENCY } from '../../data/professions.js';

const FIRST = [
  'Alice', 'James', 'Maria', 'Kwame', 'Ravi', 'Sofia', 'Liam', 'Tara', 'Erik', 'Chen',
  'Amara', 'Diego', 'Yuki', 'Noor', 'Oleg', 'Fatima', 'Hiro', 'Elena', 'Sanjay', 'Priya',
  'Malik', 'Ingrid', 'Tomas', 'Aisha', 'Leon', 'Mei', 'Dmitri', 'Nadia', 'Kofi', 'Ines',
  'Arjun', 'Freya', 'Bashir', 'Camila', 'Dara', 'Emeka', 'Greta', 'Hana', 'Ivan', 'Jun',
  'Layla', 'Marcus', 'Nia', 'Oscar', 'Petra', 'Quinn', 'Rosa', 'Said', 'Tove', 'Umar',
];
const LAST = [
  'Kowalski', 'Chen', 'Garcia', 'Okoro', 'Singh', 'Anders', 'Yamada', 'Petrov', 'Mills', 'Haddad',
  'Kim', 'Rossi', 'Okafor', 'Berg', 'Silva', 'Nakamura', 'Osei', 'Reyes', 'Ivanov', 'Novak',
  'Hassan', 'Larsen', 'Costa', 'Patel', 'Fischer', 'Diallo', 'Moreau', 'Sato', 'Kovacs', 'Abara',
  'Lindqvist', 'Nguyen', 'Delgado', 'Weber', 'Adeyemi', 'Volkov', 'Bianchi', 'Suzuki', 'Ferreira', 'Marsh',
  'Olawale', 'Duarte', 'Krause', 'Tanaka', 'Botha', 'Meier', 'Sundqvist', 'Vidal', 'Amadi', 'Horvath',
];
const TRAITS = ['careful', 'fastLearner', 'nightOwl', 'gourmand', 'stoic', 'perfectionist'];

const TRAIT_DESC = {
  careful: 'Careful — fewer breakdowns, 10% slower',
  fastLearner: 'Fast Learner — 25% faster skill gain',
  nightOwl: 'Night Owl — night fatigue -30%, day +30%',
  gourmand: 'Gourmand — cafeteria morale +0.1, hunger +20%',
  stoic: 'Stoic — morale decays 50% slower',
  perfectionist: 'Perfectionist — +15% beam quality, stress faster',
};

function pick(arr, rng = Math.random) { return arr[Math.floor(rng() * arr.length)]; }

export function randomFirstName(rng = Math.random) { return pick(FIRST, rng); }
export function randomLastName(rng = Math.random) { return pick(LAST, rng); }

export function randomName(rng = Math.random) {
  return `${randomFirstName(rng)} ${randomLastName(rng)}`;
}

export function randomTraits(rng = Math.random) {
  const n = rng() < 0.7 ? 1 : 2;
  const shuffled = [...TRAITS].sort(() => rng() - 0.5);
  return shuffled.slice(0, n);
}

export function traitDesc(t) { return TRAIT_DESC[t] || t; }

let _anonId = 0; // fallback id source only — sim callers always pass opts.id

const STATS_KEYS = ['ticksWorked', 'breakdowns', 'repairs', 'beamHours', 'sparesMade', 'analyses', 'commissions'];

function makeStats(src) {
  const stats = {};
  for (const k of STATS_KEYS) stats[k] = src?.[k] ?? 0;
  return stats;
}

export class StaffMember {
  constructor(opts = {}) {
    // opts.rng: seeded generator threaded from Game for deterministic rolls
    const rng = opts.rng || Math.random;
    this.id = opts.id || `staff_anon_${++_anonId}`;
    this.firstName = opts.firstName || randomFirstName(rng);
    this.lastName = opts.lastName || randomLastName(rng);
    this.profession = opts.profession || 'operator'; // operator|technician|engineer|scientist|machinist|admin
    this.specialty = opts.specialty ?? null;
    this.backstoryId = opts.backstoryId ?? null;
    this.traits = opts.traits || randomTraits(rng);
    // skills 0-10, primary for profession starts higher
    const primary = professionDef(this.profession)?.primarySkill || 'operating';
    this.skills = opts.skills || Object.fromEntries(SKILLS.map(skill => [
      skill, Math.floor(2 + rng() * 4 + (skill === primary ? 1 : 0)),
    ]));
    // clamp
    for (const k of Object.keys(this.skills)) this.skills[k] = Math.max(0, Math.min(10, this.skills[k]));
    this.needs = opts.needs || { fatigue: 0, hunger: 0, morale: 0.6 };
    this.assignment = opts.assignment || { zoneId: null, beamlineId: null };
    this.shift = opts.shift || (rng() < 0.3 ? 'night' : rng() < 0.5 ? 'day' : 'flex');
    this.status = opts.status || 'working';
    this.mood = opts.mood || 'content';
    // The job runner's state (src/game/staff/jobRunner.js) — { jobType,
    // target, specialty, stationKey, phase, progress } or null when idle.
    // idleReason is a player-facing string explaining why `job` is null (or,
    // for the hunger/fatigue deadlock guard, why it's recovering slower than
    // it could be even while still holding one) — never both null/empty at
    // once for a member the runner has actually looked at; see jobRunner.js.
    this.job = opts.job || null;
    this.idleReason = opts.idleReason ?? null;
    this.history = opts.history || [{ tick: 0, event: 'hired', note: `Joined as ${this.profession}` }];
    this.stats = makeStats(opts.stats);
  }

  get name() { return `${this.firstName} ${this.lastName}`; }

  get primarySkill() { return professionDef(this.profession)?.primarySkill; }

  // Derive mood from needs
  updateMood() {
    const { fatigue, hunger, morale } = this.needs;
    if (morale < 0.15) this.mood = 'stressed';
    else if (fatigue > 0.85) this.mood = 'tired';
    else if (morale > 0.75 && fatigue < 0.3) this.mood = 'inspired';
    else this.mood = 'content';
  }

  // Work efficiency 0..1.5, uses skill/zone/mood. jobSpecialty, when given,
  // halves efficiency for a specialist working outside their specialty.
  efficiency(zoneTier = 0, jobSpecialty = null) {
    const primary = this.primarySkill || 'operating';
    const skill = this.skills[primary] ?? 3;
    let moodMult = 1;
    if (this.mood === 'stressed') moodMult = 0.75;
    else if (this.mood === 'tired') moodMult = 0.85;
    else if (this.mood === 'inspired') moodMult = 1.15;
    // careful trait slows a bit
    if (this.traits.includes('careful')) moodMult *= 0.9;
    // zone tier: 0→0.5, 4→1.0
    const tierMult = 0.5 + 0.5 * Math.min(4, zoneTier) / 4;
    // nightOwl shift modifier (assume day tick: tick%240 <120 is day)
    // caller can pass isNight
    let result = (skill / 5) * tierMult * moodMult;
    if (jobSpecialty != null && this.specialty != null && jobSpecialty !== this.specialty) {
      result *= CROSS_SPECIALTY_EFFICIENCY;
    }
    return result;
  }

  toJSON() {
    return {
      id: this.id, firstName: this.firstName, lastName: this.lastName,
      profession: this.profession, specialty: this.specialty, backstoryId: this.backstoryId,
      traits: [...this.traits],
      skills: { ...this.skills }, needs: { ...this.needs },
      assignment: { ...this.assignment }, shift: this.shift,
      status: this.status, mood: this.mood, history: [...this.history],
      stats: { ...this.stats },
      job: this.job ? { ...this.job } : null, idleReason: this.idleReason,
    };
  }

  static fromJSON(o) {
    return new StaffMember(o);
  }
}
