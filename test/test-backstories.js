// test/test-backstories.js
//
// Tests for src/data/backstories.js — mechanically-loaded staff origins.
//
//   1. BACKSTORIES shape: professions/skillFloor/skillCap all reference
//      real ids, and floor <= cap wherever a skill has both.
//   2. Every profession has at least one eligible backstory (rollBackstory
//      with a fixed seeded rng, for each of the six professions).
//   3. applyBackstory raises/lowers/leaves skills as documented, is
//      idempotent, and never pushes a skill outside 0-10.

import { SKILLS, PROFESSIONS } from '../src/data/professions.js';
import { BACKSTORIES, rollBackstory, applyBackstory } from '../src/data/backstories.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ==========================================================================
// Test 1: BACKSTORIES shape.
// ==========================================================================
console.log('\n--- Test 1: BACKSTORIES references and floor/cap sanity ---');
{
  const ids = Object.keys(BACKSTORIES);
  assert(ids.length >= 12, `at least twelve backstories (got ${ids.length})`);

  const agnostic = Object.values(BACKSTORIES).filter(b => b.professions === null);
  assert(agnostic.length >= 2, `at least two profession-agnostic backstories (got ${agnostic.length})`);

  for (const [id, b] of Object.entries(BACKSTORIES)) {
    assert(b.id === id, `key '${id}' matches def.id '${b.id}'`);

    if (b.professions !== null) {
      assert(Array.isArray(b.professions), `'${id}'.professions is an array or null`);
      for (const p of b.professions) {
        assert(!!PROFESSIONS[p], `'${id}'.professions entry '${p}' exists in PROFESSIONS`);
      }
    }

    for (const skill of Object.keys(b.skillFloor || {})) {
      assert(SKILLS.includes(skill), `'${id}'.skillFloor key '${skill}' is a member of SKILLS`);
    }
    for (const skill of Object.keys(b.skillCap || {})) {
      assert(SKILLS.includes(skill), `'${id}'.skillCap key '${skill}' is a member of SKILLS`);
    }
    for (const skill of SKILLS) {
      const floor = b.skillFloor?.[skill];
      const cap = b.skillCap?.[skill];
      if (floor !== undefined && cap !== undefined) {
        assert(floor <= cap, `'${id}'.skillFloor.${skill} (${floor}) <= skillCap.${skill} (${cap})`);
      }
    }
  }

  const named = ['nationalLabVeteran', 'freshPhD', 'exNavyReactorTech'];
  for (const id of named) {
    assert(!!BACKSTORIES[id], `named backstory '${id}' exists`);
  }
}

// ==========================================================================
// Test 2: every profession has at least one eligible backstory.
// ==========================================================================
console.log('\n--- Test 2: rollBackstory covers all six professions ---');
{
  const rng = mulberry32(1234);
  for (const professionId of Object.keys(PROFESSIONS)) {
    const b = rollBackstory(professionId, rng);
    assert(!!b, `rollBackstory('${professionId}') returns a backstory`);
    if (b) {
      const eligible = b.professions === null || b.professions.includes(professionId);
      assert(eligible, `rolled backstory '${b.id}' is actually eligible for '${professionId}'`);
    }
  }
}

// ==========================================================================
// Test 3: applyBackstory clamps skills, is idempotent, stays in 0-10.
// ==========================================================================
console.log('\n--- Test 3: applyBackstory floor/cap/idempotence/range ---');
{
  // Synthetic backstory: floor pushes 'technical' up, cap pulls 'research' down,
  // 'operating' is left alone (no floor or cap entry).
  const synthetic = {
    id: 'synthetic', name: 'Synthetic', blurb: 'test fixture',
    professions: null,
    skillFloor: { technical: 6 },
    skillCap: { research: 3 },
    growthMult: 1, salaryMult: 1, traitAffinity: [],
  };

  const member = { skills: { technical: 2, research: 8, operating: 5 } };
  const result = applyBackstory(member, synthetic);
  assert(result === undefined, 'applyBackstory returns nothing');
  assert(member.skills.technical === 6, `skill below floor raised to floor (got ${member.skills.technical})`);
  assert(member.skills.research === 3, `skill above cap lowered to cap (got ${member.skills.research})`);
  assert(member.skills.operating === 5, `in-range skill with no floor/cap left untouched (got ${member.skills.operating})`);

  // Idempotence: applying again from the already-clamped state changes nothing.
  const before = { ...member.skills };
  applyBackstory(member, synthetic);
  assert(JSON.stringify(member.skills) === JSON.stringify(before),
    'applying twice is the same as applying once');

  // A member already comfortably inside floor/cap for a different backstory
  // should end up untouched on that skill.
  const alreadyFine = { skills: { technical: 8, research: 1, operating: 5 } };
  applyBackstory(alreadyFine, synthetic);
  assert(alreadyFine.skills.technical === 8, 'a skill already above floor is left untouched');
  assert(alreadyFine.skills.research === 1, 'a skill already below cap is left untouched');

  // Every skill stays within 0-10 across all real backstories applied to a
  // range of starting values.
  let allInRange = true;
  for (const b of Object.values(BACKSTORIES)) {
    for (const start of [0, 3, 5, 7, 10]) {
      const m = { skills: Object.fromEntries(SKILLS.map(s => [s, start])) };
      applyBackstory(m, b);
      for (const s of SKILLS) {
        if (m.skills[s] < 0 || m.skills[s] > 10) allInRange = false;
      }
    }
  }
  assert(allInRange, 'every skill stays within 0-10 after applyBackstory, across all backstories');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
