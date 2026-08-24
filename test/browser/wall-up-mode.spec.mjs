// test/browser/wall-up-mode.spec.mjs — correctness probe for wall batching.
//
// WallBatcher collapses ~1400 authored wall pieces into ~24 BatchedMesh draw
// calls. This spec checks that the collapse is loss-free, on the real Major
// Lab map, in all three wall views. Gated behind BT_PERF=1 like the perf probe
// because it boots a 1700-tile facility and rebuilds its walls three times:
//
//   BT_PERF=1 npx playwright test wall-up-mode --reporter=list
//
// Three assertions, in order of how much they would have caught:
//
//  1. Draw-range stability. BatchedMesh.onBeforeRender turns each geometry's
//     element-space range into a BYTE offset using
//     `index.array.BYTES_PER_ELEMENT`, and three's WebGPU backend rewrites a
//     Uint16 index attribute to Uint32 in place the first time it uploads it.
//     An opaque batch computes its ranges once and reuses them forever, so a
//     range computed on the wrong side of that rewrite draws every instance
//     from halfway into some other wall's triangles — the "walls at the wrong
//     height and orientation" regression. Comparing the latched ranges with a
//     fresh recomputation catches it directly.
//  2. Triangle equivalence. Every triangle the builder authored (source mesh
//     x its own matrix) must appear exactly once among the triangles the
//     batches draw (batch index/position buffers x the instance matrix), and
//     under the same material. That covers per-face paint, which is the only
//     reason WallBatcher ever splits one mesh across buckets.
//  3. Batch count. The whole point is ~24 draw calls, not ~1400.
//
// The screenshots are for eyeballing; the numbers are the proof.

import { test, expect } from '@playwright/test';
import { waitForBoot, installPageHelpers } from './helpers.mjs';

const SCENARIO_URL = '/rescue/majorLab.scenario.json';
const ENABLED = process.env.BT_PERF === '1';

// This spec deliberately does NOT use the shared SwiftShader flags. Forcing
// ANGLE/SwiftShader also switches WebGPU off, and three's WebGPURenderer then
// silently falls back to its WebGL2 backend — which does NOT rewrite Uint16
// index buffers, and so does not reproduce the bug this spec exists to guard.
// Dawn's own SwiftShader adapter gives headless a real WebGPU device, which is
// the backend the player actually runs on.
test.use({
  launchOptions: {
    args: [
      '--enable-unsafe-webgpu',
      '--use-webgpu-adapter=swiftshader',
      '--enable-features=Vulkan',
      // ...and keep a working software WebGL2 behind it as the fallback path.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      '--no-sandbox',
    ],
    ignoreDefaultArgs: ['--disable-gpu'],
  },
});

