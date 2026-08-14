// test/test-he-recovery.js — the helium recovery chain.
//
// Recovery used to be decorative: heRecovery was counted by economy.js and
// printed as "Yes/No" by the HUD, and the solver that owns LHe inventory never
// looked at it. A player could spend $4M and their helium bill did not move.
//
// The fix after that: heRecovery, the pre-existing $4M block, used to be a
// fifth CONTRIBUTOR at +0.20. The four chain parts sum to exactly the 0.90
// cap on their own, so once the chain was complete heRecovery bought nothing
// at any price — the same "spend money, nothing happens" defect one level up.
// It is now a CEILING-RAISER: the chain saturates at 0.70 without it and 0.90
// with it, so it is never redundant and always the last piece.
//
// What is pinned here:
//   1. the fraction accumulates one contribution per installed TYPE,
//   2. it caps at 0.70 without bulk storage and 0.90 with it,
//   3. storage ALWAYS changes the outcome for a completed chain — the
//      property whose absence was the bug,
//   4. duplicates of a type do NOT stack — five gas bags are one gas bag,
//   5. boil-off itself is unchanged (it is physics; recovery is logistics),
//   6. net inventory loss, and therefore refill spend, actually drops,
//   7. the table's keys are real components with the costs the chain assumes.

import desc, {
  HE_RECOVERY_CONTRIBUTION, HE_RECOVERY_CAP, HE_RECOVERY_CAP_NO_STORAGE,
  HE_STORAGE_TYPE,
  heRecoveryFraction, facilityHeRecoveryFraction,
  BOILOFF_PER_W_PER_TICK, RESERVOIR_MAX_L, LHE_COST_PER_L,
} from '../src/utility/types/cryoTransfer.js';
import { COMPONENTS } from '../src/data/components.js';
import { RESEARCH } from '../src/data/research.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

/** The four capture/clean/re-liquefy rungs. Sums to 0.90 uncapped. */
const CHAIN = ['heRecoveryHeader', 'heGasBag', 'hePurifier', 'heLiquefier'];
/** The chain plus the bulk-storage block that raises the ceiling to 0.90. */
const CHAIN_PLUS_STORAGE = [...CHAIN, HE_STORAGE_TYPE];

function mkNetwork(overrides) {
  return {
    id: 'net_x', utilityType: 'cryoTransfer', lineIds: [], ports: [],
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'cryo', params: { coldCapacityW: 400 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'cryo', params: { srfHeatW: 250 } }],
    ...overrides,
  };
}
/** A facility holding `types`, one placeable each unless `n` says otherwise. */
function mkWorld(types, n = 1) {
  const placeables = [];
  let i = 0;
  for (const t of types) {
    for (let k = 0; k < n; k++) placeables.push({ id: `pl${i++}`, type: t });
  }
  return { placeables };
}

// ==========================================================================
// Test 1: the fraction accumulates, one contribution per type.
// ==========================================================================
console.log('\n--- Test 1: accumulation ---');
{
  assert(heRecoveryFraction([]) === 0, 'nothing installed → 0');
  assert(approx(heRecoveryFraction(['heRecoveryHeader']), 0.25), 'header alone → 0.25');
  assert(approx(heRecoveryFraction(['heRecoveryHeader', 'heGasBag']), 0.40),
    'header + bag → 0.40');
  assert(approx(heRecoveryFraction(['heRecoveryHeader', 'heGasBag', 'hePurifier']), 0.60),
    'header + bag + purifier → 0.60');
  // The fourth rung takes the raw sum to 0.90, but the no-storage ceiling
  // clips it to 0.70. Test 2 pins that; here it is just the accumulation.
  assert(approx(heRecoveryFraction(['heRecoveryHeader', 'heGasBag', 'hePurifier', 'heLiquefier']), 0.70),
    'all four chain rungs → 0.70, clipped from a raw 0.90');
  // The storage block is NOT a contributor: on its own it collects nothing.
  assert(heRecoveryFraction([HE_STORAGE_TYPE]) === 0,
    'bulk storage alone → 0 (a tank with no header collects nothing)');
  assert(approx(heRecoveryFraction(['heRecoveryHeader', HE_STORAGE_TYPE]), 0.25),
    'storage adds no points of its own — header + storage is still 0.25');
  // Order is irrelevant — it is a set, not a sequence.
  assert(approx(heRecoveryFraction(['hePurifier', 'heGasBag']),
                heRecoveryFraction(['heGasBag', 'hePurifier'])), 'order does not matter');
  // Hardware that is not part of the chain contributes nothing.
  assert(heRecoveryFraction(['coldBox2K', 'heCompressor', 'ln2Dewar', 'cryomoduleHousing']) === 0,
    'unrelated cryo plant contributes nothing');
}

