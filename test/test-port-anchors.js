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
import {
  portAnchorOverride,
  PORT_ANCHOR_OVERRIDES,
  POWER_HV_INPUT_MOUNTS,
} from '../src/data/utility-port-anchors.js';

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

  const transformerBank = [1, 2, 3, 4]
    .map(index => portAnchorOverride('hvTransformer', `hv_out_${index}`));
  assert(transformerBank.every(port => port.y === 1.45),
    'the four-output HV transformer presents one flat 1.45 m terminal row');
  assert(transformerBank.map(port => port.along).join(',') === '-0.75,-0.25,0.25,0.75',
    'the HV transformer matches the 4×4 wall feedthrough\'s 0.5 m terminal spacing');

  const actualPowerHvInputs = Object.entries(COMPONENTS).flatMap(([type, def]) =>
    def?.category === 'power'
      ? Object.entries(def.ports || {})
        .filter(([, port]) => port.utility === 'hvCable' && port.role === 'sink')
        .map(([portName]) => `${type}.${portName}`)
      : []);
  assert(actualPowerHvInputs.length === Object.keys(POWER_HV_INPUT_MOUNTS).length,
    `the Power HV mount standard covers all ${actualPowerHvInputs.length} inputs`);
  const nonStandardPowerInputs = actualPowerHvInputs.filter((key) => {
    const [type, portName] = key.split('.');
    const mount = portAnchorOverride(type, portName);
    const standard = POWER_HV_INPUT_MOUNTS[type];
    return !POWER_HV_INPUT_MOUNTS[type]
      || mount.y !== standard.y || mount.localX !== standard.localX
      || mount.localZ !== standard.localZ
      || !Number.isFinite(mount.localX) || !Number.isFinite(mount.localZ)
      || !mount.normal || !(mount.normal.y > 0.5 || mount.normal.z < -0.5);
  });
  assert(nonStandardPowerInputs.length === 0,
    `every Power HV input uses explicit upper insulated hardware (${nonStandardPowerInputs.join(',') || 'all covered'})`);
  const sectorBanks = [
    ['cwCryomodule', [0, -1.728, 1.728], [1.728, -1.728, 0]],
    ['nbSnCryomodule', [1.296, -1.296], [1.296, -1.296]],
    ['srfLinacSector', [0, -3.312, 3.312], [3.312, -3.312, 0]],
  ];
  for (const [type, rfAlong, vacuumAlong] of sectorBanks) {
    const rf = rfAlong.map((_, index) =>
      portAnchorOverride(type, index === 0 ? 'rf_in' : `rf_in_${index + 1}`));
    const vacuum = vacuumAlong.map((_, index) =>
      portAnchorOverride(type, index === 0 ? 'vac_in' : `vac_in_${index + 1}`));
    assert(rf.map(port => port.along).join(',') === rfAlong.join(','),
      `${type} RF anchors land on every rendered coupler`);
    assert(vacuum.map(port => port.along).join(',') === vacuumAlong.join(','),
      `${type} vacuum anchors are distributed along the sector`);
  }

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
const Y = { pwr_in: 1.15, cryo_in: 1.5, rf_in: 1.0, vac_in: 1.0 };
// spec.side: left is local -x, right is local +x.
const SIGN = { pwr_in: -1, vac_in: -1, cryo_in: 1, rf_in: -1 };
const LAT = { pwr_in: SHELL, vac_in: SHELL, cryo_in: 0.55, rf_in: 0.76 };
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
  assert(near(a.x, modelCentre.x + LAT.cryo_in),
    `pipe anchor uses its authored header mount from rendered centre (got ${fmtA(a)})`);
  assert(near(a.z, modelCentre.z + ALONG.cryo_in),
    `pipe anchor does not add half the ${CM_DEF.subL}-subtile footprint length`);

  // Rotation turns the local mount but never changes that same world centre.
  const turned = portAnchor3D({ ...p, dir: 1 }, CM_DEF, 'cryo_in');
  assert(near(turned.x, modelCentre.x - ALONG.cryo_in)
      && near(turned.z, modelCentre.z + LAT.cryo_in),
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
  assert(near(endpointAnchor.x, modelCentre.x + LAT.cryo_in)
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
  const tight = portAnchor3D(place(CM), CM_DEF, 'pwr_in');
  assert(near(tight.x, 6.95),
    `a 1 mm surface is held out to MIN_LATERAL, x = 6.95 (got ${tight.x})`);

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
    ['ncRfGun', 'rf_in', 0.63, 1.08, 0.02],
    ['srfGun', 'rf_in', 0.76, 1.05, 0.38],
    ['ecrIonSource', 'rf_in', -0.77, 1.05, -0.49],
    ['protonLinacFrontEnd', 'rf_in', -0.92, 1.08, -1.25],
    ['positronSource', 'rf_in', 0.72, 1.05, 0],
    ['buncher', 'rf_in', 0.5, 1.2, 0],
    ['pillboxCavity', 'rf_in', 0.5, 1.2, 0],
    ['rfCavity', 'rf_in', 0.46, 1.2, 0],
    ['sbandStructure', 'rf_in', 0.64, 1.35, 0.914],
    ['cbandStructure', 'rf_in', -0.90, 1.0, -1.22],
    ['xbandStructure', 'rf_in', 0, 1.42, -1.445],
    ['industrialLinac', 'rf_in', -0.49, 1.05, -0.18],
    ['rfq', 'rf_in', -1.0, 1.0, -0.77],
    ['dtl', 'rf_in', -0.73, 1.12, -0.78],
    ['twoBeamModule', 'rf_in', 0.385, 1.15, -4.76],
    ['halfWaveResonator', 'rf_in', 0.75, 1.0, 0],
    ['spokeCavity', 'rf_in', 0.75, 1.0, 0.465],
    ['ellipticalSrfCavity', 'rf_in', 0.75, 1.0, -0.468],
    ['srf650Cryomodule', 'rf_in', 1.0, 1.0, 0],
    ['srf805Cryomodule', 'rf_in', 0.94, 1.0, 1.296],
    ['cryomodule', 'rf_in', -0.76, 1.0, 0.390625],
    ['cwCryomodule', 'rf_in', 0.95, 1.0, 0],
    ['cwCryomodule', 'rf_in_2', 0.95, 1.0, -1.728],
    ['cwCryomodule', 'rf_in_3', 0.95, 1.0, 1.728],
    ['nbSnCryomodule', 'rf_in', 0.95, 1.0, 1.296],
    ['nbSnCryomodule', 'rf_in_2', 0.95, 1.0, -1.296],
    ['srfLinacSector', 'rf_in', 0.90, 1.0, 0],
    ['srfLinacSector', 'rf_in_2', 0.90, 1.0, -3.312],
    ['srfLinacSector', 'rf_in_3', 0.90, 1.0, 3.312],
  ];
  const actualRfSinks = Object.entries(COMPONENTS).flatMap(([type, def]) =>
    Object.entries(def.ports || {})
      .filter(([, port]) => port.utility === 'rfWaveguide' && port.role === 'sink')
      .map(([portName]) => `${type}.${portName}`));
  assert(inletWindows.length === actualRfSinks.length,
    `the inlet audit covers all ${actualRfSinks.length} beamline RF sinks`);
  for (const [type, portName, localX, y, localZ] of inletWindows) {
    const def = COMPONENTS[type];
    const p = place(type, { col: 0, row: 0, subCol: null, subRow: null, dir: 0 });
    const centre = { x: 1, z: 1 };
    const anchor = portAnchor3D(p, def, portName);
    assert(anchor && near(anchor.x, centre.x + localX)
        && near(anchor.y, y) && near(anchor.z, centre.z + localZ),
      `${type}.${portName} sits on its visible inlet hardware (${fmtA(anchor)})`);
  }
}

