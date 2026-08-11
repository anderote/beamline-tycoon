// test/test-aggregate-single-source.js — one definition per derived quantity.
//
// Class of defect this closes: the same quantity computed differently at two
// call sites. Every case below shipped at least once — beam income billed the
// flattener's gap entries as machines, facility uptime divided per-beamline
// beam-on ticks by wall-clock ticks, data fees were charged on the raw rate
// while the tick derated it, and the power panel added per-category draws
// while the bill summed every placed unit.
//
// The accessors live in src/game/aggregates.js. These checks are mechanical:
// they re-derive each quantity the long way at the call sites that consume it
// and assert the two agree across a range of built-out states, so a future
// inline recomputation that drifts fails here rather than in the balance.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ECON, computeTickUpkeep, computeSystemStats, computeBeamIncome, dataFeeIncome } from '../src/game/economy.js';
import {
  PUMP_TYPES, poweredPlaceables, equipmentEnergyDraw, beamlineEnergyDraw,
  facilityEnergyDraw, pumpCount, hardwareNodes, hardwareNodeCount,
  beamlineUptime, facilityUptime, billedDataRate,
} from '../src/game/aggregates.js';

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
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// A range of states, from empty to a facility with pumps, RF, cryo, lab
// equipment and a running beamline draw. Each is a bare state object — the
// accessors and the economy functions both take one.
function states() {
  const mk = (placeables, totalEnergyCost = 0) => ({
    placeables, totalEnergyCost, beamline: [], staff: {}, staffCosts: {},
    resources: { funding: 0, reputation: 0 },
  });
  const p = (type, category, id) => ({ id, type, category });
  return [
    ['empty facility', mk([])],
    ['pumps only', mk([
      p('turboPump', 'infrastructure', 1),
      p('ionPump', 'infrastructure', 2),
      p('roughingPump', 'infrastructure', 3),
    ])],
    ['mixed hardware, beam off', mk([
      p('turboPump', 'infrastructure', 1),
      p('magnetron', 'infrastructure', 2),
      p('chiller', 'infrastructure', 3),
      p('rackIoc', 'equipment', 4),
      p('powerPanel', 'infrastructure', 5),
    ])],
    ['mixed hardware, beam running', mk([
      p('turboPump', 'infrastructure', 1),
      p('negPump', 'infrastructure', 2),
      p('cwKlystron', 'infrastructure', 3),
      p('coldBox4K', 'infrastructure', 4),
      p('rackIoc', 'equipment', 5),
      p('hvTransformer', 'infrastructure', 6),
    ], 420)],
    // Uncategorised lab items and decorations must be excluded from BOTH
    // the bill and the panel — the per-category version of the panel dropped
    // some of these and double-counted others.
    ['with uncategorised items', mk([
      p('turboPump', 'infrastructure', 1),
      p('oakTree', 'decoration', 2),
      { id: 3, type: 'opticalTable' },
      p('rackIoc', 'equipment', 4),
    ], 90)],
  ];
}

console.log('\n=== 1. Electrical draw has one definition ===\n');

for (const [label, state] of states()) {
  // The long way, at the two call sites that used to disagree.
  const inlineEquip = (state.placeables || [])
    .filter(x => x.category === 'equipment' || x.category === 'infrastructure')
    .reduce((s, x) => s + (COMPONENTS[x.type]?.energyCost || 0), 0);
  assertOk(near(equipmentEnergyDraw(state), inlineEquip),
    `${label}: equipmentEnergyDraw matches the inline sum (${inlineEquip} kW)`);

  const total = facilityEnergyDraw(state);
  assertOk(near(total, inlineEquip + beamlineEnergyDraw(state)),
    `${label}: facility draw is equipment + running beamlines (${total} kW)`);

  // The power bill and the power panel must quote the same number.
  const upkeep = computeTickUpkeep(state);
  const stats = computeSystemStats(state);
  assertOk(near(stats.power.totalDraw, total),
    `${label}: the power panel quotes the billed draw (${stats.power.totalDraw} kW)`);
  assertOk(near(upkeep.powerBill, ECON.powerBillPerKW * stats.power.totalDraw),
    `${label}: the power bill is the panel's draw at the posted rate`);
}

console.log('\n=== 2. Pump count has one definition ===\n');

for (const [label, state] of states()) {
  const inline = (state.placeables || [])
    .filter(x => x.category === 'equipment' || x.category === 'infrastructure')
    .filter(x => PUMP_TYPES.includes(x.type)).length;
  assertOk(pumpCount(state) === inline,
    `${label}: pumpCount matches the inline filter (${inline})`);

  const stats = computeSystemStats(state);
  const upkeep = computeTickUpkeep(state);
  assertOk(stats.vacuum.pumpCount === pumpCount(state),
    `${label}: the vacuum panel counts the pumps that are billed`);
  assertOk(near(upkeep.pumpUpkeep, stats.vacuum.pumpCount * ECON.pumpUpkeepEach),
    `${label}: the service fee is the panel's pump count at the posted rate`);
  // The per-type breakdown must add up to the total it sits next to.
  const detailSum = PUMP_TYPES.reduce(
    (s, t) => s + (state.placeables || []).filter(x => x.type === t).length, 0);
  assertOk(detailSum === stats.vacuum.pumpCount,
    `${label}: the panel's per-type pump rows sum to its total`);
}

