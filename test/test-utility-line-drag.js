// test/test-utility-line-drag.js — the ORDINARY port-to-port utility drag.
//
// The player clicks a port marker, drags to another port marker, releases. That
// has to commit whatever the two ports' facings are: a straight start→end
// Manhattan L leaves the first leg horizontal and the last vertical, which
// satisfies validateDrawLine's port-approach rule only when the two sides
// happen to match that shape. Every other pair — dragging back toward the
// source, a source facing away from its sink, two ports on the same axis —
// silently died at commit with "doesn't align with port direction".
//
// So: route with a lead-out along each port's own outward normal (what
// run-wiring already does for its stubs) and keep whichever bend order the real
// validator accepts.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { UtilityLineInputController } from '../src/input/UtilityLineInputController.js';
import { UtilityLineTool } from '../src/input/utility-line-tool.js';
import { utilityLineHeight } from '../src/utility/registry.js';
import { buildPortRoutedPath } from '../src/utility/line-geometry.js';
import { validateDrawLine } from '../src/utility/line-drawing.js';
import { portWorldPosition, portSide, portApproachVec } from '../src/utility/ports.js';
import { findUtilityEndpoint } from '../src/utility/utility-endpoints.js';
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
// One hvTransformer (its pwr_out sits on the 'right' side, so `dir` rotates it
// to any compass point) plus a west→east pipe carrying four quadrupoles, whose
// pwr_in faces north. `dir` and `col` of the transformer are the knobs each
// case turns.
function makeGame({ dir = 0, col = 1, row = 1 } = {}) {
  const g = new Game(new BeamlineRegistry(), { seed: 7 });
  g.state.resources.funding = 1e9;
  g.state.placeables.push({
    id: 'src_1', type: 'mcc', kind: 'infrastructure',
    category: 'infrastructure', col, row, subCol: 0, subRow: 0, dir,
  });
  g.state.beamPipes.push({
    id: 'bp_1', subL: 80, start: null, end: null,
    path: [{ col: 0, row: 5 }, { col: 20, row: 5 }],
    placements: [0.1, 0.3, 0.5, 0.85].map((position, i) => ({
      id: `pl_${i + 1}`, type: 'quadrupole', position, subL: 2, params: {},
    })),
  });
  g._logs = [];
  g.log = (m, kind) => g._logs.push(`[${kind}] ${m}`);
  if (g.utilityLineSystem) g.utilityLineSystem.log = g.log;
  return g;
}

// Tile coords of a port, which is where its marker is drawn and therefore
// where the player clicks.
function portTile(game, placeableId, portName) {
  const ep = findUtilityEndpoint(game.state, placeableId);
  const def = COMPONENTS[ep.type];
  const p = portWorldPosition(ep, def, portName);
  return { col: p.x / 2, row: p.z / 2 };
}

// Outward normal of a port — what the router routes off, the same lookup the
// controller's own _anchorVec does.
function anchorVec(game, placeableId, portName) {
  const ep = findUtilityEndpoint(game.state, placeableId);
  return portApproachVec(ep, COMPONENTS[ep.type], portName);
}

function facing(game, placeableId, portName) {
  const ep = findUtilityEndpoint(game.state, placeableId);
  return portSide(COMPONENTS[ep.type], portName, ep.dir || 0);
}

// Drive a whole gesture through the controller in iso-pixel space, exactly as
// UtilityLineTool does. No modifier — this is the plain single-line drag.
function drag(game, from, to, { utilityType = 'powerCable' } = {}) {
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType(utilityType);
  const a = gridToIso(from.col, from.row);
  const b = gridToIso(to.col, to.row);
  ctrl.onMouseDown(a.x, a.y, 0, {});
  ctrl.onMouseMove((a.x + b.x) / 2, (a.y + b.y) / 2, {});
  ctrl.onMouseMove(b.x, b.y, {});
  const previewPath = ctrl.preview && ctrl.preview.path.map(p => ({ ...p }));
  ctrl.onMouseUp(b.x, b.y, 0, {});
  return { ctrl, previewPath };
}

function powerLines(game) {
  return Array.from(game.state.utilityLines.values())
    .filter(l => l.utilityType === 'powerCable');
}

