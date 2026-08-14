// test/test-utility-run-wiring.js — the run-wiring gesture.
//
// On-pipe components are wired individually, so a FODO cell is a dozen
// identical endpoint-to-endpoint drags. Shift-dragging from a source port
// along the pipe wires every compatible sink the cursor passes, in one action.
//
//   1. Planner: sinks in the corridor are planned, sinks outside it are not,
//      already-wired and wrong-utility ports are skipped silently, and every
//      planned stub is a route the real validator accepts.
//   2. Controller: a run-drag across N sinks commits N lines and exactly ONE
//      undo entry; undo restores all of them at once.
//   3. Cost: charged off the committed length, checked BEFORE anything
//      mutates — an unaffordable run leaves the world and the funds untouched.
//      The ORDINARY single-line drag is priced by the same rule at the real
//      descriptor rate; a free single line would make the bulk gesture the only
//      one that costs anything.
//   4. The modifier is what selects the gesture: the same drag without it is
//      still a single line, and the tool passes the shift state through.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { UtilityLineInputController } from '../src/input/UtilityLineInputController.js';
import { UtilityLineTool } from '../src/input/utility-line-tool.js';
import { planUtilityRun, runPreviewPath } from '../src/input/utility-run-wiring.js';
import { validateDrawLine } from '../src/utility/line-drawing.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';
import { portWorldPosition } from '../src/utility/ports.js';
import { gridToIso } from '../src/renderer/grid.js';

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

// --- world ----------------------------------------------------------------
//
// An hvTransformer north of a west→east pipe carrying four quadrupoles. The
// transformer's pwr_out faces east (tile 1.75, 1.5); each quad's pwr_in faces
// north, at tiles (2.25 | 4.25 | 6.25 | 8.25, 4.75). A fifth quad sits far
// down the pipe, outside any corridor the test drags.
const SOURCE_PORT = { placeableId: 'src_1', portName: 'pwr_out_1' };
const RUN_QUADS = ['pl_1', 'pl_2', 'pl_3', 'pl_4'];

function makeWorld(game) {
  game.state.placeables.push({
    id: 'src_1', type: 'mcc', kind: 'infrastructure',
    category: 'infrastructure', col: 1, row: 1, subCol: 0, subRow: 0, dir: 0,
  });
  game.state.beamPipes.push({
    id: 'bp_1', subL: 80, start: null, end: null,
    path: [{ col: 0, row: 5 }, { col: 20, row: 5 }],
    placements: [0.1, 0.2, 0.3, 0.4, 0.85].map((position, i) => ({
      id: `pl_${i + 1}`, type: 'quadrupole', position, subL: 2, params: {},
    })),
  });
  return game;
}

function makeGame() {
  const g = new Game(new BeamlineRegistry(), { seed: 7 });
  g.state.resources.funding = 1e9;
  return makeWorld(g);
}

// The drag the player makes: anchor on the transformer port, then along the
// pipe past the first four quads (never as far as pl_5 at col ~17).
const DRAG = [
  { col: 1.75, row: 1.5 },
  { col: 2, row: 5 },
  { col: 5, row: 5 },
  { col: 10, row: 5 },
];

function makeController(game) {
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('powerCable');
  return ctrl;
}

// Drive a whole gesture through the controller in iso-pixel space, exactly as
// the tool does. `run` is the shift state.
function dragRun(ctrl, { run = true, points = DRAG } = {}) {
  const iso = points.map(p => gridToIso(p.col, p.row));
  ctrl.onMouseDown(iso[0].x, iso[0].y, 0, { run });
  for (let i = 1; i < iso.length; i++) ctrl.onMouseMove(iso[i].x, iso[i].y, { run });
  const last = iso[iso.length - 1];
  ctrl.onMouseUp(last.x, last.y, 0, { run });
}

function powerLines(game) {
  return Array.from(game.state.utilityLines.values())
    .filter(l => l.utilityType === 'powerCable');
}

