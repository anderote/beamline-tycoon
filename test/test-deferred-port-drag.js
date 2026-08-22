import {
  DEFERRED_PORT_DRAG_THRESHOLD_PX,
  DeferredUtilityPortDrag,
} from '../src/input/deferred-port-drag.js';
import { InputHandler } from '../src/input/InputHandler.js';

let passed = 0;
let failed = 0;
function assert(ok, label) {
  if (ok) { passed++; console.log('  PASS:', label); }
  else { failed++; console.error('  FAIL:', label); }
}

const port = { placeableId: 'panel', portName: 'pwr_out_1', utilityType: 'powerCable' };

console.log('\n=== Deferred idle-port drag ===\n');

{
  const gesture = new DeferredUtilityPortDrag();
  assert(gesture.begin(port, {
    button: 0, clientX: 100, clientY: 200, shiftKey: false,
  }), 'a left press on a utility port starts as a pending gesture');
  const movement = DEFERRED_PORT_DRAG_THRESHOLD_PX - 1;
  assert(gesture.update({ clientX: 100 + movement, clientY: 200, buttons: 1 }) === null,
    'small pointer movement does not steal the equipment click');
  assert(gesture.release() === true && !gesture.isPending,
    'release before the threshold returns control to normal click selection');
}

{
  const gesture = new DeferredUtilityPortDrag();
  gesture.begin(port, {
    button: 0, clientX: 50, clientY: 75, shiftKey: true,
  });
  const activation = gesture.update({
    clientX: 50 + DEFERRED_PORT_DRAG_THRESHOLD_PX,
    clientY: 75,
    buttons: 1,
  });
  assert(activation?.port === port && activation.press.clientX === 50
      && activation.press.clientY === 75,
  'crossing the threshold activates wiring from the original port position');
  assert(activation?.press.shiftKey === true && !gesture.isPending,
    'the replayed press preserves run-wiring modifiers and consumes pending state');
}

{
  const gesture = new DeferredUtilityPortDrag();
  gesture.begin(port, { button: 0, clientX: 10, clientY: 10 });
  gesture.update({ clientX: 40, clientY: 10, buttons: 0 });
  assert(!gesture.isPending,
    'a lost left button cancels the pending gesture instead of arming a stale tool');
}

{
  let placeablePicks = 0;
  let linePicks = 0;
  const input = {
    _suppressNextClick: false,
    activeTool: null,
    game: { _designPlacer: null },
    renderer: {
      screenToWorld: () => ({ x: 0, y: 0 }),
      raycastUtilityLine: () => { linePicks++; return { lineId: 'line_1' }; },
    },
    _toolConsumed: () => false,
    _selectPlaceableAt: () => { placeablePicks++; return true; },
  };
  InputHandler.prototype._handleClick.call(input, 100, 100);
  assert(placeablePicks === 1 && linePicks === 0,
    'equipment selection wins before a connected utility line at the same pixel');
}

{
  let openedLineId = null;
  let pickTolerance = null;
  const input = {
    _suppressNextClick: false,
    activeTool: null,
    game: { _designPlacer: null },
    renderer: {
      screenToWorld: () => ({ x: 0, y: 0 }),
      raycastUtilityLine: (_x, _y, tolerance) => {
        pickTolerance = tolerance;
        return { lineId: 'line_bus_power', utilityType: 'powerCable', busId: 'bus_1' };
      },
    },
    _toolConsumed: () => false,
    _selectPlaceableAt: () => false,
    openUtilityInspectorForLine: (lineId) => {
      openedLineId = lineId;
      return true;
    },
  };
  InputHandler.prototype._handleClick.call(input, 100, 100);
  assert(openedLineId === 'line_bus_power',
    'a populated universal-bus lane opens its utility network inspector');
  assert(pickTolerance === 12,
    'utility network clicks use the same forgiving screen-space margin as objects');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
