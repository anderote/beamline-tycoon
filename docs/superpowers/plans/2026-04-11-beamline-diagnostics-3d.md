# Beamline Diagnostics 3D Models — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fallback rendering for the four starter diagnostics (BPM, ICT, Screen/YAG, Wire Scanner) with distinctive 3D models, resize their footprints for visual variety, and integrate into the existing role-based template pipeline.

**Architecture:** Add a new file `src/renderer3d/builders/diagnostic-builder.js` that exports four role-bucket builder functions (`_buildBPMRoles`, `_buildICTRoles`, `_buildScreenRoles`, `_buildWireScannerRoles`) and a shared `buildBeamPipeSegment` helper. `component-builder.js` imports these and registers them in the existing `ROLE_BUILDERS` map. All geometry is built in component-local space centered at origin, beam axis at `BEAM_HEIGHT = 1.0` along +Z. Uses existing role materials (`iron`/`copper`/`pipe`/`stand`/`detail`) plus `getAccentMaterial` for per-beamline tinting.

**Tech Stack:** Vanilla JS ESM, Vite, Three.js r160 (CDN global — never `import`). No test framework.

---

## Test & verification strategy

No test framework. Verification is manual:

- Start dev server once: `npm run dev`, open `http://localhost:5173`.
- After each task, reload the browser and check the "Verify" step.
- One commit per task. Never amend — fix forward with a new commit.

Smoke test per builder: confirm `ROLE_BUILDERS[id]` exists and `renderComponentThumbnail(id)` returns a data URL without throwing.

---

## File structure

**New files:**
- `src/renderer3d/builders/diagnostic-builder.js` — four builders + shared `buildBeamPipeSegment` helper + geometry/UV constants

**Modified files:**
- `src/data/beamline-components.raw.js` — footprint resize for `bpm`, `ict`, `wireScanner` (`screen` unchanged)
- `src/renderer3d/component-builder.js` — import the four builders, register in `ROLE_BUILDERS`

---

## Size reference (final footprints)

All dims below are **authored in sub-tiles** (1 sub-tile = 0.5 m). The beam runs along the component's local +Z axis.

| Component | `subW` (X across beam) | `subL` (Z along beam) | `subH` (Y height) | Physical size |
|---|---|---|---|---|
| `bpm` | 1 | 1 | 2 | 0.5 m × 0.5 m × 1.0 m |
| `ict` | 1 | 1 | 2 | 0.5 m × 0.5 m × 1.0 m |
| `screen` | 2 | 1 | 2 | 1.0 m × 0.5 m × 1.0 m (**unchanged**) |
| `wireScanner` | 3 | 1 | 2 | 1.5 m × 0.5 m × 1.0 m |

Legacy fields `gridW` and `gridH` are set to match (`gridW = subW`, `gridH = subL`).

---

## Task 1: Resize diagnostic footprints in raw data

**Files:**
- Modify: `src/data/beamline-components.raw.js:451-530`

- [ ] **Step 1: Update BPM entry**

Find the `bpm:` entry (around line 451). Change these fields:

```js
// BEFORE
    subL: 1,
    subW: 2,
    subH: 2, gridW: 2, gridH: 1, geometryType: 'cylinder',

// AFTER
    subL: 1,
    subW: 1,
    subH: 2, gridW: 1, gridH: 1, geometryType: 'cylinder',
```

- [ ] **Step 2: Update ICT entry**

Find the `ict:` entry (around line 491). Change these fields:

```js
// BEFORE
    subL: 1,
    subW: 2,
    subH: 2, gridW: 2, gridH: 1, geometryType: 'cylinder',

// AFTER
    subL: 1,
    subW: 1,
    subH: 2, gridW: 1, gridH: 1, geometryType: 'cylinder',
```

- [ ] **Step 3: Update Wire Scanner entry**

Find the `wireScanner:` entry (around line 511). Change these fields:

```js
// BEFORE
    subL: 1,
    subW: 2,
    subH: 2, gridW: 2, gridH: 1, geometryType: 'cylinder',

// AFTER
    subL: 1,
    subW: 3,
    subH: 2, gridW: 3, gridH: 1, geometryType: 'cylinder',
```

