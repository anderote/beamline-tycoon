# Beamline Module Insert-on-Pipe + Physics Length Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable inserting beamline modules into existing beampipes (splits the pipe and reconnects ports), and make component `subL` the single source of truth for physics lengths by removing every silent fallback in the Python propagator.

**Architecture:** Two decoupled workstreams. **Phase 1** (physics audit) is isolated to Python and a single JS data file — safe to land first. **Phase 2** (insert-and-split placement) builds on `Game.placePlaceable` and adds a new pre-check that detects a pipe under the cursor, validates rotation/footprint alignment against the pipe's local direction, atomically splits the pipe into two halves, and reconnects them to the module's entry/exit ports.

**Tech Stack:** JavaScript (ES modules), Python 3 (unittest), Pyodide bridge (JS → Python). Python tests are in `test/test_*.py` run with `python -m unittest test.<name>`. JS tests are plain Node scripts in `test/test-*.js` run with `node test/<name>.js`.

**Spec:** `docs/superpowers/specs/2026-04-11-beamline-module-insert-and-physics-audit-design.md`

---

## Phase 1 — Physics length audit

### Task 1: Verify `beamline-components.raw.js` declares `subL` on every placeable entry

**Files:**
- Modify: `src/data/beamline-components.raw.js` (only if gaps found)

- [ ] **Step 1: Inventory entries missing `subL`**

Run:
```bash
node -e "
const m = require('./src/data/beamline-components.raw.js');
const R = m.BEAMLINE_COMPONENTS_RAW;
const missing = Object.entries(R).filter(([k, v]) => v.placement && v.subL == null);
console.log('missing subL:', missing.map(([k]) => k));
console.log('total with placement:', Object.values(R).filter(v => v.placement).length);
"
```

Expected: `missing subL: []`. Current audit (at spec time) shows 26 placeable entries, all declaring `subL`.

- [ ] **Step 2: If any are missing, add `subL` to each**

For each missing entry, add a line next to `subW`:

```js
subL: <value>,   // derived from COMPONENT_DEFAULTS[type].length / 0.5
```

Use the existing Python defaults in `beam_physics/gameplay.py:13` (`COMPONENT_DEFAULTS`) divided by 0.5 to preserve current behavior. Example: `rfCavity` default length 3.0 m → `subL: 6`.

- [ ] **Step 3: Commit (only if edits were made)**

```bash
git add src/data/beamline-components.raw.js
git commit -m "data(beamline): declare subL on all placeable components"
```

If no edits were needed, skip the commit and move to Task 2.

---

### Task 2: Remove length fallback in `beam_physics/elements.py::transfer_matrix`

**Files:**
- Modify: `beam_physics/elements.py:216`
- Modify: `public/beam_physics/elements.py:216` (mirror)
- Test: `test/test_length_required.py` (create)

- [ ] **Step 1: Write the failing test**

Create `test/test_length_required.py`:

```python
import unittest
import numpy as np
from beam_physics.elements import transfer_matrix


class TestLengthRequired(unittest.TestCase):
    def test_transfer_matrix_raises_without_length(self):
        element = {"type": "drift"}
        with self.assertRaises(KeyError):
            transfer_matrix(element)

    def test_transfer_matrix_with_length_succeeds(self):
        element = {"type": "drift", "length": 1.5}
        R = transfer_matrix(element)
        self.assertEqual(R.shape, (6, 6))
        self.assertAlmostEqual(R[0, 1], 1.5)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest test.test_length_required -v`

Expected: `test_transfer_matrix_raises_without_length` FAILS (returns a drift matrix with length 1.0 instead of raising).

- [ ] **Step 3: Remove the fallback**

In `beam_physics/elements.py`, change line 216:

```python
    length = element.get("length", 1.0)
```

to:

```python
    length = element["length"]
```

- [ ] **Step 4: Mirror to `public/beam_physics/elements.py`**

Apply the exact same change to `public/beam_physics/elements.py:216`.

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m unittest test.test_length_required -v`

Expected: both tests PASS.

- [ ] **Step 6: Run the existing physics test suite to catch regressions**

Run: `python -m unittest discover test -v 2>&1 | tail -30`

Expected: all tests that previously passed still pass. If a test fails because it builds an element without `length`, update the test to supply a valid length (and note the test name in the commit message).

- [ ] **Step 7: Commit**

```bash
git add beam_physics/elements.py public/beam_physics/elements.py test/test_length_required.py
git commit -m "physics(elements): require length on element dict, no silent fallback"
```

---

### Task 3: Remove length fallbacks in `beam_physics/lattice.py`

**Files:**
- Modify: `beam_physics/lattice.py:26,90,110`
- Modify: `public/beam_physics/lattice.py` (mirror)
- Test: `test/test_length_required.py` (extend)

- [ ] **Step 1: Extend the failing test**

Append to `test/test_length_required.py`:

```python
from beam_physics.lattice import propagate, _make_sub_element


class TestLatticeLengthRequired(unittest.TestCase):
    def test_make_sub_element_raises_without_length(self):
        with self.assertRaises(KeyError):
            _make_sub_element({"type": "drift"}, 0.5)

    def test_propagate_raises_without_length(self):
        config = [
            {"type": "source", "length": 1.0},
            {"type": "drift"},  # missing length
        ]
        with self.assertRaises(KeyError):
            propagate(config, machine_type="linac")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m unittest test.test_length_required -v`

Expected: both new tests FAIL (current code uses `.get("length", 0.0)`).

- [ ] **Step 3: Remove the three fallbacks in `beam_physics/lattice.py`**

At line 26 inside `_make_sub_element`:
```python
    full_length = element.get("length", 0.0)
