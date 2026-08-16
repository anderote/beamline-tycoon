// Required build-preview ports are derived from real sink ports and rendered
// consistently in every route that can open a build preview.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { COMPONENTS } from '../src/data/components.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';
import {
  appendRequiredPortRequirements,
  requiredUtilityPorts,
} from '../src/ui/required-port-preview.js';

test('required ports come from sink contracts in authored order', () => {
  const ports = requiredUtilityPorts(COMPONENTS.rfCavity);
  assert.deepEqual(ports.map(port => port.utilityType), [
    'powerCable', 'coolingWater', 'rfWaveguide', 'vacuumPipe',
  ]);
  assert.ok(!COMPONENTS.rfCavity.requiredConnections.includes('vacuumPipe'),
    'fixture confirms the old mirror omits vacuum');
  assert.equal(ports.at(-1).label, 'Vacuum Pipe');
});

test('required port colors match visible port-marker colors', () => {
  const [hv] = requiredUtilityPorts(COMPONENTS.powerPanel);
  assert.equal(hv.utilityType, 'hvCable');
  assert.equal(hv.color, UTILITY_TYPES.hvCable.markerColor);
  assert.notEqual(hv.color, UTILITY_TYPES.hvCable.color,
    'HV uses its legible marker override rather than its near-black cable color');
});

test('duplicate sink types collapse into a counted requirement', () => {
  const ports = requiredUtilityPorts({ ports: {
    left: { utility: 'dataFiber', role: 'sink' },
    right: { utility: 'dataFiber', role: 'sink' },
  } });
  assert.equal(ports.length, 1);
  assert.equal(ports[0].count, 2);
  assert.deepEqual(ports[0].portNames, ['left', 'right']);
});

test('shared renderer produces colored text and omits empty requirements', () => {
  function element(tagName) {
    return {
      tagName, children: [], className: '', textContent: '', dataset: {}, attrs: {},
      style: { values: {}, setProperty(name, value) { this.values[name] = value; } },
      setAttribute(name, value) { this.attrs[name] = value; },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
    };
  }
  globalThis.document = { createElement: element };
  const container = element('div');
  const block = appendRequiredPortRequirements(container, COMPONENTS.powerPanel);
  const item = block.children[1].children[0];
  assert.equal(item.textContent, UTILITY_TYPES.hvCable.displayName);
  assert.equal(item.style.values['--required-port-color'], UTILITY_TYPES.hvCable.markerColor);
  assert.equal(item.attrs.role, 'listitem');
  assert.equal(appendRequiredPortRequirements(container, COMPONENTS.drift), null);
});

test('all three build-preview routes use the shared required-port renderer', () => {
  const root = new URL('../', import.meta.url);
  const sources = [
    'src/ui/hud.js',
    'src/input/InputHandler.js',
    'src/renderer/designer-renderer.js',
  ].map(path => readFileSync(new URL(path, root), 'utf8'));
  for (const source of sources) {
    assert.match(source, /appendRequiredPortRequirements\(/);
  }
  const css = readFileSync(new URL('style.css', root), 'utf8');
  assert.match(css, /\.required-port-type\s*\{[^}]*color:\s*var\(--required-port-color\)/s);
});