- [ ] **Step 4: Leave Screen entry alone**

`screen:` stays at `subL: 1, subW: 2, gridW: 2, gridH: 1`. No change needed — the spec keeps its existing size.

- [ ] **Step 5: Verify in browser**

Run: `npm run dev` (if not already running). Open the game, go to beamline build mode, select Diagnostics. Hover each of the four devices over an empty beamline slot:

- BPM: single-subtile hover outline (small square)
- ICT: single-subtile hover outline
- Screen: two-subtile hover outline, wide-across-beam (same as before)
- Wire Scanner: three-subtile hover outline, wide-across-beam

Expected: hover outlines match the new sizes. Visuals still use the fallback cylinder — that's fine for now.

- [ ] **Step 6: Commit**

```bash
git add src/data/beamline-components.raw.js
git commit -m "data(diagnostics): resize BPM, ICT, Wire Scanner footprints"
```

---

## Task 2: Create diagnostic-builder.js scaffold with shared helper

**Files:**
- Create: `src/renderer3d/builders/diagnostic-builder.js`

- [ ] **Step 1: Create the builders directory and file**

```bash
mkdir -p src/renderer3d/builders
```

Write `src/renderer3d/builders/diagnostic-builder.js`:

```js
// src/renderer3d/builders/diagnostic-builder.js
//
// Role-bucket builders for the four starter beamline diagnostics.
// Each builder returns a bucket object keyed by material role
// (accent/iron/copper/pipe/stand/detail) whose values are arrays of
// BufferGeometry already transformed into component-local space.
//
// Conventions (shared with component-builder.js):
//   - Beam axis runs along local +Z at y = BEAM_HEIGHT.
//   - Origin is the footprint center at floor level (y = 0).
//   - 1 sub-tile = 0.5 m. A device with subL = N has length N * 0.5 m
//     along Z, centered at z = 0.
//   - THREE is a CDN global — do NOT import it.
//
// Builders are registered in component-builder.js by importing them
// into the ROLE_BUILDERS map.

import { applyTiledBoxUVs, applyTiledCylinderUVs } from '../uv-utils.js';

// Geometry constants shared across diagnostic builders. Kept in sync
// with the values in component-builder.js so the beam pipe reads as
// continuous when diagnostics are placed between other components.
const SUB_UNIT    = 0.5;
const BEAM_HEIGHT = 1.0;
const PIPE_R      = 0.08;
const FLANGE_R    = 0.16;
const FLANGE_H    = 0.045;
const SEGS        = 16;

// Transform a geometry in place and push it into a bucket. Matches the
// _pushTransformed helper in component-builder.js.
function pushT(bucket, geom, matrix) {
  geom.applyMatrix4(matrix);
  bucket.push(geom);
}

// Make a translation matrix. Small helper to avoid repetition.
function trans(x, y, z) {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}

// Make a rotation-X matrix (used to lie cylinders horizontal along Z).
function rotX(angle) {
  return new THREE.Matrix4().makeRotationX(angle);
}

/**
 * Build a straight beam pipe segment spanning the full length of the
 * component's footprint along +Z. Pushes one geometry into the `pipe`
 * bucket. All four diagnostic builders call this first.
 *
 * @param {Record<string, THREE.BufferGeometry[]>} buckets
 * @param {number} subL  Length in sub-tiles (e.g. 1 = 0.5 m).
 */
export function buildBeamPipeSegment(buckets, subL) {
  const len = subL * SUB_UNIT;
  const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, len, SEGS);
  applyTiledCylinderUVs(g, PIPE_R, len, SEGS);
  // CylinderGeometry is Y-aligned by default; rotate so it runs along Z.
  const m = new THREE.Matrix4().multiplyMatrices(
    trans(0, BEAM_HEIGHT, 0),
    rotX(Math.PI / 2),
  );
  pushT(buckets.pipe, g, m);
}

// Builders are filled in by subsequent tasks.
```

- [ ] **Step 2: Verify the module imports cleanly**

Run:

