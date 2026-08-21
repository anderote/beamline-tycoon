// Beamline Designer keyboard navigation contract. With keyboard focus on the
// stackup, horizontal arrows move the blue marker; tabs and palette cards retain
// their existing row-specific horizontal navigation.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BeamlineDesigner } from '../src/ui/BeamlineDesigner.js';

function keyEvent(key) {
  return {
    key,
    target: { tagName: 'BODY' },
    ctrlKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
  };
}

test('left and right arrows move the focused beamline stackup marker', () => {
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const priorResizeObserver = globalThis.ResizeObserver;

  const listeners = {};
  globalThis.window = {
    addEventListener(type, listener) { listeners[type] = listener; },
  };
  const element = { addEventListener() {} };
  globalThis.document = {
    getElementById(id) {
      return id === 'dsgn-schematic-canvas' ? null : element;
    },
    querySelectorAll() { return []; },
  };
  globalThis.ResizeObserver = class {
    observe() {}
  };

  try {
    const markerStarts = [];
    let markerStops = 0;
    let panStarts = 0;
    const designer = new BeamlineDesigner({}, {});
    designer.isOpen = true;
    designer.focusRow = 0;
    designer._startMarkerMove = dir => { markerStarts.push(dir); };
    designer._stopMarkerMove = () => { markerStops++; };
    designer._startPan = () => { panStarts++; };

    listeners.keydown(keyEvent('ArrowLeft'));
    listeners.keyup(keyEvent('ArrowLeft'));
    listeners.keydown(keyEvent('ArrowRight'));
    listeners.keyup(keyEvent('ArrowRight'));

    assert.deepEqual(markerStarts, [-1, 1]);
    assert.equal(markerStops, 2);
    assert.equal(panStarts, 0);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
    if (priorResizeObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = priorResizeObserver;
  }
});
