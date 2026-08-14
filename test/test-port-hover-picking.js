// test/test-port-hover-picking.js — you grab the port you can SEE.
//
// The renderer draws every port fitting, dot and cable end at portAnchor3D:
// bolted to the side of the machine, typically a metre or two off the floor.
// The sim's own answer, portWorldPosition, is flat on the tile footprint —
// and for on-pipe hardware the footprint is the reserved beam corridor, which
// is far wider than the machine sitting in it. The two disagree by metres
// (measured: 3.7 m on a cwCryomodule, 4.9 m on a srfLinacSector).
//
// Hit-testing on the ground plane therefore aimed at the port's SHADOW. The
// player had to hover bare floor underneath a connector to grab it, which is
// what made connectors read as detached from the hardware they bolt to.
//
// So the hit test projects each candidate anchor through the live camera and
// measures in pixels. This file defends three things:
//
//   1. Given a screen position, picking goes through the projection and picks
//      by pixel distance — a port whose ANCHOR is under the cursor wins over
//      one whose ground shadow is, which is the exact inversion of the bug.
//   2. The radius is a pixel budget, so it does not shrink as the camera
//      zooms out. A world-space radius silently got stricter as you zoomed.
//   3. With no screen position (headless, synthetic gestures) it falls back to
//      the original ground-plane test, byte-identical. The rest of the suite
//      drives the controller without a mouse and must not change behaviour.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { UtilityLineInputController } from '../src/input/UtilityLineInputController.js';
import { portWorldPosition } from '../src/utility/ports.js';
import { portAnchor3D } from '../src/utility/port-anchors.js';
import { findUtilityEndpoint } from '../src/utility/utility-endpoints.js';
import { gridToIso } from '../src/renderer/grid.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// One MCC plus a west->east pipe carrying quadrupoles. The quad is the case
// that matters: an ON-PIPE component, whose footprint is the reserved beam
// corridor and therefore nothing like the size of the machine in it. That gap
// is what put the grab target metres from the fitting.
function makeGame() {
  const g = new Game(new BeamlineRegistry(), { seed: 7 });
  g.state.resources.funding = 1e9;
  g.state.placeables.push({
    id: 'src_1', type: 'mcc', kind: 'infrastructure',
    category: 'infrastructure', col: 1, row: 1, subCol: 0, subRow: 0, dir: 0,
  });
  g.state.beamPipes.push({
    id: 'bp_1', subL: 80, start: null, end: null,
    path: [{ col: 0, row: 5 }, { col: 20, row: 5 }],
    placements: [0.1, 0.3, 0.5, 0.85].map((position, i) => ({
      id: `pl_${i + 1}`, type: 'quadrupole', position, subL: 2, params: {},
    })),
  });
  g._logs = [];
  g.log = (m, kind) => g._logs.push(`[${kind}] ${m}`);
  if (g.utilityLineSystem) g.utilityLineSystem.log = g.log;
  return g;
}

function portTile(game, placeableId, portName) {
  const ep = findUtilityEndpoint(game.state, placeableId);
  const p = portWorldPosition(ep, COMPONENTS[ep.type], portName);
  return { col: p.x / 2, row: p.z / 2 };
}

// Where the renderer actually draws the fitting, and where its shadow falls.
//
// Both are ASKED FOR rather than assumed. An earlier version of this file
// hardcoded "the anchor sits directly above the sim point, one metre up", which
// was only ever true by coincidence: anchors are measured against real model
// geometry, and on-pipe placements additionally carry the renderer's tile-centre
// offset, so the anchor is displaced horizontally too. When that offset was
// fixed the hardcoded pixels went stale and three assertions failed — reporting
// a regression in picking that did not exist. Deriving both points keeps this
// file about the PICKING RULE, which is the thing it is here to defend.
function anchorAndShadow(game, placeableId, portName) {
  const ep = findUtilityEndpoint(game.state, placeableId);
  const def = COMPONENTS[ep.type];
  const anchor = portAnchor3D(ep, def, portName);
  const sim = portWorldPosition(ep, def, portName);
  return { anchor, shadow: { x: sim.x, y: 0, z: sim.z } };
}

// A stub renderer whose projection we control exactly, so the assertions are
// about the PICKING rule and not about camera maths. `place` maps a 3D world
// point to a screen pixel; every test installs one that encodes the situation
// it wants to describe.
function stubRenderer(place) {
  return { worldToScreen: (x, y, z) => place(x, y, z) };
}

console.log('\n--- 1. The cursor grabs the port it is over, not the one whose shadow it is over ---');
{
  const game = makeGame();
  const ctrl = new UtilityLineInputController({
    game,
    // Anchors project to where their own y lifts them: a port a metre up
    // appears 100 px higher on screen than its ground shadow. This is the
    // whole geometry of the bug in one line.
    renderer: stubRenderer((x, y, z) => ({ x: x * 10, y: z * 10 - y * 100 })),
  });
  ctrl.setUtilityType('powerCable');

  const src = portTile(game, 'pl_2', 'pwr_in');
  const project = (p) => ({ x: p.x * 10, y: p.z * 10 - p.y * 100 });
  const { anchor, shadow } = anchorAndShadow(game, 'pl_2', 'pwr_in');

  // Where the fitting actually appears.
  const onPort = project(anchor);
  // Where the ground-plane test used to demand you aim.
  const onShadow = project(shadow);

  const iso = gridToIso(src.col, src.row);
  const gotPort = ctrl._snapToNearestPort(iso.x, iso.y, onPort);
  const gotShadow = ctrl._snapToNearestPort(iso.x, iso.y, onShadow);

  assert(gotPort && gotPort.portName === 'pwr_in',
    'hovering the drawn fitting grabs the port');
  assert(!gotShadow,
    'hovering the bare floor under it does NOT — the shadow is not the port');
}

