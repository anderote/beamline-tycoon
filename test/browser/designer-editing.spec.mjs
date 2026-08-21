// test/browser/designer-editing.spec.mjs
//
// Regression coverage for the Beamline Designer's editing surface in
// pipe-graph edit mode (openFromSource).
//
// The defect this exists to catch: insertComponent used to open with
// `if (this.editSourceId && comp.placement !== 'attachment') return;` — a bare
// return with no log, no toast, no disabled styling. Measured against the real
// app that silently killed 18 of 27 palette cards in edit mode (Beam Pipe,
// every cavity, every source, every endpoint), while the SAME palette in
// sandbox mode accepted all of them. A player building a line could click Beam
// Pipe repeatedly and watch nothing happen.
//
// So the load-bearing assertion here is coverage, not a spot check: walk every
// category, click every visible card, and require each one to land in the
// draft. A unit test could not have caught it — the guard was reachable only
// through the real palette wiring.

import { test, expect } from '@playwright/test';
import { bootFreshGame, createErrorCollector, frames } from './helpers.mjs';

// Build a real beamline on the map and open the designer against its source,
// which is the mode the defect lived in. Returns the source placeable id.
async function openEditModeDesigner(page, { typeId = null } = {}) {
  await page.evaluate(() => window.dev.enable());
  await page.evaluate((beamlineTypeId) => {
    const g = window.game;
    g.state.resources.funding = 1e9;
    if (beamlineTypeId) g.startNewBeamline(beamlineTypeId);
    const area = window.__bt.findClearArea(16, 8);
    const col = area.col + 2, row = area.row + 2;
    for (let c = col - 2; c < col + 14; c++) {
      for (let r = row - 2; r < row + 5; r++) g.placeInfraTile(c, r, 'concrete');
    }
    g.placePlaceable({ type: 'source', col, row, dir: 0 });
  }, typeId);
  return page.evaluate(() => {
    const g = window.game;
    const entry = g.registry.getAll()[0];
    if (!entry || !entry.sourceId) return null;
    g._designer.openFromSource(entry.sourceId);
    return entry.sourceId;
  });
}

