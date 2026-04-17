# Free-Orbit Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold middle mouse button to orbit the camera freely (yaw + pitch) around the pan center; on release, animate back to the nearest of the 4 iso views.

**Architecture:** Extract pure orbit math (snap target, pitch clamp, camera-offset formula, easing) into a new `src/renderer3d/free-orbit-math.js` module that's unit-testable in plain Node. Extend `ThreeRenderer` with free-orbit state fields, new methods (`startFreeOrbit`, `orbitBy`, `endFreeOrbit`, `_tickFreeOrbitSnap`), and a reformulated `_updateCameraLookAt` that uses spherical coordinates (radius, yaw, pitch) around the pan center. Update `InputHandler` to bind MMB to free-orbit and gate Q/E while orbiting/snapping. No changes to alt+left pan.

**Tech Stack:** Vanilla ES modules, Three.js (global, CDN-loaded — do NOT import), hand-rolled Node test scripts using an inline `assert` counter.

**Design doc:** `docs/superpowers/specs/2026-04-16-free-orbit-camera-design.md`

## Compatibility notes (post-refactor 2026-04-17)

The UI extraction refactor (5e57b109, 2aaf699f) moved UI methods onto `UIHost.prototype`. Camera code was not touched — `_viewRotation*`, `_tickViewRotation`, `_updateCameraLookAt`, `panScreenAligned`, `rotateView`, and the middle-click pan branch are structurally unchanged, just shifted ~20–50 lines. Cited line numbers below reflect the current state at HEAD.

`main.js` now persists `_viewRotationIndex` across saves and restores it on load, then calls `renderer._updateCameraLookAt()` (lines 179, 214–215, 228). The reformulated `_updateCameraLookAt` delivered in Task 2 reads `_effectiveYaw()` / `_effectivePitch()`, which fall back to `_viewRotationAngle` and `PITCH_REST` when not orbiting/snapping — byte-identical to today's behavior. Additionally, `_tickFreeOrbitSnap` updates `_viewRotationIndex` when the release animation ends (Task 3), so the value persisted to saves is always a valid 0..3 index.

There is **no mouseleave handler and no window-level mouseup fallback** in InputHandler today. The current `isPanning` code shares this bug (releases outside the canvas leave panning stuck). Task 4 adds a window-level mouseup fallback specifically for the free-orbit path; out of scope to fix the alt+left pan version here.

---

## Commit strategy

Per project CLAUDE.md, commits group at logical boundaries, not task boundaries:

- **Commit A** (after Task 1): "feat: pure orbit math helpers with tests" — `free-orbit-math.js` + its test file, independently reviewable.
- **Commit B** (after Task 4): "feat: free-orbit camera on MMB-drag" — all ThreeRenderer + InputHandler changes as one coherent feature commit.

Do not commit between Tasks 2, 3, and 4. They are the same logical change to the renderer/input layer.

---

## Task 1: Pure orbit math module with unit tests

**Files:**
- Create: `src/renderer3d/free-orbit-math.js`
- Create: `test/test-free-orbit-math.js`

This task is pure TDD and commits independently. Every function is a pure mathematical helper — no Three.js, no DOM.

- [ ] **Step 1: Write the failing tests**

Create `test/test-free-orbit-math.js`:

