// Regression: F must rotate a carried multi-selection, not just ordinary
// single-placeable ghosts. Keep this fixture pure so unrelated utility-port
// registry failures cannot hide the input/transform behavior under test.

import { MoveTool } from '../src/input/mode-tools.js';
import {
  selectionPointTarget,
  selectionTargets,
} from '../src/input/selection-group.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

console.log('\n=== Selection-group rotation ===\n');

const payload = {
  kind: 'selectionGroup',
  anchor: { col: 10, row: 10, subCol: 0, subRow: 0, dir: 0 },
  items: [
    { id: 'anchor', col: 10, row: 10, subCol: 0, subRow: 0, dir: 0 },
    { id: 'other', col: 12, row: 11, subCol: 0, subRow: 0, dir: 1 },
  ],
};

{
  const targets = selectionTargets(payload, {
    col: 20, row: 30, subCol: 0, subRow: 0, dir: 1,
  });
  assert(targets[0].col === 20 && targets[0].row === 30 && targets[0].dir === 1,
    'the primary item stays on the placement anchor and turns clockwise');
  assert(targets[1].col === 19 && targets[1].row === 32 && targets[1].dir === 2,
    'the formation offset and item facing rotate around the primary anchor');
  const linePoint = selectionPointTarget(payload, {
    col: 20, row: 30, subCol: 0, subRow: 0, dir: 1,
  }, { col: 13, row: 10 });
  assert(linePoint.col === 20 && linePoint.row === 33,
    'internal utility paths rotate with the formation');
}

{
  const tool = new MoveTool();
  tool.payload = payload;
  let previewed = null;
  let renderedDir = null;
  let prevented = false;
  const ctx = {
    input: {
      placementDir: 0,
      _updateSelectionGroupPreview(value) { previewed = value; },
    },
    renderer: {
      updatePlacementDir(value) { renderedDir = value; },
    },
  };
  const consumed = tool.onKey({
    key: 'f', shiftKey: false, preventDefault() { prevented = true; },
  }, ctx);
  assert(consumed && prevented, 'MoveTool consumes F while a selection group is carried');
  assert(ctx.input.placementDir === 1 && renderedDir === 1,
    'F advances the shared placement direction and updates the renderer');
  assert(previewed === payload, 'F immediately rebuilds the grouped preview');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
