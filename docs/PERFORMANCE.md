# Performance benchmarks

## Minor Lab saved scenario

`npm run benchmark:minor-lab` loads the shipped Minor Lab save through the real
scenario setup, world snapshot, and complete production facility builders. It
reports cold/warm snapshot time, total and per-subsystem scene construction,
first and warm LOD transition CPU time, near/far draw calls, triangles, shadow
draws, and a per-subsystem structural breakdown.

Use `--iterations=N` to collect more scene-build timing samples, `--json` for a
machine-readable report, and `--gate` to fail when the stable structural
budgets are exceeded:

```sh
npm run benchmark:minor-lab -- --iterations=5
npm run --silent benchmark:minor-lab -- --json > minor-lab.json
npm run benchmark:minor-lab -- --gate
```

CPU timings are diagnostic rather than gated because host speed and thermal
state vary. Draw, triangle, shadow, and detail/glow leakage budgets are the
portable regression contract. The benchmark does not measure GPU time, browser
FPS, post-processing, driver submission, or visual fidelity.

## Ten large beamlines

`npm run benchmark:ten-large` constructs ten copies of the shipped
`blackhole-pev` stock design through a real `Game` and measures the principal
headless scaling boundaries:

- 300 ordinary game ticks with every beamline running;
- per-beamline fallback recalculation;
- partial and full world snapshots on a map large enough for the design;
- the public component, pipe-attachment, beam-pipe, and beam-effect builders;
- near/far LOD scene objects, draw calls, triangles, and shadow casters;
- a component / pipe-attachment / beam-effect breakdown, including real light
  and emissive-glow counts;
- the authored beam-pipe support/flange detail demand alongside the actual
  instanced draw count;
- main-thread cost to schedule ten equivalent physics requests and the number
  of background jobs left after request coalescing;
- one CPython engine call as a lower-bound proxy for the remaining worker job.

The normal command reports current values and target PASS/FAIL status without
failing the process. `npm run benchmark:ten-large -- --gate` exits non-zero
when a target is missed; it is intended for use after the optimization phases
bring the current baseline inside budget. `--json` produces machine-readable
output and `--no-physics` skips the slower CPython workload. Use npm's silent
mode when redirecting JSON so npm's own command banner is not mixed into it:

```sh
npm run --silent benchmark:ten-large -- --json > ten-large.json
```

Pass `--count=N` to exercise the same fixture at a larger scale. This remains
a structural diagnostic rather than a separate gate: the fixed targets below
describe the canonical ten-beamline case. For example, a quick 100-beamline
CPU/render-structure pass is:

```sh
npm run benchmark:ten-large -- --count=100 --no-physics
```

The targets are optimization budgets, not FPS claims. An 8 ms
tick/partial-snapshot budget preserves roughly half of a 60 Hz frame for
rendering; the 16 ms physics-scheduling budget catches main-thread work capable
of consuming a whole frame. Draw-call, triangle, shadow, and pipe-draw targets
describe the batched/LOD scene. Keep the budgets fixed while optimizing so a
change cannot make itself pass by moving the finish line.

This is deliberately not described as an FPS benchmark. The scene is built
with the same public builders as production, including the instanced beam-pipe
path. It cannot measure GPU submission, post-processing, real shadow-map
renders, or driver behavior.
Those require the repository owner's explicit approval for the browser lane.
The headless benchmark provides a stable fixture and structural budgets first,
so browser captures later compare the same world rather than a hand-built save.

Physics is hosted in a module worker. Equivalent lattices share an in-flight
job and cached result, while per-beamline IDs are remapped when results return.
The aggregate facility summary is derived from those results instead of making
a second solver pass. The native CPython timing therefore covers one coalesced
background job. It is a lower-bound proxy, not a Pyodide measurement; a browser
capture is needed before quoting exact worker latency or user-visible FPS.

The fixture currently excludes utility support plant. Utility networks and
their presentation will be added as a second benchmark layer when utility-line
batching begins; mixing an invented support layout into this first baseline
would make it impossible to tell whether component or utility rendering caused
a regression.

## Large-world detail policy

The authored detailed presentation is the default at every zoom. Players can
opt into adaptive simplification with **Layers → LOD objects**. With that
switch enabled, zooming out switches the complete modeled-object presentation
regardless of facility size. Detail follows projected screen scale instead of
an unrelated facility object-count threshold:

- beamline modules keep a one-draw-per-type pipe, support, magnet, cavity,
  source, diagnostic, cyclotron, or endpoint silhouette;
- infrastructure keeps a one-draw-per-type cabinet, rack, vessel, manifold,
  pump, transformer, tower, or plant silhouette;
- large equipment and furnishings use instanced chair, table, console, rack,
  cabinet, sanitary-fixture, cart, and machine silhouettes;
- benchtop apparatus, wall fittings, rugs, and other pixel-scale facility
  clutter disappear;
- trees use the shared low-poly trunk/crown batches, while grounds utilities,
  security, furniture, signs, and outdoor lighting use type batches;
- hangings, flower beds, bins, and small wall/ceiling/surface fixtures disappear;
- beam pipes, pipe attachments, and utility networks retain their existing
  thin route silhouettes while hiding optional fittings and support detail;
- all non-structural far presentations stop casting shadows, and hidden detail
  no longer owns real fixture or glow-light slots.

A hysteresis band prevents the representation from flickering when the camera
sits on the transition. Floors, terrain, and walls are already merged/static
presentation layers. Roof slabs are merged by surface into two draws per
compatible material instead of submitting one six-material box per tile.

Camera pan and orbit gestures update only the view transform. The orthographic
projection matrix is invalidated by zoom or viewport-size changes, not by every
raw pointer-move event; cursor-anchored zoom still applies the new projection
before its corrective ground raycast. Multi-ray pan and zoom gestures also
reuse one event-local canvas bounds read rather than repeatedly querying layout.
While the camera is moving, native WebGPU renders the ordinary lit scene and
retains cached shadows instead of scheduling GTAO, selective glow, bloom, or
new facility shadow passes. The configured post-processing and shadow cadence
return after a 120 ms settle tail; this does not change the saved glow setting.

The stock Minor Lab is the whole-facility regression fixture. Its headless
production-builder measurement currently drops more than 7,000 authored near
draws to at most 550 far draws, at most 125,000 far triangles, and at most 60
far shadow draws. `test/test-minor-lab-far-render-budget.js` pins those budgets
and reports per-layer counts for components, equipment, decorations, and
utilities. These are structural submission counts, not an FPS claim; final
camera feel and appearance remain part of repository-owner gameplay testing.

Utility descriptors receive one shared endpoint index per solve pass. Keep
endpoint resolution in that context for per-network work; rebuilding an index
inside each network turns otherwise independent utility networks into
quadratic work as a facility grows.