```javascript
// === Free Orbit Math Tests ===

import {
  PITCH_REST,
  PITCH_MIN,
  PITCH_MAX,
  CAM_D,
  ORBIT_RADIUS,
  clampPitch,
  snapYaw,
  cameraOffset,
  easeInOutQuad,
} from '../src/renderer3d/free-orbit-math.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.log(`  FAIL: ${msg}`); }
}

function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

console.log('PITCH_REST');
// PITCH_REST = atan(1/sqrt(3)) = 30° — the elevation angle of the current
// camera at (D, D·sqrt(6)/3, D) relative to lookAt (0,0,0).
assert(approx(PITCH_REST, Math.atan(1 / Math.sqrt(3))), 'PITCH_REST = atan(1/sqrt(3))');
assert(approx(PITCH_REST, Math.PI / 6), 'PITCH_REST = 30° (π/6)');

console.log('Pitch bounds');
assert(PITCH_MIN > 0 && PITCH_MIN < PITCH_REST, 'PITCH_MIN is below rest');
assert(PITCH_MAX > PITCH_REST && PITCH_MAX < Math.PI / 2, 'PITCH_MAX is above rest, below vertical');
assert(approx(PITCH_MIN, (15 * Math.PI) / 180), 'PITCH_MIN = 15°');
assert(approx(PITCH_MAX, (80 * Math.PI) / 180), 'PITCH_MAX = 80°');

console.log('clampPitch');
assert(clampPitch(PITCH_REST) === PITCH_REST, 'rest pitch passes through');
assert(clampPitch(-1) === PITCH_MIN, 'underflow clamps to min');
assert(clampPitch(2) === PITCH_MAX, 'overflow clamps to max');
assert(clampPitch(PITCH_MIN - 0.01) === PITCH_MIN, 'just below min clamps');
assert(clampPitch(PITCH_MAX + 0.01) === PITCH_MAX, 'just above max clamps');

console.log('snapYaw — nearest π/2 multiple, preserving winding');
assert(snapYaw(0) === 0, 'zero snaps to zero');
assert(approx(snapYaw(Math.PI / 4 - 0.01), 0), 'just under 45° snaps down to 0');
assert(approx(snapYaw(Math.PI / 4 + 0.01), Math.PI / 2), 'just over 45° snaps up to π/2');
assert(approx(snapYaw(Math.PI / 2), Math.PI / 2), 'π/2 is a fixed point');
assert(approx(snapYaw(-Math.PI / 4 - 0.01), -Math.PI / 2), 'just under -45° snaps to -π/2');
// Accumulated rotation — snap should produce a multiple of π/2 closest to input.
assert(approx(snapYaw(3 * Math.PI + 0.05), 3 * Math.PI), 'snaps near 3π (i.e., 6·π/2) stays at 3π');
assert(approx(snapYaw(3 * Math.PI + Math.PI / 4 + 0.01), 3 * Math.PI + Math.PI / 2),
  'snaps past 3π + π/4 to 3π + π/2');

console.log('cameraOffset — rest view reproduces historical camera position');
// The current rest camera is at (CAM_D, CAM_D * sqrt(6)/3, CAM_D) with the
// +π/4 phase baked into the formula so yaw=0 equals the default view.
{
  const o = cameraOffset(0, PITCH_REST);
  assert(approx(o.x, CAM_D), `rest offX = CAM_D (got ${o.x})`);
  assert(approx(o.y, (CAM_D * Math.sqrt(6)) / 3), `rest offY = CAM_D·√6/3 (got ${o.y})`);
  assert(approx(o.z, CAM_D), `rest offZ = CAM_D (got ${o.z})`);
}

console.log('cameraOffset — 90° yaw rotates in the XZ plane');
{
  const o = cameraOffset(Math.PI / 2, PITCH_REST);
  // A 90° yaw around Y sends (CAM_D, h, CAM_D) -> (CAM_D, h, -CAM_D)
  assert(approx(o.x, CAM_D), `90° offX = CAM_D (got ${o.x})`);
  assert(approx(o.z, -CAM_D), `90° offZ = -CAM_D (got ${o.z})`);
  assert(approx(o.y, (CAM_D * Math.sqrt(6)) / 3), 'height unchanged by yaw');
}

console.log('cameraOffset — pitch = PITCH_MAX tilts most toward top-down');
{
  const o = cameraOffset(0, PITCH_MAX);
  // sin(80°) > sin(30°), cos(80°) < cos(30°), so height up, horizontal down.
  const rest = cameraOffset(0, PITCH_REST);
  assert(o.y > rest.y, 'higher at max pitch than rest');
  assert(Math.hypot(o.x, o.z) < Math.hypot(rest.x, rest.z), 'closer horizontally at max pitch');
}

console.log('cameraOffset — ORBIT_RADIUS is distance from origin');
{
  const o = cameraOffset(0, PITCH_REST);
  assert(approx(Math.hypot(o.x, o.y, o.z), ORBIT_RADIUS),
    `|offset| = ORBIT_RADIUS at rest (got ${Math.hypot(o.x, o.y, o.z)}, expected ${ORBIT_RADIUS})`);
}

console.log('easeInOutQuad');
assert(easeInOutQuad(0) === 0, 'ease(0) = 0');
assert(easeInOutQuad(1) === 1, 'ease(1) = 1');
assert(approx(easeInOutQuad(0.5), 0.5), 'ease(0.5) = 0.5');
assert(easeInOutQuad(0.25) < 0.25, 'ease accelerates slowly from 0');
assert(easeInOutQuad(0.75) > 0.75, 'ease decelerates slowly into 1');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/test-free-orbit-math.js`
Expected: fails with `Cannot find module` / `Cannot find package` for `../src/renderer3d/free-orbit-math.js`.

