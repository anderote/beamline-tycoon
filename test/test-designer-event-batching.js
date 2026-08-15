import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BeamlineDesigner } from '../src/ui/BeamlineDesigner.js';

test('designer executes a multi-op transaction inside one game event batch', () => {
  let batches = 0;
  const designer = Object.create(BeamlineDesigner.prototype);
  designer.game = {
    beamline: {},
    _batchEvents(fn) {
      batches++;
      return fn();
    },
  };
  designer._runOp = () => ({});
  designer._danglingLineCount = 9;

  const failure = designer._executePlan([
    { kind: 'trimPipe' },
    { kind: 'removeFromPipe' },
    { kind: 'tuneParams' },
  ]);
  assert.equal(failure, null);
  assert.equal(batches, 1);
  assert.equal(designer._danglingLineCount, 0);
});
