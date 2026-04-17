# Free-Orbit Camera with Iso Snap-Back — Design

## Goal

Let the player hold the middle mouse button and freely orbit the camera (yaw + pitch) around the current pan center. On release, the camera animates back to the nearest of the 4 fixed isometric views.

Today the view rotation system only supports 4 fixed dimetric yaws 90° apart (Q/E). Players can't peek from in-between angles or tilt the elevation. The free-orbit gesture provides that peek without compromising the iso-first look — releasing always restores a canonical view.

## Non-goals

- Extracting camera state into a dedicated controller module. `ThreeRenderer` keeps ownership. (~39 external call sites in `main.js`/`InputHandler.js` plus ~64 internal references; out of scope for this feature — considered and deferred during brainstorming.)
- Touch / trackpad gestures.
- Configurable sensitivity UI.
- Roll axis or free translation during MMB-drag.
- Persisting free-orbit state across sessions.

## Behavior

- **Trigger**: hold middle mouse button. Middle-click panning is removed. WASD remains the pan binding. `alt + left-drag` pan is unchanged.
- **While held**:
  - Horizontal mouse delta rotates yaw around Y, centered on `(_panX, _panY)`.
  - Vertical mouse delta tilts pitch. Drag up tilts up toward top-down.
  - Pitch is clamped to **15°–80°** (dimetric rest is 30°, i.e. `atan(1/√3)`).
  - WASD pan and scroll-zoom continue to work. WASD pans relative to the *current* free yaw, not the snapped yaw.
  - Q/E 90° rotation is suppressed while MMB is held and while the release snap is animating.
  - Cursor is `grabbing` during the drag.
- **On release**:
  - Yaw snaps to the nearest 90° increment.
  - Pitch restores to the dimetric rest angle.
  - Animation: 400ms `easeInOutQuad` (matches the existing Q/E rotation animation).
  - On completion, `_viewRotationIndex` and `_viewRotationAngle` are updated to the snapped values so Q/E continues from the new position.

## Architecture

Extend `ThreeRenderer` with free-orbit state and methods, parallel to the existing Q/E rotation state at `src/renderer3d/ThreeRenderer.js:153`. The existing Q/E rotation system is preserved and continues to drive snapped views.

### New state in the constructor

```
_freeOrbiting   = false           // MMB currently held
_freeYaw        = 0               // current free yaw (rad)
_freePitch      = PITCH_REST      // current free pitch (rad)
_snapping       = false           // release snap is animating
_snapFromYaw, _snapToYaw          // release-animation endpoints (rad)
_snapFromPitch, _snapToPitch
_snapStartMs                      // performance.now() at snap start
_snapDurationMs = 400             // matches _viewRotDurationMs
```

### New constants at file top

- `PITCH_REST = Math.atan(1 / Math.sqrt(3))` — the dimetric elevation angle (30°). Derived from the existing camera geometry at `(D, D·√6/3, D)`: horizontal distance to origin is `D·√2`, height is `D·√6/3`, so pitch = `atan((D·√6/3) / (D·√2)) = atan(1/√3)`. Produces a byte-identical rest view when combined with the reformulated `_updateCameraLookAt`.
- `PITCH_MIN = 15° in rad`
- `PITCH_MAX = 80° in rad`
- `ORBIT_YAW_SENSITIVITY = 0.005` rad/px
- `ORBIT_PITCH_SENSITIVITY = 0.005` rad/px

Sensitivities are tunable; the initial values are a starting point and may be adjusted during testing.

### New methods on ThreeRenderer

```
startFreeOrbit()
  // Cancel any in-flight Q/E snap (_viewRotating) or release snap (_snapping).
  // Seed _freeYaw = effective current yaw,
  //      _freePitch = effective current pitch (PITCH_REST if not already free).
  // _freeOrbiting = true.

orbitBy(dxPx, dyPx)
  // _freeYaw   += dxPx * ORBIT_YAW_SENSITIVITY
  // _freePitch  = clamp(_freePitch - dyPx * ORBIT_PITCH_SENSITIVITY,
  //                     PITCH_MIN, PITCH_MAX)
  // _updateCameraLookAt()
  // _syncOverlayFromPan()
  // _updateAnchoredWindows()

endFreeOrbit()
  // _freeOrbiting = false
  // Compute nearest 90° snap target for yaw (modulo 2π, choose shortest signed delta).
  // Set _snapFromYaw/Pitch to current free values.
  // Set _snapToYaw to the snapped yaw, _snapToPitch to PITCH_REST.
  // _snapping = true; _snapStartMs = performance.now().

_tickFreeOrbitSnap()
  // Called from the render loop alongside _tickViewRotation.
  // t = clamp01((now - _snapStartMs) / _snapDurationMs)
  // ease = easeInOutQuad(t)
  // _freeYaw   = lerp(_snapFromYaw,   _snapToYaw,   ease)
  // _freePitch = lerp(_snapFromPitch, _snapToPitch, ease)
  // _updateCameraLookAt()
  // On t >= 1:
  //   _viewRotationAngle = _snapToYaw
  //   _viewRotationIndex = round(_snapToYaw / (π/2)) mod 4
  //   _freePitch = PITCH_REST
  //   _snapping = false
```

