// test/test-convergence-regressions.js
//
// Convergence-phase review findings. Each block names the defect it pins and
// runs headless against real modules (no renderer, no DOM beyond tiny stubs).

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { BeamlineSystem, pipeCost, pipeRefund } from '../src/beamline/BeamlineSystem.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { flattenPath } from '../src/beamline/flattener.js';
import { validateExtendPipe } from '../src/beamline/pipe-drawing.js';
import { positionToPoint } from '../src/beamline/pipe-geometry.js';
import { computeBeamIncome, computeSystemStats } from '../src/game/economy.js';
import { MoveTool } from '../src/input/mode-tools.js';
import { TUTORIAL_STEPS } from '../src/data/tutorial.js';

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
  return g;
}

// A straight source -> faraday cup machine, placed on the first row at or
// after `row` whose cells the generated terrain leaves free.
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

// ---------------------------------------------------------------------------
console.log('\n=== 1. On-pipe placements are charged, gated, and refunded ===\n');
// Regression: placeOnPipe() never called canAfford/spend, so the entire
// interior of every beamline (cavities, quads, BPMs, cryomodules) was free
// and unlimited — while the palette still rendered each item's price.
// removeFromPipe credited nothing, though the demolish tooltip promised 50%.
{
  const g = makeGame(201, 2_500_000);
  const { pipeId } = makeLine(g, 0);
  assert(!!pipeId, 'setup: pipe drawn');

  const cost = COMPONENTS.quadrupole.cost.funding;
  const before = g.state.resources.funding;
  const plId = g.beamline.placeOnPipe(pipeId, { type: 'quadrupole', position: 0.3, mode: 'snap' });
  assert(!!plId, 'quadrupole placed on the pipe');
  assert(g.state.resources.funding === before - cost,
    `placement charged its list price (delta ${before - g.state.resources.funding}, want ${cost})`);

  // Refund on individual removal, matching the demolish tooltip's 50%.
  const beforeRemove = g.state.resources.funding;
  const removed = g.demolishTarget({ kind: 'placement', pipeId, attachmentId: plId });
  assert(removed === true, 'demolishTarget reports the placement removal as a success');
  assert(g.state.resources.funding === beforeRemove + Math.floor(cost * 0.5),
    `removal credited the promised 50% (got ${g.state.resources.funding - beforeRemove})`);
  const pipe = g.state.beamPipes.find(p => p.id === pipeId);
  assert(!(pipe.placements || []).some(pl => pl.id === plId), 'the placement is gone from the pipe');

  // Unaffordable placements are refused, not silently granted.
  g.state.resources.funding = 0;
  const denied = g.beamline.placeOnPipe(pipeId, { type: 'cryomodule', position: 0.6, mode: 'snap' });
  assert(denied === null, 'a $12M cryomodule is refused at $0 funding');
  assert(g.state.resources.funding === 0, 'the refused placement moved no money');

  // Research gating applies to this path too (it only ever guarded the
  // palette and Game.placePlaceable before).
  g.state.resources.funding = 1e9;
  const gatedId = Object.keys(COMPONENTS).find(k => COMPONENTS[k]?.role === 'placement'
    && COMPONENTS[k].requires && !COMPONENTS[k].unlocked);
  if (gatedId) {
    const gated = g.beamline.placeOnPipe(pipeId, { type: gatedId, position: 0.8, mode: 'snap' });
    assert(gated === null, `un-researched '${gatedId}' is refused on-pipe`);
    g.state.completedResearch.push(
      ...(Array.isArray(COMPONENTS[gatedId].requires)
        ? COMPONENTS[gatedId].requires : [COMPONENTS[gatedId].requires]));
    assert(!!g.beamline.placeOnPipe(pipeId, { type: gatedId, position: 0.8, mode: 'snap' }),
      `'${gatedId}' places once its research is done`);
  }

  // free: true still bypasses both (scenario setup / DesignPlacer).
  const freeBefore = g.state.resources.funding;
  assert(!!g.beamline.placeOnPipe(pipeId, { type: 'bpm', position: 0.95, mode: 'snap', free: true }),
    'free placements still succeed');
  assert(g.state.resources.funding === freeBefore, 'free placements are not charged');
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. Pipe demolition can never refund more than it charged ===\n');
// Regression: removeBeamPipe floored its refund basis at ONE FULL TILE while
// drawPipe floors the charge at 0.25 tiles, so the 0.25-tile stub a bare
// click produces cost $2,500 and refunded $5,000 — repeatable forever.
{
  for (const tiles of [0.25, 0.5, 0.75, 1, 4, 12]) {
    const charged = pipeCost(tiles).funding;
    const refund = pipeRefund({ path: [{ col: 0, row: 0 }, { col: tiles, row: 0 }] });
    assert(refund <= Math.floor(charged * 0.5) && refund * 2 <= charged,
      `${tiles}-tile pipe: refund ${refund} <= 50% of the ${charged} charged`);
  }

  const g = makeGame(202, 2_500_000);
  const src = g.beamline.placeJunction({ type: 'source', col: 0, row: 20, dir: 3, free: true, silent: true });
  const port = { junctionId: src, portName: 'exit' };
  const start = g.state.beamPipes.length;
  const funding0 = g.state.resources.funding;
  for (let i = 0; i < 3; i++) {
    const origin = { col: 0.5, row: 21 };
    const stub = g.beamline.drawPipe(port, null, [origin, { col: 0.5, row: 21.25 }]);
    if (!stub) break;
    g.removeBeamPipe(stub);
  }
  assert(g.state.beamPipes.length === start, 'setup: every stub was removed again');
  assert(g.state.resources.funding <= funding0,
    `stub build+demolish cycles are never net-positive (${g.state.resources.funding - funding0})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. flattenPath mirrors placements on a reverse traversal ===\n');
// Regression: placements were always laid out ascending by `position` and
// measured from path[0], so a pipe drawn from the downstream port back to the
// source fed the lattice its optics in reverse spatial order and at the wrong
// s. `position` is a fraction from path[0], so the SAME physical spot on a
// reverse-drawn pipe is `1 - position - subL/pipe.subL`.
{
  const build = (seed, backwards, posOf) => {
    const g = makeGame(seed);
    const src = g.beamline.placeJunction({ type: 'source', col: 0, row: 0, dir: 3, free: true, silent: true });
    const cup = g.beamline.placeJunction({ type: 'faradayCup', col: 10, row: 0, dir: 3, free: true, silent: true });
    const a = { junctionId: src, portName: 'exit' };
    const b = { junctionId: cup, portName: 'entry' };
    const pipeId = backwards
      ? g.beamline.drawPipe(b, a, [{ col: 10, row: 0 }, { col: 0, row: 0 }])
      : g.beamline.drawPipe(a, b, [{ col: 0, row: 0 }, { col: 10, row: 0 }]);
    const pipe = g.state.beamPipes.find(p => p.id === pipeId);
    const plId = pipe && g.beamline.placeOnPipe(pipeId, {
      type: 'quadrupole', position: posOf(pipe), mode: 'snap', free: true,
    });
    return { g, src, pipe, plId };
  };

  const FWD_POS = 0.1;
  const fwd = build(203, false, () => FWD_POS);
  assert(!!fwd.plId, 'setup: forward pipe carries a quadrupole');
  const fwdPl = fwd.pipe.placements.find(pl => pl.id === fwd.plId);

  // Mirror the SAME physical spot onto a pipe drawn the other way round.
  const rev = build(204, true, (pipe) => 1 - fwdPl.position - fwdPl.subL / pipe.subL);
  assert(!!rev.pipe, 'setup: the backwards drag produced a real pipe');
  assert(!!rev.plId, 'setup: reverse pipe carries a quadrupole');
  const revPl = rev.pipe.placements.find(pl => pl.id === rev.plId);

  // Compare CENTRES: positionToPoint returns the placement's path-space start,
  // which is the opposite physical edge on a mirrored pipe.
  const centre = (pipe, pl) => positionToPoint(pipe, pl.position + pl.subL / (2 * pipe.subL));
  const fPt = centre(fwd.pipe, fwdPl);
  const rPt = centre(rev.pipe, revPl);
  assert(Math.abs(fPt.col - rPt.col) < 1e-6 && Math.abs(fPt.row - rPt.row) < 1e-6,
    `setup: both quadrupoles sit at the same world spot (${fPt.col} vs ${rPt.col})`);

  const fFlat = flattenPath(fwd.g.state, fwd.src).find(e => e.kind === 'placement');
  const rFlat = flattenPath(rev.g.state, rev.src).find(e => e.kind === 'placement');
  assert(!!fFlat && !!rFlat, 'both machines flatten with the placement present');
  assert(Math.abs(fFlat.beamStart - rFlat.beamStart) < 1e-6,
    `the same physical optic gets the same s regardless of drag direction `
    + `(fwd ${fFlat.beamStart}, rev ${rFlat.beamStart})`);

  // Two placements on a reverse pipe must come out in beam order, not in
  // ascending-`position` order (which is the mirror of beam order here).
  const two = build(206, true, (pipe) => 0.1);
  two.g.beamline.placeOnPipe(two.pipe.id, { type: 'bpm', position: 0.8, mode: 'snap', free: true });
  const flat = flattenPath(two.g.state, two.src).filter(e => e.kind === 'placement');
  assert(flat.length === 2, `two placements flattened (got ${flat.length})`);
  assert(flat[0].position > flat[1].position,
    'on a reverse pipe the beam meets the HIGHER `position` first');
  assert(flat[0].beamStart < flat[1].beamStart, 'beamStart still increases along the beam');
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. Extending the START of a pipe keeps placements put ===\n');
// Regression: the remap scaled `position` by oldSubL/newSubL, which preserves
// distance from path[0] — but a start-side extension MOVES path[0], so every
// placement was translated backwards into the newly-bought section. The
// shared-joint dedupe also compared the wrong end and never fired.
{
  const pipe = {
    id: 'bp_1', start: null, end: { junctionId: 'j1', portName: 'entry' },
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }], subL: 16,
    placements: [{ id: 'pl_1', type: 'quadrupole', position: 0.5, subL: 2 }],
  };
  const state = { beamPipes: [pipe], placeables: [{ id: 'j1', type: 'faradayCup', col: 4, row: 0, dir: 3 }] };
  const before = positionToPoint(pipe, 0.5);
  const res = validateExtendPipe(state, 'bp_1', [{ col: 0, row: 0 }, { col: -4, row: 0 }]);
  assert(res.ok, `start-side extension accepted (${res.reason || 'ok'})`);
  const after = positionToPoint(res.pipe, res.pipe.placements[0].position);
  assert(Math.abs(after.col - before.col) < 1e-9 && Math.abs(after.row - before.row) < 1e-9,
    `the placement stayed at col ${before.col} (got ${after.col})`);
  const dupes = res.pipe.path.filter((pt, i) => i > 0
    && pt.col === res.pipe.path[i - 1].col && pt.row === res.pipe.path[i - 1].row);
  assert(dupes.length === 0, `no duplicate waypoint at the joint (path ${JSON.stringify(res.pipe.path)})`);

  // The end-side case, which was already correct, must not regress.
  const pipe2 = { ...pipe, start: { junctionId: 'j1', portName: 'exit' }, end: null,
    placements: [{ id: 'pl_1', type: 'quadrupole', position: 0.5, subL: 2 }] };
  const state2 = { beamPipes: [pipe2], placeables: state.placeables };
  const res2 = validateExtendPipe(state2, 'bp_1', [{ col: 4, row: 0 }, { col: 8, row: 0 }]);
  assert(res2.ok, 'end-side extension still accepted');
  const after2 = positionToPoint(res2.pipe, res2.pipe.placements[0].position);
  assert(Math.abs(after2.col - before.col) < 1e-9, 'end-side extension also leaves the placement put');
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. Independent sources get their own stretch of the s-axis ===\n');
// Regression: flattenPath restarts beamStart at 0 per source and
// _deriveBeamGraph concatenated them verbatim, so probe pins on machine B
// resolved onto machine A's envelope samples.
{
  const g = makeGame(205);
  makeLine(g, 0);
  makeLine(g, 20);
  g._deriveBeamGraph();
  const ordered = g.state.beamline;
  const sources = ordered.filter(n => n.type === 'source');
  assert(sources.length === 2, `two sources in the graph (got ${sources.length})`);
  const starts = new Set(ordered.map(n => n.beamStart));
  assert(starts.size === ordered.length,
    `every element has a distinct beamStart (${ordered.length} elements, ${starts.size} distinct)`);
  assert(new Set(ordered.map(n => n.sourceIndex)).size === 2,
    'elements are tagged with which machine they belong to');
  const firstOfB = ordered.find(n => n.sourceIndex === 1);
  const lastOfA = ordered.filter(n => n.sourceIndex === 0).pop();
  assert(!!firstOfB && !!lastOfA
    && firstOfB.beamStart > lastOfA.beamStart + lastOfA.subL * 0.5,
    'machine B starts past the end of machine A');
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. toggleBeam recomputes the gate instead of reading stale state ===\n');
// Regression: toggleBeam called the no-op validateInfrastructure() and then
// read state.infraCanRun. While paused the tick interval is cleared, so the
// blocker list was arbitrarily stale in both directions.
{
  const g = makeGame(206);
  const { src } = makeLine(g, 0);
  g.recalcAllBeamlines();
  const entry = g.registry.getBySourceId(src);
  assert(!!entry, 'setup: registry entry exists');

  g.pause();
  // Hand-poke a green gate the way a stale tick would have left it.
  g.state.infraCanRun = true;
  g.state.infraBlockers = [];
  g.toggleBeam(entry.id);
  assert(entry.status !== 'running',
    'a beam with no utilities wired cannot be started off a stale green gate');
  assert(g.state.infraCanRun === false, 'the gate was actually re-run');
}

// ---------------------------------------------------------------------------
console.log('\n=== 7. Economy: quality 0 earns nothing; power capacity is real ===\n');
// Regressions: `beamState.beamQuality || 0.2` billed a dead beam at 20%
// quality forever, and power.capacity read state.maxElectricalPower — a field
// Game.load() deletes as deprecated and nothing writes.
{
  assert(computeBeamIncome({ beamQuality: 0, dataRate: 0 }, 10) === 0,
    'a beam at quality exactly 0 earns $0/tick');
  assert(computeBeamIncome({ beamQuality: 1, dataRate: 0 }, 10) > 0,
    'a healthy beam still earns');
  assert(computeBeamIncome({ dataRate: 0 }, 10) > 0,
    'the 0.2 stand-in still applies when physics has not reported yet');
  assert(computeBeamIncome({ beamQuality: NaN, dataRate: 0 }, 10) > 0,
    'a NaN quality falls back to the stand-in rather than poisoning funding');

  const g = makeGame(207);
  g.placePlaceable({ type: 'hvTransformer', col: -20, row: -20, free: true, silent: true });
  g.placePlaceable({ type: 'hvTransformer', col: -18, row: -20, free: true, silent: true });
  const stats = computeSystemStats(g.state);
  assert(stats.power.capacity === 2400,
    `capacity tracks the placed transformers, 1200 kW each (got ${stats.power.capacity})`);
  assert(!('maxElectricalPower' in g.state) || g.state.maxElectricalPower === undefined,
    'the deprecated maxElectricalPower field is not resurrected');
}

// ---------------------------------------------------------------------------
console.log('\n=== 8. Data fees are billed on the rate actually collected ===\n');
// Regression: computeBeamIncome billed the raw bs.dataRate while
// _tickBeamline derated the `data` resource by detector dataQuality, so an
// orphaned detector was paid for science it did not collect.
{
  const g = makeGame(208);
  const withFiber = computeBeamIncome({ beamQuality: 1, dataRate: 1 }, 0);
  const noFiber = computeBeamIncome({ beamQuality: 1, dataRate: 0 }, 0);
  assert(withFiber > noFiber, 'the data fee is a real term');

  // The connectivity factor itself: a node with dataQuality 0 zeroes it.
  g.state.nodeQualities = { bl_x: { dataQuality: 0 } };
  const nodes = [{ id: 'bl_x', type: 'detector' }];
  assert(g._dataConnectivityFactor(nodes) === 0, 'an unfed detector derates to 0');
  g.state.nodeQualities = { bl_x: { dataQuality: 1 } };
  assert(g._dataConnectivityFactor(nodes) === 1, 'a fed detector derates to 1');
  // Fail closed (Phase 11a): a detector DECLARES a dataFiber sink, so no
  // solved quality means never wired — 0, not the 1.0 it used to default to
  // (which paid full data fees for a fibreless detector). A node that
  // declares no data sink is not applicable and still reads 1.0.
  g.state.nodeQualities = {};
  assert(g._dataConnectivityFactor(nodes) === 0, 'a declared-but-unsolved data sink fails closed at 0');
}

// ---------------------------------------------------------------------------
console.log('\n=== 9. Aborting a carry restores the object instead of deleting it ===\n');
// Regression: _abortPointerGesture (window blur, tab hide, mouseup off the
// canvas — i.e. clicking any HUD chrome mid-carry) called the same
// cancelGesture the undo path uses, which drops the payload without
// re-placing it. Nothing restores the world on that path, so the lifted
// object was silently destroyed with no refund and no toast.
{
  const g = makeGame(209);
  let placed = null;
  for (let row = 2; row < 40 && !placed; row++) {
    for (let col = 2; col < 40 && !placed; col++) {
      const id = g.placePlaceable({ type: 'flowerBed', col, row, subCol: 0, subRow: 0 });
      if (id) placed = { id };
    }
  }
  assert(!!placed, 'setup: flower bed placed');
  const countOf = () => g.state.placeables.filter(p => p.type === 'flowerBed').length;
  const before = countOf();

  const tool = new MoveTool();
  const snap = g._withUndo(() => g.liftPlaceable(placed.id));
  tool.payload = {
    kind: 'placeable', type: snap.type, params: snap.params, variant: snap.variant ?? 0,
    originCol: snap.col, originRow: snap.row,
    originSubCol: snap.subCol, originSubRow: snap.subRow, originDir: snap.dir, dir: snap.dir,
  };
  assert(countOf() === before - 1, 'the lift removed the object from the world');

  const ctx = {
    game: g,
    input: { hoverPlaceable: {}, isLinePlacingDecoration: false },
    renderer: { _clearPreview() {}, canvas: { style: {} } },
  };
  tool.cancelGesture(ctx, 'abort');
  assert(tool.payload === null, 'the carry ended');
  assert(countOf() === before, `the object came back (got ${countOf()}, want ${before})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 10. The RF tutorial step needs a cavity that is actually fed ===\n');
// Regression: hasRfFeed only tested flow.totalCapacity > 0, which was summed
// across every frequency bucket — so an S-band magnetron wired to a 162.5 MHz
// cavity (exactly what the hint told the player to build) ticked the step
// green while every cavity sat at rfQuality 0. A dangling stub passed too.
{
  const step = TUTORIAL_STEPS.find(s => s.id === 'tut-rf');
  assert(!!step, 'setup: tut-rf exists');
  const withFlow = (flow) => ({ utilityNetworkData: new Map([['rfWaveguide', new Map([['n1', flow]])]]) });

  assert(step.condition(withFlow({ totalCapacity: 5, totalDemand: 5, perSinkQuality: { 'pl_2:rf_in': 0 } })) === false,
    'a frequency-mismatched feed does NOT satisfy the step');
  assert(step.condition(withFlow({ totalCapacity: 5, totalDemand: 0, perSinkQuality: {} })) === false,
    'a dangling waveguide stub with no sink does NOT satisfy the step');
  assert(step.condition(withFlow({ totalCapacity: 35, totalDemand: 5, perSinkQuality: { 'pl_2:rf_in': 1 } })) === true,
    'an in-band amplifier actually driving the cavity does');
  assert(/solid-state amplifier/i.test(step.hint),
    'the hint names a source whose bands actually cover a 162.5 MHz cavity');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