console.log('\n--- 10b. Every beamline cryogenic sink lands on authored service hardware ---');
{
  useProviders(null, null);
  const cryogenicMounts = [
    ['srfGun', 'cryo_in', 0, 1.84, -0.2, [0, 1, 0]],
    ['protonLinacFrontEnd', 'cryo_in', 0.87, 1.62, 1.15, [1, 0, 0]],
    ['finalFocusDoublet', 'cryo_in', 0, 1.72, -0.914, [0, 1, 0]],
    ['halfWaveResonator', 'cryo_in', 0, 2.30, 0, [0, 1, 0]],
    ['spokeCavity', 'cryo_in', 0, 2.45, 0.5952, [0, 1, 0]],
    ['ellipticalSrfCavity', 'cryo_in', 0, 1.68, 0, [0, 1, 0]],
    ['srf650Cryomodule', 'cryo_in', 0, 2.0, 0, [0, 1, 0]],
    ['srf805Cryomodule', 'cryo_in', 0, 1.89, 2.52, [0, 1, 0]],
    ['cryomodule', 'cryo_in', 0.55, 1.5, 0, [1, 0, 0]],
    ['cwCryomodule', 'cryo_in', 0, 1.885, 0, [0, 1, 0]],
    ['nbSnCryomodule', 'cryo_in', 0, 1.80, 0, [0, 1, 0]],
    ['srfLinacSector', 'cryo_in', -0.76, 1.294, 0, [-1, 0, 0]],
  ];
  const actualCryoSinks = Object.entries(COMPONENTS).flatMap(([type, def]) =>
    Object.entries(def.ports || {})
      .filter(([, port]) => port.utility === 'cryoTransfer' && port.role === 'sink')
      .map(([portName]) => `${type}.${portName}`));
  assert(cryogenicMounts.length === actualCryoSinks.length,
    `the cryogenic audit covers all ${actualCryoSinks.length} beamline sinks`);
  for (const [type, portName, localX, y, localZ, normal] of cryogenicMounts) {
    const def = COMPONENTS[type];
    const p = place(type, { col: 0, row: 0, subCol: null, subRow: null, dir: 0 });
    const anchor = portAnchor3D(p, def, portName);
    assert(anchor && near(anchor.x, 1 + localX) && near(anchor.y, y)
        && near(anchor.z, 1 + localZ)
        && near(anchor.out.x, normal[0]) && near(anchor.out.y, normal[1])
        && near(anchor.out.z, normal[2]),
      `${type}.${portName} uses its visible service mount and 3D normal (${fmtA(anchor)})`);
  }

  const vertical = portAnchor3D(
    place('halfWaveResonator', { col: 0, row: 0, subCol: null, subRow: null, dir: 3 }),
    COMPONENTS.halfWaveResonator,
    'cryo_in',
  );
  assert(vertical && near(vertical.out.x, 0) && near(vertical.out.y, 1)
      && near(vertical.out.z, 0),
    'a top-facing connector remains vertical through placeable rotation');
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

  // Cooling belongs low on the magnet yoke, while vacuum now requests the
  // beam-axis service band and therefore hits the actual chamber directly.
  const penningCooling = measured.get('penningIonSource.cool_in');
  assert(penningCooling && typeof penningCooling === 'object'
      && Math.abs(penningCooling.y - 0.6) < 1e-3
      && penningCooling.along < 0.3 && penningCooling.lat > 0.4,
  `Penning cooling recovers onto the low magnet yoke (${JSON.stringify(penningCooling)})`);
  const penningVacuum = measured.get('penningIonSource.vac_in');
  assert(Number.isFinite(penningVacuum) && penningVacuum > 0.05 && penningVacuum < 0.15,
    `Penning vacuum meets the beam-axis chamber directly (${penningVacuum})`);
}

// Leave the module as it was found: these providers are process-global, and a
// future import of this file must not inherit either fakes or renderer state.
useProviders(null, null);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