- [ ] **Step 3: Create the math module**

Create `src/renderer3d/free-orbit-math.js`:

```javascript
// src/renderer3d/free-orbit-math.js
// Pure math helpers for the free-orbit camera. No Three.js, no DOM —
// unit-testable in plain Node.

// Camera rig constants. The current dimetric camera sits at
// (CAM_D, CAM_D·√6/3, CAM_D) looking at (0,0,0). From this geometry:
//   horizontal distance from origin = CAM_D·√2
//   height                          = CAM_D·√6/3
//   pitch (elevation)               = atan(height / horizontal)
//                                    = atan((√6/3) / √2) = atan(1/√3) = 30°
//   orbit radius                    = |(CAM_D, CAM_D·√6/3, CAM_D)|
//                                    = 2·CAM_D·√6 / 3
export const CAM_D = 50;
export const ORBIT_RADIUS = (2 * CAM_D * Math.sqrt(6)) / 3;

export const PITCH_REST = Math.atan(1 / Math.sqrt(3));
export const PITCH_MIN = (15 * Math.PI) / 180;
export const PITCH_MAX = (80 * Math.PI) / 180;

// Default tuning. Pixel-to-radian scalars; adjust to taste during playtest.
export const ORBIT_YAW_SENSITIVITY = 0.005;
export const ORBIT_PITCH_SENSITIVITY = 0.005;

export function clampPitch(p) {
  if (p < PITCH_MIN) return PITCH_MIN;
  if (p > PITCH_MAX) return PITCH_MAX;
  return p;
}

// Snap yaw to the nearest multiple of π/2. Preserves large winding numbers
// (e.g. snapYaw(3π + 0.05) = 3π) so _viewRotationAngle stays continuous
// after a release.
export function snapYaw(yaw) {
  const step = Math.PI / 2;
  return Math.round(yaw / step) * step;
}

// Camera position relative to lookAt, on a sphere of radius ORBIT_RADIUS.
// The +π/4 phase is chosen so (yaw=0, pitch=PITCH_REST) produces the
// historical rest position (CAM_D, CAM_D·√6/3, CAM_D).
//   At yaw=0, pitch=PITCH_REST:
//     cos(pitch) = √3/2, sin(pitch) = 1/2
//     offX = R·(√3/2)·sin(π/4) = R·(√3/2)·(√2/2) = R·√6/4 = CAM_D  ✓
//     offY = R·(1/2)            = R/2            = CAM_D·√6/3    ✓
//     offZ = R·(√3/2)·cos(π/4) = R·√6/4          = CAM_D          ✓
export function cameraOffset(yaw, pitch) {
  const r = ORBIT_RADIUS;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const ang = yaw + Math.PI / 4;
  return {
    x: r * cp * Math.sin(ang),
    y: r * sp,
    z: r * cp * Math.cos(ang),
  };
}

// Matches the easing used by _tickViewRotation in ThreeRenderer.
export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node test/test-free-orbit-math.js`
Expected: all assertions PASS, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/renderer3d/free-orbit-math.js test/test-free-orbit-math.js
git commit -m "feat: pure orbit math helpers with tests