// ==========================================================================
// Test 2: two ceilings. Bulk storage is what moves 0.70 to 0.90.
// ==========================================================================
console.log('\n--- Test 2: ceiling is 0.70, or 0.90 with bulk storage ---');
{
  const raw = CHAIN.reduce((s, t) => s + HE_RECOVERY_CONTRIBUTION[t], 0);
  assert(approx(raw, 0.90), `the four chain rungs sum to 0.90 uncapped (got ${raw})`);
  assert(approx(HE_RECOVERY_CAP_NO_STORAGE, 0.70), 'ceiling without storage is 0.70');
  assert(approx(HE_RECOVERY_CAP, 0.90), 'ceiling with storage is 0.90');
  assert(HE_RECOVERY_CAP > HE_RECOVERY_CAP_NO_STORAGE, 'storage raises the ceiling');
  assert(HE_RECOVERY_CONTRIBUTION[HE_STORAGE_TYPE] === undefined,
    'heRecovery is not in the contribution table at all');

  assert(approx(heRecoveryFraction(CHAIN), 0.70),
    'a COMPLETE chain without storage saturates at 0.70, not 0.90');
  assert(approx(heRecoveryFraction(CHAIN_PLUS_STORAGE), HE_RECOVERY_CAP),
    'chain + storage → 0.90');
  assert(heRecoveryFraction(CHAIN_PLUS_STORAGE) < 1, 'you never recover everything');
}

// ==========================================================================
// Test 2b: THE BUG. Storage must change the outcome for a completed chain.
//
// The old table made heRecovery a +0.20 contributor, and the four rungs
// already summed to the 0.90 cap — so min() ate it and $4M bought exactly
// nothing. This is the property whose absence was the defect: adding storage
// to a finished chain has to move the number, and by a lot.
// ==========================================================================
console.log('\n--- Test 2b: storage is never redundant ---');
{
  const without = heRecoveryFraction(CHAIN);
  const with_ = heRecoveryFraction(CHAIN_PLUS_STORAGE);
  assert(with_ > without,
    `storage strictly improves a COMPLETE chain (${without} → ${with_})`);
  assert(approx(with_ - without, 0.20), 'and by 0.20, the full ceiling gap');

  // It is never redundant for ANY subset that is already at its ceiling, and
  // never harmful for one that is not.
  let monotone = true;
  for (let mask = 1; mask < (1 << CHAIN.length); mask++) {
    const subset = CHAIN.filter((_, i) => mask & (1 << i));
    if (heRecoveryFraction([...subset, HE_STORAGE_TYPE]) < heRecoveryFraction(subset)) {
      monotone = false;
    }
  }
  assert(monotone, 'storage never lowers the fraction for any subset of the chain');
  // Saturated subsets are exactly the ones storage pays off on.
  assert(heRecoveryFraction(['heRecoveryHeader', 'heGasBag', 'heLiquefier']) === 0.70,
    'header + bag + liquefier is already at the no-storage ceiling');
  assert(approx(heRecoveryFraction(['heRecoveryHeader', 'heGasBag', 'heLiquefier',
    HE_STORAGE_TYPE]), 0.70), 'storage releases it to its uncapped 0.70 — no change here');
  assert(heRecoveryFraction([...CHAIN, HE_STORAGE_TYPE])
       > heRecoveryFraction(['heRecoveryHeader', 'heGasBag', 'heLiquefier', HE_STORAGE_TYPE]),
    'the full chain plus storage still beats a partial chain plus storage');
}

