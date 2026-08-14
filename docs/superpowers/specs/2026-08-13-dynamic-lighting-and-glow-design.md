# Dynamic Lighting and Glow — Design

Date: 2026-08-13
Status: approved, ready for planning

## Goal

Make the facility read as a **working machine at night**: emissive screens and
indicator lamps, energy visibly coursing through utility runs in each utility's
own colour and rhythm, and a small budget of real dynamic lights spilling onto
floors and walls. The visual register is **grounded industrial** — pulses are a
modulation of a pipe's own colour, not a neon racing stripe.

Secondary goal, and the reason this is worth more than decoration: the flow
animation is **gated on simulation state**, so a panned view of the facility is
readable telemetry. A run that is delivering flows; a soft-faulted run stutters;
a hard-faulted run goes dark.

## Current state

- `three@0.160.0` loads as a **CDN global** (`index.html:364`). No npm
  dependency; all 31 source files that touch three use a bare `THREE.` global.
- Lighting is exactly two lights — an `AmbientLight` and a shadow-casting
  `DirectionalLight` (`ThreeRenderer.js:488-505`) — driven by a day/night cycle
  in `_updateSunCycle` (`ThreeRenderer.js:2975`) that computes a `dayness`
  scalar but currently only uses it for sun intensity and colour temperature.
- No postprocessing. One game render call, `ThreeRenderer.js:2955`.
- `_pixelScale = 2` (`ThreeRenderer.js:445`): the scene renders at **half
  resolution** and is CSS-upscaled with `image-rendering: pixelated`.
- Components are built through a role-bucket system,
  `ROLES = ['accent','iron','copper','pipe','stand','detail']`
  (`component-builder.js:190`), merged into cached per-type templates.
- Utility lines are per-segment cylinders sharing one cached
  `MeshStandardMaterial` per utility type (`utility-line-builder-v2.js:57-68`),
  rebuilt on a content hash that already includes error status.
- Utility descriptors already carry the colours this design needs:
  `cryoTransfer #44aacc`, `rfWaveguide #cc4444`, `vacuumPipe #888888`,
  `powerCable #44cc44`, `coolingWater #4488ff`, `dataFiber #eeeeee`,
  `hvCable #141418`.
- `_animate()` (`ThreeRenderer.js:2871`) already computes a per-frame `dt` at
  line 2949 and has an established place for per-frame material updates.

## Constraints discovered during design

These two findings shaped the design and must not be re-litigated during
implementation.

**1. The `THREE` global must survive.** Six node tests inject a fake
`globalThis.THREE` stub to exercise builders headlessly without WebGL:
`test-staff-builder.js:131`, `test-wildflower-builder.js:210`,
`test-utility-line-fault-mark.js:41`, `test-convergence-regressions-2.js:448`,
`uv-utils.test.js:8`. Converting the 31 source files to
`import * as THREE from 'three'` would break all of them for no benefit.

**2. Half-resolution rendering is an asset, not an obstacle.** Bloom computed in
the `_pixelScale = 2` buffer is nearest-neighbour upscaled, so halos come out
chunky and consistent with the game's pixel aesthetic rather than as a soft
modern smear. Bloom radius must therefore be tuned in *low-res* pixels.

## Architecture

Five units, each independently testable, listed in the order they must land.

### Unit 1 — `three` as a real dependency

The postprocessing addons (`EffectComposer`, `RenderPass`, `UnrealBloomPass`,
`ShaderPass`) are ESM modules that `import 'three'` internally. They cannot be
reached from a CDN global build, and pulling them from a second CDN would
instantiate a *second* copy of three — breaking every `instanceof` check across
the renderer.

The migration is deliberately minimal:

- Add `three@0.160.0` to `dependencies` in `package.json`. The version pins to
  what the CDN served, so no library-version behaviour changes ride along.
- Delete the CDN `<script>` tag at `index.html:364`.
- Add `src/three-global.js`:
  ```js
  import * as THREE from 'three';
  globalThis.THREE ??= THREE;
  ```
- Import it **first** in `src/main.js`, before any other import.

The 31 source files are untouched. The 6 test stubs are untouched — they import
builders directly and never reach `three-global.js`. Vite dedupes `'three'` to
one instance, so the addons and the global are the same module.

The `??=` is load-bearing: it means any environment that has already installed a
`THREE` stub keeps it, so this file can never clobber a test harness.