Introduces src/renderer3d/free-orbit-math.js with PITCH_REST,
clampPitch, snapYaw, cameraOffset, and easeInOutQuad as pure
functions that can be unit-tested without a browser. The rest
view reproduces the historical camera position (CAM_D, CAM_D·√6/3,
CAM_D) exactly — verified by test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Reformulate `_updateCameraLookAt` and add `_effectiveYaw`

**Files:**
- Modify: `src/renderer3d/ThreeRenderer.js` (constructor ~line 165, `panScreenAligned` ~line 750, `_updateCameraLookAt` ~line 2130)

Do not commit after this task. It is the start of the integrated renderer+input change committed after Task 4.

- [ ] **Step 1: Import the math module**

Add below the other imports near the top of `src/renderer3d/ThreeRenderer.js`:

```javascript
import {
  PITCH_REST,
  PITCH_MIN,
  PITCH_MAX,
  ORBIT_RADIUS,
  ORBIT_YAW_SENSITIVITY,
  ORBIT_PITCH_SENSITIVITY,
  clampPitch,
  snapYaw,
  cameraOffset,
  easeInOutQuad,
} from './free-orbit-math.js';
```

- [ ] **Step 2: Add free-orbit state fields to the constructor**

Immediately after the existing `_viewRotating = false;` line in the constructor (currently line 165), add:

```javascript
    // Free-orbit state (middle-mouse drag orbits yaw + pitch around the
    // pan center; release animates back to the nearest iso view).
    this._freeOrbiting = false;
    this._freeYaw = 0;
    this._freePitch = PITCH_REST;
    this._snapping = false;
    this._snapFromYaw = 0;
    this._snapToYaw = 0;
    this._snapFromPitch = PITCH_REST;
    this._snapToPitch = PITCH_REST;
    this._snapStartMs = 0;
    this._snapDurationMs = 400;
```

- [ ] **Step 3: Add the `_effectiveYaw` helper**

Add as a new method on the class, placed immediately before `_updateCameraLookAt` (currently line 2130):

```javascript
  /**
   * Yaw used for camera placement and screen-aligned panning. During a
   * free-orbit drag or its release snap, this is the free yaw; otherwise
   * it's the Q/E rotation angle.
   */
  _effectiveYaw() {
    return (this._freeOrbiting || this._snapping)
      ? this._freeYaw
      : this._viewRotationAngle;
  }

  _effectivePitch() {
    return (this._freeOrbiting || this._snapping)
      ? this._freePitch
      : PITCH_REST;
  }
```

- [ ] **Step 4: Replace `_updateCameraLookAt`**

Replace the existing body of `_updateCameraLookAt` (currently lines 2130–2143, starting with `// Orbit the dimetric camera around...` and ending with `this.camera.lookAt(this._panX, 0, this._panY);`) with:

```javascript
  _updateCameraLookAt() {
    // Spherical orbit around (_panX, 0, _panY). cameraOffset(yaw=0, pitch=PITCH_REST)
    // reproduces the historical rest position exactly.
    const yaw = this._effectiveYaw();
    const pitch = this._effectivePitch();
    const off = cameraOffset(yaw, pitch);
    this.camera.position.set(this._panX + off.x, off.y, this._panY + off.z);
    this.camera.lookAt(this._panX, 0, this._panY);
  }
```

Remove the now-unused local constants `CAM_D = 50;` and `CAM_H = CAM_D * Math.sqrt(6) / 3;` from inside the function — they're replaced by the imported module.

- [ ] **Step 5: Update `panScreenAligned` to use effective yaw**

Find `panScreenAligned` at line 750. On line 751, change:

```javascript
    const a = this._viewRotationAngle;
```

to:

```javascript
    const a = this._effectiveYaw();
```

Leave the rest of the function unchanged.

- [ ] **Step 6: Verify the rest view is unchanged in the browser**

Run `npm run dev` and open the game in a browser. The default view must look identical to before this change — no visible shift, rotation, or scale difference. Press Q and E to rotate: each 90° rotation must end at the same positions as before.

