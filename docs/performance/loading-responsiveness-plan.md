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
