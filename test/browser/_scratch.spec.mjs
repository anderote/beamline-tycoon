// TEMPORARY scratch probe — delete before finishing.
import { test, expect } from '@playwright/test';
import {
  bootFreshGame, frames, armPaletteTool, clickTile, clickWorld, dragTiles,
} from './helpers.mjs';

function portWorld(page, type, port) {
  return page.evaluate(async ([t, p]) => {
    const { portWorldPosition } = await import('/src/utility/ports.js');
    const { COMPONENTS } = await import('/src/data/components.js');
    const pl = window.game.state.placeables.find(x => x.type === t);
    return pl ? portWorldPosition(pl, COMPONENTS[t], p) : null;
  }, [type, port]);
}

test('scratch: probe power chain geometry + blockers', async ({ page }) => {
  test.setTimeout(600000);
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE.ERROR:', m.text()); });
  await bootFreshGame(page);
  await page.evaluate(() => window.dev.enable());
  const area = await page.evaluate(() => window.__bt.findClearArea(12, 12));
  console.log('AREA', JSON.stringify(area));
  await page.evaluate(a => window.__bt.centerOn(a.col + 6, a.row + 6, 0.8), area);
  await frames(page, 3);

  const srcTile = { col: area.col + 6, row: area.row + 2 };
  const cupTile = { col: area.col + 6, row: area.row + 10 };

  await armPaletteTool(page, 'beamline', 'source', 'component', 'source');
  await clickTile(page, srcTile.col, srcTile.row);
  await frames(page);
  await armPaletteTool(page, 'beamline', 'endpoint', 'component', 'faradayCup');
  await clickTile(page, cupTile.col, cupTile.row);
  await frames(page);
  await armPaletteTool(page, 'beamline', 'source', 'component', 'drift');
  await dragTiles(page, [srcTile.col, srcTile.row], [cupTile.col, cupTile.row], 10);
  await frames(page);
  await armPaletteTool(page, 'beamline', 'optics', 'component', 'quadrupole');
  await clickTile(page, srcTile.col, srcTile.row + 4);
  await frames(page);

  const sink = await portWorld(page, 'source', 'pwr_in');
  console.log('SOURCE pwr_in', JSON.stringify(sink));

  // Probe: place an mcc at the same aim the spec uses for the panel.
  await armPaletteTool(page, 'infra', 'power', 'facility', 'mcc');
  await clickWorld(page, sink.x - 6, sink.z);
  await frames(page);
  const mcc = await page.evaluate(() => {
    const p = window.game.state.placeables.find(x => x.type === 'mcc');
    return p ? { col: p.col, row: p.row, subCol: p.subCol, subRow: p.subRow, dir: p.dir } : null;
  });
  console.log('MCC placed', JSON.stringify(mcc));
  console.log('MCC pwr_out_1', JSON.stringify(await portWorld(page, 'mcc', 'pwr_out_1')));
  console.log('MCC hv_in', JSON.stringify(await portWorld(page, 'mcc', 'hv_in')));

  // Probe: transformer further west.
  await armPaletteTool(page, 'infra', 'power', 'facility', 'padMountTransformer');
  await clickWorld(page, sink.x - 14, sink.z);
  await frames(page);
  const xf = await page.evaluate(() => {
    const p = window.game.state.placeables.find(x => x.type === 'padMountTransformer');
    return p ? { col: p.col, row: p.row, subCol: p.subCol, subRow: p.subRow, dir: p.dir } : null;
  });
  console.log('XFMR placed', JSON.stringify(xf));
  console.log('XFMR hv_out_1', JSON.stringify(await portWorld(page, 'padMountTransformer', 'hv_out_1')));

  // Now wire everything via the API and report blockers.
  const out = await page.evaluate(async () => {
    const { wireUtility } = await import('/src/data/scenarios/scenario-wiring.js');
    const g = window.game;
    const find = t => g.state.placeables.find(p => p.type === t)?.id;
    const src = find('source'), cup = find('faradayCup');
    const panel = find('mcc'), xfmr = find('padMountTransformer');
    const srcP = g.getPlaceable(src);
    const pump = g.placePlaceable({ type: 'roughingPump', col: srcP.col + 3, row: srcP.row + 2 });
    const chiller = g.placePlaceable({ type: 'packageChiller', col: srcP.col + 3, row: srcP.row + 5 });
    const quad = g.state.beamPipes.flatMap(p => p.placements || []).find(a => a.type === 'quadrupole');
    const res = {};
    res.pump = pump; res.chiller = chiller; res.quad = quad?.id;
    res.hv = wireUtility(g, 'hvCable', { id: xfmr, port: 'hv_out_1' }, { id: panel, port: 'hv_in' });
    res.p1 = wireUtility(g, 'powerCable', { id: panel, port: 'pwr_out_1' }, { id: src, port: 'pwr_in' });
    res.p2 = wireUtility(g, 'powerCable', { id: panel, port: 'pwr_out_2' }, { id: cup, port: 'pwr_in' });
    res.p3 = wireUtility(g, 'powerCable', { id: panel, port: 'pwr_out_3' }, { id: pump, port: 'pwr_in' });
    res.p4 = wireUtility(g, 'powerCable', { id: panel, port: 'pwr_out_4' }, { id: chiller, port: 'pwr_in' });
    res.p5 = wireUtility(g, 'powerCable', { id: panel, port: 'pwr_out_5' }, { id: quad?.id, port: 'pwr_in' });
    res.v1 = wireUtility(g, 'vacuumPipe', { id: pump, port: 'vac_out' }, { id: src, port: 'vac_in' });
    res.v2 = wireUtility(g, 'vacuumPipe', { id: pump, port: 'vac_out' }, { id: cup, port: 'vac_in' });
    res.c1 = wireUtility(g, 'coolingWater', { id: chiller, port: 'cool_out' }, { id: src, port: 'cool_in' });
    res.c2 = wireUtility(g, 'coolingWater', { id: chiller, port: 'cool_out' }, { id: quad?.id, port: 'cool_in' });
    for (const m of g.state.staffMembers || []) {
      if (m.profession !== 'operator') continue;
      m.status = 'working'; m._restTimer = null;
      Object.assign(m.needs, { fatigue: 0, hunger: 0, morale: 1 });
    }
    g.tick();
    res.blockers = (g.state.infraBlockers || []).map(b => `${b.code}: ${b.message}`);
    res.canRun = g.state.infraCanRun;
    return res;
  });
  console.log('WIRE RESULT', JSON.stringify(out, null, 2));
  expect(out.canRun).toBe(true);
});