test('mission targets annotate performance plots without changing their scale', async ({ page }) => {
  const errors = createErrorCollector(page);
  await page.setViewportSize({ width: 1600, height: 950 });
  await bootFreshGame(page);

  const sourceId = await openEditModeDesigner(page, { typeId: 'ebeamProcessing' });
  expect(sourceId, 'typed beamline opened in the designer').toBeTruthy();
  await frames(page, 5);

  const layout = await page.evaluate(() => {
    const summary = document.getElementById('dsgn-plot-mission-summary');
    const panels = [...document.querySelectorAll('.dsgn-plot-panel')];
    return {
      largePanel: !!document.getElementById('dsgn-mission-panel'),
      greenMap: !!document.getElementById('dsgn-mission-map'),
      plotTypes: [...document.querySelectorAll('.dsgn-plot-select')].map(select => select.value),
      secondaryPlotTypes: [...document.querySelectorAll('.dsgn-plot-secondary-select')]
        .map(select => select.value),
      tertiaryPlotTypes: [...document.querySelectorAll('.dsgn-plot-tertiary-select')]
        .map(select => select.value),
      secondaryPlotOptions: [...(document.querySelector('.dsgn-plot-secondary-select')?.options || [])]
        .map(option => option.textContent.trim()),
      plotPanels: panels.length,
      plotRects: panels.map(panel => {
        const rect = panel.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      }),
      plotControlRects: panels.map(panel => {
        const rect = panel.querySelector('.dsgn-plot-options')?.getBoundingClientRect();
        return rect ? { top: rect.top, bottom: rect.bottom, height: rect.height } : null;
      }),
      plotCanvasRects: panels.map(panel => {
        const rect = panel.querySelector('.dsgn-plot-canvas')?.getBoundingClientRect();
        return rect ? { top: rect.top, bottom: rect.bottom, height: rect.height } : null;
      }),
      thirdPlotDisabled: document.querySelector('.dsgn-plot-select[data-panel="2"]')?.disabled,
      thirdPlotOptions: [...(document.querySelector('.dsgn-plot-select[data-panel="2"]')?.options || [])]
        .map(option => option.value),
      yScales: [...document.querySelectorAll('.dsgn-plot-scale-select')]
        .map(select => select.value),
      yScaleOptions: [...document.querySelectorAll('.dsgn-plot-scale-select')]
        .map(select => [...select.options].map(option => option.textContent)),
      reference: document.getElementById('dsgn-plot-reference-select')?.value,
      referenceOptions: [...(document.getElementById('dsgn-plot-reference-select')?.options || [])]
        .map(option => option.textContent),
      summaryText: summary?.textContent.replace(/\s+/g, ' ').trim() || '',
      summaryLabel: summary?.getAttribute('aria-label') || '',
      targets: [...(summary?.querySelectorAll('.dsgn-plot-mission-metric') || [])]
        .map(metric => metric.getAttribute('title')),
      projectedRevenue: summary?.querySelector('.dsgn-plot-mission-metric.revenue')
        ?.textContent.replace(/\s+/g, ' ').trim() || '',
      projectedRevenueFontSize: parseFloat(getComputedStyle(
        summary?.querySelector('.dsgn-plot-mission-metric.revenue strong'),
      ).fontSize || '0'),
      assignedType: window.game.registry.getBySourceId(window.game._designer.editSourceId)?.typeId,
    };
  });

  expect(layout.assignedType).toBe('ebeamProcessing');
  expect(layout.largePanel, 'the oversized mission panel is gone').toBe(false);
  expect(layout.greenMap, 'the separate green target map is gone').toBe(false);
  expect(layout.plotPanels, 'three plots share the performance row').toBe(3);
  expect(layout.plotTypes).toEqual(['beam-envelope', 'bunch-evolution', 'eic-triangle']);
  expect(layout.secondaryPlotTypes).toEqual(['current-loss', 'peak-current']);
  expect(layout.tertiaryPlotTypes).toEqual(['emittance', 'beam-power']);
  expect(layout.secondaryPlotOptions).toEqual([
    'CH-2 // None', 'Beam Power', 'Beam β', 'Beam Envelope', 'Beam Current',
    'Twiss βx / βy', 'Phase Advance μx / μy', 'Magnetic Rigidity', 'Emittance', 'Peak Current',
  ]);
  expect(new Set(layout.plotRects.map(rect => rect.top)).size,
    'all plot panels begin on the same row').toBe(1);
  expect(layout.plotRects[0].left).toBeLessThan(layout.plotRects[1].left);
  expect(layout.plotRects[1].left).toBeLessThan(layout.plotRects[2].left);
  expect(Math.max(...layout.plotRects.map(rect => rect.width))
    - Math.min(...layout.plotRects.map(rect => rect.width)),
  'the three plot columns are equal width').toBeLessThanOrEqual(1);
  expect(layout.plotControlRects.every((rect, index) => rect
    && layout.plotCanvasRects[index]
    && rect.bottom <= layout.plotCanvasRects[index].top),
  'each plot control row sits above rather than on top of its canvas').toBe(true);
  expect(layout.thirdPlotDisabled, 'the right plot selector is interactive').toBe(false);
  expect(layout.thirdPlotOptions).toEqual([
    'beam-envelope', 'current-loss', 'emittance', 'beta-acceptance', 'beam-power',
    'bunch-evolution', 'peak-current', 'longitudinal', 'twiss-beta', 'phase-advance',
    'rigidity', 'phase-space', 'eic-triangle',
  ]);
  expect(layout.yScales).toEqual(['linear', 'linear', 'linear']);
  expect(layout.yScaleOptions).toEqual([
    ['Lin', 'Log'], ['Lin', 'Log'], ['Lin', 'Log'],
  ]);
  expect(layout.reference).toBe('mission');
  expect(layout.referenceOptions).toEqual(['Mission Target', 'None']);
  expect(layout.summaryText).toContain('E-beam Processing Line');
  expect(layout.summaryText).toContain('Energy');
  expect(layout.summaryText).toContain('Current');
  expect(layout.summaryText).toContain('Beam power');
  expect(layout.summaryText).toContain('Quality');
  expect(layout.summaryText).toContain('Est. revenue');
  expect(layout.projectedRevenue).toContain('Est. revenue');
  expect(layout.projectedRevenueFontSize).toBeGreaterThanOrEqual(14);
  expect(layout.summaryLabel).toContain('target 3.00 MeV–12.0 MeV');
  expect(layout.targets).toContain('Energy target: 3.00 MeV–12.0 MeV');
  expect(layout.targets).toContain('Current target: 20 mA–100 mA');

  // Feed the real plot path a tiny, flat 50 keV trace. The 3–12 MeV mission
  // band is far above it, so the plot must retain its useful data scale and
  // turn that target into a labelled arrow at the top edge.
  const plotCalls = await page.evaluate(async () => {
    const { ProbePlots } = await import('/src/ui/probe-plots.js');
    const d = window.game._designer;
    d.draftPhysicsResult = { beamEnergy: 0.00005, beamCurrent: 97.5, beamQuality: 0.02 };
    d.draftEnvelope = [
      { s: 0, energy: 0.00005, eta_x: 0, emit_nx: 1.0e-6, emit_ny: 1.1e-6 },
      { s: 4, energy: 0.00005, eta_x: 0, emit_nx: 1.2e-6, emit_ny: 1.3e-6 },
    ];
    const calls = [];
    const targetLabels = [];
    const orig = ProbePlots.draw;
    const origFillText = CanvasRenderingContext2D.prototype.fillText;
    ProbePlots.draw = function(canvas, type, envelope, pins, activePin, xRange, yScale, opts) {
      calls.push({
        type,
        xRange,
        targets: opts?.targets || null,
        targetYDomain: ProbePlots.targetYDomain(type, opts?.targets || null),
        yDomain: opts?.yDomain || null,
        yAxisMode: opts?.yAxisMode || null,
      });
      return orig.apply(this, arguments);
    };
    CanvasRenderingContext2D.prototype.fillText = function(text) {
      if (String(text).includes('TARGET')) targetLabels.push(String(text));
      return origFillText.apply(this, arguments);
    };
    try {
      d._renderPlots();
    } finally {
      ProbePlots.draw = orig;
      CanvasRenderingContext2D.prototype.fillText = origFillText;
    }
    return { calls, targetLabels };
  });
  const powerCall = plotCalls.calls.find(call => call.type === 'beam-power');
  const radarCall = plotCalls.calls.find(call => call.type === 'eic-triangle');
  expect(powerCall?.targets?.energyGeV).toEqual([0.003, 0.012]);
  expect(powerCall?.targetYDomain).toBeNull();
  expect(powerCall?.yAxisMode).toBe('linear');
  expect(radarCall?.targetYDomain).toBeNull();
  expect(plotCalls.targetLabels).not.toContain('ENERGY TARGET 3.00 MeV–12.0 MeV');

  const overlay = await page.evaluate(async () => {
    const { ProbePlots } = await import('/src/ui/probe-plots.js');
    const select = document.querySelector('.dsgn-plot-panel .dsgn-plot-secondary-select');
    const calls = [];
    const orig = ProbePlots.drawSecondary;
    ProbePlots.drawSecondary = function(canvas, type, envelope, xRange, yScale, opts) {
      calls.push({ type, xRange, yDomain: opts?.yDomain,
        rightInset: opts?.rightInset, axisOffset: opts?.axisOffset });
      return orig.apply(this, arguments);
    };
    try {
      select.value = 'current-loss';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      ProbePlots.drawSecondary = orig;
    }
    return { value: select.value, calls };
  });
  expect(overlay.value).toBe('current-loss');
  const leftCurrentOverlay = overlay.calls.find(call => call.type === 'current-loss'
    && call.rightInset === 72 && call.axisOffset === 0);
  expect(leftCurrentOverlay, 'the selected second quantity is composited').toBeTruthy();
  expect(leftCurrentOverlay.xRange, 'the overlay shares the panel distance window')
    .toEqual(powerCall?.xRange);
  expect(leftCurrentOverlay.rightInset).toBe(72);
  expect(leftCurrentOverlay.axisOffset).toBe(0);

  // The reference and axis modes are independent controls. Hiding the mission
  // reference removes its guides and edge annotations, while changing one
  // panel to Log leaves the other two panels linear.
  const logWithoutMission = await page.evaluate(async () => {
    const { ProbePlots } = await import('/src/ui/probe-plots.js');
    const d = window.game._designer;
    const reference = document.getElementById('dsgn-plot-reference-select');
    reference.value = 'none';
    reference.dispatchEvent(new Event('change', { bubbles: true }));

    const calls = [];
    const targetLabels = [];
    const logAxisLabels = [];
    const orig = ProbePlots.draw;
    const origFillText = CanvasRenderingContext2D.prototype.fillText;
    ProbePlots.draw = function(canvas, type, envelope, pins, activePin, xRange, yScale, opts) {
      calls.push({
        type,
        targets: opts?.targets || null,
        targetBand: opts?.targetBand || null,
        yAxisMode: opts?.yAxisMode || null,
      });
      return orig.apply(this, arguments);
    };
    CanvasRenderingContext2D.prototype.fillText = function(text) {
      if (String(text).includes('TARGET')) targetLabels.push(String(text));
      if (String(text).includes('· LOG')) logAxisLabels.push(String(text));
      return origFillText.apply(this, arguments);
    };
    try {
      const scale = document.querySelector('.dsgn-plot-scale-select[data-panel="0"]');
      scale.value = 'log';
      scale.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      ProbePlots.draw = orig;
      CanvasRenderingContext2D.prototype.fillText = origFillText;
    }
    return {
      calls,
      targetLabels,
      logAxisLabels,
      plotYAxisModes: d.plotYAxisModes,
      plotReference: d.plotReference,
    };
  });
  expect(logWithoutMission.plotYAxisModes).toEqual(['log', 'linear', 'linear']);
  expect(logWithoutMission.plotReference).toBe('none');
  expect(logWithoutMission.calls).toHaveLength(3);
  expect(logWithoutMission.calls.map(call => call.yAxisMode))
    .toEqual(['log', 'linear', 'linear']);
  expect(logWithoutMission.calls.every(call => call.targets === null)).toBe(true);
  expect(logWithoutMission.calls.every(call => call.targetBand === null)).toBe(true);
  expect(logWithoutMission.targetLabels).toEqual([]);
  expect(logWithoutMission.logAxisLabels).toEqual(['E (keV) · LOG']);

  errors.checkAll('designer mission plot strip');
});

