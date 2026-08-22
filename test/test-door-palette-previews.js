import { DOOR_TYPES } from '../src/data/structure.js';
import {
  doorPalettePreviewModel,
  renderDoorPalettePreview,
} from '../src/ui/door-palette-preview.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

console.log('\n=== Door palette preview coverage ===\n');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.style = {};
    this.classes = new Set();
    this.classList = { add: (...names) => names.forEach(name => this.classes.add(name)) };
  }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
}
globalThis.document = { createElement: tagName => new FakeElement(tagName) };

for (const [id, def] of Object.entries(DOOR_TYPES)) {
  const texturePath = def.texture ? `assets/textures/materials/${def.texture}.png` : null;
  const model = doorPalettePreviewModel(def, texturePath);
  const expectedLeaves = def.leafCount ?? (def.doorWidth === 'double' ? 2 : 1);
  assert(model.leafCount === expectedLeaves && model.leaves.length === expectedLeaves,
    `${id} preview matches its authored leaf count (${expectedLeaves})`);
  assert(Number.isFinite(model.width) && Number.isFinite(model.height)
      && model.width >= 24 && model.width <= 78 && model.height >= 20 && model.height <= 64,
    `${id} preview has bounded door-like proportions`);
  assert(model.isOpen || model.isGlass || model.leaves.every(leaf => !!leaf.texturePath),
    `${id} preview has texture art or an explicit open/glass treatment`);

  for (let variant = 0; variant < (def.variants?.length || 1); variant++) {
    const variantModel = doorPalettePreviewModel(def, texturePath, variant);
    assert(/^#[0-9a-f]{6}$/i.test(variantModel.leafColor)
        && /^#[0-9a-f]{6}$/i.test(variantModel.glassColor),
      `${id} variant ${variant} resolves valid preview colours`);
  }

  if (expectedLeaves === 2) {
    assert(model.leaves[0].mirrored === false && model.leaves[1].mirrored === true,
      `${id} preview mirrors only the right leaf so the artwork faces inward`);
    assert(model.leaves[0].handleSide === 'right' && model.leaves[1].handleSide === 'left',
      `${id} preview places both handles at the centre seam`);
  }

  const root = new FakeElement('div');
  renderDoorPalettePreview(root, def, texturePath, 0);
  assert(root.children.length === 1 && root.children[0].children.length === expectedLeaves,
    `${id} DOM preview renders exactly ${expectedLeaves} leaf element${expectedLeaves === 1 ? '' : 's'}`);
}

const hallway = doorPalettePreviewModel(DOOR_TYPES.hallwayDoor);
assert(hallway.isOpen && hallway.leafCount === 0,
  'open hallway preview is an empty framed opening, not a solid swatch');

for (const id of ['glassDoor', 'doubleGlassDoor']) {
  const model = doorPalettePreviewModel(DOOR_TYPES[id]);
  assert(model.isGlass && model.leaves.length > 0,
    `${id} preview uses a transparent glazed-leaf treatment without bitmap art`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