```bash
node --input-type=module -e "import('./src/renderer3d/builders/diagnostic-builder.js').then(m => console.log('OK', Object.keys(m))).catch(e => { console.error(e); process.exit(1); })"
```

Expected output: `OK [ 'buildBeamPipeSegment' ]`

Note: `THREE` is undefined at module-load time in Node, but top-level code in this file only *references* THREE inside function bodies, so import itself should succeed.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/builders/diagnostic-builder.js
git commit -m "renderer3d: scaffold diagnostic-builder with buildBeamPipeSegment"
```

---

## Task 3: Implement BPM role builder

**Files:**
- Modify: `src/renderer3d/builders/diagnostic-builder.js`
- Modify: `src/renderer3d/component-builder.js`

- [ ] **Step 1: Add `_buildBPMRoles` export to diagnostic-builder.js**

Append to `src/renderer3d/builders/diagnostic-builder.js` (after `buildBeamPipeSegment`):

```js
/**
 * BPM — 1×1 footprint. Low cylindrical block on the beam pipe with
 * four SMA-style button feedthroughs at 45° and a thin coax tail.
 * Pipe-mounted, no floor stand.
 *
 * Accent: electronics green (applied by the accent material cache).
 */
export function _buildBPMRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  // Shared straight beam pipe spanning the whole 0.5 m footprint.
  buildBeamPipeSegment(buckets, 1);

  // Main button block — cylinder concentric with the pipe.
  const blockR = 0.12;
  const blockL = 0.30;
  {
    const g = new THREE.CylinderGeometry(blockR, blockR, blockL, SEGS);
    applyTiledCylinderUVs(g, blockR, blockL, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, BEAM_HEIGHT, 0),
      rotX(Math.PI / 2),
    );
    pushT(buckets.accent, g, m);
  }

  // Four button feedthroughs at 45° intervals in the transverse plane,
  // projecting radially outward from the block surface. Each is a short
  // cylinder whose long axis is the radial direction.
  const buttonR = 0.02;
  const buttonL = 0.06;
  const buttonCenterRadius = blockR + buttonL / 2 - 0.005; // slight embed
  for (let i = 0; i < 4; i++) {
    const theta = Math.PI / 4 + (i * Math.PI / 2); // 45, 135, 225, 315 deg
    const dx = Math.cos(theta) * buttonCenterRadius;
    const dy = Math.sin(theta) * buttonCenterRadius;

    const g = new THREE.CylinderGeometry(buttonR, buttonR, buttonL, 8);
    applyTiledCylinderUVs(g, buttonR, buttonL, 8);

    // Default Y-up cylinder — rotate around Z so its long axis points
    // in the (dx, dy) direction. The rotation angle is (theta - 90°)
    // because Y rotated by (theta-90°) lands on direction theta.
    const rZ = new THREE.Matrix4().makeRotationZ(theta - Math.PI / 2);
    const tr = trans(dx, BEAM_HEIGHT + dy, 0);
    const m  = new THREE.Matrix4().multiplyMatrices(tr, rZ);
    pushT(buckets.detail, g, m);
  }

  // Coax signal tail exiting the top of the block (straight up).
  {
    const tailR = 0.015;
    const tailL = 0.10;
    const g = new THREE.CylinderGeometry(tailR, tailR, tailL, 8);
    applyTiledCylinderUVs(g, tailR, tailL, 8);
    const m = trans(0, BEAM_HEIGHT + blockR + tailL / 2, 0);
    pushT(buckets.detail, g, m);
  }

  return buckets;
}
```

- [ ] **Step 2: Register BPM builder in component-builder.js**

In `src/renderer3d/component-builder.js`, near the top of the file after the existing imports (around line 7), add:

```js
import {
  _buildBPMRoles,
} from './builders/diagnostic-builder.js';
```

Then find the section where other role builders are registered (search for `ROLE_BUILDERS.quadrupole =`, around line 751) and add near the other diagnostic-adjacent registrations (after `ROLE_BUILDERS.bellows = _buildBellowsRoles;` around line 808 is a good spot):

```js
ROLE_BUILDERS.bpm = _buildBPMRoles;
```

- [ ] **Step 3: Verify in browser**

Reload the game. Go to beamline build mode → Diagnostics → BPM. Hover it over a drift section.

Expected:
- Small green cylindrical block centered on the beam pipe.
- Four tiny button stubs visible at diagonal angles.
- Thin coax tail pointing straight up.
- Beam pipe reads continuously through the device.
- The footprint outline is 1×1.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/builders/diagnostic-builder.js src/renderer3d/component-builder.js
git commit -m "renderer3d: BPM role builder — button block with 4 feedthroughs"
```