**Ordering risk.** `component-builder.js` constructs `SHARED_MATERIALS` at
module-evaluation time, so it needs `globalThis.THREE` populated before it
evaluates. ES modules evaluate depth-first in import order, so making
`three-global.js` the first import of the single entry point `src/main.js` is
sufficient. This must be verified by an actual boot, not by reasoning.

**Acceptance:** `npm run dev` boots to a rendered scene with no CDN request for
three, `npm test` passes unchanged, and `npm run build` produces a working
`dist/`.

### Unit 2 — Selective bloom pipeline

`EffectComposer` with `RenderPass` → `UnrealBloomPass` replaces the bare
`renderer.render` at `ThreeRenderer.js:2955`. Composer render targets are sized
from the same `_pixelScale`-derived dimensions as `_setSize`
(`ThreeRenderer.js:2784`), and resize with it.

**Bloom is selective, not threshold-only.** Ambient 1.3 plus sun up to 1.8
pushes white painted surfaces past 1.0 at noon, so a luminance threshold alone
would smear the architecture — the opposite of grounded industrial. Use the
darken-non-bloomed recipe:

1. Cache and swap every non-glow material to black.
2. Render the scene to the bloom render target.
3. Restore the cached materials.
4. Render normally and composite the bloomed buffer additively.

Membership is by **layer**: glow materials are tagged onto a dedicated bloom
layer, and the darkening step blacks out everything not on it. The second pass
runs all-black trivial fragment shaders at half resolution with
`renderer.shadowMap.autoUpdate = false`, so its cost is draw calls and vertex
work only.

Tone mapping stays `NoToneMapping` and output colour space stays at its current
default. Re-grading the entire game is explicitly out of scope; bloom is
controlled by strength, radius, and threshold alone.

Nothing else in the frame is disturbed: the CRT effect is a title-screen DOM
overlay (`src/ui/TitleScreen.js:175`), and the view-cube owns a separate
`WebGLRenderer` and canvas (`view-cube.js:211`).

**Acceptance:** with no glow materials yet registered, the composer path renders
pixel-comparable output to the direct path — bloom that changes the scene before
Unit 3 exists is a bug.

### Unit 3 — The `glow` role

Add `'glow'` to `ROLES` in `component-builder.js:190`. Its material is an
emissive `MeshStandardMaterial` with a per-colour cache mirroring the existing
`getAccentMaterial` shape, and every mesh built from it is assigned the bloom
layer.

Builders then bucket genuinely-lit surfaces into `b.glow`:

- LLRF operator console screen (`rf-builder.js:524`)
- Vacuum gauge readout / front-panel indicator strip (`vacuum-builder.js:408`)
- Rack indicator lamps across the equipment builders
- The klystron hot cathode, currently a hand-rolled emissive at
  `component-builder.js:660`, folded into the role

A module-level registry of glow materials takes a **night multiplier** derived
from the `dayness` scalar already computed in `_updateSunCycle`: emissive
intensity scales up as `dayness` falls, so screens burn bright at night and wash
out at noon. This is the first thing in the game that makes the day/night cycle
consequential.

**Acceptance:** a placed LLRF controller shows a lit screen that visibly
brightens across a sun cycle, and the role survives the template cache and LOD
paths the other roles already use.

### Unit 4 — Utility line energy flow

**Geometry.** Each segment cylinder already owns its own geometry
(`buildLineGroup`, `utility-line-builder-v2.js:261`). Bake **cumulative
run-distance** into each segment's `uv.y` — that is, the distance along the
whole polyline from its source end, not the per-segment 0..1 the cylinder
generates — so the coordinate is continuous across segment boundaries and
oriented source→sink. Direction follows `line.start` → `line.end`, matching
`buildWorldPoints`.

**Shading.** The shared per-type material from `getLineMaterial`
(`utility-line-builder-v2.js:57`) is patched via `onBeforeCompile` with
`uTime`, `uSpeed`, `uPeriod`, and `uStrength` uniforms that add a repeating
soft pulse to `totalEmissiveRadiance` in the utility's own colour. One uniform
write per utility type per frame, driven from `_animate`. No geometry rebuilds,
no per-line cost.

**Per-utility character.** The motion itself is the readable signal:

