import { test, expect } from '@playwright/test';
import {
  bootFreshGame, createErrorCollector, expectRendererLive, frames,
} from './helpers.mjs';

test('long RF waveguides leave high ports on sloped doglegs and add supports', async ({ page }) => {
  const errors = createErrorCollector(page);
  await bootFreshGame(page);
  await expectRendererLive(page);

  const setup = await page.evaluate(async () => {
    window.dev.enable();
    const game = window.game;
    const area = window.__bt.findClearArea(14, 6);
    if (!area) return null;
    const sourceId = game.placePlaceable({
      type: 'pulsedKlystron', col: area.col + 1, row: area.row + 1,
      dir: 0, free: true, silent: true,
    });
    const busId = game.placePlaceable({
      type: 'waveguideManifold', col: area.col + 11, row: area.row + 1,
      dir: 0, free: true, silent: true,
    });
    const { wireUtility } = await import('/src/data/scenarios/scenario-wiring.js');
    const lineId = wireUtility(game, 'rfWaveguide',
      { id: sourceId, port: 'rf_out' }, { id: busId, port: 'bus_left' });
    if (!lineId) return null;
    game.emit('utilityLinesChanged', { utilityType: 'rfWaveguide' });
    return { lineId, sourceId, busId };
  });

  expect(setup, 'the long klystron-to-manifold run was created').not.toBeNull();
  await frames(page, 5);
  errors.check('build the RF run');

  const probe = await page.evaluate((lineId) => {
    const group = window._renderer.utilityLineGroup.children
      .find(child => child.userData?.lineId === lineId);
    if (!group) return null;
    const path = group.userData.visualEffects?.[0]?.path || [];
    let supports = 0;
    const supportRunLengths = [];
    group.traverse((object) => {
      if (!object.userData?.isUtilitySupport) return;
      supports++;
      supportRunLengths.push(object.userData.runLength);
    });
    const slopes = [];
    const verticals = [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const dy = Math.abs(b.y - a.y);
      const horizontal = Math.hypot(b.x - a.x, b.z - a.z);
      if (dy > 1e-4 && horizontal > 1e-4) slopes.push({ dy, horizontal });
      if (dy > 1e-4 && horizontal <= 1e-4) verticals.push({ dy });
    }
    return {
      supports,
      supportRunLengths,
      slopes,
      verticals,
      minY: Math.min(...path.map(point => point.y)),
      maxY: Math.max(...path.map(point => point.y)),
    };
  }, setup.lineId);

  expect(probe, 'the renderer built a line group').not.toBeNull();
  expect(probe.maxY, 'the guide starts at the klystron output cavity').toBeCloseTo(1.2, 2);
  expect(probe.minY, 'the guide settles onto its low deck run').toBeCloseTo(0.22, 2);
  expect(probe.slopes.length, 'both high ports receive visible sloped transitions')
    .toBeGreaterThanOrEqual(2);
  expect(probe.verticals, 'RF drops do not fall straight down a machine wall').toEqual([]);
  expect(probe.supports, 'the long deck run receives steel support frames').toBeGreaterThan(0);
  expect(probe.supportRunLengths.every(length => length >= 5),
    'supports are reserved for runs above the long-run threshold').toBe(true);
  errors.checkAll();
});

