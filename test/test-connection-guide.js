// test/test-connection-guide.js — connection-guide category coverage and the
// shared palette refresh path used by mouse clicks, keyboard Tab, and restores.

import * as THREE_REAL from 'three';
import { readFileSync } from 'node:fs';

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
const {
  CONNECTION_GUIDE_DIAGRAMS,
  drawConnectionGuideDiagram,
} = await import('../src/ui/connection-guide-diagrams.js');
const connectionGuideCss = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

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
  assert(
    /^#[0-9a-f]{6}$/i.test(guide?.accent)
      && guide.flow.every(stage => CONNECTION_GUIDE_DIAGRAMS[stage.diagram]),
    `${category} gives every stage a color and registered pixel cutaway`,
  );
}

console.log('\n--- The schematic stays legible and connected ---\n');

{
  const context = {
    clearRect() {},
    fillRect() {},
    fillStyle: null,
    imageSmoothingEnabled: true,
  };
  const canvas = { getContext: () => context, width: 0, height: 0 };
  const diagramKeys = new Set(
    Object.values(CONNECTION_GUIDES).flatMap(guide => guide.flow.map(stage => stage.diagram)),
  );
  assert(
    [...diagramKeys].every(diagram => drawConnectionGuideDiagram(canvas, diagram, '#8fe5ff')),
    `all ${diagramKeys.size} guide cutaways render through the public drawing seam`,
  );
}

assert(
  /\.connection-guide-flow\s*\{[^}]*min-height:\s*154px/s.test(connectionGuideCss),
  'connection diagrams reserve a full-height drawing area',
);
assert(
  /\.connection-guide-art\s*\{[^}]*width:\s*78px[^}]*height:\s*50px[^}]*image-rendering:\s*pixelated/s.test(connectionGuideCss),
  'cutaway canvases keep a hard-edged pixel footprint',
);
assert(
  /\.connection-guide-track\s*\{[^}]*border-top:\s*3px dotted/s.test(connectionGuideCss),
  'flow stages are joined by visible dotted connection tracks',
);
assert(
  /\.connection-guide-link\s*\{[^}]*align-items:\s*flex-start/s.test(connectionGuideCss),
  'connector labels stay compact instead of covering their dotted tracks',
);

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
