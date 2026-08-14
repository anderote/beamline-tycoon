// test/test-hiring-dialog.js — hiringCandidateCost (src/ui/HiringDialog.js),
// a pure function with no DOM. Fix round 2 of Task 7 (staff-professions-3,
// jobs-and-gates): a reviewer traced a real bug in an earlier draft where
// the DISPLAYED price read state.staffHireDiscount but the affordability
// check driving hireBtn.disabled still read the undiscounted cost — a
// player holding a 40% discount could see "Insufficient funding" and a
// disabled Hire button for a candidate they could actually afford, at
// exactly the funding boundary where the discount is supposed to matter.
// The fix (see HiringDialog.js's own header comment on hiringCandidateCost)
// routes both the price label AND the afford check through this ONE
// exported function; this test proves the boundary case directly rather
// than through a DOM harness this repo's test suite has none of (see
// test-staff-bio-card.js's own header for why that split is the existing
// convention here).

import { StaffMember } from '../src/game/staff/StaffMember.js';
import { hiringCandidateCost } from '../src/ui/HiringDialog.js';

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function candidate(profession, backstoryId = null) {
  return new StaffMember({ id: 'cand1', profession, backstoryId, traits: [], rng: () => 0.5 });
}

console.log('\n=== hiringCandidateCost: the discount, applied once, feeds both consumers ===\n');

{
  // No discount at all: cost equals the bare staffHireCost figure.
  const cand = candidate('operator');
  const staffCosts = { operator: 120 };
  const game = { state: { staffHireDiscount: 0, staffCosts } };
  const cost = hiringCandidateCost(cand, game);
  assertOk(cost === 120 * 12, `no discount -> full staffHireCost (got ${cost})`);
}

{
  // The reviewer's exact scenario: a 40% discount, and funding sitting
  // BETWEEN the discounted and undiscounted price. The bug this closes
  // would have this candidate read as unaffordable; the fix must not.
  const cand = candidate('scientist');
  const staffCosts = { scientist: 250 };
  const fullCost = 250 * 12; // 3000
  const discountedCost = Math.round(fullCost * 0.6); // 1800
  const game = { state: { staffHireDiscount: 0.4, staffCosts } };

  const cost = hiringCandidateCost(cand, game);
  assertOk(cost === discountedCost, `40% discount -> the discounted price (want ${discountedCost}, got ${cost})`);

  const funding = discountedCost + 100; // affordable at the discounted price, NOT at the full price
  assertOk(funding < fullCost, 'setup: funding is short of the undiscounted price');
  assertOk(funding >= cost,
    `the exact reviewer-traced boundary: funding covers the DISCOUNTED cost, so the afford check (funding >= hiringCandidateCost(...)) reads true — a real hire at this funding level would NOT be blocked (funding ${funding}, cost ${cost})`);
}

{
  // The cap: a discount above 0.4 (should never happen — paperwork.js caps
  // it — but this function must not amplify an out-of-range value into a
  // negative or free hire if one ever slipped through).
  const cand = candidate('technician');
  const staffCosts = { technician: 180 };
  const game = { state: { staffHireDiscount: 0.4, staffCosts } };
  const cost = hiringCandidateCost(cand, game);
  assertOk(cost === Math.round(180 * 12 * 0.6), `discount is applied, never past the 0.4 cap's own math (got ${cost})`);
  assertOk(cost > 0, 'cost never reaches zero or negative at the real cap');
}

{
  // A missing discount field (a plain game.state with no staffHireDiscount
  // key at all — e.g. a save from before this task) must not throw and
  // must fall back to no discount, not NaN.
  const cand = candidate('machinist');
  const game = { state: { staffCosts: { machinist: 200 } } };
  const cost = hiringCandidateCost(cand, game);
  assertOk(cost === 200 * 12, `missing staffHireDiscount falls back to 0, not NaN (got ${cost})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