console.log('\n--- 1. Planner: corridor, compatibility, routability ---');
{
  const game = makeGame();
  const plan = planUtilityRun(game.state, {
    utilityType: 'powerCable', source: SOURCE_PORT, runPath: DRAG,
  });
  assert(plan.stubs.length === 4, `four sinks in the corridor (got ${plan.stubs.length})`);
  assert(plan.skipped === 0, `nothing unroutable (got ${plan.skipped})`);
  const ends = plan.stubs.map(s => s.end.placeableId);
  assert(RUN_QUADS.every(id => ends.includes(id)), `the four swept quads: ${ends.join(',')}`);
  assert(!ends.includes('pl_5'), 'the quad past the end of the drag is left alone');
  assert(plan.stubs.every(s => s.end.portName === 'pwr_in'),
    'only the powerCable sink port of each quad is targeted');
  assert(plan.stubs.every(s => s.start.placeableId === 'src_1'),
    'every stub leaves the one distribution panel');
  assert(plan.stubs.every(s => validateDrawLine(game.state, {
    utilityType: 'powerCable', start: s.start, end: s.end, path: s.path,
  }).ok), 'every planned stub is a route validateDrawLine accepts');
  assert(plan.totalSubL === plan.stubs.reduce((a, s) => a + s.subL, 0) && plan.totalSubL > 0,
    `totalSubL is the sum of the stub lengths (got ${plan.totalSubL})`);

  // Ordering follows the drag, so the preview reads the way the hand moved.
  const cols = plan.stubs.map(s => s.path[s.path.length - 1].col);
  assert(cols.every((c, i) => i === 0 || c >= cols[i - 1]),
    `stubs are ordered along the run (${cols.join(',')})`);

  // The preview is one continuous polyline over the real stubs.
  const preview = runPreviewPath(plan.stubs);
  assert(preview.length > 0, 'the preview path is non-empty');
  assert(preview.every((p, i) => i === 0
    || Math.abs(p.col - preview[i - 1].col) < 1e-9
    || Math.abs(p.row - preview[i - 1].row) < 1e-9),
    'the preview stays axis-aligned (no spurious diagonal between stubs)');
}

{
  // Interactive run-wiring injects the visible connector positions. The pure
  // planner must use them at BOTH ends instead of quietly falling back to the
  // larger logical footprint, which would restore the terminal loops only for
  // Shift-drags.
  const game = makeGame();
  const supplied = new Map();
  const plan = planUtilityRun(game.state, {
    utilityType: 'powerCable', source: SOURCE_PORT, runPath: DRAG,
    portPosition(endpoint, def, portName) {
      const base = portWorldPosition(endpoint, def, portName);
      const pos = { x: base.x + 0.5, z: base.z };
      supplied.set(`${endpoint.id}:${portName}`, pos);
      return pos;
    },
  });
  const snapTile = p => ({
    col: Math.round((p.x / 2) * 4) / 4,
    row: Math.round((p.z / 2) * 4) / 4,
  });
  const usedInjectedEnds = plan.stubs.length > 0 && plan.stubs.every(stub => {
    const a = snapTile(supplied.get(`${stub.start.placeableId}:${stub.start.portName}`));
    const b = snapTile(supplied.get(`${stub.end.placeableId}:${stub.end.portName}`));
    const first = stub.path[0], last = stub.path[stub.path.length - 1];
    return first.col === a.col && first.row === a.row
      && last.col === b.col && last.row === b.row;
  });
  assert(usedInjectedEnds,
    'bulk routes use the injected visible-connector positions at source and sink');
}

{
  // A sink already wired on this utility is not offered again; a sink of a
  // different utility is never offered at all.
  const game = makeGame();
  game.state.utilityLines.set('ul_pre', {
    id: 'ul_pre', utilityType: 'powerCable',
    start: { placeableId: 'src_1', portName: 'pwr_out_1' },
    end: { placeableId: 'pl_2', portName: 'pwr_in' },
    path: [{ col: 4.25, row: 3 }, { col: 4.25, row: 4.75 }],
  });
  const plan = planUtilityRun(game.state, {
    utilityType: 'powerCable', source: SOURCE_PORT, runPath: DRAG,
  });
  const ends = plan.stubs.map(s => s.end.placeableId);
  assert(plan.stubs.length === 3 && !ends.includes('pl_2'),
    `the already-wired quad is skipped silently (got ${ends.join(',') || 'none'})`);

  const wrongUtility = planUtilityRun(game.state, {
    utilityType: 'dataFiber', source: SOURCE_PORT, runPath: DRAG,
  });
  assert(wrongUtility.stubs.length === 0,
    'a power source plans nothing for a utility it does not carry');
}

{
  // A sink port cannot fan out — planning off one is refused outright.
  const game = makeGame();
  const plan = planUtilityRun(game.state, {
    utilityType: 'powerCable',
    source: { placeableId: 'pl_1', portName: 'pwr_in' },
    runPath: DRAG,
  });
  assert(plan.stubs.length === 0, 'a run anchored on a sink plans nothing');
}

