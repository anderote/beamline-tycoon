import { DoorTool, WallTool } from '../src/input/structure-tools.js';

let passed = 0;
let failed = 0;

function assertOk(condition, message) {
  if (condition) {
    passed++;
    console.log('  PASS:', message);
  } else {
    failed++;
    console.log('  FAIL:', message);
  }
}

function makeContext() {
  const calls = {
    previews: [],
    costs: [],
    tooltips: [],
    commits: [],
    lineStarts: [],
  };
  const selection = {
    mode: 'perimeter',
    floorType: 'labFloor',
    tileCount: 1,
    path: [
      { col: 0, row: 0, edge: 'n' },
      { col: 0, row: 0, edge: 'e' },
      { col: 0, row: 0, edge: 's' },
      { col: 0, row: 0, edge: 'w' },
    ],
  };
  const input = {
    _shiftDown: false,
    _lastScreenX: null,
    _lastScreenY: null,
    _hoverTooltipTarget: null,
    _getNearestFloorEdge: () => ({ col: 0, row: 0, edge: 'n', dist: 0.4 }),
    _getNearestEdge: (x) => x < 16
      ? { col: 0, row: 0, edge: 'n' }
      : { col: 2, row: 0, edge: 'n' },
    _buildSmartFloorWallPath: () => selection,
    _buildWallLine: (start, end) => {
      calls.lineStarts.push(start);
      return [start, end];
    },
    _showDragCostTooltip: (cost, _x, _y, opts) => calls.costs.push({ cost, opts }),
    _hideDragCostTooltip() {},
    _setHoverTooltip: (target, info) => calls.tooltips.push({ target, info }),
    _hideTooltip() {},
  };
  const renderer = {
    renderWallPreview: path => calls.previews.push(path),
    renderWallEdgeHighlight() {},
    clearDragPreview() {},
    screenToWorld: () => ({ x: 0, y: 0 }),
    updateHover() {},
  };
  const game = {
    state: {
      wallOccupied: {},
      wallOverlayOccupied: {},
      resources: { funding: 100000 },
    },
    _withUndo: fn => fn(),
    placeWallPath: path => calls.commits.push(path),
  };
  return { ctx: { input, renderer, game }, input, selection, calls };
}

console.log('\n=== WallTool smart Shift interactions ===\n');

{
  const { ctx, calls } = makeContext();
  const tool = new WallTool('officeWall');
  tool.onMouseMove({ clientX: 10, clientY: 10 }, ctx);
  assertOk(calls.tooltips.length === 1, 'wall hover shows a cursor-adjacent Shift hint');
  assertOk(calls.tooltips[0].info.title.includes('outline floor area'),
    'the hint describes the available floor outline');
}

{
  const { ctx, input, selection, calls } = makeContext();
  const tool = new WallTool('officeWall');
  input._shiftDown = true;
  tool.onMouseMove({ clientX: 10, clientY: 10 }, ctx);
  assertOk(calls.previews.at(-1) === selection.path, 'Shift-hover renders the full smart selection');
  assertOk(calls.costs.at(-1).opts.note.includes('Lab Flooring perimeter'),
    'the Shift preview cost identifies the selected floor region');
}

{
  const { ctx, input, selection, calls } = makeContext();
  const tool = new WallTool('officeWall');
  input._shiftDown = true;
  tool.onMouseDown({ button: 0, clientX: 10, clientY: 10 }, ctx);
  tool.onMouseUp({ button: 0, clientX: 10, clientY: 10 }, ctx);
  assertOk(calls.commits.length === 1 && calls.commits[0] === selection.path,
    'Shift-click commits the smart floor path');
}

{
  const { ctx, input, calls } = makeContext();
  const tool = new WallTool('officeWall');
  input._shiftDown = true;
  tool.onMouseDown({ button: 0, clientX: 10, clientY: 10 }, ctx);
  tool.onMouseMove({ clientX: 20, clientY: 10 }, ctx);
  tool.onMouseUp({ button: 0, clientX: 20, clientY: 10 }, ctx);
  assertOk(calls.lineStarts[0].col === 0 && calls.lineStarts[0].edge === 'n',
    'crossing the drag threshold starts a free run from the raw initial edge');
  assertOk(calls.commits.length === 1 && calls.commits[0].length === 2,
    'Shift-drag commits the ordinary straight wall path instead of the smart fill');
}

console.log('\n=== Structure tool right-click removal ===\n');

{
  const calls = [];
  const tool = new WallTool('officeWall');
  tool.onRightClick({ clientX: 10, clientY: 20 }, {
    input: {
      _getNearestFloorEdge: () => ({ col: 3, row: 4, edge: 'e' }),
      clearTool: () => { throw new Error('wall tool should stay armed'); },
    },
    game: {
      _withUndo: fn => { calls.push('undo'); return fn(); },
      removeWall: (col, row, edge) => calls.push(`wall:${col},${row},${edge}`),
    },
  });
  assertOk(calls.join('|') === 'undo|wall:3,4,e',
    'right-click in wall mode removes the targeted wall in one undo step');
}

{
  const calls = [];
  const tool = new DoorTool('officeDoor');
  tool.onRightClick({ clientX: 10, clientY: 20 }, {
    input: {
      _getNearestWallEdge: () => ({ col: 7, row: 8, edge: 'n' }),
      clearTool: () => { throw new Error('door tool should stay armed'); },
    },
    game: {
      _withUndo: fn => { calls.push('undo'); return fn(); },
      removeDoor: (col, row, edge) => calls.push(`door:${col},${row},${edge}`),
    },
  });
  assertOk(calls.join('|') === 'undo|door:7,8,n',
    'right-click in door mode removes the targeted door in one undo step');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
