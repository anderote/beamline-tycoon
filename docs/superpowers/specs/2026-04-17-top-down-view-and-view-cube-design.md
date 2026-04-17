# Top-Down View Mode + Onshape-Style View Cube — Design

## Goal

Add a second canonical camera view — top-down, aligned with N/E/S/W — alongside the existing isometric (dimetric) view. Add a small view-cube widget at the bottom-right (just above the wall-visibility control) that mirrors the live camera orientation and lets the player click to switch view, snap yaw, or jump straight to top-down. Existing iso/free-orbit gestures are preserved.

## Non-goals

- Persisting view mode across sessions.
- A separate top-down zoom level (zoom is shared across modes).
- Clickable cube edges/corners (only the visible faces are click targets).
- Touch / trackpad gestures for the widget.
- Animating the cube itself with springs/inertia — it strictly mirrors the camera.

## Behavior

### Two view modes

- `viewMode: 'iso' | 'top'`. Default `'iso'`.
- Each mode has an independent yaw index in 0..3. Switching modes restores that mode's last yaw, *not* the other mode's. The player can spin around in iso, switch to top-down, spin around there, and switching back returns iso to where they left it.
- Pitch is determined by mode: `PITCH_REST` (≈30°) for iso, `PITCH_TOP` (≈89°) for top-down. The 89° value (rather than 90°) avoids the `THREE.Camera.lookAt` gimbal degeneracy and is visually indistinguishable from true top-down.
- Zoom (`_frustumSize`) is global and unaffected by mode.

### Q/E rotation

Q/E rotates the **current mode's** yaw index ±1 (mod 4). 400ms easeInOutQuad animation, identical to today. While animating or while the MMB-release snap is animating, further Q/E presses are ignored — same gating as today.

### MMB free-orbit

Existing free-orbit drag is preserved. Two changes:

1. **`PITCH_MAX` is raised** from 80° to `PITCH_TOP` so the player can drag pitch all the way up. `PITCH_MIN` is unchanged.
2. **Release picks the closer mode by pitch.** `endFreeOrbit()` calls `pickSnapMode(_freePitch)`:
   - If `_freePitch < PITCH_THRESHOLD` (midpoint of `PITCH_REST` and `PITCH_TOP`) → snap to `'iso'` mode at `PITCH_REST`.
   - Otherwise → snap to `'top'` mode at `PITCH_TOP`.
   - Yaw snaps to nearest 90° as today, but the index written back is the *target mode's* yaw index. `viewMode` flips if the threshold was crossed.

### View-cube widget interactions