console.log('\n--- 1. A port-to-port drag commits whatever way the ports face ---');
{
  // The transformer's pwr_out is rotated to each compass point in turn; the
  // quad's pwr_in always faces north. Only one of these four is the shape a
  // plain Manhattan L happened to produce.
  for (const dir of [0, 1, 2, 3]) {
    const game = makeGame({ dir });
    const src = portTile(game, 'src_1', 'pwr_out_1');
    const sink = portTile(game, 'pl_2', 'pwr_in');
    drag(game, src, sink);
    const lines = powerLines(game);
    assert(lines.length === 1,
      `source facing ${facing(game, 'src_1', 'pwr_out_1')} → sink facing N commits`
      + ` (got ${lines.length}${game._logs.join('') && ' — ' + game._logs.join(' | ')})`);
    if (lines.length === 1) {
      assert(lines[0].start.placeableId === 'src_1' && lines[0].end.placeableId === 'pl_2',
        '  and it joins exactly those two ports');
    }
  }
}

{
  // The same drag made the other way round. This is the one the player hits
  // constantly: grab the component, pull the cable back to the transformer.
  const game = makeGame();
  const src = portTile(game, 'src_1', 'pwr_out_1');
  const sink = portTile(game, 'pl_2', 'pwr_in');
  drag(game, sink, src);
  const lines = powerLines(game);
  assert(lines.length === 1,
    `sink → source drags the same line back (got ${lines.length}`
    + `${game._logs.length ? ' — ' + game._logs.join(' | ') : ''})`);
  assert(lines.length === 1 && lines[0].start.placeableId === 'pl_2'
    && lines[0].end.placeableId === 'src_1',
    'with the anchors in the order the player drew them');
}

{
  // Source east of its sink: the lead-out has to head away from the target
  // before the path turns back, which a single-bend L can never do.
  const game = makeGame({ col: 14, row: 1 });
  const src = portTile(game, 'src_1', 'pwr_out_1');   // faces E, at col ~14.75
  const sink = portTile(game, 'pl_1', 'pwr_in');    // at col ~2.25
  assert(src.col > sink.col, 'the source really is east of the sink');
  drag(game, src, sink);
  assert(powerLines(game).length === 1,
    `a drag against the port's facing still commits (got ${powerLines(game).length}`
    + `${game._logs.length ? ' — ' + game._logs.join(' | ') : ''})`);
}

console.log('\n--- 2. The preview is the line that commits ---');
{
  const game = makeGame({ dir: 2 });
  const src = portTile(game, 'src_1', 'pwr_out_1');
  const sink = portTile(game, 'pl_3', 'pwr_in');
  const { previewPath } = drag(game, src, sink);
  const lines = powerLines(game);
  assert(lines.length === 1, 'the drag committed');
  assert(previewPath && lines.length === 1
    && JSON.stringify(previewPath) === JSON.stringify(lines[0].path),
    'the path previewed on the last mousemove is the path that landed');
}

console.log('\n--- 3. Open-ended drags are unchanged ---');
{
  // Nowhere near a port at either end: still one plain open line.
  const game = makeGame();
  drag(game, { col: 12, row: 12 }, { col: 15, row: 14 });
  const lines = powerLines(game);
  assert(lines.length === 1, `an empty-space drag draws an open line (got ${lines.length})`);
  assert(lines.length === 1 && !lines[0].start && !lines[0].end,
    'with both endpoints open');
}

{
  // Port at one end only: lead-out on that end, cursor point on the other.
  const game = makeGame();
  const src = portTile(game, 'src_1', 'pwr_out_1');
  drag(game, src, { col: 12, row: 12 });
  const lines = powerLines(game);
  assert(lines.length === 1 && lines[0].start && lines[0].start.placeableId === 'src_1'
    && !lines[0].end,
    `a port→empty drag anchors one end only (got ${lines.length}`
    + `${game._logs.length ? ' — ' + game._logs.join(' | ') : ''})`);
}