// ==========================================================================
// Test 3: no stacking. The reward is for the chain, not for spamming a rung.
// ==========================================================================
console.log('\n--- Test 3: duplicates do not stack ---');
{
  assert(approx(heRecoveryFraction(['heGasBag', 'heGasBag', 'heGasBag']), 0.15),
    'three gas bags → 0.15, same as one');
  assert(approx(facilityHeRecoveryFraction(mkWorld(['heGasBag'], 5)), 0.15),
    'five placed gas bags → 0.15');
  assert(approx(facilityHeRecoveryFraction(mkWorld(['heRecoveryHeader'], 8)), 0.25),
    'eight placed headers → 0.25');
  // One of each beats many of the cheapest, which is the design intent.
  assert(facilityHeRecoveryFraction(mkWorld(['heRecoveryHeader', 'heGasBag']))
       > facilityHeRecoveryFraction(mkWorld(['heRecoveryHeader'], 20)),
    'a two-link chain beats twenty headers');
  assert(facilityHeRecoveryFraction(null) === 0, 'no world → 0');
  assert(facilityHeRecoveryFraction({}) === 0, 'empty world → 0');
}

// ==========================================================================
// Test 4: boil-off is untouched; only net loss moves.
// ==========================================================================
console.log('\n--- Test 4: boil-off unchanged, net loss reduced ---');
{
  const bare = desc.solve(mkNetwork(), { lheVolumeL: 400 }, mkWorld([]));
  const full = desc.solve(mkNetwork(), { lheVolumeL: 400 }, mkWorld(CHAIN_PLUS_STORAGE));
  // Same machine, chain complete but no bulk storage: capped at 0.70.
  const noStore = desc.solve(mkNetwork(), { lheVolumeL: 400 }, mkWorld(CHAIN));

  assert(approx(bare.flowState.boiloffL, full.flowState.boiloffL),
    `boil-off identical with and without recovery (${bare.flowState.boiloffL})`);
  assert(approx(bare.flowState.totalDemand, full.flowState.totalDemand),
    'heat load identical — recovery is not a thermal upgrade');
  assert(approx(bare.flowState.tempK, full.flowState.tempK),
    'bath temperature identical');

  assert(bare.flowState.heRecoveryFraction === 0, 'bare facility reports 0');
  assert(approx(full.flowState.heRecoveryFraction, 0.90),
    'full chain + storage reports 0.90');
  assert(approx(noStore.flowState.heRecoveryFraction, 0.70),
    'full chain without storage reports 0.70');
  assert(approx(full.flowState.netLheLossL, bare.flowState.netLheLossL * 0.10),
    'net loss is one tenth of the unrecovered case');
  // The storage block reaches the solver, not just the fraction helper: it is
  // a third less helium lost per tick, which is the whole point of the fix.
  assert(full.flowState.netLheLossL < noStore.flowState.netLheLossL,
    `storage cuts net loss further (${full.flowState.netLheLossL} < ${noStore.flowState.netLheLossL})`);
  assert(approx(noStore.flowState.netLheLossL, bare.flowState.netLheLossL * 0.30),
    'chain-only net loss is 30% of the unrecovered case');

  const bareDrop = 400 - bare.nextPersistentState.lheVolumeL;
  const fullDrop = 400 - full.nextPersistentState.lheVolumeL;
  assert(approx(bareDrop, BOILOFF_PER_W_PER_TICK * bare.flowState.totalDemand),
    'unrecovered drop is the full boil-off');
  assert(approx(fullDrop, bareDrop * 0.10), 'recovered drop is 10% of it');
}

