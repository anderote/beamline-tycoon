// test/test-convergence-regressions-2.js
//
// Second convergence-review pass. Same shape as test-convergence-regressions.js:
// every block pins one confirmed defect, headless against real modules.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { SolveRunner } from '../src/utility/solve-runner.js';
import { UtilityRegistry } from '../src/utility/registry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { computeSystemStats, computeTickUpkeep, ECON } from '../src/game/economy.js';
import { _getFurnishingTier, getLabResearchTier, getResearchSpeedMultiplier } from '../src/game/research.js';
import { ZONE_FURNISHINGS, itemMatchesZone } from '../src/data/facility.js';
import { RESEARCH_LAB_MAP } from '../src/data/research.js';
import { DesignPlacer } from '../src/ui/DesignPlacer.js';
import { BeamlineDesigner } from '../src/ui/BeamlineDesigner.js';
import { pipeRefund } from '../src/beamline/BeamlineSystem.js';
import * as coolingWater from '../src/utility/types/coolingWater.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeGame(seed, funding = 1e9) {
  const g = new Game(new BeamlineRegistry(), { seed });
  g.state.resources.funding = funding;
  // Fix round 1 (staff-professions-3, task 5): a beamline component now also
  // costs spares (ceil(fundingCost/5000)) alongside funding — fund this the
  // same generous way funding above is, so placements in this file are
  // gated only by what it's actually testing.
  g.state.resources.spares = 1e9;
  return g;
}

// Straight source -> faraday cup on the first free row at or after `row`.
function makeLine(g, row, from = -6, to = 6) {
  for (let r = row; r < row + 40; r++) {
    const src = g.beamline.placeJunction({ type: 'source', col: from, row: r, dir: 3, free: true, silent: true });
    if (!src) continue;
    const cup = g.beamline.placeJunction({ type: 'faradayCup', col: to, row: r, dir: 3, free: true, silent: true });
    if (!cup) { g.removePlaceable(src); continue; }
    const pipeId = g.beamline.drawPipe(
      { junctionId: src, portName: 'exit' },
      { junctionId: cup, portName: 'entry' },
      [{ col: from, row: r }, { col: to, row: r }],
    );
    if (!pipeId) { g.removePlaceable(src); g.removePlaceable(cup); continue; }
    return { src, cup, pipeId, row: r };
  }
  return { src: null, cup: null, pipeId: null, row: null };
}

const flush = () => new Promise((res) => queueMicrotask(res));

