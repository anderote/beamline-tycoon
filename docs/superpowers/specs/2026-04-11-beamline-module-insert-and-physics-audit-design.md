# Beamline Module Insert-on-Pipe + Physics Length Audit

**Date:** 2026-04-11
**Status:** Draft

## Summary

Two related changes:

1. **Insert-and-split placement.** Clicking a beamline module onto an existing beampipe inserts the module into the pipe: the pipe is split at the module footprint, the two halves reconnect to the module's entry/exit ports, and pipe lengths are recomputed. No special rotation assistance — the user rotates manually.
2. **Physics length audit (scope: B).** Make `subL` the single source of truth for component length across JS data and the Python physics bridge, remove every silent length fallback (`element.get("length", 0.0)`, `element.get("length", 1.0)`, `COMPONENT_DEFAULTS[...]["length"]`), and verify per-component that the propagator's distributed-vs-thin classification matches physical reality.

## Motivation

- Today, beamline modules can only be placed on empty subtiles. If a pipe is in the way, placement fails. Real accelerator construction cuts pipe to insert components; the game should support the same workflow.
- Component length is declared in two places (JS `subL`, Python `COMPONENT_DEFAULTS`) with a silent fallback. Any component missing `subL` silently uses a hardcoded default from `COMPONENT_DEFAULTS`, diverging from the JS data and causing wrong envelope propagation.
- Length fallbacks are sprinkled throughout `elements.py` and `lattice.py` (`element.get("length", 0.0)`, `element.get("length", 1.0)`). A missing length at any point silently becomes zero or one metre instead of failing loudly.
- `_make_sub_element` in `lattice.py` already scales `bendAngle`, `energyGain`, and `r56` proportionally, so the propagator's distributed treatment is correct *when lengths are right*. The problem is making sure lengths *are* right, not rewriting propagation.

## Background (current state)

- **Beampipes** (`Game.js` `state.beamPipes`) are logical port-to-port links:
  ```js
  { id, fromId, fromPort, toId, toPort, path: [{col,row},...], subL, attachments: [...] }
  ```
  Pipes are drawn after placement connecting module ports. They do **not** reserve subgrid occupancy — modules can be placed on pipe tiles today as long as no other placeable is there.
- **Placement** (`Game.js:1255` `placePlaceable`, `src/game/placement.js`) validates only subtile collision via `state.subgridOccupied`.
- **Walls** implement replace-on-place (`Game.js:847-875`) — a useful precedent for the pattern.
- **Length representation.** JS: `subL` in sub-units, 1 sub-unit = 0.5 m. Python (`beam_physics/gameplay.py`): if `subL` is present it converts; otherwise it falls back to `COMPONENT_DEFAULTS[type]["length"]` in meters.
- **Python modules are duplicated.** `beam_physics/*.py` and `public/beam_physics/*.py` are the same code served two ways (Pyodide fetches the public copy). Both must stay in sync.

## Part 1 — Insert-and-split placement

### Entry point

New helper `tryInsertOnBeamPipe(module, col, row, rotation)` in `Game.js`, called from `placePlaceable()` **before** the normal collision check. If it succeeds, normal placement is skipped. If it returns `null`/`false`, fall through to the existing placement path (which will likely fail naturally if a pipe blocks the footprint — matching "no special behavior").

### Detection

- Locate the pipe whose `path` contains the cursor tile. Pipes do not overlap, so at most one match.
- If none, return `null` and fall through.

### Alignment and footprint checks

All of the following must hold:

1. **Straight segment.** The cursor tile's previous and next path neighbors are collinear (no corners at the insertion point).
2. **Rotation matches.** The module's beam axis direction (from its rotation) equals the pipe's local direction at the cursor, modulo 180° (pipes are undirected geometrically).
3. **Footprint lies on the pipe.** Every tile covered by the module along its beam axis (length = `ceil(subL/4)` tiles, centered on the cursor) is a consecutive collinear run of path tiles.
4. **No other placeable collides.** The module's subtile footprint is free in `state.subgridOccupied` except for the pipe itself (pipes don't occupy the subgrid, so this is just the usual collision check).

Fail any of these → return `null`; normal placement tries next.

### Split operation

Given pipe `P: A.portA → B.portB` with `path = [t0, t1, ..., tN]` and the module footprint covering tiles `[ti..tj]`:

1. Delete `P` from `state.beamPipes`.
2. Place the module via the existing path (subgrid occupancy, placeable record).
3. Determine which end of the module is "closer to A" along the path — that becomes the module's entry port (from A's perspective); the other end is the exit.
4. Create two new pipes:
   - `P1: A.portA → M.entryPort`, `path = [t0..t(i-1)]`
   - `P2: M.exitPort → B.portB`, `path = [t(j+1)..tN]`
5. For each new pipe compute `subL = round(tileDist(path) * 4)` (matches existing formula at `Game.js:1572`).
6. Reassign attachments: each attachment on the old pipe has a tile position; assign it to whichever new pipe's path contains that tile. Attachments whose tile falls inside `[ti..tj]` (now occupied by the module) are deleted.
7. Surface deleted-attachment count in the placement preview as a warning, mirroring the wall replacement cost pattern.

### Rollback

If any step after pipe deletion fails, restore the original pipe and any removed attachments, undo the module placement, and abort. The operation is atomic from the player's perspective.

### Out of scope

- Auto-rotate on hover, rotation hints, or ghost reorientation on pipes. User rotates manually.
- Insertion at pipe corners. Only straight-run insertion is supported in this change.
- Pipes overlapping other pipes.

## Part 2 — Physics length audit

### Part 2A — `subL` as single source of truth

Beamline data actually lives in `src/data/beamline-components.raw.js` (628 lines); `src/data/placeables/beamline-modules.js` just filters and normalizes it. The audit happens on the raw file.

