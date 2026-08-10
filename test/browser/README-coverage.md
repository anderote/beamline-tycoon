# Browser-level tests (`npm run test:browser`)

Everything under `test/` except this directory runs headless against the model
layer. These specs run the **actual app** — vite dev server, ES modules, three.js,
Pyodide, DOM HUD, real mouse and keyboard input — in headless Chromium.

```
npm run test:browser            # all specs
npm run test:browser -- smoke   # one spec
npm run test:browser:headed     # watch it happen
```

Playwright starts a throwaway vite server on **port 8123** (`BT_TEST_PORT` to
change) and tears it down on pass, fail, or interrupt. It never touches port
8000, so a dev server you already have running is left alone.

The test server runs `test/browser/vite.test.config.mjs`, which is the normal
dev config **with HMR disabled**. That matters in a shared checkout: with HMR
on, any edit anywhere in the repo makes vite push a `full-reload` to the page,
which kills the running spec with the unhelpful "Execution context was
destroyed, most likely because of a navigation". `reuseExistingServer` is off
for the same reason — a stray plain `vite` on 8123 would have HMR live.

The specs also intercept `demo-commands.json`. In dev, `main.js` polls that
file every 800ms and `eval`s any command whose `seq` is higher than the last
one it ran, so without the intercept every test tab would execute whatever the
last hands-on dev session left behind in `public/demo-commands.json`.

## The WebGL prerequisite

Headless Chromium has no GPU, so `new THREE.WebGLRenderer()` throws and the app
never finishes booting — which is why the previous Puppeteer harnesses were
useless regardless of what they asserted. `SWIFTSHADER_ARGS` in `helpers.mjs`
routes WebGL through ANGLE's SwiftShader (CPU) backend:

```
--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --disable-gpu-sandbox
```

Verified in this environment: `WebGL 2.0 (OpenGL ES 3.0 Chromium)`,
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)`,
~2.6k draw calls and ~390k triangles per frame. Every spec calls
`expectRendererLive()`, which fails if the context is lost or no frame was drawn —
so a regression back to "no GL" reports itself instead of passing vacuously.

## What the three specs own

| Spec | Owns | Runtime |
| --- | --- | --- |
| `smoke.spec.mjs` | One continuous session: title → New Game → floor/wall/decoration → junctions → beam pipe → on-pipe component → utility line → beam on → save/reload/Continue → undo/redo → Escape from every UI layer. Everything world-mutating goes through real canvas input. | ~3–8 min |
| `render-placement.spec.mjs` | Every `COMPONENTS` entry placed through the path its **current** taxonomy calls for, rendered, and disposed. Replaces `test-render-placement.mjs`. | ~6 min |
| `palette-arm.spec.mjs` | Every palette item in every mode/category: arm via real clicks, hover-preview, commit, Escape-teardown. Replaces `test-ui-placement.mjs`. | ~6 min |

Runtime is dominated by software-GL frame cost: an armed build tool re-renders
its ghost every frame, and every placement triggers a full scene rebuild.
Both of the sweep specs clear the generated map (~1k decorations) at boot for
exactly this reason.

Each spec's header comment carries its own detailed covers / does-not-cover list.
The short version of what **none** of them do:

- **No pixel assertions.** They prove the renderer runs and does not throw; they
  do not prove anything looks right. There is no visual-regression baseline.
- **No physics or economy assertions.** Pyodide loads and the beam runs, but the
  numbers belong to `test/test_*.py` and the node suites.
- **No coverage of** research purchasing, staff, scenarios, the Designer's
  editing surface, demolish/move/blueprint gestures, or cloud saves.

## Errors are the primary assertion

`createErrorCollector` records every `pageerror` and every `console.error` and
fails the step that produced it. One ignore rule exists, URL-anchored and
documented in `helpers.mjs`: Chromium's resource-load message for
`/api/beamline-tycoon/*`, which `vite.config.js` proxies to a cloud-save backend
that does not run locally (`CloudSaves.detect()` is built to swallow it). Nothing
else is filtered.

## Why this is not in `npm test`

`npm test` is ~62 suites in about a minute with no external dependencies. The
browser suite needs `npx playwright install chromium` (a ~150 MB download), a
vite server, and CDN reachability for `three.min.js` (jsDelivr) and Pyodide,
and takes **15–20 minutes** end to end under software GL — an order of
magnitude more than everything else combined. Folding it into `npm test` would
turn the fast gate into a coffee break and make it fail offline.

Keep it separate; run `npm run test:browser` before anything that touches the
renderer, the input layer, or the HUD, and in CI as its own job.

## What these found on their first green run

- **`ComponentBuilder._disposeWrapper` threw on every multi-material mesh.**
  `child.material.dispose()` is not a function when `material` is an array, and
  29 of the 57 free-grid infrastructure components (`solidStateAmp`,
  `modulator`, `rackIoc`, `shielding`, `beamDump`, `powerPanel`, …) build
  untagged meshes with 6-material arrays. Every removal of one of those aborted
  the component rebuild inside `_refreshComponents`'s try/catch. Fixed in
  `src/renderer3d/component-builder.js`; `render-placement.spec.mjs` is the
  regression net.
- `WelcomeDialog` registers no `esc-stack` handler, so Escape does not close the
  first-run guide the way it closes every other dialog. **Not fixed** — it
  belongs with the dialog-base convergence work. `smoke.spec.mjs` asserts the
  current behaviour so the gap is pinned rather than forgotten.

## Two behaviours worth knowing before you write a spec here

- **A click on existing equipment opens its inspector window, and that window
  owns Escape.** The esc-stack gives the topmost layer the key, so "press
  Escape, expect the tool to disarm" is only true when no window is open.
  `palette-arm.spec.mjs` closes any such window first.
- **Context windows re-render on every 1 Hz tick**, which detaches their action
  buttons out from under a click. `smoke.spec.mjs` pauses the sim (via the HUD
  pause button) before driving the beamline window.

## Status (paused 2026-08-09) — WORK IN PROGRESS

Landed mid-development, not finished. Known state:

- **SwiftShader works.** The long-standing blocker (headless Chromium has no
  WebGL, so ThreeRenderer never booted) is solved — the specs drive the real
  renderer. That was the hard part.
- **Full pass/fail is unconfirmed.** A complete run exceeds ~7 minutes and was
  never observed finishing. Individual specs were progressing without reported
  failures, which is weak evidence, not a green suite.
- **The server leaks on interrupt.** Playwright's `webServer` teardown does not
  fire when the run is killed or times out, leaving vite on 8123 and making the
  next run fail with "port is already used". Fix before wiring into CI:
  `lsof -ti :8123 | xargs kill` in a pretest step, or manage the server outside
  Playwright.
- **Deliberately NOT in `npm test`** — it must prove stable across three
  consecutive full runs first.
- The two former Puppeteer harnesses (`test-render-placement.mjs`,
  `test-ui-placement.mjs`) were deleted; `render-placement.spec.mjs` supersedes
  them and fixes their stale premise (they assumed every `placement: 'module'`
  component was free-grid placeable, which is false for the 19 `role:'placement'`
  components that must go on a pipe).
