// test/test-he-recovery.js — the helium recovery chain.
//
// Recovery used to be decorative: heRecovery was counted by economy.js and
// printed as "Yes/No" by the HUD, and the solver that owns LHe inventory never
// looked at it. A player could spend $4M and their helium bill did not move.
//
// What is pinned here:
//   1. the fraction accumulates one contribution per installed TYPE,
//   2. it caps at 0.90,
//   3. duplicates of a type do NOT stack — five gas bags are one gas bag,
//   4. boil-off itself is unchanged (it is physics; recovery is logistics),
//   5. net inventory loss, and therefore refill spend, actually drops,
//   6. the table's keys are real components with the costs the chain assumes.

import desc, {
  HE_RECOVERY_CONTRIBUTION, HE_RECOVERY_CAP,
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

const CHAIN = ['heRecoveryHeader', 'heGasBag', 'hePurifier', 'heRecovery', 'heLiquefier'];

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
  assert(approx(heRecoveryFraction(['heRecoveryHeader', 'heGasBag', 'hePurifier', 'heRecovery']), 0.80),
    '+ the original heRecovery block → 0.80');
  // Order is irrelevant — it is a set, not a sequence.
  assert(approx(heRecoveryFraction(['hePurifier', 'heGasBag']),
                heRecoveryFraction(['heGasBag', 'hePurifier'])), 'order does not matter');
  // Hardware that is not part of the chain contributes nothing.
  assert(heRecoveryFraction(['coldBox2K', 'heCompressor', 'ln2Dewar', 'cryomoduleHousing']) === 0,
    'unrelated cryo plant contributes nothing');
}

// ==========================================================================
// Test 2: the cap. The five contributions sum to 1.10; you never get it all.
// ==========================================================================
console.log('\n--- Test 2: cap at 0.90 ---');
{
  const raw = CHAIN.reduce((s, t) => s + HE_RECOVERY_CONTRIBUTION[t], 0);
  assert(approx(raw, 1.10), `table sums to 1.10 uncapped (got ${raw})`);
  assert(approx(heRecoveryFraction(CHAIN), HE_RECOVERY_CAP), 'everything installed → 0.90, not 1.10');
  assert(heRecoveryFraction(CHAIN) < 1, 'you never recover everything');
  // The four-part chain reaches the cap on its own.
  assert(approx(heRecoveryFraction(['heRecoveryHeader', 'heGasBag', 'hePurifier', 'heLiquefier']), 0.90),
    'header + bag + purifier + liquefier → 0.90 without the $4M block');
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
  const full = desc.solve(mkNetwork(), { lheVolumeL: 400 }, mkWorld(CHAIN));

  assert(approx(bare.flowState.boiloffL, full.flowState.boiloffL),
    `boil-off identical with and without recovery (${bare.flowState.boiloffL})`);
  assert(approx(bare.flowState.totalDemand, full.flowState.totalDemand),
    'heat load identical — recovery is not a thermal upgrade');
  assert(approx(bare.flowState.tempK, full.flowState.tempK),
    'bath temperature identical');

  assert(bare.flowState.heRecoveryFraction === 0, 'bare facility reports 0');
  assert(approx(full.flowState.heRecoveryFraction, 0.90), 'full chain reports 0.90');
  assert(approx(full.flowState.netLheLossL, bare.flowState.netLheLossL * 0.10),
    'net loss is one tenth of the unrecovered case');

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
  const full = spendAfter(400, CHAIN);

  assert(bare.funding > 0, `bare facility owes a refill (${bare.funding})`);
  assert(entry.funding < bare.funding,
    `one header already cuts the bill (${entry.funding} < ${bare.funding})`);
  assert(full.funding < entry.funding,
    `the full chain cuts it further (${full.funding} < ${entry.funding})`);
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
  for (const key of Object.keys(HE_RECOVERY_CONTRIBUTION)) {
    assert(!!COMPONENTS[key], `${key} is a real component`);
  }
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
