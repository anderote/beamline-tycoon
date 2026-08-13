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
import { portWorldPosition, portSide } from '../src/utility/ports.js';
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
    id: 'src_1', type: 'hvTransformer', kind: 'infrastructure',
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
    const src = portTile(game, 'src_1', 'pwr_out');
    const sink = portTile(game, 'pl_2', 'pwr_in');
    drag(game, src, sink);
    const lines = powerLines(game);
    assert(lines.length === 1,
      `source facing ${facing(game, 'src_1', 'pwr_out')} → sink facing N commits`
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
  const src = portTile(game, 'src_1', 'pwr_out');
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
  const src = portTile(game, 'src_1', 'pwr_out');   // faces E, at col ~14.75
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
  const src = portTile(game, 'src_1', 'pwr_out');
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
  const src = portTile(game, 'src_1', 'pwr_out');
  drag(game, src, { col: 12, row: 12 });
  const lines = powerLines(game);
  assert(lines.length === 1 && lines[0].start && lines[0].start.placeableId === 'src_1'
    && !lines[0].end,
    `a port→empty drag anchors one end only (got ${lines.length}`
    + `${game._logs.length ? ' — ' + game._logs.join(' | ') : ''})`);
}

console.log('\n--- 4. Genuinely invalid gestures are still refused ---');
{
  // Port onto itself: no line, no charge.
  const game = makeGame();
  const src = portTile(game, 'src_1', 'pwr_out');
  const fundsBefore = game.state.resources.funding;
  drag(game, src, src);
  assert(powerLines(game).length === 0, 'a drag that never left the port commits nothing');
  assert(game.state.resources.funding === fundsBefore, 'and charges nothing');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