### `_updateCameraLookAt` — generalized

Current implementation (`src/renderer3d/ThreeRenderer.js:2070`) hardcodes the dimetric camera via `CAM_D` and `CAM_H = CAM_D·√6/3`. Reformulate as a spherical orbit around `(_panX, 0, _panY)`:

```
yaw   = (_freeOrbiting || _snapping) ? _freeYaw   : _viewRotationAngle
pitch = (_freeOrbiting || _snapping) ? _freePitch : PITCH_REST

R = CAM_D * 2 * Math.sqrt(6) / 3   // distance from lookAt to camera in the rest view

offX = R * cos(pitch) * sin(yaw + π/4)
offY = R * sin(pitch)
offZ = R * cos(pitch) * cos(yaw + π/4)

camera.position.set(_panX + offX, offY, _panY + offZ)
camera.lookAt(_panX, 0, _panY)
```

At `yaw = 0, pitch = PITCH_REST = atan(1/√3)`: `cos(pitch) = √3/2`, `sin(pitch) = 1/2`, so `offX = offZ = R·(√3/2)·(√2/2) = R·√6/4 = CAM_D` and `offY = R/2 = CAM_D·√6/3 = CAM_H`. Byte-identical to the current rest position `(_panX + CAM_D, CAM_H, _panY + CAM_D)`.

### `panScreenAligned` — read effective yaw

`panScreenAligned` (line 716) uses `_viewRotationAngle` to compute ground axes for WASD pan. So WASD pans in the screen direction of the current free yaw during MMB-drag, extract an `_effectiveYaw()` helper:

```
_effectiveYaw() {
  return (_freeOrbiting || _snapping) ? _freeYaw : _viewRotationAngle
}
```

Call sites: `panScreenAligned` (line 716), `_updateCameraLookAt` (line 2070). Both read `_effectiveYaw()` instead of `_viewRotationAngle`.

### Render-loop integration

In the animation frame tick (same place `_tickViewRotation` is called), add:

```
this._tickFreeOrbitSnap()
```

Both tickers are cheap no-ops when their respective flags are false.

## InputHandler changes

File: `src/input/InputHandler.js`, `_bindMouse` (line 1411).

**mousedown**: replace the existing middle-click pan branch with free-orbit. Alt+left pan branch is unchanged.

```
if (e.button === 1) {
  this.isFreeOrbiting = true;
  this.freeOrbitLast = { x: e.clientX, y: e.clientY };
  this.renderer.startFreeOrbit();
  canvas.style.cursor = 'grabbing';
  e.preventDefault();
  return;
}
if (e.button === 0 && e.altKey) { /* existing pan branch, unchanged */ }
```

**mousemove**: add a branch before the existing pan branch.

```
if (this.isFreeOrbiting) {
  const dx = e.clientX - this.freeOrbitLast.x;
  const dy = e.clientY - this.freeOrbitLast.y;
  this.freeOrbitLast = { x: e.clientX, y: e.clientY };
  this.renderer.orbitBy(dx, dy);
  return;
}
```

**mouseup** and **mouseleave**:

```
if (this.isFreeOrbiting) {
  this.isFreeOrbiting = false;
  this.renderer.endFreeOrbit();
  canvas.style.cursor = '';
}
```

**Q/E handler** (line 1178): gate on `!this.isFreeOrbiting && !this.renderer._snapping`.

No changes to existing `isPanning` fields — that path is still used by alt+left-drag.

## Acceptance criteria

- Hold MMB, drag horizontal: scene orbits smoothly around the current pan center; no visible jump on mousedown.
- Hold MMB, drag vertical: scene tilts; pitch visibly stops at the 15° and 80° clamps.
- Release MMB: camera animates (~400ms `easeInOutQuad`) to the nearest iso view. Final frame matches the rest geometry pixel-for-pixel (verified against a pre-feature screenshot of the same pan/zoom/rotation index).
- Press Q/E after release: rotates 90° from the new snapped index, not from the pre-orbit index.
- WASD pan during MMB-drag: pans in the screen-aligned direction of the *current* free yaw, not the snapped yaw.
- Scroll-zoom during MMB-drag: zooms toward cursor, same as before.
- Alt+left-drag pan: works exactly as before.
- Middle-click pan: gone (replaced by free-orbit).
- Context windows stay anchored to their tiles throughout the orbit and the snap animation.
- Cursor shows `grabbing` during MMB drag and clears on release.
- Starting an MMB drag during an in-flight Q/E snap cancels the snap and begins free-orbit from the interrupted angle.

## Open questions

None. Sensitivity values may be tuned after playtest.
