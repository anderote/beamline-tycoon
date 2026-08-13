// test/browser/helpers.mjs — shared plumbing for the Playwright browser specs.
//
// Three jobs:
//   1. The Chromium flags that give headless a working software WebGL stack
//      (see SWIFTSHADER_ARGS — playwright.config.mjs passes them through).
//   2. Error collection: every page error and console.error the app produces
//      during a spec, with one narrowly-scoped ignore list.
//   3. Boot + coordinate helpers, so specs can say "click tile (12, 8)"
//      instead of hand-solving the isometric projection.

import { expect } from '@playwright/test';

/**
 * Headless Chromium ships no GPU, so WebGL is unavailable by default and
 * ThreeRenderer.init() throws before the app ever boots. These flags route
 * WebGL through ANGLE's SwiftShader (CPU) backend instead:
 *   --use-gl=angle / --use-angle=swiftshader  pick the software backend
 *   --enable-unsafe-swiftshader               opt in (Chrome 120+ gates it)
 *   --disable-gpu-sandbox                     SwiftShader needs to JIT
 * Verified working: WebGL 2.0, "ANGLE (Google, Vulkan 1.3.0 (SwiftShader
 * Device ...))", ~2.6k draw calls / ~390k triangles per frame.
 */
export const SWIFTSHADER_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox',
  '--no-sandbox',
];

/**
 * Console entries that are environmental, not app defects. Kept deliberately
 * tiny and URL-anchored — anything not matched here fails the spec.
 *
 * /api/beamline-tycoon/*: vite.config.js proxies /api to localhost:8001 (the
 * Deep Tech Week cloud-save backend), which nothing runs locally, so the
 * proxy answers 502. CloudSaves.detect() is built to swallow that and stay
 * in local-storage mode; the console line is Chromium's own resource-load
 * message, emitted before any app code sees the response.
 */