test('every visible palette card adds to the draft in edit mode', async ({ page }) => {
  const errors = createErrorCollector(page);
  await page.setViewportSize({ width: 1600, height: 950 });
  await bootFreshGame(page);

  const sourceId = await openEditModeDesigner(page);
  expect(sourceId, 'designer opened from a placed source').toBeTruthy();
  await frames(page, 5);

  const mode = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('#category-tabs .cat-tab')];
    const searchRect = document.getElementById('palette-search')?.getBoundingClientRect();
    const lastTabRect = tabs.at(-1)?.getBoundingClientRect();
    const bottomHud = document.getElementById('bottom-hud');
    return {
      editSourceId: window.game._designer.editSourceId,
      isOpen: window.game._designer.isOpen,
      designerHud: bottomHud?.classList.contains('designer-active'),
      hudHeight: bottomHud?.getBoundingClientRect().height,
      topRowDisplay: getComputedStyle(document.getElementById('hud-top-row')).display,
      searchTop: searchRect?.top,
      lastTabTop: lastTabRect?.top,
      searchLeft: searchRect?.left,
      lastTabRight: lastTabRect?.right,
    };
  });
  expect(mode.isOpen).toBe(true);
  expect(mode.editSourceId, 'in pipe-graph edit mode, not sandbox').toBeTruthy();
  expect(mode.designerHud, 'Designer compact HUD state is active').toBe(true);
  expect(mode.hudHeight, 'the unused mode row is removed from the Designer HUD').toBe(257);
  expect(mode.topRowDisplay).toBe('none');
  expect(mode.searchTop, 'search is vertically aligned with the category buttons').toBe(mode.lastTabTop);
  expect(mode.searchLeft, 'search sits to the right of the category buttons')
    .toBeGreaterThan(mode.lastTabRight);

  // Click every card in every category. The draft must grow by exactly one
  // each time — never silently ignore a click.
  const report = await page.evaluate(async () => {
    const d = window.game._designer;
    const out = [];
    for (const tab of [...document.querySelectorAll('#category-tabs .cat-tab')]) {
      tab.click();
      await new Promise(r => requestAnimationFrame(r));
      const cards = [...document.querySelectorAll('.dsgn-palette-card')];
      for (const card of cards) {
        const before = d.draftNodes.length;
        card.click();
        await new Promise(r => requestAnimationFrame(r));
        out.push({
          cat: tab.dataset.category,
          key: card.dataset.compType,
          delta: d.draftNodes.length - before,
        });
      }
    }
    return out;
  });

  expect(report.length, 'the palette rendered cards to click').toBeGreaterThan(5);
  const ignored = report.filter(r => r.delta !== 1);
  expect(
    ignored.map(r => `${r.cat}/${r.key} (delta ${r.delta})`),
    'no palette card is silently ignored',
  ).toEqual([]);

  errors.checkAll('designer edit-mode palette');
});