console.log('\n--- 4. R flips which way the bend turns ---');
{
  // dir:1 puts the source's pwr_out on its south side, facing the north-facing
  // pwr_in it is being dragged to. Both bend orders then cost the same — same
  // number of corners, same length — so the player's choice is the only thing
  // separating them. Without this the corner was whatever _preferVerticalFirst
  // happened to be initialised to, and nothing could change it.
  //
  // The source used to face EAST here, back when the controller kept whichever
  // of the two orders the validator accepted and the validator accepted both.
  // Now that the router scores routes, an east-facing source reaching a
  // north-facing sink has one clearly better answer (a single corner against
  // three), and R correctly refuses to make the route worse. R selects between
  // equals; this case is the equals.
  const corners = [];
  for (const vertFirst of [false, true]) {
    const game = makeGame({ dir: 1 });
    const ctrl = new UtilityLineInputController({ game, renderer: {} });
    ctrl.setUtilityType('powerCable');
    ctrl.setPreferVerticalFirst(vertFirst);
    const src = portTile(game, 'src_1', 'pwr_out_1');
    const sink = portTile(game, 'pl_2', 'pwr_in');
    const from = gridToIso(src.col, src.row);
    const to = gridToIso(sink.col, sink.row);
    ctrl.onMouseDown(from.x, from.y, 0, {});
    ctrl.onMouseMove(to.x, to.y, {});
    ctrl.onMouseUp(to.x, to.y, 0, {});
    const lines = powerLines(game);
    assert(lines.length === 1,
      `preferVerticalFirst=${vertFirst} still commits (got ${lines.length}`
      + `${game._logs.length ? ' — ' + game._logs.join(' | ') : ''})`);
    if (lines.length === 1) corners.push(JSON.stringify(lines[0].path));
  }
  assert(corners.length === 2 && corners[0] !== corners[1],
    `the two bend orders give different paths\n    ${corners.join('\n    ')}`);
}

{
  // The toggle is what the R key is bound to, so it has to actually flip.
  const ctrl = new UtilityLineInputController({ game: makeGame(), renderer: {} });
  ctrl.setUtilityType('powerCable');
  const before = ctrl.preferVerticalFirst;
  ctrl.togglePreferVerticalFirst();
  assert(ctrl.preferVerticalFirst === !before, 'togglePreferVerticalFirst flips it');
}

{
  // The tool consumes R only mid-drag: otherwise R keeps its global meaning
  // (rotate a placement / open research).
  const game = makeGame();
  const tool = new UtilityLineTool('powerCable');
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('powerCable');
  const input = {
    utilityLineController: ctrl,
    lastMouseWorldX: 0, lastMouseWorldY: 0, _lastScreenX: 0, _lastScreenY: 0,
    _checkHoverTooltip() {}, _showDragCostTooltip() {}, _hideDragCostTooltip() {},
  };
  const ctx = { game, input, renderer: { screenToWorld: (x, y) => ({ x, y }) } };
  assert(tool.onRotateKey(ctx) === false, 'R is not consumed when no drag is in flight');
  const src = portTile(game, 'src_1', 'pwr_out_1');
  const from = gridToIso(src.col, src.row);
  ctrl.onMouseDown(from.x, from.y, 0, {});
  const before = ctrl.preferVerticalFirst;
  assert(tool.onRotateKey(ctx) === true, 'and it IS consumed mid-drag');
  assert(ctrl.preferVerticalFirst === !before, 'flipping the bend order as it goes');
}

