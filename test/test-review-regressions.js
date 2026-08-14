// test/test-review-regressions.js — regressions for the convergence-review
// findings. Each block names the defect it pins; all of them run headless
// against real modules (no renderer, no DOM beyond tiny stubs).

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { tickStaffMember } from '../src/game/staff/staffSystem.js';
import { StaffMember } from '../src/game/staff/StaffMember.js';
import { computeSystemStats, computeBeamIncome } from '../src/game/economy.js';
import { BeamlineInputController } from '../src/input/BeamlineInputController.js';
import { ZonePaintTool } from '../src/input/placement-tools.js';
import { UtilityGate } from '../src/game/utility-gate.js';
import { flattenPath } from '../src/beamline/flattener.js';
import { portSide } from '../src/beamline/junctions.js';
import { ProbeWindow } from '../src/ui/probe.js';

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

function makeGame(seed) {
  const g = new Game(new BeamlineRegistry(), { seed });
  g.state.resources.funding = 1e9;
  return g;
}

// ---------------------------------------------------------------------------
console.log('\n=== 1. Staff on break recover without a cafeteria ===\n');
// Regression: the onBreak branch INCREASED hunger at cafeteriaTier 0 while the
// return-to-work condition required hunger < 0.35, so a staffer who ever went
// on break in a cafeteria-less facility was stuck forever — and the sole
// starting operator locking out permanently tripped the beam.
{
  const m = new StaffMember({ id: 's1', profession: 'operator', name: 'T', traits: [], rng: () => 0.5 });
  m.status = 'working';
  let flippedAt = -1;
  for (let t = 0; t < 200 && flippedAt < 0; t++) {
    tickStaffMember(m, { isNight: false, cafeteriaTier: 0, zoneTier: 0, rng: () => 0.5 });
    if (m.status === 'onBreak') flippedAt = t;
  }
  assert(flippedAt >= 0, `worker goes on break from fatigue (tick ${flippedAt})`);

  let backAt = -1;
  for (let t = 0; t < 400 && backAt < 0; t++) {
    tickStaffMember(m, { isNight: false, cafeteriaTier: 0, zoneTier: 0, rng: () => 0.5 });
    if (m.status === 'working') backAt = t;
  }
  assert(backAt >= 0, `worker returns to 'working' with NO cafeteria (tick ${backAt})`);

  // A cafeteria must still be worth building: it shortens the break.
  const m2 = new StaffMember({ id: 's2', profession: 'operator', name: 'U', traits: [], rng: () => 0.5 });
  m2.status = 'onBreak';
  m2.needs = { fatigue: 0.9, hunger: 0.9, morale: 0.6 };
  let fastBack = -1;
  for (let t = 0; t < 400 && fastBack < 0; t++) {
    tickStaffMember(m2, { isNight: false, cafeteriaTier: 1, zoneTier: 0, rng: () => 0.5 });
    if (m2.status === 'working') fastBack = t;
  }
  const m3 = new StaffMember({ id: 's3', profession: 'operator', name: 'V', traits: [], rng: () => 0.5 });
  m3.status = 'onBreak';
  m3.needs = { fatigue: 0.9, hunger: 0.9, morale: 0.6 };
  let slowBack = -1;
  for (let t = 0; t < 400 && slowBack < 0; t++) {
    tickStaffMember(m3, { isNight: false, cafeteriaTier: 0, zoneTier: 0, rng: () => 0.5 });
    if (m3.status === 'working') slowBack = t;
  }
  assert(fastBack >= 0 && slowBack >= 0 && fastBack < slowBack,
    `a cafeteria still shortens the break (${fastBack} vs ${slowBack} ticks)`);
}

