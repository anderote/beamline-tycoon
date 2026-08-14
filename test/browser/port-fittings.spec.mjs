// test/browser/port-fittings.spec.mjs — the connectors are ON the machine.
//
// This is the one invariant in the port-anchor change that cannot be checked
// headless, because the thing being asserted is a measurement of geometry that
// only exists once THREE has built the model. The node suite
// (test/test-port-anchors.js) proves the arithmetic against fake providers;
// only a browser can prove it against the real cryostat.
//
// ── The bug it defends against ─────────────────────────────────────────────
// A utility port used to be drawn at the edge of the component's TILE
// FOOTPRINT. For an on-pipe module the footprint is the reserved beam
// corridor, not the machine: an SRF cryomodule declares subW 4, a 2 m
// corridor, so every port resolved to exactly 1.0 m from the beam axis while
// the drawn cryostat is barely half that. Fittings, unwired pins and cable
// ends all hung in mid-air over bare floor beside the machine they belonged
// to. Worse, `offsetAlong` — declared on every one of these ports — was never
// read, so all four connectors landed on the same face midpoint, metres from
// the coupler or the transfer line each one names.
//
// No headless test could see either: the numbers were correct, they were just
// the sim's numbers rather than the model's.
//
// ── What is asserted ───────────────────────────────────────────────────────
// Place a real cryomodule on a real beam pipe, let the renderer build the real
// fittings, then read them back out of `_renderer.portFittingGroup` and undo
// the placement's rotation so everything is in the component's own frame:
//
//   * laterally — each fitting is within the drawn silhouette on ITS OWN side
//     (the model is not symmetric: the coupler row stands out further on +X
//     than the shell does on -X), and is well inboard of the footprint edge
//     the old code used;
//   * longitudinally — the four ports sit at the four distinct points their
//     `offsetAlong` fractions map onto the model's measured length, and each
//     one is matched back to the port that asked for it;
//   * orientation — a fitting faces squarely out of the flank its port
//     declares, which is what makes it read as bolted on rather than embedded.
//
// Every expected bound comes from `getModelBounds` for the type at runtime.
// Nothing here hard-codes a measurement, so a builder that reshapes its
// cryostat moves the goalposts with it and this spec keeps meaning the same
// thing.
//
// ── Why srf650Cryomodule and not the TESLA `cryomodule` ────────────────────
// It is the same machine one rung up the ladder, with the same four ports on
// the same two flanks, and it has a real role builder (_srfCryomoduleRoles,
// "beam along +Z") so the model it draws is the model this spec can measure.
// The TESLA `cryomodule` entry has no role builder and no parts list, so it
// falls through to component-builder's `geometryType: 'cylinder'` fallback —
// which lays its cylinder along local X while the footprint runs along Z, i.e.
// the drawn shape is crosswise to its own footprint. That is a pre-existing
// modelling gap, not an anchor bug, and pinning this spec to it would test the
// gap rather than the anchors. See the note at the bottom of this file.

import { test, expect } from '@playwright/test';
import {
  bootFreshGame, createErrorCollector, expectRendererLive, autoAcceptDialogs, frames,
} from './helpers.mjs';

const TYPE = 'srf650Cryomodule';

// How far inside the footprint edge a connector has to be before we believe it
// is on the machine rather than beside it. The failure this spec exists to
// catch puts it exactly ON the edge, so any real margin separates the two;
// 0.15 m leaves room for a future cryostat to grow without going slack.
const INBOARD_MARGIN = 0.15;

