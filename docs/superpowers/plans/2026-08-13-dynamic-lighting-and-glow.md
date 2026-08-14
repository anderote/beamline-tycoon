# Dynamic Lighting and Glow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emissive screens and lamps, energy visibly flowing through utility runs in each utility's own colour and rhythm, and a small pool of real dynamic lights — with the flow gated on simulation state so the facility reads as telemetry.

**Architecture:** Promote `three` from a CDN global to an npm dependency (without touching the 31 files that use the bare `THREE` global), add a selective-bloom `EffectComposer` behind the existing half-resolution render, introduce a `glow` role in the component role-bucket system, and drive per-utility flow pulses through an `onBeforeCompile` patch on the already-shared per-type line materials.

**Tech Stack:** three.js 0.160.0 (npm), Vite 8, vanilla ES modules, node test runner via `npm test`, Playwright for browser tests.

**Spec:** `docs/superpowers/specs/2026-08-13-dynamic-lighting-and-glow-design.md`

## Global Constraints

- **Do not commit.** Leave all changes in the working tree. The user decides commit boundaries. (Per user's global CLAUDE.md.)
- **Do not create or switch branches. Do not push.**
- **Do not start or kill a dev server.** The user keeps one running; rely on it for manual verification.
- Pin `three` to exactly `0.160.0` — the version the CDN served. No library-version behaviour changes ride along with this work.
- The bare `THREE` global stays. Do **not** convert source files to `import * as THREE from 'three'`; six node tests inject a `globalThis.THREE` stub and would break.
- Tone mapping stays `NoToneMapping`; output colour space stays at its current default. Re-grading the game is out of scope.
- Visual register is **grounded industrial**: pulses modulate a pipe's own colour, they are not neon racing stripes.
- `_pixelScale = 2` — all render targets derive their size from it. Bloom radius is tuned in *low-res* pixels.
- Do not modify the fault **X** symbol (`buildFaultMark`) or how faults surface in the HUD.
- No save-format changes.

---

### Task 1: `three` as an npm dependency

**Files:**
- Create: `src/three-global.js`
- Modify: `package.json` (add dependency), `index.html:364` (remove CDN script tag), `src/main.js` (add first import)

**Interfaces:**
- Produces: a populated `globalThis.THREE` backed by the npm `three` package, available to every module evaluated after `src/main.js` begins. Later tasks import addons via `three/addons/postprocessing/*.js`.

- [ ] **Step 1: Add the dependency**

Add `"three": "0.160.0"` to `dependencies` in `package.json` (exact version, no caret) and install. Confirm `node_modules/three/package.json` exists and that its `exports` map resolves `three/addons/*` — if 0.160.0 does not expose the `addons` alias, later tasks use `three/examples/jsm/...` instead. Record which path works in a comment in `src/three-global.js`.

- [ ] **Step 2: Create `src/three-global.js`**

Two lines: `import * as THREE from 'three'` then `globalThis.THREE ??= THREE`. The `??=` is load-bearing — it guarantees this file can never clobber a pre-installed test stub. Comment must say so, and must say why the global survives at all (the 6 stub-injecting node tests, named).

- [ ] **Step 3: Wire it up**

Delete the `<script src="...three@0.160.0/build/three.min.js">` tag at `index.html:364`. Add `import './three-global.js';` as the **first** import in `src/main.js`. Ordering matters: `component-builder.js` builds `SHARED_MATERIALS` at module-evaluation time, so it needs `globalThis.THREE` populated before it evaluates. ES modules evaluate depth-first in import order, so first-import-of-the-single-entry-point is sufficient — but it must be verified by an actual boot, not by reasoning.

- [ ] **Step 4: Verify**

Run `npm test` — must pass unchanged, all stub-injecting tests included. Run `npm run build` — must succeed. Then confirm in the user's already-running dev server that the game boots to a rendered scene with **no network request for three from jsdelivr**. If the boot throws `THREE is not defined` from a module-scope initializer, the import ordering is wrong — fix the ordering, do not paper over it by deferring the initializer.

**Acceptance:** game boots and renders identically to before; no CDN request for three; `npm test` and `npm run build` both green.

---

### Task 2: Selective bloom composer + options toggle

**Files:**
- Create: `src/renderer3d/glow-pipeline.js`
- Modify: `src/renderer3d/ThreeRenderer.js` (composer construction near the renderer init at :448, `_setSize` at :2780, the render call at :2955), `src/ui/OptionsDialog.js` (View section)
- Test: `test/browser/smoke.spec.mjs` (extend)

**Interfaces:**
- Consumes: `globalThis.THREE` from Task 1.
- Produces:
  - `BLOOM_LAYER` — the integer layer index glow meshes are assigned to. Exported for Tasks 3 and 5.
  - `class GlowPipeline` with `constructor(renderer, scene, camera, opts)`, `setSize(w, h)`, `render()`, `setEnabled(bool)`, `get enabled()`.
  - `ThreeRenderer.setGlowEnabled(bool)`.

- [ ] **Step 1: Build `GlowPipeline`**

Wraps `EffectComposer` + `RenderPass` + `UnrealBloomPass` + a final additive-composite `ShaderPass`. `render()` implements the darken-non-bloomed recipe: cache and swap every material not on `BLOOM_LAYER` to a shared black `MeshBasicMaterial`, render the scene into the bloom target with `renderer.shadowMap.autoUpdate = false`, restore the cached materials, then render normally and composite the bloomed buffer additively.

The material cache is a reused `Map` cleared per frame, not reallocated — this runs every frame.

When `enabled` is false, `render()` falls straight through to `renderer.render(scene, camera)` and allocates no render targets.

Start with conservative bloom parameters (grounded industrial, tuned in low-res pixels): strength ~0.6, radius ~0.3, threshold ~0.85. These are a starting point to tune by eye in Task 3, not a specification.

- [ ] **Step 2: Wire into `ThreeRenderer`**

Construct the pipeline after the renderer and scene exist. `_setSize` must call `pipeline.setSize()` with the **same** `Math.floor(w / s)` / `Math.floor(h / s)` values it passes to `renderer.setSize` — the composer must live at the half-resolution buffer, not the CSS size. Replace `this.renderer.render(this.scene, this.camera)` at :2955 with the pipeline call. Add `setGlowEnabled(bool)` which forwards to the pipeline and persists nothing itself.

- [ ] **Step 3: Options toggle**

Add a **Glow & dynamic lighting** checkbox to the existing **View** section of `src/ui/OptionsDialog.js`, next to Zone overlay / Zone labels. Follow the file's established pattern exactly: an `#opt-glow` input in the markup, a `change` listener that calls `renderer.setGlowEnabled`, and initial state read in the same place the other View checkboxes read theirs. Persist to `localStorage['beamlineTycoon.glow']`, matching the `beamlineTycoon.music` convention already in the file. Default on. Read the stored value at renderer construction so the setting survives a reload.

- [ ] **Step 4: Verify the no-op**

With no glow materials registered yet, the composer path must render **pixel-comparable** output to the direct path. Bloom that visibly changes the scene before Task 3 exists means the threshold is wrong or a non-glow material is leaking onto the bloom layer — fix it now, because after Task 3 you can no longer tell the two causes apart.

Extend `test/browser/smoke.spec.mjs` to boot with the toggle both on and off and assert no console errors and a non-blank canvas in both.

**Acceptance:** game looks unchanged; toggling the option switches paths live without a reload; both paths boot clean in Playwright.

---

### Task 3: The `glow` role

**Files:**
- Modify: `src/renderer3d/component-builder.js` (`ROLES` at :190, `SHARED_MATERIALS` at :204, the per-placement loop at :330-358, `_getRoleTemplate` at :266), `src/renderer3d/builders/rf-builder.js:524`, `src/renderer3d/builders/vacuum-builder.js:408`, `src/renderer3d/ThreeRenderer.js` (`_updateSunCycle` at :2975)
- Test: `test/test-glow-role.js`

**Interfaces:**
- Consumes: `BLOOM_LAYER` from Task 2.
- Produces:
  - `getGlowMaterial(compType, colorHex)` in `component-builder.js` — same cache shape as the existing `getAccentMaterial`.
  - `setGlowNightFactor(k)` — applies a night multiplier to every registered glow material. Called from `_updateSunCycle`.

- [ ] **Step 1: Add the role**

Append `'glow'` to `ROLES`. Give it a `SHARED_MATERIALS` entry: emissive, low roughness, no map by default. In the per-placement loop at :330, glow resolves through `getGlowMaterial` rather than `SHARED_MATERIALS` (mirroring how `accent` is special-cased), and every glow mesh gets `mesh.layers.enable(BLOOM_LAYER)` plus `castShadow = false` — a lit screen must not cast a shadow.

Register each material into a module-level registry as it is created, so the night factor can reach them all.

- [ ] **Step 2: Night factor**

`setGlowNightFactor(k)` scales emissive intensity across the registry. Call it from `_updateSunCycle` using the `dayness` scalar it already computes — intensity rises as `dayness` falls. Clamp so screens are never fully dark at noon, just washed out. This is the first thing in the game that makes the day/night cycle consequential; verify by watching a full sun cycle (~1 hour of real time at the current `_sunCycleSpeed`, so temporarily raise the speed to check, then put it back).

- [ ] **Step 3: Bucket real surfaces into `b.glow`**

Convert, keeping geometry identical — this step changes which bucket a box goes into, nothing else:
- LLRF operator console screen (`rf-builder.js:524`)
- Vacuum front-panel indicator/display strip (`vacuum-builder.js:408`)
- The klystron hot cathode, currently a hand-rolled emissive material at `component-builder.js:660`, folded into the role

- [ ] **Step 4: Test and tune**

`test/test-glow-role.js`, following the `globalThis.THREE` stub pattern in `test/test-staff-builder.js`: `getGlowMaterial` caches by `(compType, colorHex)` and does not leak new materials on repeat calls; `setGlowNightFactor` reaches every registered material.

Then tune the Task 2 bloom parameters by eye against real lit screens. This is the step where the numbers get settled.

**Acceptance:** a placed LLRF controller shows a lit screen that blooms and visibly brightens across a sun cycle; the role survives the template cache and LOD paths; `npm test` green.

---

### Task 4: Utility line energy flow

**Files:**
- Create: `src/renderer3d/utility-flow.js`
- Modify: `src/renderer3d/utility-line-builder-v2.js` (`getLineMaterial` :57, `buildLineGroup` :261, `buildCylinderSegment`), `src/renderer3d/ThreeRenderer.js` (`_animate` :2949 area)
- Test: `test/test-utility-flow.js`

**Interfaces:**
- Consumes: nothing from Tasks 2-3; this task is independent of the bloom layer except that flow materials should join `BLOOM_LAYER` so pulses bloom.
- Produces:
  - `FLOW_PARAMS` — `{ [utilityType]: { speed, period, width, strength, baseGlow } | null }`, `null` meaning no flow.
  - `bakeRunDistanceUVs(geometry, distStart, distEnd)` — rewrites a segment cylinder's `uv.y` from the per-segment 0..1 the geometry generates to absolute distance along the whole polyline.
  - `patchFlowMaterial(material, utilityType, flowState)` — installs the `onBeforeCompile` hook and returns the material with a `userData.flowUniforms` handle.
  - `tickFlow(dtSeconds)` — advances `uTime` on every patched material by the frame delta.

- [ ] **Step 1: Run-distance UVs**

In `buildLineGroup`, accumulate distance along the polyline as segments are emitted and pass each segment its `[distStart, distEnd]`. `bakeRunDistanceUVs` writes those into `uv.y`, interpolating across the cylinder's own height parameter so the coordinate is **continuous across segment boundaries**. Orientation follows `line.start` → `line.end`, matching `buildWorldPoints`.

Note the jacketed style (`jacketedCylinder`, used by cryo) builds two concentric cylinders per segment — both need the same baking or the jacket and core will flow out of phase.

- [ ] **Step 2: The flow shader patch**

`patchFlowMaterial` uses `onBeforeCompile` to inject `uTime`, `uSpeed`, `uPeriod`, `uWidth`, `uStrength` and add a repeating soft pulse to `totalEmissiveRadiance` in the utility's own colour, driven by `vUv.y`. Keep the material a `MeshStandardMaterial` — this is an additive emissive term over the existing shading, not a replacement.

Set `material.customProgramCacheKey` to include the utility type and flow state, or three will reuse a cached program across variants.

- [ ] **Step 3: Per-utility character**

Fill in `FLOW_PARAMS`. The motion is the readable signal:

| utility | motion |
| --- | --- |
| `powerCable` / `hvCable` | fast, short, bright sparks |
| `rfWaveguide` | rapid red strobe, tight period |
| `coolingWater` | slow steady blue band |
| `cryoTransfer` | very slow pale-cyan drift plus a faint constant frost glow (`baseGlow`) |
| `dataFiber` | tiny sparse white blips, very fast |
| `vacuumPipe` | `null` — inert grey, no flow |

One table, so the whole feel is tunable in one place.

- [ ] **Step 4: Gate on simulation state**

`getLineMaterial` currently hardcodes `matKey(utilityType, 'ok')` and ignores its `_errorStatus` argument — the cache key already supports the variant. Stop ignoring it, and return a patched variant per `(utilityType, flowState)`:
- `ok` — pulses at nominal speed
- `soft` — pulses stutter and dim
- `hard` — no pulses, unlit pipe

`_buildErrorMap` (:599) already produces the `lineId → status` map and `errorStatus` is already in the per-line rebuild hash, so a fault transition rebuilds the affected lines and the motion changes with no new refresh path. Do the same for `getJacketMaterial`, which has the identical hardcoded-`'ok'` bug.

Keep the `shared()` tagging on every cached variant — the disposers use it to tell shared materials from per-build ones, and an untagged shared material will get disposed out from under other lines.

- [ ] **Step 5: Drive it**

Call `tickFlow` from `_animate`, next to the existing `pulseUnwiredMarkers` call at :2951, using the `_dt` already computed at :2949. One uniform write per patched material per frame — no rebuilds, no per-line cost.

- [ ] **Step 6: Test**

`test/test-utility-flow.js`, stub pattern as in `test/test-utility-line-fault-mark.js`:
- `bakeRunDistanceUVs` produces values continuous across segment boundaries on a multi-leg path, and oriented source→sink.
- `FLOW_PARAMS` has an entry for every member of `UTILITY_TYPE_LIST` (guards against a new 8th utility silently having no flow), and `vacuumPipe` is `null`.
- `getLineMaterial` returns *distinct* cached materials for `ok` / `soft` / `hard` of the same type, the same instance on repeat calls, and every one tagged `__shared`.

**Acceptance:** a powered cooling run shows a slow blue band travelling source→sink; a vacuum run shows nothing; hard-faulting a network stops its motion; `npm test` green, including the existing `test-utility-line-dispose.js` and `test-utility-line-fault-mark.js`.

---

### Task 5: The light rig — fixtures, floor spill, and impulse flashes

**Scope note.** This task was originally "a pool of ≤8 non-shadow point lights."
After seeing Tasks 3-4 running, the user asked for three specific things: pipes
that actually cast coloured light on their surroundings, wall lights and
lampposts that cast light **and shadows**, and lit explosions. Task 5 is
rewritten to deliver those. The three needs have very different costs and get
three different mechanisms — treating them as one "add more lights" problem is
how this becomes unshippable.

**Files:**
- Create: `src/renderer3d/light-rig.js`
- Create: `src/renderer3d/floor-glow.js`
- Modify: `src/renderer3d/ThreeRenderer.js` (`_animate`, `_updateSunCycle`, dispose)
- Modify: `src/renderer3d/utility-line-builder-v2.js` (emit floor-glow strips alongside runs)
- Test: `test/test-light-rig.js`

**Interfaces:**
- Consumes: `BLOOM_LAYER` from `glow-pipeline.js`; the flow uniforms and
  `FLOW_PARAMS` from `utility-flow.js`; `userData.role === 'glow'` meshes.
- Produces:
  - `class LightRig` with `constructor(scene, opts)`, `update(camera, nightFactor, dt)`,
    `flash(position, colorHex, intensity, durationMs)`, `setEnabled(bool)`, `dispose()`.
  - `buildFloorGlowStrip(points, utilityType, flowState)` from `floor-glow.js`.

#### The governing constraint

**Every light is allocated once at construction and parked at `intensity = 0`.**
Adding or removing a light from the scene forces a shader recompile across every
lit material in the game — a visible hitch. Lights are only ever moved,
retinted, and faded. Never created, never destroyed, not even for explosions.
This single rule is what makes a 12-light rig plus on-demand flashes affordable.
Verify it holds by watching `renderer.info.programs.length` while panning and
flashing: it must not climb.

- [ ] **Step 1: The fixture rig — spots, not points**

A shadow-casting `PointLight` needs a **cube** shadow map: six render passes per
light per frame. A `SpotLight` needs one 2D map. Lampposts and wall lights point
downward anyway, so spots are both cheaper and more truthful.

Allocate: **4 shadow-casting `SpotLight`s** + **8 non-shadow `PointLight`s**, all
at construction, all parked at 0. Shadow map size 1024 (not the sun's 4096 —
these are small pools of light, not the whole scene).

Each frame, rank candidate emitters by distance to the camera target and assign:
the 4 nearest fixture-type emitters get the shadowed spots, the next 8 get
non-shadow points. Skip the re-sort when the candidate set is unchanged.

Emitters come from two sources: meshes tagged `userData.role === 'glow'` (per the
Task 3 ruling — no separate registry), and placed light *fixtures*. `lamppost`
already exists (`src/data/decorations.raw.js:138`) and is the first fixture; give
it a downward spot with a warm tint.

All fixture intensity scales with the night factor so lights fade out entirely at
midday, matching the glow-role behaviour from Task 3.

- [ ] **Step 2: Floor glow under utility runs**

Pipes cannot cast light — three has no line light, and sampling point lights
along a run would be ruinous. But utility runs **lie on the deck**
(`utilityLineHeight` puts them a centimetre above the floor), so paint the light
instead of casting it.

`buildFloorGlowStrip` emits a flat additive-blended strip on the floor beneath a
run, reusing the run's own polyline, at y ≈ 0.005, `depthWrite: false`, no
lighting. It is driven by the **same** flow uniforms as the pipe above it, so the
pool of light travels with the pulses rather than drifting out of phase.

Skip it for `vacuumPipe` (no flow, per `FLOW_PARAMS`) and for `hard` flow state.
The strip is part of the line's group so it is disposed with the line — and it
must NOT be tagged `__shared`, since it is per-line geometry.

- [ ] **Step 3: Impulse flashes**

`flash(position, colorHex, intensity, durationMs)` claims the
longest-idle non-shadow point light, moves it, tints it, and ramps it down over
`durationMs` on an ease-out curve. If every slot is busy, steal the dimmest —
never allocate. Flashes ignore the night factor (an explosion is bright at noon)
but still honour `setEnabled(false)`.

Expose it on `ThreeRenderer` as `flashLight(...)` so gameplay code can fire one
without reaching into the rig.

- [ ] **Step 4: Wire, budget, and honour the toggle**

Call `update` from `_animate` with the existing `_dt`. When `setGlowEnabled(false)`,
zero every light and skip the floor strips. Expose the pool sizes as constructor
options so the shadow count is a one-line dial if the frame budget complains.

- [ ] **Step 5: Test**

`test/test-light-rig.js`, headless via the `globalThis.THREE` stub pattern:
- the rig allocates its full pool at construction and the light count never
  changes across `update` calls, `flash` calls, or `setEnabled` toggles
- `flash` reuses a slot rather than allocating, and steals the dimmest when saturated
- fixture intensity goes to zero at `nightFactor = 0`, and flashes do not
- `buildFloorGlowStrip` returns null for `vacuumPipe` and for `hard` flow state,
  and its geometry is not tagged `__shared`

**Acceptance:** lampposts cast real shadows at night; a wired cooling run pools
blue light on the floor that travels with its pulses; `flashLight()` produces a
visible burst that fades; `renderer.info.programs.length` does not climb while
panning or flashing; everything fades at midday; the Options toggle kills all of it.

---

## Final verification

- `npm test` green.
- `npm run test:browser` green.
- `npm run build` succeeds.
- Manual: boot the user's running dev server, place an LLRF controller and a wired cooling run, watch one sun cycle with the toggle on, then confirm the toggle off restores the pre-change look exactly.
- Report frame-time before and after with the toggle on, at a dense facility.