```
→
```python
    full_length = element["length"]
```

At line 90 inside the source branch of `propagate`:
```python
            source_len = element.get("length", 0.0)
```
→
```python
            source_len = element["length"]
```

At line 110 inside the main propagation loop of `propagate`:
```python
        length = element.get("length", 0.0)
```
→
```python
        length = element["length"]
```

Note: line 148 (`context.cumulative_s += sub_el.get("length", 0.0)`) is inside the `for step in range(n_steps):` loop and operates on a `sub_el` that `_make_sub_element` already populated with `length`. Change it to `sub_el["length"]` for consistency.

- [ ] **Step 4: Mirror all four changes to `public/beam_physics/lattice.py`**

- [ ] **Step 5: Run the new tests and the full suite**

Run: `python -m unittest test.test_length_required -v && python -m unittest discover test -v 2>&1 | tail -30`

Expected: all new tests PASS; no regressions in the rest of the suite.

- [ ] **Step 6: Commit**

```bash
git add beam_physics/lattice.py public/beam_physics/lattice.py test/test_length_required.py
git commit -m "physics(lattice): require length in propagator, no silent fallback"
```

---

### Task 4: Remove `COMPONENT_DEFAULTS` length entries and the `subL` fallback in `gameplay.py`

**Files:**
- Modify: `beam_physics/gameplay.py:13-72,150,156-161`
- Modify: `public/beam_physics/gameplay.py` (mirror)
- Test: `test/test_length_required.py` (extend)

- [ ] **Step 1: Extend the failing test**

Append to `test/test_length_required.py`:

```python
from beam_physics.gameplay import beamline_config_from_game


class TestGameplayBridgeLengthRequired(unittest.TestCase):
    def test_missing_subL_raises(self):
        game_beamline = [
            {"type": "source", "subL": 4},
            {"type": "drift"},  # no subL
        ]
        with self.assertRaises(ValueError) as cm:
            beamline_config_from_game(game_beamline)
        self.assertIn("subL", str(cm.exception))

    def test_subL_converted_to_meters(self):
        game_beamline = [
            {"type": "source", "subL": 4},
            {"type": "drift", "subL": 6},
        ]
        elements = beamline_config_from_game(game_beamline)
        self.assertAlmostEqual(elements[0]["length"], 2.0)  # 4 * 0.5
        self.assertAlmostEqual(elements[1]["length"], 3.0)  # 6 * 0.5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest test.test_length_required -v`

Expected: `test_missing_subL_raises` FAILS (the current code silently falls back to `COMPONENT_DEFAULTS`).

- [ ] **Step 3: Delete all `"length": <n>` keys from `COMPONENT_DEFAULTS`**

In `beam_physics/gameplay.py:13-72`, remove the `"length": <n>,` entry from every dict. Leave all non-length keys (`emittance`, `energyGain`, `focusStrength`, `bendAngle`, `field`, `beamQuality`, `photonRate`, `r56`, `dataRate`, `collisionRate`) untouched. Entries whose only key was `length` become empty dicts — delete those entries entirely (e.g., `"source": {"length": 2.0}` → delete the whole `"source"` line).

After the edit, `COMPONENT_DEFAULTS` should contain only parameter defaults, no length entries.

- [ ] **Step 4: Replace the `subL` fallback in `beamline_config_from_game`**

In `beam_physics/gameplay.py`, replace lines 155–161:

```python
        # subL sub-units × 0.5m per sub-unit
        sub_l = comp.get("subL", None)
        if sub_l is not None:
            el["length"] = sub_l * 0.5
        else:
            # Fallback for components not yet migrated
            el["length"] = comp.get("length", defaults.get("length", 1.0)) * LENGTH_SCALE
```

with:

```python
        # Length: subL (sub-units) × 0.5 m per sub-unit. Required.
        sub_l = comp.get("subL", None)
        if sub_l is None:
            raise ValueError(
                f"component '{ctype}' has no subL — every beamline component "
                f"must declare subL in beamline-components.raw.js"
            )
        el["length"] = sub_l * 0.5
```

- [ ] **Step 5: Remove the now-unused `LENGTH_SCALE` constant**

At line 96:
```python
LENGTH_SCALE = 2.0        # game tiles are 2m x 2m
```

Delete this line. Grep the file first to confirm no other references remain:

Run: `grep -n LENGTH_SCALE beam_physics/gameplay.py`

Expected: no output after deletion.

- [ ] **Step 6: Mirror all changes to `public/beam_physics/gameplay.py`**

- [ ] **Step 7: Verify the two directories are identical**

Run: `diff -r beam_physics public/beam_physics`

Expected: no output (byte-identical).

- [ ] **Step 8: Run the new tests and the full suite**

Run: `python -m unittest test.test_length_required -v && python -m unittest discover test -v 2>&1 | tail -40`

Expected: all new tests PASS; no regressions. If an existing test fails because it constructs a game beamline dict without `subL`, update that test to supply `subL` (preserving the equivalent meter value via `subL = length / 0.5`).

