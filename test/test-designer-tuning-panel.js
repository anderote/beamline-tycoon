// Beamline Designer component details can collapse so the flexing plot row
// receives the reclaimed height. Pin the DOM, layout, accessibility, and redraw
// contract without requiring the browser-only interaction lane.

import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../src/ui/BeamlineDesigner.js', import.meta.url), 'utf8');

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

console.log('\n--- Designer component-details panel ---');

const toggleStart = html.indexOf('id="dsgn-tuning-toggle"');
const rowStart = html.indexOf('id="dsgn-tuning-row"');
check(toggleStart >= 0 && rowStart > toggleStart,
  'a component-details toggle directly precedes the tuning content');
check(html.includes('aria-expanded="true"')
  && html.includes('aria-controls="dsgn-tuning-row"'),
'the expanded-by-default control exposes its relationship to assistive technology');
check(/\.dsgn-tuning-row\.is-collapsed\s*\{[^}]*display:\s*none/s.test(css)
  && /\.dsgn-plots-row\s*\{[^}]*flex:\s*0\.8/s.test(css),
'collapsing removes the fixed-height strip so the flexible plot row claims its space');
check(controller.includes("tuningToggle.addEventListener('click'")
  && controller.includes("toggle.setAttribute('aria-expanded'")
  && controller.includes("row?.classList.toggle('is-collapsed'"),
'the controller keeps toggle state, accessibility state, and visibility in sync');
check(controller.includes('requestAnimationFrame(() => {')
  && controller.includes('if (this.isOpen) this._renderAll();'),
'the designer redraws its canvases after the collapsed layout settles');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