// The beam_unstaffed blocker must name the real cause, not the Control Room.
{
  const gate = new UtilityGate({
    state: {
      staffMembers: [{
        id: 'a', profession: 'operator', status: 'onBreak',
        needs: { fatigue: 0.1, hunger: 0.9, morale: 0.5 },
      }],
    },
  });
  const msg = gate._unstaffedMessage();
  assert(/cafeteria/i.test(msg), `hungry-on-break blocker mentions the cafeteria ("${msg}")`);
  const empty = new UtilityGate({ state: { staffMembers: [] } });
  assert(/hired/i.test(empty._unstaffedMessage()), 'empty roster blocker says no operator hired');
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. Rejected gestures do not clobber the redo stack ===\n');
// Regression: _pushUndo() fired BEFORE validation on pipe-draw / on-pipe /
// junction commits, so a rejected gesture pushed a no-op undo entry and wiped
// redo — a previously undone action became unrecoverable.
{
  const g = makeGame(101);
  const src = g._withUndo(() => g.beamline.placeJunction({ type: 'source', col: 4, row: 4, dir: 3, free: true, silent: true }));
  const second = g._withUndo(() => g.beamline.placeJunction({ type: 'source', col: 12, row: 4, dir: 3, free: true, silent: true }));
  assert(src && second && g._undoStack.length === 2, 'setup: two junctions placed (2 undo entries)');
  g.undo();
  assert(g._undoStack.length === 1 && g._redoStack.length === 1,
    'setup: one undone, redo available');

  const controller = new BeamlineInputController({
    game: g,
    renderer: { renderBeamPipePreview() {}, clearDragPreview() {} },
    inputHandler: { placementDir: 0, selectedParamOverrides: null },
  });
  // Drag out of the source's exit port in the direction OPPOSITE its outward
  // side: drawPipe validates the port orientation on commit and rejects with
  // port_mismatch, so the whole gesture must be a no-op.
  const p = g.state.placeables.find(x => x.id === src);
  const side = portSide(p, 'exit');
  const back = { N: [0, 6], S: [0, -6], E: [-6, 0], W: [6, 0] }[side];
  assert(!!back, `setup: source exit port faces ${side}`);
  const origin = { col: p.col * 2 + 1, row: p.row * 2 + 1 };

  const undoBefore = g._undoStack.length;
  const redoBefore = g._redoStack.length;
  const pipesBefore = (g.state.beamPipes || []).length;
  controller._drawing = true;
  controller._drawMode = 'add';
  controller._drawButton = 0;
  controller._drawOrigin = origin;
  controller._drawStartAnchor = { kind: 'port', junctionId: src, portName: 'exit' };
  controller._drawPath = [origin];
  controller.onMouseUp(origin.col + back[0], origin.row + back[1], 0);

  assert((g.state.beamPipes || []).length === pipesBefore, 'the backwards draw was rejected');
  assert(g._undoStack.length === undoBefore, 'rejected pipe draw pushed no undo entry');
  assert(g._redoStack.length === redoBefore, 'rejected pipe draw preserved the redo stack');
  g.redo();
  assert(g.state.placeables.some(x => x.id === second) || g._undoStack.length === undoBefore + 1,
    'the earlier action is still redoable after the rejected gesture');
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. A second mouse button cannot hijack a pipe gesture ===\n');
// Regression: _pipeRemoveStart clobbered an in-flight 'add' draw and onMouseUp
// ignored the button, so right-clicking during a left-button pipe draw turned
// the gesture into a destructive remove-sweep that ran on the right release.
{
  const g = makeGame(102);
  const src = g.beamline.placeJunction({ type: 'source', col: 4, row: 4, dir: 3, free: true, silent: true });
  assert(!!src, 'setup: source placed');
  const controller = new BeamlineInputController({
    game: g,
    renderer: { renderBeamPipePreview() {}, clearDragPreview() {} },
    inputHandler: { placementDir: 0, selectedParamOverrides: null },
  });
  controller._drawing = true;
  controller._drawMode = 'add';
  controller._drawButton = 0;
  controller._drawOrigin = { col: 4, row: 4 };
  controller._drawPath = [{ col: 4, row: 4 }];

  controller.onMouseDown(20, 20, 2, 'drift');
  assert(controller._drawMode === 'add', 'right-press mid-draw does not flip the mode to remove');
  assert(controller._drawOrigin.col === 4 && controller._drawOrigin.row === 4,
    'right-press mid-draw does not re-anchor the origin');

  const committed = controller.onMouseUp(20, 20, 2);
  assert(committed === true && controller._drawing === true,
    'the wrong button\'s release is swallowed and leaves the gesture armed');
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. Drag tools only commit on the left button ===\n');
// Regression: onMouseDown guarded `e.button !== 0` but onMouseUp did not, so a
// right release mid-drag committed the rect early AND consumed the event, so
// right-click-to-deselect silently did nothing.
{
  const g = makeGame(103);
  const renderer = { renderDragPreview() {}, renderInfraHoverCursor() {}, updateHover() {}, clearDragPreview() {}, screenToWorld: (x, y) => ({ x, y }) };
  const input = { _showDragCostTooltip() {}, _hideDragCostTooltip() {}, _hideTooltip() {}, clearTool() { input.cleared = true; }, cleared: false };
  const ctx = { game: g, renderer, input };
  const tool = new ZonePaintTool('office');
  tool._dragging = true;
  tool._dragStart = { col: 5, row: 5 };
  tool._dragEnd = { col: 8, row: 8 };

  // Spy rather than counting painted tiles: whether a given rect can be
  // auto-floored depends on the generated terrain, but "was the commit even
  // attempted" is exactly the property under test.
  let commits = 0;
  const origRect = g.placeFacilityZoneBrushRect.bind(g);
  g.placeFacilityZoneBrushRect = (...args) => { commits++; return origRect(...args); };

  const consumed = tool.onMouseUp({ button: 2, clientX: 0, clientY: 0 }, ctx);
  assert(consumed === false, 'right release does not consume the drag commit');
  assert(commits === 0, 'right release commits nothing');
  assert(tool._dragging === true, 'the left-button drag is still in flight');
  assert(input.cleared === false, 'right-click-to-deselect was not swallowed');

  const leftConsumed = tool.onMouseUp({ button: 0, clientX: 0, clientY: 0 }, ctx);
  assert(leftConsumed === true && commits === 1, 'the left release still commits the rect');
  assert(tool._dragging === false, 'the drag ends on the left release');
}

// A tool must be able to abandon a gesture (window-level release / focus loss).
{
  const g = makeGame(104);
  const renderer = { clearDragPreview() {} };
  const input = { _hideDragCostTooltip() {} };
  const tool = new ZonePaintTool('office');
  tool._dragging = true;
  tool._dragStart = { col: 1, row: 1 };
  tool._dragEnd = { col: 4, row: 4 };
  const zonesBefore = (g.state.zones || []).length;
  tool.cancelGesture({ game: g, renderer, input });
  assert(tool._dragging === false, 'cancelGesture drops the drag');
  assert((g.state.zones || []).length === zonesBefore, 'cancelGesture commits nothing');
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. Beam income counts hardware, not drift gaps ===\n');
// Regression: computeBeamIncome was fed flattenPath(...).length, which counts
// the flattener's synthetic per-gap drift entries, so spacing identical
// hardware further apart minted income at zero cost.
{
  const build = (positions) => {
    const g = makeGame(105);
    const src = g.beamline.placeJunction({ type: 'source', col: -6, row: 20, dir: 3, free: true, silent: true });
    const det = g.beamline.placeJunction({ type: 'detector', col: 6, row: 20, dir: 3, free: true, silent: true });
    const pipe = g.beamline.drawPipe(
      { junctionId: src, portName: 'exit' },
      { junctionId: det, portName: 'entry' },
      [{ col: -6, row: 20 }, { col: 6, row: 20 }],
    );
    for (const p of positions) g.beamline.placeOnPipe(pipe, { type: 'quadrupole', position: p, mode: 'snap' });
    return { g, src };
  };
  const packed = build([0.02, 0.05, 0.08, 0.11]);
  const spread = build([0.10, 0.30, 0.50, 0.70]);
  const hw = ({ g, src }) => flattenPath(g.state, src).filter(n => n.kind !== 'drift').length;
  const raw = ({ g, src }) => flattenPath(g.state, src).length;

  assert(raw(spread) > raw(packed), `raw flattened length differs with spacing (${raw(packed)} vs ${raw(spread)})`);
  assert(hw(packed) === hw(spread), `hardware count is spacing-independent (${hw(packed)})`);
  const bs = { beamQuality: 1, dataRate: 0 };
  assert(computeBeamIncome(bs, hw(packed)) === computeBeamIncome(bs, hw(spread)),
    'income is identical for the same hardware at different spacing');
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. Systems panel counts real component ids ===\n');
// Regression: the RF and cryo tables keyed off ids that do not exist in
// COMPONENTS ('klystron', 'ssa', 'subCooling2K', 'heliumCompressor'), so
// placed, powered and billed hardware reported as zero.
{
  const mk = (type, i) => ({ id: 'p' + i, type, category: 'infrastructure', col: i, row: 0 });
  const state = {
    placeables: [
      mk('pulsedKlystron', 1), mk('multibeamKlystron', 2), mk('gyrotron', 3),
      mk('solidStateAmp', 4), mk('highPowerSSA', 5), mk('twt', 6),
      mk('coldBox2K', 7), mk('coldBox2K', 8), mk('heCompressor', 9),
    ],
    beamline: [],
  };
  const st = computeSystemStats(state);
  assert(st.rfPower.sourceCount === 6, `all six RF sources counted (got ${st.rfPower.sourceCount})`);
  assert(st.rfPower.totalFwdPower > 0, `forward power non-zero (got ${st.rfPower.totalFwdPower})`);
  assert(st.rfPower.detail.klystrons === 2, `klystron detail row counts real ids (got ${st.rfPower.detail.klystrons})`);
  assert(st.rfPower.detail.ssas === 2, `SSA detail row counts real ids (got ${st.rfPower.detail.ssas})`);
  assert(st.cryo.detail.subCooling2K === 2, `coldBox2K counted as 2 K plant (got ${st.cryo.detail.subCooling2K})`);
  assert(st.cryo.detail.compressors === 1, `heCompressor counted (got ${st.cryo.detail.compressors})`);
  assert(st.cryo.coolingCapacity > 0 && st.cryo.opTemp === 2.0,
    `2 K plant reports capacity and temperature (${st.cryo.coolingCapacity} W @ ${st.cryo.opTemp} K)`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 7. avgPressure tracks the pumps instead of latching ===\n');
// Regression: computeSystemStats read state.avgPressure as its own input while
// Game.computeSystemStats wrote the result back, so the first value (1013 mbar,
// no pumps) latched forever and adding pumps never moved it. A second bug in
// _updateAggregateBeamline then overwrote it with `undefined` every tick.
{
  const g = makeGame(106);
  g.computeSystemStats();
  const dry = g.state.avgPressure;
  assert(dry === 1013, `no pumps → atmospheric (got ${dry})`);
  for (let i = 0; i < 3; i++) {
    g.placePlaceable({ type: 'turboPump', col: 10 + i, row: 30, free: true, silent: true });
  }
  g.computeSystemStats();
  // Pumps alone are not a vacuum system: with no beamline there is nothing to
  // pump down. The old code clamped the pumped volume to 1 L, so one unwired
  // turboPump reported 3.3e-9 mbar / 'Good' on an empty map and auto-completed
  // the `goodVacuum` objective.
  assert(g.state.avgPressure === 1013,
    `pumps with no beamline volume stay at atmospheric (got ${g.state.avgPressure})`);
  assert(g.state.systemStats.vacuum.pressureQuality === 'None',
    `no pumped volume → quality 'None' (got ${g.state.systemStats.vacuum.pressureQuality})`);

  // Pressure now comes from the utility solver's P = Q/S rather than from a
  // separate volume-based formula in computeSystemStats, so pumping requires
  // an actual WIRED vacuum network — the stricter, correct contract. An
  // unwired pump next to an unwired source is still atmosphere.
  g.beamline.placeJunction({ type: 'source', col: -8, row: 30, dir: 3, free: true, silent: true });
  g.computeSystemStats();
  assert(g.state.avgPressure === 1013,
    `unwired pumps beside a beamline are still atmospheric (got ${g.state.avgPressure})`);
  // That a wired network DOES pump down is covered by test-scenarios.js
  // (smallBeamlineFacility, fully wired) and test-vacuum-length.js.
  assert(g.state.systemStats.vacuum.pressureQuality !== 'Poor',
    `pressure quality is not stuck at 'Poor' (got ${g.state.systemStats.vacuum.pressureQuality})`);
  const good = g.state.avgPressure;
  g._updateAggregateBeamline();
  assert(g.state.avgPressure === good,
    'the aggregate-beamline pass leaves avgPressure alone (objectives read it)');
}

// ---------------------------------------------------------------------------
console.log('\n=== 8. Space toggles the beam without an explicit id ===\n');
// Regression: InputHandler's Space branch called game.toggleBeam() with no
// argument and toggleBeam had no default, so it always logged "No beamline
// specified!" — a dead affordance the first-run guide taught.
{
  const g = makeGame(107);
  const logs = [];
  const origLog = g.log.bind(g);
  g.log = (msg, kind) => { logs.push(msg); origLog(msg, kind); };
  g.toggleBeam();
  assert(/no beamline built/i.test(logs[logs.length - 1] || ''),
    `empty facility gets an actionable message ("${logs[logs.length - 1]}")`);
  assert(!/no beamline specified/i.test(logs.join('|')),
    'the undiagnosable "No beamline specified!" message is gone');

  // A real single beamline: the no-argument call must resolve it.
  const src = g.beamline.placeJunction({ type: 'source', col: -6, row: 34, dir: 3, free: true, silent: true });
  const det = g.beamline.placeJunction({ type: 'detector', col: 6, row: 34, dir: 3, free: true, silent: true });
  g.beamline.drawPipe(
    { junctionId: src, portName: 'exit' },
    { junctionId: det, portName: 'entry' },
    [{ col: -6, row: 34 }, { col: 6, row: 34 }],
  );
  g.recalcAllBeamlines();
  const entry = g.registry.getBySourceId(src);
  assert(!!entry, 'setup: a beamline entry exists');
  // toggleBeam now recomputes the utility gate synchronously instead of
  // reading whatever the last tick left behind (it used to call the no-op
  // validateInfrastructure()). This block is about id resolution, so pin the
  // gate open rather than wiring six utility lines.
  g.refreshInfrastructureGate = () => { g.state.infraCanRun = true; };
  g.state.infraCanRun = true;
  g.toggleBeam();
  assert(entry.status === 'running', `the sole beamline starts from a bare toggleBeam() (${entry.status})`);
  g.toggleBeam();
  assert(entry.status === 'stopped', 'and stops again');

  // With several beamlines, the selected one wins.
  const other = g.registry.createBeamline('linac', null);
  g.selectedBeamlineId = other.id;
  logs.length = 0;
  g.toggleBeam();
  assert(!/select a beamline/i.test(logs.join('|')),
    'with several beamlines the selected one is used, not an error');
}

// ---------------------------------------------------------------------------
console.log('\n=== 9. Total beam length includes drift ===\n');
// Regression: the length loop skipped flattener drift entries (they carry no
// `type`), so the HUD reported only the summed component lengths.
{
  const g = makeGame(108);
  const src = g.beamline.placeJunction({ type: 'source', col: -6, row: 24, dir: 3, free: true, silent: true });
  const det = g.beamline.placeJunction({ type: 'detector', col: 6, row: 24, dir: 3, free: true, silent: true });
  const pipe = g.beamline.drawPipe(
    { junctionId: src, portName: 'exit' },
    { junctionId: det, portName: 'entry' },
    [{ col: -6, row: 24 }, { col: 6, row: 24 }],
  );
  assert(!!pipe, 'setup: pipe drawn');
  g.beamline.placeOnPipe(pipe, { type: 'quadrupole', position: 0.5, mode: 'snap' });
  g.recalcAllBeamlines();
  const entry = g.registry.getBySourceId(src);
  const ordered = flattenPath(g.state, src);
  const last = ordered[ordered.length - 1];
  const trueLen = (last.beamStart || 0) + (last.subL || 0) * 0.5;
  assert(entry && Math.abs(entry.beamState.totalLength - trueLen) < 0.01,
    `totalLength matches the flattened machine (${entry?.beamState.totalLength} vs ${trueLen})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 10. Fallback physics honours utility quality ===\n');
// Regression: _fallbackStatsForBeamline (the whole physics model in node, and
// the model in-browser until Pyodide finishes loading) ignored el.infraQuality,
// so the Phase-6 utility-quality -> beam-output coupling was a no-op there.
{
  const g = makeGame(109);
  const entry = g.registry.createBeamline('linac', null);
  const beamline = [
    { type: 'rfCavity', subL: 4, stats: { energyGain: 0.1 }, params: {} },
    { type: 'rfCavity', subL: 4, stats: { energyGain: 0.1 }, params: {} },
  ];
  g._fallbackStatsForBeamline(entry, beamline);
  const healthy = { e: entry.beamState.beamEnergy, q: entry.beamState.beamQuality };

  const starved = beamline.map(el => ({ ...el, infraQuality: { powerQuality: 0.5, coolingQuality: 0.5, vacuumQuality: 0 } }));
  g._fallbackStatsForBeamline(entry, starved);
  assert(entry.beamState.beamEnergy < healthy.e,
    `poor power/cooling cuts energy gain (${entry.beamState.beamEnergy} < ${healthy.e})`);
  assert(entry.beamState.beamQuality < healthy.q,
    `poor vacuum cuts beam quality (${entry.beamState.beamQuality} < ${healthy.q})`);

  const quenched = beamline.map(el => ({ ...el, infraQuality: { cryoQuenched: true } }));
  g._fallbackStatsForBeamline(entry, quenched);
  assert(entry.beamState.beamEnergy === 0, 'a quenched cavity contributes no energy gain');
}

// ---------------------------------------------------------------------------
console.log('\n=== 11. Probe pins resolve onto the resampled envelope ===\n');
// Regression: pins carried an index into state.beamline (one entry per
// element) but were used to index state.physicsEnvelope, which is the physics
// engine's fixed-size resample indexed by sample position. Every pin therefore
// resolved into the first element's snapshot, so the summary card reported the
// source's numbers under the pinned element's label.
{
  // 5 elements spanning 0..13 m, resampled onto 1000 points like lattice.py.
  const beamline = [
    { id: 'n0', type: 'source', beamStart: 0, subL: 4 },
    { id: 'n1', type: 'drift', beamStart: 2, subL: 8 },
    { id: 'n2', type: 'quadrupole', beamStart: 6, subL: 2 },
    { id: 'n3', type: 'drift', beamStart: 7, subL: 8 },
    { id: 'n4', type: 'detector', beamStart: 11, subL: 4 },
  ];
  const N = 1000;
  const envelope = [];
  for (let i = 0; i < N; i++) {
    const s = 2 + (13 - 2) * (i / (N - 1));
    envelope.push({ s, index: beamline.findIndex(n => s < n.beamStart + n.subL * 0.5 + 1e-9) });
  }
  const self = { game: { state: { beamline } }, pins: [{ nodeId: 'n4', elementIndex: 4, s: null }] };
  ProbeWindow.prototype._resolvePinsToEnvelope.call(self, envelope);
  const pin = self.pins[0];
  assert(Math.abs(pin.s - 12) < 0.01, `pin.s is the element's mid-point in metres (got ${pin.s})`);
  const resolved = envelope[pin.elementIndex];
  assert(resolved.s > 11 && resolved.s <= 13,
    `the resolved sample sits inside the detector, not the source (s=${resolved.s.toFixed(2)} m)`);
  assert(pin.elementIndex > 900,
    `resolution is a sample index, not an element index (got ${pin.elementIndex})`);
  assert(envelope[4].s < 3, 'sanity: element-index addressing would have read the source');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
