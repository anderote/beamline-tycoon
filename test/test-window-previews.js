// test/test-window-previews.js — palette previews must represent every
// window catalogue entry, including its variant glass tint.

import { WINDOW_TYPES } from '../src/data/structure.js';
import { windowPreviewDataUrl } from '../src/ui/window-preview.js';
import { WindowTool } from '../src/input/structure-tools.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

for (const [id, def] of Object.entries(WINDOW_TYPES)) {
  const base = windowPreviewDataUrl(id, 0);
  assert(typeof base === 'string' && base.startsWith('data:image/svg+xml'),
    `${id} has a rendered build-menu preview`);
  if (def.variants?.length > 1) {
    const alternate = windowPreviewDataUrl(id, 1);
    assert(alternate !== base, `${id} preview changes with its glass variant`);
  }
}
assert(windowPreviewDataUrl('notAWindow') === null, 'unknown window has no misleading preview');

console.log('\n=== placement ghost state ===\n');
{
  const edge = { col: 4, row: 7, edge: 'e' };
  const alias = { col: 5, row: 7, edge: 'w' };
  const game = {
    state: {
      wallOccupied: {}, windowOccupied: {}, resources: { funding: 1e6 },
    },
    _edgeAlias: () => alias,
  };
  const tool = new WindowTool('officeWindow');
  assert(tool._previewStatus(game, edge).valid === false,
    'window ghost is red without a host wall');
  game.state.wallOccupied['5,7,w'] = 'officeWall';
  assert(tool._previewStatus(game, edge).valid === true,
    'window ghost accepts a wall stored under the opposite edge spelling');
  game.state.wallOccupied['5,7,w'] = 'cubicleWall';
  assert(tool._previewStatus(game, edge).reason.includes('too short'),
    'window ghost rejects a wall too short for its aperture');
  game.state.wallOccupied['5,7,w'] = 'officeWall';
  game.state.resources.funding = 0;
  assert(tool._previewStatus(game, edge).reason === 'Insufficient funding',
    'window ghost reflects the funding gate before click');
}

console.log('\n=== WindowTool half-edge snapping ===\n');
{
  let cursorEdge = { col: 4, row: 7, edge: 'n', frac: 0.2 };
  let committed = null;
  const ctx = {
    game: {
      _withUndo(fn) { return fn(); },
      placeWindowPath(path, type, variant, off) {
        committed = { path, type, variant, off };
        return true;
      },
      state: { wallOccupied: { '4,7,n': 'officeWall' }, windowOccupied: {}, resources: { funding: 1e6 } },
      _edgeAlias: () => ({ col: 4, row: 6, edge: 's' }),
    },
    input: {
      _getNearestWallEdge: () => cursorEdge,
      _hideDragCostTooltip() {},
      _buildWallLine: start => [start],
    },
    renderer: { renderWindowPreview() {}, clearDragPreview() {} },
  };
  const tool = new WindowTool('casementWindow', 1);
  tool.onMouseDown({ button: 0, clientX: 0, clientY: 0 }, ctx);
  assert(tool._path[0].off === 0, 'a compact-window click in the first half previews off=0');
  tool.onMouseUp({ button: 0 }, ctx);
  assert(committed?.off === 0 && committed.path[0].off === 0,
    'the compact-window first-half offset reaches placeWindowPath');

  cursorEdge = { col: 4, row: 7, edge: 'n', frac: 0.8 };
  tool.onMouseDown({ button: 0, clientX: 0, clientY: 0 }, ctx);
  assert(tool._path[0].off === 2, 'a compact-window click in the second half previews off=2');
  tool.onMouseUp({ button: 0 }, ctx);
  assert(committed?.off === 2 && committed.path[0].off === 2,
    'the compact-window second-half offset reaches placeWindowPath');

  const broad = new WindowTool('officeWindow');
  assert(broad._offFor(cursorEdge) === 0, 'existing broad windows remain centered regardless of cursor half');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