test('solver workbench opens from a selected component and previews a measured sweep', async ({ page }) => {
  const errors = createErrorCollector(page);
  await page.setViewportSize({ width: 1600, height: 950 });
  await bootFreshGame(page);

  await page.evaluate(async () => {
    const { BeamPhysics } = await import('/src/beamline/physics.js');
    const deadline = Date.now() + 120_000;
    while (!BeamPhysics.isReady() && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 250));
    }
    if (!BeamPhysics.isReady()) throw new Error('BeamPhysics never became ready');
  });

  const sourceId = await openEditModeDesigner(page);
  expect(sourceId, 'designer opened from a placed source').toBeTruthy();
  await frames(page, 3);

  await page.evaluate(() => {
    const d = window.game._designer;
    d.insertComponent(d.draftNodes.length - 1, 'cbandStructure', 'after');
    d.insertComponent(d.draftNodes.length - 1, 'quadrupole', 'after');
    const quadIndex = d.draftNodes.findIndex(n => n.type === 'quadrupole');
    Object.assign(d.draftNodes[quadIndex].params, { gradient: 20, polarity: 1 });
    d.selectedIndex = quadIndex;
    d._lastTuningKey = null;
    d._recalcDraft();
    d._renderAll();
  });

  const selectedOptimize = page.locator('[data-designer-optimize-selected]');
  await expect(selectedOptimize).toBeVisible();
  await expect(page.locator('#dsgn-open-optimizer')).toBeEnabled();
  await selectedOptimize.click();

  const dialog = page.locator('#dsgn-optimizer-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#dsgn-optimizer-scope')).toHaveValue('selected');
  await expect(page.locator('#dsgn-optimizer-scope option[value="same-type"]'))
    .toContainText('All Quad components');
  await expect(page.locator('[data-optimizer-target="transmission"]')).toBeChecked();

  await page.locator('#dsgn-optimizer-preset').selectOption('focus');
  await page.locator('#dsgn-optimizer-run').click();
  await expect(page.locator('#dsgn-optimizer-progress-label')).toContainText(/SOLUTION FOUND/i, {
    timeout: 120_000,
  });
  await expect(page.locator('.dsgn-optimizer-result-head')).toBeVisible();
  const report = await page.evaluate(() => ({
    resultRows: document.querySelectorAll('.dsgn-optimizer-result-row').length,
    summary: document.querySelector('.dsgn-optimizer-result-summary')?.textContent,
    before: [...document.querySelectorAll('.dsgn-optimizer-result-row')]
      .map(row => row.children[1]?.textContent),
    after: [...document.querySelectorAll('.dsgn-optimizer-result-row')]
      .map(row => row.children[3]?.textContent),
  }));
  expect(report.resultRows).toBeGreaterThanOrEqual(3);
  expect(report.summary).toMatch(/solves .* controls/);
  expect(report.before.every(Boolean)).toBe(true);
  expect(report.after.every(Boolean)).toBe(true);

  errors.checkAll('designer solver workbench');
});

