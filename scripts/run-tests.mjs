#!/usr/bin/env node
// scripts/run-tests.mjs — run every Node test in test/ plus the pytest suite.
//
// Discovers test/*.js at the top level only. The browser-level suite lives in
// test/browser/*.spec.mjs, needs a dev server plus headless Chromium, and runs
// separately via `npm run test:browser` (see playwright.config.mjs and
// test/browser/README-coverage.md). Each file runs as "node <file>"; both
// conventions in the repo (hand-rolled scripts that process.exit(1) on failure,
// and node:test files) signal failure via a non-zero exit code. Then runs
// "python3 -m pytest test/ -q".
// Prints a per-file summary and exits non-zero if anything failed.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'test');

const files = readdirSync(testDir)
  .filter(f => f.endsWith('.js') && !f.endsWith('.mjs'))
  .sort();

const results = [];

function run(name, cmd, args) {
  const res = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
  const ok = res.status === 0;
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    // Show the failing suite's output so the cause is visible in one run.
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    if (res.error) console.error(`  spawn error: ${res.error.message}`);
  }
}

for (const f of files) {
  run(`test/${f}`, 'node', [path.join('test', f)]);
}

run('pytest (test/*.py)', 'python3', ['-m', 'pytest', 'test/', '-q']);

const failed = results.filter(r => !r.ok);
console.log('\n=== Test Summary ===');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} suites passed`);
process.exit(failed.length > 0 ? 1 : 0);
