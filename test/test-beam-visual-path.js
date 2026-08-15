import { beamVisualPath } from '../src/renderer3d/beam-visual-path.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const pipes = [
  { id: 'p1', start: { junctionId: 'source' }, end: { junctionId: 'mid' },
    path: [{ col: 0, row: 0 }, { col: 2, row: 0 }, { col: 2, row: 1 }] },
  { id: 'p2', start: { junctionId: 'end' }, end: { junctionId: 'mid' },
    path: [{ col: 4, row: 1 }, { col: 2, row: 1 }] },
];
const flat = [
  { kind: 'module', id: 'source' }, { kind: 'drift', pipeId: 'p1' },
  { kind: 'module', id: 'mid' }, { kind: 'drift', pipeId: 'p2' },
  { kind: 'module', id: 'end' },
];
const path = beamVisualPath(flat, pipes);
assert(JSON.stringify(path) === JSON.stringify([
  { col: 0, row: 0 }, { col: 2, row: 0 }, { col: 2, row: 1 }, { col: 4, row: 1 },
]), 'visual path retains turns and reverses pipes traversed from their end');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