// (PUMP_TYPES ids are checked against COMPONENTS by test-registry-integrity,
// which owns the hand-written-id sweep.)

console.log('\n=== 3. Hardware node count excludes flattener gaps ===\n');

{
  const flattened = [
    { id: 'a', type: 'source', kind: 'placement' },
    { id: 'g1', kind: 'drift', subL: 8 },
    { id: 'b', type: 'quadrupole', kind: 'placement' },
    { id: 'g2', kind: 'drift', subL: 12 },
    { id: 'c', type: 'detector', kind: 'placement' },
  ];
  assertOk(hardwareNodeCount(flattened) === 3,
    'a 3-machine line with 2 gaps counts 3 nodes, not 5');
  assertOk(hardwareNodes(flattened).every(n => n.kind !== 'drift'),
    'hardwareNodes yields no drift entries');

  // The income difference is the exploit that shipped: spacing the same
  // hardware further apart must not change what it earns.
  const bs = { beamQuality: 1, dataRate: 0 };
  const spacedOut = [...flattened, { id: 'g3', kind: 'drift', subL: 40 }];
  assertOk(computeBeamIncome(bs, hardwareNodeCount(flattened))
    === computeBeamIncome(bs, hardwareNodeCount(spacedOut)),
    'adding a gap does not add income');
  assertOk(computeBeamIncome(bs, flattened.length)
    > computeBeamIncome(bs, hardwareNodeCount(flattened)),
    'sanity: billing raw flattener entries would have paid more');
}

console.log('\n=== 4. Uptime: the facility figure is the mean of the parts ===\n');

for (const [label, beamStates, tick] of [
  ['one beamline', [{ beamOnTicks: 500 }], 1000],
  ['two beamlines, one idle', [{ beamOnTicks: 1000 }, { beamOnTicks: 0 }], 1000],
  ['three beamlines', [{ beamOnTicks: 900 }, { beamOnTicks: 450 }, { beamOnTicks: 300 }], 1000],
  ['tick 0', [{ beamOnTicks: 0 }], 0],
  ['no beamlines', [], 1000],
]) {
  const mean = beamStates.length
    ? beamStates.reduce((s, bs) => s + beamlineUptime(bs, tick), 0) / beamStates.length
    : 1;
  assertOk(near(facilityUptime(beamStates, tick), mean),
    `${label}: facilityUptime is the mean of beamlineUptime (${mean.toFixed(3)})`);
  assertOk(facilityUptime(beamStates, tick) <= 1,
    `${label}: facility uptime never exceeds 1`);
}

// The shipped bug: summing beam-on ticks over wall-clock ticks reads > 1 as
// soon as two beamlines are both running, which paid out `highAvailability`.
{
  const beamStates = [{ beamOnTicks: 1000 }, { beamOnTicks: 1000 }];
  const summed = beamStates.reduce((s, bs) => s + bs.beamOnTicks, 0) / 1000;
  assertOk(summed === 2 && facilityUptime(beamStates, 1000) === 1,
    'sanity: the summed form reads 2.0 where the accessor reads 1.0');
}

console.log('\n=== 5. Data rate: one billed number, end to end ===\n');

{
  const bs = { dataRate: 40 };
  assertOk(billedDataRate(bs, 1) === 40, 'full connectivity bills the physics rate');
  assertOk(billedDataRate(bs, 0) === 0, 'a cut fiber bills nothing');
  assertOk(billedDataRate(bs, 0.25) === 10, 'partial connectivity derates proportionally');
  assertOk(billedDataRate({}, 1) === 0, 'a beamline with no data rate bills nothing');
}

// End to end through a real Game: the fee credited by the tick must be the
// fee implied by the published effectiveDataRate, not by bs.dataRate.
{
  const g = new Game(new BeamlineRegistry(), { seed: 77 });
  g.state.resources.funding = 1e9;
  const entry = g.registry.createBeamline('linac', null);
  Object.assign(entry.beamState, { dataRate: 30, beamQuality: 1 });
  entry.status = 'running';
  g.state.infraCanRun = true;
  // No data-fiber network exists, so nodeQualities is empty and the
  // connectivity factor is 1.0 (nothing to derate) — the published value
  // must equal the raw one in that case, and never be left undefined.
  g.tick();
  const bs = g.registry.get(entry.id).beamState;
  assertOk(typeof bs.effectiveDataRate === 'number',
    'a running beamline publishes effectiveDataRate');
  assertOk(bs.effectiveDataRate === billedDataRate(bs, 1),
    'the published rate is the accessor applied to the physics rate');

  entry.status = 'stopped';
  g.tick();
  assertOk(g.registry.get(entry.id).beamState.effectiveDataRate === 0,
    'a stopped beamline publishes a zero billed rate');
}

