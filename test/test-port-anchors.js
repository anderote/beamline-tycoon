// test/test-port-anchors.js — where a utility port is in 3D.
//
// The anchor is presentation: it decides where the dot, the fitting and the
// cable end go. It is deliberately NOT the sim's port position any more — the
// sim's point is on the tile footprint, which for an on-pipe module is the
// reserved beam corridor and is far wider than the machine, so a connector put
// there floats half a metre out on bare floor. The anchor is measured against
// the model instead: a raycast at the port's own height says how far out the
// shell is, and the port's `offsetAlong` says where along the machine it sits.
//
// So there are two contracts here, and this file defends both:
//
//   * HEADLESS — with no bounds provider and no shell-measure provider (node,
//     and any path without THREE), every step of the resolution falls through
//     to its last option and x/z come back byte-identical to
//     `portWorldPosition`, at every rotation. That is what keeps the rest of
//     the node suite, and every headless caller, seeing exactly the sim's
//     numbers. Section 1.
//
//   * MEASURED — with providers registered, the anchor is at the measured
//     lateral distance and the mapped longitudinal offset, in the component's
//     unrotated local frame, turned by `dir`. Sections 5-9 pin those to exact
//     computed positions: an assertion that merely said "it moved" or "it got
//     closer" would still pass if the shell measurement were plumbed in
//     backwards, and the whole point of the change is the exact spot.
//
// Sections 2-4 are the older coverage — heights with and without a renderer,
// the integrity of the hand-authored override table, and the outward normal
// following rotation.

