# Performance benchmarks

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

Facilities below 1,000 authored beam-pipe attachments retain full component
and attachment detail at every zoom. At or above that threshold, zooming out
uses catalogue-sized attachment silhouettes, hides ornamental component
geometry, and disables their shadow submissions. A hysteresis band prevents
the representation from flickering when the camera sits on the transition.
The headless near/far measurements exercise both representations directly.

Utility descriptors receive one shared endpoint index per solve pass. Keep
endpoint resolution in that context for per-network work; rebuilding an index
inside each network turns otherwise independent utility networks into
quadratic work as a facility grows.