- [ ] **Step 9: Commit**

```bash
git add beam_physics/gameplay.py public/beam_physics/gameplay.py test/test_length_required.py
git commit -m "physics(bridge): require subL on every component, no silent fallback"
```

---

### Task 5: Add RF cavity envelope-evolution regression test

**Files:**
- Test: `test/test_rf_cavity_distributed.py` (create)

This is a regression test documenting the existing correct behavior (RF cavity is already distributed via `drift_matrix(length)` + `_make_sub_element` scaling `energyGain`). It locks in the invariant so future refactors can't silently make RF cavities point-like.

- [ ] **Step 1: Write the test**

Create `test/test_rf_cavity_distributed.py`:

```python
import unittest
from beam_physics.lattice import propagate


class TestRFCavityDistributed(unittest.TestCase):
    def test_rf_cavity_envelope_evolves_across_length(self):
        """A beam crossing an 8 m RF cavity should show multiple distinct
        sigma-x snapshots inside the cavity, not a single step."""
        config = [
            {"type": "source", "length": 1.0},
            {"type": "drift", "length": 2.0},
            {"type": "rfCavity", "length": 8.0, "energyGain": 2.0},
            {"type": "drift", "length": 2.0},
        ]
        result = propagate(config, machine_type="linac")
        snaps = result["snapshots"]

        rf_snaps = [s for s in snaps if s.get("element_type") == "rfCavity"]
        self.assertGreaterEqual(
            len(rf_snaps), 3,
            f"expected >=3 snapshots inside RF cavity, got {len(rf_snaps)}"
        )

        sigma_x_values = [s.get("sigma_x", 0.0) for s in rf_snaps]
        distinct = len(set(round(v, 9) for v in sigma_x_values))
        self.assertGreaterEqual(
            distinct, 2,
            f"expected >=2 distinct sigma_x values inside RF cavity, got {distinct}"
        )

    def test_rf_cavity_energy_gain_proportional_to_length(self):
        """A 4 m cavity with energyGain=1.0 should deliver ~half the final
        energy boost of an 8 m cavity with energyGain=1.0 (same per-meter)."""
        short_config = [
            {"type": "source", "length": 1.0},
            {"type": "rfCavity", "length": 4.0, "energyGain": 1.0},
        ]
        long_config = [
            {"type": "source", "length": 1.0},
            {"type": "rfCavity", "length": 8.0, "energyGain": 2.0},
        ]
        e_short = propagate(short_config, machine_type="linac")["summary"]["final_energy"]
        e_long = propagate(long_config, machine_type="linac")["summary"]["final_energy"]
        self.assertGreater(e_long, e_short)


if __name__ == "__main__":
    unittest.main()
```

Note: the field name on snapshots (`element_type`, `sigma_x`) may differ — see `beam_physics/beam.py::snapshot()` or `beam_physics/context.py`. Before running the test, open `beam_physics/beam.py` and grep for `def snapshot` to confirm the exact field names used and adjust the test keys if necessary.

- [ ] **Step 2: Verify field names on snapshot dicts**

Run: `grep -n "def snapshot" beam_physics/beam.py`

Read the function body and confirm the exact keys stored (likely `sigma_x`, `element_type` or `etype` — adjust the test to match).

- [ ] **Step 3: Run the test**

Run: `python -m unittest test.test_rf_cavity_distributed -v`

Expected: both tests PASS on the current (correct) implementation. If either fails, investigate: either the field names are wrong (fix the test) or RF is not actually distributed (open question — flag to user).

- [ ] **Step 4: Commit**

```bash
git add test/test_rf_cavity_distributed.py
git commit -m "test(physics): regression test for RF cavity distributed envelope evolution"
```

---

## Phase 2 — Insert-and-split placement

### Task 6: Add pipe geometry helpers in a new module

**Files:**
- Create: `src/beamline/pipe-geometry.js`
- Test: `test/test-pipe-geometry.js` (create)

Helpers needed by `tryInsertOnBeamPipe`:
- `expandPipePath(path)` — given a pipe's waypoint list `[{col,row}, ...]`, return a dense list of every tile traversed (inclusive), in order.
- `findPipeAtTile(beamPipes, col, row)` — return `{pipe, tileIndex}` of the pipe whose expanded path contains `(col,row)`, or `null`.
- `pipeDirectionAtTile(pipe, tileIndex)` — return `{dCol, dRow}` (unit vector) representing the pipe's local direction at `tileIndex` in the expanded path. Returns `null` if the tile is at a corner (prev/next in expanded path are not collinear) or at an endpoint.

- [ ] **Step 1: Write the failing tests**

Create `test/test-pipe-geometry.js`:

```js
import { expandPipePath, findPipeAtTile, pipeDirectionAtTile } from '../src/beamline/pipe-geometry.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`); }

console.log('expandPipePath');
assertEq(
  expandPipePath([{col:0,row:0},{col:3,row:0}]),
  [{col:0,row:0},{col:1,row:0},{col:2,row:0},{col:3,row:0}],
  'straight horizontal 4 tiles'
);
assertEq(
  expandPipePath([{col:0,row:0},{col:0,row:2},{col:2,row:2}]),
  [{col:0,row:0},{col:0,row:1},{col:0,row:2},{col:1,row:2},{col:2,row:2}],
  'L-bend'
);
assertEq(
  expandPipePath([{col:5,row:5}]),
  [{col:5,row:5}],
  'single waypoint'
);

