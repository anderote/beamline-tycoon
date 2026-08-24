// test/test-connection-guide.js — connection-guide content, readable blueprint
// topology coverage, and one-shot fresh-tab lifecycle.

import * as THREE_REAL from 'three';
import { readFileSync } from 'node:fs';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

// hud.js reaches the renderer's component thumbnail modules, whose material
// catalogue uses the browser's THREE global at import time.
globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };

function drawingContext({ labels = [], dashPatterns = [] } = {}) {
  return {
    beginPath() {},
    clearRect() {},
    closePath() {},
    createRadialGradient() { return { addColorStop() {} }; },
    fill() {},
    fillRect() {},
    fillText(text) { labels.push(String(text)); },
    lineTo() {},
    measureText(text) { return { width: String(text).length * 8 }; },
    moveTo() {},
    restore() {},
    save() {},
    setLineDash(pattern) { dashPatterns.push([...pattern]); },
    stroke() {},
    strokeRect() {},
    fillStyle: null,
    font: '',
    imageSmoothingEnabled: true,
    lineCap: '',
    lineJoin: '',
    lineWidth: 1,
    strokeStyle: null,
    textAlign: '',
    textBaseline: '',
  };
}

globalThis.document = {
  createElement() {
    return {
      width: 0,
      height: 0,
      getContext() { return drawingContext(); },
    };
  },
};

const { MODES } = await import('../src/data/modes.js');
const { UIHost } = await import('../src/ui/UIHost.js');
const { CONNECTION_GUIDES } = await import('../src/ui/hud.js');
const {
  CONNECTION_GUIDE_DIAGRAMS,
  CONNECTION_GUIDE_SCHEMATICS,
  drawConnectionGuideDiagram,
} = await import('../src/ui/connection-guide-diagrams.js');
const connectionGuideCss = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const connectionGuideHud = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
const inputHandlerSource = readFileSync(new URL('../src/input/InputHandler.js', import.meta.url), 'utf8');

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
      && CONNECTION_GUIDE_DIAGRAMS[guide.diagram],
    `${category} has an accent and a registered blueprint schematic`,
  );
}

console.log('\n--- Guide flows match the implemented infrastructure contracts ---\n');

assert(
  CONNECTION_GUIDES.power.links.join('|') === 'HV FEEDER|POWER CABLE'
    && CONNECTION_GUIDES.power.flow[1].name === 'DISTRIBUTION PANEL',
  'power separates transformer capacity, HV-fed distribution, and branch loads',
);
assert(
  CONNECTION_GUIDES.rfPower.links.join('|') === 'HV FEEDER|RF WAVEGUIDE'
    && !CONNECTION_GUIDES.rfPower.flow.some(stage => stage.name === 'MODULATOR'),
  'RF uses the implemented HV-feed and waveguide path without inventing a modulator data link',
);
assert(
  ['PUMP SOURCES', 'SHARED HEADER', 'BEAM VOLUME', 'GAUGE']
    .every(name => CONNECTION_GUIDES.vacuum.flow.some(stage => stage.name === name)),
  'vacuum shows order-independent pump sources, the shared header, vacuum volume, and a gauge tap',
);
assert(
  ['STORAGE', 'CHILLER', 'HEAT LOAD', 'HEAT REJECTOR']
    .every(name => CONNECTION_GUIDES.cooling.flow.some(stage => stage.name === name)),
  'cooling shows every plant role required by the cooling-water solver',
);
assert(
  CONNECTION_GUIDES.ops.flow.some(stage => stage.name === 'COOLED DUMP')
    && CONNECTION_GUIDES.ops.description.includes('inside shielding')
    && CONNECTION_GUIDE_SCHEMATICS.ops.boundaries
      .some(boundary => boundary.label === 'SHIELDED LOSS AREA'),
  'Ops presents a physical loss-point arrangement and calls out the dump cooling connection',
);

console.log('\n--- The diagram is a readable, labeled BLT blueprint ---\n');

