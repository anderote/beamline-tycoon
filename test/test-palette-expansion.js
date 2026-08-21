// Static contract checks for the expandable build palette. Browser gameplay
// validation remains the owner's responsibility; these checks keep the DOM,
// CSS, and controller behavior from drifting apart.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');

assert.match(html, /id="palette-expand-toggle"[^>]*aria-expanded="false"/,
  'build bar exposes an initially collapsed expand toggle');
assert.match(html, /aria-controls="component-palette"/,
  'expand toggle targets the build palette');
assert.match(html, /id="hud-category-row"[\s\S]*?id="palette-expand-toggle"[\s\S]*?id="palette-search"/,
  'labeled expand toggle is visible beside palette search');
assert.match(html, /class="palette-expand-label">2 Rows<\/span>/,
  'collapsed toggle clearly advertises the two-row layout');
assert.match(css, /#bottom-hud\.palette-expanded\s*\{[^}]*overflow:\s*visible/s,
  'bottom HUD does not clip the upward expanded palette');
assert.match(css, /#component-palette\.palette-expanded\s*\{[^}]*position:\s*absolute/s,
  'expanded palette is an upward overlay');
assert.match(css, /#component-palette\.palette-expanded \.palette-subsection-items\s*\{[^}]*grid-template-rows:\s*repeat\(2,\s*184px\)/s,
  'expanded category sections use two rows');
assert.match(css, /grid-auto-flow:\s*column/,
  'expanded sections fill columns while preserving category blocks');
assert.match(css, /#component-palette\.palette-expanded:not\(:has\(\.palette-subsection\)\)\s*\{[^}]*grid-template-rows:\s*repeat\(2,\s*184px\)/s,
  'flat categories and search results also use two rows');
assert.match(hud, /UIHost\.prototype\._setPaletteExpanded\s*=\s*function/,
  'HUD owns expand/collapse state');
assert.match(hud, /toggle\.setAttribute\('aria-expanded',\s*String\(expanded\)\)/,
  'HUD synchronizes the accessibility state');
assert.match(hud, /label\.textContent\s*=\s*expanded\s*\?\s*'1 Row'\s*:\s*'2 Rows'/,
  'HUD changes the visible control label to describe the available layout');

console.log('palette expansion contract passed');
