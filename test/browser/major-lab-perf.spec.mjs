// test/browser/major-lab-perf.spec.mjs — frame-cost profile of the Major Lab map.
//
// NOT part of the normal browser lane: it is a measurement, not an assertion,
// and it is slow. Run it explicitly:
//
//   BT_PERF=1 npx playwright test major-lab-perf --reporter=list
//
// It boots the real app with the Major Lab scenario pre-installed (served from
// public/rescue/), lets the scene settle, then reports:
//
//   * steady-state frame times, idle and while the camera moves
//   * where each frame goes: renderer.render() vs the rest of _animate()
//   * renderer.info (draw calls, triangles, geometries, textures, programs)
//   * a scene census — which top-level group owns how many meshes
//
// CAVEAT, and it matters: headless Chromium runs WebGL on SwiftShader (CPU).
// Absolute milliseconds here are NOT what the player's GPU does. What IS
// trustworthy: draw-call and triangle counts, the scene census, and the JS
// (non-render) portion of the frame — all of which are backend-independent.

import { test, expect } from '@playwright/test';
import { createErrorCollector, waitForBoot } from './helpers.mjs';

const SCENARIO_URL = '/rescue/majorLab.scenario.json';
const ENABLED = process.env.BT_PERF === '1';

test.describe('Major Lab frame cost', () => {
  test.skip(!ENABLED, 'measurement lane — set BT_PERF=1 to run');
  test.setTimeout(900_000);

  test('profile', async ({ page, baseURL }) => {
    const errors = createErrorCollector(page);

    // Fetch the scenario in Node and hand it to the page as an init script, so
    // boot finds it already installed and skips both the title and the picker.
    const res = await page.request.get(`${baseURL}${SCENARIO_URL}`);
    expect(res.ok(), `scenario fixture is served at ${SCENARIO_URL}`).toBe(true);
    const exported = await res.json();

    await page.addInitScript((exp) => {
      const stored = {
        id: exp.id, name: exp.name, desc: '',
        data: exp.data, sandbox: true, updatedAt: 1,
      };
      localStorage.setItem('beamlineTycoon.customScenarios.' + exp.id, JSON.stringify(stored));
      localStorage.setItem('beamlineTycoon.customScenarioIndex', JSON.stringify([
        { id: exp.id, name: exp.name, desc: '', sandbox: true, updatedAt: 1 },
      ]));
      // Boot applies this and skips the title screen (src/main.js:83, :295).
      localStorage.setItem('beamlineTycoon.pendingScenario', '__custom__:' + exp.id);
    }, exported);

    const bootStart = Date.now();
    await page.goto('/');
    await waitForBoot(page);
    const bootMs = Date.now() - bootStart;

    // Confirm we are actually looking at the Major Lab, not an empty world.
    const world = await page.evaluate(() => ({
      floors: window.game.state.floors.length,
      walls: window.game.state.walls.length,
      placeables: window.game.state.placeables.length,
    }));
    expect(world.floors, 'Major Lab floors are loaded').toBeGreaterThan(1700);

    // Let LOD, lighting ramp and the invalidation scheduler settle.
    await page.waitForTimeout(4000);

    // Instrument: wrap the WebGLRenderer's render() and the sim tick so we can
    // attribute frame time instead of guessing.
    await page.evaluate(() => {
      const r = window._renderer;
      const g = window.game;
      const P = { frames: [], render: [], tick: [], on: false };
      window.__perf = P;

      // Per-call decomposition: which render() pass issues how many draw
      // calls. info.autoReset is on, so each call's count is its own.
      P.passes = [];
      const realRender = r.renderer.render.bind(r.renderer);
      r.renderer.render = (scene, camera, ...rest) => {
        if (!P.on) return realRender(scene, camera, ...rest);
        const t0 = performance.now();
        const out = realRender(scene, camera, ...rest);
        const ms = performance.now() - t0;
        P.render.push(ms);
        P.passes.push({
          ms: +ms.toFixed(2),
          calls: r.renderer.info.render.calls,
          tris: r.renderer.info.render.triangles,
          cams: camera?.isArrayCamera ? camera.cameras.length : 1,
          target: r.renderer.getRenderTarget()?.texture?.name || null,
        });
        return out;
      };

      if (typeof g.tick === 'function') {
        const realTick = g.tick.bind(g);
        g.tick = (...a) => {
          if (!P.on) return realTick(...a);
          const t0 = performance.now();
          const out = realTick(...a);
          P.tick.push(performance.now() - t0);
          return out;
        };
      }

      let last = performance.now();
      const loop = () => {
        const now = performance.now();
        if (P.on) P.frames.push(now - last);
        last = now;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);

      P.reset = () => {
        P.frames.length = 0; P.render.length = 0; P.tick.length = 0; P.passes.length = 0;
      };
      P.start = () => { P.reset(); P.on = true; };
      P.stop = () => { P.on = false; };
      P.stats = (a) => {
        if (!a.length) return null;
        const s = [...a].sort((x, y) => x - y);
        const at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
        return {
          n: s.length,
          mean: +(s.reduce((n, v) => n + v, 0) / s.length).toFixed(2),
          p50: +at(0.5).toFixed(2),
          p95: +at(0.95).toFixed(2),
          p99: +at(0.99).toFixed(2),
          max: +s[s.length - 1].toFixed(2),
        };
      };
    });

    // ── Idle: camera still, nothing armed ────────────────────────────────
    await page.evaluate(() => window.__perf.start());
    await page.waitForTimeout(6000);
    const idle = await page.evaluate(() => {
      const P = window.__perf; P.stop();
      return {
        frame: P.stats(P.frames), render: P.stats(P.render), tick: P.stats(P.tick),
        frames: P.frames.length, passes: P.passes.slice(),
      };
    });

    // ── Camera motion: short pan, just to catch per-move rebuild work ────
    await page.evaluate(() => window.__perf.start());
    await page.evaluate(async () => {
      const r = window._renderer;
      const step = () => new Promise(res => requestAnimationFrame(res));
      for (let i = 0; i < 24; i++) {
        r._panX += Math.cos(i / 6) * 1.5;
        r._panY += Math.sin(i / 6) * 1.5;
        r._updateCameraLookAt();
        r._syncOverlayFromPan();
        await step();
      }
    });
    const moving = await page.evaluate(() => {
      const P = window.__perf; P.stop();
      return { frame: P.stats(P.frames), render: P.stats(P.render), tick: P.stats(P.tick) };
    });

    // ── Frame decomposition: group the idle render passes by target ──────
    const passes = (() => {
      const frames = Math.max(1, idle.frames);
      const byShape = new Map();
      for (const p of idle.passes) {
        const key = `${p.target || 'screen'} (${p.cams}cam)`;
        const hit = byShape.get(key) || { shape: key, n: 0, calls: 0, ms: 0, maxCalls: 0 };
        hit.n++;
        hit.calls += p.calls;
        hit.ms += p.ms;
        hit.maxCalls = Math.max(hit.maxCalls, p.calls);
        byShape.set(key, hit);
      }
      const groups = [...byShape.values()].map(h => ({
        shape: h.shape,
        perFrame: +(h.n / frames).toFixed(1),
        avgCalls: Math.round(h.calls / h.n),
        maxCalls: h.maxCalls,
        callsPerFrame: Math.round(h.calls / frames),
        msPerFrame: +(h.ms / frames).toFixed(2),
      })).sort((a, b) => b.callsPerFrame - a.callsPerFrame);
      return {
        groups,
        frames,
        totalPasses: idle.passes.length,
        passesPerFrame: +(idle.passes.length / frames).toFixed(1),
        callsPerFrame: Math.round(idle.passes.reduce((n, p) => n + p.calls, 0) / frames),
      };
    })();

    // ── Stall hunt ───────────────────────────────────────────────────────
    // Median frame cost is fine; p95 is ~100x median on real hardware. That
    // is a stall, not throughput, so look for per-frame STATE CHANGES rather
    // than steady cost. Shader program count is the headline suspect:
    // three recompiles every lit material when scene light topology changes,
    // and light-rig.js is explicitly built to avoid that (see its header).
    const stalls = await page.evaluate(async () => {
      const r = window._renderer;
      const gl = r.renderer;
      const step = () => new Promise(res => requestAnimationFrame(res));

      const snap = () => {
        let meshes = 0, litMaterials = 0, activeLights = 0;
        const seen = new Set();
        r.scene.traverse((o) => {
          if (o.isMesh) {
            meshes++;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              if (!m || seen.has(m.uuid)) continue;
              seen.add(m.uuid);
              if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) litMaterials++;
            }
          }
          if (o.isLight && o.intensity > 0) activeLights++;
        });
        return {
          programs: gl.info.programs?.length ?? -1,
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures,
          meshes, litMaterials, activeLights,
        };
      };

      const frames = [];
      let prev = snap();
      let last = performance.now();

      // Move the camera the way a player does: continuous pan, then zoom.
      for (let i = 0; i < 90; i++) {
        if (i < 60) {
          r._panX += Math.cos(i / 9) * 2.0;
          r._panY += Math.sin(i / 9) * 2.0;
        } else {
          r.zoom *= (i % 2 ? 1.06 : 0.94);
        }
        r._updateCameraLookAt();
        r._syncOverlayFromPan?.();
        await step();
        const now = performance.now();
        const dt = now - last;
        last = now;
        const cur = snap();
        frames.push({
          i,
          ms: +dt.toFixed(1),
          dPrograms: cur.programs - prev.programs,
          dGeometries: cur.geometries - prev.geometries,
          dTextures: cur.textures - prev.textures,
          dMeshes: cur.meshes - prev.meshes,
          dLit: cur.litMaterials - prev.litMaterials,
          dLights: cur.activeLights - prev.activeLights,
        });
        prev = cur;
      }

      const times = frames.map(f => f.ms).sort((a, b) => a - b);
      const med = times[Math.floor(times.length / 2)];
      const changed = frames.filter(f => (
        f.dPrograms || f.dGeometries || f.dTextures || f.dMeshes || f.dLit
      ));
      const spikes = frames.filter(f => f.ms > med * 3);
      // Do the spikes coincide with state changes?
      const spikeKeys = new Set(spikes.map(f => f.i));
      const changedKeys = new Set(changed.map(f => f.i));
      let overlap = 0;
      for (const k of spikeKeys) if (changedKeys.has(k)) overlap++;

      return {
        medianMs: +med.toFixed(1),
        p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(1),
        maxMs: +times[times.length - 1].toFixed(1),
        totalFrames: frames.length,
        spikeCount: spikes.length,
        changeCount: changed.length,
        spikesWithStateChange: overlap,
        finalPrograms: prev.programs,
        finalLitMaterials: prev.litMaterials,
        worstFrames: [...frames].sort((a, b) => b.ms - a.ms).slice(0, 8),
        changedFrames: changed.slice(0, 10),
      };
    });

    // ── Rebuild attribution ──────────────────────────────────────────────
    // The sim ticks at 1 Hz (Game.TICK_MS = 1000) and the player's stalls
    // arrive at roughly 1 Hz too. _animate() opens each frame with
    // _worldInvalidationScheduler.flush(), so a tick that dirties the world
    // pays for a rebuild on the next frame. Wrap every refresh entry point
    // and let the sim run: whatever owns the time will name itself.
    const rebuilds = await page.evaluate(async () => {
      const r = window._renderer;
      const g = window.game;
      const log = [];

      const METHODS = [
        '_refreshWalls', '_refreshEquipment', '_refreshDecorations', '_refreshInfra',
        '_refreshZones', '_refreshTerrain', '_refreshComponents', '_refreshBeamPipes',
        '_refreshConnections', '_refreshPortFittings', '_refreshPipeAttachments',
        '_refreshBeam', '_refreshBeamlineWorld', '_refreshUtilityPortIssueMarkers',
        'refresh',
      ];
      for (const name of METHODS) {
        const fn = r[name];
        if (typeof fn !== 'function') continue;
        r[name] = function wrapped(...a) {
          const t0 = performance.now();
          try { return fn.apply(this, a); }
          finally { log.push({ what: name, ms: performance.now() - t0 }); }
        };
      }
      const sched = r._worldInvalidationScheduler;
      if (sched && typeof sched.flush === 'function') {
        const realFlush = sched.flush.bind(sched);
        sched.flush = (...a) => {
          const t0 = performance.now();
          try { return realFlush(...a); }
          finally {
            const ms = performance.now() - t0;
            if (ms > 0.5) log.push({ what: 'scheduler.flush', ms });
          }
        };
      }
      if (typeof g.save === 'function') {
        const realSave = g.save.bind(g);
        g.save = (...a) => {
          const t0 = performance.now();
          try { return realSave(...a); }
          finally { log.push({ what: 'game.save', ms: performance.now() - t0 }); }
        };
      }

      // Make sure the sim is actually running, then let it tick.
      g.state.paused = false;
      if (typeof g.setPaused === 'function') g.setPaused(false);
      const started = performance.now();
      await new Promise(res => setTimeout(res, 25000));
      const elapsedS = (performance.now() - started) / 1000;

      const byName = new Map();
      for (const e of log) {
        const hit = byName.get(e.what) || { what: e.what, calls: 0, total: 0, max: 0 };
        hit.calls++;
        hit.total += e.ms;
        hit.max = Math.max(hit.max, e.ms);
        byName.set(e.what, hit);
      }
      return {
        elapsedS: +elapsedS.toFixed(1),
        tick: g.state.tick,
        rows: [...byName.values()]
          .map(h => ({
            what: h.what, calls: h.calls,
            totalMs: +h.total.toFixed(1),
            avgMs: +(h.total / h.calls).toFixed(1),
            maxMs: +h.max.toFixed(1),
            perSec: +(h.calls / elapsedS).toFixed(2),
          }))
          .sort((a, b) => b.totalMs - a.totalMs),
      };
    });

    // ── Lights: the single biggest lever in a forward renderer ───────────
    const lights = await page.evaluate(() => {
      const r = window._renderer;
      const byType = {};
      let shadowCasters = 0;
      const owners = {};
      r.scene.traverse((o) => {
        if (!o.isLight) return;
        byType[o.type] = (byType[o.type] || 0) + 1;
        if (o.castShadow) shadowCasters++;
        let top = o;
        while (top.parent && top.parent !== r.scene) top = top.parent;
        const key = top.name || top.type;
        owners[key] = (owners[key] || 0) + 1;
      });
      return {
        byType,
        shadowCasters,
        owners,
        shadowMapEnabled: r.renderer.shadowMap.enabled,
        shadowMapType: r.renderer.shadowMap.type,
        pixelRatio: r.renderer.getPixelRatio(),
        drawingBuffer: [r.renderer.domElement.width, r.renderer.domElement.height],
        toneMapping: r.renderer.toneMapping,
      };
    });

    // ── A/B experiments: relative render() cost under scene variations ───
    // Relative ratios survive the software backend even though absolute ms
    // do not. Each variation is applied, measured over N frames, reverted.
    const experiments = await page.evaluate(async () => {
      const r = window._renderer;
      const gl = r.renderer;
      const scene = r.scene;
      const step = () => new Promise(res => requestAnimationFrame(res));

      const timeRender = async (frames = 12) => {
        const samples = [];
        for (let i = 0; i < frames; i++) {
          await step();
          const t0 = performance.now();
          gl.render(scene, r.camera);
          samples.push(performance.now() - t0);
        }
        samples.sort((a, b) => a - b);
        return +samples[Math.floor(samples.length / 2)].toFixed(2);
      };

      const results = [];
      results.push({ name: 'baseline', ms: await timeRender() });

      // 1 — all lights off except the first directional (sun)
      {
        const off = [];
        let keptSun = false;
        scene.traverse((o) => {
          if (!o.isLight) return;
          if (!keptSun && o.isDirectionalLight) { keptSun = true; return; }
          if (o.visible) { o.visible = false; off.push(o); }
        });
        results.push({ name: 'sun only (other lights off)', ms: await timeRender(), n: off.length });
        for (const o of off) o.visible = true;
      }

      // 2 — shadows off
      {
        const was = gl.shadowMap.enabled;
        gl.shadowMap.enabled = false;
        scene.traverse(o => { if (o.isLight && o.castShadow) o.castShadow = false; });
        results.push({ name: 'shadows off', ms: await timeRender() });
        gl.shadowMap.enabled = was;
      }

      // 3 — walls hidden
      for (const key of ['walls', 'equipment', 'decorations']) {
        const grp = scene.children.find(c => c.name === key);
        if (!grp) continue;
        const was = grp.visible;
        grp.visible = false;
        results.push({ name: `${key} hidden`, ms: await timeRender() });
        grp.visible = was;
      }

      return results;
    });

    // ── Scene structure ──────────────────────────────────────────────────
    const scene = await page.evaluate(() => {
      const r = window._renderer;
      const info = r.renderer.info;
      const census = [];
      let meshes = 0, objects = 0, visibleMeshes = 0, tris = 0;
      for (const child of r.scene.children) {
        let m = 0, v = 0;
        child.traverse((o) => {
          objects++;
          if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
          m++;
          meshes++;
          let vis = o.visible;
          for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
          if (vis) { v++; visibleMeshes++; }
          const g = o.geometry;
          if (vis && g?.attributes?.position) {
            tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
          }
        });
        if (m) census.push({ group: child.name || child.type, meshes: m, visible: v });
      }
      census.sort((a, b) => b.meshes - a.meshes);
      // Analytic draw-call count. renderer.info.render.calls is NOT usable
      // here: the frame issues ~27 render() passes and the value we can read
      // afterwards belongs to whichever pass happened to run last, so it
      // neither totals the frame nor isolates the main pass. Counting
      // submissions off the scene graph is backend- and pass-independent:
      // one call per BatchedMesh, otherwise one per distinct material group.
      let analyticCalls = 0;
      r.scene.traverse((o) => {
        if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
        let vis = o.visible;
        for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
        if (!vis) return;
        if (o.isBatchedMesh) { analyticCalls += 1; return; }
        const groups = o.geometry?.groups?.length || 0;
        analyticCalls += Array.isArray(o.material) ? Math.max(1, groups) : 1;
      });

      return {
        analyticCalls,
        drawCallsLastPass: info.render.calls,
        trianglesDrawn: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? -1,
        lights: r.scene.children.reduce((n, c) => {
          let k = 0; c.traverse(o => { if (o.isLight) k++; }); return n + k;
        }, 0),
        totalObjects: objects,
        totalMeshes: meshes,
        visibleMeshes,
        visibleTriangles: Math.round(tris),
        census: census.slice(0, 14),
      };
    });

    const fps = (ms) => (ms ? +(1000 / ms).toFixed(1) : 0);
    const line = (label, s) => s
      ? `  ${label.padEnd(20)} n=${String(s.n).padStart(4)}  mean ${String(s.mean).padStart(7)}ms  p50 ${String(s.p50).padStart(7)}  p95 ${String(s.p95).padStart(7)}  p99 ${String(s.p99).padStart(7)}  max ${String(s.max).padStart(8)}`
      : `  ${label.padEnd(20)} (no samples)`;

    console.log(`
=== Major Lab — frame cost (headless SwiftShader; ms are CPU-bound, counts are real) ===

world            floors=${world.floors}  walls=${world.walls}  placeables=${world.placeables}
boot to ready    ${bootMs} ms

IDLE (camera still)
${line('frame', idle.frame)}
${line('  render()', idle.render)}
${line('  game.tick()', idle.tick)}
   implied fps    ${fps(idle.frame?.mean)} mean / ${fps(idle.frame?.p95)} at p95

CAMERA MOVING (pan + zoom)
${line('frame', moving.frame)}
${line('  render()', moving.render)}
${line('  game.tick()', moving.tick)}
   implied fps    ${fps(moving.frame?.mean)} mean / ${fps(moving.frame?.p95)} at p95

SCENE
  draw calls      ${scene.analyticCalls}   (analytic, per main pass — trustworthy)
  info.calls      ${scene.drawCallsLastPass}   (last pass only — NOT a frame total)
  triangles drawn ${scene.trianglesDrawn}
  visible meshes  ${scene.visibleMeshes} of ${scene.totalMeshes}
  visible tris    ${scene.visibleTriangles}
  objects         ${scene.totalObjects}
  geometries      ${scene.geometries}
  textures        ${scene.textures}
  shader programs ${scene.programs}
  lights          ${scene.lights}

  mesh census (top groups)
${scene.census.map(c => `    ${String(c.group).padEnd(34)} ${String(c.meshes).padStart(6)} meshes  ${String(c.visible).padStart(6)} visible`).join('\n')}

FRAME DECOMPOSITION — idle, ${passes.frames} frames, ${passes.totalPasses} render() calls
  render passes PER FRAME   ${passes.passesPerFrame}
  draw calls    PER FRAME   ${passes.callsPerFrame}

  by render target:
${passes.groups.map(g => `    ${g.shape.padEnd(38)} ${String(g.perFrame).padStart(6)}/frame  ${String(g.callsPerFrame).padStart(7)} calls/frame  (avg ${g.avgCalls}, max ${g.maxCalls})  ${g.msPerFrame}ms/frame`).join('\n')}

STALL HUNT (${stalls.totalFrames} frames of camera motion)
  median ${stalls.medianMs}ms   p95 ${stalls.p95Ms}ms   max ${stalls.maxMs}ms
  frames >3x median          ${stalls.spikeCount}
  frames with a state change ${stalls.changeCount}
  spikes that coincide       ${stalls.spikesWithStateChange} of ${stalls.spikeCount}
  shader programs (final)    ${stalls.finalPrograms}    lit materials ${stalls.finalLitMaterials}

  worst frames:
${stalls.worstFrames.map(f => `    f${String(f.i).padStart(3)}  ${String(f.ms).padStart(9)}ms  dProg=${f.dPrograms}  dGeo=${f.dGeometries}  dTex=${f.dTextures}  dMesh=${f.dMeshes}  dLit=${f.dLit}  dLights=${f.dLights}`).join('\n')}

  frames that changed state:
${stalls.changedFrames.length
  ? stalls.changedFrames.map(f => `    f${String(f.i).padStart(3)}  ${String(f.ms).padStart(9)}ms  dProg=${f.dPrograms}  dGeo=${f.dGeometries}  dTex=${f.dTextures}  dMesh=${f.dMeshes}  dLit=${f.dLit}`).join('\n')
  : '    (none — scene state was completely static during the pan)'}

REBUILD ATTRIBUTION (sim running ${rebuilds.elapsedS}s, game tick ${rebuilds.tick})
${rebuilds.rows.length
  ? rebuilds.rows.map(r2 => `    ${r2.what.padEnd(32)} calls=${String(r2.calls).padStart(5)} (${String(r2.perSec).padStart(6)}/s)  total=${String(r2.totalMs).padStart(9)}ms  avg=${String(r2.avgMs).padStart(8)}ms  max=${String(r2.maxMs).padStart(9)}ms`).join('\n')
  : '    (nothing rebuilt while the sim ran)'}

LIGHTS
  by type         ${JSON.stringify(lights.byType)}
  shadow casters  ${lights.shadowCasters}
  shadowMap       enabled=${lights.shadowMapEnabled} type=${lights.shadowMapType}
  owned by group  ${JSON.stringify(lights.owners)}
  pixelRatio      ${lights.pixelRatio}   drawingBuffer=${lights.drawingBuffer.join('x')}

A/B — median render() cost per variation (ratios meaningful, absolutes are not)
${experiments.map(e => `    ${String(e.name).padEnd(34)} ${String(e.ms).padStart(8)} ms${e.n != null ? `   (${e.n} lights disabled)` : ''}`).join('\n')}
`);

    errors.checkAll('perf profile');
  });
});
