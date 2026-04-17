#!/usr/bin/env node
// test/test-ui-placement.mjs
//
// Simulates the full UI placement flow: select a beamline module from
// the palette, move the mouse to set position, click to place.
// Catches errors that the programmatic placePlaceable test might miss.

import puppeteer from 'puppeteer';

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '8006';
const URL = `http://localhost:${PORT}/`;

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') jsErrors.push(`[console.error] ${msg.text()}`);
  });

  console.log(`Opening ${URL} ...`);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });

  // Fresh game
  await page.evaluate(() => {
    localStorage.removeItem('beamlineTycoon');
    localStorage.removeItem('beamlineTycoon.devMode');
  });
  await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => window.game && window.game.state, { timeout: 15000 });

  // Enable dev mode
  await page.evaluate(() => window.dev.enable());
  console.log('Game loaded, dev mode enabled.\n');

  // Wait for renderer to be ready
  await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));

  // Get RF component types
  const rfTypes = await page.evaluate(() => {
    const types = [];
    const COMPONENTS = window.COMPONENTS;
    for (const [id, comp] of Object.entries(COMPONENTS)) {
      if (comp.placement === 'module' && !comp.isDrawnConnection) {
        types.push(id);
      }
    }
    return types;
  });

  console.log(`Testing ${rfTypes.length} module types via full UI flow\n`);

  let passed = 0, failed = 0;
  const failures = [];

  for (const type of rfTypes) {
    const label = `${type} — UI select + place`;
    const errorsBefore = jsErrors.length;

    // 1. Select the tool programmatically (simulating palette click)
    await page.evaluate((type) => {
      // _inputHandler is set on the renderer by main.js
      const input = window._renderer._inputHandler || window._input;
      if (input) input.selectTool(type);
      else window._renderer._onToolSelect?.(type);
    }, type);

    // 2. Move mouse to center of viewport to trigger ghost preview
    await page.mouse.move(640, 400);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));

    // 3. Click to place
    await page.mouse.click(640, 400);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    // 4. Check what happened
    const result = await page.evaluate(() => {
      const placeables = window.game.state.placeables;
      const last = placeables[placeables.length - 1];
      return {
        count: placeables.length,
        lastType: last?.type,
        lastId: last?.id,
      };
    });

    const newErrors = jsErrors.slice(errorsBefore).filter(e =>
      !e.includes('THREE.WebGLRenderer')
      && !e.includes('Could not load')
      && !e.includes('404')
    );

    if (newErrors.length > 0) {
      failed++;
      failures.push({ label, reason: newErrors.join('; ') });
      console.log(`  FAIL: ${label}`);
      for (const e of newErrors) console.log(`        ${e.substring(0, 200)}`);
    } else {
      passed++;
      console.log(`  PASS: ${label} (placed: ${result.lastType === type}, count: ${result.count})`);
    }

    // Deselect and clean up for next iteration - remove what we just placed and move mouse away
    await page.evaluate((type) => {
      const input = window._renderer._inputHandler || window._input;
      if (input) { input.deselectTool?.(); input.selectPlaceable?.(null); }
      // Remove the last placed item if it matches
      const placeables = window.game.state.placeables;
      if (placeables.length > 0) {
        const last = placeables[placeables.length - 1];
        if (last.type === type) {
          window.game.removePlaceable(last.id);
        }
      }
    }, type);
    await page.mouse.move(0, 0);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failures.length > 0) {
    console.log('\nFailed:');
    for (const f of failures) console.log(`  - ${f.label}: ${f.reason}`);
  }

  // Dump ALL console errors for inspection
  if (jsErrors.length > 0) {
    console.log(`\n--- All JS errors (${jsErrors.length}) ---`);
    for (const e of jsErrors) console.log(`  ${e.substring(0, 300)}`);
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
