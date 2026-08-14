// test/test-professions.js
//
// Tests for src/data/professions.js — the profession and specialty data
// table every staff-professions task reads from.
//
//   1. PROFESSIONS shape: six entries, keys match ids.
//   2. Every primarySkill is a real skill, and all five skills are covered.
//   3. homeZone / specialtyAxis / specialty zoneId all resolve.
//   4. specialtiesFor() and professionDef() lookups.

import { ZONES } from '../src/data/facility.js';
import {
  SKILLS, PROFESSIONS, SPECIALTY_AXES,
  professionDef, specialtiesFor, CROSS_SPECIALTY_EFFICIENCY,
} from '../src/data/professions.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ==========================================================================
// Test 1: PROFESSIONS shape.
// ==========================================================================
console.log('\n--- Test 1: PROFESSIONS has exactly six entries, keys match ids ---');
{
  const keys = Object.keys(PROFESSIONS);
  assert(keys.length === 6, `six professions (got ${keys.length})`);
  for (const [key, def] of Object.entries(PROFESSIONS)) {
    assert(def.id === key, `key '${key}' matches def.id '${def.id}'`);
  }
}

// ==========================================================================
// Test 2: primarySkill coverage.
// ==========================================================================
console.log('\n--- Test 2: primarySkill is a real skill; all five skills covered ---');
{
  const seen = new Set();
  for (const def of Object.values(PROFESSIONS)) {
    assert(SKILLS.includes(def.primarySkill), `'${def.id}'.primarySkill '${def.primarySkill}' is a member of SKILLS`);
    seen.add(def.primarySkill);
  }
  for (const skill of SKILLS) {
    assert(seen.has(skill), `skill '${skill}' is the primarySkill of at least one profession`);
  }
}

// ==========================================================================
// Test 3: homeZone / specialtyAxis / specialty zoneId all resolve.
// ==========================================================================
console.log('\n--- Test 3: cross references resolve against ZONES / SPECIALTY_AXES ---');
{
  for (const def of Object.values(PROFESSIONS)) {
    if (def.homeZone != null) {
      assert(!!ZONES[def.homeZone], `'${def.id}'.homeZone '${def.homeZone}' exists in ZONES`);
    }
    if (def.specialtyAxis != null) {
      assert(!!SPECIALTY_AXES[def.specialtyAxis], `'${def.id}'.specialtyAxis '${def.specialtyAxis}' exists in SPECIALTY_AXES`);
    }
  }
  for (const axis of Object.values(SPECIALTY_AXES)) {
    for (const spec of Object.values(axis.specialties)) {
      if (spec.zoneId != null) {
        assert(!!ZONES[spec.zoneId], `specialty '${axis.id}.${spec.id}'.zoneId '${spec.zoneId}' exists in ZONES`);
      } else {
        assert(true, `specialty '${axis.id}.${spec.id}' tolerates a null zoneId`);
      }
    }
  }
}

// ==========================================================================
// Test 4: specialtiesFor() and professionDef() lookups.
// ==========================================================================
console.log('\n--- Test 4: specialtiesFor() / professionDef() lookups ---');
{
  const engineerSpecs = specialtiesFor('engineer');
  assert(engineerSpecs.length === 5, `specialtiesFor('engineer') returns five entries (got ${engineerSpecs.length})`);

  const operatorSpecs = specialtiesFor('operator');
  assert(Array.isArray(operatorSpecs) && operatorSpecs.length === 0, "specialtiesFor('operator') returns an empty array");

  assert(professionDef('operator') === PROFESSIONS.operator, "professionDef('operator') returns the operator def");
  assert(professionDef('nope') === undefined, "professionDef('nope') is undefined");

  assert(CROSS_SPECIALTY_EFFICIENCY === 0.5, 'CROSS_SPECIALTY_EFFICIENCY is 0.5');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
