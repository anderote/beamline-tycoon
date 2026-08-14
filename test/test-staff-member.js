// test/test-staff-member.js
//
// Tests for src/game/staff/StaffMember.js and src/game/staff/staffSystem.js
// after the role -> profession rewrite.
//
//   1. createStaffMember shape: profession, specialty (engineer/scientist
//      only), five skill keys, per the six professions.
//   2. name / firstName / lastName: full names, not initials.
//   3. primarySkill getter matches the profession table.
//   4. efficiency: same value for matching specialty or null, half for a
//      mismatch.
//   5. stats starts all-zero; ticksWorked/breakdowns are off the top level.
//   6. deriveStaffCounts covers all six profession keys, zeros for absent.
//   7. toJSON/fromJSON round-trips profession, specialty, backstoryId,
//      stats, firstName/lastName.
//   8. Same seeded rng -> identical members; different seed -> different.

import { PROFESSIONS } from '../src/data/professions.js';
import { StaffMember } from '../src/game/staff/StaffMember.js';
import { createStaffMember, deriveStaffCounts, staffHireCost } from '../src/game/staff/staffSystem.js';

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

const PROFESSION_IDS = Object.keys(PROFESSIONS);

// ==========================================================================
// Test 1: createStaffMember shape across all six professions.
// ==========================================================================
console.log('\n--- Test 1: createStaffMember shape ---');
{
  const rng = mulberry32(1);
  for (const professionId of PROFESSION_IDS) {
    const m = createStaffMember(professionId, `staff_${professionId}`, 0, rng);
    assert(m.profession === professionId, `member.profession is '${professionId}'`);
    const shouldHaveSpecialty = professionId === 'engineer' || professionId === 'scientist';
    if (shouldHaveSpecialty) {
      assert(m.specialty != null, `'${professionId}' rolls a non-null specialty (got ${m.specialty})`);
    } else {
      assert(m.specialty == null, `'${professionId}' has a null specialty (got ${m.specialty})`);
    }
    assert(Object.keys(m.skills).length === 5, `'${professionId}' member has five skill keys (got ${Object.keys(m.skills).length})`);
  }
}

// ==========================================================================
// Test 2: name / firstName / lastName.
// ==========================================================================
console.log('\n--- Test 2: full names, not initials ---');
{
  const rng = mulberry32(2);
  const m = createStaffMember('operator', 'staff_name', 0, rng);
  const words = m.name.split(' ');
  assert(words.length === 2, `name '${m.name}' reads as two words`);
  for (const w of words) {
    assert(!/^[A-Za-z]\.$/.test(w), `word '${w}' in name '${m.name}' is not a single letter + period`);
  }
  assert(m.name === `${m.firstName} ${m.lastName}`, 'name getter derives from firstName + lastName');
}

// ==========================================================================
// Test 3: primarySkill getter.
// ==========================================================================
console.log('\n--- Test 3: primarySkill matches the profession table ---');
{
  const rng = mulberry32(3);
  for (const professionId of PROFESSION_IDS) {
    const m = createStaffMember(professionId, `staff_${professionId}`, 0, rng);
    assert(m.primarySkill === PROFESSIONS[professionId].primarySkill,
      `'${professionId}'.primarySkill getter is '${m.primarySkill}', expected '${PROFESSIONS[professionId].primarySkill}'`);
  }
}

// ==========================================================================
// Test 4: efficiency with matching / null / mismatched specialty.
// ==========================================================================
console.log('\n--- Test 4: efficiency and cross-specialty penalty ---');
{
  const rng = mulberry32(4);
  const m = createStaffMember('engineer', 'staff_eng', 0, rng);
  const baseline = m.efficiency(2, null);
  const matching = m.efficiency(2, m.specialty);
  assert(matching === baseline, `efficiency with matching specialty (${matching}) equals null-job efficiency (${baseline})`);

  const otherSpecialty = ['rf', 'vacuum', 'cooling', 'diagnostics', 'controls'].find(s => s !== m.specialty);
  const mismatched = m.efficiency(2, otherSpecialty);
  assert(Math.abs(mismatched - baseline * 0.5) < 1e-9,
    `efficiency with mismatched specialty (${mismatched}) is half of baseline (${baseline * 0.5})`);
}