console.log('\n--- 5. The tool picks on the cable plane, not the floor ---');
{
  // Lines are drawn at UTILITY_LINE_Y. A tool that picks against the ground
  // hands the controller a point that renders a fixed distance up-screen of
  // the mouse — the "places above where I clicked" report.
  const game = makeGame();
  const tool = new UtilityLineTool('powerCable');
  const seen = [];
  const renderer = {
    screenToWorld: (x, y) => { seen.push(['ground', x, y]); return { x, y }; },
    screenToWorldAtHeight: (x, y, h) => { seen.push(['plane', x, y, h]); return { x, y }; },
    updateHover() {}, _renderCursors() {}, _clearGridOverlay() {},
  };
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('powerCable');
  const input = {
    utilityLineController: ctrl,
    lastMouseWorldX: 0, lastMouseWorldY: 0, _lastScreenX: 0, _lastScreenY: 0,
    _checkHoverTooltip() {}, _showDragCostTooltip() {}, _hideDragCostTooltip() {},
  };
  const ctx = { game, input, renderer };
  tool.onMouseDown({ clientX: 10, clientY: 20, button: 0, shiftKey: false }, ctx);
  tool.onMouseMove({ clientX: 30, clientY: 40, shiftKey: false }, ctx);
  tool.onMouseUp({ clientX: 30, clientY: 40, button: 0, shiftKey: false }, ctx);
  const planePicks = seen.filter(s => s[0] === 'plane');
  assert(planePicks.length === 3,
    `down/move/up all pick on the cable plane (got ${planePicks.length})`);
  assert(planePicks.every(p => p[3] === utilityLineHeight('powerCable')),
    `at exactly the armed utility's run height (${utilityLineHeight('powerCable')})`);
}

{
  // Run heights are per utility now — a power cord lies on the floor while a
  // vacuum pipe rides at working height — so the pick plane has to follow the
  // ARMED tool, not one global constant. A shared plane would put one of the
  // two back to landing off-cursor.
  const heights = {};
  for (const type of ['powerCable', 'vacuumPipe']) {
    const game = makeGame();
    const tool = new UtilityLineTool(type);
    const ctrl = new UtilityLineInputController({ game, renderer: {} });
    ctrl.setUtilityType(type);
    const renderer = {
      screenToWorld: (x, y) => ({ x, y }),
      screenToWorldAtHeight: (x, y, h) => { heights[type] = h; return { x, y }; },
      updateHover() {}, _renderCursors() {}, _clearGridOverlay() {},
    };
    const ctx = {
      game, renderer,
      input: {
        utilityLineController: ctrl,
        lastMouseWorldX: 0, lastMouseWorldY: 0, _lastScreenX: 0, _lastScreenY: 0,
        _checkHoverTooltip() {}, _showDragCostTooltip() {}, _hideDragCostTooltip() {},
      },
    };
    tool.onMouseDown({ clientX: 10, clientY: 20, button: 0, shiftKey: false }, ctx);
  }
  assert(heights.powerCable === utilityLineHeight('powerCable')
    && heights.vacuumPipe === utilityLineHeight('vacuumPipe'),
    `each tool picks at its own utility's height (${JSON.stringify(heights)})`);
  assert(heights.powerCable !== heights.vacuumPipe,
    'and those are genuinely different planes');
  assert(heights.powerCable < 0.1,
    `the power cord runs on the floor (${heights.powerCable} m)`);
}

console.log('\n--- 6. Right-click erases a line of the armed utility ---');
{
  const game = makeGame();
  const src = portTile(game, 'src_1', 'pwr_out_1');
  const sink = portTile(game, 'pl_2', 'pwr_in');
  drag(game, src, sink);
  assert(powerLines(game).length === 1, 'a line to erase');
  const line = powerLines(game)[0];
  const mid = line.path[Math.floor(line.path.length / 2)];

  const tool = new UtilityLineTool('powerCable');
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('powerCable');
  const iso = gridToIso(mid.col, mid.row);
  const input = {
    utilityLineController: ctrl,
    lastMouseWorldX: 0, lastMouseWorldY: 0, _lastScreenX: 0, _lastScreenY: 0,
    _checkHoverTooltip() {}, _showDragCostTooltip() {}, _hideDragCostTooltip() {},
  };
  // No raycastUtilityLine: this exercises the proximity fallback, which is the
  // path that actually fires at normal zoom on a 2 cm cable.
  const renderer = { screenToWorld: () => iso, updateHover() {} };
  const ctx = { game, input, renderer };
  const undoBefore = game._undoStack.length;

  const consumed = tool.onRightClick({ clientX: iso.x, clientY: iso.y }, ctx);
  assert(consumed === true, 'right-click on the line is consumed');
  assert(powerLines(game).length === 0,
    `and the line is gone (got ${powerLines(game).length})`);
  assert(game._undoStack.length === undoBefore + 1, 'as one undo entry');
  game.undo();
  assert(powerLines(game).length === 1, 'which undo puts back');
}