console.log('findPipeAtTile');
const pipes = [
  { id: 'bp_1', path: [{col:0,row:0},{col:5,row:0}] },
  { id: 'bp_2', path: [{col:10,row:0},{col:10,row:5}] },
];
const hit = findPipeAtTile(pipes, 3, 0);
assert(hit && hit.pipe.id === 'bp_1' && hit.tileIndex === 3, 'finds bp_1 at (3,0) with index 3');
assert(findPipeAtTile(pipes, 7, 0) === null, 'no pipe at (7,0)');
const hit2 = findPipeAtTile(pipes, 10, 3);
assert(hit2 && hit2.pipe.id === 'bp_2' && hit2.tileIndex === 3, 'finds bp_2 at (10,3)');

console.log('pipeDirectionAtTile');
const straight = { path: [{col:0,row:0},{col:5,row:0}] };
assertEq(pipeDirectionAtTile(straight, 2), {dCol:1,dRow:0}, 'horizontal direction at middle');
assertEq(pipeDirectionAtTile(straight, 0), null, 'endpoint returns null');
assertEq(pipeDirectionAtTile(straight, 4), null, 'final endpoint returns null');
const lBend = { path: [{col:0,row:0},{col:0,row:2},{col:2,row:2}] };
assertEq(pipeDirectionAtTile(lBend, 2), null, 'corner returns null');
assertEq(pipeDirectionAtTile(lBend, 1), {dCol:0,dRow:1}, 'straight before corner');
assertEq(pipeDirectionAtTile(lBend, 3), {dCol:1,dRow:0}, 'straight after corner');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/test-pipe-geometry.js`

Expected: FAIL with `Cannot find module '../src/beamline/pipe-geometry.js'`.

- [ ] **Step 3: Implement the helpers**

Create `src/beamline/pipe-geometry.js`:

```js
// src/beamline/pipe-geometry.js
//
// Helpers for reasoning about beampipe paths as sequences of tiles.
// Pipe paths in game state are stored as waypoints (corners only);
// these helpers expand them into dense per-tile lists for hit-testing
// and direction queries.

export function expandPipePath(path) {
  if (!path || path.length === 0) return [];
  if (path.length === 1) return [{ col: path[0].col, row: path[0].row }];
  const tiles = [{ col: path[0].col, row: path[0].row }];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dCol = Math.sign(b.col - a.col);
    const dRow = Math.sign(b.row - a.row);
    let cur = { col: a.col, row: a.row };
    while (cur.col !== b.col || cur.row !== b.row) {
      cur = { col: cur.col + dCol, row: cur.row + dRow };
      tiles.push({ col: cur.col, row: cur.row });
    }
  }
  return tiles;
}

export function findPipeAtTile(beamPipes, col, row) {
  for (const pipe of beamPipes) {
    const tiles = expandPipePath(pipe.path);
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i].col === col && tiles[i].row === row) {
        return { pipe, tileIndex: i, expandedTiles: tiles };
      }
    }
  }
  return null;
}

export function pipeDirectionAtTile(pipe, tileIndex) {
  const tiles = expandPipePath(pipe.path);
  if (tileIndex <= 0 || tileIndex >= tiles.length - 1) return null;
  const prev = tiles[tileIndex - 1];
  const next = tiles[tileIndex + 1];
  const dCol = next.col - prev.col;
  const dRow = next.row - prev.row;
  const dist = Math.abs(dCol) + Math.abs(dRow);
  if (dist !== 2) return null;   // corner: prev/next not collinear through tileIndex
  return { dCol: Math.sign(dCol), dRow: Math.sign(dRow) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/test-pipe-geometry.js`

Expected: all assertions PASS; exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/beamline/pipe-geometry.js test/test-pipe-geometry.js
git commit -m "beamline(geometry): add pipe path expansion and direction helpers"
```

---

### Task 7: Add module port-axis helper

**Files:**
- Create: `src/beamline/module-axis.js`
- Test: `test/test-module-axis.js` (create)

Given a beamline module's component def (with `ports: { entry: {side:'back'}, exit: {side:'front'} }`) and a placement direction `dir ∈ {0,1,2,3}`, compute:
- The module's **beam-axis vector** `{dCol, dRow}` in world coordinates (from entry to exit).
- Whether the module has a "beam axis" at all (requires both an entry-like port and an exit-like port).

Convention used in `beamline-components.raw.js`:
- `side: 'front'` = the `+row` direction in `dir=0` local space (exit).
- `side: 'back'` = the `-row` direction in `dir=0` local space (entry).
- `dir=1` rotates 90° CW, `dir=2` 180°, `dir=3` 270°.

- [ ] **Step 1: Write the failing tests**

Create `test/test-module-axis.js`:

```js
import { moduleBeamAxis, axisMatchesDirection } from '../src/beamline/module-axis.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`); }

const twoPortDef = { ports: { entry: { side: 'back' }, exit: { side: 'front' } } };
const sourceDef = { ports: { exit: { side: 'front' } } };