// The fee itself. The beamline window's Finance tab re-derived it inline as
// `bs.dataRate * 0.1`, which drifted on both axes at once: 50x under the real
// ECON.dataFeeRate, and off the raw physics rate rather than the published
// effectiveDataRate, so a beamline with a cut fiber still advertised income.
// dataFeeIncome is now the only place the rate is applied.
{
  assertOk(dataFeeIncome(30) === 30 * ECON.dataFeeRate,
    'dataFeeIncome applies ECON.dataFeeRate');
  assertOk(dataFeeIncome(0) === 0 && dataFeeIncome(undefined) === 0,
    'no data rate, no fee');
  // Quality 0 zeroes the beam-quality term, leaving income == the fee term.
  assertOk(computeBeamIncome({ dataRate: 30, beamQuality: 0 }, 0) === dataFeeIncome(30),
    'the fee term of beam income IS dataFeeIncome');

  // A cut fiber must read as zero fees, which is only true if the display
  // quotes effectiveDataRate — the raw rate is unchanged by the cut.
  const bs = { dataRate: 30, effectiveDataRate: 0 };
  assertOk(dataFeeIncome(bs.effectiveDataRate) === 0
    && dataFeeIncome(bs.dataRate) === 150,
    'the two rates disagree on a cut fiber, so quoting the wrong one is visible');
}

// Source scan: the UI layer may not apply a fee rate of its own. Nothing under
// src/ui/ should multiply a data rate by a literal — this is the check that
// fails if a future readout reintroduces the placeholder.
{
  const uiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui');
  const offenders = [];
  for (const name of readdirSync(uiDir)) {
    if (!name.endsWith('.js')) continue;
    const src = readFileSync(join(uiDir, name), 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (/[Dd]ataRate\w*\s*\*\s*[\d.]/.test(line) || /[\d.]\s*\*\s*\w*[Dd]ataRate\w*/.test(line)) {
        offenders.push(`${name}:${i + 1}`);
      }
    }
  }
  assertOk(offenders.length === 0,
    `no src/ui file applies its own data-fee rate (found: ${offenders.join(', ') || 'none'})`);

  // Scoped to the Finance tab: the Overview/Stats tabs quote the raw physics
  // rate on purpose (labelled "Data Rate /s", it is an instrument reading),
  // but everything money-adjacent must read the billed value.
  const bw = readFileSync(join(uiDir, 'BeamlineWindow.js'), 'utf8');
  const finance = bw.slice(bw.indexOf('_renderFinance(el) {')).split(/\n {2}_render/)[0];
  assertOk(finance.length > 0 && finance.includes('dataFeeIncome('),
    'the Finance tab quotes dataFeeIncome for its User Fees readout');
  assertOk(finance.includes('effectiveDataRate') && !/bs\.dataRate/.test(finance),
    'the Finance tab reads effectiveDataRate, not the raw physics rate');
}

console.log('\n=== 6. Accessors and the live game agree ===\n');

// A real Game, ticked, must report the same aggregates through state as the
// accessors compute from that state — this is the check that catches a call
// site quietly re-deriving one of them inside Game.
{
  const g = new Game(new BeamlineRegistry(), { seed: 99 });
  g.state.resources.funding = 1e9;
  for (const type of ['turboPump', 'ionPump', 'rackIoc']) {
    for (let row = 4; row < 40; row++) {
      for (let col = 4; col < 40; col++) {
        if (g.placeInfraTile(col, row, 'concrete')
          && g.placePlaceable({ type, col, row })) { row = 99; break; }
      }
    }
  }
  for (let i = 0; i < 5; i++) g.tick();

  assertOk(pumpCount(g.state) === 2, `the live game has 2 pumps (got ${pumpCount(g.state)})`);
  const stats = computeSystemStats(g.state);
  assertOk(stats.vacuum.pumpCount === pumpCount(g.state),
    'live: the panel and the accessor agree on pump count');
  assertOk(near(stats.power.totalDraw, facilityEnergyDraw(g.state)),
    'live: the panel and the accessor agree on total draw');
  assertOk(near(computeTickUpkeep(g.state).powerBill,
    ECON.powerBillPerKW * facilityEnergyDraw(g.state)),
    'live: the bill and the accessor agree on total draw');
  assertOk(poweredPlaceables(g.state).length === 3,
    `live: 3 powered units placed (got ${poweredPlaceables(g.state).length})`);
  assertOk(near(g.state.uptimeFraction,
    facilityUptime(g.registry.getAll().map(e => e.beamState), g.state.tick)),
    'live: state.uptimeFraction is the accessor over the registry');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
