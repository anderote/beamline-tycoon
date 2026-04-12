# Beamline Module Insert-on-Pipe + Physics Length Audit

**Date:** 2026-04-11
**Status:** Draft

## Summary

Two related changes:

1. **Insert-and-split placement.** Clicking a beamline module onto an existing beampipe inserts the module into the pipe: the pipe is split at the module footprint, the two halves reconnect to the module's entry/exit ports, and pipe lengths are recomputed. No special rotation assistance — the user rotates manually.
2. **Physics length audit (scope: B).** Make `subL` the single source of truth for component length across JS data and the Python physics bridge, remove silent fallbacks, and fix components that are currently treated as thin lenses when they should be distributed — most notably RF cavities.

## Motivation

- Today, beamline modules can only be placed on empty subtiles. If a pipe is in the way, placement fails. Real accelerator construction cuts pipe to insert components; the game should support the same workflow.
- Component length is declared in two places (JS `subL`, Python `COMPONENT_DEFAULTS`) with a silent fallback. Any component missing `subL` silently uses a hardcoded 2m default in Python, diverging from the JS data and causing wrong envelope propagation.
- Some elements (RF cavities per exploration) are treated as point-like in the propagator even though they have a real physical length. Beam envelope does not evolve through them.

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

1. **Audit `src/data/placeables/beamline-modules.js`.** Every module entry must declare `subL` (and `subW`) explicitly. Add any missing values based on the current Python defaults so behavior is preserved at the point of the change.
2. **Remove length fallbacks in `beam_physics/gameplay.py`.** Delete the `length` fields from `COMPONENT_DEFAULTS`. In `beamline_config_from_game()`, require every element to carry `subL`; raise `ValueError(f"component '{id}' ({type}) has no subL")` if missing. This surfaces drift immediately instead of silently using 2m.
3. **Single conversion site.** The rule `length_m = sub_l * 0.5` lives in exactly one function in `gameplay.py`. Remove any other multiplication by `0.5` or references to a `LENGTH_SCALE` constant for length conversion. Downstream code in `lattice.py` / `elements.py` consumes meters only.
4. **Sync `public/beam_physics/*.py` with `beam_physics/*.py`.** These are the same code; the audit keeps them byte-identical. Any edit to one is mirrored to the other in the same commit.

### Part 2B — thin-lens vs distributed, per component type

Classify every element type and fix mismatches:

| Component | Treatment | Notes |
|---|---|---|
| Beampipe (drift) | Distributed | Already correct — verify the drift matrix uses `subL * 0.5`. |
| Quadrupole | Distributed | `k · L` focusing matrix; verify `k` from `focusStrength` is applied over the full length. |
| Dipole | Distributed | Sector-bend matrix over L; verify bend-angle scaling is applied across the length, not as a single kick. |
| Solenoid | Distributed | Rotation + focusing coupled over L. |
| **RF cavity** | **Distributed (linear energy ramp)** | Currently point-like. Energy gain must be spread linearly across cavity length so envelope evolves through it. |
| BPM / screen / diagnostic | Thin + drift | Point measurement at element center; drift the rest of the length around it. |
| Collimator / aperture | Thin + drift | Aperture check at one plane; drift the length. |
| Source | Audit + document | May be an initial-condition element where "length" is drift from emission point to exit port. Whatever it is today, document it. |

The propagator `lattice.propagate` already sub-steps at ~0.5 m; the fix is ensuring each element type's transfer matrix is **built from its declared length**, not a hardcoded constant. The sub-step loop then walks the beam envelope through the full length naturally.

### Part 2C — what is explicitly out of scope

- Re-deriving transfer matrices from scratch.
- Phase-space / acceptance matching at module interfaces.
- Revisiting unit conversions for `focusStrength`, `bendAngle`, `energyGain` beyond verifying they are applied over the declared length.
- Changes to the Pyodide integration layer.
- Rewriting the propagator loop.

## Acceptance criteria

- Clicking a beamline module on a tile belonging to a beampipe's straight segment, with matching rotation and a free subtile footprint, inserts the module and splits the pipe into two pipes whose `subL` values sum (with the module's `subL`) to the original pipe's `subL`.
- Attachments on the old pipe end up on the correct new half or are removed (with a preview warning) if they fell inside the module footprint.
- Placement on a corner, with mismatched rotation, or with other placeables in the footprint falls through to normal placement (fails cleanly).
- No component in `src/data/placeables/beamline-modules.js` lacks `subL`.
- `beam_physics/gameplay.py` raises a clear error if asked to build a lattice from a component without `subL`.
- `beam_physics/*.py` and `public/beam_physics/*.py` are byte-identical.
- A beam propagated through an RF cavity shows envelope evolution along the cavity's length (not a step-function jump at a single point).
- Existing beamline layouts still propagate without regression in summary stats (spot checks on a saved lattice before/after).

## Open questions

None at spec time. Any discovered during implementation should be flagged back to the user, not resolved unilaterally.
