// Native Chrome/WebGPU regression for the real Minor Lab wheel gesture.
// Opt-in because it measures hardware frame delivery:
//
//   BT_PERF=1 npx playwright test lod-wheel-profile --reporter=list

import { expect, test } from '@playwright/test';
import { waitForBoot } from './helpers.mjs';

const ENABLED = process.env.BT_PERF === '1';

test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    channel: 'chrome',
    args: ['--enable-unsafe-webgpu'],
    ignoreDefaultArgs: ['--disable-gpu'],
  },
});

test.describe('Minor Lab wheel-driven LOD transition', () => {
  test.skip(!ENABLED, 'measurement lane — set BT_PERF=1 to run');
  test.setTimeout(600_000);

  test('keeps delivering world frames while rapid wheel input crosses the boundary', async ({ page }) => {
    await page.goto('/');
    await page.mouse.click(720, 450);
    await waitForBoot(page, 300_000);
    await page.getByRole('button', { name: 'New Game', exact: true }).click();
    const confirmation = new Promise((resolve, reject) => {
      page.once('dialog', dialog => dialog.accept().then(resolve, reject));
    });
    await page.locator('.scenario-card[data-id="minorLab"]').click();
    await confirmation;
    await expect(page.locator('#title-screen')).toHaveCount(0, { timeout: 300_000 });
    await page.waitForFunction(() => (
      window.game?.state?.placeables?.length > 1000
      && window._renderer?.renderingSuspended === false
    ), null, { timeout: 300_000 });
    const initial = await page.evaluate(() => {
      const renderer = window._renderer;
      const calls = [];
      const wrap = (owner, method, label) => {
        if (!owner?.[method]) return;
        const original = owner[method].bind(owner);
        owner[method] = (...args) => {
          const start = performance.now();
          const result = original(...args);
          calls.push({ label, detail: args[0], ms: performance.now() - start });
          return result;
        };
      };
      wrap(renderer.componentBuilder, 'setDetailLevel', 'components');
      wrap(renderer.equipmentBuilder, 'setDetailLevel', 'equipment');
      wrap(renderer.decorationBuilder, 'setDetailLevel', 'decorations');
      wrap(renderer.pipeAttachmentBuilder, 'setDetailLevel', 'attachments');
      wrap(renderer.beamPipeBuilder, 'setDetailLevel', 'beamPipes');
      wrap(renderer.beamBuilder, 'setDetailLevel', 'beams');
      wrap(renderer.utilityLineBuilderV2, 'setDetailLevel', 'utilities');
      wrap(renderer._lightRig, 'setWorldDetail', 'lights');

      const renders = [];
      let lastTransitionStep = null;
      const originalAdvance = renderer._lodTransitionQueue.advance
        .bind(renderer._lodTransitionQueue);
      renderer._lodTransitionQueue.advance = () => {
        lastTransitionStep = originalAdvance();
        return lastTransitionStep;
      };
      const originalRender = renderer._glowPipeline.render.bind(renderer._glowPipeline);
      renderer._glowPipeline.render = (...args) => {
        const start = performance.now();
        const lighting = renderer.getLightingStats();
        const result = originalRender(...args);
        renders.push({
          at: start,
          ms: performance.now() - start,
          sun: lighting.sunShadowUpdate,
          fixtureUpdates: lighting.shadowUpdatesLastFrame,
          fixturePending: lighting.fixtureShadowQueuePending,
          zoom: renderer.zoom,
          transitionStep: lastTransitionStep,
        });
        lastTransitionStep = null;
        return result;
      };

      const frames = [];
      let previous = performance.now();
      let active = true;
      const sample = now => {
        frames.push({ at: now, gap: now - previous, zoom: renderer.zoom });
        previous = now;
        if (active) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      window.__lodWheelProfile = {
        calls,
        frames,
        renders,
        stop() { active = false; },
      };
      return {
        backend: renderer.usesNativeWebGPU?.() ? 'webgpu' : 'webgl',
        timeOrigin: performance.timeOrigin,
        zoom: renderer.zoom,
        placeables: window.game.state.placeables.length,
        postProcessingSuppressed: renderer.getLightingStats()
          .postProcessingSuppressedForDensity,
        canvasRect: (() => {
          const rect = renderer.app.canvas.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })(),
      };
    });

    const wheel = deltaY => page.evaluate(({ x, y, delta }) => {
      window._renderer.app.canvas.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        deltaY: delta,
      }));
    }, {
      x: initial.canvasRect.x + initial.canvasRect.width / 2,
      y: initial.canvasRect.y + initial.canvasRect.height / 2,
      delta: deltaY,
    });
    const gestureStart = Date.now();
    for (let step = 0; step < 7; step++) {
      await wheel(-100);
      await page.waitForTimeout(30);
    }
    await page.waitForFunction(() => (
      window._renderer?._lodTransitionQueue?.pendingCount === 0
      && window._renderer?._lastLodDetail === true
      && window._renderer?._lastUtilityLodDetail === true
    ), null, { timeout: 10_000 });
    const nearState = await page.evaluate(() => ({
      zoom: window._renderer.zoom,
      detail: window._renderer._lastLodDetail,
      utilityDetail: window._renderer._lastUtilityLodDetail,
      utilityPresentation: window._renderer.utilityLineBuilderV2
        .getLodPresentationStats(),
    }));
    const panMotionState = await page.evaluate(async () => {
      const renderer = window._renderer;
      renderer.panScreenAligned(0.25, 0);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        detail: renderer._lastLodDetail,
        utilityDetail: renderer._lastUtilityLodDetail,
      };
    });
    await page.waitForFunction(() => (
      window._renderer?._lodTransitionQueue?.pendingCount === 0
      && window._renderer?._lastLodDetail === true
      && window._renderer?._lastUtilityLodDetail === true
    ), null, { timeout: 10_000 });
    const orbitMotionState = await page.evaluate(async () => {
      const renderer = window._renderer;
      renderer.startFreeOrbit();
      renderer.orbitBy(28, -10);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const during = {
        detail: renderer._lastLodDetail,
        utilityDetail: renderer._lastUtilityLodDetail,
      };
      renderer.endFreeOrbit();
      return during;
    });
    await page.waitForFunction(() => window._renderer?._snapping === false, null, {
      timeout: 10_000,
    });
    for (let step = 0; step < 7; step++) {
      await wheel(100);
      await page.waitForTimeout(30);
    }
    await page.waitForFunction(() => (
      window._renderer?._lodTransitionQueue?.pendingCount === 0
      && window._renderer?._lastLodDetail === false
      && window._renderer?._lastUtilityLodDetail === false
    ), null, { timeout: 10_000 });
    await page.waitForTimeout(1000);

    const result = await page.evaluate(async () => {
      const renderer = window._renderer;
      window.__lodWheelProfile.stop();
      const frames = window.__lodWheelProfile.frames;
      const worstFrame = frames.reduce((worst, frame) => (
        !worst || frame.gap > worst.gap ? frame : worst
      ), null);
      const renders = window.__lodWheelProfile.renders;
      const queue = renderer.renderer?.backend?.device?.queue;
      const queueStart = performance.now();
      await Promise.race([
        queue?.onSubmittedWorkDone?.() || Promise.resolve(),
        new Promise(resolve => setTimeout(resolve, 10_000)),
      ]);
      return {
        zoom: renderer.zoom,
        detail: renderer._lastLodDetail,
        pendingFamilies: renderer._lodTransitionQueue.pendingCount,
        calls: window.__lodWheelProfile.calls,
        renderMaxCpuMs: Math.max(...renders.map(render => render.ms)),
        rendersBeforeWorstGap: renders.filter(render => render.at < worstFrame.at).slice(-6),
        maxFrameGapMs: worstFrame.gap,
        frameGapsOver100Ms: frames.filter(frame => frame.gap > 100),
        queueDrainMs: performance.now() - queueStart,
        timeOrigin: performance.timeOrigin,
      };
    });

    console.log('  wheel LOD profile: ' + JSON.stringify({
      initial,
      nearState,
      panMotionState,
      orbitMotionState,
      gestureWallMs: Date.now() - gestureStart,
      ...result,
    }));
    expect(initial.backend).toBe('webgpu');
    expect(initial.postProcessingSuppressed).toBe(true);
    expect(nearState.zoom).toBeGreaterThan(3);
    expect(nearState.detail).toBe(true);
    expect(nearState.utilityDetail).toBe(true);
    expect(panMotionState.detail).toBe(true);
    expect(panMotionState.utilityDetail).toBe(true);
    expect(orbitMotionState.detail).toBe(true);
    expect(orbitMotionState.utilityDetail).toBe(true);
    expect(nearState.utilityPresentation.nearSourceCount)
      .toBeGreaterThan(nearState.utilityPresentation.nearBatchCount);
    expect(nearState.utilityPresentation.nearBatchCount).toBeLessThanOrEqual(300);
    expect(result.zoom).toBeLessThan(1.1);
    expect(result.detail).toBe(false);
    expect(result.pendingFamilies).toBe(0);
    expect(result.timeOrigin).toBe(initial.timeOrigin);
    expect(result.renderMaxCpuMs).toBeLessThan(150);
    expect(result.maxFrameGapMs).toBeLessThan(500);
  });
});
