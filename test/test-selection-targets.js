// Five-category contract for logical drag-selection targets.

import {
  attachmentSelectionKey,
  floorSelectionKey,
  physicalEdgeSelectionKey,
  selectionCategoryCounts,
  selectionCategoryForPlaceable,
  selectionTargetByKey,
  selectionTargetsForState,
} from '../src/game/selection-targets.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.error('  FAIL:', message); }
}

console.log('\n=== Selection targets ===\n');

{
  const samples = [
    [{ kind: 'beamline', type: 'source' }, 'beamline'],
    [{ kind: 'infrastructure', type: 'mcc' }, 'infra'],
    [{ kind: 'equipment', type: 'labBench' }, 'facility'],
    [{ kind: 'furnishing', type: 'officeDesk' }, 'facility'],
    [{ kind: 'decoration', type: 'flowerBed' }, 'grounds'],
    [{ kind: 'decoration', type: 'wallSconce' }, 'structure'],
  ];
  for (const [entry, expected] of samples) {
    assert(selectionCategoryForPlaceable(entry, PLACEABLES[entry.type]) === expected,
      `${entry.type} maps to ${expected}`);
  }
}

{
  const north = physicalEdgeSelectionKey(5, 5, 'n');
  const southAlias = physicalEdgeSelectionKey(5, 4, 's');
  assert(north === southAlias, 'mirrored edge spellings share one selection key');
}

{
  const state = {
    placeables: [
      { id: 'bl_1', type: 'source', kind: 'beamline', col: 1, row: 1 },
      { id: 'in_2', type: 'mcc', kind: 'infrastructure', col: 2, row: 2 },
      { id: 'fn_3', type: 'officeDesk', kind: 'furnishing', col: 3, row: 3 },
      { id: 'dc_4', type: 'flowerBed', kind: 'decoration', col: 4, row: 4 },
    ],
    floors: [
      { type: 'labFloor', col: 10, row: 10, foundation: 'concrete' },
      { type: 'groomedGrass', col: 11, row: 10 },
    ],
    walls: [
      { type: 'officeWall', col: 10, row: 10, edge: 'n' },
      { type: 'chainLinkFence', col: 11, row: 10, edge: 'n' },
    ],
    wallOverlays: [],
    doors: [{ type: 'officeDoor', col: 10, row: 10, edge: 'n' }],
    windows: [],
    beamPipes: [{
      id: 'bp_1',
      path: [{ col: 20, row: 20 }, { col: 24, row: 20 }],
      subL: 16,
      placements: [{ id: 'pl_1', type: 'quadrupole', position: 0.5, subL: 2 }],
    }],
  };
  const targets = selectionTargetsForState(state);
  const counts = selectionCategoryCounts(targets);
  assert(counts.beamline === 2 && counts.infra === 1 && counts.facility === 1,
    'placeables and pipe-mounted hardware populate beamline/infra/facility');
  assert(counts.structure === 2 && counts.grounds === 3,
    'floors and edge assemblies use their authored structure/grounds category');

  const edge = selectionTargetByKey(state, physicalEdgeSelectionKey(10, 10, 'n'));
  assert(edge?.targetKind === 'edge' && edge.door?.type === 'officeDoor'
      && edge.name === 'Office Door',
  'a physical edge is one target carrying its wall and opening');
  assert(selectionTargetByKey(state, floorSelectionKey(11, 10))?.selectionCategory === 'grounds',
    'a grounds surface resolves by its stable floor key');
  assert(selectionTargetByKey(state, attachmentSelectionKey('pl_1'))?.pipeId === 'bp_1',
    'pipe-mounted beamline hardware resolves by its stable attachment key');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
