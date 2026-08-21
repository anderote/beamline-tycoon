// Beamline Designer bottom-HUD layout contract. The global build search shares
// the category row, and the otherwise-empty mode row collapses while the
// Designer is open so that vertical space returns to its tuning controls.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
const designer = readFileSync(join(ROOT, 'src/ui/BeamlineDesigner.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

console.log('\n--- Designer palette row layout ---');

const topRowStart = html.indexOf('<div id="hud-top-row">');
const categoryRowStart = html.indexOf('<div id="hud-category-row">');
const paletteStart = html.indexOf('<div id="component-palette">');
const topRow = html.slice(topRowStart, categoryRowStart);
const categoryRow = html.slice(categoryRowStart, paletteStart);

check(topRowStart >= 0 && categoryRowStart > topRowStart && paletteStart > categoryRowStart,
  'the HUD declares separate mode and category rows');
check(topRow.includes('id="mode-switcher"') && !topRow.includes('id="palette-search"'),
  'the top row contains modes without reserving a separate search slot');
check(categoryRow.includes('id="category-tabs"')
  && categoryRow.includes('id="palette-search"')
  && categoryRow.indexOf('id="category-tabs"') < categoryRow.indexOf('id="palette-search"'),
'search follows the category buttons in their shared row');
check(/#hud-category-row\s*\{[^}]*display:\s*flex/s.test(css)
  && /#category-tabs\s*\{[^}]*flex:\s*1 1 auto/s.test(css)
  && /#palette-search\s*\{[^}]*margin-left:\s*auto/s.test(css),
'category buttons consume the left side while search is aligned right');

const normalHeight = Number(css.match(/--hud-bottom-height:\s*(\d+)px/)?.[1]);
const designerHeight = Number(css.match(/--designer-hud-bottom-height:\s*(\d+)px/)?.[1]);
check(normalHeight - designerHeight === 39,
  'the Designer HUD removes exactly the recovered empty-row height');
check(/#bottom-hud\.designer-active\s*\{[^}]*height:\s*var\(--designer-hud-bottom-height\)/s.test(css)
  && /#bottom-hud\.designer-active #hud-top-row\s*\{[^}]*display:\s*none/s.test(css)
  && /#bottom-hud\.designer-active #hud-controls\s*\{[^}]*flex-basis:\s*39px/s.test(css),
'Designer mode collapses the unused mode row and compacts the HUD');
const tuningRowStart = html.indexOf('id="dsgn-tuning-row"');
const optimizerStart = html.indexOf('id="dsgn-optimizer-launch"');
check(tuningRowStart >= 0 && optimizerStart > tuningRowStart
  && /<\/div>\s*<section id="dsgn-optimizer-launch"/.test(html.slice(tuningRowStart, optimizerStart + 50)),
'the optimizer launcher follows the tuning row inside the Designer body');
check(/\.dsgn-body\s*\{[^}]*padding-bottom:\s*var\(--designer-hud-bottom-height\)/s.test(css)
  && /\.dsgn-body > \.dsgn-optimizer-launch\s*\{[^}]*position:\s*relative[^}]*flex:\s*0 0 auto[^}]*margin:\s*8px 12px/s.test(css),
'the in-flow optimizer launcher reserves its own strip above the compact HUD');

const activeAdds = designer.match(/bottomHud\.classList\.add\('designer-active'\)/g) || [];
const activeRemoves = designer.match(/bottomHud\.classList\.remove\('designer-active'\)/g) || [];
check(activeAdds.length === 2 && activeRemoves.length === 1,
  'both Designer entry paths compact the HUD and close restores normal layout');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
