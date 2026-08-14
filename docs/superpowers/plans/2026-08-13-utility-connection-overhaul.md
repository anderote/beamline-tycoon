# Utility Connection Overhaul — implementation plan

Spec: `docs/superpowers/specs/2026-08-13-utility-connection-overhaul-design.md`

Ordering is by dependency, not by visibility. Tasks 1–3 are the input fixes and
are independently shippable; 4–7 are the geometry work and share the anchor
module; 8 is the tap. Commit boundaries are marked — four commits, not eight.

---

## Task 1 — Cursor on the cable plane

**Files:** `src/renderer3d/ThreeRenderer.js`, `src/renderer3d/utility-line-builder-v2.js`,
`src/input/utility-line-tool.js`

- Export `PIPE_Y` from `utility-line-builder-v2.js` (it is already the de-facto
  constant; stop having it be file-private).
- Add `ThreeRenderer.screenToWorldAtHeight(screenX, screenY, height)`: same
  shape as `screenToWorld` (`:732`) but intersects a `THREE.Plane` at
  `y = height` and does **not** consult `_terrainMesh`. Reuse `_screenRay`'s
  scratch; allocate the offset plane per call from a scratch instance with
  `.constant` set (a plane with normal +Y and `constant = -height`).
- `UtilityLineTool.onMouseDown/onMouseMove/onMouseUp` call it with `PIPE_Y`
  instead of `screenToWorld`. Nothing else changes — the controller still
  receives iso-pixel coords.

**Acceptance:** with a utility tool armed, the preview's start point sits under
the cursor at any zoom and any view rotation.

**Test:** unit-test the plane maths, not the picture — given a stub camera,
`screenToWorldAtHeight(x, y, 0)` equals `screenToWorld(x, y)` on flat terrain,
and a positive height shifts the returned grid coords toward the camera by the
expected amount.

## Task 2 — R flips the bend order

**Files:** `src/input/Tool.js`, `src/input/InputHandler.js`,
`src/input/utility-line-tool.js`, `src/input/UtilityLineInputController.js`

- `Tool`: document an optional `onRotateKey(ctx) → boolean` (consumed?).
- `InputHandler` `case 'r'` (`:1204`): offer the key to `this.activeTool` first;
  return if consumed. Keep placement-mode and research-overlay fallbacks after.
- Controller: `setPreferVerticalFirst(v)` / `togglePreferVerticalFirst()`, and
  `_dragGeometry` orders its two candidates with the player's choice first
  (it already tries both).
- `UtilityLineTool.onRotateKey`: toggle, then re-drive `ctrl.onMouseMove` from
  `input.lastMouseWorldX/Y` and refresh the drag tooltip — same pattern as
  `onShiftChange` (`:41`). Consume the key only while `ctrl.isActive()`, so R
  still opens research when no drag is in flight.

**Acceptance:** mid-drag, R swaps which leg comes first whenever both orders
validate; cost tooltip follows.

**Test:** extend `test/test-utility-line-drag.js` — same drag, with and without
a toggle, produces the two different corner points and both commit.

> **Commit 1:** tasks 1–2 (`fix(utility): aim the cable at the cursor, and let R
> flip the bend`).

---

## Task 3 — Port anchors module

**Files:** new `src/renderer3d/port-anchors.js`, new
`src/data/utility-port-anchors.js`, `src/renderer3d/component-builder.js`

- `component-builder.js`: export `getModelBounds(type)` — instantiate via the
  same branch the thumbnail path uses (`_instantiateRoleTemplate` / legacy
  builder / `_buildPartsOrFallback`), `Box3.setFromObject`, cache by type,
  dispose the temp model. Return `{min, max}` plain numbers (not THREE objects)
  so callers and tests need no THREE.
- `port-anchors.js`: `portAnchor3D(placeable, def, portName)` per the spec —
  `x`/`z` from `portWorldPosition`, `out` from `portApproachVec` (converted
  from tile-space `{dCol,dRow}` to world `{x,z}`), `y` from the override table
  else `clamp(bounds.max.y * 0.55, 0.35, 2.0)`. Cache per `(type, dir, port)`
  is unnecessary — the lookups are all O(1) — but memoise `getModelBounds`.
- `utility-port-anchors.js`: overrides for `pillboxCavity`, `ellipticalSrfCavity`,
  `cryomodule`, `quadrupole`, `bpm`, `turboPump`, `roughingPump`,
  `hvTransformer`, `switchgear`, `powerBus`, `vacuumManifold`,
  `waveguideManifold`. One line each; only `y` (and `out` where the fitting
  should sit on a specific face). Leave a header comment stating that absent
  entries fall through to the derived height.

**Acceptance:** `portAnchor3D` returns a sane height for every component that
declares a utility port, with no THREE dependency in the data file.

**Test:** new `test/test-port-anchors.js` — every type in `COMPONENTS` with a
utility port yields an anchor; overrides win over derivation; the derived
height is inside the clamp; `x`/`z` are byte-identical to `portWorldPosition`
(the sim must not shift).

## Task 4 — Markers ride the anchor

**Files:** `src/renderer3d/utility-line-builder-v2.js`, `src/renderer3d/ThreeRenderer.js`

- `buildPortMarker(anchor, color, brightened)` — take the whole anchor, use its
  `y`. Same for `buildHoverMarker`.
