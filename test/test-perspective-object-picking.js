// test/test-perspective-object-picking.js — clicks follow projected geometry,
// not occupied ground footprints.

import { InputHandler } from '../src/input/InputHandler.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  PASS:', message);
  } else {
    failed++;
    console.error('  FAIL:', message);
  }
}

console.log('\n--- Perspective-aware object picking ---');

const machine = {
  id: 'machine-1', type: 'electronSource', kind: 'beamline',
  category: 'beamline', col: 8, row: 9, dir: 0,
};

{
  let selected = null;
  const input = {
    renderer: {
      raycastScreen: () => null,
      identifyHit: () => { throw new Error('identified a missing hit'); },
    },
    game: {
      // The cursor's ground projection may still lie in this machine's
      // occupied footprint. Selection must not consult it after a ray miss.
      getPlaceable: () => machine,
    },
    _selectPlaceable: (entry) => { selected = entry; return true; },
  };
  const got = InputHandler.prototype._selectPlaceableAt.call(
    input, { x: 16, y: 18 }, { col: 8, row: 9 }, 100, 100,
  );
  assert(got === false && selected === null,
    'clicking visible ground inside an occupied footprint selects nothing');
}

{
  const rootObj = {};
  let selected = null;
  const input = {
    renderer: {
      raycastScreen: () => ({ object: {} }),
      identifyHit: () => ({ group: 'component', nodeId: machine.id, rootObj }),
    },
    game: { getPlaceable: (id) => id === machine.id ? machine : null },
    _selectPlaceable: (entry, root) => {
      selected = { entry, root };
      return true;
    },
  };
  const got = InputHandler.prototype._selectPlaceableAt.call(
    input, { x: 0, y: 0 }, { col: 0, row: 0 }, 100, 100,
  );
  assert(got === true && selected?.entry === machine && selected.root === rootObj,
    'a visible projected mesh hit selects its stamped placeable');
}

{
  const input = {
    renderer: { raycastScreen: () => null },
    game: { state: { placeables: [machine], beamPipes: [] } },
    _getNodeAtGrid: () => machine,
  };
  const got = InputHandler.prototype._getNodeAtScreenOrGrid.call(input, 100, 100, 8, 9);
  assert(got === null,
    'a beamline screen-pick miss does not fall back to its ground tile');
}

{
  let lifted = false;
  const input = {
    renderer: {
      raycastScreen: () => null,
      identifyHit: () => null,
    },
    game: {
      getPlaceable: () => machine,
      liftPlaceable: () => { lifted = true; },
      _withUndo: (fn) => fn(),
    },
    _getNodeAtGrid: () => machine,
    _showToast: () => {},
  };
  const got = InputHandler.prototype._pickUpAt.call(input, 8, 9, 100, 100);
  assert(got === null && !lifted,
    'move mode cannot pick up an object through empty visible ground');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