If the rest view is shifted or rotated: the math is wrong. Do not proceed. Re-check that `cameraOffset(0, PITCH_REST)` returns `(CAM_D, CAM_D·√6/3, CAM_D)` (the test in Task 1 covers this — the test should have already failed if so). Stop `npm run dev` with Ctrl+C when verification is done.

Do not commit.

---

## Task 3: Add free-orbit methods and wire into render loop

**Files:**
- Modify: `src/renderer3d/ThreeRenderer.js` (add methods immediately after `rotateView` at line 785, wire tick into `_animate` at line 2184)

Do not commit after this task.

- [ ] **Step 1: Add `startFreeOrbit`, `orbitBy`, `endFreeOrbit`**

Insert these methods immediately after `rotateView` (which ends around line 795):

```javascript
  /**
   * Begin a free-orbit drag. Called on middle-mouse-down. Cancels any
   * in-flight Q/E rotation or release snap and seeds the free yaw/pitch
   * from the current effective orientation so there is no visible jump.
   */
  startFreeOrbit() {
    // Snapshot current orientation BEFORE flipping mode flags, so
    // _effectiveYaw returns the pre-transition value.
    const yaw = this._effectiveYaw();
    const pitch = this._effectivePitch();
    this._viewRotating = false;
    this._snapping = false;
    this._freeYaw = yaw;
    this._freePitch = pitch;
    this._freeOrbiting = true;
    // Match the behavior of rotateView: the PixiJS overlay is hidden
    // during any camera animation. Restored when _tickFreeOrbitSnap ends.
    if (this.world) this.world.visible = false;
  }

  /**
   * Apply a mouse-delta during a free-orbit drag. dxPx/dyPx are raw pixel
   * deltas since the last mousemove. Drag up tilts up toward top-down.
   */
  orbitBy(dxPx, dyPx) {
    if (!this._freeOrbiting) return;
    this._freeYaw += dxPx * ORBIT_YAW_SENSITIVITY;
    this._freePitch = clampPitch(this._freePitch - dyPx * ORBIT_PITCH_SENSITIVITY);
    this._updateCameraLookAt();
    this._syncOverlayFromPan();
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
  }

  /**
   * End a free-orbit drag. Kicks off a 400ms easeInOutQuad animation back
   * to the nearest iso view: yaw snaps to nearest π/2 multiple, pitch
   * restores to PITCH_REST. On completion, _viewRotationIndex and
   * _viewRotationAngle are updated so Q/E continues from the snapped pose.
   */
  endFreeOrbit() {
    if (!this._freeOrbiting) return;
    this._freeOrbiting = false;
    this._snapFromYaw = this._freeYaw;
    this._snapFromPitch = this._freePitch;
    this._snapToYaw = snapYaw(this._freeYaw);
    this._snapToPitch = PITCH_REST;
    this._snapStartMs = performance.now();
    this._snapping = true;
  }

  _tickFreeOrbitSnap() {
    if (!this._snapping) return;
    const t = Math.min(1, (performance.now() - this._snapStartMs) / this._snapDurationMs);
    const k = easeInOutQuad(t);
    this._freeYaw = this._snapFromYaw + (this._snapToYaw - this._snapFromYaw) * k;
    this._freePitch = this._snapFromPitch + (this._snapToPitch - this._snapFromPitch) * k;
    this._updateCameraLookAt();
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
    if (t >= 1) {
      // Hand control back to the Q/E system at the snapped pose.
      this._viewRotationAngle = this._snapToYaw;
      this._viewRotationIndex = ((Math.round(this._snapToYaw / (Math.PI / 2)) % 4) + 4) % 4;
      this._freePitch = PITCH_REST;
      this._snapping = false;
      if (this.world) this.world.visible = true;
    }
  }
```

- [ ] **Step 2: Wire `_tickFreeOrbitSnap` into the render loop**

Find `_animate` around line 2180. Immediately after the existing `this._tickViewRotation();` call at line 2184, add:

```javascript
    this._tickFreeOrbitSnap();
```

So the block becomes:

```javascript
    this._tickViewRotation();
    this._tickFreeOrbitSnap();
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
```

- [ ] **Step 3: Verify the game still runs**

Run `npm run dev` and load the game. The rest view must still look identical; Q/E must still work. Free-orbit can't be triggered yet (InputHandler changes land in Task 4) — this step only verifies nothing regressed. Stop `npm run dev` when done.

Do not commit.

---

## Task 4: Bind MMB to free-orbit in InputHandler, gate Q/E

**Files:**
- Modify: `src/input/InputHandler.js` (mousedown at line 1437, mousemove at line 1588, mouseup at line 1771, Q/E handlers at lines 1199 / 1204, constructor `isPanning` init at line 60)

This task completes the feature. Commit after verifying.

- [ ] **Step 1: Locate the existing panning branch**

Open `src/input/InputHandler.js`. Find the mousedown handler inside `_bindMouse` at line 1437. The current middle-click branch reads (line 1439–1446):

```javascript
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this.isPanning = true;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.panStartPan = { x: this.renderer._panX, y: this.renderer._panY };
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
```

- [ ] **Step 2: Split it — MMB becomes free-orbit, alt+left keeps panning**

Replace the block from Step 1 with:

```javascript
      // Middle mouse: free-orbit camera drag. Release snaps to nearest iso view.
      if (e.button === 1) {
        this.isFreeOrbiting = true;
        this.freeOrbitLast = { x: e.clientX, y: e.clientY };
        this.renderer.startFreeOrbit();
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      // Alt + left drag: pan (unchanged).
      if (e.button === 0 && e.altKey) {
        this.isPanning = true;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.panStartPan = { x: this.renderer._panX, y: this.renderer._panY };
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
```

- [ ] **Step 3: Initialize the new fields in the constructor**

Locate the InputHandler constructor. `this.isPanning = false;` is at line 60. Add immediately after it:

```javascript
    this.isFreeOrbiting = false;
    this.freeOrbitLast = { x: 0, y: 0 };
```

- [ ] **Step 4: Handle mousemove during a free-orbit drag**

Find the `mousemove` listener bound on the canvas at line 1588. The first statement inside is `if (this.isPanning) { … }`. Insert before that `isPanning` branch:

```javascript
      if (this.isFreeOrbiting) {
        const dx = e.clientX - this.freeOrbitLast.x;
        const dy = e.clientY - this.freeOrbitLast.y;
        this.freeOrbitLast = { x: e.clientX, y: e.clientY };
        this.renderer.orbitBy(dx, dy);
        return;
      }
```

- [ ] **Step 5: Release the orbit on mouseup (canvas + window fallback)**

Find the existing canvas `mouseup` handler at line 1771. The first statement inside is `this._hideDragCostTooltip();`. Insert after that line and before the `if (this.isPanning)` branch at line 1773:

```javascript
      if (this.isFreeOrbiting) {
        this.isFreeOrbiting = false;
        this.renderer.endFreeOrbit();
        canvas.style.cursor = '';
        return;
      }
```

There is no `mouseleave` handler today and no window-level `mouseup` fallback, so a drag that releases outside the canvas would leave `isFreeOrbiting = true` forever. Add a window-level fallback at the end of `_bindMouse` (immediately before the closing `}` of the method):

```javascript
    // Window-level fallback: if the user releases the middle mouse
    // button while the cursor is off the canvas, end the orbit cleanly
    // so the snap animation still runs.
    window.addEventListener('mouseup', (e) => {
      if (e.button === 1 && this.isFreeOrbiting) {
        this.isFreeOrbiting = false;
        this.renderer.endFreeOrbit();
        canvas.style.cursor = '';
      }
    });
```

- [ ] **Step 6: Gate Q/E while orbiting or snapping**

Find the Q and E keydown cases at lines 1199–1203 and 1204–1208. They currently read:

```javascript
        case 'q': case 'Q': {
          e.preventDefault();
          this.renderer.rotateView(-1);
          break;
        }
        case 'e': case 'E': {
          e.preventDefault();
          this.renderer.rotateView(+1);
          break;
        }
```