1. **Audit `src/data/beamline-components.raw.js`.** Every entry that is either `placement: 'module'` or a drawn-connection drift must declare `subL` explicitly. Any entry missing `subL` gets a value matching the current `COMPONENT_DEFAULTS[type]["length"] / 0.5` so behavior is preserved at the point of the change.
2. **Remove length fallbacks in `beam_physics/gameplay.py`.**
   - Delete every `"length": <n>` entry from `COMPONENT_DEFAULTS`. Leave non-length defaults (`emittance`, `energyGain`, `focusStrength`, `bendAngle`, etc.) untouched.
   - In `beamline_config_from_game()`, require `subL` on every element; raise `ValueError(f"component '{ctype}' has no subL")` if missing.
   - Remove the `comp.get("length", defaults.get("length", 1.0)) * LENGTH_SCALE` branch entirely.
3. **Remove length fallbacks in `beam_physics/elements.py` and `beam_physics/lattice.py`.**
   - `transfer_matrix` uses `element.get("length", 1.0)` — change to `element["length"]` (KeyError surfaces bugs).
   - `propagate` uses `element.get("length", 0.0)` — change to `element["length"]`.
   - `_make_sub_element` uses `element.get("length", 0.0)` — change to `element["length"]`.
4. **Single conversion site.** The rule `length_m = sub_l * 0.5` lives in exactly one place in `gameplay.py`. Remove or repurpose the `LENGTH_SCALE = 2.0` constant (it was part of the fallback and is no longer needed).
5. **Sync `public/beam_physics/*.py` with `beam_physics/*.py`.** These are the same code served two ways (Pyodide fetches the public copy). Every edit is mirrored in the same commit; at the end of Part 2, a `diff` between the two directories should show no differences.

### Part 2B — per-component classification check

The exploration subagent suggested RF cavities were silently point-like; direct reading of `elements.py` and `lattice.py` shows they are not. `rf_cavity_matrix` returns `drift_matrix(length)`, and `_make_sub_element` scales `energyGain` by the sub-step fraction — so envelope drift *and* energy gain are both distributed correctly already. The real per-component task is a verification pass, not a rewrite.

| Component | Current treatment | Status |
|---|---|---|
| Beampipe / drift | Distributed drift matrix | Correct. |
| Quadrupole | `quadrupole_matrix(k, length)` with sub-stepping | Correct. |
| Dipole | `dipole_matrix(bendAngle, length)` with `bendAngle` scaled per sub-step | Correct. |
| Solenoid | `solenoid_matrix(B, p, length)` with sub-stepping | Correct. |
| RF cavity / cryomodule | `drift_matrix(length)` + `energyGain` scaled per sub-step + `apply_rf_damping` at boundary | Correct. |
| Source | `np.eye(6)` in `transfer_matrix`; `lattice.propagate` special-cases source to advance `cumulative_s` by `source_len` without sub-stepping | Acceptable — source is an initial-condition emitter. Document in a comment. |
| Diagnostics (bpm, screen, ict, etc.) | Mapped to `drift` physics type in `gameplay.py`; full drift over declared length | Correct. |
| Thin effects (chicane, collimator, detector, target, beamStop, fixedTargetAdv, positronTarget, splitter) | In `THIN_EFFECT_TYPES`; `n_steps = 1`, matrix built once | Correct — these are genuinely point interactions in the current model. |
| Kicker / septum / corrector / octupole / stripperFoil | Mapped to `drift` in `gameplay.py` with declared length | Acceptable simplification; document. |

**Verification tests** (Part 2B deliverables):

- A test that propagates a beam through a single RF cavity (`length = 8 m`) and asserts the beam envelope has at least 3 distinct sigma-x snapshot values between the cavity's start and end (i.e. it actually evolves across the length, not a step).
- A test that builds a beamline config missing `subL` on one element and asserts `beamline_config_from_game` raises `ValueError`.
- A test that builds a beamline config missing `length` on an element passed directly to `propagate` (bypassing `beamline_config_from_game`) and asserts a `KeyError` or explicit `ValueError`.

### Part 2C — what is explicitly out of scope

- Re-deriving transfer matrices from scratch.
- Phase-space / acceptance matching at module interfaces.
- Revisiting unit conversions for `focusStrength`, `bendAngle`, `energyGain` beyond the tests in Part 2B.
- Changes to the Pyodide integration layer.
- Rewriting the propagator loop or sub-stepping logic.
- Changing what counts as a thin effect (the classification is correct for the current physics model).

## Acceptance criteria

- Clicking a beamline module on a tile belonging to a beampipe's straight segment, with matching rotation and a free subtile footprint, inserts the module and splits the pipe into two pipes whose `subL` values sum (with the module's `subL`) to the original pipe's `subL`.
- Attachments on the old pipe end up on the correct new half or are removed (with a preview warning) if they fell inside the module footprint.
- Placement on a corner, with mismatched rotation, or with other placeables in the footprint falls through to normal placement (fails cleanly).
- No module-or-drift component in `src/data/beamline-components.raw.js` lacks `subL`.
- `elements.py::transfer_matrix`, `lattice.py::propagate`, and `lattice.py::_make_sub_element` no longer contain `element.get("length", ...)` — all read `element["length"]` directly.
- `beam_physics/gameplay.py` raises a clear error if asked to build a lattice from a component without `subL`.
- `beam_physics/*.py` and `public/beam_physics/*.py` are byte-identical.
- A beam propagated through an RF cavity shows envelope evolution along the cavity's length (not a step-function jump at a single point).
- Existing beamline layouts still propagate without regression in summary stats (spot checks on a saved lattice before/after).

## Open questions

None at spec time. Any discovered during implementation should be flagged back to the user, not resolved unilaterally.