console.log('moduleBeamAxis — two-port module');
assertEq(moduleBeamAxis(twoPortDef, 0), { dCol: 0, dRow: 1 },  'dir=0 → +row');
assertEq(moduleBeamAxis(twoPortDef, 1), { dCol: -1, dRow: 0 }, 'dir=1 → -col');
assertEq(moduleBeamAxis(twoPortDef, 2), { dCol: 0, dRow: -1 }, 'dir=2 → -row');
assertEq(moduleBeamAxis(twoPortDef, 3), { dCol: 1, dRow: 0 },  'dir=3 → +col');

console.log('moduleBeamAxis — single-port source');
assert(moduleBeamAxis(sourceDef, 0) === null, 'source has no through-axis');

console.log('axisMatchesDirection');
assert(axisMatchesDirection({dCol:1,dRow:0}, {dCol:1,dRow:0}), 'same direction matches');
assert(axisMatchesDirection({dCol:1,dRow:0}, {dCol:-1,dRow:0}), 'opposite matches (pipes are undirected)');
assert(!axisMatchesDirection({dCol:1,dRow:0}, {dCol:0,dRow:1}), 'perpendicular does not match');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
```

- [ ] **Step 2: Run to verify fail**

Run: `node test/test-module-axis.js`

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/beamline/module-axis.js`:

```js
// src/beamline/module-axis.js
//
// Compute a beamline module's through-axis in world coordinates given its
// port definitions and placement direction. A module has a beam axis only
// if it has both an "entry-like" port (side=back) and an "exit-like" port
// (side=front) — sources and endpoints return null.

const SIDE_VECTORS = { front: { dCol: 0, dRow: 1 }, back: { dCol: 0, dRow: -1 } };

function rotate(vec, dir) {
  const d = ((dir % 4) + 4) % 4;
  switch (d) {
    case 0: return { dCol: vec.dCol, dRow: vec.dRow };
    case 1: return { dCol: -vec.dRow, dRow: vec.dCol };
    case 2: return { dCol: -vec.dCol, dRow: -vec.dRow };
    case 3: return { dCol: vec.dRow, dRow: -vec.dCol };
  }
}

export function moduleBeamAxis(def, dir = 0) {
  const ports = def?.ports;
  if (!ports) return null;
  const entry = Object.values(ports).find(p => p.side === 'back');
  const exit  = Object.values(ports).find(p => p.side === 'front');
  if (!entry || !exit) return null;
  const local = { dCol: 0, dRow: 1 };  // back → front
  return rotate(local, dir);
}

export function axisMatchesDirection(a, b) {
  if (!a || !b) return false;
  const same     = a.dCol ===  b.dCol && a.dRow ===  b.dRow;
  const opposite = a.dCol === -b.dCol && a.dRow === -b.dRow;
  return same || opposite;
}
```

- [ ] **Step 4: Run tests**

Run: `node test/test-module-axis.js`

