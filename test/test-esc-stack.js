// === Esc-Stack Tests ===
//
// ui/esc-stack.js is the single owner of the Escape key: one window keydown
// listener, a push/unsubscribe handler stack, top handler first, `false`
// passes to the next, fallback handlers always below normal ones.

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.log(`  FAIL: ${msg}`); }
}

// Minimal window stub: capture the single keydown listener the module binds.
const listeners = [];
globalThis.window = {
  addEventListener(type, fn) {
    if (type === 'keydown') listeners.push(fn);
  },
};

const { pushEscHandler } = await import('../src/ui/esc-stack.js');

let prevented = 0;
function fireEsc() {
  const e = { key: 'Escape', preventDefault: () => { prevented++; } };
  for (const fn of listeners) fn(e);
  return e;
}
function fireOther() {
  const e = { key: 'a', preventDefault: () => { prevented++; } };
  for (const fn of listeners) fn(e);
  return e;
}

console.log('listener binding');
const calls = [];
const un1 = pushEscHandler(() => { calls.push('h1'); return true; });
assert(listeners.length === 1, 'binds exactly one window keydown listener');
const un2 = pushEscHandler(() => { calls.push('h2'); return true; });
assert(listeners.length === 1, 'second push does not bind another listener');

console.log('top handler wins');
fireEsc();
assert(calls.join(',') === 'h2', 'most recently pushed handler runs alone');
assert(prevented === 1, 'consuming a press calls preventDefault');

console.log('non-Escape keys ignored');
calls.length = 0;
prevented = 0;
fireOther();
assert(calls.length === 0 && prevented === 0, 'other keys never touch the stack');

console.log('returning false passes down');
calls.length = 0;
const un3 = pushEscHandler(() => { calls.push('h3'); return false; });
fireEsc();
assert(calls.join(',') === 'h3,h2', 'false-returning top handler passes to the next');

console.log('unsubscribe');
calls.length = 0;
un2();
fireEsc();
assert(calls.join(',') === 'h3,h1', 'unsubscribed handler is skipped');
un2(); // idempotent
calls.length = 0;
fireEsc();
assert(calls.join(',') === 'h3,h1', 'double-unsubscribe is a no-op');

console.log('fallback layer');
calls.length = 0;
const unF = pushEscHandler(() => { calls.push('fb'); return true; });
// A later fallback push still sits below every normal handler.
const unFb = pushEscHandler(() => { calls.push('base'); return true; }, { fallback: true });
un3(); un1(); unF();
fireEsc();
assert(calls.join(',') === 'base', 'fallback runs once all normal handlers are gone');
calls.length = 0;
const un4 = pushEscHandler(() => { calls.push('h4'); return true; });
fireEsc();
assert(calls.join(',') === 'h4', 'normal handler pushed after fallback still beats it');
calls.length = 0;
un4();
prevented = 0;
unFb();
fireEsc();
assert(calls.length === 0 && prevented === 0,
  'empty stack consumes nothing and does not preventDefault');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
