// test/browser/unwired-affordance.spec.mjs — scratch spec for the Phase 11b-3
// utility-port issue affordances. Drives the real app: boots a game, places a
// beamline component that declares hard-required sinks and wires nothing, then
// checks that the renderer draws one in-world marker per unwired sink and the
// compact top-bar chip preserves a deduplicated explanation without opening a
// panel over the playfield.
//
// NOT part of the committed suite unless the harness owner adopts it — it is
// the evidence for the phase, kept here so it runs under the same config.

import { test, expect } from '@playwright/test';
import { bootFreshGame, createErrorCollector, frames } from './helpers.mjs';

test('unwired sinks get port issue markers and a compact fault chip', async ({ page }) => {
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
    return { a, b };
  });
  expect(built.a, 'source placed').toBeTruthy();

  await page.evaluate(() => window.game.refreshInfrastructureGate());
  await frames(page, 3);

  const info = await page.evaluate(() => {
    const r = window._renderer;
    const s = window.game.state;
    const unwired = Object.values(s.unwiredSinks || {})
      .reduce((sum, utilities) => sum + Object.keys(utilities || {}).length, 0);
    const grp = r.utilityPortIssueGroup.children[0];
    const chip = document.getElementById('beam-summary');
    return {
      unwired,
      markerGroups: r.utilityPortIssueGroup.children.length,
      markers: grp ? grp.children.length : 0,
      panelPresent: !!document.getElementById('infra-blocker-panel'),
      chipText: chip?.textContent,
      chipTitle: chip?.title,
      statsInTopBar: document.getElementById('top-bar')
        .contains(document.getElementById('beam-stats-panel')),
    };
  });
  expect(info.unwired, 'the gate reports unwired sinks').toBeGreaterThan(0);
  expect(info.markerGroups, 'one marker group in the scene').toBe(1);
  expect(info.markers, 'one in-world marker per unwired sink').toBe(info.unwired);
  expect(info.panelPresent, 'no blocker panel covers the playfield').toBe(false);
  expect(info.chipText).toContain('FAULT');
  expect(info.chipTitle).toContain('Beam tripped');
  expect(info.statsInTopBar, 'facility stats live inside the top bar').toBe(true);

  // Rebuild guard: a second refresh with an unchanged blocker set must reuse
  // the existing marker group rather than tearing it down.
  const stable = await page.evaluate(() => {
    const r = window._renderer;
    const before = r.utilityPortIssueGroup.children[0];
    r._refreshUtilityPortIssueMarkers();
    return r.utilityPortIssueGroup.children[0] === before;
  });
  expect(stable, 'unchanged blocker set does not rebuild the markers').toBe(true);

  const repeatedMessageCount = await page.evaluate(() => {
    window.game.pause();
    const message = 'Power network has no capacity.';
    window.game.state.infraCanRun = false;
    window.game.state.infraBlockers = [
      { severity: 'hard', message },
      { severity: 'hard', message },
    ];
    window._renderer.ui._updateBeamSummary();
    return document.getElementById('beam-summary').title.split(message).length - 1;
  });
  expect(repeatedMessageCount, 'identical fault explanations are listed once').toBe(1);

  // Clearing the blockers must clear the compact fault state.
  const cleared = await page.evaluate(async () => {
    const g = window.game;
    g.state.infraBlockers = [];
    g.emit('infrastructureValidated');
    g.state.infraCanRun = true;
    window._renderer.ui._updateBeamSummary();
    await new Promise(res => requestAnimationFrame(res));
    return {
      faultVisible: document.getElementById('beam-summary').classList.contains('fault'),
    };
  });
  expect(cleared.faultVisible, 'fault chip clears once nothing is blocked').toBe(false);

  errors.checkAll('unwired affordances');
});
