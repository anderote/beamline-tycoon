// test/test-port-anchors.js — where a utility port is in 3D.
//
// The anchor is presentation: it decides where the dot, the fitting and the
// cable end go. The one thing it must never do is move the port itself — x/z
// stay exactly portWorldPosition, because snapping, pathing, overlap and cost
// all read that. Everything else here is about the height being sane with or
// without a renderer present.

import { COMPONENTS } from '../src/data/components.js';
import { portWorldPosition } from '../src/utility/ports.js';
import {
  portAnchor3D,
  setModelBoundsProvider,
  DEFAULT_ANCHOR_Y,
} from '../src/utility/port-anchors.js';
import { portAnchorOverride, PORT_ANCHOR_OVERRIDES } from '../src/data/utility-port-anchors.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// Every component type that declares at least one utility port, with one such
// port name — the population this module has to answer for.
const utilityPorts = [];
for (const [type, def] of Object.entries(COMPONENTS)) {
  if (!def || !def.ports) continue;
  for (const [name, spec] of Object.entries(def.ports)) {
    if (spec && spec.utility) utilityPorts.push({ type, def, name, utility: spec.utility });
  }
}

function place(type, extra = {}) {
  return { id: 'p1', type, col: 3, row: 4, subCol: 0, subRow: 0, dir: 0, ...extra };
}

console.log('\n--- 1. The sim does not move ---');
{
  let mismatched = 0;
  for (const { type, def, name } of utilityPorts) {
    const p = place(type);
    const anchor = portAnchor3D(p, def, name);
    const pos = portWorldPosition(p, def, name);
    if (!anchor || !pos) { if (pos) mismatched++; continue; }
    if (anchor.x !== pos.x || anchor.z !== pos.z) mismatched++;
  }
  assert(utilityPorts.length > 20, `there are utility ports to check (${utilityPorts.length})`);
  assert(mismatched === 0,
    `every anchor's x/z is exactly portWorldPosition (${mismatched} differ)`);
}

console.log('\n--- 2. Every utility port resolves to a usable height ---');
{
  setModelBoundsProvider(null);   // headless: no renderer, no model bounds
  let unresolved = 0, bad = 0;
  for (const { type, def, name } of utilityPorts) {
    const anchor = portAnchor3D(place(type), def, name);
    if (!anchor) { unresolved++; continue; }
    if (!(anchor.y > 0) || anchor.y > 3) bad++;
  }
  assert(unresolved === 0, `no utility port fails to resolve (${unresolved} did)`);
  assert(bad === 0, `no anchor is underground or on a roof (${bad} were)`);
}

console.log('\n--- 3. Derivation, overrides, and the headless fallback ---');
{
  // With no bounds provider, an unauthored type takes the neutral height.
  setModelBoundsProvider(null);
  const plain = utilityPorts.find(p => !PORT_ANCHOR_OVERRIDES[p.type]);
  assert(!!plain, 'there is an unauthored type to test with');
  if (plain) {
    const a = portAnchor3D(place(plain.type), plain.def, plain.name);
    assert(a.y === DEFAULT_ANCHOR_Y,
      `headless, an unauthored port takes DEFAULT_ANCHOR_Y (got ${a.y})`);

    // With bounds, it derives mid-shell...
    setModelBoundsProvider(() => ({ minY: 0, maxY: 2.0 }));
    const derived = portAnchor3D(place(plain.type), plain.def, plain.name);
    assert(derived.y > 0.9 && derived.y < 1.3,
      `a 2 m model puts its port around mid-shell (got ${derived.y})`);

    // ...and clamps rather than following an absurd model.
    setModelBoundsProvider(() => ({ minY: 0, maxY: 40 }));
    const tall = portAnchor3D(place(plain.type), plain.def, plain.name);
    assert(tall.y <= 2.0, `a 40 m model still clamps to reach (got ${tall.y})`);
    setModelBoundsProvider(() => ({ minY: 0, maxY: 0.02 }));
    const flat = portAnchor3D(place(plain.type), plain.def, plain.name);
    assert(flat.y >= 0.35, `a flat model still clears the floor (got ${flat.y})`);
  }
}

{
  // An authored height wins over whatever the model says.
  setModelBoundsProvider(() => ({ minY: 0, maxY: 2.0 }));
  const authored = utilityPorts.find(p => portAnchorOverride(p.type, p.name));
  assert(!!authored, 'the override table covers at least one real port');
  if (authored) {
    const want = portAnchorOverride(authored.type, authored.name).y;
    const a = portAnchor3D(place(authored.type), authored.def, authored.name);
    assert(a.y === want,
      `${authored.type}.${authored.name} takes its authored height (${a.y} vs ${want})`);
  }
  setModelBoundsProvider(null);
}

{
  // Every type named in the override table has to exist and declare a utility
  // port, or the entry is silently dead weight.
  const dead = Object.keys(PORT_ANCHOR_OVERRIDES).filter((type) => {
    const def = COMPONENTS[type];
    return !def || !def.ports
      || !Object.values(def.ports).some(s => s && s.utility);
  });
  assert(dead.length === 0,
    `no override names a type with no utility ports (dead: ${dead.join(',') || 'none'})`);
}

console.log('\n--- 4. The outward normal follows rotation ---');
{
  const { type, def, name } = utilityPorts[0];
  const dirs = [0, 1, 2, 3].map(dir => {
    const a = portAnchor3D(place(type, { dir }), def, name);
    return a ? `${a.out.x},${a.out.z}` : 'none';
  });
  assert(new Set(dirs).size === 4,
    `rotating the placeable turns its port's normal (${dirs.join(' | ')})`);
  const a = portAnchor3D(place(type), def, name);
  assert(a.standoff > 0, 'and a connector stands proud of the shell');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