---

## Task 4: Implement ICT role builder

**Files:**
- Modify: `src/renderer3d/builders/diagnostic-builder.js`
- Modify: `src/renderer3d/component-builder.js`

- [ ] **Step 1: Add `_buildICTRoles` to diagnostic-builder.js**

Append to `src/renderer3d/builders/diagnostic-builder.js`:

```js
/**
 * ICT (Integrating Current Transformer) — 1×1 footprint. A toroidal ring
 * wrapping the beam pipe with a single coax signal tail. Pipe-mounted,
 * no floor stand. Silhouette must be clearly distinct from BPM's block.
 *
 * Uses the `copper` role (no accent tint) since the toroid is visually
 * a copper winding.
 */
export function _buildICTRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  buildBeamPipeSegment(buckets, 1);

  // Toroid wrapping the pipe. TorusGeometry(radius, tube, radialSegs,
  // tubularSegs): `radius` is the center-to-tube distance, `tube` is
  // the minor radius.
  const torusRadius = 0.14;
  const torusTube   = 0.04;
  {
    const g = new THREE.TorusGeometry(torusRadius, torusTube, 12, SEGS);
    // Torus lies in the XY plane by default. We want it wrapping the
    // beam pipe (perpendicular to Z), so rotate 90° around X so the
    // torus plane becomes XZ... wait: the pipe is along +Z, so the
    // torus ring should lie in the XY plane *centered on Z=0* with
    // its hole facing ±Z. That's the default orientation — no rotation
    // needed, just translate up to beam height.
    const m = trans(0, BEAM_HEIGHT, 0);
    pushT(buckets.copper, g, m);
  }

  // Coax signal tail exiting the top of the torus.
  {
    const tailR = 0.015;
    const tailL = 0.12;
    const g = new THREE.CylinderGeometry(tailR, tailR, tailL, 8);
    applyTiledCylinderUVs(g, tailR, tailL, 8);
    const m = trans(0, BEAM_HEIGHT + torusRadius + torusTube + tailL / 2, 0);
    pushT(buckets.detail, g, m);
  }

  return buckets;
}
```

- [ ] **Step 2: Register ICT builder**

In `src/renderer3d/component-builder.js`, extend the diagnostic-builder import:

```js
import {
  _buildBPMRoles,
  _buildICTRoles,
} from './builders/diagnostic-builder.js';
```

And after the BPM registration add:

```js
ROLE_BUILDERS.ict = _buildICTRoles;
```

- [ ] **Step 3: Verify in browser**

Reload. Place an ICT on a beamline.

Expected:
- Copper-colored torus wraps the beam pipe (donut around the pipe).
- Hole of the torus is facing along the beam direction (you see the ring from the side when the beam is perpendicular to your view).
- Thin coax tail pointing up.
- Visually distinct from BPM — ring vs. block.
- 1×1 footprint.

If the torus appears edge-on (flat plate perpendicular to the pipe), the plane rotation is wrong — add `const rM = new THREE.Matrix4().makeRotationY(Math.PI/2);` and compose `trans * rM` instead.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/builders/diagnostic-builder.js src/renderer3d/component-builder.js
git commit -m "renderer3d: ICT role builder — toroidal ring on beam pipe"
```

---

## Task 5: Implement Screen/YAG role builder

**Files:**
- Modify: `src/renderer3d/builders/diagnostic-builder.js`
- Modify: `src/renderer3d/component-builder.js`

- [ ] **Step 1: Add `_buildScreenRoles` to diagnostic-builder.js**

Append to `src/renderer3d/builders/diagnostic-builder.js`:

```js
/**
 * Screen / YAG — 2×1 footprint (1.0 m across beam, 0.5 m along beam).
 * A 6-way cross chamber with a vertical pneumatic actuator cylinder on
 * top (amber accent), a small side viewport flange, and a short floor
 * stand under the chamber.
 */
