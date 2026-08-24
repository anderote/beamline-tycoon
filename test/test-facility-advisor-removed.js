// test/test-facility-advisor-removed.js — the retired mascot advisor must not
// creep back into startup, HUD, styles, or browser-test setup.

import { existsSync, readFileSync } from 'node:fs';

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

console.log('\n--- Retired facility advisor stays removed ---');

for (const path of [
  'src/ui/Stubby.js',
  'src/ui/stubby-sprite.js',
  'src/advisor/context.js',
  'src/advisor/engine.js',
  'src/advisor/rules.js',
]) {
  assert(!existsSync(path), `${path} no longer exists`);
}

const main = readFileSync('src/main.js', 'utf8');
assert(!main.includes("./advisor/")
    && !main.includes("registerSerializer('advisor'")
    && !main.includes('_runAdvisor')
    && !main.includes('_stubby'),
  'startup has no facility-advisor imports, tick listener, or save section');

const hud = readFileSync('src/ui/hud.js', 'utf8');
assert(hud.includes("btn.id = 'btn-manual'")
    && !hud.includes('advisor-level')
    && !hud.includes('_setAdvisorLevel'),
  'the operator-manual button remains without an advice flyout');

const css = readFileSync('style.css', 'utf8');
assert(!css.includes('.stubby') && !css.includes('.advisor-level-menu'),
  'mascot and advice-menu styling are removed');

const smoke = readFileSync('test/browser/smoke.spec.mjs', 'utf8');
assert(!smoke.includes('TEMP-STUBBY-HACK') && !smoke.includes('#stubby'),
  'browser setup no longer needs a mascot-hiding workaround');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
