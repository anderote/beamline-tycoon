// test/test-staff-bio-card.js — formatCareer (pure) and the bio-card HTML
// builder that renderBioCard wraps in a DOM element. No jsdom/DOM harness
// exists in this repo's Node test suite (see scripts/run-tests.mjs), so this
// exercises the pure string-building core (bioCardHTML) directly rather than
// renderBioCard's document.createElement wrapper — see the report for why
// that split keeps renderBioCard itself trivial and untested-but-simple.

import assert from 'node:assert';
import { StaffMember } from '../src/game/staff/StaffMember.js';
import { formatCareer, bioCardHTML } from '../src/ui/StaffBioCard.js';

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

console.log('\n=== formatCareer ===\n');

{
  const m = new StaffMember({ id: 's1', profession: 'technician' });
  m.stats = { ticksWorked: 40, breakdowns: 0, repairs: 3, beamHours: 0, sparesMade: 0, analyses: 0, commissions: 0 };
  const rows = formatCareer(m);
  assertOk(rows.length === 2, `omits zero counters, keeps non-zero ones (got ${rows.length} rows)`);
  assertOk(rows.some(r => r.value === 40), 'ticksWorked row present with correct value');
  assertOk(rows.some(r => r.value === 3), 'repairs row present with correct value');
  assertOk(!rows.some(r => r.label.toLowerCase().includes('breakdown')), 'zero-valued breakdowns omitted');
}

{
  const m = new StaffMember({ id: 's2', profession: 'operator' });
  m.stats = { ticksWorked: 0, breakdowns: 0, repairs: 0, beamHours: 0, sparesMade: 0, analyses: 0, commissions: 0 };
  const rows = formatCareer(m);
  assertOk(Array.isArray(rows) && rows.length === 0, `all-zero stats yields an empty array (got ${rows.length})`);
}

console.log('\n=== bioCardHTML — specialty row ===\n');

{
  // Engineer with a specialty on the engineering axis: card must name it.
  const m = new StaffMember({ id: 's3', profession: 'engineer', specialty: 'rf' });
  const html = bioCardHTML(m);
  assertOk(html.includes('RF'), 'engineer card includes the specialty name (RF)');
  assertOk(html.includes('bio-card-specialty'), 'engineer card renders a specialty row');
}

{
  // Operator has no specialtyAxis at all: no specialty row, period.
  const m = new StaffMember({ id: 's4', profession: 'operator' });
  const html = bioCardHTML(m);
  assertOk(!html.includes('bio-card-specialty'), 'operator card renders no specialty row');
}

console.log('\n=== bioCardHTML — career Highlights (careerMilestones), fix round 1 ===\n');

{
  // A brand-new hire: every stat is 0, careerMilestones() returns [] — the
  // Highlights heading itself must not appear, the same "omit the whole
  // section, not just its contents" rule the Career stat block above
  // already follows for an all-zero StaffMember.
  const m = new StaffMember({ id: 's5', profession: 'technician' });
  const html = bioCardHTML(m);
  assertOk(!html.includes('bio-card-milestones') && !html.includes('>Highlights<'),
    'a brand-new hire renders no Highlights section at all (heading included)');
}

{
  // A veteran technician: past the repairs(10) milestone threshold. Full
  // mode must render the actual prose line, not just a stat count — this is
  // the whole point of Task 7 (the data existed before this fix round;
  // nothing rendered it).
  const m = new StaffMember({ id: 's6', profession: 'technician' });
  m.stats.repairs = 47;
  const html = bioCardHTML(m);
  assertOk(html.includes('bio-card-milestones'), 'a veteran renders the Highlights section');
  assertOk(html.includes('Recovered the beam 47 times.'),
    `the exact careerMilestones() prose line appears verbatim in the card (got: ${html.match(/bio-card-milestone">[^<]*/g)})`);
}

{
  // Compact mode (the hiring-list card) never renders Highlights, same as
  // it never renders the Career stat block — milestones belong to the full
  // inspector card only, per this fix round's own design note.
  const m = new StaffMember({ id: 's7', profession: 'technician' });
  m.stats.repairs = 47;
  const html = bioCardHTML(m, { compact: true });
  assertOk(!html.includes('bio-card-milestones'), 'compact mode never renders Highlights, even for a veteran');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
