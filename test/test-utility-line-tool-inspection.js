import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UtilityLineTool } from '../src/input/utility-line-tool.js';
import { DEFERRED_PORT_DRAG_THRESHOLD_PX } from '../src/input/deferred-port-drag.js';

function fixture(hit = { lineId: 'vacuum_run', utilityType: 'vacuumPipe' }) {
  let active = false;
  const calls = {
    cancelled: 0,
    committed: 0,
    opened: [],
  };
  const controller = {
    onMouseDown() { active = true; return true; },
    onMouseMove() {},
    onMouseUp() { calls.committed++; active = false; },
    onEscape() { calls.cancelled++; active = false; },
    isActive() { return active; },
    get drawHeight() { return 0.75; },
    get runPlan() { return null; },
    get dragCost() { return 0; },
    get dragReject() { return null; },
  };
  const ctx = {
    input: {
      utilityLineController: controller,
      openUtilityInspectorForLine(lineId) { calls.opened.push(lineId); return true; },
      _hideDragCostTooltip() {},
      _showDragCostTooltip() {},
      lastMouseWorldX: 0,
      lastMouseWorldY: 0,
      _lastScreenX: 0,
      _lastScreenY: 0,
    },
    renderer: {
      raycastUtilityLine() { return hit; },
      screenToWorldAtHeight() { return { x: 0, y: 0 }; },
      updateHover() {},
    },
  };
  return { ctx, calls };
}

test('a plain click on an existing armed utility run opens its inspector', () => {
  const tool = new UtilityLineTool('vacuumPipe');
  const { ctx, calls } = fixture();

  assert.equal(tool.onMouseDown({ button: 0, clientX: 100, clientY: 80 }, ctx), true);
  assert.equal(tool.onMouseUp({ button: 0, clientX: 100, clientY: 80 }, ctx), true);

  assert.deepEqual(calls.opened, ['vacuum_run']);
  assert.equal(calls.cancelled, 1, 'the provisional draw is cancelled');
  assert.equal(calls.committed, 0, 'the click does not commit a zero-length branch');
});

test('dragging from an existing armed utility run still commits a branch', () => {
  const tool = new UtilityLineTool('vacuumPipe');
  const { ctx, calls } = fixture();

  tool.onMouseDown({ button: 0, clientX: 100, clientY: 80 }, ctx);
  tool.onMouseUp({
    button: 0,
    clientX: 100 + DEFERRED_PORT_DRAG_THRESHOLD_PX,
    clientY: 80,
    shiftKey: false,
  }, ctx);

  assert.deepEqual(calls.opened, []);
  assert.equal(calls.cancelled, 0);
  assert.equal(calls.committed, 1, 'movement preserves the line-drawing gesture');
});

test('an armed utility ignores inspection hits belonging to another utility', () => {
  const tool = new UtilityLineTool('vacuumPipe');
  const { ctx, calls } = fixture({ lineId: 'power_run', utilityType: 'powerCable' });

  tool.onMouseDown({ button: 0, clientX: 100, clientY: 80 }, ctx);
  tool.onMouseUp({ button: 0, clientX: 100, clientY: 80, shiftKey: false }, ctx);

  assert.deepEqual(calls.opened, []);
  assert.equal(calls.committed, 1, 'the armed vacuum tool retains the gesture');
});