// Proposed-vs-Current comparison. The failure mode this guards is silent: two
// passes that each autoscale to their own envelope land on different y-axes over
// the same pixels, so the player reads a scale difference as a beam difference.
// The assertion is therefore on the domain both passes were handed, not just on
// "something got drawn".
test('plot source Both draws draft over baseline on one shared y-domain', async ({ page }) => {
  const errors = createErrorCollector(page);
  await page.setViewportSize({ width: 1600, height: 950 });
  await bootFreshGame(page);

  // Pyodide is still booting for the first ~10s of a session and answers null
  // to every compute, so opening before it is up would measure the empty case
  // instead of the comparison. Polled inside one evaluate rather than via
  // page.waitForFunction: an async predicate there resolves on the promise
  // object itself and would pass instantly.
  await page.evaluate(async () => {
    const { BeamPhysics } = await import('/src/beamline/physics.js');
    const deadline = Date.now() + 120_000;
    while (!BeamPhysics.isReady() && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 250));
    }
    if (!BeamPhysics.isReady()) throw new Error('BeamPhysics never became ready');
  });

  // A real run — source, pipe, quadrupole, cup — not the bare source the other
  // specs use: a lone junction resolves to a one-sample envelope, which has no
  // curve to compare and would pass this test on the empty case.
  const built = await page.evaluate(() => {
    const g = window.game;
    g.state.resources.funding = 1e9;
    const col = -20;
    // Map generation scatters trees from a fresh seed every run, so a 25-tile
    // run down a fixed column is a coin flip on whether the junctions have
    // anywhere to stand. Clear the strip first rather than hoping.
    for (let r = -21; r <= 6; r++) {
      if (g._decorationAtTile(col, r)) g.removeDecoration(col, r, { skipRefund: true });
    }
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
    g.beamline.placeOnPipe(pipeId, { type: 'quadrupole', position: 0.4 });
    g.recalcBeamline();
    const entry = g.registry.getAll().find(e => e.sourceId === src);
    if (!entry) return null;
    g._designer.openFromSource(entry.sourceId);
    return { sourceId: entry.sourceId, nodes: g._designer.draftNodes.length };
  });
  expect(built, 'the scratch beamline built and opened in the designer').toBeTruthy();
  expect(built.nodes, 'the draft has a run to plot').toBeGreaterThan(1);
  await frames(page, 5);

  // The toggle only exists when there is an as-built beamline to compare to.
  const bar = await page.evaluate(() => ({
    hidden: document.getElementById('dsgn-plot-source')?.classList.contains('hidden'),
    buttons: [...document.querySelectorAll('.dsgn-source-btn')].map(b => b.dataset.source),
    hasBaseline: (window.game._designer.baselineEnvelope || []).length >= 2,
  }));
  expect(bar.hasBaseline, 'edit mode computed a baseline envelope').toBe(true);
  expect(bar.hidden, 'the source toggle is visible in edit mode').toBe(false);
  expect(bar.buttons).toEqual(['proposed', 'current', 'both']);

  // Make the draft genuinely differ from the as-built line, so the two curves
  // are not the same numbers and a shared domain actually has work to do.
  await page.evaluate(() => {
    const d = window.game._designer;
    d.insertComponent(Math.max(0, d.draftNodes.length - 1), 'drift', 'after');
  });
  await frames(page, 3);

  // Record every draw call the Both render makes. ProbePlots is a module-level
  // singleton object and designer-renderer calls `ProbePlots.draw(...)` by
  // property lookup, so wrapping the property observes the real render path.
  const result = await page.evaluate(async () => {
    const { ProbePlots } = await import('/src/ui/probe-plots.js');
    const d = window.game._designer;
    const calls = [];
    const orig = ProbePlots.draw;
    ProbePlots.draw = function(canvas, type, envelope, pins, activePin, xRange, yScale, opts) {
      calls.push({
        type,
        envLength: envelope ? envelope.length : 0,
        isBaseline: envelope === d.baselineEnvelope,
        isDraft: envelope === d.draftEnvelope,
        opts: { ghost: !!(opts && opts.ghost), noClear: !!(opts && opts.noClear),
                yDomain: opts ? opts.yDomain : null },
      });
      return orig.apply(this, arguments);
    };
    try {
      document.querySelector('.dsgn-source-btn[data-source="both"]').click();
    } finally {
      ProbePlots.draw = orig;
    }

    // Expected union, computed independently of what the renderer passed.
    const type = document.querySelector('.dsgn-plot-select').value;
    const markerIdx = d.getMarkerEnvelopeIndex();
    const pins = markerIdx >= 0
      ? [{ elementIndex: markerIdx, s: d.markerS, color: '#4488ff' }]
      : [];
    const yScale = null;
    const expectedUnion = ProbePlots.unionYDomain(
      ProbePlots.yDomainFor(type, d.draftEnvelope, yScale, pins, 0),
      ProbePlots.yDomainFor(type, d.baselineEnvelope, yScale, pins, 0),
    );

    // Non-blank check on the first panel's visible canvas.
    const cv = document.querySelector('.dsgn-plot-canvas');
    const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] > 40 || px[i + 1] > 40 || px[i + 2] > 60) lit++;
    }

    return {
      plotSource: d.plotSource,
      firstPanelType: type,
      calls,
      expectedUnion,
      litPixels: lit,
      canvasPixels: cv.width * cv.height,
    };
  });

  expect(result.plotSource).toBe('both');
  expect(result.litPixels, 'the plot canvas is not blank').toBeGreaterThan(50);

  // Two passes per panel, ghost first, and only the ghost pass is a ghost.
  const panelCalls = result.calls.filter(c => c.type === result.firstPanelType);
  expect(panelCalls.length, 'the first panel drew two passes').toBe(2);
  expect(panelCalls[0].opts.ghost, 'baseline is drawn first, as the ghost').toBe(true);
  expect(panelCalls[0].isBaseline, 'the ghost pass got the baseline envelope').toBe(true);
  expect(panelCalls[1].opts.ghost, 'the draft is drawn solid').toBe(false);
  expect(panelCalls[1].isDraft, 'the solid pass got the draft envelope').toBe(true);
  expect(panelCalls[1].opts.noClear, 'the solid pass composites over the ghost').toBe(true);

  // Same domain for both passes, and it is the true union of the two.
  expect(panelCalls[0].opts.yDomain).toEqual(panelCalls[1].opts.yDomain);
  expect(panelCalls[0].opts.yDomain).toEqual(result.expectedUnion);

  // Every panel drew both passes, not just the first.
  const ghostCalls = result.calls.filter(c => c.opts.ghost).length;
  expect(ghostCalls, 'each panel drew a ghost pass').toBe(result.calls.length / 2);

  // Current alone: one solid pass, on the baseline.
  const solo = await page.evaluate(async () => {
    const { ProbePlots } = await import('/src/ui/probe-plots.js');
    const d = window.game._designer;
    const calls = [];
    const orig = ProbePlots.draw;
    ProbePlots.draw = function(canvas, type, envelope, pins, activePin, xRange, yScale, opts) {
      calls.push({ type, isBaseline: envelope === d.baselineEnvelope,
                   ghost: !!(opts && opts.ghost) });
      return orig.apply(this, arguments);
    };
    try {
      document.querySelector('.dsgn-source-btn[data-source="current"]').click();
    } finally {
      ProbePlots.draw = orig;
    }
    return { plotSource: d.plotSource, calls };
  });
  expect(solo.plotSource).toBe('current');
  expect(solo.calls.every(c => c.isBaseline && !c.ghost),
    'Current draws the baseline alone, solid').toBe(true);

  errors.checkAll('designer plot source toggle');
});

