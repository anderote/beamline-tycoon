// test/test-design-placement-confirmation.js — Placing a saved/stock design
// is previewed before the world mutation, using the same grouped change shape
// as an edited beamline apply.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { DesignPlacer } from '../src/ui/DesignPlacer.js';
import { applyPreviewDialog } from '../src/ui/ApplyPreviewDialog.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  PASS:', message);
  } else {
    failed++;
    console.log('  FAIL:', message);
  }
}

function findValidPosition(placer, extent) {
  for (let row = -extent + 2; row <= extent - 2; row++) {
    for (let col = -extent + 2; col <= extent - 8; col++) {
      placer.setPosition(col, row);
      if (placer.valid) return { col, row };
    }
  }
  return null;
}

console.log('\n=== Design placement confirmation preview ===\n');

const game = new Game(new BeamlineRegistry(), { seed: 812 });
game.state.resources.funding = 1e12;
game.state.resources.spares = 1e12;
const placer = new DesignPlacer(game, { _renderCursors() {} });
placer.start({
  name: 'Preview Contract',
  components: [{ type: 'source' }, { type: 'faradayCup' }],
});

const origin = findValidPosition(placer, game.state.mapHalfExtent);
assert(origin, 'fixture: found a valid design placement');

const summary = placer.placementSummary();
const types = summary.adds.map(row => row.type || row.label);
assert(types.includes('source') && types.includes('faradayCup'),
  'New includes both modules that will be built');
assert(types.includes('drift'), 'New includes the connecting beam pipe');
assert(types.includes('Concrete Pad'), 'New includes automatically laid foundation');
assert(summary.removes.length === 0, 'Deleted is explicitly empty for a new placement');
assert(summary.adds.reduce((sum, row) => sum + row.cost, 0) === summary.totalCost,
  'the listed additions add up to the exact net placement cost');

const countsBefore = {
  placeables: game.state.placeables.length,
  pipes: game.state.beamPipes.length,
  floors: game.state.floors.length,
  funding: game.state.resources.funding,
};

const originalOpen = applyPreviewDialog.open;
try {
  let answerPreview;
  let answer;
  applyPreviewDialog.open = (shown, opts) => {
    answerPreview = { shown, opts };
    return new Promise(resolve => { answer = resolve; });
  };

  const pending = placer.requestConfirm();
  placer.setPosition(origin.col + 1, origin.row + 1);
  assert(placer.startCol === origin.col && placer.startRow === origin.row,
    'the placement ghost stays fixed while its quoted confirmation is open');
  assert(answerPreview.opts.applyLabel === 'Place design'
      && answerPreview.opts.backLabel === 'Back to placement',
  'the confirmation uses placement-specific actions');

  answer('back');
  const backedOut = await pending;
  assert(backedOut === false && placer.active,
    'Back returns to the unchanged placement ghost');
  assert(game.state.placeables.length === countsBefore.placeables
      && game.state.beamPipes.length === countsBefore.pipes
      && game.state.floors.length === countsBefore.floors
      && game.state.resources.funding === countsBefore.funding,
  'Back changes no map or economy state');

  applyPreviewDialog.open = async () => 'apply';
  const placed = await placer.requestConfirm();
  assert(placed === true && !placer.active,
    'Place design commits only after the confirmation accepts');
  assert(game.state.placeables.length > countsBefore.placeables
      && game.state.beamPipes.length > countsBefore.pipes,
  'the accepted placement builds the modules and connecting pipe');
  assert(countsBefore.funding - game.state.resources.funding === summary.totalCost,
    'the accepted placement charges the displayed net cost');
} finally {
  applyPreviewDialog.open = originalOpen;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