Expected: all PASS; exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/beamline/module-axis.js test/test-module-axis.js
git commit -m "beamline(modules): compute module beam-axis in world coords"
```

---

### Task 8: Implement `tryInsertOnBeamPipe` in `Game.js`

**Files:**
- Modify: `src/game/Game.js` (add new method, wire into `placePlaceable`)

- [ ] **Step 1: Add the method**

In `src/game/Game.js`, immediately before `placePlaceable(opts)` at line 1255, insert:

```js
  /**
   * Attempt to insert a beamline module into an existing beampipe by
   * splitting the pipe at the module footprint and reconnecting the two
   * halves to the module's entry/exit ports.
   *
   * Returns the new module id on success, or null to indicate the caller
   * should fall through to normal placement.
   */
  tryInsertOnBeamPipe(opts) {
    const { type, col, row, dir = 0 } = opts;
    const placeable = PLACEABLES[type];
    if (!placeable || placeable.kind !== 'beamline') return null;

    const def = COMPONENTS[type];
    if (!def || !def.ports) return null;

    // 1. Find a pipe under the cursor tile.
    const hit = findPipeAtTile(this.state.beamPipes, col, row);
    if (!hit) return null;
    const { pipe, tileIndex, expandedTiles } = hit;

    // 2. Pipe must be straight at this tile (no corner).
    const pipeDir = pipeDirectionAtTile(pipe, tileIndex);
    if (!pipeDir) return null;

    // 3. Module must have a through-axis and match the pipe direction.
    const moduleDir = moduleBeamAxis(def, dir);
    if (!moduleDir) return null;
    if (!axisMatchesDirection(moduleDir, pipeDir)) return null;

    // 4. Footprint along the beam axis must lie entirely inside a straight
    //    run of the expanded pipe tiles. Length in tiles = ceil(subL/4).
    const tileLen = Math.max(1, Math.ceil(placeable.subL / 4));
    const halfBefore = Math.floor((tileLen - 1) / 2);
    const startIdx = tileIndex - halfBefore;
    const endIdx = startIdx + tileLen - 1;
    if (startIdx <= 0 || endIdx >= expandedTiles.length - 1) return null;
    // Every tile in [startIdx..endIdx] and one tile on each side must be
    // collinear (direction from prev to next must be constant).
    for (let i = startIdx - 1; i <= endIdx + 1; i++) {
      const d = pipeDirectionAtTile(pipe, i);
      if (!d || d.dCol !== pipeDir.dCol || d.dRow !== pipeDir.dRow) return null;
    }

    // 5. Compute the subtile origin so the module is centered on expandedTiles[tileIndex].
    //    The origin (col, row, subCol=0, subRow=0) convention in placePlaceable
    //    treats the footprint as growing +subCol / +subRow from the origin tile.
    //    For insertion we snap the module's tile-length window to the expanded
    //    path and place it at the top-left tile of that window.
    const originTile = expandedTiles[startIdx];
    const originCol = originTile.col;
    const originRow = originTile.row;

    // 6. No other placeable can occupy the footprint.
    const cells = placeable.footprintCells(originCol, originRow, 0, 0, dir);
    for (const c of cells) {
      const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
      if (this.state.subgridOccupied[k]) return null;
    }

    // 7. Save rollback snapshot of the original pipe.
    const originalPipe = {
      id: pipe.id,
      fromId: pipe.fromId, fromPort: pipe.fromPort,
      toId: pipe.toId,     toPort: pipe.toPort,
      path: pipe.path.map(p => ({ col: p.col, row: p.row })),
      subL: pipe.subL,
      attachments: pipe.attachments.map(a => ({ ...a, params: { ...a.params } })),
    };

    // 8. Delete the original pipe from state.
    const pipeIdx = this.state.beamPipes.findIndex(p => p.id === pipe.id);
    if (pipeIdx === -1) return null;
    this.state.beamPipes.splice(pipeIdx, 1);

    // 9. Place the module via the existing path.
    const moduleId = this.placePlaceable({
      type, col: originCol, row: originRow, subCol: 0, subRow: 0, dir,
      params: opts.params,
    });
    if (!moduleId) {
      // Restore and bail.
      this.state.beamPipes.splice(pipeIdx, 0, originalPipe);
      return null;
    }

    // 10. Split the expanded tile list into "before module" and "after module"
    //     in terms of the original waypoint path. The two new pipe paths each
    //     keep the endpoint nearest their respective module port.
    const beforeTiles = expandedTiles.slice(0, startIdx);
    const afterTiles  = expandedTiles.slice(endIdx + 1);

    // Condense consecutive-collinear tiles back into waypoint paths.
    const condense = (tiles) => {
      if (tiles.length === 0) return [];
      if (tiles.length === 1) return [{ col: tiles[0].col, row: tiles[0].row }];
      const out = [{ col: tiles[0].col, row: tiles[0].row }];
      let curDir = null;
      for (let i = 1; i < tiles.length; i++) {
        const d = { dCol: Math.sign(tiles[i].col - tiles[i-1].col), dRow: Math.sign(tiles[i].row - tiles[i-1].row) };
        if (curDir && (d.dCol !== curDir.dCol || d.dRow !== curDir.dRow)) {
          out.push({ col: tiles[i-1].col, row: tiles[i-1].row });
        }
        curDir = d;
      }
      out.push({ col: tiles[tiles.length-1].col, row: tiles[tiles.length-1].row });
      return out;
    };

    const beforePath = condense(beforeTiles);
    const afterPath  = condense(afterTiles);

    // 11. Determine which module port is "entry from A" vs "exit to B".
    //     The module's axis points from back (entry) to front (exit) in world
    //     coordinates. If moduleDir points from the before-side to the after-side,
    //     then entry connects to beforePath (A) and exit to afterPath (B).
    //     Otherwise they swap.
    const beforeToAfter = {
      dCol: Math.sign(expandedTiles[endIdx + 1].col - expandedTiles[startIdx - 1].col),
      dRow: Math.sign(expandedTiles[endIdx + 1].row - expandedTiles[startIdx - 1].row),
    };
    const entryPortName = Object.entries(def.ports).find(([, p]) => p.side === 'back')[0];
    const exitPortName  = Object.entries(def.ports).find(([, p]) => p.side === 'front')[0];
    const moduleMatchesFlow = (moduleDir.dCol === beforeToAfter.dCol && moduleDir.dRow === beforeToAfter.dRow);
    const beforePort = moduleMatchesFlow ? entryPortName : exitPortName;
    const afterPort  = moduleMatchesFlow ? exitPortName  : entryPortName;

    // 12. Create the two new pipes directly (bypass createBeamPipe's cost
    //     check and duplicate-port check — this is a split, not a new build).
    const makePipe = (fromId, fromPort, toId, toPort, path) => {
      let tileDist = 0;
      for (let i = 0; i < path.length - 1; i++) {
        tileDist += Math.abs(path[i+1].col - path[i].col) + Math.abs(path[i+1].row - path[i].row);
      }
      return {
        id: 'bp_' + this.state.beamPipeNextId++,
        fromId, fromPort, toId, toPort,
        path: path.map(p => ({ col: p.col, row: p.row })),
        subL: Math.max(1, Math.round(tileDist * 4)),
        attachments: [],
      };
    };

    const p1 = makePipe(originalPipe.fromId, originalPipe.fromPort, moduleId, beforePort, beforePath);
    const p2 = makePipe(moduleId, afterPort, originalPipe.toId, originalPipe.toPort, afterPath);
    this.state.beamPipes.push(p1, p2);

    // 13. Reassign attachments by tile position.
    const tileContains = (path, col, row) => {
      const tiles = expandPipePath(path);
      return tiles.some(t => t.col === col && t.row === row);
    };
    let droppedAttachments = 0;
    for (const att of originalPipe.attachments) {
      // Attachments store position as a 0..1 fraction along the *original* pipe.
      const origTiles = expandPipePath(originalPipe.path);
      const attTileIdx = Math.min(origTiles.length - 1, Math.max(0, Math.round(att.position * (origTiles.length - 1))));
      const attTile = origTiles[attTileIdx];
      if (tileContains(beforePath, attTile.col, attTile.row)) {
        const beforeTilesForPos = expandPipePath(beforePath);
        const newIdx = beforeTilesForPos.findIndex(t => t.col === attTile.col && t.row === attTile.row);
        att.position = newIdx / Math.max(1, beforeTilesForPos.length - 1);
        p1.attachments.push(att);
      } else if (tileContains(afterPath, attTile.col, attTile.row)) {
        const afterTilesForPos = expandPipePath(afterPath);
        const newIdx = afterTilesForPos.findIndex(t => t.col === attTile.col && t.row === attTile.row);
        att.position = newIdx / Math.max(1, afterTilesForPos.length - 1);
        p2.attachments.push(att);
      } else {
        droppedAttachments++;
      }
    }

    if (droppedAttachments > 0) {
      this.log(`Removed ${droppedAttachments} attachment(s) inside new module footprint`, 'info');
    }
    this.log(`Inserted ${placeable.name} into pipe`, 'good');

    this._deriveBeamGraph();
    this.computeSystemStats();
    this.emit('beamlineChanged');
    this.emit('placeableChanged');
    return moduleId;
  }
