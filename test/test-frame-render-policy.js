import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameRenderPolicy } from '../src/renderer3d/frame-render-policy.js';

test('GPU admission is decided once and skipped submissions defer shadows', () => {
  let checks = 0;
  const pacer = { shouldRender: () => { checks++; return false; } };
  const policy = new FrameRenderPolicy(pacer);

  const plan = policy.beginFrame({}, null);
  assert.deepEqual(plan, {
    renderAllowed: false,
    cameraMoving: false,
    deferShadows: true,
  });
  assert.equal(checks, 1, 'one animation frame asks the pacer exactly once');
});

test('every camera gesture defers shadows without withholding the main frame', () => {
  const policy = new FrameRenderPolicy({ shouldRender: () => true });
  const cases = [
    [{ _viewRotating: true }, null],
    [{ _snapping: true }, null],
    [{ _freeOrbiting: true }, null],
    [{ _focusing: true }, null],
    [{}, { isPanning: true }],
    [{}, { keysDown: new Set(['w']) }],
    [{}, { keysDown: new Set(['a']) }],
    [{}, { keysDown: new Set(['s']) }],
    [{}, { keysDown: new Set(['d']) }],
  ];

  for (const [view, input] of cases) {
    assert.deepEqual({ ...policy.beginFrame(view, input) }, {
      renderAllowed: true,
      cameraMoving: true,
      deferShadows: true,
    });
  }
});

test('an idle admitted frame renders and services shadows', () => {
  const policy = new FrameRenderPolicy({ shouldRender: () => true });
  const first = policy.beginFrame({}, { keysDown: new Set() });
  assert.deepEqual(first, {
    renderAllowed: true,
    cameraMoving: false,
    deferShadows: false,
  });
  assert.equal(policy.beginFrame({}, null), first,
    'the hot path reuses its plan object instead of allocating per frame');
});