// ==========================================================================
// Test 5: stats bag.
// ==========================================================================
console.log('\n--- Test 5: stats starts all-zero; ticksWorked/breakdowns off the top level ---');
{
  const rng = mulberry32(5);
  const m = createStaffMember('technician', 'staff_tech', 0, rng);
  const expectedKeys = ['ticksWorked', 'breakdowns', 'repairs', 'beamHours', 'sparesMade', 'analyses', 'commissions'];
  for (const k of expectedKeys) {
    assert(m.stats[k] === 0, `stats.${k} starts at 0 (got ${m.stats[k]})`);
    assert(Number.isInteger(m.stats[k]), `stats.${k} is an integer`);
  }
  assert(m.ticksWorked === undefined, 'ticksWorked is absent from the top level');
  assert(m.breakdowns === undefined, 'breakdowns is absent from the top level');
}

// ==========================================================================
// Test 6: deriveStaffCounts.
// ==========================================================================
console.log('\n--- Test 6: deriveStaffCounts covers all six profession keys ---');
{
  const rng = mulberry32(6);
  const roster = [
    createStaffMember('operator', 'a', 0, rng),
    createStaffMember('operator', 'b', 0, rng),
    createStaffMember('technician', 'c', 0, rng),
  ];
  const counts = deriveStaffCounts(roster);
  for (const professionId of PROFESSION_IDS) {
    assert(professionId in counts, `deriveStaffCounts includes key '${professionId}'`);
  }
  assert(counts.operator === 2, `counts.operator is 2 (got ${counts.operator})`);
  assert(counts.technician === 1, `counts.technician is 1 (got ${counts.technician})`);
  for (const professionId of ['engineer', 'scientist', 'machinist', 'admin']) {
    assert(counts[professionId] === 0, `counts.${professionId} is 0 for an absent profession (got ${counts[professionId]})`);
  }
}

// ==========================================================================
// Test 7: toJSON / fromJSON round-trip.
// ==========================================================================
console.log('\n--- Test 7: toJSON/fromJSON round-trip ---');
{
  const rng = mulberry32(7);
  const m = createStaffMember('scientist', 'staff_sci', 5, rng);
  m.stats.repairs = 3;
  m.stats.analyses = 7;
  const round = StaffMember.fromJSON(m.toJSON());
  for (const field of ['profession', 'specialty', 'backstoryId', 'firstName', 'lastName']) {
    assert(round[field] === m[field], `round-tripped ${field} matches (got ${round[field]}, expected ${m[field]})`);
  }
  assert(JSON.stringify(round.stats) === JSON.stringify(m.stats), 'round-tripped stats matches exactly');
}

// ==========================================================================
// Test 8: seeded rng determinism.
// ==========================================================================
console.log('\n--- Test 8: same seed -> identical members; different seed -> differ ---');
{
  const a = createStaffMember('machinist', 'staff_a', 0, mulberry32(42));
  const b = createStaffMember('machinist', 'staff_b', 0, mulberry32(42));
  assert(a.firstName === b.firstName && a.lastName === b.lastName, 'same seed produces the same name');
  assert(JSON.stringify(a.skills) === JSON.stringify(b.skills), 'same seed produces the same skills');
  assert(JSON.stringify(a.traits) === JSON.stringify(b.traits), 'same seed produces the same traits');
  assert(a.backstoryId === b.backstoryId, 'same seed produces the same backstoryId');
  assert(a.shift === b.shift, 'same seed produces the same shift');

  const c = createStaffMember('machinist', 'staff_c', 0, mulberry32(999));
  const differs = a.firstName !== c.firstName || a.lastName !== c.lastName ||
    JSON.stringify(a.skills) !== JSON.stringify(c.skills) ||
    JSON.stringify(a.traits) !== JSON.stringify(c.traits) ||
    a.backstoryId !== c.backstoryId;
  assert(differs, 'different seed produces at least one different field');
}

