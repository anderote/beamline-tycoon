import assert from 'node:assert/strict';
import { lazyDialog } from '../src/ui/lazy-dialog.js';
let creates = 0;
const opened = [];
const open = lazyDialog(async () => {
  creates++;
  return { open: mode => opened.push(mode) };
});
assert.equal(creates, 0);
await Promise.all([open('save'), open('load')]);
assert.equal(creates, 1);
assert.deepEqual(opened, ['save', 'load']);
let attempts = 0;
const retry = lazyDialog(async () => {
  if (++attempts === 1) throw new Error('offline');
  return { open: () => 'ready' };
});
await assert.rejects(retry(), /offline/);
assert.equal(await retry(), 'ready');
console.log('Lazy dialog deferred loading, shared instance and retry pass');
