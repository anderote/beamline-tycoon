// src/game/staff/StaffMember.js — individual pawn, RimWorld-lite

const FIRST = ['A.', 'J.', 'M.', 'K.', 'R.', 'S.', 'L.', 'T.', 'E.', 'C.'];
const LAST = ['Kowalski', 'Chen', 'Garcia', 'Okoro', 'Singh', 'Anders', 'Yamada', 'Petrov', 'Mills', 'Haddad', 'Kim', 'Rossi', 'Okafor', 'Berg', 'Silva'];
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

export function randomName(rng = Math.random) {
  return `${pick(FIRST, rng)} ${pick(LAST, rng)}`;
}

export function randomTraits(rng = Math.random) {
  const n = rng() < 0.7 ? 1 : 2;
  const shuffled = [...TRAITS].sort(() => rng() - 0.5);
  return shuffled.slice(0, n);
}

export function traitDesc(t) { return TRAIT_DESC[t] || t; }

export class StaffMember {
  constructor(opts = {}) {
    this.id = opts.id || `staff_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    this.name = opts.name || randomName();
    this.role = opts.role || 'operator'; // operator|technician|scientist|engineer
    this.traits = opts.traits || randomTraits();
    // skills 0-10, primary for role starts higher
    const primary = { operator: 'operating', technician: 'technical', scientist: 'research', engineer: 'construction' }[this.role] || 'operating';
    this.skills = opts.skills || {
      operating: Math.floor(2 + Math.random() * 4 + (primary === 'operating' ? 1 : 0)),
      technical: Math.floor(2 + Math.random() * 4 + (primary === 'technical' ? 1 : 0)),
      research: Math.floor(2 + Math.random() * 4 + (primary === 'research' ? 1 : 0)),
      construction: Math.floor(2 + Math.random() * 4 + (primary === 'construction' ? 1 : 0)),
    };
    // clamp
    for (const k of Object.keys(this.skills)) this.skills[k] = Math.max(0, Math.min(10, this.skills[k]));
    this.needs = opts.needs || { fatigue: 0, hunger: 0, morale: 0.6 };
    this.assignment = opts.assignment || { zoneId: null, beamlineId: null };
    this.shift = opts.shift || (Math.random() < 0.3 ? 'night' : Math.random() < 0.5 ? 'day' : 'flex');
    this.status = opts.status || 'working';
    this.mood = opts.mood || 'content';
    this.history = opts.history || [{ tick: 0, event: 'hired', note: `Joined as ${this.role}` }];
    this.ticksWorked = 0;
    this.breakdowns = 0;
  }

  // Derive mood from needs
  updateMood() {
    const { fatigue, hunger, morale } = this.needs;
    if (morale < 0.15) this.mood = 'stressed';
    else if (fatigue > 0.85) this.mood = 'tired';
    else if (morale > 0.75 && fatigue < 0.3) this.mood = 'inspired';
    else this.mood = 'content';
  }

  // Work efficiency 0..1.5, uses skill/zone/mood
  efficiency(zoneTier = 0) {
    const primary = { operator: 'operating', technician: 'technical', scientist: 'research', engineer: 'construction' }[this.role] || 'operating';
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
    return (skill / 5) * tierMult * moodMult;
  }

  toJSON() {
    return {
      id: this.id, name: this.name, role: this.role, traits: [...this.traits],
      skills: { ...this.skills }, needs: { ...this.needs },
      assignment: { ...this.assignment }, shift: this.shift,
      status: this.status, mood: this.mood, history: [...this.history],
      ticksWorked: this.ticksWorked, breakdowns: this.breakdowns,
    };
  }

  static fromJSON(o) {
    return new StaffMember(o);
  }
}