- `setAvailablePorts` resolves anchors instead of `portWorldPosition`.
- `buildUnwiredMarker`: stem from `anchor.y` up by a fixed 0.55 m, cone on top.
  Marker records from `_refreshUnwiredSinkMarkers` (`ThreeRenderer.js:3421`)
  carry `y` alongside `x`/`z`; include it in the signature string.

**Acceptance:** dots and pins sit on the device, not over the floor tile.

## Task 5 — Fittings on the models

**Files:** new `src/renderer3d/builders/port-fitting-builder.js`,
`src/renderer3d/ThreeRenderer.js`

- Builder: `buildPortFittings(endpoints, parentGroup)` — collar disc + stub
  cylinder (~0.12 m) at each declared utility port's anchor, oriented along
  `out`, material cached per utility colour at low emissive. Signature-guarded
  rebuild (`id:port` set + positions), disposal through the existing
  `_disposeGroup` convention, `__shared` tagging on cached materials.
- `ThreeRenderer`: a `portFittingGroup` alongside `unwiredSinkGroup`, refreshed
  on the same world events that dirty the port markers, skipped below the LOD
  zoom threshold `_updateLOD` already computes.

**Acceptance:** every wired-capable device visibly has connectors; toggling
tools does not change them.

## Task 6 — Cables plug in

**Files:** `src/renderer3d/utility-line-builder-v2.js`

- `buildWorldPoints`: when an end is anchored on a port, replace the pinned
  ground point with the riser triple — `(x, PIPE_Y, z)` → `(x, anchor.y, z)` →
  `(x + out.x*d, anchor.y, z + out.z*d)` with `d` ≈ the fitting's stub length.
- Include anchor `y` in `_hashLine`'s endpoint hash so a moved/rotated device
  rebuilds its lines.

**Acceptance:** a committed cable climbs the device and ends inside its fitting;
no cable ends in mid-air.

> **Commit 2:** tasks 3–6 (`feat(utility): ports live on the geometry`).

---

## Task 7 — Tap an existing line: input

**Files:** `src/input/UtilityLineInputController.js`

- `_snapToNearest(worldX, worldY)` returns the current port snap, or a tap
  `{ tap: true, lineId, worldPos }` for the closest point on a same-utility
  line within 0.5 tile. Ports win ties. Reuse `expandPath` for candidate
  points — it is already the discovery-side notion of "on the line".
- Tap ends produce a `null` endpoint ref (they are open ends) and record their
  `lineId` on the geometry result; `_dragGeometry` passes both ends' tap ids to
  the validator.
- `hoverPort` gains `tap: true` so the renderer can draw a ring.

## Task 8 — Tap an existing line: validation

**Files:** `src/utility/line-drawing.js`, `src/utility/UtilityLineSystem.js`

- `validateDrawLine` accepts `opts.tapLineIds = {start?, end?}`.
- `pathOverlapsSameType` skips overlap between **the terminal subtile of the
  new path at that end** and the named line only. Everything else still
  rejects — verify with a test that a path running *along* a trunk still gets
  `overlap_same_type` even when its end taps that trunk.
- `addLine` threads the option through from the controller.

**Acceptance:** dragging from a component onto a trunk commits, and
`discoverNetworks` puts both lines in one network (the spatial-union pass
already does this once the geometry lands).

**Test:** new `test/test-utility-line-tap.js` — tap commits; tap + solve gives
one network; running along a trunk still rejects; a tap on a *different*
utility's line does not snap.

> **Commit 3:** tasks 7–8 (`feat(utility): branch off an existing line`).

---

## Task 9 — Right-click erases a line of the armed utility

**Files:** `src/input/utility-line-tool.js`, `src/input/UtilityLineInputController.js`

Added mid-implementation. Drawing cable is only iterable if taking one back is
as cheap as putting one down; a trip to the demolish tool between every attempt
is what made the whole activity feel committal.

- Controller: `nearestLine(worldX, worldY, maxTiles)` — nearest same-utility
  line to the cursor, measured against `expandPath` (the same sampling
  discovery uses to decide two lines touch). Shared with the tap snap.
- `UtilityLineTool.onRightClick`: mid-drag it abandons the draw; otherwise it
  removes the line under the cursor via `game._withUndo`. Mesh raycast first,
  proximity fallback second — a powerCable is a 2 cm cylinder and demanding a
  pixel-accurate hit on one reads as a broken eraser.
- **Scoped to the armed utility.** Six utilities share the same walls; removing
  whichever happens to be nearest is worse than removing nothing. A miss
  returns false so the click falls through to right-click-deselects.

**Test:** in `test/test-utility-line-drag.js` — removal via the proximity path,
one undo entry that restores it, a mismatched tool consuming nothing, and
right-click mid-drag cancelling rather than deleting.

---

## Risks

- **Anchor derivation cost.** `getModelBounds` instantiates a model per type.
  It must be memoised and must never run per frame; the fitting builder is
  signature-guarded, so first build pays and steady state does not.
- **Fitting count.** A large facility has hundreds of ports. Fittings are two
  primitives each and share materials, but if profiling shows a problem the
  answer is instancing, not culling them by tool state.
- **Tap overlap exemption is the one place this touches validation.** Keep the
  exemption to a single subtile and cover the "runs along the trunk" case in a
  test, or the overlap rule quietly stops meaning anything.
