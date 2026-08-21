import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeDesignerApply } from '../src/beamline/designer-apply.js';

test('designer executes a multi-op transaction inside one game event batch', () => {
  let batches = 0;
  const game = {
    beamline: {
      trimPipe: () => true,
      removeFromPipe: () => true,
      extendPipe: () => true,
    },
    snapshotBeamlineState: () => ({ payload: '{}' }),
    _batchEvents(fn) {
      batches++;
      return fn();
    },
  };

  const result = executeDesignerApply(game, [
    { kind: 'trimPipe', pipeId: 'bp_1', newSubL: 8 },
    { kind: 'removeFromPipe', pipeId: 'bp_1', placementId: 'pl_1' },
    { kind: 'extendPipe', pipeId: 'bp_1', additionalPath: [] },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.failure, null);
  assert.equal(batches, 1);
  assert.equal(result.danglingLineCount, 0);
});