console.log('\n--- 2. The grab radius is a pixel budget, so zoom does not change the feel ---');
{
  const game = makeGame();
  const src = portTile(game, 'pl_2', 'pwr_in');
  const iso = gridToIso(src.col, src.row);

  // Same scene at two zoom levels: the projection scale differs by 8x, but the
  // cursor sits the same number of PIXELS from the fitting in both. A
  // world-space radius would have accepted one and rejected the other.
  for (const scale of [4, 32]) {
    const ctrl = new UtilityLineInputController({
      game,
      renderer: stubRenderer((x, y, z) => ({ x: x * scale, y: z * scale - y * scale })),
    });
    ctrl.setUtilityType('powerCable');
    const { anchor } = anchorAndShadow(game, 'pl_2', 'pwr_in');
    const anchorPx = { x: anchor.x * scale, y: anchor.z * scale - anchor.y * scale };

    const near = ctrl._snapToNearestPort(iso.x, iso.y, { x: anchorPx.x + 26, y: anchorPx.y });
    const far = ctrl._snapToNearestPort(iso.x, iso.y, { x: anchorPx.x + 1000, y: anchorPx.y });
    assert(!!near, `26 px away still grabs at zoom scale ${scale}`);
    assert(!far, `a cursor far from every port does not grab at zoom scale ${scale}`);
  }
}

console.log('\n--- 2b. Crowded open ports still select the nearest connector ---');
{
  const game = makeGame();
  const endpoint = findUtilityEndpoint(game.state, 'src_1');
  const def = COMPONENTS[endpoint.type];
  const inAnchor = portAnchor3D(endpoint, def, 'pwr_out_1');
  const outAnchor = portAnchor3D(endpoint, def, 'pwr_out_2');
  const positions = new Map([
    [`${inAnchor.x}:${inAnchor.y}:${inAnchor.z}`, { x: 100, y: 100 }],
    [`${outAnchor.x}:${outAnchor.y}:${outAnchor.z}`, { x: 120, y: 100 }],
  ]);
  const ctrl = new UtilityLineInputController({
    game,
    renderer: stubRenderer((x, y, z) => positions.get(`${x}:${y}:${z}`) || { x: 1000, y: 1000 }),
  });
  ctrl.setUtilityType('powerCable');
  const iso = gridToIso(1, 1);
  const nearerOut = ctrl._snapToNearestPort(iso.x, iso.y, { x: 116, y: 100 });
  assert(nearerOut && nearerOut.portName === 'pwr_out_2',
    'overlapping magnetic targets choose the nearest open port');
}

console.log('\n--- 3. No screen position: the original ground-plane test, unchanged ---');
{
  const game = makeGame();
  const src = portTile(game, 'pl_2', 'pwr_in');
  const iso = gridToIso(src.col, src.row);

  // A renderer that would throw if consulted, proving the fallback path never
  // reaches for the projection when it has no pixel to compare against.
  const ctrl = new UtilityLineInputController({
    game,
    renderer: stubRenderer(() => { throw new Error('must not project without a screen point'); }),
  });
  ctrl.setUtilityType('powerCable');

  let got = null;
  let threw = null;
  try { got = ctrl._snapToNearestPort(iso.x, iso.y, undefined); } catch (e) { threw = e; }

  assert(!threw, 'picking without a screen point does not consult the projection');
  assert(got && got.portName === 'pwr_in',
    'and still finds the port by ground distance, as every headless caller expects');

  // And a renderer with no projection at all (the `{}` every existing test
  // passes) must behave the same even when a screen point IS supplied.
  const bare = new UtilityLineInputController({ game, renderer: {} });
  bare.setUtilityType('powerCable');
  const fromBare = bare._snapToNearestPort(iso.x, iso.y, { x: 0, y: 0 });
  assert(fromBare && fromBare.portName === 'pwr_in',
    'a renderer without worldToScreen falls back rather than failing to pick');
}

console.log('\n--- 4. The committed endpoint is still the sim position, not the anchor ---');
{
  // The anchor moves the HIT TEST only. What gets stored on the line has to
  // stay the sim's point, or the solver and the renderer disagree about where
  // the cable actually terminates.
  const game = makeGame();
  const ctrl = new UtilityLineInputController({
    game,
    renderer: stubRenderer((x, y, z) => ({ x: x * 10, y: z * 10 - y * 100 })),
  });
  ctrl.setUtilityType('powerCable');

  const src = portTile(game, 'pl_2', 'pwr_in');
  const ep = findUtilityEndpoint(game.state, 'pl_2');
  const simPos = portWorldPosition(ep, COMPONENTS[ep.type], 'pwr_in');
  const iso = gridToIso(src.col, src.row);
  const { anchor } = anchorAndShadow(game, 'pl_2', 'pwr_in');
  const onPort = { x: anchor.x * 10, y: anchor.z * 10 - anchor.y * 100 };

  const got = ctrl._snapToNearestPort(iso.x, iso.y, onPort);
  assert(got && Math.abs(got.worldPos.x - simPos.x) < 1e-9
             && Math.abs(got.worldPos.z - simPos.z) < 1e-9,
    'worldPos on the snap is portWorldPosition, untouched by the projected pick');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
