#!/usr/bin/env node
// test/test-render-placement.mjs
//
// Browser smoke test: opens the game in headless Chrome via Puppeteer,
// clears save data so it's a fresh game, then places every standalone
// beamline module (all 4 rotations) and every infrastructure component,
// checking for JS errors after each placement.
//
// Usage:  npx puppeteer node test/test-render-placement.mjs [--port 8006]

import puppeteer from 'puppeteer';

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '8006';
const URL = `http://localhost:${PORT}/`;

const TIMEOUT = 60_000;

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();

  // Collect JS errors
  const jsErrors = [];
  page.on('pageerror', (err) => {
    jsErrors.push(err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      jsErrors.push(`[console.error] ${msg.text()}`);
    }
  });

  console.log(`Opening ${URL} ...`);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: TIMEOUT });

  // Clear any existing save and reload for a clean slate
  await page.evaluate(() => {
    localStorage.removeItem('beamlineTycoon');
    localStorage.removeItem('beamlineTycoon.devMode');
  });
  await page.reload({ waitUntil: 'networkidle0', timeout: TIMEOUT });

  // Wait for the game to init
  await page.waitForFunction(() => window.game && window.game.state, { timeout: 15000 });
  console.log('Game loaded.\n');

  // Get list of all beamline module types and infrastructure types from PLACEABLES
  const { moduleTypes, infraTypes, attachmentTypes } = await page.evaluate(() => {
    const PLACEABLES = window.game.constructor.toString().includes('PLACEABLES')
      ? null : null; // can't access module imports directly

    // Use game state + COMPONENTS to find types
    const COMPONENTS = window.COMPONENTS;
    const modules = [];
    const infra = [];
    const attachments = [];

    for (const [id, comp] of Object.entries(COMPONENTS)) {
      if (comp.isDrawnConnection) continue;
      if (comp.category === 'rfPower' || comp.category === 'cooling' || comp.category === 'vacuum'
          || comp.category === 'safety' || comp.category === 'controls' || comp.category === 'power') {
        infra.push(id);
      } else if (comp.placement === 'attachment') {
        attachments.push(id);
      } else if (comp.placement === 'module') {
        modules.push(id);
      }
    }
    return { moduleTypes: modules, infraTypes: infra, attachmentTypes: attachments };
  });

  console.log(`Modules: ${moduleTypes.length}, Infrastructure: ${infraTypes.length}, Attachments: ${attachmentTypes.length}`);

  let passed = 0;
  let failed = 0;
  const failures = [];

  // Enable dev mode for unlimited funding
  await page.evaluate(() => window.dev.enable());

  // Helper: place a component and check for errors
  async function testPlace(type, dir, col) {
    const errorsBefore = jsErrors.length;

    const result = await page.evaluate(({ type, dir, col }) => {
      try {
        const id = window.game.placePlaceable({
          type,
          col,
          row: 0,
          subCol: 0,
          subRow: 0,
          dir,
          free: true,
          silent: true,
        });
        return { id: id || false, error: null };
      } catch (e) {
        return { id: false, error: e.message };
      }
    }, { type, dir, col });

    // Wait a frame for renderer to process the change
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    const newErrors = jsErrors.slice(errorsBefore);
    // Filter out known non-crash warnings
    const realErrors = newErrors.filter(e =>
      !e.includes('[placePlaceable] CRASH') // the catch wrapper itself logs
      && !e.includes('THREE.WebGLRenderer')  // webgl warnings in headless
      && !e.includes('Could not load')       // missing texture files
      && !e.includes('404')                  // asset 404s
    );

    return { ...result, renderErrors: realErrors };
  }

  // Place each module type in all 4 rotations
  let colOffset = 5;
  console.log('\n--- Beamline Modules ---\n');

  for (const type of moduleTypes) {
    for (const dir of [0, 1, 2, 3]) {
      const label = `${type} dir=${dir}`;
      const res = await testPlace(type, dir, colOffset);
      colOffset += 10;

      if (res.error) {
        failed++;
        failures.push({ label, reason: `JS error: ${res.error}` });
        console.log(`  FAIL: ${label} — ${res.error}`);
      } else if (!res.id) {
        failed++;
        failures.push({ label, reason: 'placePlaceable returned false' });
        console.log(`  FAIL: ${label} — returned false`);
      } else if (res.renderErrors.length > 0) {
        failed++;
        failures.push({ label, reason: res.renderErrors.join('; ') });
        console.log(`  FAIL: ${label} — render error: ${res.renderErrors[0]}`);
      } else {
        passed++;
        if (dir === 0) console.log(`  PASS: ${type} (all rotations)`);
      }
    }
  }

  // Place each infrastructure type
  console.log('\n--- Infrastructure ---\n');

  for (const type of infraTypes) {
    const label = `${type} (infra)`;
    const res = await testPlace(type, 0, colOffset);
    colOffset += 10;

    if (res.error) {
      failed++;
      failures.push({ label, reason: `JS error: ${res.error}` });
      console.log(`  FAIL: ${label} — ${res.error}`);
    } else if (!res.id) {
      failed++;
      failures.push({ label, reason: 'placePlaceable returned false' });
      console.log(`  FAIL: ${label} — returned false`);
    } else if (res.renderErrors.length > 0) {
      failed++;
      failures.push({ label, reason: res.renderErrors.join('; ') });
      console.log(`  FAIL: ${label} — render error: ${res.renderErrors[0]}`);
    } else {
      passed++;
      console.log(`  PASS: ${label}`);
    }
  }

  // Place each attachment type (may fail to place but shouldn't crash)
  console.log('\n--- Attachments (crash-only check) ---\n');

  for (const type of attachmentTypes) {
    const label = `${type} (attachment)`;
    const errorsBefore = jsErrors.length;

    await page.evaluate(({ type, col }) => {
      try {
        window.game.placePlaceable({
          type, col, row: 0, subCol: 0, subRow: 0, dir: 0, free: true, silent: true,
        });
      } catch (e) { /* ignore — we only care about uncaught render errors */ }
    }, { type, col: colOffset });
    colOffset += 10;

    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    const newErrors = jsErrors.slice(errorsBefore).filter(e =>
      !e.includes('[placePlaceable] CRASH')
      && !e.includes('THREE.WebGLRenderer')
      && !e.includes('Could not load')
      && !e.includes('404')
    );

    if (newErrors.length > 0) {
      failed++;
      failures.push({ label, reason: newErrors.join('; ') });
      console.log(`  FAIL: ${label} — ${newErrors[0]}`);
    } else {
      passed++;
      console.log(`  PASS: ${label}`);
    }
  }

  // --- Rapid place-remove cycle for RF/accel components ---
  console.log('\n--- RF/Accel rapid place-remove cycles ---\n');

  const rfTypes = ['rfq', 'buncher', 'pillboxCavity', 'rfCavity', 'sbandStructure',
    'halfWaveResonator', 'spokeCavity', 'ellipticalSrfCavity', 'cryomodule'];

  for (const type of rfTypes) {
    const label = `${type} — 5x place+remove cycle`;
    const errorsBefore = jsErrors.length;

    const cycleError = await page.evaluate(async ({ type }) => {
      try {
        for (let i = 0; i < 5; i++) {
          for (let dir = 0; dir < 4; dir++) {
            const id = window.game.placePlaceable({
              type, col: 50 + i * 10, row: 50 + dir * 10,
              subCol: 0, subRow: 0, dir, free: true, silent: true,
            });
            if (id) {
              // Let renderer process
              await new Promise(r => requestAnimationFrame(r));
              window.game.removePlaceable(id);
              await new Promise(r => requestAnimationFrame(r));
            }
          }
        }
        return null;
      } catch (e) {
        return e.message;
      }
    }, { type });

    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    const newErrors = jsErrors.slice(errorsBefore).filter(e =>
      !e.includes('[placePlaceable] CRASH')
      && !e.includes('THREE.WebGLRenderer')
      && !e.includes('Could not load')
      && !e.includes('404')
    );

    if (cycleError) {
      failed++;
      failures.push({ label, reason: cycleError });
      console.log(`  FAIL: ${label} — ${cycleError}`);
    } else if (newErrors.length > 0) {
      failed++;
      failures.push({ label, reason: newErrors.join('; ') });
      console.log(`  FAIL: ${label} — ${newErrors[0]}`);
    } else {
      passed++;
      console.log(`  PASS: ${label}`);
    }
  }

  // --- Place RF components and trigger a game tick to exercise physics ---
  console.log('\n--- RF placement + game tick ---\n');

  for (const type of rfTypes) {
    const label = `${type} — place + tick`;
    const errorsBefore = jsErrors.length;

    const tickError = await page.evaluate(({ type, col }) => {
      try {
        // Place a source first so there's a beamline
        const srcId = window.game.placePlaceable({
          type: 'source', col, row: 80, subCol: 0, subRow: 0, dir: 0, free: true, silent: true,
        });
        const compId = window.game.placePlaceable({
          type, col: col + 5, row: 80, subCol: 0, subRow: 0, dir: 0, free: true, silent: true,
        });
        // Run a game tick
        window.game.tick();
        // Clean up
        if (compId) window.game.removePlaceable(compId);
        if (srcId) window.game.removePlaceable(srcId);
        return null;
      } catch (e) {
        return e.message + '\n' + e.stack;
      }
    }, { type, col: colOffset });
    colOffset += 20;

    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    const newErrors = jsErrors.slice(errorsBefore).filter(e =>
      !e.includes('[placePlaceable] CRASH')
      && !e.includes('THREE.WebGLRenderer')
      && !e.includes('Could not load')
      && !e.includes('404')
    );

    if (tickError) {
      failed++;
      failures.push({ label, reason: tickError });
      console.log(`  FAIL: ${label} — ${tickError.split('\n')[0]}`);
    } else if (newErrors.length > 0) {
      failed++;
      failures.push({ label, reason: newErrors.join('; ') });
      console.log(`  FAIL: ${label} — ${newErrors[0]}`);
    } else {
      passed++;
      console.log(`  PASS: ${label}`);
    }
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) {
      console.log(`  - ${f.label}: ${f.reason}`);
    }
  }

  // Also dump any accumulated console errors that we filtered
  const allFilteredErrors = jsErrors.filter(e =>
    e.includes('[placePlaceable] CRASH')
  );
  if (allFilteredErrors.length > 0) {
    console.log(`\n--- placePlaceable CRASH logs (${allFilteredErrors.length}) ---`);
    for (const e of allFilteredErrors) {
      console.log(`  ${e}`);
    }
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
