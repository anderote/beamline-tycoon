import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bridge = readFileSync(resolve(root, 'src/beamline/physics.js'), 'utf8');
const moduleBlock = bridge.match(/const PY_MODULES = \[([\s\S]*?)\n  \];/);
assert.ok(moduleBlock, 'browser physics bridge declares PY_MODULES');

const modules = [...moduleBlock[1].matchAll(/'([^']+\.py)'/g)].map(match => match[1]);
assert.ok(modules.length > 0, 'browser physics bridge declares Python modules');

for (const path of modules) {
  const source = readFileSync(resolve(root, path));
  const browser = readFileSync(resolve(root, 'public', path));
  assert.deepEqual(browser, source, `${path} browser copy matches the canonical solver`);
}

console.log(`Browser physics mirror tests passed (${modules.length} modules).`);