/**
 * Build a real run on the map — source, a straight pipe south with its far end
 * OPEN — and open the designer against it. The open end is what makes this the
 * interesting fixture: it is the only place phase 2's planner will append
 * hardware, and binding the pipe to whatever lands there is the step
 * (attachPipeEnd) that keeps the beam path connected.
 *
 * With `capped`, a Faraday cup closes the far end instead — the shape that
 * forces an INTERIOR edit, since nothing can be appended past a terminal.
 *
 * Returns { sourceId, pipeId }.
 */
async function openRunWithOpenEnd(page, { capped = false } = {}) {
  return page.evaluate((capEnd) => {
    const g = window.game;
    // The tick loop moves funding and the clock, and two of these specs
    // compare serialized state across an await.
    g.pause();
    g.state.resources.funding = 1e9;
    // Sited on clear ground rather than fixed coordinates: map generation
    // scatters trees from a fresh seed every run, so a hard-coded column is a
    // coin flip on whether the source has anywhere to stand.
    const area = window.__bt.findClearArea(3, 13);
    if (!area) return null;
    const col = area.col + 1, row = area.row + 1;
    const src = g.beamline.placeJunction({ type: 'source', col, row, dir: 0, free: true });
    if (!src) return null;
    const cup = capEnd
      ? g.beamline.placeJunction({ type: 'faradayCup', col, row: row + 9, dir: 0, free: true })
      : null;
    if (capEnd && !cup) return null;
    const path = [];
    for (let r = row + 0.5; r <= row + 8.5; r += 0.25) path.push({ col, row: r });
    const pipeId = g.beamline.drawPipe(
      { junctionId: src, portName: 'exit' },
      cup ? { junctionId: cup, portName: 'entry' } : null,
      path,
    );
    if (!pipeId) return null;
    g.recalcBeamline();
    const entry = g.registry.getAll().find(e => e.sourceId === src);
    if (!entry) return null;
    g._designer.openFromSource(entry.sourceId);
    return { sourceId: src, pipeId, cupId: cup };
  }, capped);
}