const IGNORED_CONSOLE = [
  { url: /\/api\/beamline-tycoon\//, text: /^Failed to load resource/ },
];

function fmt(e) {
  return `[${e.kind}] ${e.text}${e.url ? `  (${e.url})` : ''}`;
}

/**
 * Attach page-error / console-error listeners for the lifetime of `page`.
 *
 * `check(label)` asserts that nothing new arrived since the previous call,
 * so a failure names the step that produced it rather than dumping the whole
 * session at the end. `checkAll()` asserts over everything collected.
 */
export function createErrorCollector(page) {
  const all = [];
  let mark = 0;

  page.on('pageerror', (err) => {
    all.push({ kind: 'pageerror', text: `${err.name}: ${err.message}`, stack: err.stack });
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const url = msg.location()?.url || '';
    if (IGNORED_CONSOLE.some(r => r.url.test(url) && r.text.test(text))) return;
    all.push({ kind: 'console.error', text, url });
  });

  return {
    all,
    /** Assert no new errors since the last check; label names the step. */
    check(label) {
      const fresh = all.slice(mark);
      mark = all.length;
      expect(fresh.map(fmt), `uncaught page errors during: ${label}`).toEqual([]);
    },
    /** Assert nothing was collected at all. */
    checkAll(label = 'the whole session') {
      mark = all.length;
      expect(all.map(fmt), `uncaught page errors during: ${label}`).toEqual([]);
    },
  };
}

/** Resolves once main.js has finished wiring the renderer and input layer. */
export async function waitForBoot(page, timeout = 120_000) {
  await page.waitForFunction(
    () => !!(window.game?.state && window._renderer?._inputHandler),
    null,
    { timeout },
  );
}

/**
 * Assert the WebGL stack actually came up — a black page with a dead context
 * would otherwise sail through every DOM-level assertion below.
 */
export async function expectRendererLive(page) {
  const info = await page.evaluate(() => {
    const r = window._renderer;
    const gl = r?.renderer?.getContext?.();
    return {
      hasCanvas: !!r?.renderer?.domElement?.parentNode,
      contextLost: gl?.isContextLost?.() ?? true,
      version: gl?.getParameter?.(gl.VERSION) ?? null,
      calls: r?.renderer?.info?.render?.calls ?? 0,
      triangles: r?.renderer?.info?.render?.triangles ?? 0,
    };
  });
  expect(info.hasCanvas, 'three.js canvas is in the document').toBe(true);
  expect(info.contextLost, 'WebGL context is alive').toBe(false);
  expect(info.version, 'WebGL version string').toMatch(/WebGL/);
  expect(info.calls, 'draw calls in the last frame').toBeGreaterThan(0);
  expect(info.triangles, 'triangles in the last frame').toBeGreaterThan(0);
  return info;
}

/**
 * Install `window.__bt` — coordinate + world-query helpers used by the specs.
 * Re-run after every navigation (it lives on `window`, so reloads drop it).
 *
 * Implemented by dynamically importing the app's own modules off the dev
 * server, so the helpers can never drift from the game's real coordinate
 * math the way a re-implementation would.
 */
export async function installPageHelpers(page) {
  await page.evaluate(async () => {
    if (window.__bt) return;
    const grid = await import('/src/renderer/grid.js');
    const R = () => window._renderer;

    window.__bt = {
      /** Fractional tile under a viewport point (raycasts the real terrain). */
      tileAt(sx, sy) {
        const w = R().screenToWorld(sx, sy);
        return grid.isoToGridFloat(w.x, w.y);
      },

      /** A 3D world point (metres) -> viewport pixels. */
      worldToScreen(x, y, z) {
        const r = R();
        const el = document.getElementById('game');
        const v = new window.THREE.Vector3(x, y, z).project(r.camera);
        return {
          x: (v.x * 0.5 + 0.5) * el.clientWidth,
          y: (-v.y * 0.5 + 0.5) * el.clientHeight,
        };
      },

      // tileToScreen solves by raycasting the terrain mesh, which is the
      // single most expensive thing these specs do under software GL. The
      // camera only moves via centerOn, so results are memoised until then.
      _tileScreenCache: new Map(),

      /** Put tile (col,row) at the middle of the viewport. */
      centerOn(col, row, zoom) {
        const r = R();
        if (zoom) r.zoom = zoom;
        r._panX = col * 2 + 1;
        r._panY = row * 2 + 1;
        r._updateCameraLookAt();
        r._syncOverlayFromPan();
        r.refresh();
        this._tileScreenCache.clear();
      },

      /**
       * Viewport pixel whose ground raycast lands on the centre of tile
       * (col,row). Newton iteration against screenToWorld, so it follows
       * terrain elevation and view rotation instead of assuming a flat
       * rotation-0 projection.
       */
      tileToScreen(col, row) {
        const ck = col + ',' + row;
        const hit = this._tileScreenCache.get(ck);
        if (hit) return hit;
        const target = { col: col + 0.5, row: row + 0.5 };
        const el = document.getElementById('game');
        let sx = el.clientWidth / 2;
        let sy = el.clientHeight / 2;
        const h = 16;
        for (let i = 0; i < 24; i++) {
          const p0 = this.tileAt(sx, sy);
          const ec = target.col - p0.col;
          const er = target.row - p0.row;
          if (Math.abs(ec) < 0.01 && Math.abs(er) < 0.01) break;
          const px = this.tileAt(sx + h, sy);
          const py = this.tileAt(sx, sy + h);
          const a = (px.col - p0.col) / h, b = (py.col - p0.col) / h;
          const c = (px.row - p0.row) / h, d = (py.row - p0.row) / h;
          const det = a * d - b * c;
          if (!det) break;
          sx += (d * ec - b * er) / det;
          sy += (-c * ec + a * er) / det;
        }
        const out = { x: Math.round(sx), y: Math.round(sy) };
        this._tileScreenCache.set(ck, out);
        return out;
      },

      /** True when nothing occupies the tile and nothing blocks building. */
      tileIsClear(col, row) {
        const s = window.game.state;
        if (s.infraOccupied[col + ',' + row]) return false;
        if (window.game._decorationAtTile(col, row)) return false;
        for (let sc = 0; sc < 4; sc++) {
          for (let sr = 0; sr < 4; sr++) {
            if (s.subgridOccupied[`${col},${row},${sc},${sr}`]) return false;
          }
        }
        return true;
      },

      /**
       * Top-left of the first w x h block of clear tiles, or null.
       * Bounded to the generated map (a new game's state.mapHalfExtent is 30,
       * so anything outside |col|,|row| <= 30 is off-terrain void that would
       * make placements render into nothing). Land purchases grow that; these
       * specs never buy any, so the starting bound is the right one here.
       */
      findClearArea(w, h, limit = 30) {
        for (let r0 = -limit; r0 + h <= limit; r0++) {
          scan: for (let c0 = -limit; c0 + w <= limit; c0++) {
            for (let c = c0; c < c0 + w; c++) {
              for (let r = r0; r < r0 + h; r++) {
                if (!this.tileIsClear(c, r)) continue scan;
              }
            }
            return { col: c0, row: r0 };
          }
        }
        return null;
      },

      /** Compact world summary the specs assert against. */
      worldSummary() {
        const s = window.game.state;
        return {
          placeables: s.placeables.length,
          infraTiles: Object.keys(s.infraOccupied || {}).length,
          walls: (s.walls || []).length,
          pipes: (s.beamPipes || []).length,
          pipePlacements: (s.beamPipes || []).reduce((n, p) => n + (p.placements?.length || 0), 0),
          utilityLines: s.utilityLines?.size ?? 0,
          funding: Math.round(s.resources.funding),
        };
      },
    };
  });
}

/**
 * Neutralise the dev-only remote-drive channel. main.js polls
 * public/demo-commands.json every 800ms in DEV and `eval`s whatever command
 * it finds with a higher seq than the last — so every test tab would execute
 * whatever the last hands-on dev session happened to leave in that file
 * (currently a renderer eval; `{"action":"reset"}` would clear localStorage
 * and reload the page mid-spec). Stub it so the poll is a no-op and the specs
 * are hermetic.
 */
export async function blockRemoteDrive(page) {
  // Answer 200 with seq 0 — main.js drops anything at or below the last seq
  // it ran, so the poll becomes a no-op. (A 404 would work too, but Chromium
  // logs every failed fetch as a console error, once per 800ms poll.)
  await page.route('**/demo-commands.json*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"seq":0}' }));
}

