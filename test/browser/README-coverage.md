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
change). It never touches port 8000, so a dev server you already have running is
left alone.

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

## The leaked-server problem, and how it is handled

Playwright's `webServer` teardown runs on pass, fail and Ctrl-C — but **not**
when the run is SIGKILLed or the process that launched it times out. The
detached vite survives, and the next run dies on `strictPort` with
"Port 8123 is already in use". This bit twice during development.

`scripts/free-test-port.mjs` reclaims the port (SIGTERM, then SIGKILL, waiting
for the listener to actually close) and runs from **both** entry points:

* `npm run test:browser` — via its `pretest:browser` hook;
* `npx playwright test` — from `playwright.config.mjs`'s module body, before
  `webServer` binds.

Playwright re-loads the config inside every worker process, where killing the
port would take down the run it belongs to, so the config path is guarded twice:
it skips when `TEST_WORKER_INDEX` is set, and again on the `BT_TEST_PORT_FREED`
env var it stamps for the workers to inherit.

Verified: SIGKILL a run mid-flight, confirm `lsof -ti tcp:8123` still shows the
orphan, start the next run — it prints `[free-test-port] reclaimed :8123 from
pid N` and goes green.

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

Software GL runs the title screen at roughly **3 fps**, against ~50 fps headed on
the real GPU. Nothing here may assume a frame rate: `frames(page, n)` waits on
`requestAnimationFrame`, and everything else waits on a condition
(`expect.poll`), never on a fixed sleep.

## What the four specs own

| Spec | Owns | Runtime |
| --- | --- | --- |
| `smoke.spec.mjs` | One continuous session: title → New Game → floor/wall/decoration → junctions → beam pipe → on-pipe component → utility line → beam on → save/reload/Continue → undo/redo → Escape from every UI layer. Everything world-mutating goes through real canvas input. | 1.1–2.7 min |
| `render-placement.spec.mjs` | Every `COMPONENTS` entry placed through the path its **current** taxonomy calls for, rendered, and disposed. Replaces `test-render-placement.mjs`. | 2.7–4.9 min |
| `palette-arm.spec.mjs` | Every palette item in every mode/category: arm via real clicks, hover-preview, commit, Escape-teardown. Replaces `test-ui-placement.mjs`. | 4.4–7.4 min |
| `preview-regress.spec.mjs` | Three placement-preview defects from commit `3e81e9f8` that no other suite can see: keyboard-arm ghost, stackable ghost vs. a component's invisible hitbox, decoration rotation. | 0.5–1 min |
| `design-ghost.spec.mjs` | The blueprint placement ghost: that it renders at all, tracks the cursor and the rotate key, tears its prototype cache down on cancel, reuses prototype geometry across rebuilds rather than allocating, and — the fidelity check — stands at exactly the poses the click then builds. | 1–4 min |

The low end of each range is the spec run on its own on an otherwise idle
machine; the high end is the same spec inside a full run with other heavy work
on the box. Software GL is CPU-bound, so these numbers move with load by
roughly 2x — treat them as an order of magnitude, not a budget.

Runtime is dominated by software-GL frame cost: an armed build tool re-renders
its ghost every frame, and every placement triggers a full scene rebuild.
The three specs that are not the smoke walk clear the generated map
(~1k decorations) at boot for exactly this reason.

Each spec's header comment carries its own detailed covers / does-not-cover list.
The short version of what **none** of them do:

- **No pixel assertions.** They prove the renderer runs and does not throw; they
  do not prove anything looks right. There is no visual-regression baseline.
  `preview-regress.spec.mjs` asserts scene-graph *transforms*, which is as close
  as this harness gets.
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

Not a stability call — the suite is stable (see Status). It is a cost call, and
the answer stays no:

* `npm test` is 65 suites in about a minute. A full browser run is **9–16
  minutes**, an order of magnitude more than everything else combined.
* It needs `npx playwright install chromium` (a ~150 MB download) that nothing
  else in the repo requires.
* It needs the network: `three.min.js` from jsDelivr and Pyodide from its CDN.
  `npm test` currently passes offline; folding this in would end that.

Keep it separate; run `npm run test:browser` before anything that touches the
renderer, the input layer, or the HUD, and in CI as its own job.

## What these found

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

## Behaviours worth knowing before you write a spec here

- **A click on existing equipment opens its inspector window, and that window
  owns Escape.** The esc-stack gives the topmost layer the key, so "press
  Escape, expect the tool to disarm" is only true when no window is open.
  `palette-arm.spec.mjs` closes any such window first.
- **Context windows re-render on every 1 Hz tick**, which detaches their action
  buttons out from under a click. `smoke.spec.mjs` pauses the sim (via the HUD
  pause button) before driving the beamline window.
- **The beam needs a *working* operator, and operators tire on a wall clock.**
  An operator goes `onBreak` after ~40 ticks, which a long walk reaches before
  it gets to "Start Beam" — so the beam trips on `beam_unstaffed` at a moment
  that depends on how fast the machine ran the earlier steps. `smoke.spec.mjs`
  resets the roster in its scaffolding step rather than racing it.
- **`InputHandler.lastMouseWorldX/Y` only updates in the no-tool branch** of the
  canvas mousemove handler; with a tool armed the tool owns the move. And the
  listener is bound to the canvas, so clicking HUD elements never moves the
  world cursor — which is what makes the keyboard-arm assertion in
  `preview-regress.spec.mjs` meaningful.

## Status (2026-08-10) — green and stable

Three consecutive full runs, no retries, nothing quarantined:

| Run | Result | Wall clock |
| --- | --- | --- |
| 1 | 4 passed | 13.3 min |
| 2 | 4 passed | 14.2 min |
| 3 | 4 passed | 17.5 min |

All three ran with other heavy work on the same machine; the specs measured
solo on an idle box total ~9 min. No spec contains a fixed sleep — every wait
is `requestAnimationFrame` or `expect.poll` — which is why the 30% run-to-run
spread costs nothing in flakes.

The two things that were open at the last checkpoint are closed: the server
leak is handled (see above, verified by SIGKILLing a run mid-flight), and a
full run finishing green is now an observed fact rather than an inference from
"no failures reported yet".

Three ordinary bugs, all of which the harness caught rather than tolerated:
the `smoke.spec.mjs` beam step was racing the staff fatigue clock (fixed in the
spec's scaffolding); `render-placement.spec.mjs` was already carrying the
`_disposeWrapper` fix described above; and the main-menu dropdown was
unclickable whenever the music player happened to land on it.

That third one is worth recording, because an earlier table in this section
claimed three green runs while the defect was still live — the failure is
position-dependent, so it hit roughly one full run in two and looked like
flake. It is an app bug, not a harness artifact: `.menu-dropdown` is a child of
`#top-bar`, whose `z-index: 100` opens a stacking context, so the dropdown's own
`z-index: 300` is scoped inside it. `#music-player` (101) therefore out-stacked
the entire open menu and intercepted the click on Save Game. `style.css` now
raises `#top-bar` while a menu is open (`#top-bar:has(.menu-dropdown:not(.hidden))`),
and the escape-ladder step in `smoke.spec.mjs` `elementFromPoint`s every menu
item it is about to click, so a stacking regression names the intercepting
layer instead of timing out after 20 s on `page.click`.

The two former Puppeteer harnesses (`test-render-placement.mjs`,
`test-ui-placement.mjs`) are gone; `render-placement.spec.mjs` supersedes them
and fixes their stale premise (they assumed every `placement: 'module'`
component was free-grid placeable, which is false for the 19 `role:'placement'`
components that must go on a pipe).