{
  const labels = [];
  const dashPatterns = [];
  const context = drawingContext({ labels, dashPatterns });
  const canvas = { getContext: () => context, width: 0, height: 0 };
  const diagramKeys = new Set(
    Object.values(CONNECTION_GUIDES).map(guide => guide.diagram),
  );
  assert(
    [...diagramKeys].every(diagram => drawConnectionGuideDiagram(canvas, diagram, '#8fe5ff')),
    `all ${diagramKeys.size} guide schematics render through the public drawing seam`,
  );
  assert(canvas.width === 640 && canvas.height === 184,
    'the blueprint uses a wide, high-resolution field for legible labels');
  assert(
    ['HV SUPPLY', 'HV FEEDER', 'POWER CABLES', 'RF WAVEGUIDE', 'SHARED HEADER', 'DATA FIBER']
      .every(label => labels.includes(label)),
    'equipment and connection names are drawn inside the schematic itself',
  );
  assert(
    dashPatterns.some(pattern => pattern.join(',') === '8,6'),
    'utility runs use the BLT dotted-route language',
  );
}

const powerSchematic = CONNECTION_GUIDE_SCHEMATICS.power;
const powerNodeNames = powerSchematic.nodes.map(item => (
  Array.isArray(item.title) ? item.title.join(' ') : item.title
));
assert(
  powerNodeNames.includes('HV SUPPLY')
    && powerNodeNames.includes('DISTRIBUTION PANEL')
    && powerNodeNames.filter(name => name.startsWith('EQUIPMENT')).length === 3,
  'power is boxes for one HV supply, one distributor, and several equipment loads',
);
assert(
  powerSchematic.connections.some(item => item.label === 'HV FEEDER')
    && powerSchematic.connections.some(item => item.label === 'POWER CABLES')
    && powerSchematic.connections.filter(item => item.points.at(-1)[0] === 520).length === 3,
  'power labels the HV feeder and visibly fans separate power cables to three loads',
);

assert(
  /#connection-guide\s*\{[^}]*width:\s*min\(680px/s.test(connectionGuideCss)
    && /\.connection-guide-desc\s*\{[^}]*font-size:\s*12px/s.test(connectionGuideCss),
  'the panel and explanatory copy are enlarged for readability',
);
assert(
  /\.connection-guide-figure\s*\{[^}]*padding:\s*10px/s.test(connectionGuideCss)
    && /\.connection-guide-art\s*\{[^}]*width:\s*100%[^}]*aspect-ratio:\s*80 \/ 23/s.test(connectionGuideCss),
  'the labeled blueprint spans the enlarged guide field',
);
assert(
  /drawConnectionGuideDiagram\(canvas, guide\.diagram, guide\.accent\)/.test(connectionGuideHud),
  'the guide renders one category-wide canvas rather than a canvas per stage',
);
assert(
  !/connection-guide-legend/.test(connectionGuideHud)
    && !/\.connection-guide-(?:stage|step|name|detail|link|legend)\b/.test(connectionGuideCss),
  'the former tiny duplicate legend is removed',
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

console.log('\n--- Guides are one-shot within each Infra tab visit ---\n');

{
  const ui = Object.create(UIHost.prototype);
  const renders = [];
  ui.renderer = { activeMode: 'infra' };
  ui._connectionGuideCategory = null;
  ui._connectionGuideVisible = false;
  ui._renderConnectionGuide = category => renders.push({
    category,
    visible: ui._connectionGuideVisible,
  });
  ui._renderPalette = () => {};
  ui._updateSystemStatsContent = () => {};

  ui.updatePalette('power', { freshTab: true });
  assert(ui._connectionGuideVisible === true, 'a fresh Infra tab reveals its guide');

  ui._setConnectionGuidePlacementActive(true);
  assert(ui._connectionGuideVisible === false, 'arming a component dismisses the guide');

  ui._setConnectionGuidePlacementActive(false);
  assert(ui._connectionGuideVisible === false, 'disarming or Escape does not restore it');

  ui.updatePalette('power');
  assert(ui._connectionGuideVisible === false, 'refreshing the same tab does not restore it');

  ui.updatePalette('vacuum', { freshTab: true });
  assert(
    ui._connectionGuideVisible === true && ui._connectionGuideCategory === 'vacuum',
    'switching to another Infra tab begins a new guide visit',
  );

  ui._dismissConnectionGuide();
  assert(ui._connectionGuideVisible === false, 'a world/Escape dismissal is sticky for the visit');
  assert(renders.length >= 5, 'every visibility-changing transition updates the guide immediately');
}

assert(
  /canvas\.addEventListener\('mousedown',[\s\S]*?_dismissConnectionGuide/.test(inputHandlerSource),
  'a map press dismisses the guide before world interaction dispatch',
);
assert(
  /if \(e\.key === 'Escape'\) \{[\s\S]*?_dismissConnectionGuide/.test(inputHandlerSource),
  'Escape dismisses the guide even when another Escape-stack layer handles the key',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