export function _buildScreenRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  // Footprint: subW=2, subL=1 → 1.0 m wide in X, 0.5 m along beam in Z.
  // Beam pipe segment runs 0.5 m along Z.
  buildBeamPipeSegment(buckets, 1);

  // Cross chamber: short fat cylinder centered on the pipe, its own
  // long axis along Z (so the beam passes straight through).
  const chamberR = 0.18;
  const chamberL = 0.35;
  {
    const g = new THREE.CylinderGeometry(chamberR, chamberR, chamberL, SEGS);
    applyTiledCylinderUVs(g, chamberR, chamberL, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, BEAM_HEIGHT, 0),
      rotX(Math.PI / 2),
    );
    pushT(buckets.pipe, g, m);
  }

  // CF flanges at the two Z ends of the chamber where it meets the
  // drift pipe.
  for (const zSign of [-1, 1]) {
    const g = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(g, FLANGE_R, FLANGE_H, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, BEAM_HEIGHT, zSign * (chamberL / 2 + FLANGE_H / 2)),
      rotX(Math.PI / 2),
    );
    pushT(buckets.detail, g, m);
  }

  // Vertical pneumatic actuator rising from the top of the chamber.
  // This is the signature silhouette — tall, amber, centered above the
  // chamber.
  const actR = 0.07;
  const actH = 0.55;
  {
    const g = new THREE.CylinderGeometry(actR, actR, actH, SEGS);
    applyTiledCylinderUVs(g, actR, actH, SEGS);
    const m = trans(0, BEAM_HEIGHT + chamberR + actH / 2, 0);
    pushT(buckets.accent, g, m);
  }

  // Small camera viewport flange sticking out the +X side of the chamber.
  {
    const viewR = 0.06;
    const viewL = 0.10;
    const g = new THREE.CylinderGeometry(viewR, viewR, viewL, 8);
    applyTiledCylinderUVs(g, viewR, viewL, 8);
    // Default Y-up cylinder rotated so its axis points along +X.
    const rZ = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
    const tr = trans(chamberR + viewL / 2, BEAM_HEIGHT, 0);
    const m  = new THREE.Matrix4().multiplyMatrices(tr, rZ);
    pushT(buckets.detail, g, m);
  }

  // Short floor stand: a single rectangular post centered under the
  // chamber, from floor (y=0) up to just under the chamber bottom.
  const standW = 0.20;
  const standD = 0.18;
  const chamberBottomY = BEAM_HEIGHT - chamberR;
  const standH = chamberBottomY;
  if (standH > 0.05) {
    // Base plate (flat pad on the floor)
    const baseH = 0.05;
    const baseW = standW + 0.12;
    const baseD = standD + 0.06;
    {
      const g = new THREE.BoxGeometry(baseW, baseH, baseD);
      applyTiledBoxUVs(g, baseW, baseH, baseD);
      const m = trans(0, baseH / 2, 0);
      pushT(buckets.stand, g, m);
    }
    // Column up to the chamber
    {
      const colH = standH - baseH;
      const g = new THREE.BoxGeometry(standW, colH, standD);
      applyTiledBoxUVs(g, standW, colH, standD);
      const m = trans(0, baseH + colH / 2, 0);
      pushT(buckets.stand, g, m);
    }
  }

  return buckets;
}
```

- [ ] **Step 2: Register Screen builder**

In `src/renderer3d/component-builder.js`, extend the import:

```js
import {
  _buildBPMRoles,
  _buildICTRoles,
  _buildScreenRoles,
} from './builders/diagnostic-builder.js';
```

And add:

```js
ROLE_BUILDERS.screen = _buildScreenRoles;
```

- [ ] **Step 3: Verify in browser**

Reload. Place a Screen/YAG on a beamline.

Expected:
- Cross chamber (short fat cylinder) on the beam pipe.
- Tall amber actuator rising vertically above the chamber — the key silhouette.
- Small viewport flange on one side.
- Short white-ish stand + base plate from floor to the chamber.
- CF flanges at the chamber's two ends.
- 2×1 footprint; beam pipe reads continuously.
- Accent (amber) recolors with per-beamline accent — test by creating two beamlines with different accent colors and placing a Screen on each.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/builders/diagnostic-builder.js src/renderer3d/component-builder.js
git commit -m "renderer3d: Screen/YAG role builder — cross chamber + vertical actuator"
```