test('utility port fittings sit on the model, not on the footprint edge', async ({ page }) => {
  const errors = createErrorCollector(page);
  autoAcceptDialogs(page);

  await bootFreshGame(page);
  await expectRendererLive(page);
  errors.check('boot');

  // Dev funds and an empty map: generation scatters ~1k trees and rocks, and
  // the junctions below need open ground. Same move render-placement.spec.mjs
  // makes.
  await page.evaluate(() => {
    window.dev.enable();
    const g = window.game;
    for (const id of g.state.placeables.map(p => p.id)) g.removePlaceable(id);
  });
  await page.evaluate(() => window._renderer.refresh());
  await frames(page, 3);
  errors.check('clear the map');

  // A cryomodule is role:'placement' — it lives inside a beam pipe, not on the
  // grid, so Game.placePlaceable correctly refuses it. Build the pipe first,
  // exactly as render-placement.spec.mjs does.
  const built = await page.evaluate((type) => {
    const g = window.game;
    const col = -20;
    const src = g.beamline.placeJunction({ type: 'source', col, row: -20, dir: 0, free: true });
    const cup = g.beamline.placeJunction({ type: 'faradayCup', col, row: 5, dir: 0, free: true });
    if (!src || !cup) return null;
    const path = [];
    for (let r = -19.5; r <= 5; r += 0.25) path.push({ col, row: r });
    const pipeId = g.beamline.drawPipe(
      { junctionId: src, portName: 'exit' },
      { junctionId: cup, portName: 'entry' },
      path,
    );
    if (!pipeId) return null;
    // free: the module is gated behind srfTechnology, and this spec is about
    // where its connectors land, not about the tech tree.
    const id = g.beamline.placeOnPipe(pipeId, {
      type, position: 0.5, mode: 'snap', free: true,
    });
    return id ? { pipeId, id } : null;
  }, TYPE);
  expect(built, 'the cryomodule was placed on the scratch pipe').toBeTruthy();

  await frames(page, 3);
  errors.check('place the cryomodule');

  // Everything the assertions need, read out of the live scene in one pass.
  const probe = await page.evaluate(async ([placementId, type]) => {
    const [{ COMPONENTS }, ports, builder, endpoints] = await Promise.all([
      import('/src/data/components.js'),
      import('/src/utility/ports.js'),
      import('/src/renderer3d/component-builder.js'),
      import('/src/utility/utility-endpoints.js'),
    ]);
    const r = window._renderer;
    const def = COMPONENTS[type];
    // A pipe placement is not in state.placeables — it lives inside its pipe,
    // and listUtilityEndpoints is what flattens it into a placeable-like
    // record. That record is also exactly what the fitting builder was handed.
    const ep = endpoints.listUtilityEndpoints(window.game.state)
      .find(e => e.id === placementId);
    if (!ep) return { error: 'placement is not a utility endpoint' };

    const centre = ports.placeableCenterWorld(ep, def);
    const half = ports.footprintHalfExtents(def);
    const bounds = builder.getModelBounds(type);
    if (!bounds) return { error: 'the model has no measurable bounds' };
    const dir = ((ep.dir | 0) % 4 + 4) % 4;

    // Undo the placement's quarter turn, so every number below is in the
    // component's own frame: +x across the machine, +z along it — the same
    // frame getModelBounds reports in. Inverse of ports.rotateLocalOffset.
    const unrotate = (wx, wz) => {
      switch (dir) {
        case 1: return { x: wz, z: -wx };
        case 2: return { x: -wx, z: -wz };
        case 3: return { x: -wz, z: wx };
        default: return { x: wx, z: wz };
      }
    };

    r.scene.updateMatrixWorld(true);
    const all = [];
    for (const mesh of r.portFittingGroup.children) {
      const p = mesh.getWorldPosition(new window.THREE.Vector3());
      const local = unrotate(p.x - centre.x, p.z - centre.z);
      // Fitting geometry is authored facing local +X, so the mesh's own
      // rotated +X is the direction the connector points.
      const n = new window.THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion);
      const nl = unrotate(n.x, n.z);
      all.push({
        y: p.y,
        lat: local.x, along: local.z,
        normalLat: nl.x, normalAlong: nl.z,
      });
    }
    // Only this machine's own fittings: the pipe's two end junctions carry
    // theirs too, tens of metres away up and down the beamline. The window is
    // the footprint plus half a metre, so a fitting that HAD landed out on the
    // floor at the footprint edge is still caught by it rather than quietly
    // filtered out of the run.
    const mine = all.filter(f => Math.abs(f.lat) <= half.x + 0.5
                                 && Math.abs(f.along) <= half.z + 0.5);

    // What the ports declare, and where offsetAlong should map to on the
    // measured model. Same footprint clamp the anchor layer applies.
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const declared = Object.entries(def.ports)
      .filter(([, s]) => s && s.utility)
      .map(([name, s]) => ({
        name,
        side: s.side,
        offsetAlong: s.offsetAlong,
        wantAlong: clamp(
          bounds.minZ + (bounds.maxZ - bounds.minZ) * s.offsetAlong,
          -half.z, half.z,
        ),
      }));

    return { dir, centre, half, bounds, declared, fittings: mine, totalFittings: all.length };
  }, [built.id, TYPE]);

  expect(probe.error, 'the probe resolved the placement and its model').toBeUndefined();

  // ── The subject is what we think it is ──
  // The premise of the whole spec: this machine reserves a corridor much wider
  // than the hardware inside it, and declares four ports at four different
  // fractions along it. If either stopped being true the assertions below
  // would go slack rather than fail, so they are stated up front.
  expect(probe.half.x, 'the cryomodule reserves a 2 m corridor').toBeCloseTo(1.0, 6);
  expect(probe.declared.length, 'it declares four utility ports').toBe(4);
  expect(
    new Set(probe.declared.map(d => d.offsetAlong)).size,
    'at four distinct points along itself',
  ).toBe(4);
  expect(
    probe.bounds.maxZ - probe.bounds.minZ,
    'and the model really does run the length of that corridor',
  ).toBeGreaterThan(probe.half.z);

  expect(probe.fittings.length, 'one fitting is drawn per declared utility port')
    .toBe(probe.declared.length);

  // ── Lateral: on the shell, not out on the floor ──
  // The bound is per side. The cryostat is not symmetric — the coupler row
  // stands proud on +X and the bare shell is closer in on -X — so a single
  // half-width would either be too loose on one flank or wrong on the other.
  for (const f of probe.fittings) {
    const lat = Math.abs(f.lat);
    const silhouette = f.lat > 0 ? probe.bounds.maxX : -probe.bounds.minX;
    expect(
      lat,
      `the fitting at y=${f.y.toFixed(2)} is inside the drawn silhouette on its own `
      + `flank (${lat.toFixed(3)} m out; the model reaches ${silhouette.toFixed(3)} m)`,
    ).toBeLessThanOrEqual(silhouette + 1e-6);

    // The regression itself: the old anchor put this at exactly half.x. A
    // fitting still out there is one drawn on bare floor.
    expect(
      lat,
      `and is well inboard of the ${probe.half.x} m footprint edge, where it used to be`,
    ).toBeLessThan(probe.half.x - INBOARD_MARGIN);

    // The opposite failure: a ray that slipped through the shell and hit the
    // beam pipe would bolt the connector to the machine's centreline.
    expect(lat, 'and is not sunk into the beam axis either')
      .toBeGreaterThanOrEqual(0.05 - 1e-6);
  }

  // ── Each fitting belongs to a specific port ──
  // Matched by its position along the machine, then checked against the flank
  // that port declares — so a pair of connectors that swapped sides, or a
  // fraction applied to the wrong axis, cannot pass by coincidence.
  const unmatched = [...probe.fittings];
  for (const d of probe.declared) {
    const i = unmatched.findIndex(f => Math.abs(f.along - d.wantAlong) < 1e-6);
    expect(
      i,
      `${d.name} (offsetAlong ${d.offsetAlong}) has a fitting at ${d.wantAlong.toFixed(3)} m `
      + `along the model — got [${unmatched.map(f => f.along.toFixed(3)).join(', ')}]`,
    ).toBeGreaterThanOrEqual(0);
    const [f] = unmatched.splice(i, 1);
    const wantSign = d.side === 'left' ? -1 : 1;
    expect(Math.sign(f.lat), `${d.name} is on its declared ${d.side} flank`).toBe(wantSign);
    expect(Math.sign(f.normalLat), `${d.name}'s connector faces outward`).toBe(wantSign);
    expect(Math.abs(f.normalAlong), `${d.name}'s connector faces squarely off the flank`)
      .toBeLessThan(1e-6);
  }
  expect(unmatched.length, 'every fitting was claimed by exactly one port').toBe(0);

  // And the failure this replaced: four ports that all resolved to the face
  // midpoint. Stated separately because the matching above would still pass if
  // three of the four fractions happened to map to the same metre.
  expect(
    new Set(probe.fittings.map(f => f.along.toFixed(4))).size,
    'no two connectors share a point along the machine',
  ).toBe(4);

  // ── Heights are the authored ones, on the shell ──
  for (const f of probe.fittings) {
    expect(f.y, 'every fitting is within reach on the shell').toBeGreaterThan(0.3);
    expect(f.y, 'and none is on the roof').toBeLessThan(2.5);
    expect(f.y, 'and none is above the model it is bolted to')
      .toBeLessThanOrEqual(probe.bounds.maxY + 1e-6);
  }

  await expectRendererLive(page);
  errors.checkAll('port fittings');
});

// ── Known gap, deliberately not asserted here ──────────────────────────────
// Components with no role builder, no DETAIL_BUILDERS entry and no `parts`
// list fall through to component-builder's `geometryType: 'cylinder'`
// fallback, which builds a cylinder of length `subL * 0.5` and then rotates it
// onto local X — while the footprint runs `subL` along local Z. The TESLA
// `cryomodule` is one of these: getModelBounds reports X +/-3.97 and Z +/-0.97
// on a footprint that is 1.0 wide and 4.0 long, i.e. the box is transposed
// relative to the frame the ports are resolved in. Two consequences for the
// anchors, both of which this spec would fail on if it used that type:
//   * the lateral falls back to the footprint edge (the raycast reports 3.97,
//     which clamps to 1.0), so its connectors are exactly where they were
//     before the change;
//   * `offsetAlong` maps across the model's WIDTH, spreading four ports over
//     1.9 m instead of the machine's 8 m.
// That is a modelling gap in the fallback builder, not an anchor bug — and
// none of it is reachable for a type that draws a real model.
