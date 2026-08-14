// test/test-staff-rename-sweep.js
//
// Regression test for the role -> profession sweep across Game.js, the
// staffing gate, agent observation, and the UI/renderer layers. Covers:
//   1. A fresh Game seeds exactly one staff member, profession 'operator'.
//   2. state.staff has all six profession keys, no old plural keys.
//   3. state.staffCosts has all six profession keys; the four pre-existing
//      professions keep their original $/tick values (120/180/250/300).
//   4. Hiring each of the six professions via hireStaffMember succeeds given
//      sufficient funding, and bumps the right count.
//   5. serialize() -> load() round-trips the roster with professions and
//      specialties intact.
//   6. Grep guards: no source file reads a staff `.role`, and the old plural
//      staff-count keys are gone from src/.

import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { PROFESSIONS } from '../src/data/professions.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeGame(seed) {
  const g = new Game(new BeamlineRegistry(), { seed });
  g.state.resources.funding = 1e9;
  return g;
}

console.log('\n=== Fresh Game staff seed ===\n');
{
  const g = makeGame(1);
  assertOk(g.state.staffMembers.length === 1, 'seeds exactly one staff member');
  assertOk(g.state.staffMembers[0].profession === 'operator',
    `seeded member profession is 'operator' (got ${g.state.staffMembers[0].profession})`);
}

console.log('\n=== state.staff / state.staffCosts keying ===\n');
{
  const g = makeGame(2);
  const professionIds = Object.keys(PROFESSIONS);
  for (const id of professionIds) {
    assertOk(id in g.state.staff, `state.staff has key '${id}'`);
    assertOk(id in g.state.staffCosts, `state.staffCosts has key '${id}'`);
  }
  for (const plural of ['operators', 'technicians', 'scientists', 'engineers']) {
    assertOk(!(plural in g.state.staff), `state.staff has no old plural key '${plural}'`);
    assertOk(!(plural in g.state.staffCosts), `state.staffCosts has no old plural key '${plural}'`);
  }
  assertOk(g.state.staffCosts.operator === 120, `staffCosts.operator === 120 (got ${g.state.staffCosts.operator})`);
  assertOk(g.state.staffCosts.technician === 180, `staffCosts.technician === 180 (got ${g.state.staffCosts.technician})`);
  assertOk(g.state.staffCosts.scientist === 250, `staffCosts.scientist === 250 (got ${g.state.staffCosts.scientist})`);
  assertOk(g.state.staffCosts.engineer === 300, `staffCosts.engineer === 300 (got ${g.state.staffCosts.engineer})`);
}

console.log('\n=== Hiring each of the six professions ===\n');
{
  const g = makeGame(3);
  for (const id of Object.keys(PROFESSIONS)) {
    const before = g.state.staff[id];
    // Inject a candidate of this profession directly (bypasses the random
    // 3-candidate pool so every profession gets exercised deterministically).
    const cand = g.state.staffCandidates[0];
    cand.profession = id;
    cand.backstoryId = null;
    const res = g.hireStaffMember(cand.id);
    assertOk(res !== false, `hireStaffMember succeeds for profession '${id}'`);
    assertOk(g.state.staff[id] === before + 1,
      `state.staff.${id} bumped by hire (was ${before}, now ${g.state.staff[id]})`);
  }
}

console.log('\n=== serialize() -> load() round-trip ===\n');
{
  const gA = makeGame(4);
  // Hire one of each profession so the roster carries every profession +
  // any rolled specialty through the round trip.
  for (const id of Object.keys(PROFESSIONS)) {
    if (gA.state.staffCandidates.length === 0) gA._refreshStaffCandidates();
    const cand = gA.state.staffCandidates[0];
    cand.profession = id;
    gA.hireStaffMember(cand.id);
  }
  const before = gA.state.staffMembers.map(m => ({
    id: m.id, profession: m.profession, specialty: m.specialty, backstoryId: m.backstoryId,
  }));
  localStorage.setItem('beamlineTycoon', gA.serialize());

  const gB = makeGame(5);
  assertOk(gB.load(), 'load() succeeds on the saved payload');
  const after = gB.state.staffMembers.map(m => ({
    id: m.id, profession: m.profession, specialty: m.specialty, backstoryId: m.backstoryId,
  }));
  const beforeSorted = [...before].sort((a, b) => a.id.localeCompare(b.id));
  const afterSorted = [...after].sort((a, b) => a.id.localeCompare(b.id));
  try {
    assert.deepStrictEqual(afterSorted, beforeSorted);
    assertOk(true, 'roster professions/specialties/backstoryId round-trip through save/load');
  } catch (e) {
    assertOk(false, 'roster professions/specialties/backstoryId round-trip through save/load\n' + e.message);
  }
}

console.log('\n=== Grep guards ===\n');
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcRoot = path.join(here, '..', 'src');
  const staffRoleRead = /(\bm|\bs|\bc|member|cand)\.role\b/;
  const staffRoleEquals = /\.role\s*===\s*'(operator|technician|scientist|engineer)'/;
  const pluralKey = /\b(operators|technicians|scientists|engineers)\s*:/;

  const hits = [];
  const pluralHits = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.js')) continue;
      const text = readFileSync(full, 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (staffRoleRead.test(line) || staffRoleEquals.test(line)) {
          hits.push(`${path.relative(srcRoot, full)}:${i + 1}: ${line.trim()}`);
        }
        // Plural staff-count keys, ignoring comments.
        const codePart = line.split('//')[0];
        if (pluralKey.test(codePart)) {
          pluralHits.push(`${path.relative(srcRoot, full)}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  }
  walk(srcRoot);

  assertOk(hits.length === 0, `no source file reads a staff .role${hits.length ? '\n    ' + hits.join('\n    ') : ''}`);
  assertOk(pluralHits.length === 0, `no source file has old plural staff-count keys${pluralHits.length ? '\n    ' + pluralHits.join('\n    ') : ''}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