// The whole loop, end to end: draft two components of the two different shapes
// the map has — one that rides ON a pipe (a cavity, role 'placement') and one
// that BREAKS the pipe run and terminates it (a Faraday cup, role 'junction') —
// then apply and require the map to match. Anything less than all four
// assertions below can pass on a partially-executed plan: a placement with no
// junction, or a junction placed with the pipe left dangling beside it.
test('Apply builds the drafted stack on the map', async ({ page }) => {
  const errors = createErrorCollector(page);
  await page.setViewportSize({ width: 1600, height: 950 });
  await bootFreshGame(page);

  const built = await openRunWithOpenEnd(page);
  expect(built, 'the fixture run built and opened in the designer').toBeTruthy();
  await frames(page, 3);

  const before = await page.evaluate(() => ({
    placeables: window.game.state.placeables.length,
    pipes: window.game.state.beamPipes.length,
    draftNodes: window.game._designer.draftNodes.length,
  }));
  expect(before.draftNodes, 'the draft walked source + drift').toBe(2);

  // Draft: ... drift, S-band structure, Faraday cup.
  await page.evaluate(() => {
    const d = window.game._designer;
    d.insertComponent(d.draftNodes.length - 1, 'sbandStructure', 'after');
    d.insertComponent(d.draftNodes.length - 1, 'faradayCup', 'after');
  });
  await frames(page, 3);

  // confirm() resolves only after the preview is answered, so it is started
  // without awaiting and settled after the Apply click.
  const applying = page.evaluate(() => window.game._designer.confirm());
  await expect(page.locator('#apply-preview-dialog')).toBeVisible();

  // The preview is grouped by kind, not one row per op — the plan emits an
  // extend/place/place/bind sequence and the player must see two lines.
  const preview = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#apply-preview-dialog .apv-row')]
      .map(r => r.querySelector('.apv-label').textContent),
    total: document.querySelector('.apv-total-value')?.textContent || '',
  }));
  expect(preview.rows).toEqual(['S-band Structure', 'Faraday Cup']);
  expect(preview.total, 'the netted total is priced').toMatch(/^\$[\d,]+$/);

  await page.click('#apply-preview-dialog [data-act="apply"]');
  expect(await applying, 'apply reported success').toBe(true);
  await frames(page, 3);

  const after = await page.evaluate(async () => {
    const { flattenPath } = await import('/src/beamline/flattener.js');
    const g = window.game;
    const cup = g.state.placeables.find(p => p.type === 'faradayCup');
    const flat = flattenPath(g.state, g.state.placeables.find(p => p.type === 'source').id);
    const feeding = g.state.beamPipes.filter(
      p => (p.end && p.end.junctionId === cup?.id) || (p.start && p.start.junctionId === cup?.id),
    );
    return {
      placeables: g.state.placeables.length,
      pipes: g.state.beamPipes.length,
      cupId: cup ? cup.id : null,
      cavities: g.state.beamPipes
        .flatMap(p => p.placements || [])
        .filter(pl => pl.type === 'sbandStructure').length,
      stack: flat.map(e => (e.kind === 'drift' ? 'drift' : e.type)),
      feedingPorts: feeding.map(p => (p.end?.junctionId === cup?.id ? p.end : p.start).portName),
      designerOpen: g._designer.isOpen,
      logs: (g.state.log || []).filter(l => l.type === 'bad').map(l => l.msg),
    };
  });

  expect(after.logs, 'no op refused during the apply').toEqual([]);
  expect(after.cupId, 'the junction landed as a placeable').toBeTruthy();
  expect(after.placeables, 'exactly one new placeable').toBe(before.placeables + 1);
  expect(after.cavities, 'the cavity landed as an on-pipe placement').toBe(1);
  // The pipe reconnects: its previously-open end now feeds the cup's entry.
  expect(after.feedingPorts, 'a pipe is bound to the cup entry port').toEqual(['entry']);
  // And the flattener walks the whole new run, which is the real proof the
  // graph is connected rather than just populated.
  expect(after.stack).toEqual(['source', 'drift', 'sbandStructure', 'drift', 'faradayCup']);
  expect(after.designerOpen, 'a successful apply closes the designer').toBe(false);

  errors.checkAll('designer apply');
});

// The interior case, and with it the executor's symbol table. Splicing a module
// into the middle of a drift emits splitPipe → placeJunction, where the
// placeJunction's `connect` entries name the two stubs by SYMBOL ($head/$tail) —
// ids that do not exist until the split has run. If resolution or the
// subsequent attachPipeEnd binds were wrong the module would still appear on
// the map, but the beam path would end at the first stub, so the flattener walk
// is the assertion that matters here.
test('Apply splices a module into the middle of a drift and re-joins the run', async ({ page }) => {
  const errors = createErrorCollector(page);
  await page.setViewportSize({ width: 1600, height: 950 });
  await bootFreshGame(page);

  const built = await openRunWithOpenEnd(page, { capped: true });
  expect(built, 'the capped fixture run built and opened in the designer').toBeTruthy();
  await frames(page, 3);

  const before = await page.evaluate(() => ({
    pipes: window.game.state.beamPipes.length,
    stack: window.game._designer.draftNodes.map(n => n.type),
  }));
  expect(before.pipes).toBe(1);
  expect(before.stack).toEqual(['source', 'drift', 'faradayCup']);

  // Between the drift and the terminal cup — nothing can be appended past a
  // terminal, so this can only be satisfied by cutting the pipe.
  await page.evaluate(() => {
    window.game._designer.insertComponent(1, 'combinedFunctionMagnet', 'after');
  });
  await frames(page, 3);

  const applying = page.evaluate(() => window.game._designer.confirm());
  await expect(page.locator('#apply-preview-dialog')).toBeVisible();
  await page.click('#apply-preview-dialog [data-act="apply"]');
  expect(await applying, 'apply reported success').toBe(true);
  await frames(page, 3);

  const after = await page.evaluate(async () => {
    const { flattenPath } = await import('/src/beamline/flattener.js');
    const g = window.game;
    const cfm = g.state.placeables.find(p => p.type === 'combinedFunctionMagnet');
    const src = g.state.placeables.find(p => p.type === 'source');
    return {
      pipes: g.state.beamPipes.length,
      cfmId: cfm ? cfm.id : null,
      // Which ports of the new module the two stubs bound themselves to.
      boundPorts: g.state.beamPipes
        .flatMap(p => [p.start, p.end])
        .filter(r => r && r.junctionId === cfm?.id)
        .map(r => r.portName)
        .sort(),
      stack: flattenPath(g.state, src.id).map(e => (e.kind === 'drift' ? 'drift' : e.type)),
      logs: (g.state.log || []).filter(l => l.type === 'bad').map(l => l.msg),
    };
  });

  expect(after.logs, 'no op refused during the apply').toEqual([]);
  expect(after.cfmId, 'the module landed on the map').toBeTruthy();
  expect(after.pipes, 'the drift was cut in two').toBe(2);
  expect(after.boundPorts, 'both stubs bound to the module').toEqual(['entry', 'exit']);
  expect(after.stack).toEqual(
    ['source', 'drift', 'combinedFunctionMagnet', 'drift', 'faradayCup'],
  );

  errors.checkAll('designer apply with a split');
});