Change to:

```javascript
        case 'q': case 'Q': {
          e.preventDefault();
          if (!this.isFreeOrbiting && !this.renderer._snapping) {
            this.renderer.rotateView(-1);
          }
          break;
        }
        case 'e': case 'E': {
          e.preventDefault();
          if (!this.isFreeOrbiting && !this.renderer._snapping) {
            this.renderer.rotateView(+1);
          }
          break;
        }
```

`e.preventDefault()` stays outside the guard so Q/E don't leak to the browser even when suppressed.

- [ ] **Step 7: Browser verification — acceptance criteria from the spec**

Run `npm run dev`. Load the game. Walk through the acceptance checklist below and confirm each item. Tick as you go. If any item fails, stop and fix before committing.

- [ ] Hold MMB + drag horizontally — scene orbits smoothly around the pan center; no visible jump on mousedown.
- [ ] Hold MMB + drag vertically — scene tilts. Drag up tilts toward top-down. Pitch visibly stops at 15° and 80° clamps.
- [ ] Release MMB — camera animates (~400ms) to the nearest iso view. Final frame looks identical to a fresh rest view at the same pan/zoom and the new snapped rotation index.
- [ ] After release, press Q — rotates 90° from the new snapped index (not the pre-orbit one).
- [ ] WASD during MMB-drag — pans in the screen-aligned direction of the current free yaw.
- [ ] Scroll-zoom during MMB-drag — zooms toward cursor, same as before.
- [ ] Alt + left-drag — still pans exactly as before.
- [ ] Middle-click without drag — no pan motion happens (middle-click pan is gone).
- [ ] Context windows — any open beamline/equipment context window stays anchored to its tile throughout the orbit and the release snap.
- [ ] Cursor shows `grabbing` during MMB drag and clears on release.
- [ ] Start an MMB drag during an in-flight Q/E snap (press Q then immediately press MMB) — the Q/E snap is cancelled and free-orbit begins from the interrupted angle with no visible jump.
- [ ] Spin the camera several full turns while holding MMB, then release — the snap animation still converges (no runaway), and Q/E from the snapped position is correct.
- [ ] Drag past the canvas edge, release outside — the window-level mouseup fallback ends the orbit and the snap animation runs.
- [ ] Save and reload (hard refresh) after a snapped position — the loaded view matches the saved rotation index (main.js lines 179, 214–215, 228 roundtrip through the reformulated `_updateCameraLookAt`).

Stop `npm run dev` when done.

- [ ] **Step 8: Re-run the unit tests as a final sanity check**

Run: `node test/test-free-orbit-math.js`
Expected: all PASS, exit 0. (The math module wasn't touched in Tasks 2–4, but re-run to catch accidental edits.)

- [ ] **Step 9: Commit**

```bash
git add src/renderer3d/ThreeRenderer.js src/input/InputHandler.js
git commit -m "feat: free-orbit camera on MMB-drag

Middle-mouse-drag orbits the camera freely in yaw and pitch around
the current pan center. Vertical drag tilts between 15° and 80°.
Releasing animates (400ms easeInOutQuad) back to the nearest of the
4 iso views — yaw snaps to the nearest 90°, pitch restores to the
30° dimetric rest angle. Q/E is suppressed during the drag and snap.

Middle-click panning is removed (WASD is the pan binding); alt+left
drag still pans. _updateCameraLookAt is reformulated as a spherical
orbit that reproduces the historical rest position exactly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review checklist (for the implementer)

Before declaring the plan complete:

- [ ] No commits between Tasks 2, 3, 4 (by design — one feature commit at the end of Task 4).
- [ ] `git log --oneline -3` shows exactly two new commits: the math-module commit (Task 1) and the feature commit (Task 4).
- [ ] `git status` is clean.
- [ ] All 12 acceptance-criteria bullets from Task 4 Step 7 are ticked.
- [ ] `node test/test-free-orbit-math.js` passes.