- Click the **top face** of the cube → `setViewMode('top', currentTopYawIdx)`. Animates pitch to `PITCH_TOP`; yaw stays at the last top yaw.
- Click a **side face** (N/E/S/W) → `setViewMode('iso', faceYawIdx)`. Animates both pitch (to `PITCH_REST`) and yaw (to the clicked face's index, taking the shortest signed delta).
- Click a **compass-ring direction** (N/E/S/W around the cube) → snaps yaw within the *current* mode to that direction. Does not change mode.
- Hover on a clickable face/direction → visual highlight (emissive bump on cube faces; CSS class on compass labels).
- The widget never receives keyboard focus and never intercepts game keys.

### Animation policy

All view changes (Q/E, mode switch via widget, MMB release snap) use a single 400ms easeInOutQuad shared with today's `_viewRotDurationMs`. While *any* such animation is running:
- Q/E is ignored (existing behavior).
- Widget clicks are ignored (so the user can't queue chained transitions).
- MMB drag still cancels and takes over (existing behavior — `startFreeOrbit` clears both animation flags).

## Architecture

### `src/renderer3d/free-orbit-math.js` — additions

New constants:

```
PITCH_TOP = (89 * Math.PI) / 180
PITCH_THRESHOLD = (PITCH_REST + PITCH_TOP) / 2
```

Existing `PITCH_MAX` is changed from `(80 * Math.PI) / 180` to `PITCH_TOP`. (Reason: free-orbit must be able to reach top-down pitch, and the existing 80° clamp was chosen before top-down existed.)

New helpers:

```
pickSnapMode(pitch) -> 'iso' | 'top'
  return pitch < PITCH_THRESHOLD ? 'iso' : 'top'

targetPitchForMode(mode) -> number
  return mode === 'top' ? PITCH_TOP : PITCH_REST
```

Pure functions, no side effects, easy to unit-test.

### `src/renderer3d/ThreeRenderer.js` — state changes

Replace the single `_viewRotationIndex` with per-mode indices, plus a snap-target-mode field used by the unified snap animation:

```
this.viewMode = 'iso';            // 'iso' | 'top'
this._isoYawIdx = 0;              // 0..3
this._topYawIdx = 0;              // 0..3
this._snapTargetMode = 'iso';     // mode to enter when current _snapping animation completes
```

`_snapTargetMode` is captured at the start of any animated transition (MMB release or `setViewMode`) and read in `_tickFreeOrbitSnap`'s completion branch to decide which mode's yaw index to write and what to set `viewMode` to.

Keep `_viewRotationAngle` (the live, animated yaw) — it's the source of truth for camera placement and is independent of mode. Remove `_viewRotationIndex` references in favor of a small accessor:

```
_currentYawIdx()                  // returns this.viewMode === 'top' ? _topYawIdx : _isoYawIdx
_setCurrentYawIdx(i)              // writes back to the active mode's index
```

`_effectivePitch()` returns `targetPitchForMode(this.viewMode)` when not free-orbiting/snapping; otherwise returns the live `_freePitch`. (Today it returns `PITCH_REST` unconditionally.)

`_effectiveYaw()` is unchanged — it already returns `_freeYaw` during orbit/snap and `_viewRotationAngle` otherwise.

### `src/renderer3d/ThreeRenderer.js` — method changes

`rotateView(delta)`:
- Operates on the current mode's index via the accessors above.
- Otherwise unchanged: same animation, same gating.

`endFreeOrbit()`:
- Compute `targetMode = pickSnapMode(_freePitch)`.
- Compute `targetYawIdx` = nearest 90° yaw rounded to mod 4.
- Set `_snapToYaw = targetYawIdx * π/2`, `_snapToPitch = targetPitchForMode(targetMode)`.
- On animation completion (in `_tickFreeOrbitSnap` 1.0 branch): `viewMode = targetMode`, write yaw idx into the appropriate mode's index, restore overlay visibility.

New public method:

```
setViewMode(mode, yawIdx?)
  // Ignored if any view animation is in flight.
  // - Compute target pitch from mode.
  // - If yawIdx provided, compute target yaw = yawIdx * π/2 with shortest signed delta from current angle.
  //   Otherwise, target yaw = current angle (no yaw change).
  // - Reuse the free-orbit-snap animation machinery: set _snapping = true,
  //   _snapFromYaw/_snapFromPitch from current effective values, _snapToYaw/_snapToPitch from target.
  // - On completion, viewMode = mode, target yaw idx written into mode's index.
```

The widget calls only `setViewMode`. It does not poke `_isoYawIdx` / `_topYawIdx` directly.

### `src/renderer3d/view-cube.js` — new file

Class `ViewCube`. Constructor takes `(threeRenderer, mountEl)`.

Members:
- `scene`, `camera` (orthographic, fixed frustum, fixed distance), `renderer` (separate `THREE.WebGLRenderer({ alpha: true, antialias: true })`)
- `cube` (`THREE.Mesh` with `BoxGeometry(1,1,1)` + 6 materials, each face textured with a `CanvasTexture` showing "TOP" / "N" / "E" / "S" / "W" / "" ). Hover state stored on the mesh's `userData`.
- `raycaster` (`THREE.Raycaster`), `pointerVec2` (`THREE.Vector2`)
- DOM children: `<canvas>` (the WebGL canvas) plus a sibling SVG/DOM ring for the compass.

Methods:
- `update()` — called each frame from `ThreeRenderer._animate()`. Reads `renderer._effectiveYaw()` and `_effectivePitch()`, places `camera` on a sphere of fixed radius around the cube origin using the same `cameraOffset()` math, calls `camera.lookAt(0,0,0)`, then `renderer.render(scene, camera)`. Also updates the active-direction highlight on the compass ring based on `Math.round(effectiveYaw / (π/2)) % 4`.
- Pointer handlers on the canvas — `pointermove` updates hover material; `click` raycasts against the cube; if the hit face is one of the 5 mapped faces (top + 4 sides), call `renderer.setViewMode(targetMode, targetYawIdx)`.
  - Top face → `('top', currentTopYawIdx)`.
  - Side faces → `('iso', faceYawIdx)`. Face-to-yaw mapping is fixed at construction time: pick yaw=0 (the camera at the dimetric rest pose), look at the cube, label the four side faces by which yaw index `k ∈ {0,1,2,3}` would put each face directly facing the camera (i.e. yaw → face that the player sees front-and-center). The labels stamped onto the textures (`N/E/S/W`) are assigned to match. The mapping is fixed per face mesh and does not change as the cube re-renders each frame.
- Compass ring — 4 DOM elements with click handlers that call `renderer.setViewMode(renderer.viewMode, dirIdx)`.
- `dispose()` — disposes geometry/materials/textures, removes the renderer's DOM canvas, removes event listeners.

Sizing: 96×96 px logical canvas, drawn at devicePixelRatio. Compass ring is a 128×128 wrapper with the cube canvas centered inside it.

### `index.html`

Add inside `#game`, near `#wall-visibility-control`:

```
<div id="view-cube-widget"></div>
```

`ViewCube` populates its inner DOM in the constructor (canvas + compass ring SVG).

### `style.css`

Position the widget bottom-right, just above `#wall-visibility-control`:

```
#view-cube-widget { position: absolute; right: <same as wall-vis>; bottom: <wall-vis bottom + wall-vis height + ~12px>; width: 128px; height: 128px; pointer-events: auto; z-index: <same band as wall-vis>; }
```

The exact pixel values pull from the existing wall-visibility control — measured at implementation time, not transcribed here.

### `src/renderer3d/ThreeRenderer.js` — wiring

In `init()`, after `_animate` is set up but before the first frame, instantiate the view cube against the existing `#view-cube-widget` element. Store on `this._viewCube`. Call `this._viewCube.update()` from `_animate()` after the main render. In `dispose()` (or whatever destruction hook exists — verify at implementation), call `this._viewCube.dispose()`.

### `src/input/InputHandler.js`

No structural change. Verify Q/E still routes through `renderer.rotateView(±1)` and that `rotateView` now reads/writes the current mode's index. Free-orbit handlers (`startFreeOrbit` / `orbitBy` / `endFreeOrbit`) are unchanged at the call site.

## Tests

New file `test/test-pitch-snap.js`:
- `pickSnapMode(PITCH_REST)` → `'iso'`
- `pickSnapMode(PITCH_TOP)` → `'top'`
- `pickSnapMode(PITCH_THRESHOLD - 0.001)` → `'iso'`
- `pickSnapMode(PITCH_THRESHOLD + 0.001)` → `'top'`
- `targetPitchForMode('iso')` → `PITCH_REST`; `targetPitchForMode('top')` → `PITCH_TOP`

Update `test/test-free-orbit-math.js` if `PITCH_MAX` is referenced there. (Spot check at implementation time.)

`ViewCube` and `setViewMode` are not unit-tested — verified manually:
- Pressing Q/E in iso rotates iso through 4 cardinals; switching to top-down with the cube and pressing Q/E rotates top-down independently; switching back to iso restores the prior iso yaw.
- MMB-drag pitch up past midpoint → release → snaps to top-down. Drag pitch down past midpoint while in top-down → release → snaps to iso.
- View-cube top face click switches to top-down; side face clicks switch to iso facing that direction; compass ring clicks snap yaw within the current mode.
- The cube on the widget visibly tracks the live camera every frame.

## Risks

- **Two WebGL contexts**: the page already has a main `THREE.WebGLRenderer` plus a PixiJS WebGL canvas. Adding a third (the view-cube renderer) is supported by all modern browsers but adds context overhead. If lifecycle is buggy this could leak GPU resources. Mitigation: the ViewCube `dispose()` path is implemented and called from any teardown hook; the cube renders trivially per frame so steady-state cost is negligible.
- **`PITCH_MAX` widening to 89°**: the camera can now look near-straight-down during free-orbit. The 89° (vs 90°) cushion avoids `lookAt` gimbal issues; verified by the existing `cameraOffset` math (`cos(89°) ≈ 0.0175`, nonzero, so the look direction stays well-defined).
- **Mode-switch animation reuses `_snapping`**: care is needed to ensure `setViewMode` and `endFreeOrbit` do not race. Both write to the same `_snap*` fields. Gating: `setViewMode` is ignored while `_snapping` or `_viewRotating` is true; MMB drag (`startFreeOrbit`) preempts both. Confirm the gating order at implementation time.
- **Per-mode yaw index correctness on MMB release**: the snap target index must be written into the mode picked by `pickSnapMode`, not the previous mode's. The cleanest implementation captures `targetMode` at snap-start and stores it on a new `_snapTargetMode` field, then writes back at completion.