{
  // Armed on a different utility: the click is not consumed and nothing is
  // removed — six utilities share the same walls, and deleting the wrong one
  // is worse than deleting nothing.
  const game = makeGame();
  drag(game, portTile(game, 'src_1', 'pwr_out_1'), portTile(game, 'pl_2', 'pwr_in'));
  const line = powerLines(game)[0];
  const mid = line.path[Math.floor(line.path.length / 2)];
  const iso = gridToIso(mid.col, mid.row);

  const tool = new UtilityLineTool('coolingWater');
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('coolingWater');
  const ctx = {
    game,
    input: {
      utilityLineController: ctrl,
      _hideDragCostTooltip() {},
    },
    renderer: { screenToWorld: () => iso },
  };
  const consumed = tool.onRightClick({ clientX: iso.x, clientY: iso.y }, ctx);
  assert(consumed === false, 'a cooling tool does not consume the click');
  assert(powerLines(game).length === 1, 'and the power line survives');
}

{
  // Mid-drag, right-click abandons the draw rather than deleting anything.
  const game = makeGame();
  const tool = new UtilityLineTool('powerCable');
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('powerCable');
  const src = portTile(game, 'src_1', 'pwr_out_1');
  const from = gridToIso(src.col, src.row);
  ctrl.onMouseDown(from.x, from.y, 0, {});
  const ctx = {
    game,
    input: { utilityLineController: ctrl, _hideDragCostTooltip() {} },
    renderer: { screenToWorld: () => from },
  };
  assert(tool.onRightClick({ clientX: from.x, clientY: from.y }, ctx) === true,
    'right-click mid-drag is consumed');
  assert(ctrl.isActive() === false, 'and cancels the draw');
  assert(powerLines(game).length === 0, 'committing nothing');
}

console.log('\n--- 7. A drag that will be refused says so before the release ---');
{
  // Overlap is the refusal the player hits constantly once a facility has a
  // few runs in it, and the only feedback was the gesture doing nothing: the
  // commit logs a reason, but nothing in the game renders the log.
  const game = makeGame();
  const src = portTile(game, 'src_1', 'pwr_out_1');
  drag(game, src, portTile(game, 'pl_2', 'pwr_in'));
  assert(powerLines(game).length === 1, 'a first line, claiming pl_2\'s inlet');

  // Aim a second line at the inlet that is already taken. The cursor cannot
  // normally snap to it (a claimed sink is not offered), so the anchor is set
  // directly — this is about the controller CAPTURING the validator's reason
  // and exposing it, which is the part the tooltip depends on.
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('powerCable');
  ctrl._drawing = true;
  ctrl._drawStart = {
    placeableId: 'pl_2', portName: 'pwr_in',
    worldPos: { x: portTile(game, 'pl_2', 'pwr_in').col * 2, z: portTile(game, 'pl_2', 'pwr_in').row * 2 },
  };
  ctrl._runTrace = [];
  const away = gridToIso(12, 12);
  ctrl._dragGeometry(away.x, away.y, null);
  const reject = ctrl.dragReject;
  assert(typeof reject === 'string' && reject.length > 0,
    `the controller captures why it would be refused (${reject})`);
  assert(/already connected/.test(reject), `in the player's words (${reject})`);

  ctrl.onEscape();
  assert(ctrl.dragReject === null, 'and the reason clears with the gesture');
}

{
  // A drag that WILL commit must not cry wolf.
  const game = makeGame();
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('powerCable');
  const src = portTile(game, 'src_1', 'pwr_out_1');
  const sink = portTile(game, 'pl_3', 'pwr_in');
  const a = gridToIso(src.col, src.row);
  const b = gridToIso(sink.col, sink.row);
  ctrl.onMouseDown(a.x, a.y, 0, {});
  ctrl.onMouseMove(b.x, b.y, {});
  assert(ctrl.dragReject === null, 'a valid drag reports no refusal');
}