```

- [ ] **Step 2: Add the imports at the top of `Game.js`**

Near the other beamline imports (search for `from '../beamline/`), add:

```js
import { expandPipePath, findPipeAtTile, pipeDirectionAtTile } from '../beamline/pipe-geometry.js';
import { moduleBeamAxis, axisMatchesDirection } from '../beamline/module-axis.js';
```

- [ ] **Step 3: Wire it into `placePlaceable`**

In `placePlaceable` (line 1255), immediately after the `placeable = PLACEABLES[type]; if (!placeable) return false;` check and before the affordability check, add:

```js
    // If this is a beamline module and the cursor tile is on a pipe
    // with matching rotation, attempt insert-and-split first.
    if (placeable.kind === 'beamline') {
      const inserted = this.tryInsertOnBeamPipe(opts);
      if (inserted) return inserted;
    }
```

- [ ] **Step 4: Commit (tests come in Task 9)**

```bash
git add src/game/Game.js
git commit -m "game(placement): insert-and-split beamline modules into existing pipes"
```

---

### Task 9: Integration test for insert-and-split

**Files:**
- Test: `test/test-insert-and-split.js` (create)

Build a minimal game instance with a source, an endpoint, and a pipe between them, then insert a quadrupole and assert the pipe was split correctly.

- [ ] **Step 1: Scan existing node-based game tests for a mockable `Game` construction pattern**

Run: `grep -l "new Game\|import.*Game" test/*.js`

Read one of the matching files to confirm how the game is constructed in Node tests. If there is no existing pattern, the test will need to hand-roll a minimal `game` object with only the fields `tryInsertOnBeamPipe` touches: `state.beamPipes`, `state.placeables`, `state.placeableIndex`, `state.subgridOccupied`, `state.beamPipeNextId`, `state.placeableNextId`, `state.resources`, plus stub methods `log`, `_deriveBeamGraph`, `computeSystemStats`, `emit`, `canAfford`, `spend`, `_syncLegacyPlaceableState`. A hand-rolled stub is acceptable; the goal is to exercise the insert-and-split logic, not the full game.

- [ ] **Step 2: Write the test**

Create `test/test-insert-and-split.js`:

