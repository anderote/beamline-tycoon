import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PY_PHYSICS_MODULES } from '../src/beamline/physics-modules.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = [...PY_PHYSICS_MODULES];
assert.ok(modules.length > 0, 'browser physics bridge declares Python modules');

for (const path of modules) {
  const source = readFileSync(resolve(root, path));
  const browser = readFileSync(resolve(root, 'public', path));
  assert.deepEqual(browser, source, `${path} browser copy matches the canonical solver`);
}

console.log(`Browser physics mirror tests passed (${modules.length} modules).`);
