// Isolated browser baseline. Owns and closes only its ephemeral server/browser.
import { createServer, preview } from 'vite';
import net from 'node:net';
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { SWIFTSHADER_ARGS } from '../test/browser/helpers.mjs';
const reservation = net.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const selectedPort = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const built = process.env.PROFILE_BUILT === '1';
const options = { root: process.env.PROFILE_ROOT || process.cwd(), server: { host: '127.0.0.1', port: selectedPort, strictPort: true, hmr: false }, preview: { host: '127.0.0.1', port: selectedPort, strictPort: true } };
const server = built ? await preview(options) : await createServer(options);
let browser;
try {
  if (!built) await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: process.env.PROFILE_SOFTWARE === '1' ? SWIFTSHADER_ARGS : [] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const profiler = await page.context().newCDPSession(page);
  await profiler.send('Profiler.enable');
  await profiler.send('Profiler.start');
  const errors = [];
  const failedRequests = [];
  page.on('response', response => { if (response.status() >= 400) failedRequests.push({ url: response.url(), status: response.status() }); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.error('[browser]', msg.text()); });
  await page.addInitScript(() => {
    window.startupLongTasks = [];
    new PerformanceObserver(list => window.startupLongTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  let bootError = null;
  try { await page.waitForFunction(() => window._renderer?._inputHandler, null, { timeout: 60000 }); }
  catch (error) { bootError = error.message; }

  const report = await page.evaluate(() => ({
    bootMs: performance.now(),
    longTasks: window.startupLongTasks,
    resources: performance.getEntriesByType('resource').map(e => ({ name: e.name, duration: e.duration, bytes: e.transferSize })),
    renderer: window._renderer?.renderer?.info?.render,
  }));
  if (process.env.PROFILE_GAME === '1' && !bootError) {
    await page.evaluate(() => {
      window.scenarioTimings = [];
      const wrap = (object, name) => {
        const original = object[name];
        if (typeof original !== 'function') return;
        object[name] = function (...args) {
          const started = performance.now();
          const record = () => window.scenarioTimings.push({ name, started, duration: performance.now() - started });
          const result = original.apply(this, args);
          if (result?.then) return result.finally(record);
          record(); return result;
        };
      };
      for (const name of ['prepareInteractiveLod', 'refreshForNewSession', 'renderPreparedWorldFrame']) wrap(window._renderer, name);
      wrap(window._renderer.renderer, 'compileAsync');
    });
    await page.mouse.click(720, 450);
    await page.getByRole('button', { name: 'New Game', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    const started = Date.now();
    await page.locator('.scenario-card[data-id="minorLab"]').click();
    await page.waitForFunction(() => !document.getElementById('title-screen') && window._renderer?.renderingSuspended === false, null, { timeout: 180000 });
    report.scenarioMs = Date.now() - started;
    report.scenarioTimings = await page.evaluate(() => window.scenarioTimings);
    report.frameSample = await page.evaluate(() => new Promise(resolve => {
      const intervals = []; let last = performance.now();
      const tick = now => {
        intervals.push(now - last); last = now;
        if (intervals.length < 120) requestAnimationFrame(tick);
        else resolve({ intervals, render: window._renderer.renderer.info.render });
      };
      requestAnimationFrame(tick);
    }));
    await page.getByRole('button', { name: "LET'S GO", exact: true }).click();
    report.dialogChecks = [];
    for (const [action, selector, close] of [['options', '#options-dialog', '.opt-close'], ['save-game', '#saveload-dialog', '.sl-close'], ['load-game', '#saveload-dialog', '.sl-close']]) {
      await page.locator('#btn-menu').click();
      await page.locator(`#menu-dropdown [data-action="${action}"]`).click();
      await page.locator(selector).waitFor({ state: 'visible' });
      report.dialogChecks.push(action);
      await page.locator(`${selector} ${close}`).click();
    }
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.down('w');
    report.panFrames = await page.evaluate(() => new Promise(resolve => {
      const intervals = []; let last = performance.now();
      const started = performance.now();
      const before = [window._renderer._panX, window._renderer._panY];
      const tick = now => {
        intervals.push(now - last); last = now;
        if (intervals.length < 90) requestAnimationFrame(tick);
        else resolve({ intervals, started, ended: performance.now(), before, after: [window._renderer._panX, window._renderer._panY] });
      };
      requestAnimationFrame(tick);
    }));
    await page.keyboard.up('w');
    if (JSON.stringify(report.panFrames.before) === JSON.stringify(report.panFrames.after)) {
      report.errors = ['Camera did not move during pan test'];
      errors.push('Camera did not move during pan test');
    }
    await page.screenshot({ path: '/tmp/beamline-minor-lab.png' });
  }
  const { profile } = await profiler.send('Profiler.stop');
  await writeFile((process.argv[2] || '/tmp/beamline-startup.json') + '.cpuprofile', JSON.stringify(profile));
  report.errors = errors;
  report.failedRequests = failedRequests;
  report.bootError = bootError;
  report.backend = process.env.PROFILE_SOFTWARE === '1' ? 'SwiftShader' : 'Chrome default GPU';
  await writeFile(process.argv[2] || '/tmp/beamline-startup.json', JSON.stringify(report, null, 2));
  await page.screenshot({ path: '/tmp/beamline-startup.png' });
  console.log(JSON.stringify({ bootMs: report.bootMs, longTasks: report.longTasks.length, errors, port }));
} finally {
  await browser?.close();
  if (built) await new Promise(resolve => server.httpServer.close(resolve));
  else await server.close();
}