console.log('\n--- 2. One drag, N lines, ONE undo entry ---');
{
  const game = makeGame();
  const ctrl = makeController(game);
  const undoBefore = game._undoStack.length;

  dragRun(ctrl);

  const lines = powerLines(game);
  assert(lines.length === 4, `four lines committed by one drag (got ${lines.length})`);
  assert(new Set(lines.map(l => l.end.placeableId)).size === 4,
    'each line lands on a different quad');
  // Power is point to point, so the four lines leave from four DIFFERENT
  // outlets on the one panel — that is what makes outlet count a resource, and
  // what the gesture is spending when it wires a row of magnets.
  assert(lines.every(l => l.start.placeableId === 'src_1'),
    'all four leave the same distribution panel');
  assert(new Set(lines.map(l => l.start.portName)).size === 4,
    `each takes its own outlet (got ${JSON.stringify(lines.map(l => l.start.portName).sort())})`);
  assert(game._undoStack.length === undoBefore + 1,
    `exactly one undo entry for the whole gesture (got ${game._undoStack.length - undoBefore})`);

  game.undo();
  assert(powerLines(game).length === 0,
    `one undo removes all four lines (got ${powerLines(game).length})`);

  game.redo();
  assert(powerLines(game).length === 4,
    `redo brings the whole run back (got ${powerLines(game).length})`);
}

{
  // Live preview: mid-drag the controller already knows what it will wire.
  const game = makeGame();
  const ctrl = makeController(game);
  const iso = DRAG.map(p => gridToIso(p.col, p.row));
  ctrl.onMouseDown(iso[0].x, iso[0].y, 0, { run: true });
  ctrl.onMouseMove(iso[1].x, iso[1].y, { run: true });
  ctrl.onMouseMove(iso[2].x, iso[2].y, { run: true });
  const midway = ctrl.runPlan ? ctrl.runPlan.stubs.length : -1;
  assert(midway >= 1 && midway < 4,
    `half a drag previews only the sinks passed so far (got ${midway})`);
  ctrl.onMouseMove(iso[3].x, iso[3].y, { run: true });
  assert(ctrl.runPlan && ctrl.runPlan.stubs.length === 4,
    `the full drag previews all four (got ${ctrl.runPlan && ctrl.runPlan.stubs.length})`);
  assert(ctrl.preview && ctrl.preview.path.length > 0,
    'the preview polyline is populated while dragging');
  assert(powerLines(game).length === 0, 'previewing has committed nothing');

  ctrl.onEscape();
  assert(ctrl.runPlan === null && powerLines(game).length === 0,
    'escape drops the plan without committing');
}

console.log('\n--- 3. Cost is validated before anything mutates ---');
{
  // _wiringCost is the seam the descriptor price flows through; stub it to a
  // round number so the assertion reads off the committed length rather than
  // the live powerCable rate (which the real-price case below pins).
  const game = makeGame();
  const ctrl = makeController(game);
  ctrl._wiringCost = (subL) => (subL > 0 ? { funding: subL * 10 } : null);
  const fundsBefore = game.state.resources.funding;

  dragRun(ctrl);

  const lines = powerLines(game);
  const committedSubL = lines.reduce((a, l) => a + l.subL, 0);
  assert(lines.length === 4, `the affordable run committed (got ${lines.length})`);
  assert(game.state.resources.funding === fundsBefore - committedSubL * 10,
    `charged for the committed length exactly (spent ${fundsBefore - game.state.resources.funding}, `
    + `expected ${committedSubL * 10})`);
}

{
  const game = makeGame();
  const ctrl = makeController(game);
  ctrl._wiringCost = (subL) => (subL > 0 ? { funding: 5_000_000 } : null);
  game.state.resources.funding = 1000;
  const undoBefore = game._undoStack.length;

  dragRun(ctrl);

  assert(powerLines(game).length === 0, 'an unaffordable run commits no lines');
  assert(game.state.resources.funding === 1000, 'and charges nothing');
  assert(game._undoStack.length === undoBefore,
    'and pushes no undo entry (nothing was mutated)');
}

{
  // The ordinary single line, at the real descriptor price — nothing stubbed.
  // This is the case that regressed: only the run path passed a cost, so the
  // convenient bulk gesture was the only one that charged and the optimal play
  // was to draw one free line at a time.
  const perSubUnit = UTILITY_TYPES.powerCable.costPerSubUnit;
  assert(perSubUnit > 0, `powerCable declares a price (got ${perSubUnit})`);

  const game = makeGame();
  const ctrl = makeController(game);
  const fundsBefore = game.state.resources.funding;

  dragRun(ctrl, { run: false });

  const lines = powerLines(game);
  assert(lines.length === 1, `the drag committed one line (got ${lines.length})`);
  const expected = Math.round(perSubUnit * lines[0].subL);
  assert(lines[0].subL > 0 && fundsBefore - game.state.resources.funding === expected,
    `charged the descriptor rate for its ${lines[0].subL} sub-units `
    + `(spent ${fundsBefore - game.state.resources.funding}, expected ${expected})`);
}