console.log('\n--- 8. Genuinely invalid gestures are still refused ---');
{
  // Port onto itself: no line, no charge.
  const game = makeGame();
  const src = portTile(game, 'src_1', 'pwr_out_1');
  const fundsBefore = game.state.resources.funding;
  drag(game, src, src);
  assert(powerLines(game).length === 0, 'a drag that never left the port commits nothing');
  assert(game.state.resources.funding === fundsBefore, 'and charges nothing');
}

console.log('\n--- 9. A drag routes AROUND cable that is already down ---');
{
  // The board is half of what makes a route usable, and the router cannot see
  // it. So when the best-scoring shape lands on top of an existing run of the
  // same utility, the drag has to fall to the next shape down rather than
  // refuse — otherwise wiring a hall gets harder with every cable laid, which
  // is exactly backwards.
  //
  // Two transformers. The first is wired to pl_3, which sends its cable east
  // along row 2.25 and then south down column 10.25 into the quad. The second
  // sits at col 9 and is dragged to pl_1, whose best route would come south
  // down that same column 10.25 — collinear with the trunk for three tiles,
  // which is "laying cable down an existing run" and is refused. A route one
  // rank down goes south early and crosses the trunk perpendicularly instead,
  // which is an ordinary legal crossing.
  const game = makeGame({ col: 1, row: 2, dir: 0 });
  game.state.placeables.push({
    id: 'src_2', type: 'mcc', kind: 'infrastructure',
    category: 'infrastructure', col: 9, row: 1, subCol: 0, subRow: 0, dir: 0,
  });

  drag(game, portTile(game, 'src_1', 'pwr_out_1'), portTile(game, 'pl_3', 'pwr_in'));
  const trunk = powerLines(game)[0];
  assert(powerLines(game).length === 1, 'a trunk is already down');

  // The route the router likes best, with no board in the way. This is the one
  // that has to be refused for the case to be testing anything.
  const src2 = portTile(game, 'src_2', 'pwr_out_1');
  const sink = portTile(game, 'pl_1', 'pwr_in');
  const preferred = buildPortRoutedPath(
    { col: src2.col, row: src2.row }, anchorVec(game, 'src_2', 'pwr_out_1'),
    { col: sink.col, row: sink.row }, anchorVec(game, 'pl_1', 'pwr_in'),
    { preferVerticalFirst: false });
  const preferredRes = validateDrawLine(game.state, {
    utilityType: 'powerCable',
    start: { placeableId: 'src_2', portName: 'pwr_out_1' },
    end: { placeableId: 'pl_1', portName: 'pwr_in' },
    path: preferred,
  });
  assert(!preferredRes.ok && preferredRes.reason === 'overlap_same_type',
    `the best-scoring route really does overlap the trunk (got ${preferredRes.ok ? 'ok' : preferredRes.reason})`);

  // Driven by hand rather than through drag() so dragReject can be read while
  // the gesture is still live — that flag is the drag tooltip, and it is only
  // meaningful before the release.
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('powerCable');
  const a = gridToIso(src2.col, src2.row);
  const b = gridToIso(sink.col, sink.row);
  ctrl.onMouseDown(a.x, a.y, 0, {});
  ctrl.onMouseMove(b.x, b.y, {});
  assert(ctrl.dragReject === null,
    `mid-drag the gesture reports no refusal (got ${ctrl.dragReject})`);
  const previewPath = ctrl.preview && ctrl.preview.path.map(p => ({ ...p }));
  ctrl.onMouseUp(b.x, b.y, 0, {});

  const lines = powerLines(game);
  const branch = lines.find(l => l.id !== trunk.id);
  assert(lines.length === 2,
    `the drag still commits by taking a lower-ranked route (got ${lines.length - 1}`
    + `${game._logs.length ? ' — ' + game._logs.join(' | ') : ''})`);
  assert(!!branch && JSON.stringify(branch.path) !== JSON.stringify(preferred),
    'and the committed route is NOT the overlapping one');
  assert(!!branch && branch.start.placeableId === 'src_2' && branch.end.placeableId === 'pl_1',
    'joining the two ports the player actually dragged between');
  // The preview has to be the route that lands, not the one the router would
  // have picked with an empty board.
  assert(!!branch && previewPath && JSON.stringify(previewPath) === JSON.stringify(branch.path),
    'and the route previewed is the route that landed');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
