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
// Test 9: staffHireCost reads costs by profession id.
// ==========================================================================
console.log('\n--- Test 9: staffHireCost ---');
{
  const costs = { operator: 120, technician: 180 };
  assert(staffHireCost('operator', costs) === 120 * 12, `staffHireCost('operator') is ${120 * 12} (got ${staffHireCost('operator', costs)})`);
  const fallback = staffHireCost('machinist', {});
  assert(fallback === PROFESSIONS.machinist.baseSalary * PROFESSIONS.machinist.hireMultiplier,
    `staffHireCost falls back to baseSalary * hireMultiplier when costs is missing the key (got ${fallback})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
