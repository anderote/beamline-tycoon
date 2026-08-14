# Handoff: `offsetAlong` semantics, and the Codex integration branch

Written by the Claude integration session on master. Two independent items:
**A** is a design decision that needs making (it is currently the only red test
on master); **B** is a branch waiting to be merged. They do not touch the same
files and can be done in either order.

State at time of writing:

- `master` = `7061adc6`, node suite **132/133**.
- The single failure is `test/test-utility-port-offsets.js` — item A.
- `worktree/integration-2026-08-13` = `c1377481`, 1 ahead / 2 behind — item B.
- **Every other worktree branch is level with master**, 0 ahead / 0 behind,
  including `worktree-ui-improvements`, which fast-forwarded after the item A
  resolution landed.

---

## A. `offsetAlong` — one problem, two solutions, both now on master

### What happened

Two sessions fixed the same bug in different layers, neither seeing the other.

The bug: a port's `offsetAlong` (how far along its face a port sits, authored
per-port in `src/data/utility-ports-v2.js`) **was never read**, so every port on
a given face resolved to that face's midpoint. An MCC with eight power outlets
put all eight in one place.

**Master's fix — `0e8bab5f`, presentation layer.** Resolves `offsetAlong` in
`src/utility/port-anchors.js:145-149`, lerping it across the model's *measured*
bounds. Fittings land on the actual machine geometry. It deliberately leaves
`portWorldPosition` alone, and says so in an explicit invariant:

> "This is the sim's answer: snapping, pathing, overlap and pricing all read it,
> so the numbers it returns must not move."

**The branch's fix — `8d0e4c36`, sim layer.** Makes `portWorldPosition` itself
slide the port along its footprint edge. This moves exactly the numbers the
invariant pins.

### How it was resolved (and what is still open)

`8d0e4c36` is now merged into master, but **its `ports.js` change was dropped**
in the conflict resolution — master's `ports.js` is intact and unmodified. What
did land from it: the doc comment in `utility-ports-v2.js`, and its test file.

The author of `8d0e4c36` independently reached the same conclusion and asked to
hold rather than resolve it themselves; the user confirmed the drop. The commit
is preserved in history at `8d0e4c36` on `worktree-ui-improvements` if anyone
wants it back.

### The part that is NOT resolved, and why it matters

`test/test-utility-port-offsets.js` landed and is **red**. Do not dismiss it as a
stale test — it is a working diagnostic, and it found something real:

```
FAIL: no two utility ports resolve to the same world point (348 found)
FAIL: no two same-utility ports share a routing cell (16 found)
```

Checked across 102 real registry components with 2+ utility ports. So:

- Master fixed where ports are **drawn**.
- Master did **not** fix where ports are **routed from**. 348 pairs still
  collide in sim space; 16 of those are same-utility pairs sharing a routing
  cell, which is the case that actually misbehaves — two cables that should
  leave a machine at different points leave from one.

**Do not delete the test to go green** — it is the only thing measuring this.

### Where the 16 collisions are, and what they are NOT

All 16 are one component — `mcc` — at all four rotations. Its eight outlets
collide in four pairs: `pwr_out_5`/`pwr_out_1`, `6`/`2`, `7`/`3`, `8`/`4`. That
is pointed, because a distribution panel's entire premise is one cable per
socket. `line-drawing.js`'s `ignoreSharedSource` exemption means these are never
*refused* — so half the panel's circuits silently leave from another socket's
point.

**This is NOT a data fix — I checked, and the data is already correct.**
`distributionPorts` (`utility-ports-v2.js:681-702`) spaces them properly:

```
side:        OUTLET_SIDES[i % 4]                    // right, front, left, back
offsetAlong: 0.25 + 0.5 * (Math.floor(i / 4) % 2)   // 0.25 for 1-4, 0.75 for 5-8
```

So `pwr_out_1` is `right @ 0.25` and `pwr_out_5` is `right @ 0.75` —
deliberately half a face apart. They collide **only** because
`portWorldPosition` discards `offsetAlong` and returns the face midpoint for
both. Respacing the data cannot help; there is nothing wrong with it.

That collapses this into one problem: **the mcc bug and the 348-pair gap have a
single cause and a single fix — teaching the sim to honour `offsetAlong`.**
There is no cheap independent first step. Plan for the real change.

On feasibility: `mcc` is `subL: 2, subW: 4`, so its left/right faces are 1 m
long. At 0.25/0.75 the two outlets sit 0.5 m apart — exactly one routing cell at
the 0.5 m path quantisation. Tight, but sufficient: honouring `offsetAlong`
*does* separate them, with no headroom to spare. Faces shorter than 1 m, or
offsets closer than 0.5 apart, would still collide — that is what a finer grid
or an off-grid first segment would buy.

### The decision to make

1. **Accept the gap.** Ports draw apart, route from one point. Keep the test but
   restate it as a characterisation of current behaviour (assert the collision
   count is 348, so a change in it is loud). Cheapest; leaves the panel oddity.