// ==========================================================================
// Test 5: refill spend actually drops.
// ==========================================================================
console.log('\n--- Test 5: refill spend ---');
{
  // Run the same machine for the same 400 ticks in two facilities and price
  // the top-up each one needs at the end.
  function spendAfter(ticks, types) {
    const world = mkWorld(types);
    let persistent = { lheVolumeL: RESERVOIR_MAX_L, tempK: 4.5 };
    for (let i = 0; i < ticks; i++) {
      persistent = desc.solve(mkNetwork(), persistent, world).nextPersistentState;
    }
    const cost = desc.refillCost(persistent);
    return { lhe: persistent.lheVolumeL, funding: cost ? cost.funding : 0 };
  }

  const bare = spendAfter(400, []);
  const entry = spendAfter(400, ['heRecoveryHeader']);
  const chainOnly = spendAfter(400, CHAIN);
  const full = spendAfter(400, CHAIN_PLUS_STORAGE);

  assert(bare.funding > 0, `bare facility owes a refill (${bare.funding})`);
  assert(entry.funding < bare.funding,
    `one header already cuts the bill (${entry.funding} < ${bare.funding})`);
  assert(chainOnly.funding < entry.funding,
    `the full chain cuts it further (${chainOnly.funding} < ${entry.funding})`);
  // The bug, priced: buying the $4M storage block after a finished chain used
  // to leave this bill untouched. It must now fall.
  assert(full.funding < chainOnly.funding,
    `bulk storage cuts a COMPLETED chain's bill (${full.funding} < ${chainOnly.funding})`);
  // 0.90 recovery means a tenth of the helium, so a tenth of the money.
  assert(Math.abs(full.funding - bare.funding * 0.10) <= 2,
    `full chain pays ~10% of the bare bill (${full.funding} vs ${bare.funding})`);
  assert(full.lhe > bare.lhe, 'and the reservoir is still fuller');
  // Sanity: the bill is still priced per missing litre at the posted rate.
  assert(approx(bare.funding, Math.ceil((RESERVOIR_MAX_L - bare.lhe) * LHE_COST_PER_L)),
    'refill still charges LHE_COST_PER_L per missing litre');
}

// ==========================================================================
// Test 6: a quenched network boils nothing, recovered or not.
// ==========================================================================
console.log('\n--- Test 6: quench short-circuits both numbers ---');
{
  const r = desc.solve(mkNetwork(), { lheVolumeL: 5 }, mkWorld(CHAIN));
  assert(r.flowState.quenched, 'dry reservoir quenches');
  assert(r.flowState.boiloffL === 0, 'no boil-off while quenched');
  assert(r.flowState.netLheLossL === 0, 'and no net loss');
}

// ==========================================================================
// Test 7: the table describes real, buyable hardware.
// ==========================================================================
console.log('\n--- Test 7: the chain exists as components ---');
{
  const EXPECT = {
    heRecoveryHeader: { cost: 350000, energyCost: 0, gridW: 1, gridH: 4, requires: 'srfTechnology' },
    heGasBag:         { cost: 450000, energyCost: 0, gridW: 3, gridH: 3, requires: 'srfTechnology' },
    hePurifier:       { cost: 1200000, energyCost: 3, gridW: 2, gridH: 3, requires: 'cryoOptimization' },
    heLiquefier:      { cost: 3500000, energyCost: 12, gridW: 4, gridH: 5, requires: 'cryoOptimization' },
  };
  for (const key of [...Object.keys(HE_RECOVERY_CONTRIBUTION), HE_STORAGE_TYPE]) {
    assert(!!COMPONENTS[key], `${key} is a real component`);
  }
  // The ceiling-raiser is the priciest thing in the group, which is what makes
  // "it does nothing once the chain is done" the expensive kind of bug.
  const store = COMPONENTS[HE_STORAGE_TYPE] || {};
  assert(store.cost && store.cost.funding === 4000000, 'heRecovery still costs $4M');
  assert(store.requires === 'cryoOptimization', 'heRecovery is gated on cryoOptimization');
  for (const [id, want] of Object.entries(EXPECT)) {
    const c = COMPONENTS[id] || {};
    assert(c.cost && c.cost.funding === want.cost, `${id} costs $${want.cost}`);
    assert(c.energyCost === want.energyCost, `${id} draws ${want.energyCost} kW`);
    assert(c.gridW === want.gridW && c.gridH === want.gridH,
      `${id} is ${want.gridW}x${want.gridH}`);
    assert(c.requires === want.requires, `${id} is gated on ${want.requires}`);
    assert(c.category === 'cooling' && c.subsection === 'cryogenics',
      `${id} files under cooling/cryogenics`);
    // faces decals are dead on role-built components; declaring one is a lie.
    assert(c.faces === undefined, `${id} declares no faces decal`);
    const node = RESEARCH[want.requires];
    assert(node && (node.unlocks || []).includes(id),
      `${want.requires} advertises ${id}`);
  }
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