import { COMPONENTS } from '../src/data/components.js';
import * as THREE_REAL from 'three';
import { portWorldPosition, placeableCenterWorld } from '../src/utility/ports.js';
import {
  portAnchor3D,
  setModelBoundsProvider,
  setShellMeasureProvider,
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

console.log('\n--- 1. The headless fallback is the sim\'s own point ---');
{
  // Not "the anchor never moves" — with a renderer attached it moves onto the
  // shell, which is the entire feature. This is the narrower promise: with
  // NEITHER provider registered there is nothing to measure against, so the
  // lateral distance falls through to the footprint half-extent and the
  // longitudinal offset to zero, which reproduces `portWorldPosition` to the
  // bit. Registered explicitly rather than trusting module-load state, because
  // a provider left behind by an earlier import would silently turn this into
  // a different test.
  setModelBoundsProvider(null);
  setShellMeasureProvider(null);

  assert(utilityPorts.length > 20, `there are utility ports to check (${utilityPorts.length})`);

  // Every dir, not just 0: the fallback has to survive the rotation step too,
  // and dir 1/3 also swap the footprint, so an anchor that agreed at dir 0
  // could still be a quarter turn out of phase.
  const mismatched = [];
  for (const { type, def, name } of utilityPorts) {
    for (let dir = 0; dir < 4; dir++) {
      const p = place(type, { dir });
      const anchor = portAnchor3D(p, def, name);
      const pos = portWorldPosition(p, def, name);
      if (!pos) continue;
      if (!anchor || anchor.x !== pos.x || anchor.z !== pos.z) {
        mismatched.push(`${type}.${name}@${dir}`);
      }
    }
  }
  assert(mismatched.length === 0,
    'headless, every anchor x/z is exactly portWorldPosition at every dir '
    + `(${mismatched.slice(0, 5).join(',') || 'all match'})`);
}

console.log('\n--- 2. Every utility port resolves to a usable height ---');
{
  setModelBoundsProvider(null);   // headless: no renderer, no model bounds
  let unresolved = 0, bad = 0;
  for (const { type, def, name } of utilityPorts) {
    const anchor = portAnchor3D(place(type), def, name);
    if (!anchor) { unresolved++; continue; }
    // Utility poles deliberately terminate at crossarm height so the cable
    // renderer can hang conductors above the yard instead of along the floor.
    const maxY = type === 'transmissionTower' ? 18
      : type === 'utilityPole' ? 8 : 3;
    if (!(anchor.y > 0) || anchor.y > maxY) bad++;
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

{
  // Authoring a type means answering for ALL of its utility ports: a table
  // entry suppresses nothing, but an entry that names only `rf_in` and no
  // `_default` would leave its siblings on the derived height, which is the
  // very thing the entry was written to escape.
  const partial = [];
  for (const type of Object.keys(PORT_ANCHOR_OVERRIDES)) {
    const def = COMPONENTS[type];
    if (!def || !def.ports) continue;
    for (const [name, spec] of Object.entries(def.ports)) {
      if (!spec || !spec.utility) continue;
      const o = portAnchorOverride(type, name);
      if (!o || !Number.isFinite(o.y)) partial.push(`${type}.${name}`);
    }
  }
  assert(partial.length === 0,
    `an authored type answers for every one of its ports (${partial.join(',') || 'all covered'})`);

  // Heights are hand-authored per model, so nothing here can be checked
  // against geometry headless — but a typo'd metre is still catchable. The
  // portable spider box is intentionally ankle-height; nothing belongs below
  // its 0.1 m socket centre or above head height.
  const outOfBand = [];
  for (const [type, entry] of Object.entries(PORT_ANCHOR_OVERRIDES)) {
    for (const [port, spec] of Object.entries(entry)) {
      if (!spec || !Number.isFinite(spec.y)) continue;
      const maxY = type === 'transmissionTower' ? 18
        : type === 'utilityPole' ? 8 : 2.5;
      if (spec.y < 0.1 || spec.y > maxY) outOfBand.push(`${type}.${port}=${spec.y}`);
    }
  }
  assert(outOfBand.length === 0,
    `every authored height is within reach (${outOfBand.join(',') || 'all in band'})`);
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

// ---------------------------------------------------------------------------
// The measured contract.
//
// Everything below drives `cryomodule`, because it is the type the whole
// change was written for and the one where every failure mode is visible at
// once: subW 4 / subL 16 means a footprint of ±1.0 m laterally and ±4.0 m
// along, while the drawn cryostat is under half a metre wide — so a lateral
// number that came from the footprint is off by more than the machine's own
// radius. It carries four utility ports at three different heights and four
// different `offsetAlong` fractions (0.2 / 0.5 / 0.7 / 0.8), on both sides,
// which used to resolve to two points and now must resolve to four.
//
// The providers are fakes returning fixed numbers, so every expected position
// below is arithmetic anyone can check by hand rather than a golden value
// recorded from a run.
// ---------------------------------------------------------------------------

const CM = 'cryomodule';
const CM_DEF = COMPONENTS[CM];

// A 1 m wide, 7.2 m long, 2 m tall model inside that 2 x 8 m footprint.
const FAKE_BOUNDS = { minX: -0.5, maxX: 0.5, minY: 0, maxY: 2.0, minZ: -3.6, maxZ: 3.6 };
// What the fake raycast reports: the shell is 0.45 m off the axis, which is
// inside the model's own box (0.5) and less than half the footprint (1.0).
const SHELL = 0.45;

// bounds.minZ + 7.2 * offsetAlong, per port. Hand-computed, not derived.
const ALONG = { pwr_in: -2.16, cryo_in: 0, rf_in: 0.390625, vac_in: 1.44 };
// Straight out of PORT_ANCHOR_OVERRIDES.cryomodule (_default 1.15).
const Y = { pwr_in: 1.15, cryo_in: 0.7, rf_in: 1.0, vac_in: 1.15 };
// spec.side: left is local -x, right is local +x.
const SIGN = { pwr_in: -1, vac_in: -1, cryo_in: 1, rf_in: -1 };
const LAT = { pwr_in: SHELL, vac_in: SHELL, cryo_in: SHELL, rf_in: 0.76 };
const CM_PORTS = Object.keys(ALONG);

const TOL = 1e-9;
function near(a, b) { return Number.isFinite(a) && Math.abs(a - b) < TOL; }
function fmtA(a) { return a ? `(${a.x.toFixed(4)}, ${a.y.toFixed(4)}, ${a.z.toFixed(4)})` : 'null'; }

// Fake providers. `lastRequests` captures what the anchor layer asked the
// renderer to measure, which is as load-bearing as the answer: a request at
// the wrong height or the wrong point along the machine would measure a real
// surface and still put the connector in the wrong place.
let lastRequests = null;
function useProviders(bounds, surface) {
  setModelBoundsProvider(bounds ? () => bounds : null);
  setShellMeasureProvider(surface == null ? null : (type, requests) => {
    lastRequests = requests;
    const m = new Map();
    for (const r of requests) m.set(r.key, surface);
    return m;
  });
}

console.log('\n--- 4b. Pipe attachments share the rendered model centre ---');
{
  useProviders(FAKE_BOUNDS, SHELL);

  // ComponentBuilder.componentPose centres a pipe attachment at col*2+1,
  // row*2+1. Its footprint length must not be added a second time.
  const p = place(CM, { col: 2.25, row: 3.5, subCol: null, subRow: null, dir: 0 });
  const a = portAnchor3D(p, CM_DEF, 'cryo_in');
  const modelCentre = { x: p.col * 2 + 1, z: p.row * 2 + 1 };
  assert(near(a.x, modelCentre.x + SHELL),
    `pipe anchor is measured laterally from rendered centre (got ${fmtA(a)})`);
  assert(near(a.z, modelCentre.z + ALONG.cryo_in),
    `pipe anchor does not add half the ${CM_DEF.subL}-subtile footprint length`);

  // Rotation turns the local mount but never changes that same world centre.
  const turned = portAnchor3D({ ...p, dir: 1 }, CM_DEF, 'cryo_in');
  assert(near(turned.x, modelCentre.x - ALONG.cryo_in)
      && near(turned.z, modelCentre.z + SHELL),
    `rotated pipe anchor stays centred on the rendered component (got ${fmtA(turned)})`);

  // utility-endpoints uses a second record shape for the same attachment: it
  // marks isPlacement and supplies synthetic negative subtile offsets so the
  // 2D simulation position remains centred. Visual anchors must still use the
  // renderer's model centre, not interpret those offsets as a placed module's
  // top-left footprint origin (which shifts every marker 1 m left/up).
  const endpoint = {
    ...p,
    subCol: -CM_DEF.subW / 2,
    subRow: -CM_DEF.subL / 2,
    isPlacement: true,
  };
  const endpointAnchor = portAnchor3D(endpoint, CM_DEF, 'cryo_in');
  assert(near(endpointAnchor.x, modelCentre.x + SHELL)
      && near(endpointAnchor.z, modelCentre.z + ALONG.cryo_in),
    `utility endpoint record shares rendered centre (got ${fmtA(endpointAnchor)})`);
}

console.log('\n--- 5. With a renderer, the anchor lands on the measured shell ---');
{
  useProviders(FAKE_BOUNDS, SHELL);

  // Pin the frame first: everything below is centre + a local offset, so a
  // wrong centre would make four "exact" assertions agree with each other and
  // with nothing real.
  const centre = placeableCenterWorld(place(CM), CM_DEF);
  assert(near(centre.x, 7) && near(centre.z, 12),
    `the test placement's footprint centre is (7, 12) (got ${centre.x}, ${centre.z})`);

  const anchors = {};
  for (const port of CM_PORTS) anchors[port] = portAnchor3D(place(CM), CM_DEF, port);

  // What was asked of the renderer.
  const byKey = new Map((lastRequests || []).map(r => [r.key, r]));
  const badReq = CM_PORTS.filter((port) => {
    const r = byKey.get(port);
    return !r || r.axis !== 'x' || r.sign !== SIGN[port]
      || !near(r.y, Y[port]) || !near(r.along, ALONG[port]);
  });
  assert(badReq.length === 0,
    'the shell is measured on the port\'s own axis, at its authored height and '
    + `its own point along the machine (${badReq.join(',') || 'all four correct'})`);

  // And where the answer put the connector: 0.45 m out on the port's side,
  // `offsetAlong` of the model's 7.2 m length from its back end.
  for (const port of CM_PORTS) {
    const a = anchors[port];
    const wantX = 7 + SIGN[port] * LAT[port];
    const wantZ = 12 + ALONG[port];
    assert(a && near(a.x, wantX) && near(a.y, Y[port]) && near(a.z, wantZ),
      `cryomodule.${port} mounts at (${wantX}, ${Y[port]}, ${wantZ}) — got ${fmtA(a)}`);
  }

  // The sim uses the footprint for its longitudinal fraction while the
  // renderer uses measured model bounds.
  const sim = portWorldPosition(place(CM), CM_DEF, 'rf_in');
  assert(near(sim.x, 6) && near(sim.z, 11.6),
    `portWorldPosition uses the footprint edge and authored offset (${sim.x}, ${sim.z})`);
  assert(near(7 - anchors.rf_in.x, LAT.rf_in) && (7 - 6) > LAT.rf_in,
    'and the drawn RF anchor is inboard of it, on the visible coupler side');
}

console.log('\n--- 6. A connector never leaves the footprint, or enters the beam ---');
{
  // An absurd measurement — a ray that escaped through the model and hit
  // something in the next county — must not put a connector on a neighbouring
  // tile. The clamp lands it exactly back on the footprint edge, i.e. on the
  // sim's own point, which is the worst case and is still legal.
  useProviders(FAKE_BOUNDS, 99);
  for (const port of ['pwr_in', 'rf_in']) {
    const a = portAnchor3D(place(CM), CM_DEF, port);
    const wantX = port === 'rf_in'
      ? 7 + SIGN[port] * LAT[port]
      : 7 + SIGN[port] * 1.0;   // footprint half-extent, subW 4 * 0.25
    assert(near(a.x, wantX),
      `a 99 m surface clamps ${port} back to the footprint edge ${wantX} (got ${a.x})`);
  }

  // The opposite failure: a ray that slipped through a gap and hit the beam
  // pipe would bolt the connector to the machine's centreline. MIN_LATERAL
  // holds it out where a hand could reach it.
  useProviders(FAKE_BOUNDS, 0.001);
  const tight = portAnchor3D(place(CM), CM_DEF, 'cryo_in');
  assert(near(tight.x, 7.05),
    `a 1 mm surface is held out to MIN_LATERAL, x = 7.05 (got ${tight.x})`);

  // And the same for the longitudinal axis: a model reported longer than its
  // own footprint cannot push a connector into the next tile. minZ -50 /
  // maxZ 50 would put offsetAlong 0.2 at -30 m and 0.8 at +30 m; both clamp to
  // the footprint's ±4.0. With no measure provider the lateral falls to the
  // bounds edge (0.5) rather than the footprint, which is the middle rung of
  // the resolution order and is otherwise never exercised.
  useProviders({ ...FAKE_BOUNDS, minZ: -50, maxZ: 50 }, null);
  const back = portAnchor3D(place(CM), CM_DEF, 'pwr_in');
  const front = portAnchor3D(place(CM), CM_DEF, 'rf_in');
  assert(near(back.z, 8) && near(front.z, 12.390625),
    `a 100 m model keeps the ordinary port at the footprint end and RF on its authored window `
    + `(got ${back.z} and ${front.z})`);
  assert(near(back.x, 6.5) && near(front.x, 6.24),
    `with no raycast the ordinary lateral comes from the model box while RF keeps its window `
    + `(got ${back.x} and ${front.x})`);
}

console.log('\n--- 7. offsetAlong finally displaces along the machine ---');
{
  // The bug this half of the change fixes: `offsetAlong` is declared on nearly
  // every port and was never read, so cryo_in and rf_in resolved to
  // the same point on an 8 m machine — two connectors in the same place, four
  // metres from the coupler either belongs to.
  useProviders(null, null);
  const flatZ = CM_PORTS.map(p => portAnchor3D(place(CM), CM_DEF, p).z);
  assert(flatZ.some(z => z !== 12),
    `headless offsets use the simulation footprint (${flatZ.join(',')})`);

  useProviders(FAKE_BOUNDS, SHELL);
  const z = {};
  for (const port of CM_PORTS) z[port] = portAnchor3D(place(CM), CM_DEF, port).z;
  assert(new Set(CM_PORTS.map(p => z[p])).size === 4,
    `measured, the four ports take four distinct points along it (${CM_PORTS.map(p => z[p]).join(',')})`);
  assert(near(z.cryo_in, 12), `offsetAlong 0.5 is the middle of the model, z 12 (got ${z.cryo_in})`);
  assert(near(z.pwr_in, 9.84), `offsetAlong 0.2 is 2.16 m toward the back, z 9.84 (got ${z.pwr_in})`);
  assert(near(z.rf_in, 12.390625),
    `rf_in lands on the visible coupler window at z 12.390625 (got ${z.rf_in})`);
  assert(near(z.vac_in, 13.44), `offsetAlong 0.7 is 1.44 m toward the front, z 13.44 (got ${z.vac_in})`);
  assert(z.rf_in > z.cryo_in && z.rf_in < z.vac_in,
    'the RF inlet uses the first centre-adjacent window rather than the far end of the vessel');
}

console.log('\n--- 8. An authored mount beats the measurement ---');
{
  // The escape hatch for a model whose silhouette lies about where its hardware
  // is — a port over an open gap in the shell, where the ray hits nothing
  // useful. Authored here rather than in the shipped table (which deliberately
  // carries no lat/along yet) so the test owns its own data.
  const entry = PORT_ANCHOR_OVERRIDES[CM];
  const saved = entry.cryo_in;
  try {
    entry.cryo_in = { y: 0.7, lat: 0.3, along: -1.25 };
    useProviders(FAKE_BOUNDS, SHELL);   // re-registering also drops the cache
    const a = portAnchor3D(place(CM), CM_DEF, 'cryo_in');
    assert(a && near(a.x, 7.3) && near(a.y, 0.7) && near(a.z, 10.75),
      `an authored lat/along wins over the 0.45 m raycast and the 0.5 fraction: `
      + `(7.3, 0.7, 10.75) — got ${fmtA(a)}`);
    // Its neighbour, unauthored, is untouched by the entry.
    const rf = portAnchor3D(place(CM), CM_DEF, 'rf_in');
    assert(near(rf.x, 6.24) && near(rf.z, 12.390625),
      `and the port next to it still takes the measurement (${fmtA(rf)})`);
  } finally {
    if (saved) entry.cryo_in = saved; else delete entry.cryo_in;
    useProviders(null, null);
  }
}

console.log('\n--- 9. The mount is local: it turns with the placeable ---');
{
  // The measured offset is resolved once, in the unrotated frame, and rotated
  // at the end — so one cached mount serves all four rotations. rf_in is the
  // useful probe because both of its components are non-zero (0.45 out, 2.16
  // along), which is the only case where a wrong rotation is visible: a port
  // sitting on the axis would land in the same place under a transposed or
  // mirrored turn.
  useProviders(FAKE_BOUNDS, SHELL);
  const lat = LAT.rf_in, along = ALONG.rf_in;
  // Centres: dir 1/3 swap the footprint (4x16 sub-cells becomes 16x4), so the
  // centre itself moves. Offsets are the quarter turns of (lat, along) that
  // rotateCompass and the renderer's rotY = -dir * PI/2 both describe.
  const expect = [
    { c: [7, 12], o: [-lat, along] },
    { c: [10, 9], o: [-along, -lat] },
    { c: [7, 12], o: [lat, -along] },
    { c: [10, 9], o: [along, lat] },
  ];
  const seen = new Set();
  for (let dir = 0; dir < 4; dir++) {
    const { c, o } = expect[dir];
    const a = portAnchor3D(place(CM, { dir }), CM_DEF, 'rf_in');
    const centre = placeableCenterWorld(place(CM, { dir }), CM_DEF);
    assert(near(centre.x, c[0]) && near(centre.z, c[1]),
      `dir ${dir}: the footprint centre is (${c[0]}, ${c[1]}) (got ${centre.x}, ${centre.z})`);
    assert(a && near(a.x, c[0] + o[0]) && near(a.z, c[1] + o[1]) && near(a.y, Y.rf_in),
      `dir ${dir}: rf_in mounts at (${c[0] + o[0]}, ${Y.rf_in}, ${c[1] + o[1]}) — got ${fmtA(a)}`);
    seen.add(`${a.x},${a.z}`);
  }
  assert(seen.size === 4, `four rotations, four distinct anchors (${[...seen].join(' | ')})`);
}

console.log('\n--- 10. Every beamline RF sink lands on its visible inlet hardware ---');
{
  useProviders(null, null);
  const inletWindows = [
    ['ncRfGun', 0.63, 1.08, 0.02],
    ['srfGun', 0.76, 1.05, 0.38],
    ['ecrIonSource', -0.77, 1.05, -0.49],
    ['protonLinacFrontEnd', -0.92, 1.08, -1.25],
    ['positronSource', 0.72, 1.05, 0],
    ['buncher', 0.5, 1.2, 0],
    ['pillboxCavity', 0.5, 1.2, 0],
    ['rfCavity', 0.46, 1.2, 0],
    ['sbandStructure', 0.64, 1.35, 0.914],
    ['cbandStructure', -0.90, 1.0, -1.22],
    ['xbandStructure', 0, 1.42, -1.445],
    ['industrialLinac', -0.49, 1.05, -0.18],
    ['rfq', -1.0, 1.0, -0.77],
    ['dtl', -0.73, 1.12, -0.78],
    ['twoBeamModule', 0.385, 1.15, -4.76],
    ['halfWaveResonator', 0.75, 1.0, 0],
    ['spokeCavity', 0.75, 1.0, 0.465],
    ['ellipticalSrfCavity', 0.75, 1.0, -0.468],
    ['srf650Cryomodule', 1.0, 1.0, 0],
    ['srf805Cryomodule', 0.94, 1.0, 1.296],
    ['cryomodule', -0.76, 1.0, 0.390625],
    ['cwCryomodule', 0.95, 1.0, 0],
    ['nbSnCryomodule', 0.95, 1.0, 1.296],
    ['srfLinacSector', 0.90, 1.0, 0],
  ];
  const actualRfSinks = Object.entries(COMPONENTS).filter(([, def]) =>
    Object.values(def.ports || {}).some(port =>
      port.utility === 'rfWaveguide' && port.role === 'sink'));
  assert(inletWindows.length === actualRfSinks.length,
    `the inlet audit covers all ${actualRfSinks.length} beamline RF sinks`);
  for (const [type, localX, y, localZ] of inletWindows) {
    const def = COMPONENTS[type];
    const p = place(type, { col: 0, row: 0, subCol: null, subRow: null, dir: 0 });
    const centre = { x: 1, z: 1 };
    const anchor = portAnchor3D(p, def, 'rf_in');
    assert(anchor && near(anchor.x, centre.x + localX)
        && near(anchor.y, y) && near(anchor.z, centre.z + localZ),
      `${type}.rf_in sits on its visible inlet hardware (${fmtA(anchor)})`);
  }
}

console.log('\n--- 11. Every real component port lands on rendered geometry ---');
{
  // The synthetic sections above prove the coordinate arithmetic. This pass
  // supplies the real renderer and asks every declared utility port on every
  // component to resolve against its actual model. It catches the production
  // failure a fake fixed-radius provider cannot: a requested point can fall in
  // a gap, after which a model-wide bounding box leaves the fitting floating.
  class FakeTextureLoader {
    load() { return new THREE_REAL.Texture(); }
  }
  globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') return {};
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            createRadialGradient() { return { addColorStop() {} }; },
            fillRect() {},
            fillStyle: null,
          };
        },
      };
    },
  };

  const { getModelBounds, measureShellSurfaces } = await import(
    '../src/renderer3d/component-builder.js'
  );
  const measured = new Map();
  setModelBoundsProvider(getModelBounds);
  setShellMeasureProvider((type, requests) => {
    const result = measureShellSurfaces(type, requests);
    for (const req of requests) measured.set(`${type}.${req.key}`, result.get(req.key));
    return result;
  });

  const unresolved = [];
  const unmeasured = [];
  let recovered = 0;
  for (const { type, def, name } of utilityPorts) {
    const anchor = portAnchor3D(place(type), def, name);
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)
        || !Number.isFinite(anchor.z)) {
      unresolved.push(`${type}.${name}`);
    }
    const surface = measured.get(`${type}.${name}`);
    const usable = Number.isFinite(surface)
      || (surface && Number.isFinite(surface.lat)
        && Number.isFinite(surface.y) && Number.isFinite(surface.along));
    if (!usable) unmeasured.push(`${type}.${name}`);
    if (surface && typeof surface === 'object') recovered++;
  }
  assert(unresolved.length === 0,
    `all ${utilityPorts.length} real-geometry anchors are finite `
    + `(${unresolved.slice(0, 5).join(',') || 'all resolve'})`);
  assert(unmeasured.length === 0,
    `all ${utilityPorts.length} ports hit a rendered shell directly or nearby `
    + `(${unmeasured.slice(0, 5).join(',') || 'all attached'})`);
  assert(recovered > 0, `the audit exercised missed-ray recovery (${recovered} recovered)`);

  // Penning's exit pipe lengthens the overall Z bounds beyond its magnet
  // yoke. Both front-biased side ports used to request that empty extension;
  // the lateral fallback then drew them away from the chassis. Recovery must
  // keep their service height, move them back along the source, and prefer the
  // broad yoke over the skinny beam support beside it.
  for (const name of ['cool_in', 'vac_in']) {
    const surface = measured.get(`penningIonSource.${name}`);
    assert(surface && typeof surface === 'object'
        && Math.abs(surface.y - 0.792) < 1e-3
        && surface.along < 0.3
        && surface.lat > 0.4,
    `Penning ${name} recovers onto the magnet yoke (${JSON.stringify(surface)})`);
  }
}

// Leave the module as it was found: these providers are process-global, and a
// future import of this file must not inherit either fakes or renderer state.
useProviders(null, null);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