// ---------------------------------------------------------------------------
console.log('\n=== 1. Building a beamline recalcs its per-entry beamState ===\n');
// Regression: only _recalcMainBeamGraph ran on a build (state.mainBeamState),
// so entry.beamState — which _tickBeamline bills income, data and objectives
// off — stayed frozen at makeDefaultBeamState() until the next page reload.
{
  const g = makeGame(201);
  const line = makeLine(g, 20);
  assert(!!line.pipeId, 'setup: source + pipe + cup built');
  await flush();

  const entry = g.registry.getAll()[0];
  assert(!!entry, 'setup: a registry entry exists for the machine');
  assert(entry.beamState.totalLength > 0,
    `pipe draw recalcs totalLength (got ${entry.beamState.totalLength})`);

  const lenBefore = entry.beamState.totalLength;
  g.beamline.placeOnPipe(line.pipeId, { type: 'quadrupole', position: 0.5, mode: 'snap', free: true });
  await flush();
  assert(entry.beamState.totalLength !== lenBefore || entry.beamState.totalEnergyCost > 0,
    'an on-pipe placement recalcs the entry too');

  // The aggregate roll-up the HUD/objectives read must follow.
  assert(g.state.totalLength === entry.beamState.totalLength,
    'the facility aggregate matches the per-entry state');
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. Lab equipment counts toward the research lab tier ===\n');
// Regression: state.zoneFurnishings is the kind === 'furnishing' subset, and
// all 43 LAB items are kind 'equipment', so _getFurnishingTier returned 0 for
// every research lab and 31 RESEARCH nodes were permanently unstartable.
{
  const g = makeGame(202);

  // Every research category maps to a lab, and no lab has a single
  // kind:'furnishing' item — this is why the old filter could never work.
  for (const labType of new Set(Object.values(RESEARCH_LAB_MAP))) {
    const eligible = Object.values(ZONE_FURNISHINGS).filter(d => itemMatchesZone(d, labType));
    assert(eligible.length > 0 && eligible.every(d => d.kind === 'equipment'),
      `${labType}: all ${eligible.length} buildable items are kind 'equipment'`);
  }

  const opticsDefs = Object.values(ZONE_FURNISHINGS)
    .filter(d => itemMatchesZone(d, 'opticsLab')).slice(0, 5);
  let placed = 0;
  for (let i = 0; i < opticsDefs.length; i++) {
    if (g.placePlaceable({ type: opticsDefs[i].id, col: 12 + i * 2, row: -18, free: true, silent: true })) placed++;
  }
  assert(placed >= 5, `setup: placed ${placed} optics-lab items`);
  assert(g.state.zoneItems.length >= placed, 'state.zoneItems sees them');
  assert(g.state.zoneFurnishings.length === 0,
    'state.zoneFurnishings stays the furnishing-only render view (no double render)');
  assert(_getFurnishingTier('opticsLab', g.state.zoneItems) === 3,
    `5 optics items = furnishing tier 3 (got ${_getFurnishingTier('opticsLab', g.state.zoneItems)})`);

  // With tiles as well, the lab tier and the speed table both come alive.
  g.state.zoneConnectivity = { opticsLab: { tileCount: 96, tier: 4, active: true } };
  assert(getLabResearchTier('opticsLab', g.state) === 3,
    'lab tier = min(tile tier, furnishing tier)');
  assert(getResearchSpeedMultiplier('fastKickers', g.state) !== null,
    'a late optics node is startable in a furnished Optics Lab');
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. DesignPlacer: charged once, wired up, rolled back ===\n');
// Three regressions in one commit site: placeJunction ran without free:true so
// every module was charged twice; the junction `dir` was 180 degrees off the
// walk direction so every connecting pipe was rejected port_mismatch; and a
// mid-walk failure left orphan modules standing with no undo entry.
{
  const g = makeGame(203, 5e6);
  const dp = new DesignPlacer(g, { _renderCursors() {} });
  const design = { name: 'T', components: [{ type: 'source' }, { type: 'faradayCup' }] };

  // Find a clear spot the preview accepts.
  dp.start(design);
  let row = null;
  for (let r = -30; r < 30; r++) {
    dp.setPosition(-20, r);
    if (dp.valid && dp.foundationTiles.length > 0) { row = r; break; }
  }
  assert(row !== null, 'setup: found a valid preview position');

  assert(dp.previewTiles.every(t => Number.isInteger(t.col) && Number.isInteger(t.row)),
    'preview footprint tiles are on integer coordinates');

  const quoted = dp.totalCost;
  const before = g.state.resources.funding;
  const ok = dp.confirm();
  await flush();
  const spent = before - g.state.resources.funding;
  assert(ok === true, 'confirm() succeeds');
  assert(spent === quoted, `charged exactly the quoted price (quoted ${quoted}, spent ${spent})`);
  assert(g.state.beamPipes.length === 1,
    `the design's modules are connected by a pipe (got ${g.state.beamPipes.length})`);
  assert(g.state.floors.every(f => Number.isInteger(f.col) && Number.isInteger(f.row)),
    'no concrete was poured at fractional coordinates');

  // Three modules means two pipes: running them anchor-to-anchor made the
  // second one overlap the first on the shared junction tile.
  for (let d = 0; d < 4; d++) {
    const g3 = makeGame(203, 1e9);
    const dp3 = new DesignPlacer(g3, { _renderCursors() {} });
    dp3.start({ name: 'T3', components: [{ type: 'source' }, { type: 'dipole' }, { type: 'faradayCup' }] });
    dp3.direction = d;
    let ok3 = false;
    for (let r = -30; r < 30; r++) { dp3.setPosition(-20, r); if (dp3.valid) { ok3 = true; break; } }
    if (!ok3) { assert(false, `dir ${d}: found a valid preview position`); continue; }
    const q3 = dp3.totalCost;
    const f3 = g3.state.resources.funding;
    const ok = dp3.confirm();
    assert(ok === true && g3.state.beamPipes.length === 2,
      `dir ${d}: a 3-module design with a bend is fully wired (${g3.state.beamPipes.length} pipes)`);
    assert(f3 - g3.state.resources.funding === q3,
      `dir ${d}: charged the quoted price including pipes`);
  }

  // A design that cannot be completed leaves nothing behind.
  const g2 = makeGame(203, 5e6);
  const dp2 = new DesignPlacer(g2, { _renderCursors() {} });
  dp2.start({ name: 'T2', components: [{ type: 'source' }, { type: 'faradayCup' }] });
  // Block the second module's footprint so placeJunction fails mid-walk.
  let blocker = null;
  for (let r = -30; r < 30 && !blocker; r++) {
    dp2.setPosition(-20, r);
    if (!dp2.valid) continue;
    const at = dp2.previewTiles[dp2.previewTiles.length - 1];
    blocker = g2.beamline.placeJunction({
      type: 'beamStop', col: at.col, row: at.row, free: true, silent: true,
    });
  }
  assert(!!blocker, 'setup: blocked the second module\'s tile');
  dp2.valid = true; // the preview now (correctly) reports the collision
  const beamlineBefore = g2.state.placeables.filter(p => p.category === 'beamline').length;
  const fundingBefore = g2.state.resources.funding;
  const floorsBefore = g2.state.floors.length;
  const failed2 = dp2.confirm();
  assert(failed2 === false, 'a design that cannot be completed reports failure');
  assert(g2.state.placeables.filter(p => p.category === 'beamline').length === beamlineBefore,
    'no orphan modules survive the failure');
  assert(g2.state.floors.length === floorsBefore, 'no orphan concrete survives the failure');
  assert(g2.state.resources.funding === fundingBefore, 'nothing was charged');
  assert(dp2.active === false, 'the placer deactivates rather than re-firing on the next click');
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. Demolishing a junction pays for what it destroys ===\n');
// Regression: removePlaceable raw-filtered state.beamPipes, so the pipe and
// every million-dollar cavity on it were destroyed for zero refund and the
// utility lines wired to them kept pointing at ids present nowhere in state.
{
  const g = makeGame(205);
  const line = makeLine(g, -25);
  assert(!!line.pipeId, 'setup: machine built');
  const plId = g.beamline.placeOnPipe(line.pipeId, {
    type: 'rfCavity', position: 0.5, mode: 'snap', free: true,
  });
  assert(!!plId, 'setup: rfCavity placed on the pipe');

  const pipe = g.state.beamPipes.find(p => p.id === line.pipeId);
  const expected = Math.floor(COMPONENTS.source.cost.funding * 0.5)
    + pipeRefund(pipe)
    + Math.floor(COMPONENTS.rfCavity.cost.funding * 0.5);

  g.state.utilityLines.set('ul_test', {
    id: 'ul_test', utilityType: 'powerCable',
    start: { placeableId: 'nowhere', portName: 'pwr_out' },
    end: { placeableId: plId, portName: 'pwr_in' },
    path: [],
  });

  const before = g.state.resources.funding;
  g.removePlaceable(line.src);
  await flush();
  const credited = g.state.resources.funding - before;
  assert(credited === expected,
    `junction demolish credits pipe + placements too (expected ${expected}, got ${credited})`);
  assert(g.state.utilityLines.get('ul_test').end === null,
    'the utility line wired to the destroyed placement is detached, not dangling');
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. Pipe edits invalidate the utility discovery cache ===\n');
// Regression: the topology-dirty seam listened for 'utilityLinesChanged' and
// 'placeableChanged' only. Placements became utility endpoints in Phase 6, so
// a replace-mode drop left a deleted component's demand in the solved network.
{
  const g = makeGame(206);
  const line = makeLine(g, 30);
  assert(!!line.pipeId, 'setup: machine built');
  const rev0 = g.solveRunner.topologyRevision;
  const plId = g.beamline.placeOnPipe(line.pipeId, {
    type: 'rfCavity', position: 0.32, mode: 'snap', free: true,
  });
  assert(!!plId, 'setup: rfCavity placed');
  assert(g.solveRunner.topologyRevision > rev0,
    'placing on a pipe marks the utility topology dirty');

  g.state.utilityLines.set('ul_r', {
    id: 'ul_r', utilityType: 'powerCable',
    start: { placeableId: 'nowhere', portName: 'pwr_out' },
    end: { placeableId: plId, portName: 'pwr_in' },
    path: [],
  });
  const rev1 = g.solveRunner.topologyRevision;
  g.beamline.placeOnPipe(line.pipeId, {
    type: 'quadrupole', position: 0.32, mode: 'replace', free: true,
  });
  assert(g.solveRunner.topologyRevision > rev1,
    'a replace-mode drop marks the topology dirty');
  assert(g.state.utilityLines.get('ul_r').end === null,
    'the dropped placement releases its utility endpoint');
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. Facility uptime is a fraction, not a sum ===\n');
// Regression: totalBeamOnTicks accumulates once per beamline but was divided
// by wall-clock ticks, so N beamlines produced a value up to N and the
// highAvailability objective (>= 0.95) paid out for a mostly-dark facility.
{
  const g = makeGame(207);
  g.state.tick = 1000;
  const mk = (id, onTicks) => ({
    id, status: 'stopped', nodes: [],
    beamState: { beamOnTicks: onTicks, totalLength: 1, uptimeFraction: onTicks / 1000 },
  });
  g.registry.getAll = () => [mk('a', 400), mk('b', 400), mk('c', 400)];
  g._updateAggregateBeamline();
  assert(Math.abs(g.state.uptimeFraction - 0.4) < 1e-9,
    `three beamlines at 40% report 40% (got ${g.state.uptimeFraction})`);
  assert(g.state.uptimeFraction <= 1, 'uptime can never exceed 1');
}

// ---------------------------------------------------------------------------
console.log('\n=== 7. The Machine Protection System actually halves wear ===\n');
// Regression: hasMPS read state.facilityEquipment (category 'equipment'), but
// the MPS is kind 'infrastructure', so the check was always false and every
// component wore at 2x whether or not the player bought the $1M unit.
{
  const g = makeGame(208);
  const line = makeLine(g, -40);
  assert(!!line.pipeId, 'setup: machine built');
  await flush();
  const entry = g.registry.getAll()[0];
  const nodeId = line.src;
  assert(!!nodeId, 'setup: the entry has nodes');

  entry.beamState.componentHealth = { [nodeId]: 100 };
  g._applyWearForBeamline(entry);
  const wearNoMps = 100 - entry.beamState.componentHealth[nodeId];

  const mps = g.placePlaceable({ type: 'mps', col: 14, row: -40, free: true, silent: true });
  assert(!!mps, 'setup: MPS placed');
  assert(!g.state.facilityEquipment.some(e => e.type === 'mps'),
    'the MPS is NOT in the legacy facilityEquipment view (this was the bug)');
  entry.beamState.componentHealth = { [nodeId]: 100 };
  g._applyWearForBeamline(entry);
  const wearWithMps = 100 - entry.beamState.componentHealth[nodeId];

  assert(wearNoMps > 0, `wear happens at all (got ${wearNoMps})`);
  assert(Math.abs(wearWithMps * 2 - wearNoMps) < 1e-9,
    `an MPS halves wear (${wearNoMps} -> ${wearWithMps})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 8. Infra panels quote the same ladder the solver gates on ===\n');
// Regression: computeSystemStats carried hand-written capacity tables that
// contradicted utility-ports-v2 in the same units — magnetron 2000 kW vs 5,
// coldBox2K 200 W vs 800, and a pump ranking that was upside down.
{
  const cap = (type, port, param) => getUtilityPortsV2(type)?.[port]?.params?.[param];
  const st1 = (type) => computeSystemStats({
    placeables: [{ type, category: 'infrastructure' }], beamline: [],
  });

  for (const t of ['roughingPump', 'turboPump', 'ionPump', 'negPump', 'tiSubPump']) {
    assert(st1(t).vacuum.totalPumpSpeed === cap(t, 'vac_out', 'pumpSpeed'),
      `${t} pump speed matches the solver ladder (${cap(t, 'vac_out', 'pumpSpeed')} L/s)`);
  }
  for (const t of ['magnetron', 'pulsedKlystron', 'multibeamKlystron', 'gyrotron']) {
    assert(st1(t).rfPower.totalFwdPower === cap(t, 'rf_out', 'capacity'),
      `${t} forward power matches the solver ladder (${cap(t, 'rf_out', 'capacity')} kW)`);
  }
  for (const t of ['coldBox4K', 'coldBox2K']) {
    assert(st1(t).cryo.coolingCapacity === cap(t, 'cryo_out', 'coldCapacityW'),
      `${t} cryo capacity matches the solver ladder (${cap(t, 'cryo_out', 'coldCapacityW')} W)`);
  }
  for (const t of ['lcwSkid', 'chiller']) {
    assert(st1(t).cooling.coolingCapacity === cap(t, 'cool_out', 'capacity'),
      `${t} cooling capacity matches the solver ladder (${cap(t, 'cool_out', 'capacity')} kW)`);
  }
  assert(cap('coolingTower', 'cool_out', 'heatRejectionCapacity') === 800,
    'cooling tower exposes 800 kW of heat-rejection capacity, not process cooling');

  // Cryo LOAD counts every cryo sink, not just `cryomodule`.
  const srf = computeSystemStats({
    placeables: [],
    beamline: [{ type: 'ellipticalSrfCavity' }, { type: 'spokeCavity' }, { type: 'halfWaveResonator' }],
  });
  const declared = ['ellipticalSrfCavity', 'spokeCavity', 'halfWaveResonator']
    .reduce((s, t) => s + cap(t, 'cryo_in', 'srfHeatW'), 0);
  assert(srf.cryo.heatLoad === declared,
    `non-cryomodule SRF cavities carry cryo load (expected ${declared} W, got ${srf.cryo.heatLoad})`);

  // The POWER panel and the electricity bill must agree on the draw.
  const state = {
    placeables: [
      'craneHoist', 'assemblyCrane', 'chillerUnit', 'serverCluster', 'weldingStation',
      'cncMill', 'lathe', 'testChamber', 'rackIoc', 'timingSystem', 'mps',
      'laserSystem', 'ups', 'turboPump', 'chiller', 'coldBox4K',
    ].map(type => ({ type, category: COMPONENTS[type]?.kind === 'equipment' ? 'equipment' : 'infrastructure' })),
    beamline: [], staff: {}, totalEnergyCost: 0,
  };
  const panelDraw = computeSystemStats(state).power.totalDraw;
  const billedKW = computeTickUpkeep(state).powerBill / ECON.powerBillPerKW;
  assert(Math.abs(panelDraw - billedKW) < 1e-9,
    `the panel's draw is the billed draw (panel ${panelDraw} kW, billed ${billedKW} kW)`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 9. Joining two loops cannot overfill one reservoir ===\n');
// Regression: _reconcilePersistentState sums numeric fields when several
// orphaned networks are inherited by one successor. Reservoir volumes are
// capped, so joining two loops produced > RESERVOIR_MAX_L and refillCost()
// returned null — the Refill button vanished for good.
{
  const state = {
    utilityLines: new Map(),
    utilityNetworkState: new Map(),
    placeables: [],
    tick: 0,
  };
  const runner = new SolveRunner({ state, registry: UtilityRegistry });
  const netId = 'net_coolingWater_joined';
  // Two full independent loops, both orphaned onto one successor.
  state.utilityNetworkState.set('net_coolingWater_a', {
    reservoirVolumeL: 400, __portKeys: ['p1:cool_out'],
  });
  state.utilityNetworkState.set('net_coolingWater_b', {
    reservoirVolumeL: 400, __portKeys: ['p2:cool_out'],
  });
  const networksByType = new Map([['coolingWater', [{
    id: netId, ports: [
      { placeableId: 'p1', portName: 'cool_out' },
      { placeableId: 'p2', portName: 'cool_out' },
    ],
  }]]]);
  runner._reconcilePersistentState(networksByType);
  const joined = state.utilityNetworkState.get(netId);
  assert(!!joined, 'the successor inherited the orphans');
  assert(joined.reservoirVolumeL === coolingWater.RESERVOIR_MAX_L,
    `the merged reservoir is clamped to its max (got ${joined.reservoirVolumeL})`);
  assert(coolingWater.RESERVOIR_MAX_L - joined.reservoirVolumeL >= 0,
    'refillCost sees a non-negative shortfall, so the Refill button survives a join');

  // The split-then-rejoin round trip must still conserve: two halves that add
  // back up to less than a full reservoir are summed, not clamped away.
  state.utilityNetworkState.delete(netId);
  state.utilityNetworkState.set('net_coolingWater_c', {
    reservoirVolumeL: 120, __portKeys: ['p1:cool_out'],
  });
  state.utilityNetworkState.set('net_coolingWater_d', {
    reservoirVolumeL: 130, __portKeys: ['p2:cool_out'],
  });
  runner._reconcilePersistentState(networksByType);
  assert(state.utilityNetworkState.get(netId).reservoirVolumeL === 250,
    'a rejoin under the cap still sums (conservation is unchanged)');
  assert(coolingWater.default.refillCost(state.utilityNetworkState.get(netId)) !== null,
    'a partially-drained merged loop can still be refilled');
}

// ---------------------------------------------------------------------------
console.log('\n=== 10. Wall merge requires a constant slope, not just endpoints ===\n');
// Regression: build() lerps the merged span's base Y from first.a to last.b,
// so matching shared endpoints was not enough — flat/rise/flat merged into one
// span whose interior base vertices float above or bury under the terrain.
{
  // wall-builder's import chain touches THREE and document at module load
  // (procedural textures), so stub both and import dynamically — _mergeWalls
  // itself is pure.
  const Generic = class {
    constructor() {}
    set() { return this; } translate() { return this; } scale() { return this; }
    dispose() {} load() { return new Generic(); }
  };
  globalThis.THREE = new Proxy({}, { get: () => Generic });
  const ctx = new Proxy({}, { get: () => () => ctx });
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
  const { WallBuilder } = await import('../src/renderer3d/wall-builder.js');
  const wb = Object.create(WallBuilder.prototype);
  const mk = (col, a, b) => ({ edge: 'n', type: 'interior', variant: 0, col, row: 0, baseY: { a, b } });

  const varying = wb._mergeWalls([mk(0, 0, 0), mk(1, 0, 0.5), mk(2, 0.5, 0.5)], 'transparent', null);
  assert(varying.length === 3 && varying.every(w => w.span === 1),
    `flat/rise/flat does not merge (got spans ${varying.map(w => w.span).join(',')})`);

  const constantFlat = wb._mergeWalls([mk(0, 0, 0), mk(1, 0, 0), mk(2, 0, 0)], 'transparent', null);
  assert(constantFlat.length === 1 && constantFlat[0].span === 3,
    'a flat run still merges into one span');

  const constantSlope = wb._mergeWalls([mk(0, 0, 0.5), mk(1, 0.5, 1), mk(2, 1, 1.5)], 'transparent', null);
  assert(constantSlope.length === 1 && constantSlope[0].span === 3,
    'a constant-slope run still merges into one span');
  assert(constantSlope[0].baseY.a === 0 && constantSlope[0].baseY.b === 1.5,
    'the merged span spans the true outer endpoints');
}

// ---------------------------------------------------------------------------
console.log('\n=== 11. The designer models a drift at its real length ===\n');
// Regression: _recalcDraft / _updateTotalLength / _computeGhostQuads all used
// `COMPONENTS[type].subL || 4` — the 2 m template — while the draft nodes carry
// the real per-drift subL copied from flattenPath, so a 51 m unfocused drift
// was previewed (and physics-checked) as a 2 m one.
{
  const d = Object.create(BeamlineDesigner.prototype);
  d.draftNodes = [
    { type: 'source' },                 // template subL 4 -> 2.00 m
    { type: 'drift', subL: 102 },       // real drift        -> 51.00 m
    { type: 'faradayCup' },             // template subL 4 -> 2.00 m
  ];
  d.totalLength = 0;
  d._updateTotalLength();
  const templateOnly = (COMPONENTS.source.subL + COMPONENTS.drift.subL + COMPONENTS.faradayCup.subL) * 0.5;
  assert(d.totalLength === (4 + 102 + 4) * 0.5,
    `total length uses the node's own subL (got ${d.totalLength} m)`);
  assert(d.totalLength !== templateOnly,
    `and is not the all-template length (${templateOnly} m)`);

  const lens = d._compPhysLengths();
  assert(Math.abs(lens[1] - 51) < 1e-9,
    `the long drift gets its real share of the s-axis (got ${lens[1]} m)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
