// Isolated browser baseline. Owns and closes only its ephemeral server/browser.
import { createServer } from 'vite';
import net from 'node:net';
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { SWIFTSHADER_ARGS } from '../test/browser/helpers.mjs';
const reservation = net.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const selectedPort = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const server = await createServer({ root: process.env.PROFILE_ROOT || process.cwd(), server: { host: '127.0.0.1', port: selectedPort, strictPort: true, hmr: false } });
let browser;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: SWIFTSHADER_ARGS });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.startupLongTasks = [];
    new PerformanceObserver(list => window.startupLongTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  let bootError = null;
  try { await page.waitForFunction(() => window._renderer?._inputHandler, null, { timeout: 120000 }); }
  catch (error) { bootError = error.message; }

  const report = await page.evaluate(() => ({
    bootMs: performance.now(),
    longTasks: window.startupLongTasks,
    resources: performance.getEntriesByType('resource').map(e => ({ name: e.name, duration: e.duration, bytes: e.transferSize })),
    renderer: window._renderer.renderer?.info?.render,
  }));
  report.errors = errors;
  report.bootError = bootError;
  report.backend = 'headless SwiftShader; CPU baseline, not hardware GPU FPS';
  await writeFile(process.argv[2] || '/tmp/beamline-startup.json', JSON.stringify(report, null, 2));
  await page.screenshot({ path: '/tmp/beamline-startup.png' });
  console.log(JSON.stringify({ bootMs: report.bootMs, longTasks: report.longTasks.length, errors, port }));
} finally {
  await browser?.close();
  await server.close();
}
