# Post-integration cleanup

Everything below is outstanding on `master` after merging all seven worktree
branches. Each item states what was **verified** versus what is **reported**, so
whoever picks one up knows what they can trust and what they must re-derive.

Master is at `1525fe2f` (light-rig merge, local) — pushed through `c0a904ba`.
Node suite: 130/130. Browser suite: cannot complete a run (see B).

Items are independent unless noted. A, B and C are the ones with real user
impact; take them first.

---

## A. Two lighting systems now coexist and will double-light

**Needs a product decision before implementation.**

### What is verified

- `master` fakes illumination entirely: painted floor pools + sprite halos
  (`lightPoolGroup`, `lightHaloGroup`). Grep confirms **no `SpotLight` or
  `PointLight` anywhere** in master before the rig landed. It cannot cast
  shadows.
- `src/renderer3d/light-rig.js` (merged in `1525fe2f`) adds 4 shadow-casting
  `SpotLight`s + 8 `PointLight`s, preallocated and parked at intensity 0, plus
  `flashLight()` for impulse events.
- The rig discovers fixtures via `userData.lightFixture`. **Nothing in the
  codebase sets that field** — verified by grep across `src/`. The builder that
  used to set it was deleted when lighting moved to `lighting-builder.js`.
  So lampposts currently get no real light **and nothing fails**.
- The rig is *not* fully inert: it also binds `userData.role === 'glow'`, which
  `component-builder.js:790` does set. Component screens are picking up real
  point lights on master right now.
- Master's builders expose a richer model than the rig assumes:
  `userData.emitterMaterial`, plus `isAimedFixture` / `aimYaw` /
  `poolFootprint` on the fixture defs.

### The collision

A lamppost naively wired to both gets a painted pool *and* a real spot: double
brightness, and the painted pool will not agree with the real shadow.

### Recommended approach (proposed by the render session; endorsed)

Keep both as an **LOD**, do not delete either:

1. Painted pools stay the cheap default for every fixture — ubiquitous coverage
   at no per-light cost.
2. Real shadow-casting spots are assigned only to the nearest N fixtures on
   camera, reusing the rig's existing preallocated pool.
3. **A fixture that has been assigned a real spot suppresses its own painted
   pool** for as long as it holds it. This is the whole correctness condition;
   everything else is tuning.

### Work

1. Rewire `light-rig.js` fixture discovery onto master's actual conventions
   (`emitterMaterial`, `isAimedFixture`, `aimYaw`, `poolFootprint`) instead of
   the dead `userData.lightFixture`. **Until this is done, shadows do not work
   at all** — do not report the feature as landed before it.
2. Add the pool-suppression handshake between the rig and the pool builder.
   Pick the owner deliberately: the rig knows who holds a spot, the pool
   builder knows what it drew. One of them must be authoritative per frame.
3. Assignment policy: nearest-to-camera, with hysteresis. A fixture that gains
   and loses its spot every frame at the LOD boundary will visibly flicker
   between "real shadow" and "painted pool" — that is the failure mode to test
   for, not brightness.
4. Decide whether `flashLight()` competes for the same 4+8 budget or reserves
   its own. An explosion that steals every spot from the scene it is lighting
   is worse than one that dims.

### Do not

- Unify the two day/night ramps. Real fixtures fade to **zero** at midday (a lit
  lamppost at noon reads as a bug); glow-role materials floor at **0.35** (a
  console screen must stay legible in daylight, just washed out). Both are
  correct and deliberately different.
- Resurrect `_lamppost` / `_floodlight` in `decoration-builder.js`. They live in
  `lighting-builder.js` now; the merge already dropped the duplicates.

---

## B. The Playwright suite cannot complete a run

**Highest-leverage item: while this is broken, no browser-level failure anywhere
in the project can be attributed to anything.** Two sessions independently hit
it, and the node suite covers none of the input, camera or picking paths.

### What is verified / reported

- Reported by two sessions: the vite server on `:8123` drops partway through a
  run, after which every remaining spec dies on `ERR_CONNECTION_REFUSED`.
- One session observed `[free-test-port] reclaimed :8123 from pid 93150` on a
  later run — a leaked vite from a killed run squatting the port. Machine load
  was 6.5–17 with 13 concurrent user sessions.
- `playwright.config.mjs` sets `reuseExistingServer: false` and `strictPort`, so
  a leak is **fatal** rather than recoverable.