test.describe('wall batching', () => {
  test.skip(!ENABLED, 'diagnostic lane — set BT_PERF=1 to run');
  test.setTimeout(900_000);

  test('batched walls draw exactly what the builder authored', async ({ page, baseURL }) => {
    const res = await page.request.get(`${baseURL}${SCENARIO_URL}`);
    expect(res.ok()).toBe(true);
    const exported = await res.json();

    await page.addInitScript((exp) => {
      localStorage.setItem('beamlineTycoon.customScenarios.' + exp.id, JSON.stringify({
        id: exp.id, name: exp.name, desc: '', data: exp.data, sandbox: true, updatedAt: 1,
      }));
      localStorage.setItem('beamlineTycoon.customScenarioIndex', JSON.stringify([
        { id: exp.id, name: exp.name, desc: '', sandbox: true, updatedAt: 1 },
      ]));
      localStorage.setItem('beamlineTycoon.pendingScenario', '__custom__:' + exp.id);
    }, exported);

    await page.goto('/');
    await waitForBoot(page);
    await page.waitForTimeout(4000);
    await installPageHelpers(page);

    // Get transient welcome and guide overlays out of the shot.
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
    await page.evaluate(() => {
      for (const el of document.querySelectorAll(
        '.modal-overlay, .dialog-overlay, [class*="welcome"], [class*="guide-overlay"]')) {
        el.remove();
      }
    });

    // Frame the walled part of the facility with the app's own camera helper.
    const center = await page.evaluate(() => {
      const walls = window.game.state.walls;
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
      for (const w of walls) {
        if (w.col < minC) minC = w.col;
        if (w.col > maxC) maxC = w.col;
        if (w.row < minR) minR = w.row;
        if (w.row > maxR) maxR = w.row;
      }
      const cx = Math.round((minC + maxC) / 2), cy = Math.round((minR + maxR) / 2);
      window.__bt.centerOn(cx, cy, 1.6);
      return { cx, cy, walls: walls.length };
    });
    await page.waitForTimeout(2000);
    console.log(`framed on tile (${center.cx}, ${center.cy}) — ${center.walls} authored walls`);

    // Freeze the sim clock so the screenshots are comparable frame to frame.
    const pin = async () => page.evaluate(() => {
      const r = window._renderer;
      window.game.state.paused = true;
      window.game.pause?.();
      window.game.state.timeOfDay = 0.42;
      r._localTimeOfDay = 0.42;
      r._updateSunCycle?.();
    });

    const probe = async (mode) => page.evaluate((wallMode) => {
      const r = window._renderer;
      r.wallVisibilityMode = wallMode;
      r.wallBuilder._cacheKey = null;
      r._refreshWalls();

      const R3 = (v) => Math.round(v * 1000) / 1000;
      const triKey = (A, B, C, materialId) => {
        const pts = [A, B, C].map(p => [R3(p[0]), R3(p[1]), R3(p[2])]);
        pts.sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]) || (p[2] - q[2]));
        return `${pts[0]}|${pts[1]}|${pts[2]}#${materialId}`;
      };
      const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);

      // --- what the builder authored -------------------------------------
      // Keyed by (triangle, material) so a wall painted differently on its two
      // faces has to land in the right bucket, not merely somewhere.
      const authored = new Map();
      let authoredMeshes = 0, authoredTris = 0;
      const v = new THREE.Vector3();
      r.wallBuilder.forEachSourceMesh((m) => {
        authoredMeshes++;
        const geo = m.geometry;
        const idx = geo.getIndex();
        const pos = geo.attributes.position;
        if (!idx || !pos) return;
        // BatchedMesh round-trips instance matrices through a Float32 data
        // texture; mirror that quantisation so the comparison is exact.
        const mat = new THREE.Matrix4().fromArray(Float32Array.from(m.matrix.elements));
        const xf = new Float64Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mat);
          xf[i * 3] = v.x; xf[i * 3 + 1] = v.y; xf[i * 3 + 2] = v.z;
        }
        const at = (t) => { const o = idx.getX(t) * 3; return [xf[o], xf[o + 1], xf[o + 2]]; };
        const groups = geo.groups?.length
          ? geo.groups
          : [{ start: 0, count: idx.count, materialIndex: 0 }];
        for (const g of groups) {
          const gm = Array.isArray(m.material) ? m.material[g.materialIndex] : m.material;
          const mid = gm ? gm.id : -1;
          for (let t = g.start; t + 2 < g.start + g.count; t += 3) {
            bump(authored, triKey(at(t), at(t + 1), at(t + 2), mid));
            authoredTris++;
          }
        }
      });

      // --- what the batches draw ------------------------------------------
      const drawn = new Map();
      let batches = 0, instances = 0, drawnTris = 0, uint16Batches = 0;
      const mtx = new THREE.Matrix4();
      r.wallGroup.traverse((o) => {
        if (!o.isBatchedMesh) return;
        batches++;
        const geo = o.geometry;
        const idx = geo.getIndex();
        const pos = geo.attributes.position;
        if (idx.array.BYTES_PER_ELEMENT < 4) uint16Batches++;

        const mid = o.material.id;
        for (let i = 0; i < o._instanceInfo.length; i++) {
          if (!o._instanceInfo[i].active) continue;
          instances++;
          const gi = o._geometryInfo[o._instanceInfo[i].geometryIndex];
          o.getMatrixAt(i, mtx);
          const at = (t) => {
            v.fromBufferAttribute(pos, idx.getX(gi.start + t)).applyMatrix4(mtx);
            return [v.x, v.y, v.z];
          };
          const same = (p, q) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
          for (let t = 0; t + 2 < gi.count; t += 3) {
            const A = at(t), B = at(t + 1), C = at(t + 2);
            if (same(A, B) || same(B, C) || same(A, C)) continue; // reserved padding
            bump(drawn, triKey(A, B, C, mid));
            drawnTris++;
          }
        }
      });

      let missing = 0, extra = 0, sampleMissing = null, sampleExtra = null;
      for (const [k, n] of authored) {
        if ((drawn.get(k) || 0) < n) { missing++; sampleMissing ??= k; }
      }
      for (const [k, n] of drawn) {
        if ((authored.get(k) || 0) < n) { extra++; sampleExtra ??= k; }
      }

      return {
        mode: wallMode,
        authoredMeshes, authoredTris, batches, instances, drawnTris,
        missing, extra, sampleMissing, sampleExtra,
        uint16Batches,
      };
    }, mode);

    // Run AFTER frames have rendered, so the backend has had its chance to
    // rewrite the index attribute under the batch. Compares the draw ranges
    // each batch is actually going to keep using against a fresh computation.
    const rangeDrift = async () => page.evaluate(() => {
      const stub = { isArrayCamera: false, matrixWorld: new THREE.Matrix4() };
      let worst = 0, opaqueBatches = 0;
      window._renderer.wallGroup.traverse((o) => {
        if (!o.isBatchedMesh || o.sortObjects) return; // sorting batches redo this every pass
        opaqueBatches++;
        const latched = Array.from(o._multiDrawStarts.slice(0, o._multiDrawCount));
        o._visibilityChanged = true;
        o.onBeforeRender(null, null, stub, o.geometry, o.material);
        for (let i = 0; i < latched.length; i++) {
          worst = Math.max(worst, Math.abs(latched[i] - o._multiDrawStarts[i]));
        }
      });
      return { worst, opaqueBatches };
    });

    const results = [];
    for (const mode of ['transparent', 'up', 'cutaway']) {
      const r = await probe(mode);
      await pin();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `test-results/wall-${mode}.png`, timeout: 180_000, animations: 'disabled' });
      Object.assign(r, await rangeDrift());
      results.push(r);
    }

    console.log(`
=== WALL BATCHING ===
${results.map(r => [
  `  mode=${r.mode}`,
  `    authored ${r.authoredMeshes} meshes / ${r.authoredTris} tris`,
  `    batched  ${r.batches} meshes / ${r.instances} instances / ${r.drawnTris} tris`,
  `    authored but never drawn: ${r.missing}${r.sampleMissing ? `  e.g. ${r.sampleMissing}` : ''}`,
  `    drawn but never authored: ${r.extra}${r.sampleExtra ? `  e.g. ${r.sampleExtra}` : ''}`,
  `    latched draw-range drift: ${r.worst} bytes over ${r.opaqueBatches} opaque batches   16-bit-indexed batches: ${r.uint16Batches}`,
].join('\n')).join('\n')}
`);

    for (const r of results) {
      // The regression that broke the 'up' view: latched draw ranges that no
      // longer match the batch's own index buffer.
      expect(r.worst, `${r.mode}: latched draw ranges drifted from the index buffer`).toBe(0);
      expect(r.uint16Batches, `${r.mode}: batches left on a 16-bit index the backend will widen`).toBe(0);
      expect(r.extra, `${r.mode}: triangles drawn that were never authored`).toBe(0);
      expect(r.missing, `${r.mode}: authored triangles never drawn`).toBe(0);
      expect(r.batches, `${r.mode}: wall draw calls stayed batched`).toBeLessThan(60);
      expect(r.instances, `${r.mode}: every authored piece is represented`).toBeGreaterThanOrEqual(r.authoredMeshes);
    }
  });
});