---

## Task 6: Implement Wire Scanner role builder

**Files:**
- Modify: `src/renderer3d/builders/diagnostic-builder.js`
- Modify: `src/renderer3d/component-builder.js`

- [ ] **Step 1: Add `_buildWireScannerRoles` to diagnostic-builder.js**

Append to `src/renderer3d/builders/diagnostic-builder.js`:

```js
/**
 * Wire Scanner — 3×1 footprint (1.5 m across beam in X, 0.5 m along Z).
 * A cross chamber on the beam pipe with a long horizontal actuator
 * housing (orange accent) extending in +X and a stepper motor block
 * at the far end. Short floor stand under the chamber.
 */
export function _buildWireScannerRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  buildBeamPipeSegment(buckets, 1);

  // Cross chamber (slightly smaller than the Screen's — 3D reads as a
  // different device that way).
  const chamberR = 0.16;
  const chamberL = 0.30;
  {
    const g = new THREE.CylinderGeometry(chamberR, chamberR, chamberL, SEGS);
    applyTiledCylinderUVs(g, chamberR, chamberL, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, BEAM_HEIGHT, 0),
      rotX(Math.PI / 2),
    );
    pushT(buckets.pipe, g, m);
  }

  // CF flanges at the two Z ends.
  for (const zSign of [-1, 1]) {
    const g = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(g, FLANGE_R, FLANGE_H, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, BEAM_HEIGHT, zSign * (chamberL / 2 + FLANGE_H / 2)),
      rotX(Math.PI / 2),
    );
    pushT(buckets.detail, g, m);
  }

  // Side-arm actuator housing: long box extending in +X from the
  // chamber. Footprint subW=3 gives 1.5 m total width in X, centered
  // at X=0, so the housing can extend from ~chamberR out to ~+0.7 m.
  const armStart = chamberR;         // start at chamber outer surface
  const armEnd   = 0.70;             // stay well inside the +X footprint edge (+0.75)
  const armLen   = armEnd - armStart;
  const armW     = 0.14;             // X thickness — here "W" means along the arm's long axis
  const armH     = 0.12;
  const armD     = 0.14;
  {
    const g = new THREE.BoxGeometry(armLen, armH, armD);
    applyTiledBoxUVs(g, armLen, armH, armD);
    const m = trans(armStart + armLen / 2, BEAM_HEIGHT, 0);
    pushT(buckets.accent, g, m);
  }

  // Stepper motor block at the far end of the side-arm.
  {
    const motorS = 0.18;
    const g = new THREE.BoxGeometry(motorS, motorS, motorS);
    applyTiledBoxUVs(g, motorS, motorS, motorS);
    const m = trans(armEnd + motorS / 2, BEAM_HEIGHT, 0);
    pushT(buckets.iron, g, m);
  }

  // Short floor stand under the chamber (same pattern as Screen).
  const standW = 0.20;
  const standD = 0.18;
  const chamberBottomY = BEAM_HEIGHT - chamberR;
  const standH = chamberBottomY;
  if (standH > 0.05) {
    const baseH = 0.05;
    const baseW = standW + 0.12;
    const baseD = standD + 0.06;
    {
      const g = new THREE.BoxGeometry(baseW, baseH, baseD);
      applyTiledBoxUVs(g, baseW, baseH, baseD);
      const m = trans(0, baseH / 2, 0);
      pushT(buckets.stand, g, m);
    }
    {
      const colH = standH - baseH;
      const g = new THREE.BoxGeometry(standW, colH, standD);
      applyTiledBoxUVs(g, standW, colH, standD);
      const m = trans(0, baseH + colH / 2, 0);
      pushT(buckets.stand, g, m);
    }
  }

  return buckets;
}
```