2. **Give the sim distinct per-port points.** The real fix. Note this is *what
   `8d0e4c36` attempted*, so read it before redoing the work — but do not adopt
   it as-is: it moves the pinned sim numbers without addressing the quantisation
   limit, so it changes snapping/pricing behaviour and still collides on faces
   under 1 m.

If (2), re-read the invariant comment on `portWorldPosition` first and decide
deliberately whether it survives — every consumer listed in it (snapping,
pathing, overlap, pricing) has to be re-checked, and that is the actual cost.

### Ground truth to work from

- `src/utility/port-anchors.js:135-149` — how master resolves `offsetAlong`.
- `src/utility/ports.js` `portWorldPosition` — the invariant, and the local-frame
  helpers (`portLocalAxis`, `footprintHalfExtents`, `rotateLocalOffset`) that any
  new arithmetic should be expressed through rather than re-derived.
- `git show 8d0e4c36` — the rejected approach.
- One inconsistency to clean up either way: the doc comment at
  `src/data/utility-ports-v2.js:15-21` still points at `portWorldPosition` as
  where `offsetAlong` is honoured. On master it is honoured in
  `port-anchors.js`. Correct that pointer.

---

## B. `worktree/integration-2026-08-13` (`c1377481`)

Lives in a **sibling** directory, `/Users/andrewcote/Documents/software/beamline-tycoon-integration`
— outside `.claude/worktrees/`, which is why the sweep that levelled every other
branch missed it. 1 ahead, 2 behind master. 26 files, +1761/-79.

**Do not merge this commit wholesale.** Its lighting content is not independent
work — it is a live Claude session's in-flight LOD implementation, captured
mid-edit by the item C snapshot below. Confirmed by that session against its own
agent's report, and corroborated here: `fixtureLightTag`, `applyPoolSuppression`,
`getFixtureSuppression`, `poolQuadByFixtureId`, `SPOT_RANK_SLACK`, `flashReserve`
and `_tmpCam` are all present in the commit.

So there is no second implementation to reconcile — it is one piece of work
appearing in two places.

- **Exclude** `src/renderer3d/{light-rig,lighting-builder,decoration-builder}.js`,
  `src/renderer3d/ThreeRenderer.js`, `test/test-light-pools.js`,
  `test/test-light-rig.js`, `test/test-light-pool-suppression.js`. The owning
  session is rebuilding these against current master (`c1377481` is based on an
  older one) and will land them directly, diffing against the `c1377481` copies
  as ground truth.
- **The other ~19 files are fair game** — save slots, `scripts/*`, the plan doc,
  data and utility changes.

It does not touch `src/utility/ports.js` or the offsets test, so it is
independent of item A.

Note this also resolves the LOD collision flagged as section A of
`2026-08-13-post-integration-cleanup.md`: pool suppression is implemented, not
merely proposed. That section's *product* question (how aggressive the LOD is)
is still open, but the mechanism now exists.

---

## C. A snapshot-then-clean sweep runs over the main checkout — and it is not reliable

Something periodically commits the main checkout's working tree (tracked *and*
untracked) to `worktree/integration-2026-08-13` in the sibling repo, then resets
and cleans the main checkout.

When the snapshot fires, nothing is lost. Verified for the 23:0x sweep: every
file that "vanished" is present in `c1377481` — `git cat-file -e c1377481:<path>`
on `2026-08-13-post-integration-cleanup.md`, `scripts/sync-worktrees.mjs`,
`scripts/save-server.mjs`, `test/test-plant-materials.js`,
`test/test-light-pool-suppression.js`, `test/browser/_scratch.spec.mjs` — exactly
the set `git clean -fd` removed.

**But the clean also runs without a snapshot.** This very document was deleted
from the working tree while the sibling repo's tip was still `c1377481`, which
predates it. So untracked files created since the last snapshot are genuinely
destroyed, not captured. That is why this file is now committed rather than left
untracked.

**Recovery, when the snapshot did fire:**

```
git -C /Users/andrewcote/Documents/software/beamline-tycoon-integration show <sha>:<path>
```

Reflog trace for identifying the owner: `reset: moving to HEAD` at 23:04:19
(main), 23:04:26 (`worktrees/beamline-tycoon-integration`), 23:06:50
(`worktrees/save-recovery`), and earlier at 22:37:41, 22:32:32, 21:25:36,
16:13:38. `scripts/sync-worktrees.mjs` is ruled out — it is documented never to
reset, and its `pull` skips dirty worktrees. `.codex/worktrees/` exists in the
main checkout, so the Codex-side agent is the likely owner.

**What needs to change:** the main checkout is shared by several agent sessions
and a dirty tree is its normal state, not an error to clean up. Either skip
checkouts with uncommitted changes, or guarantee the snapshot commits *before*
every clean and announce the ref. As it stands it silently deletes in-flight
work, and at least one session spent real time regenerating work it did not need
to.
