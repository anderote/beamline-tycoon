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
// RF is reported twice — peak kW (what actually satisfies sinks, see
// utility/types/rfWaveguide.js) and duty-weighted average kW, since duty
// factor spans 1000x across the RF ladder and $/peak-kW alone misleads.
import { INFRASTRUCTURE_RAW } from '../src/data/infrastructure.raw.js';
import { UTILITY_PORTS_V2_BY_ID as UTILITY_PORTS_V2 } from '../src/data/utility-ports-v2.js';

const CAP_KEYS = ['capacity', 'pumpSpeed', 'coldCapacityW'];

const rows = [];
for (const [id, ports] of Object.entries(UTILITY_PORTS_V2)) {
  for (const [, port] of Object.entries(ports || {})) {
    if (port?.role !== 'source') continue;
    const key = CAP_KEYS.find(k => port.params?.[k] != null);
    if (!key) continue;
    const cap = port.params[key];
    const raw = INFRASTRUCTURE_RAW[id];
    if (!raw) { rows.push({ id, util: port.utility, cap, cost: null }); continue; }
    const cost = raw.cost?.funding ?? null;
    const tiles = (raw.gridW ?? 1) * (raw.gridH ?? 1);
    rows.push({
      id, name: raw.name, util: port.utility, cap, cost,
      energy: raw.energyCost ?? 0, tiles,
      perCap: cost != null && cap ? cost / cap : null,
      capPerTile: cap && tiles ? cap / tiles : null,
      energyPerCap: cap ? (raw.energyCost ?? 0) / cap : null,
      duty: port.params.dutyFactor,
    });
  }
}

const byUtil = {};
for (const r of rows) (byUtil[r.util] ||= []).push(r);

const money = n => n == null ? '     —' : '$' + (n / 1000).toFixed(0) + 'k';
for (const [util, list] of Object.entries(byUtil)) {
  list.sort((a, b) => (a.cap ?? 0) - (b.cap ?? 0));
  console.log(`\n=== ${util} ===`);
  console.log('  cap    cost      $/cap    cap/tile  kW-e/cap  tiles  name');
  let prevPerCap = null;
  for (const r of list) {
    const flagScale = prevPerCap != null && r.perCap != null && r.perCap > prevPerCap;
    console.log(
      `  ${String(r.cap).padStart(5)} ${money(r.cost).padStart(8)} ` +
      `${(r.perCap == null ? '—' : r.perCap.toFixed(0)).padStart(8)} ` +
      `${(r.capPerTile == null ? '—' : r.capPerTile.toFixed(1)).padStart(9)} ` +
      `${(r.energyPerCap == null ? '—' : r.energyPerCap.toFixed(4)).padStart(9)} ` +
      `${String(r.tiles ?? '—').padStart(6)}  ${r.name || r.id}` +
      (flagScale ? '   <<< SCALE INVERSION ($/cap rose)' : ''),
    );
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