- `BT_TEST_PORT` is already plumbed (`playwright.config.mjs:15`) and the
  `freeTestPort` guard correctly fires only on the runner's first load, not in
  workers.
- A pristine checkout run on port **8199 completed** while 8123 was
  misbehaving. One data point, not proof.

Likely two stacked problems: (1) leaked servers squatting the port, (2) the
server dying mid-run under load.

### Work

1. **Cheapest first, no code change:** have each session export a distinct
   `BT_TEST_PORT`. This removes cross-session contention entirely and may be the
   whole fix. Establish it as a convention before rewriting anything.
2. Only if (1) proves insufficient: investigate why the server dies mid-run.
   Under 13 concurrent sessions this may be resource starvation rather than a
   defect — measure before changing the lifecycle.
3. Consider making a leaked port non-fatal (fall back to a free port) rather
   than failing the run, since `strictPort` converts a transient into a hard
   stop.

---

## C. Placing a pad-mount transformer silently fails in the browser

A real gameplay bug, not just a flaky test: the click does nothing, with no
error and no log line.

### What is verified

- **Pre-existing.** A session exported pristine `1af6a90d` and ran
  `smoke.spec.mjs` against it on an isolated port; it failed at the identical
  assertion (`smoke.spec.mjs:219`, `feed === null`). Not caused by any merge.
- **The sim path is fine.** I drove it headlessly: `snapForPlaceable` →
  `canPlace` (ok) → `placePlaceable` succeeds, logs "Built Pad-Mount
  Transformer", and the placeable count increments. So the defect is **not** in
  placement validation, affordability, occupancy or the port tables.
- Therefore it is confined to the **browser input/coordinate path** — the click
  → screen coords → tool → placement chain.

### Ruled out (do not re-chase)

- The missing `padMountTransformer` entry in `utility-port-anchors.js`. That
  governs anchor *height* for an already-placed component and is read *after*
  placement; the failure is that nothing is placed at all, strictly earlier.
  Two reviewers reached this independently.
- THREE loading / module ordering. The game boots and 13 other specs passed on
  the run where this was seen.

### Work

Bisect the browser click path with the sim path known-good. The test aims via
`clickWorld(sink.x - 6, sink.z)`, a *world* coordinate rather than a tile
centre — start by confirming what tile that actually resolves to at the camera
state the spec has at that step, and whether the armed tool receives it.

Blocked on B for a reliable reproduction.

---

## D. `DesignPlacer` writes occupancy behind the game's back

**Verified.** `src/ui/DesignPlacer.js:364` does
`game.state.infraOccupied[key] = 'concrete'` directly inside `confirm()`,
bypassing `placeInfraTile` and never bumping `navRevision`.

Masked today because the same `confirm()` also calls `beamline.placeJunction`,
which bumps — **but a design that places foundation tiles and zero modules skips
the bump entirely**, leaving the staff nav grid stale against real topology.

Fix: route that write through `placeInfraTile`. Small, self-contained, and it
removes the class of bug rather than the instance.

---

## E. Stale concern — no work needed

The render session flagged "two disagreeing clocks" (renderer `_sunAngle` on
wall-clock vs `state.tick % 240` in the sim). **This is already fixed on
master** and I verified it: `ThreeRenderer._updateSunCycle` reads the
authoritative `state.timeOfDay`, interpolating locally between ticks and
resyncing whenever the authoritative value changes
(`ThreeRenderer.js:3234-3247`). `Game.js:141` documents the `tick % 240` form as
pre-refactor.

Nothing to do. Recorded so it does not get re-raised.

---

## G. Process, not code

- **A session is editing the main checkout directly.** At time of writing,
  `src/renderer3d/uv-utils.js`, `src/renderer3d/wall-builder.js`,
  `test/uv-utils.test.js` are dirty in master's working directory and
  `scripts/sync-worktrees.mjs` is untracked — none authored by the integrator
  session. This collides with merges. Sessions should stay in their worktrees.
- **`worktree-ui-improvements` was pushed to `origin`** at the user's direct
  instruction in that session. `origin/master` is otherwise only what the
  integrator pushed.
- **Consumers of `findPath` must pick a free goal subtile.** It returns `null`
  immediately when the goal subtile is occupied, so `null` now means either
  "unreachable" or "goal is occupied". The station index already does this;
  anything else built on nav must too.
