// scripts/infra-balance-audit.mjs — cost/capacity ladder check for infra sources.
//
// Run: node scripts/infra-balance-audit.mjs
//
// Joins every `role: 'source'` port in utility-ports-v2.js to its placeable in
// infrastructure.raw.js and prints, per utility, the cost per unit capacity,
// capacity per tile, and electrical draw per unit capacity — sorted by capacity.
//
// The invariant it checks: buying a BIGGER unit should be cheaper per unit of
// capacity. Any rung where $/cap rises as capacity rises is flagged
// SCALE INVERSION, because it means spamming the small unit strictly dominates.
//
// Not every flag is a bug. Known-intentional inversions:
//   - UPS ($5,000/kW): backup for critical loads, not bulk supply.
//   - 2K cold box vs 4K: sub-lambda helium really does cost more per watt.
//   - data "sources" like the timing system and LLRF controller: bought for
//     what they do, not for their bandwidth.
//
// RF IS CHECKED WITHIN BAND GROUPS, NOT DOWN THE WHOLE COLUMN. Every other
// utility sells one fungible commodity, so a single $/cap column is the right
// ladder. RF does not: a kilowatt at X-band is genuinely harder to make than a
// kilowatt at L-band, and the pricing model in infrastructure.raw.js charges
// sqrt(f) for it. Comparing a C-band tube against an L-band tube therefore
// says nothing about scale economics, and flagging it as SCALE INVERSION was a
// false positive that fired on units priced exactly to the rule. So RF sources
// are bucketed by TOP BAND — the highest band each source covers, which is the
// one setting its frequency premium — and monotonicity is required only inside
// a bucket, where frequency is held constant and $/cap really must fall with
// capacity. The band column makes the dimension visible; cross-band ordering
// in the summary is informational and is not flagged.
//
// RF is also reported a third time by duty-weighted average kW, since duty
// factor spans 1000x across the ladder and $/peak-kW alone misleads. Peak kW
// is what actually satisfies sinks — see utility/types/rfWaveguide.js.
import { INFRASTRUCTURE_RAW } from '../src/data/infrastructure.raw.js';
import { UTILITY_PORTS_V2_BY_ID as UTILITY_PORTS_V2 } from '../src/data/utility-ports-v2.js';
import { RF_BANDS } from '../src/utility/types/rfWaveguide.js';

const CAP_KEYS = ['capacity', 'pumpSpeed', 'coldCapacityW'];

const rows = [];
for (const [id, ports] of Object.entries(UTILITY_PORTS_V2)) {
  // A component may expose SEVERAL source ports of the same utility — a
  // distribution panel with four 10 kW feeders is one $60k purchase supplying
  // 40 kW, not four $60k purchases supplying 10 kW each. Sum capacity per
  // (component, utility) before costing, or every multi-outlet unit reports a
  // $/cap inflated by its own outlet count and trips a bogus inversion.
  const perUtil = new Map();
  for (const [, port] of Object.entries(ports || {})) {
    if (port?.role !== 'source') continue;
    const key = CAP_KEYS.find(k => port.params?.[k] != null);
    if (!key) continue;
    const acc = perUtil.get(port.utility);
    if (acc) { acc.cap += port.params[key]; continue; }
    perUtil.set(port.utility, { cap: port.params[key], port });
  }

  for (const [utility, { cap, port }] of perUtil) {
    const raw = INFRASTRUCTURE_RAW[id];
    if (!raw) { rows.push({ id, util: utility, cap, cost: null }); continue; }
    const cost = raw.cost?.funding ?? null;
    const tiles = (raw.gridW ?? 1) * (raw.gridH ?? 1);
    rows.push({
      id, name: raw.name, util: port.utility, cap, cost,
      energy: raw.energyCost ?? 0, tiles,
      perCap: cost != null && cap ? cost / cap : null,
      capPerTile: cap && tiles ? cap / tiles : null,
      energyPerCap: cap ? (raw.energyCost ?? 0) / cap : null,
      duty: port.params.dutyFactor,
      // UTILITY_PORTS_V2_BY_ID holds declared specs; `bands` is only filled in
      // by getUtilityPortsV2() at read time, so fall back to the raw source of
      // truth it would have copied from.
      bands: port.params.bands ?? raw.rfBands,
    });
  }
}

const byUtil = {};
for (const r of rows) (byUtil[r.util] ||= []).push(r);

const money = n => n == null ? '     —' : '$' + (n / 1000).toFixed(0) + 'k';