| utility | motion |
| --- | --- |
| `powerCable` / `hvCable` | fast, short, bright sparks |
| `rfWaveguide` | rapid red strobe, tight period |
| `coolingWater` | slow steady blue band |
| `cryoTransfer` | very slow pale-cyan drift plus a faint constant frost glow |
| `dataFiber` | tiny sparse white blips, very fast |
| `vacuumPipe` | **no flow** — inert grey |

Parameters live per-utility-type in one table so the whole feel can be tuned in
one place.

**Simulation gating.** `_buildErrorMap` (`utility-line-builder-v2.js:599`)
already joins `state.utilityNetworkData` against `state.utilityNetworks` to
produce a `lineId → 'ok' | 'soft' | 'hard'` map, and `errorStatus` is already
part of the per-line rebuild hash. Extend `getLineMaterial` from one cached
material per type to a small set of **variants** keyed by
`(utilityType, flowState)`:

- `ok` — pulses run at the type's nominal speed
- `soft` — pulses stutter and dim
- `hard` — no pulses, unlit pipe

Variant selection happens at build time. Because the hash already carries
status, a network fault transition rebuilds the affected lines and the motion
changes with no new refresh path.

The existing fault **X** symbol (`buildFaultMark`) stays exactly as it is. This
unit adds motion, it does not replace the symbol — the comment at
`utility-line-builder-v2.js:49-56` explains why recolouring the pipe was
rejected, and that reasoning still holds.

**Acceptance:** run-distance UVs are continuous across segments of a multi-leg
path (unit-testable as a pure function against the existing stub pattern);
variant selection returns the right material for each of the three flow states;
a vacuum run shows no motion; a powered cable shows motion that stops when its
network hard-faults.

### Unit 5 — Dynamic point lights

A fixed pool of at most 8 non-shadow-casting `PointLight`s. Each frame, assign
them to the nearest on-camera glow emitters and fade intensity in as `dayness`
falls. Real light spill onto floors and walls.

The pool is fixed-size and allocated once — lights are repositioned and
re-tinted, never created or destroyed per frame, because adding or removing a
light from the scene forces a shader recompile across every lit material.

This is the unit to cut first if the frame budget complains. It is deliberately
last so that cutting it costs nothing already built.

**Acceptance:** ≤8 lights ever exist; panning does not cause shader
recompilation stalls; lights fade out entirely at midday.

## Settings and escape hatch

A **Glow & dynamic lighting** checkbox in the existing **View** section of
`src/ui/OptionsDialog.js` (alongside Zone overlay / Zone labels), persisted to
`localStorage['beamlineTycoon.glow']` following the `beamlineTycoon.music`
convention already used there. Default on. It drives
`ThreeRenderer.setGlowEnabled(bool)`.

When off, the composer is bypassed entirely and `_animate` calls
`renderer.render` directly, glow materials fall back to their non-emissive
appearance, and the point-light pool is not populated. A performance regression
is therefore always one toggle from reverted, and the browser tests get a
deterministic path that does not depend on postprocessing.

## Testing

**Node tests** (following the existing `globalThis.THREE` stub pattern, so they
stay headless):

- Cumulative run-distance UV baking is continuous across segment boundaries on a
  multi-leg path, and oriented source→sink.
- Flow-parameter table has an entry for every member of `UTILITY_TYPE_LIST`, and
  `vacuumPipe` is configured with no flow.
- Material-variant selection returns distinct cached materials per
  `(utilityType, flowState)` and does not leak new materials on repeat calls.
- Glow-role registry applies the night multiplier to every registered material.

**Browser tests** (`test/browser/`): `smoke.spec.mjs` and
`render-placement.spec.mjs` guard against the composer producing a blank screen
or throwing. A new case asserts the game boots with `graphics.glow` both `on`
and `off`.

**Manual verification:** boot the game, place an LLRF controller and a wired
cooling run, and watch one full sun cycle.

## Sequencing

Unit 1 lands and is verified on its own — dependency migration and visual work
must not be entangled, because a boot failure after a combined change is
ambiguous. Units 2–5 follow in order. Commits group at logical boundaries: the
dependency migration is one commit, the composer plus glow role is one, the
utility flow is one, point lights are one.

## Out of scope

- Tone-mapping or colour-space changes (would re-grade the entire game).
- Shadow-casting point lights.
- Bloom on the view-cube widget.
- Any change to the fault **X** symbol or to how faults are surfaced in the HUD.
- Save-format changes. The `graphics.glow` setting is a local preference, not
  world state.
