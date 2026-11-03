# Loading and responsiveness goal

Owner authorized completing all six proposed improvements, including browser baseline,
locally. No production release or master promotion authorized.

Worktree: beamline-tycoon-performance-pass, branch agent/performance-pass.
Durable task: b51e51b6-8904-436b-87dc-d32249afd5f2.

## Completion requirements

- Measure cold startup, Continue-to-input, long tasks and camera/build responsiveness.
- Split optional startup UI and verify first-open behavior, retries and loaded byte totals.
- Parallelize independent sprite indexes and overlap renderer initialization.
- Bound scene construction/shader preparation; preserve visible objects and first-use correctness.
- Reduce static/repeated scene submissions; validate near/far and visual output.
- Coalesce redundant HUD/world updates; validate current values and immediate input feedback.
- Audit deployed compression/caching; improve versioned texture caching locally if warranted.
- Focused, fast, full integration tests, build and browser flows; local dev integration only
  after verification. Preserve stable port 8000 and unrelated worktrees.

## Evidence so far

Cable triangle candidate commit 10a3d438: 49,968 fewer triangles, no measured CPU gain;
362/362 fast suites passed before startup changes. Still needs visual/GPU validation.

Live cache audit in adjacent JSON: hashed JS has immutable one-year cache and gzip;
HTML/manifests revalidate with gzip; sampled PNG revalidates. Do not immutable-cache
unversioned assets.

Startup changes in progress: SpriteManager.loadIndexes launches all independent requests;
main starts that before renderer.init. Save/load and options dialogs import on first use,
with a cached instance and retry after failed import. Focused helper tests pass.
Build passes; chunk redistribution is NOT evidence of reduced startup bytes: count the
full static import closure (MusicPlayer shared chunk grew during splitting).

Browser profiler owns ephemeral Vite server and fresh headless Chrome profile, closes both
in finally. First attempt invalidated by HMR and is NOT a valid baseline. HMR now disabled;
clean baseline runs against unchanged root source via PROFILE_ROOT. SwiftShader is only
CPU/browser correctness evidence, not native hardware GPU FPS. Missing bundled Playwright
browser handled using installed Chrome channel.

## Native browser evidence and work in progress

Clean software baseline completed at 115s; native Chrome completed in 2.42s,
so software timing is not representative. Native Minor Lab startup candidate
(e7694a7f plus thumbnail scheduling) entered the scene in 22.426s, then sampled
120 idle frame intervals at median 16.7ms / p95 16.8ms. No page errors.
Do not equate this idle sample with camera/build responsiveness. Welcome overlay
was open. Screenshot /tmp/beamline-minor-lab.png visually checked. Profile
/tmp/beamline-minor-lab-profile.json.cpuprofile shows shader/node building,
GC and title CRT work; substantial idle time during async GPU preparation.

Current uncommitted work defers thumbnail GPU context hydration until rendering
is released and yields between remaining startup LOD builders. Scheduler test
covers cancellation when a new world replaces an in-flight drain. Fast suite
initially caught old thumbnail wiring source test; it now checks the new release
boundary. Final full fast suite and build running in exec session 68231, outputs
/tmp/beamline-frame-fast-final.txt and /tmp/beamline-frame-build.txt.

Browser runs completed and closed their owned servers (ports 61038, 61226,
61262, 61323, 61391 verified no listeners). All browser helpers use fresh
profiles. Next: await tests, validate latest LOD drain in browser, measure
Continue/camera/build and dialog first-open, reduce scene startup cost without
removing prewarming needed to avoid first-gesture stalls, then complete batching,
HUD invalidation and versioned asset caching scope.

## Asset cache implementation in progress

Previous thumbnail/drain fast suite: 364/364 pass; build passes. Instrumented
native scenario run varied down to 6.073s; refreshForNewSession was 376ms.
This is NOT a proven 22s-to-6s improvement: shader/cache conditions differ.
Receipt: 2026-11-02-scenario-timings.json; CPU trace in /tmp.

Added build-only asset fingerprint plugin (SHA256 of paths and unchanged bytes),
32MB copied losslessly under versioned-assets/<revision>/. Three's default
LoadingManager rewrites relative assets/ URLs; sprite/texture manifests and
sprite getters use same resolver. Original paths remain valid in development.
Built thumbnail URLs already use Vite hashes. Sprite offsets map versioned URLs
back to source identity. Tests cover stable/changing revision and URL behavior.
Local companion change in ../deep-tech-week/vercel.json adds immutable caching
ONLY for versioned-assets paths. It is not deployed. That file was clean before
this change; preserve all other DTW work. Still need production-built browser
request/readback, repeat-cache evidence, and any remaining direct DOM asset URLs.

