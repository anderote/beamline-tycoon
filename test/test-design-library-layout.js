// Design Library presentation contract. The Beamline Designer's Load Design
// action opens this shared overlay as a roomy BLT catalogue, so its cards must
// not regress to the old narrow strip previews and cramped action row.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
const library = readFileSync(join(ROOT, 'src/ui/DesignLibrary.js'), 'utf8');

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

console.log('\n--- Design Library BLT catalogue ---');

check(/id="designs-overlay" class="overlay designs-overlay blt-panel hidden"/.test(html)
  && html.includes('BEAMLINE ARCHIVE // SAVED STACKUPS'),
'the selector opts into the shared BLT panel language and has an archive heading');
check(/#designs-overlay\s*\{[^}]*width:\s*min\(1040px, calc\(100vw - 48px\)\)/s.test(css),
  'the catalogue uses the available screen width instead of the generic 400px overlay');
check(/\.designs-grid\s*\{[^}]*display:\s*grid[^}]*minmax\(280px, 1fr\)/s.test(css),
  'design cards flow through a roomy responsive grid');
check(/\.design-card-preview\s*\{[^}]*height:\s*104px/s.test(css)
  && /canvas\.width = 360;\s*canvas\.height = 104;/s.test(library),
  'schematic thumbnails have a large, crisp backing canvas');
check(/\.design-card-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s.test(css)
  && /\.design-card-actions button\s*\{[^}]*min-height:\s*30px/s.test(css),
  'card actions use two spacious columns with full-height targets');
check(library.includes("this._modal ? 'Load in Designer' : 'Edit'")
  && library.includes("this._modal ? 'Load Beamline Design' : 'Beamline Designs'"),
  'the Designer modal labels its title and primary action as loading');
check(library.includes("newIcon.innerHTML = '<i></i><b>+</b><i></i>'")
  && css.includes('.design-card-new-icon'),
  'the new-design action has a large schematic-style icon');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
