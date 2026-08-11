// test/browser/unwired-affordance.spec.mjs — scratch spec for the Phase 11b-3
// unwired-sink affordances. Drives the real app: boots a game, places a
// beamline component that declares hard-required sinks and wires nothing, then
// checks that (a) the renderer draws one in-world marker per unwired sink,
// (b) the HUD blocker panel lists the offender, and (c) clicking that row
// frames the camera on it.
//
// NOT part of the committed suite unless the harness owner adopts it — it is
// the evidence for the phase, kept here so it runs under the same config.

import { test, expect } from '@playwright/test';
import { bootFreshGame, createErrorCollector, frames } from './helpers.mjs';

test('unwired sinks get in-world markers and a click-to-locate blocker row', async ({ page }) => {
  const errors = createErrorCollector(page);
  await bootFreshGame(page);
  await page.evaluate(() => window.dev.enable());

  // Place a source + a dump through the game API (this spec is about the
  // affordances, not the placement gestures — smoke.spec covers those).
  const built = await page.evaluate(() => {
    const g = window.game;
    g.state.resources.funding = 1e9;
    const area = window.__bt.findClearArea(14, 8);
    const col = area.col + 2, row = area.row + 2;
    for (let c = col - 2; c < col + 12; c++) {
      for (let r = row - 2; r < row + 5; r++) g.placeInfraTile(c, r, 'concrete');
    }
    const a = g.placePlaceable({ type: 'source', col, row, dir: 0 });
    const b = g.placePlaceable({ type: 'faradayCup', col: col + 8, row, dir: 0 });
    return { a, b, col, row };
  });
  expect(built.a, 'source placed').toBeTruthy();

  await page.evaluate(() => window.game.refreshInfrastructureGate());
  await frames(page, 3);

  const info = await page.evaluate(() => {
    const r = window._renderer;
    const s = window.game.state;
    const unwired = (s.infraBlockers || []).filter(b => b.fromUnconnectedCheck);
    const grp = r.unwiredSinkGroup.children[0];
    return {
      unwired: unwired.length,
      markerGroups: r.unwiredSinkGroup.children.length,
      markers: grp ? grp.children.length : 0,
      rows: document.querySelectorAll('#infra-blocker-panel > div').length,
      panelVisible: !!document.getElementById('infra-blocker-panel')
        && document.getElementById('infra-blocker-panel').style.display !== 'none',
      header: document.querySelector('#infra-blocker-panel > div')?.textContent,
    };
  });
  expect(info.unwired, 'the gate reports unwired sinks').toBeGreaterThan(0);
  expect(info.markerGroups, 'one marker group in the scene').toBe(1);
  expect(info.markers, 'one in-world marker per unwired sink').toBe(info.unwired);
  expect(info.panelVisible, 'blocker panel is shown').toBe(true);
  expect(info.header).toContain('UNWIRED SINK');
  // header + at least one offender row
  expect(info.rows).toBeGreaterThan(1);

  // The panel must clear the top bar and the facility overview above it.
  const placed = await page.evaluate(() => {
    const p = document.getElementById('infra-blocker-panel').getBoundingClientRect();
    const bar = document.getElementById('top-bar').getBoundingClientRect();
    return { panelTop: p.top, barBottom: bar.bottom };
  });
  expect(placed.panelTop, 'blocker panel clears the top bar').toBeGreaterThanOrEqual(placed.barBottom);

  // Rebuild guard: a second refresh with an unchanged blocker set must reuse
  // the existing marker group rather than tearing it down.
  const stable = await page.evaluate(() => {
    const r = window._renderer;
    const before = r.unwiredSinkGroup.children[0];
    r._refreshUnwiredSinkMarkers();
    return r.unwiredSinkGroup.children[0] === before;
  });
  expect(stable, 'unchanged blocker set does not rebuild the markers').toBe(true);

  // Click-to-locate: park the camera far away, click the first offender row,
  // and confirm the animation lands on the offender's port.
  const moved = await page.evaluate(async () => {
    const r = window._renderer;
    r._panX = 400; r._panY = 400; r._updateCameraLookAt();
    const row = document.querySelectorAll('#infra-blocker-panel > div')[1];
    row.click();
    await new Promise(res => setTimeout(res, 900));
    return { panX: r._panX, panY: r._panY, zoom: r.zoom, focusing: r._focusing,
             toX: r._focusToX, toY: r._focusToY };
  });
  expect(moved.focusing, 'focus animation finished').toBe(false);
  expect(Math.abs(moved.panX - moved.toX), 'camera landed on the offender X').toBeLessThan(0.01);
  expect(Math.abs(moved.panY - moved.toY), 'camera landed on the offender Z').toBeLessThan(0.01);
  expect(moved.zoom, 'framed in close enough to see it').toBeGreaterThanOrEqual(3);

  // Manual pan must cancel an in-flight focus.
  const cancelled = await page.evaluate(async () => {
    const r = window._renderer;
    r.focusOnWorld(-200, -200);
    r.panScreenAligned(1, 0);
    return r._focusing;
  });
  expect(cancelled, 'manual pan cancels the focus animation').toBe(false);

  // Wiring the sinks away must clear the markers and hide the panel.
  const cleared = await page.evaluate(async () => {
    const g = window.game;
    g.state.infraBlockers = [];
    g.emit('infrastructureValidated');
    g.state.infraCanRun = true;
    window._renderer.ui._updateBeamSummary();
    await new Promise(res => requestAnimationFrame(res));
    const p = document.getElementById('infra-blocker-panel');
    return { markerGroups: window._renderer.unwiredSinkGroup.children.length,
             panelVisible: p.style.display !== 'none' };
  });
  expect(cleared.markerGroups, 'markers gone once nothing is unwired').toBe(0);
  expect(cleared.panelVisible, 'panel hidden once nothing is blocked').toBe(false);

  errors.checkAll('unwired affordances');
});
