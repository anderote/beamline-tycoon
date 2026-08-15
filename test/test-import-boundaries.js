// Dependency structure is an executable contract. Cycles make otherwise-pure
// data modules depend on runtime systems through an indirect import chain.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');

function jsFiles(directory) {
  return readdirSync(directory).flatMap(name => {
    const target = path.join(directory, name);
    return statSync(target).isDirectory()
      ? jsFiles(target)
      : (name.endsWith('.js') ? [target] : []);
  });
}

function localDependencies(file) {
  const source = readFileSync(file, 'utf8');
  const specifiers = [];
  const importPattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importPattern)) specifiers.push(match[1]);
  return specifiers
    .filter(specifier => specifier.startsWith('.'))
    .map(specifier => {
      const unresolved = path.resolve(path.dirname(file), specifier);
      if (existsSync(unresolved) && statSync(unresolved).isFile()) return unresolved;
      if (existsSync(`${unresolved}.js`)) return `${unresolved}.js`;
      const index = path.join(unresolved, 'index.js');
      return existsSync(index) ? index : null;
    })
    .filter(Boolean);
}

const graph = new Map(jsFiles(src).map(file => [file, localDependencies(file)]));
const visiting = new Set();
const visited = new Set();
const stack = [];

function findCycle(file) {
  if (visiting.has(file)) return [...stack.slice(stack.indexOf(file)), file];
  if (visited.has(file)) return null;
  visiting.add(file);
  stack.push(file);
  for (const dependency of graph.get(file) || []) {
    const cycle = findCycle(dependency);
    if (cycle) return cycle;
  }
  stack.pop();
  visiting.delete(file);
  visited.add(file);
  return null;
}

let cycle = null;
for (const file of graph.keys()) {
  cycle = findCycle(file);
  if (cycle) break;
}

assert.equal(
  cycle,
  null,
  cycle?.map(file => path.relative(root, file)).join(' -> '),
);

console.log(`PASS: ${graph.size} source modules form an acyclic import graph`);
