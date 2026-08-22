// Regression coverage for the top-bar fault chip. The blocker panel owns the
// actionable fault details, so the compact red count must reopen it after a
// player dismisses the panel.

import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

// hud.js reaches thumbnail material modules that use the browser's THREE
// global at import time.
globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };

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

const priorDocument = globalThis.document;
const chip = {
  textContent: '',
  className: '',
  title: '',
  onclick: null,
};

globalThis.document = {
  getElementById(id) {
    return id === 'beam-summary' ? chip : null;
  },
  createElement(tag) {
    if (tag !== 'canvas') return {};
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          createRadialGradient() { return { addColorStop() {} }; },
          fillRect() {},
          fillStyle: '',
        };
      },
    };
  },
};

const { updateBeamSummary } = await import('../src/ui/hud.js');

try {
  const game = {
    registry: { getAll: () => [] },
    state: {
      infraCanRun: false,
      infraBlockers: [
        { severity: 'hard', code: 'power_unconnected', message: 'Power is not connected.' },
        { severity: 'hard', code: 'vacuum_unconnected', message: 'Vacuum is not connected.' },
      ],
    },
  };
  const ui = { game };
  let panelOpenCount = 0;
  ui._showInfraBlockerPanel = () => { panelOpenCount++; };

  updateBeamSummary(ui);
  assert(chip.textContent === '⚠ 2 FAULTS' && chip.className === 'beam-summary fault',
    'hard blockers render the red fault count');
  assert(chip.title.includes('click for details'),
    'the fault chip advertises its details action');
  assert(typeof chip.onclick === 'function',
    'the fault chip has a click handler');

  chip.onclick();
  assert(panelOpenCount === 1,
    'clicking the fault chip opens the infrastructure blocker panel');

  ui.game.state.infraCanRun = true;
  ui.game.state.infraBlockers = [];
  updateBeamSummary(ui);
  assert(chip.onclick === null && chip.className === 'beam-summary',
    'clearing faults also clears the stale click action');
} finally {
  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