{
  // …and it is checked before the mutation, same as a run.
  const game = makeGame();
  const ctrl = makeController(game);
  game.state.resources.funding = 100;
  const undoBefore = game._undoStack.length;

  dragRun(ctrl, { run: false });

  assert(powerLines(game).length === 0, 'an unaffordable single line commits nothing');
  assert(game.state.resources.funding === 100, 'and charges nothing');
  assert(game._undoStack.length === undoBefore, 'and pushes no undo entry');
}

console.log('\n--- 4. The modifier is what selects the gesture ---');
{
  // Same drag, no modifier: the ordinary single-line path. It ends in open
  // space here, so it draws one open-ended line rather than four stubs.
  const game = makeGame();
  const ctrl = makeController(game);
  dragRun(ctrl, { run: false });
  const lines = powerLines(game);
  assert(lines.length <= 1, `no modifier means no run (got ${lines.length} lines)`);
  assert(!lines.some(l => l.end && RUN_QUADS.includes(l.end.placeableId)),
    'and nothing on the pipe was wired');
}

{
  // Releasing the modifier mid-drag drops the plan; taking it again rebuilds
  // it, so the player can look at the payoff and back out of it.
  const game = makeGame();
  const ctrl = makeController(game);
  const iso = DRAG.map(p => gridToIso(p.col, p.row));
  ctrl.onMouseDown(iso[0].x, iso[0].y, 0, { run: true });
  for (let i = 1; i < iso.length; i++) ctrl.onMouseMove(iso[i].x, iso[i].y, { run: true });
  assert(ctrl.runPlan.stubs.length === 4, 'plan is live with the modifier held');
  ctrl.onMouseMove(iso[iso.length - 1].x, iso[iso.length - 1].y, { run: false });
  assert(ctrl.runPlan === null, 'releasing the modifier clears the plan without moving');
  ctrl.onMouseMove(iso[iso.length - 1].x, iso[iso.length - 1].y, { run: true });
  assert(ctrl.runPlan && ctrl.runPlan.stubs.length === 4,
    'taking it again rebuilds the same plan');
  ctrl.onMouseUp(iso[iso.length - 1].x, iso[iso.length - 1].y, 0, { run: false });
  assert(powerLines(game).length <= 1,
    `released on mouse-up, it commits as a single line (got ${powerLines(game).length})`);
}

{
  // The tool layer passes the shift state through to the controller and
  // reports the live count on the drag tooltip.
  const game = makeGame();
  const tool = new UtilityLineTool('powerCable');
  const tooltip = { shown: 0, hidden: 0, note: null, cost: null };
  const input = {
    utilityLineController: makeController(game),
    lastMouseWorldX: 0, lastMouseWorldY: 0, _lastScreenX: 0, _lastScreenY: 0,
    _checkHoverTooltip() {},
    _showDragCostTooltip(cost, _x, _y, opts = {}) {
      tooltip.shown++; tooltip.cost = cost; tooltip.note = opts.note;
    },
    _hideDragCostTooltip() { tooltip.hidden++; },
  };
  const renderer = {
    screenToWorld: (x, y) => ({ x, y }),
    updateHover() {},
    _renderCursors() {}, _clearGridOverlay() {},
  };
  const ctx = { game, input, renderer };
  const ev = (p, shiftKey) => {
    const iso = gridToIso(p.col, p.row);
    return { clientX: iso.x, clientY: iso.y, button: 0, shiftKey };
  };

  tool.onMouseDown(ev(DRAG[0], true), ctx);
  for (let i = 1; i < DRAG.length; i++) tool.onMouseMove(ev(DRAG[i], true), ctx);
  assert(tooltip.note === 'wire 4 components',
    `the tooltip counts the sinks the drag will wire (got ${JSON.stringify(tooltip.note)})`);
  tool.onMouseUp(ev(DRAG[DRAG.length - 1], true), ctx);
  assert(powerLines(game).length === 4,
    `the tool's shift-drag committed the run (got ${powerLines(game).length})`);
  assert(tooltip.hidden > 0, 'the tooltip is taken down when the drag ends');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
