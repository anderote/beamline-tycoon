# Local performance review

Scope: all six proposed loading/responsiveness changes. No deployment or master
promotion. Native Chrome, 1440x900, Minor Lab; measurements are individual local
runs, not a statistical or cross-device speed guarantee.

| Requirement | Implementation and evidence |
| --- | --- |
| Optional UI loading | Save/Load and Options are dynamic imports with cached instances and retry. Built-browser first opens pass. Bootstrap explicitly initializes Three before shared game chunks. Static import accounting showed only ~18KB raw reduction and negligible gzip savings; no large bundle-speed claim. |
| Parallel startup indexes | All three independent sprite indexes start together, overlapping renderer init. Focused controlled-fetch test proves concurrency and completion; built startup passes. |
| Stage preparation | Remaining LOD builders yield in separate tasks and cancel obsolete work. Initial visible camera variants retain warmup; offscreen object shaders compile one per idle task, pausing during camera motion. Title CRT rendering freezes during finalization while DOM status stays live. Scheduler cancellation tests and built gameplay pass. |
| Reduce submissions | Static repeated opaque component roles instance by geometry/material/category; transparent, glow and detail remain independent. Minor Lab near calls2035->1873, shadows1107->945, unchanged geometry. Cable tessellation separately removes49968 triangles. Far remains182 calls. Transforms, picking identity, dimming, animated source matrices and restoration have focused tests. Built selection outline6/6. |
| Responsive updates | HUD event bursts coalesce to one latest-state paint; identical resource text is not rewritten. Keyboard camera speed is time-based across30/60/120/144Hz and clamps stalled-frame catch-up. Public-boundary tests pass; actual built pan moves camera. |
| Compression/cache | Live existing JS gzip/immutable cache verified. Production asset revision changes with source bytes;293 copied files/32966155 bytes are byte-identical. Built candidate successfully requests217 versioned assets. Local DTW Vercel rule grants immutable caching only to versioned paths; not deployed. HTML/unversioned assets retain revalidation. |

## Browser evidence

Same-toolchain baseline ec69f50a: boot3.51s, scenario16.12s, pan p95 100ms.
Candidate with10-second idle shader preparation: boot3.46s, scenario21.33s,
pan p95 16.7ms. Final deployment-format candidate: boot4.03s, scenario24.93s,
pan p95 16.8ms, selection outline6/6, Options/Save/Load pass, zero page errors.

These measurements show improved pan responsiveness in this fixture, not a
universal cold-start speedup. Scenario startup remains shader-bound and variable;
this pass improves request concurrency, repeat-visit caching, preparation
responsiveness and rendering cost, but did not demonstrate faster total local
scenario startup. Baseline and candidate use the same installed dependencies
and fresh browser profiles. GPU/OS shader caching and host load remain uncontrolled.
The unavailable local cloud-save endpoint returns502; local-save fallback works.

Evidence JSON files in this directory include baseline/candidate, structural
benchmark, live header audit and exact asset-copy checks. CPU profiles remain in
/tmp and are diagnostic, not required runtime assets. No game balance changes.