// ==========================================================================
// Test 9: staffHireCost reads costs by profession id, and loads backstory
// salaryMult so two candidates of the same profession cost differently.
// ==========================================================================
console.log('\n--- Test 9: staffHireCost ---');
{
  const costs = { operator: 120, technician: 180 };
  const operatorCand = { profession: 'operator', backstoryId: null };
  assert(staffHireCost(operatorCand, costs) === 120 * 12,
    `staffHireCost(operator, salaryMult=1) is ${120 * 12} (got ${staffHireCost(operatorCand, costs)})`);
  const fallback = staffHireCost({ profession: 'machinist', backstoryId: null }, {});
  assert(fallback === PROFESSIONS.machinist.baseSalary * PROFESSIONS.machinist.hireMultiplier,
    `staffHireCost falls back to baseSalary * hireMultiplier when costs is missing the key (got ${fallback})`);

  // Backstory is mechanically loaded on salary: a veteran must cost more
  // than a fresher hire of the same profession, so hiring is a real decision.
  const veteran = { profession: 'technician', backstoryId: 'nationalLabVeteran' }; // salaryMult 1.4
  const hobbyist = { profession: 'technician', backstoryId: 'hamRadioHobbyist' };  // salaryMult 0.9
  const veteranCost = staffHireCost(veteran, costs);
  const hobbyistCost = staffHireCost(hobbyist, costs);
  assert(veteranCost !== hobbyistCost,
    `two technician candidates with different-salaryMult backstories cost differently (veteran=${veteranCost}, hobbyist=${hobbyistCost})`);
  assert(veteranCost > hobbyistCost, 'higher salaryMult backstory costs more to hire');

  // Missing/unknown backstoryId treats salaryMult as 1, not a throw/NaN.
  const unknown = staffHireCost({ profession: 'technician', backstoryId: 'nonexistent' }, costs);
  assert(unknown === 180 * 12, `unknown backstoryId falls back to salaryMult 1 (got ${unknown})`);
}

// ==========================================================================
// Test 10: unservicedPenalty (balance fix round 3/4) — suppresses 'tired',
// not 'stressed'. Nothing asserted this before round 4: reverting the
// UNSERVICED_PENALTY_MULT line, or the tired-vs-stressed split, left
// test-beam-staffing-gate.js/test-utility-gate.js/test-job-runner.js/
// test-staff-economy.js all green.
// ==========================================================================
console.log("\n--- Test 10: unservicedPenalty suppresses 'tired' (same fact already taxed) but not 'stressed' (an independent one) ---");
{
  const skills = { operating: 5, technical: 5, research: 5, construction: 5, admin: 5 };
  const baseline = new StaffMember({ id: 'base', profession: 'operator', traits: [], skills, rng: () => 0.5 });
  const contentEfficiency = baseline.efficiency(0); // skill 5, tier 0, mood 'content' by default: 0.5

  // 'tired' (fatigue > 0.85) + unservicedPenalty: the penalty suppresses the
  // mood multiplier entirely (moodMult 1) and applies its own flat x0.6 —
  // lands at exactly contentEfficiency x 0.6, not x0.85 x 0.6 (x0.51).
  const tired = new StaffMember({ id: 'tired', profession: 'operator', traits: [], skills, rng: () => 0.5 });
  tired.needs.fatigue = 1.0; tired.needs.morale = 0.6; tired.updateMood();
  tired.unservicedPenalty = true;
  assert(tired.mood === 'tired', `setup: mood is 'tired' (got ${tired.mood})`);
  assert(Math.abs(tired.efficiency(0) - contentEfficiency * 0.6) < 1e-9,
    `unserviced + tired lands at exactly x0.6 of content (got ${tired.efficiency(0)}, expected ${contentEfficiency * 0.6})`);
  assert(Math.abs(tired.efficiency(0) - 0.3) < 1e-9, `= 0.300 for a skill-5/tier-0 operator (got ${tired.efficiency(0)})`);

  // 'stressed' (morale < 0.15) + unservicedPenalty: stressed is an
  // INDEPENDENT need (cafeteria zone tier + decay, nothing to do with
  // whether an eat/rest job landed this pass) and still applies on top —
  // x0.75 (stressed) x x0.6 (unserviced) = x0.45, not x0.6.
  const stressed = new StaffMember({ id: 'stressed', profession: 'operator', traits: [], skills, rng: () => 0.5 });
  stressed.needs.fatigue = 1.0; stressed.needs.morale = 0.05; stressed.updateMood();
  stressed.unservicedPenalty = true;
  assert(stressed.mood === 'stressed', `setup: mood is 'stressed', not 'tired' — morale check wins (got ${stressed.mood})`);
  assert(Math.abs(stressed.efficiency(0) - contentEfficiency * 0.45) < 1e-9,
    `unserviced + stressed lands at x0.45 of content, NOT the same x0.6 tired gets (got ${stressed.efficiency(0)}, expected ${contentEfficiency * 0.45})`);
  assert(stressed.efficiency(0) < tired.efficiency(0),
    `a chronically neglected, demoralised (stressed) staffer is worse off than a merely-hungry (tired) one, not equal (got ${stressed.efficiency(0)} vs ${tired.efficiency(0)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