// All-or-nothing. A half-applied beamline — pipe already lengthened, hardware
// never placed — is worse than no change: it is invisible, and the player has
// no way to undo it. Forced by making one mid-plan op refuse.
test('a mid-plan op failure rolls the map back byte-for-byte', async ({ page }) => {
  const errors = createErrorCollector(page);
  await page.setViewportSize({ width: 1600, height: 950 });
  await bootFreshGame(page);

  const built = await openRunWithOpenEnd(page);
  expect(built, 'the fixture run built and opened in the designer').toBeTruthy();
  await frames(page, 3);

  // Beam Pipe first, cavity second: the plan is then extendPipe → placeOnPipe,
  // so failing the placement leaves a completed geometry op behind to undo.
  await page.evaluate(() => {
    const d = window.game._designer;
    d.insertComponent(d.draftNodes.length - 1, 'drift', 'after');
    d.insertComponent(d.draftNodes.length - 1, 'sbandStructure', 'after');
  });
  await frames(page, 3);

  const applying = page.evaluate(() => {
    const g = window.game;
    g.__snapBefore = g.snapshotBeamlineState();
    g.__realPlaceOnPipe = g.beamline.placeOnPipe;
    g.beamline.placeOnPipe = () => null;
    return g._designer.confirm();
  });
  await expect(page.locator('#apply-preview-dialog')).toBeVisible();
  await page.click('#apply-preview-dialog [data-act="apply"]');
  expect(await applying, 'apply reported failure').toBe(false);
  await frames(page, 3);

  const after = await page.evaluate(() => {
    const g = window.game;
    g.beamline.placeOnPipe = g.__realPlaceOnPipe;
    const now = g.snapshotBeamlineState();
    // Field-by-field, so a failure names what leaked rather than just
    // reporting that two multi-megabyte strings differ.
    const a = JSON.parse(g.__snapBefore.payload).state;
    const b = JSON.parse(now.payload).state;
    const diffKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    return {
      diffKeys,
      occupancyMatches: JSON.stringify(now.subgridOccupied)
        === JSON.stringify(g.__snapBefore.subgridOccupied),
      designerOpen: g._designer.isOpen,
      draftNodes: g._designer.draftNodes.length,
      failureLogged: (g.state.log || []).some(
        l => l.type === 'bad' && /Apply failed at step 2/.test(l.msg),
      ),
    };
  });

  expect(after.diffKeys, 'every transacted field is back to its pre-apply value').toEqual([]);
  expect(after.occupancyMatches, 'sub-grid occupancy is back too').toBe(true);
  expect(after.failureLogged, 'the failing step is named in the log').toBe(true);
  expect(after.designerOpen, 'a failed apply keeps the designer open').toBe(true);
  expect(after.draftNodes, 'the draft survives a failed apply').toBe(4);

  errors.checkAll('designer apply rollback');
});

test('cancel discards the draft and leaves the map untouched', async ({ page }) => {
  const errors = createErrorCollector(page);
  await page.setViewportSize({ width: 1600, height: 950 });
  await bootFreshGame(page);
  await openEditModeDesigner(page);
  await frames(page, 5);

  const before = await page.evaluate(() => ({
    placeables: window.game.state.placeables.length,
    pipes: (window.game.state.beamPipes || []).length,
  }));

  // Add a module to the draft, then cancel. `cancel()` prompts on a dirty
  // draft, so auto-accept the confirm.
  page.on('dialog', d => d.accept());
  const drafted = await page.evaluate(async () => {
    const d = window.game._designer;
    d.insertComponent(Math.max(0, d.draftNodes.length - 1), 'drift', 'after');
    const n = d.draftNodes.length;
    d.cancel();
    return n;
  });
  expect(drafted, 'the draft took the module').toBeGreaterThan(0);
  await frames(page, 3);

  const after = await page.evaluate(() => ({
    placeables: window.game.state.placeables.length,
    pipes: (window.game.state.beamPipes || []).length,
    designerOpen: window.game._designer.isOpen,
  }));
  expect(after.designerOpen, 'cancel closed the designer').toBe(false);
  expect(after.placeables, 'cancel touched no placeables').toBe(before.placeables);
  expect(after.pipes, 'cancel touched no pipes').toBe(before.pipes);

  errors.checkAll('designer cancel');
});
