// Native physics + live revenue boundary: a service blueprint must deliver
// useful in-band beam to a paying, data-producing endpoint. Ideal utilities
// deliberately isolate the design; placement and utility tests run separately.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STOCK_DESIGNS } from '../src/data/stock-designs.js';
import { evaluate, checkBands } from '../scripts/eval-design.mjs';
import { computeBeamlineRevenueBreakdown } from '../src/game/economy.js';

const fundamentalResearch = new Set(['collider', 'blackHoleFactory']);
const rows = [];
for (const design of STOCK_DESIGNS) {
  const measured = evaluate(design);
  assert(!measured.error, `${design.id}: ${measured.error}`);
  const band = checkBands(design, measured);
  assert(band.ok, `${design.id}: ${band.problems.join('; ')}`);
  const revenue = computeBeamlineRevenueBreakdown(design.typeId, measured, design.components);
  if (fundamentalResearch.has(design.typeId)) {
    assert.equal(revenue.serviceRevenue, 0, `${design.id}: fundamental research is not a commercial service`);
    continue;
  }
  assert(revenue.serviceBaseRevenue > 0, `${design.id}: must have a paying endpoint`);
  assert(revenue.serviceRevenue > 0, `${design.id}: delivered beam must earn service revenue`);
  assert(measured.dataRate > 0, `${design.id}: endpoint must produce research data`);
  const disconnected = computeBeamlineRevenueBreakdown(design.typeId, measured, design.components, {
    dataConnectivity: 0,
  });
  assert.equal(disconnected.effectiveDataRate, 0, `${design.id}: data requires its connection`);
  rows.push({ design, measured, revenue });
  console.log(`${design.id}: $${revenue.serviceRevenue.toFixed(1)}/t service; ${measured.dataRate.toFixed(3)} data/t`);
}
// Process upgrades must improve paid output, rather than meeting the same
// revenue cap on the first useful machine. Compare the authored ladder.
const processing = rows.filter(r => r.design.typeId === 'ebeamProcessing')
  .sort((a, b) => a.design.tier - b.design.tier);
for (let i = 1; i < processing.length; i++) {
  assert(processing[i].revenue.serviceRevenue > processing[i - 1].revenue.serviceRevenue,
    'A processing upgrade must improve service income at its measured operating point');
}
console.log('Native stock service contracts passed');

// Exercise the actual New Game scenario plus native physics, rather than
// treating positive gross projections as proof of an advancing opening.
const opening = JSON.parse(execFileSync(process.execPath,
  ['scripts/audit-progression.mjs', '--native', '--ticks=100'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }));
assert(opening.firstBeamTick !== null && opening.firstBeamTick <= 60,
  'Minor Lab must start its beam within the opening minute');
assert(opening.firstDataTick !== null && opening.firstDataTick <= 100,
  'Minor Lab must collect usable data without an extra staffing intervention');
assert(opening.checkpoints.at(-1).resources.data > 0);
assert(opening.checkpoints.at(-1).economy.net > 0,
  'The working starter must cover its scientist and utilities');
console.log('Native Minor Lab opening passed');