Current test/build session 76812: /tmp/beamline-assets-fast.txt and
/tmp/beamline-assets-build.txt. After launch, offset identity lookup and its test
were added; rerun focused asset test (already passes), no need to restart the
whole suite merely for that small follow-up unless errors occur.
All six scope items remain open until audit with evidence. Remaining major work:
static/instance draw-call reduction, input/HUD/world-update response measurements
and improvements, built startup-byte accounting, full browser flows and final
integration. Do not report the full goal achieved.

## Built-browser regression found and fixed (pending final readback)

Versioned asset fast gate passed 365/365; build passed. Added remaining three
HUD palette assetUrl calls. Built preview then exposed THREE undefined before
main ran: optional dialog splitting moved eagerly evaluated material modules
into shared chunks that evaluated before the old entry's namespace assignment.
Added src/bootstrap.js as HTML entry: initialize three-global, then dynamically
import main. This is required for actual built behavior, not just dev behavior.
Built run now progresses past that failure. Native built scenario/dialog/pan
profile running exec 22190, logs /tmp/beamline-built-fixed.log and report
/tmp/beamline-built-fixed.json. Browser runner exercises welcome dismissal,
Options, Save, Load and 90 frames of W-key pan. It closes its own resources.
Full non-browser gate running exec 72778 (/tmp/beamline-all-current.txt).

Static import closure before bootstrap showed optional dialog splitting saved
only ~18KB raw and essentially no gzip (1.219MB total). Do not claim a large
loading improvement from the entry chunk shrinking; shared dependencies moved.
Need measure complete post-bootstrap requests, not static entry-only closure.

## Instancing and built flow progress

Full gate before instancing: 367/367 suites passed. Built bootstrap fix verified:
no page errors, Options/Save/Load dialogs opened and closed. However scenario
startup was 73.979s on that run (not a performance win); inspect GPU/cold pipeline
behavior before completion. Pan sample had unchanged camera coordinates, so
it is INVALID as responsiveness evidence. Profiler now blurs hidden dialog
focus, captures both pan axes and fails if the camera does not move.

Added StaticRoleBatches to ComponentBuilder: repeated opaque shared role parts
use InstancedMesh; original wrappers/hitboxes retain owner identity. Glow,
detail, transparent and dimmed parts remain independent. Matrices relative to
category parents; same geometry/material/shadow/layer groups only. Rebuild and
focus clear/restage batches; disposal preserves shared materials/geometries.
Focused test covers transform, raycast instance ID, visibility restoration and
transparent exclusion. Minor Lab near draws 2035 -> 1873, triangles unchanged
999588; far remains 182 draws / 138484 triangles. Budget tightened to 1900.
Must still verify actual selection/highlight, move/demolish and camera LOD paths
in browser; hidden original role meshes could affect clone-based previews.

Current exec 8753 runs fast suite -> build -> built browser scenario/dialog/pan:
/tmp/beamline-batches-fast.txt, /tmp/beamline-batches-build.txt,
/tmp/beamline-batched-built.log and /tmp/beamline-batched-built.json.
Previous built profile (port62566) completed and closed its resources.
Changes remain uncommitted since e7694a7f; preserve the work and finish validation.

## Input/HUD changes and real pan result

Instancing fast gate 366/366 passed and built profile completed, no page errors;
Options/Save/Load pass. Scenario load 48.517s; still not acceptable evidence of
loading improvement. Actual W pan moved [0,0] -> [-63.64,-63.64] but p95 frame
interval was 116.7ms. This is a real responsiveness issue still needing work.

Added refresh-rate-independent pan timing (60 world units/sec at zoom1 across
30/60/120/144Hz; clamp catch-up to 50ms), UIHost.requestHUDUpdate coalesces tick
and resource-event bursts to one animation-frame update reading latest state,
and identical resource text no longer rewrites DOM text. Focused tests pass.
Fast/build exec47979: /tmp/beamline-input-fast.txt, /tmp/beamline-input-build.txt.
Profiler now records pan start/end timestamps to isolate CPU-profile samples
for the slow interaction. Need compare cold/warm pan with latest build and
inspect actual GPU/CPU reason. Do not confuse idle60Hz with interactive speed.