/** Accept every confirm()/alert() the app raises (New Game, Load, ...). */
export function autoAcceptDialogs(page) {
  page.on('dialog', d => d.accept().catch(() => {}));
}

/**
 * Boot straight into a fresh game, skipping the title screen.
 *
 * Used by every spec except the smoke walk, which drives the title screen
 * itself. The skipTitle session flag is the same one main.js sets for the
 * "New Game" reload, so this is the app's own fast path, not a test-only
 * back door.
 */
export async function bootFreshGame(page) {
  await blockRemoteDrive(page);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.setItem('beamlineTycoon.skipTitle', '1');
    } catch { /* first navigation has no storage access */ }
  });
  await page.goto('/');
  await waitForBoot(page);
  await dismissWelcome(page);
  await installPageHelpers(page);
}

/**
 * Close the first-run guide if it is up. It stays in the DOM and hides via
 * the `hidden` class, so visibility (not count) is the signal.
 *
 * NOTE: WelcomeDialog does not register an esc-stack handler, so Escape does
 * not close it — hence the explicit button click here.
 */
export async function dismissWelcome(page) {
  const dialog = page.locator('#welcome-dialog');
  if (await dialog.isVisible().catch(() => false)) {
    await page.locator('#welcome-dialog .welcome-close').click();
    await expect(dialog).toBeHidden();
  }
}

/** Give the renderer a couple of frames plus a settle margin. */
export async function frames(page, n = 2) {
  await page.evaluate((count) => new Promise((res) => {
    let i = 0;
    const step = () => (++i >= count ? res() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }), n);
}

/** Arm a palette tool through the real HUD: mode button -> tab -> item. */
export async function armPaletteTool(page, mode, category, kind, key) {
  await page.click(`.mode-btn[data-mode="${mode}"]`);
  await page.click(`.cat-tab[data-category="${category}"]`);
  await page.click(
    `#component-palette .palette-item[data-palette-kind="${kind}"][data-palette-key="${key}"]`,
  );
  // Every palette kind builds a Tool whose id is `${kind}:${key}` — the one
  // assertion that proves the click actually reached selectPaletteTool.
  await expect
    .poll(() => page.evaluate(() => window._renderer._inputHandler.activeTool?.id ?? null))
    .toBe(`${kind}:${key}`);
}

/** Left-click the world canvas at tile (col,row). */
export async function clickTile(page, col, row) {
  const p = await page.evaluate(([c, r]) => window.__bt.tileToScreen(c, r), [col, row]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  return p;
}

/**
 * Left-click the world canvas at a 3D ground point (metres). Used where a
 * tile centre is not precise enough — utility ports snap on sub-tile
 * geometry, so placement has to be aimed at world coordinates.
 */
export async function clickWorld(page, worldX, worldZ) {
  const p = await page.evaluate(([x, z]) => window.__bt.worldToScreen(x, 0, z), [worldX, worldZ]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  return p;
}

/** Press-drag-release across the world canvas, from one tile to another. */
export async function dragTiles(page, from, to, steps = 6) {
  const a = await page.evaluate(([c, r]) => window.__bt.tileToScreen(c, r), from);
  const b = await page.evaluate(([c, r]) => window.__bt.tileToScreen(c, r), to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps);
  }
  await page.mouse.up();
  return { a, b };
}