- [ ] **Step 2: Register Wire Scanner builder**

In `src/renderer3d/component-builder.js`, extend the import:

```js
import {
  _buildBPMRoles,
  _buildICTRoles,
  _buildScreenRoles,
  _buildWireScannerRoles,
} from './builders/diagnostic-builder.js';
```

And add:

```js
ROLE_BUILDERS.wireScanner = _buildWireScannerRoles;
```

- [ ] **Step 3: Verify in browser**

Reload. Place a Wire Scanner on a beamline.

Expected:
- Cross chamber on beam pipe with two CF flanges.
- **Long orange horizontal arm** extending to the side of the beam (perpendicular to beam direction) — this is the key signature.
- Dark-iron stepper motor cube at the far end of the arm.
- Short stand + base plate under the chamber.
- 3×1 footprint hover outline shows the full width correctly.
- Beam pipe reads continuously.
- Accent (orange) recolors per beamline.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/builders/diagnostic-builder.js src/renderer3d/component-builder.js
git commit -m "renderer3d: Wire Scanner role builder — cross chamber + side-arm actuator"
```

---

## Task 7: Final end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Smoke test all four builders via thumbnails**

Reload the game. Open the beamline build menu and scroll to the Diagnostics section. Confirm the build-menu thumbnails for all four diagnostics render correctly (not the fallback cylinder):

- BPM thumbnail shows the green block + buttons
- ICT thumbnail shows the copper torus
- Screen thumbnail shows the chamber + vertical actuator
- Wire Scanner thumbnail shows the chamber + horizontal arm

If any thumbnail is blank or crashes: check the browser console for the error, fix it in a new commit.

- [ ] **Step 2: Place all four in sequence on a real beamline**

Build a test beamline: source → drift → BPM → drift → ICT → drift → Screen → drift → Wire Scanner → drift → Faraday Cup.

Confirm:
- Beam pipe reads continuously from source to endpoint — no gaps, no radius mismatches at the diagnostics.
- All four diagnostics visually distinct from each other and from drift/magnets.
- BPM and ICT have no floor stand; Screen and Wire Scanner do.
- Placing two of the same diagnostic next to each other works (no z-fighting, no placement conflicts).

- [ ] **Step 3: Per-beamline accent recolor**

Create a second beamline with a different accent color (via Settings → Beamline accent, if it exists). Place a BPM, Screen, and Wire Scanner on it. Confirm:
- BPM's block reflects the new accent color
- Screen's vertical actuator reflects the new accent color
- Wire Scanner's side-arm reflects the new accent color
- ICT's copper toroid is unchanged (it uses the `copper` role, not `accent`) — this is expected.

- [ ] **Step 4: Regression check — magnets still render**

Place a dipole and a quadrupole on a beamline. Confirm their existing visuals are unchanged (no regressions from the diagnostic-builder import or ROLE_BUILDERS additions).

- [ ] **Step 5: Demolish outline check**

Hover each diagnostic in demolish mode. Confirm the outline matches the new footprint (1×1 for BPM/ICT, 2×1 for Screen, 3×1 for Wire Scanner) — no stray boxes from invisible hitboxes.

- [ ] **Step 6: Final commit if any fixes were needed**

If Steps 1–5 turned up any bugs, commit the fixes. Otherwise no commit needed — this task is pure verification.

```bash
# only if there are fixes
git add <files>
git commit -m "fix(diagnostics): <specific fix>"
```

---

## Post-plan cleanup

None. No dead code, no migration scaffolding. The plan leaves the repo in a state where:
- `ROLE_BUILDERS` has four new entries (`bpm`, `ict`, `screen`, `wireScanner`).
- `src/renderer3d/builders/diagnostic-builder.js` is the single source of truth for diagnostic geometry.
- Three of the four raw-data entries have resized footprints; `screen` is unchanged.
- No other files touched.