const COLS = '  cap    cost      $/cap    cap/tile  kW-e/cap  tiles  name';
function printRow(r, flagScale, suffix = '') {
  console.log(
    `  ${String(r.cap).padStart(5)} ${money(r.cost).padStart(8)} ` +
    `${(r.perCap == null ? '—' : r.perCap.toFixed(0)).padStart(8)} ` +
    `${(r.capPerTile == null ? '—' : r.capPerTile.toFixed(1)).padStart(9)} ` +
    `${(r.energyPerCap == null ? '—' : r.energyPerCap.toFixed(4)).padStart(9)} ` +
    `${String(r.tiles ?? '—').padStart(6)}  ${r.name || r.id}${suffix}` +
    (flagScale ? '   <<< SCALE INVERSION ($/cap rose)' : ''),
  );
}

// --- RF band bookkeeping -------------------------------------------------
const BAND_ORDER = RF_BANDS.map(b => b.id);
const BAND_BY_ID = Object.fromEntries(RF_BANDS.map(b => [b.id, b]));
/** Geometric mean of a band's range, in MHz — the price model's f_band. */
const bandFreqMHz = b => Math.sqrt(b.loMHz * b.hiMHz);
const F_REF = bandFreqMHz(BAND_BY_ID.lband);
/** The highest band a source covers: the one that sets its frequency premium. */
function topBand(r) {
  let best = null, bestIdx = -1;
  for (const id of (r.bands || [])) {
    const i = BAND_ORDER.indexOf(id);
    if (i > bestIdx) { bestIdx = i; best = id; }
  }
  return best;
}
const bandLabel = id => BAND_BY_ID[id]?.label ?? '—';

for (const [util, list] of Object.entries(byUtil)) {
  list.sort((a, b) => (a.cap ?? 0) - (b.cap ?? 0));

  // RF: bucket by top band and check monotonicity only inside a bucket.
  // Frequency is a real cost axis, so the whole-column check is meaningless.
  if (util === 'rfWaveguide') {
    console.log('\n=== rfWaveguide, by top band ===');
    console.log('  $/cap must fall with capacity WITHIN a band — across bands it need not,');
    console.log('  because the price model charges sqrt(f) for frequency.');
    console.log('  (The Gyrotron is exempt from that premium — cyclotron resonance in an');
    console.log('   oversized cavity is why it does not lose power with frequency.)');
    const groups = new Map();
    for (const r of list) {
      const b = topBand(r);
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b).push(r);
    }
    const ordered = [...groups.keys()].sort(
      (a, b) => BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b));
    for (const band of ordered) {
      const b = BAND_BY_ID[band];
      const f = b ? bandFreqMHz(b) : null;
      const prem = f ? Math.sqrt(f / F_REF) : null;
      console.log(
        `\n  -- ${bandLabel(band)} top band` +
        (f ? `  (f_geo ${(f / 1000).toFixed(2)} GHz, sqrt(f/f_L) = ${prem.toFixed(2)}x)` : ''));
      console.log(COLS);
      let prevPerCap = null;
      for (const r of groups.get(band)) {
        const flagScale = prevPerCap != null && r.perCap != null && r.perCap > prevPerCap;
        printRow(r, flagScale, `  [${(r.bands || []).map(x => bandLabel(x)).join(' ')}]`);
        if (r.perCap != null) prevPerCap = r.perCap;
      }
    }
    // Whole-ladder view, informational only — never flagged.
    console.log('\n  -- whole ladder (informational; cross-band $/cap is NOT an inversion)');
    console.log('  cap    cost      $/cap  top band  name');
    for (const r of list) {
      console.log(
        `  ${String(r.cap).padStart(5)} ${money(r.cost).padStart(8)} ` +
        `${(r.perCap == null ? '—' : r.perCap.toFixed(0)).padStart(8)}  ` +
        `${bandLabel(topBand(r)).padStart(7)}  ${r.name || r.id}`);
    }
    continue;
  }

  console.log(`\n=== ${util} ===`);
  console.log(COLS);
  let prevPerCap = null;
  for (const r of list) {
    const flagScale = prevPerCap != null && r.perCap != null && r.perCap > prevPerCap;
    printRow(r, flagScale);
    if (r.perCap != null) prevPerCap = r.perCap;
  }
}

// RF peak-kW is misleading: duty factor varies 1000x. Average power is the
// metric that actually compares a pulsed klystron to a CW one.
console.log('\n=== rfWaveguide, duty-weighted (avg kW = cap x duty) ===');
console.log('  peak  duty     avgkW      cost      $/avgkW  name');
for (const r of byUtil.rfWaveguide.slice().sort((a, b) => (a.cap * a.duty) - (b.cap * b.duty))) {
  const avg = r.cap * (r.duty ?? 1);
  console.log(
    `  ${String(r.cap).padStart(4)} ${String(r.duty).padStart(6)} ${avg.toFixed(3).padStart(9)} ` +
    `${money(r.cost).padStart(9)} ${(r.cost / avg).toFixed(0).padStart(11)}  ${r.name}`);
}
