// test/test-connection-guide.js — connection-guide category coverage and the
// shared palette refresh path used by mouse clicks, keyboard Tab, and restores.

import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

// hud.js reaches the renderer's component thumbnail modules, whose material
// catalogue uses the browser's THREE global at import time.
globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };
globalThis.document = {
  createElement() {
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          createRadialGradient() { return { addColorStop() {} }; },
          fillRect() {},
          fillStyle: null,
        };
      },
    };
  },
};

const { MODES } = await import('../src/data/modes.js');
const { UIHost } = await import('../src/ui/UIHost.js');
const { CONNECTION_GUIDES } = await import('../src/ui/hud.js');

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

console.log('\n--- Every infrastructure category has a complete guide ---\n');

const infraCategories = Object.keys(MODES.infra.categories);
assert(
  infraCategories.every(category => CONNECTION_GUIDES[category]),
  `all infra tabs are covered (${infraCategories.join(', ')})`,
);

for (const category of infraCategories) {
  const guide = CONNECTION_GUIDES[category];
  assert(
    Boolean(guide?.title && guide?.description && guide?.flow?.length > 1),
    `${category} has a title, description, and multi-stage flow`,
  );
  assert(
    guide?.links?.length === guide?.flow?.length - 1,
    `${category} has one link label between each pair of stages`,
  );
}

console.log('\n--- A palette category change refreshes all category-bound UI ---\n');

{
  const ui = Object.create(UIHost.prototype);
  const calls = [];
  ui._renderPalette = category => calls.push(`palette:${category}`);
  ui._renderConnectionGuide = category => calls.push(`guide:${category}`);
  ui._updateSystemStatsContent = category => calls.push(`stats:${category}`);

  ui.updatePalette('cooling');

  assert(
    calls.join('|') === 'palette:cooling|guide:cooling|stats:cooling',
    'updatePalette keeps the palette, guide, and stats on the same category',
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
