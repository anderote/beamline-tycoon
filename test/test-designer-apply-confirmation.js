// Scenario Admin opens the Beamline Designer with balance-sandbox economics:
// construction is free, but funding remains live and may be zero or negative.
// Confirm must still show the nominal quote and every site-preparation loss,
// then execute the exact previewed plan without changing the funding balance.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { flattenPath } from '../src/beamline/flattener.js';
import { planDesignerApply } from '../src/beamline/designer-plan.js';
import { BeamlineDesigner } from '../src/ui/BeamlineDesigner.js';
import { applyPreviewDialog } from '../src/ui/ApplyPreviewDialog.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
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

function draftFromMap(state, sourceId) {
  return flattenPath(state, sourceId).map((entry, index) => ({
    id: entry.kind === 'drift' ? -1000 - index : entry.id,
    type: entry.kind === 'drift' ? 'drift' : entry.type,
    params: { ...(entry.params || {}) },
    beamStart: entry.beamStart,
    subL: entry.subL,
    _pipeKind: entry.kind,
    _sourceRef: entry.kind === 'module'
      ? { placeableId: entry.id }
      : entry.kind === 'placement'
        ? { pipeId: entry.pipeId, placementId: entry.id, position: entry.position }
        : { pipeId: entry.pipeId },
  }));
}

function makeOpenRun(game) {
  for (let row = -25; row < 25; row++) {
    const sourceId = game.beamline.placeJunction({
      type: 'source', col: -12, row, dir: 3, free: true, silent: true,
    });
    if (!sourceId) continue;
    const pipeId = game.beamline.drawPipe(
      { junctionId: sourceId, portName: 'exit' },
      null,
      [{ col: -12, row }, { col: -4, row }],
    );
    if (pipeId) return { sourceId, pipeId };
    game.removePlaceable(sourceId, { skipRefund: true });
  }
  return null;
}

console.log('\n=== Scenario Admin Designer confirmation ===\n');

const game = new Game(new BeamlineRegistry(), { seed: 915 });
game.state.resources.funding = 1e9;
game.state.resources.spares = 1e9;
const run = makeOpenRun(game);
assert(run, 'fixture: built a source with an open beam-pipe end');

const originalNodes = draftFromMap(game.state, run.sourceId);
const draftNodes = originalNodes.map(node => ({ ...node, params: { ...node.params } }));
draftNodes.push({
  id: -1,
  type: 'faradayCup',
  params: {},
  subL: COMPONENTS.faradayCup.subL,
  _pipeKind: 'module',
  _sourceRef: {},
});

// Ask the planner where the appended cup will land, then put ordinary
// equipment in that footprint. The decisive confirmation should list and
// bulldoze it rather than silently refusing the edit.
const proposed = planDesignerApply(game.state, {
  sourceId: run.sourceId,
  draftNodes,
  originalNodes,
  prepareSite: true,
  freeConstruction: true,
});
const placement = proposed.ops.find(op => op.kind === 'placeJunction');
assert(placement, 'fixture: the draft plans an appended Faraday cup');
const obstructionId = placement && game.placePlaceable({
  type: 'coolantPump',
  col: placement.col,
  row: placement.row,
  subCol: placement.subCol,
  subRow: placement.subRow,
  dir: placement.dir,
  free: true,
  silent: true,
});
assert(obstructionId, 'fixture: placed ordinary equipment in the build footprint');

game.sandboxMode = true;
game.state.resources.funding = 0;
game.state.resources.spares = 0;

const designer = Object.create(BeamlineDesigner.prototype);
Object.assign(designer, {
  game,
  isOpen: true,
  mode: 'edit',
  editSourceId: run.sourceId,
  draftNodes,
  originalNodes,
  draftWorkspaceId: null,
  _danglingLineCount: 0,
});
designer._saveActiveWorkspaceDraft = () => {};
designer._syncDraftFromMap = () => {};
designer._updateTotalLength = () => {};
designer._recalcBaseline = () => {};
designer._clearDraftState = () => {};
designer._cleanup = () => { designer.isOpen = false; };

const originalOpen = applyPreviewDialog.open;
let preview = null;
let duplicateConfirmation = null;
try {
  applyPreviewDialog.open = async (summary, opts) => {
    preview = { summary, opts };
    duplicateConfirmation = designer.confirm();
    return 'apply';
  };

  const applied = await designer.confirm();
  assert(applied === true, 'Confirm commits the Designer plan in Scenario Admin');
  assert(preview?.opts.applyLabel === 'Build & Exit'
      && preview?.opts.backLabel === 'Keep editing'
      && /on map\?$/.test(preview?.opts.title || ''),
  'the decisive preview names the map build and its exit behavior');
  assert(preview?.summary.totalCost > 0,
    'the popup receives the nominal build cost despite a zero balance');
  assert(preview?.summary.removes.some(row => row.type === 'coolantPump'),
    'the popup explicitly lists equipment that construction will destroy');
  assert(preview?.opts.freeConstruction === true,
    'the popup is told the quote is informational in free-construction mode');
  assert(!game.getPlaceable(obstructionId),
    'accepting the popup bulldozes the listed obstruction');
  assert(game.state.placeables.some(placeable => placeable.type === 'faradayCup'),
    'accepting the popup builds the proposed beamline component');
  assert(game.state.resources.funding === 0 && game.state.resources.spares === 0,
    'free construction charges no funds or spares and grants no demolition refund');
  assert(designer.isOpen === false,
    'a successful map build exits the Designer');
  assert(duplicateConfirmation === false && designer._confirmationPending === false,
    'a repeated Confirm click cannot compete with the active build request');
} finally {
  applyPreviewDialog.open = originalOpen;
}

console.log('\n=== Designer confirmation feedback ===\n');

let blockerHidden = true;
const blockedDesigner = Object.create(BeamlineDesigner.prototype);
Object.assign(blockedDesigner, {
  game,
  isOpen: true,
  mode: 'edit',
  editSourceId: 'missing-source',
  draftNodes: [],
  originalNodes: [],
  draftWorkspaceId: null,
  _confirmationPending: false,
  applyStatusEl: {
    textContent: '',
    classList: {
      toggle(name, hidden) {
        if (name === 'hidden') blockerHidden = hidden;
      },
    },
  },
});
blockedDesigner._saveActiveWorkspaceDraft = () => {};
blockedDesigner._renderAll = () => {};
const blocked = await blockedDesigner.confirm();
assert(blocked === false, 'a planner blocker refuses the map build');
assert(!blockerHidden && /Can't build on map:/.test(blockedDesigner.applyStatusEl.textContent),
  'a planner blocker is visible inside the Designer instead of only in the hidden map log');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