```js
// test/test-insert-and-split.js — integration test for tryInsertOnBeamPipe
import { Game } from '../src/game/Game.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeGame() {
  const g = new Game();
  // Give the player enough resources to build anything.
  g.state.resources.funding = 1e9;
  return g;
}

// --- 1. Build: source at (2,2) → quadrupole insertion point at (2,5) → target at (2,10)
const g = makeGame();

// Find the source type available in this build (any component with isSource).
const sourceType = Object.keys(COMPONENTS).find(k => COMPONENTS[k].isSource && COMPONENTS[k].placement === 'module');
const quadType = Object.keys(COMPONENTS).find(k => (k === 'quadrupole' || k === 'scQuad') && COMPONENTS[k].placement === 'module');
const dumpType = Object.keys(COMPONENTS).find(k => k === 'beamDump' || (COMPONENTS[k].ports && Object.values(COMPONENTS[k].ports).some(p => p.side === 'back') && !COMPONENTS[k].isSource));

assert(sourceType, `found a source type (${sourceType})`);
assert(quadType, `found a quadrupole type (${quadType})`);
assert(dumpType, `found an endpoint type (${dumpType})`);

// Place source facing +row at (2,2) and endpoint facing +row at (2,12).
const sourceId = g.placePlaceable({ type: sourceType, col: 2, row: 2, subCol: 0, subRow: 0, dir: 0 });
assert(sourceId, 'source placed');
const dumpId = g.placePlaceable({ type: dumpType, col: 2, row: 12, subCol: 0, subRow: 0, dir: 0 });
assert(dumpId, 'endpoint placed');

// Create a straight beam pipe between them along +row.
const path = [{ col: 2, row: 4 }, { col: 2, row: 11 }];
const sourcePort = Object.keys(COMPONENTS[sourceType].ports).find(k => COMPONENTS[sourceType].ports[k].side === 'front');
const dumpPort   = Object.keys(COMPONENTS[dumpType].ports).find(k => COMPONENTS[dumpType].ports[k].side === 'back');
const ok = g.createBeamPipe(sourceId, sourcePort, dumpId, dumpPort, path);
assert(ok, 'pipe created');
assert(g.state.beamPipes.length === 1, 'exactly one pipe');
const originalSubL = g.state.beamPipes[0].subL;

// --- 2. Insert a quadrupole at (2, 7) with dir=0 (aligned with pipe).
const quadId = g.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 7, dir: 0 });
assert(quadId, 'quadrupole inserted via tryInsertOnBeamPipe');

// --- 3. Verify the pipe was split into two pipes.
assert(g.state.beamPipes.length === 2, `pipe count is now 2 (got ${g.state.beamPipes.length})`);

const quad = g.state.placeables.find(p => p.id === quadId);
const p1 = g.state.beamPipes.find(p => p.toId === quadId);
const p2 = g.state.beamPipes.find(p => p.fromId === quadId);
assert(p1 && p1.fromId === sourceId, 'p1 connects source → quad');
assert(p2 && p2.toId === dumpId, 'p2 connects quad → dump');

// --- 4. Total length (p1 + quad + p2) should match the original pipe length.
const quadDef = COMPONENTS[quadType];
const sumSubL = p1.subL + quadDef.subL + p2.subL;
assert(
  Math.abs(sumSubL - originalSubL) <= 1,
  `length conservation: p1(${p1.subL}) + quad(${quadDef.subL}) + p2(${p2.subL}) = ${sumSubL}, original = ${originalSubL}`
);

// --- 5. Insertion at a bad rotation (dir=1) on a fresh setup should fail.
const g2 = makeGame();
const s2 = g2.placePlaceable({ type: sourceType, col: 2, row: 2, subCol: 0, subRow: 0, dir: 0 });
const d2 = g2.placePlaceable({ type: dumpType, col: 2, row: 12, subCol: 0, subRow: 0, dir: 0 });
g2.createBeamPipe(s2, sourcePort, d2, dumpPort, [{ col: 2, row: 4 }, { col: 2, row: 11 }]);
const bad = g2.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 7, dir: 1 });
assert(bad === null, 'mismatched rotation returns null');
assert(g2.state.beamPipes.length === 1, 'pipe unchanged on failed insert');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
```

Note: the `dumpType` selector heuristic at the top of the test picks any non-source module with a `back` port. If no such component exists in `COMPONENTS`, replace the heuristic with a hardcoded type name after checking `src/data/beamline-components.raw.js`.

- [ ] **Step 3: Run the test**

Run: `node test/test-insert-and-split.js`

Expected: all PASS; exit 0.

If the test fails for reasons other than logic bugs (e.g., the `Game` constructor needs more setup, or the source/endpoint type selectors don't resolve), fix the test scaffolding — not the production code — until the path under test is the insertion logic itself. If the logic has a real bug, fix it in `Game.js` and re-run.

- [ ] **Step 4: Run all JS tests to catch regressions**

Run: `for f in test/test-*.js; do echo "== $f =="; node "$f" || exit 1; done`

Expected: every test file exits 0.

- [ ] **Step 5: Commit**

```bash
git add test/test-insert-and-split.js
git commit -m "test(placement): integration test for insert-and-split beamline modules"
```

---

## Self-review notes

- **Spec coverage:**
  - Insert-and-split mechanic → Tasks 6, 7, 8, 9
  - Entry point in `placePlaceable` → Task 8 step 3
  - Alignment checks (straight, rotation, footprint, collision) → Task 8 step 1 (sections 2–6 of the method)
  - Split operation + recompute subL → Task 8 step 1 (sections 8–12)
  - Attachment reassignment → Task 8 step 1 (section 13)
  - Rollback → Task 8 step 1 (sections 7, 9 fallback)
  - No auto-rotate / no corner insertion / no overlap handling → enforced by Task 8 detection rules; out-of-scope items remain out of scope.
  - `subL` mandatory in `beamline-components.raw.js` → Task 1
  - Length fallbacks removed in `gameplay.py` → Task 4
  - Length fallbacks removed in `elements.py` / `lattice.py` → Tasks 2, 3
  - Single conversion site (`length_m = sub_l * 0.5` only in `gameplay.py`) → Task 4 steps 4–5
  - `public/beam_physics/*.py` kept in sync → mirrored in each Python task
  - RF cavity envelope evolution verified → Task 5
  - ValueError on missing `subL` → Task 4 step 1 (test) + step 4 (implementation)

- **Placeholder scan:** No placeholders remain after the inline fix to Task 9 step 2.

- **Type consistency:** `moduleBeamAxis` returns `{dCol, dRow}` throughout; `pipeDirectionAtTile` returns the same shape. `findPipeAtTile` returns `{pipe, tileIndex, expandedTiles}`, destructured consistently in Task 8. Port sides use lowercase `'front'`/`'back'` in both the component defs and `module-axis.js`.
