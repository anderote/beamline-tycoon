# Detailed Magnet 3D Models + Beamline Accent Color — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fallback geometry for `dipole` and `quadrupole` with hybrid-style 3D models that support per-beamline accent colors, using a template-and-tint pattern that keeps draw calls bounded.

**Architecture:** Detail builders now return role-bucketed `BufferGeometry` lists (`accent`/`iron`/`copper`/`pipe`/`stand`/`detail`) instead of full `THREE.Group`s. A template cache merges each role into a single `BufferGeometry` once per component type. Each placement clones meshes that share the merged geometry, shares materials for un-tinted roles, and uses a `(type, colorHex)`-keyed cache for the accent material. Per-beamline color is looked up in `buildComponents()` and flows through the snapshot.

**Tech Stack:** Vanilla JS ESM, Vite, Three.js r160 (CDN global), no test framework — verification is manual via `npm run dev` in the browser.

---

## Test & verification strategy

There is no test framework in this project (`package.json` has only `dev`/`build`/`preview`/`assets`). Verification is manual:

- **Pure-logic modules** (accent rotation, merge helper): run a one-liner sanity script with `node --input-type=module -e '...'`.
- **Visual tasks** (geometry, lighting, color picker): start the dev server once with `npm run dev` and leave it running. Reload the browser after each code change. Each task's "Verify" step lists exactly what to look for.
- **Commits**: one commit per task. Never amend — if something breaks, fix forward with a new commit.

Keep the dev server running in a terminal: `npm run dev` then open `http://localhost:5173` (or whatever Vite prints).

---

## File structure

**New files:**
- `src/beamline/accent-colors.js` — 8 canonical swatches as a frozen array

**Modified files:**
- `src/beamline/BeamlineRegistry.js` — add `accentColor` to entries, rotate defaults
- `src/renderer3d/world-snapshot.js` — add `beamlineId` and `accentColor` to each component snapshot entry
- `src/renderer3d/component-builder.js` — merge helper, material roles, template cache, new dipole/quad builders, instantiate path, thumbnail lighting fix
- `src/renderer3d/ThreeRenderer.js` — new `updateBeamlineAccent(beamlineId, hex)` method
- `src/ui/BeamlineWindow.js` — accent color picker in Settings tab
- `style.css` — `.beamline-accent-swatch` row styles

---

## Task 1: Create canonical accent color module

**Files:**
- Create: `src/beamline/accent-colors.js`

- [ ] **Step 1: Create the module**

Write `src/beamline/accent-colors.js`:

```js
// === BEAMLINE ACCENT COLORS ===
// Canonical lab-inspired paint colors applied to the "accent" role meshes
// of placed beamline components (magnet yokes, RF cavity bodies, etc).
// Players can also pick a custom color per beamline — anything outside this
// list is still valid.

/**
 * @typedef {Object} AccentSwatch
 * @property {string} name  Human-readable label shown in the picker UI.
 * @property {number} hex   24-bit color integer (e.g. 0xc62828).
 */

/** @type {ReadonlyArray<AccentSwatch>} */
export const CANONICAL_ACCENTS = Object.freeze([
  { name: 'APS Red',        hex: 0xc62828 },
  { name: 'Fermilab Blue',  hex: 0x1e4a9e },
  { name: 'SLAC Gold',      hex: 0xe8a417 },
  { name: 'CERN Green',     hex: 0x2e7d32 },
  { name: 'JLab Violet',    hex: 0x6a3d9a },
  { name: 'KEK Orange',     hex: 0xe65100 },
  { name: 'DESY Teal',      hex: 0x00838f },
  { name: 'BNL Graphite',   hex: 0x37474f },
]);

/**
 * Pick the Nth canonical accent (wraps around). Used as the default
 * color when a new beamline is created.
 * @param {number} n  Zero-indexed beamline ordinal.
 * @returns {number} hex integer
 */
export function canonicalAccentFor(n) {
  const idx = ((n % CANONICAL_ACCENTS.length) + CANONICAL_ACCENTS.length) % CANONICAL_ACCENTS.length;
  return CANONICAL_ACCENTS[idx].hex;
}
```

- [ ] **Step 2: Sanity-check the rotation helper**

Run:
```bash
cd /Users/andrewcote/Documents/software/beamline-tycoon
node --input-type=module -e "import('./src/beamline/accent-colors.js').then(m => { console.log(m.CANONICAL_ACCENTS.length); console.log([0,1,7,8,-1].map(m.canonicalAccentFor).map(n => n.toString(16))); });"
```

Expected output:
```
8
[ 'c62828', '1e4a9e', '37474f', 'c62828', '37474f' ]
```

(n=0 → APS red, n=7 → graphite, n=8 wraps to red, n=-1 wraps to graphite.)

- [ ] **Step 3: Commit**

```bash
git add src/beamline/accent-colors.js
git commit -m "feat(beamline): canonical accent color palette"
```

---

## Task 2: Assign accent color when creating a beamline

**Files:**
- Modify: `src/beamline/BeamlineRegistry.js:42-68`

- [ ] **Step 1: Import the palette**

Add after line 10 (`import { Beamline } from './Beamline.js';`):

```js
import { canonicalAccentFor, CANONICAL_ACCENTS } from './accent-colors.js';
```

- [ ] **Step 2: Rotate through palette on `createBeamline`**

Replace the body of `createBeamline(machineType)` (currently lines 53-68) with:

```js
  createBeamline(machineType) {
    const id = `bl-${this.nextBeamlineId}`;
    const name = `Beamline-${this.nextBeamlineId}`;
    // Default color rotates through the 8 canonical swatches so the first
    // 8 beamlines are visually distinct without the player picking anything.
    const accentColor = canonicalAccentFor(this.nextBeamlineId - 1);
    this.nextBeamlineId++;

    const entry = {
      id,
      name,
      accentColor,
      status: 'stopped',
      beamline: new Beamline(),
      beamState: makeDefaultBeamState(machineType),
    };

    this.beamlines.set(id, entry);
    return entry;
  }
```

- [ ] **Step 3: Verify in browser**

Make sure `npm run dev` is running. Reload the app. Open DevTools console and run:

```js
game.registry.getAll().map(e => ({ id: e.id, accent: '#' + e.accentColor.toString(16) }))
```

Expected: every entry has an `accent` property (hex color string). The first beamline should be `#c62828`.

If there are no beamlines yet, create one from the UI first, then re-run.

- [ ] **Step 4: Commit**

```bash
git add src/beamline/BeamlineRegistry.js
git commit -m "feat(beamline): assign rotating accent color on creation"
```

---

## Task 3: Expose accent color on component snapshots

**Files:**
- Modify: `src/renderer3d/world-snapshot.js:98-150`

- [ ] **Step 1: Include `beamlineId` and `accentColor` on each node snapshot**

Replace the body of `buildComponents(game)` with:

```js
function buildComponents(game) {
  const nodes = game.registry.getAllNodes();
  const editingId = game.editingBeamlineId;

  const result = nodes.map(node => {
    const entry = game.registry.getBeamlineForNode(node.id);
    const beamlineId = entry ? entry.id : null;
    const accentColor = entry ? entry.accentColor : 0xc62828;

    // Dimmed: node belongs to a different beamline than the one being edited
    let dimmed = false;
    if (editingId && entry && entry.id !== editingId) {
      dimmed = true;
    }

    const health = typeof game.getComponentHealth === 'function'
      ? game.getComponentHealth(node.id)
      : undefined;

    return {
      id: node.id,
      type: node.type,
      col: node.col,
      row: node.row,
      subCol: node.subCol ?? null,
      subRow: node.subRow ?? null,
      direction: node.dir ?? node.direction ?? null,
      tiles: node.tiles ? node.tiles.map(t => ({ col: t.col, row: t.row })) : [{ col: node.col, row: node.row }],
      dimmed,
      health,
      beamlineId,
      accentColor,
    };
  });

  // Unified-system beamline placeables (drift pipes placed outside the registry)
  const seenIds = new Set(result.map(r => r.id));
  const placeables = (game.state.placeables || []).filter(p => p.category === 'beamline');
  for (const p of placeables) {
    if (seenIds.has(p.id)) continue;
    result.push({
      id: p.id,
      type: p.type,
      col: p.col,
      row: p.row,
      subCol: p.subCol ?? null,
      subRow: p.subRow ?? null,
      direction: p.dir ?? null,
      tiles: p.cells ? p.cells.map(c => ({ col: c.col, row: c.row })) : [{ col: p.col, row: p.row }],
      dimmed: false,
      health: undefined,
      beamlineId: p.beamlineId ?? null,
      accentColor: 0xc62828,
    });
  }

  return result;
}
```

- [ ] **Step 2: Verify in browser**

Reload. In DevTools console:

```js
buildComponents = (await import('/src/renderer3d/world-snapshot.js')).buildWorldSnapshot(game).components
buildComponents.slice(0, 3)
```

Expected: each component has `beamlineId` and `accentColor` fields. Existing placed magnets still render (just with old fallback geometry for now).

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/world-snapshot.js
git commit -m "feat(snapshot): carry beamlineId and accentColor on component entries"
```

---

## Task 4: Add geometry merge helper to component-builder

**Files:**
- Modify: `src/renderer3d/component-builder.js` — add new helper near other internal helpers (after `_addShadow`, around line 38)

- [ ] **Step 1: Write the merge helper**

Insert this function after `_addShadow` (around line 38):

```js
/**
 * Merge a list of non-indexed BufferGeometries with matching attributes into
 * a single BufferGeometry. Only handles `position` and `normal` attributes
 * (all the primitives we use — Box/Cylinder/Torus/Plane — expose these).
 *
 * Each input geometry is consumed: we assume the caller has already applied
 * any world-space transform via `.applyMatrix4()`. The result is a fresh
 * non-indexed BufferGeometry owning its own buffers.
 *
 * @param {THREE.BufferGeometry[]} geometries
 * @returns {THREE.BufferGeometry}
 */
function _mergeGeometries(geometries) {
  if (geometries.length === 0) {
    return new THREE.BufferGeometry();
  }

  // First pass — make sure every input is non-indexed so we can concat directly.
  const flat = geometries.map(g => g.index ? g.toNonIndexed() : g);

  // Sum sizes.
  let posCount = 0;
  let normCount = 0;
  for (const g of flat) {
    posCount += g.attributes.position.array.length;
    const na = g.attributes.normal;
    if (na) normCount += na.array.length;
  }

  const positions = new Float32Array(posCount);
  const normals = normCount > 0 ? new Float32Array(normCount) : null;

  let posOff = 0;
  let normOff = 0;
  for (const g of flat) {
    positions.set(g.attributes.position.array, posOff);
    posOff += g.attributes.position.array.length;
    if (normals && g.attributes.normal) {
      normals.set(g.attributes.normal.array, normOff);
      normOff += g.attributes.normal.array.length;
    }
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) {
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  } else {
    merged.computeVertexNormals();
  }
  return merged;
}
```

- [ ] **Step 2: Sanity check via browser console**

Reload. Open DevTools console:

```js
const mod = await import('/src/renderer3d/component-builder.js')
// Helper is module-private — test it indirectly by confirming the module loads without errors.
mod
```

Expected: module loads, no errors logged. (Direct testing of the private helper comes in Task 6 when we use it.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/component-builder.js
git commit -m "feat(builder): add BufferGeometry merge helper"
```

---

## Task 5: Shared material cache and role constants

**Files:**
- Modify: `src/renderer3d/component-builder.js` — add after the `_matCache` block (~line 31)

- [ ] **Step 1: Add role constants and shared materials**

Insert this block after the existing `_mat()` function:

```js
// ── Role-based material system ───────────────────────────────────────
// Detail builders that use the new template pattern return meshes
// bucketed into one of these roles. Each role maps to a shared material
// (or a per-color cached material for 'accent').

const ROLES = /** @type {const} */ (['accent', 'iron', 'copper', 'pipe', 'stand', 'detail']);

// Paint-on-iron for the accent role. The color is overridden per beamline;
// this base exists only to be cloned.
const ACCENT_BASE_ROUGHNESS = 0.6;
const ACCENT_BASE_METALNESS = 0.12;

const SHARED_MATERIALS = {
  iron:   new THREE.MeshStandardMaterial({ color: 0x2b2d35, roughness: 0.5,  metalness: 0.4 }),
  copper: new THREE.MeshStandardMaterial({ color: 0xd4721a, roughness: 0.4,  metalness: 0.5 }),
  pipe:   new THREE.MeshStandardMaterial({ color: PIPE_COLOR,  roughness: 0.3,  metalness: 0.5 }),
  stand:  new THREE.MeshStandardMaterial({ color: STAND_COLOR, roughness: 0.7,  metalness: 0.1 }),
  // 'detail' pieces each decide their own material at build time — bolts
  // use a dark steel, small coil rings use copper. We store the bolt one
  // here because it's the most common detail material.
  detail: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7,  metalness: 0.3 }),
};

/** Cache of (componentType + '|' + colorHex) -> MeshStandardMaterial */
const _accentMatCache = new Map();

/**
 * Get or create a painted-metal material for a given component type at a
 * given accent color. Cached so that all placements of the same type on
 * the same beamline share one material instance.
 *
 * The `compType` is part of the key so future components can tweak
 * roughness/metalness per type without affecting others.
 */
function getAccentMaterial(compType, colorHex) {
  const key = compType + '|' + colorHex.toString(16);
  let m = _accentMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: ACCENT_BASE_ROUGHNESS,
      metalness: ACCENT_BASE_METALNESS,
    });
    _accentMatCache.set(key, m);
  }
  return m;
}
```

- [ ] **Step 2: Verify the module still parses**

Reload the dev server. Open the browser — the game should still render (existing builders untouched). If the page throws, fix the syntax.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/component-builder.js
git commit -m "feat(builder): shared material cache and role constants"
```

---

## Task 6: Template cache + instantiate path

**Files:**
- Modify: `src/renderer3d/component-builder.js` — add after the shared materials block from Task 5

- [ ] **Step 1: Add template infra**

Insert:

```js
// ── Template-and-tint infrastructure ────────────────────────────────
// A "role-based" builder returns { accent: [geoms], iron: [geoms], ... }
// where each array holds already-transformed BufferGeometries ready to
// be merged. We merge each role's list once per component type and cache
// the resulting meshes as a "template". Per-placement instantiation then
// creates lightweight Mesh wrappers that share the template's geometry
// and (for non-accent roles) the template's material.

/** @type {Map<string, Record<string, THREE.Mesh>>} */
const _templateCache = new Map();

/**
 * Registry of role-based builders. Unlike DETAIL_BUILDERS (legacy — returns
 * a fully assembled THREE.Group), these return a role bucket object.
 *
 * A builder may omit roles it doesn't use — the template-cache step only
 * processes roles with at least one geometry.
 *
 * @type {Record<string, () => Record<string, THREE.BufferGeometry[]>>}
 */
const ROLE_BUILDERS = {};

/**
 * Build (or fetch) the template for a role-based component type.
 * Returns a map of role -> Mesh. The meshes own merged geometry but use
 * placeholder/shared materials. Callers clone the meshes per placement.
 */
function _getRoleTemplate(compType) {
  if (_templateCache.has(compType)) return _templateCache.get(compType);
  const builder = ROLE_BUILDERS[compType];
  if (!builder) return null;

  const buckets = builder();
  const template = {};
  for (const role of ROLES) {
    const list = buckets[role];
    if (!list || list.length === 0) continue;
    const merged = _mergeGeometries(list);
    // Dispose the source geometries — we own `merged` now.
    for (const g of list) g.dispose();
    const mat = role === 'accent'
      ? SHARED_MATERIALS.pipe // placeholder; replaced per placement
      : SHARED_MATERIALS[role];
    const mesh = new THREE.Mesh(merged, mat);
    mesh.userData.role = role;
    if (role === 'detail') mesh.userData.lod = 'detail';
    template[role] = mesh;
  }

  _templateCache.set(compType, template);
  return template;
}

/**
 * Instantiate a placed component from its role template. Returns a Group
 * containing one Mesh per role, where meshes share the template's merged
 * geometry and a cached material. Cheap to call repeatedly.
 *
 * @param {string} compType
 * @param {number} accentColorHex
 * @returns {THREE.Group|null} null if no role builder exists for this type
 */
function _instantiateRoleTemplate(compType, accentColorHex) {
  const template = _getRoleTemplate(compType);
  if (!template) return null;

  const group = new THREE.Group();
  for (const role of ROLES) {
    const tplMesh = template[role];
    if (!tplMesh) continue;
    const mat = role === 'accent'
      ? getAccentMaterial(compType, accentColorHex)
      : SHARED_MATERIALS[role];
    const mesh = new THREE.Mesh(tplMesh.geometry, mat);
    mesh.userData.role = role;
    if (role === 'detail') {
      mesh.userData.lod = 'detail';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    } else {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    group.add(mesh);
  }
  return group;
}
```

- [ ] **Step 2: Verify the module still parses**

Reload. Game should still load and render without errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/component-builder.js
git commit -m "feat(builder): template cache and instantiate path"
```

---

## Task 7: Role-based quadrupole builder

**Files:**
- Modify: `src/renderer3d/component-builder.js` — add near the existing detail builders (after `_buildPillboxCavity`, before the `DETAIL_BUILDERS` map around line 311)

- [ ] **Step 1: Write the role builder**

Insert:

```js
// ── Role-based builders (template pattern) ──────────────────────────
// These return BufferGeometry buckets rather than assembled Groups.
// Individual primitives are built, positioned via a Matrix4, and baked
// into the geometry so they can be merged per role.

function _pushTransformed(bucket, geom, matrix) {
  geom.applyMatrix4(matrix);
  bucket.push(geom);
}

/**
 * Build the role buckets for a quadrupole magnet.
 *
 * Physical layout (1m x 1m x 1.5m, beam along local +Z):
 *   - 4 painted iron yoke slabs forming a square frame
 *   - 4 dark iron pole tips pointing inward
 *   - 4 copper coil rings wrapped around the poles
 *   - Bolts at the yoke corners (detail LOD)
 *   - Beam pipe straight through the center
 */
function _buildQuadrupoleRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], detail: [] };
  const m4 = new THREE.Matrix4();

  const yokeOuter = 0.55;       // half width of the square yoke
  const wall = 0.14;            // yoke slab thickness
  const magL = 0.9;             // length along beam axis

  // --- Painted yoke slabs (accent role) ---
  // Each slab: [x, y, width, height]
  const slabs = [
    [0,  yokeOuter - wall / 2, yokeOuter * 2, wall],   // top
    [0, -yokeOuter + wall / 2, yokeOuter * 2, wall],   // bottom
    [ yokeOuter - wall / 2, 0, wall, yokeOuter * 2],   // right
    [-yokeOuter + wall / 2, 0, wall, yokeOuter * 2],   // left
  ];
  for (const [x, y, w, h] of slabs) {
    const g = new THREE.BoxGeometry(w, h, magL);
    m4.makeTranslation(x, BEAM_HEIGHT + y, 0);
    _pushTransformed(buckets.accent, g, m4);
  }

  // --- Dark iron pole tips (iron role) ---
  // Each pole points inward along (dx, dy). Exactly one of dx/dy is nonzero.
  const poleLen = 0.28;
  const poleHalf = 0.13;
  const poles = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dx, dy] of poles) {
    const g = new THREE.BoxGeometry(
      dx !== 0 ? poleLen : poleHalf * 2,
      dy !== 0 ? poleLen : poleHalf * 2,
      magL * 0.85
    );
    const off = yokeOuter - wall - poleLen / 2;
    m4.makeTranslation(dx * off, BEAM_HEIGHT + dy * off, 0);
    _pushTransformed(buckets.iron, g, m4);
  }

  // --- Copper coils wrapping each pole base (copper role) ---
  // Torus oriented so its hole aligns with the pole axis.
  for (const [dx, dy] of poles) {
    const g = new THREE.TorusGeometry(poleHalf + 0.05, 0.05, 10, 24);
    m4.identity();
    // Rotate torus ring so its axis matches the pole (default is Z-axis).
    if (dx !== 0) {
      // pole axis along X
      m4.makeRotationY(Math.PI / 2);
    } else {
      // pole axis along Y
      m4.makeRotationX(Math.PI / 2);
    }
    const trans = new THREE.Matrix4().makeTranslation(
      dx * (yokeOuter - wall - poleLen / 2 - 0.06),
      BEAM_HEIGHT + dy * (yokeOuter - wall - poleLen / 2 - 0.06),
      0
    );
    const full = new THREE.Matrix4().multiplyMatrices(trans, m4);
    _pushTransformed(buckets.copper, g, full);
  }

  // --- Beam pipe through the center (pipe role) ---
  const pipeL = magL + 0.4; // slightly longer than the magnet to meet neighbors
  const pipeGeom = new THREE.CylinderGeometry(PIPE_R, PIPE_R, pipeL, SEGS);
  m4.identity();
  m4.makeRotationX(Math.PI / 2);
  const pipeT = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
  const pipeFull = new THREE.Matrix4().multiplyMatrices(pipeT, m4);
  _pushTransformed(buckets.pipe, pipeGeom, pipeFull);

  // --- Bolts at yoke corners (detail role, LOD-hidden) ---
  const boltOffsets = [
    [ yokeOuter - 0.05,  yokeOuter - 0.05],
    [-yokeOuter + 0.05,  yokeOuter - 0.05],
    [ yokeOuter - 0.05, -yokeOuter + 0.05],
    [-yokeOuter + 0.05, -yokeOuter + 0.05],
  ];
  for (const [x, y] of boltOffsets) {
    for (const sign of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.05, 0.05, 0.03);
      m4.makeTranslation(x, BEAM_HEIGHT + y, sign * (magL / 2 + 0.015));
      _pushTransformed(buckets.detail, g, m4);
    }
  }

  return buckets;
}

ROLE_BUILDERS.quadrupole = _buildQuadrupoleRoles;
```

- [ ] **Step 2: Verify the template builds without errors**

Reload. In DevTools console:

```js
const mod = await import('/src/renderer3d/component-builder.js')
// Force-create the template by rendering one placed quad.
// (Instantiation happens in Task 9; for now we check the module still loads.)
console.log('ok')
```

Expected: `ok` with no module-load errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/component-builder.js
git commit -m "feat(builder): role-based quadrupole geometry"
```

---

## Task 8: Role-based dipole builder

**Files:**
- Modify: `src/renderer3d/component-builder.js` — add immediately after `_buildQuadrupoleRoles` from Task 7

- [ ] **Step 1: Write the dipole role builder**

Insert:

```js
/**
 * Build the role buckets for a dipole bending magnet.
 *
 * Physical layout (3m x 1.5m x 2m, beam along local +Z):
 *   - H-frame painted iron yoke: top slab, bottom slab, two side posts
 *   - Fixed orange accent stripe along the top edge (iron role, not accent)
 *   - Dark iron pole face visible in the gap between coils
 *   - Two copper coil bundles at the ends of the pole gap
 *   - Row of bolts along the visible yoke edge (detail LOD)
 *   - Straight beam pipe through the gap
 *
 * Note: the actual 90-degree beam bend is handled by the beam graph
 * logic, not this geometry — the model is visually straight.
 */
function _buildDipoleRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], detail: [] };
  const m4 = new THREE.Matrix4();

  const yokeW = 1.4;
  const yokeH = 1.6;
  const yokeL = 2.2;
  const wall = 0.22;

  // --- Painted H-frame slabs (accent role) ---
  const slabs = [
    // [w, h, l, x, y, z]
    [yokeW, wall, yokeL, 0,  yokeH / 2 - wall / 2,  0],  // top
    [yokeW, wall, yokeL, 0, -yokeH / 2 + wall / 2,  0],  // bottom
    [wall, yokeH, yokeL, -yokeW / 2 + wall / 2, 0, 0],   // left post
    [wall, yokeH, yokeL,  yokeW / 2 - wall / 2, 0, 0],   // right post
  ];
  for (const [w, h, l, x, y, z] of slabs) {
    const g = new THREE.BoxGeometry(w, h, l);
    m4.makeTranslation(x, BEAM_HEIGHT + y, z);
    _pushTransformed(buckets.accent, g, m4);
  }

  // --- Fixed contrast stripe (iron role — not recolored) ---
  // We want this to stay visible regardless of the accent paint color,
  // so we bucket it as a dark element rather than accent.
  const stripeGeom = new THREE.BoxGeometry(yokeW + 0.02, 0.08, yokeL * 0.9);
  m4.makeTranslation(0, BEAM_HEIGHT + yokeH / 2 + 0.04, 0);
  _pushTransformed(buckets.iron, stripeGeom, m4);

  // --- Dark iron pole face in the gap ---
  const poleFace = new THREE.BoxGeometry(yokeW - wall * 2 - 0.15, 0.4, yokeL - 0.3);
  m4.makeTranslation(0, BEAM_HEIGHT - 0.2, 0);
  _pushTransformed(buckets.iron, poleFace, m4);

  // --- Copper coil bundles at each end of the pole ---
  for (const sign of [-1, 1]) {
    const g = new THREE.BoxGeometry(yokeW - wall * 2 - 0.05, 0.28, 0.18);
    m4.makeTranslation(0, BEAM_HEIGHT + 0.1, sign * (yokeL / 2 - 0.09));
    _pushTransformed(buckets.copper, g, m4);
  }

  // --- Straight beam pipe through the gap ---
  const pipeL = yokeL + 0.6;
  const pipeGeom = new THREE.CylinderGeometry(PIPE_R, PIPE_R, pipeL, SEGS);
  const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
  const full = new THREE.Matrix4().multiplyMatrices(trans, rot);
  _pushTransformed(buckets.pipe, pipeGeom, full);

  // --- Bolts along the visible upper yoke edge (detail LOD) ---
  for (let i = -2; i <= 2; i++) {
    const g = new THREE.BoxGeometry(0.07, 0.07, 0.04);
    m4.makeTranslation(
      yokeW / 2 + 0.012,
      BEAM_HEIGHT + yokeH / 2 - wall - 0.08,
      i * 0.45
    );
    _pushTransformed(buckets.detail, g, m4);
  }

  return buckets;
}

ROLE_BUILDERS.dipole = _buildDipoleRoles;
```

- [ ] **Step 2: Verify module loads**

Reload. Game should still render. Placed dipoles still show the old fallback geometry (wiring happens in Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/component-builder.js
git commit -m "feat(builder): role-based dipole geometry"
```

---

## Task 9: Route placements through the role template path

**Files:**
- Modify: `src/renderer3d/component-builder.js:481-506` — update `_createObject` to prefer role builders, and `build()` around line 532 to pass accent color

- [ ] **Step 1: Make `_createObject` accept an accent color and prefer role builders**

Replace the body of `_createObject(compDef)` with:

```js
  /**
   * Create the 3D object (Group or Mesh) for a given component type.
   * Wraps in a group with an invisible hitbox for easier click detection.
   *
   * Prefers the role-based template path if a builder is registered; falls
   * back to the legacy DETAIL_BUILDERS (source/drift/pillbox); finally
   * falls back to a generic fallback mesh.
   */
  _createObject(compDef, accentColorHex = 0xc62828) {
    const compType = compDef.id;
    let visual = null;

    if (ROLE_BUILDERS[compType]) {
      visual = _instantiateRoleTemplate(compType, accentColorHex);
    }

    if (!visual) {
      const legacyBuilder = DETAIL_BUILDERS[compType];
      if (legacyBuilder) {
        visual = legacyBuilder();
      } else {
        visual = this._createFallbackMesh(compDef);
      }
    }

    // Wrap with invisible hitbox for easier raycasting
    const wrapper = new THREE.Group();
    wrapper.add(visual);

    const w = (compDef.subW || 2) * SUB_UNIT;
    const h = Math.max((compDef.subH || 2) * SUB_UNIT, 1.0);
    const l = (compDef.subL || 2) * SUB_UNIT;
    const hitGeo = new THREE.BoxGeometry(Math.max(w, 0.8), h, Math.max(l, 0.8));
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitbox = new THREE.Mesh(hitGeo, hitMat);
    hitbox.position.y = BEAM_HEIGHT;
    wrapper.add(hitbox);

    return wrapper;
  }
```

- [ ] **Step 2: Pass the accent color through `build()`**

In the `build(componentData, parentGroup)` method around line 540, find the block:

```js
      if (!this._meshMap.has(id)) {
        const obj = this._createObject(compDef);
        obj.matrixAutoUpdate = false;
        this._meshMap.set(id, obj);
        parentGroup.add(obj);
      }
```

Replace with:

```js
      if (!this._meshMap.has(id)) {
        const accent = comp.accentColor ?? 0xc62828;
        const obj = this._createObject(compDef, accent);
        obj.matrixAutoUpdate = false;
        obj.userData.beamlineId = comp.beamlineId || null;
        this._meshMap.set(id, obj);
        parentGroup.add(obj);
      }
```

Also update the debug log on line ~528 — it's fine to leave as-is but remove the now-misleading fallback log lines in `_createObject` if they're noisy. (Optional cleanup: delete the `console.log` lines at lines 485 and 488.)

- [ ] **Step 3: Verify in browser**

Reload the page. Place a quadrupole on a beamline (or check an existing one).

Expected:
- The quadrupole shows the new hybrid geometry: square yoke in the beamline's accent color (default: APS red for the first beamline), visible copper rings, dark pole tips, beam pipe through the center
- At zoom >= 2.0, bolts appear at the corners
- At zoom < 2.0, bolts disappear (LOD)
- Place a dipole — it shows the H-frame with painted slabs, copper bundles at the ends, dark iron pole face

If the component looks wrong (e.g., misplaced, floating), open DevTools and check for `undefined` warnings from the merge helper — most likely cause is a geometry without normals.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/component-builder.js
git commit -m "feat(builder): route quad and dipole through role template path"
```

---

## Task 10: Fix thumbnail lighting to match game view

**Files:**
- Modify: `src/renderer3d/component-builder.js:387-437` — update `renderComponentThumbnail()`

- [ ] **Step 1: Update the thumbnail renderer**

Replace the body of `renderComponentThumbnail(compType, size = 64)` with:

```js
export function renderComponentThumbnail(compType, size = 64) {
  if (typeof THREE === 'undefined') return null;
  if (_thumbCache.has(compType)) return _thumbCache.get(compType);

  const compDef = COMPONENTS[compType];
  if (!compDef) return null;

  // Prefer role builders (template-based); fall back to legacy detail builders.
  const hasRole = !!ROLE_BUILDERS[compDef.id || compType];
  const legacyBuilder = DETAIL_BUILDERS[compDef.id || compType];
  if (!hasRole && !legacyBuilder) return null;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size * 2, size * 2);

  const scene = new THREE.Scene();

  // Match game lighting: warm ambient, cool-key sun from upper-left-back,
  // cool fill from front-right, plus a neutral floor so GI bounces aren't
  // pure black.
  scene.add(new THREE.AmbientLight(0xfff5e6, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(-6, 10, -4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.25);
  fill.position.set(6, 4, 6);
  scene.add(fill);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshStandardMaterial({ color: 0x262a48, roughness: 0.9, metalness: 0.0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Build the model. Role-based builders get the default APS-red accent;
  // legacy builders return their own fully assembled group.
  const defaultAccent = 0xc62828;
  let model;
  if (hasRole) {
    model = _instantiateRoleTemplate(compDef.id || compType, defaultAccent);
  } else {
    model = legacyBuilder();
  }
  scene.add(model);

  // Frame the camera around the model's bounding box.
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const bSize = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(bSize.x, bSize.y, bSize.z);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  const dist = maxDim * 2.2;
  camera.position.set(
    center.x + dist * 0.7,
    center.y + dist * 0.6,
    center.z + dist * 0.7,
  );
  camera.lookAt(center);

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  _thumbCache.set(compType, dataUrl);

  // Clean up — note we do NOT dispose template geometries (they're cached).
  // We only dispose the per-thumbnail materials we created (floor).
  floor.geometry.dispose();
  floor.material.dispose();
  renderer.dispose();

  return dataUrl;
}
```

- [ ] **Step 2: Verify in browser**

Reload. Open the component placement palette (click Beamline tab in the bottom HUD). Find the Quadrupole and Dipole cards.

Expected:
- Thumbnails are noticeably brighter than before
- Quadrupole thumbnail shows the red-painted yoke, copper rings, dark poles
- Dipole thumbnail shows the red H-frame with copper coils
- The thumbnail palette color matches the placed in-game model's color (both APS red)

If the thumbnail is still dark, the browser may be caching the data URL from before the fix. Clear `_thumbCache` via DevTools:

```js
location.reload()  // the cache is module-local and resets on reload
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/component-builder.js
git commit -m "fix(builder): thumbnail lighting matches game view"
```

---

## Task 11: `ThreeRenderer.updateBeamlineAccent()` live recolor

**Files:**
- Modify: `src/renderer3d/ThreeRenderer.js` — add a new method, location up to you (near other component-related helpers)
- Modify: `src/renderer3d/component-builder.js` — expose `getAccentMaterial` so the renderer can reuse the cache

- [ ] **Step 1: Export `getAccentMaterial` from component-builder**

Find the `getAccentMaterial` function (from Task 5). Change its declaration from `function getAccentMaterial` to `export function getAccentMaterial`.

- [ ] **Step 2: Import it in `ThreeRenderer.js`**

In `src/renderer3d/ThreeRenderer.js`, find the existing import for `component-builder.js`. Add `getAccentMaterial` to that import (or add a new import line if there isn't one for direct function imports).

Search for:
```js
import { ComponentBuilder } from './component-builder.js';
```

Replace with:
```js
import { ComponentBuilder, getAccentMaterial } from './component-builder.js';
```

If the existing import is named differently, add the named import alongside it.

- [ ] **Step 3: Add `updateBeamlineAccent` method on `ThreeRenderer`**

Add this method to the `ThreeRenderer` class, placed near the other `_refreshX` methods (around line 1760):

```js
  /**
   * Swap the accent material on every placed component belonging to the
   * given beamline. O(N) in placements on that beamline; O(1) new materials.
   *
   * @param {string} beamlineId
   * @param {number} colorHex  24-bit color integer
   */
  updateBeamlineAccent(beamlineId, colorHex) {
    if (!this.componentBuilder || !this.componentBuilder._meshMap) return;
    for (const wrapper of this.componentBuilder._meshMap.values()) {
      if (wrapper.userData.beamlineId !== beamlineId) continue;
      const compType = wrapper.userData.compType;
      if (!compType) continue;
      // Walk the wrapper (Group -> visual Group -> role meshes) and swap
      // the material on any mesh tagged with userData.role === 'accent'.
      wrapper.traverse((child) => {
        if (child.isMesh && child.userData.role === 'accent') {
          child.material = getAccentMaterial(compType, colorHex);
        }
      });
    }
  }
```

- [ ] **Step 4: Track `compType` on the wrapper at creation**

Back in `src/renderer3d/component-builder.js`, in the `build()` method's mesh-creation block (modified in Task 9), add one more line so the wrapper remembers its component type:

Find:
```js
        obj.userData.beamlineId = comp.beamlineId || null;
```

Replace with:
```js
        obj.userData.beamlineId = comp.beamlineId || null;
        obj.userData.compType = type;
```

- [ ] **Step 5: Verify in browser**

Reload. In DevTools console, assuming you have at least one placed magnet on beamline `bl-1`:

```js
game.renderer.updateBeamlineAccent('bl-1', 0x2e7d32)  // CERN green
```

Expected: all magnets on beamline 1 instantly recolor to green, no geometry rebuild, no flicker. Call it again with different hex values to confirm.

- [ ] **Step 6: Commit**

```bash
git add src/renderer3d/component-builder.js src/renderer3d/ThreeRenderer.js
git commit -m "feat(renderer): live per-beamline accent recolor"
```

---

## Task 12: Accent color picker in `BeamlineWindow` settings tab

**Files:**
- Modify: `src/ui/BeamlineWindow.js:282-302` — extend `_renderSettings`
- Modify: `src/ui/BeamlineWindow.js:1` — add imports

- [ ] **Step 1: Import the palette at the top of the file**

Find the existing imports at the top of `src/ui/BeamlineWindow.js` and add:

```js
import { CANONICAL_ACCENTS } from '../beamline/accent-colors.js';
```

- [ ] **Step 2: Render the swatch row in `_renderSettings`**

Replace the `_renderSettings(el)` body with:

```js
  _renderSettings(el) {
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { el.innerHTML = '<div class="ctx-empty">Beamline not found.</div>'; return; }
    const bs = entry.beamState;
    const nodeCount = entry.beamline.getAllNodes().length;
    const statusColor = entry.status === 'running' ? '#44dd66'
      : entry.status === 'faulted' ? '#ff4444'
      : '#8888aa';

    const swatchHtml = CANONICAL_ACCENTS.map((sw, i) => {
      const hexStr = '#' + sw.hex.toString(16).padStart(6, '0');
      const selected = entry.accentColor === sw.hex ? ' selected' : '';
      return `<button class="beamline-accent-swatch${selected}" data-hex="${sw.hex}" title="${sw.name}" style="background:${hexStr}"></button>`;
    }).join('');

    const currentHex = '#' + (entry.accentColor || 0xc62828).toString(16).padStart(6, '0');

    el.innerHTML = `
      <div class="ctx-section-label">Configuration</div>
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><div class="ctx-stat-label">Machine Type</div><div class="ctx-stat-val neutral">${bs.machineType || '--'}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Status</div><div class="ctx-stat-val" style="color:${statusColor}">${entry.status ? entry.status.toUpperCase() : '--'}</div></div>
      </div>
      <div class="ctx-section-label">Accent Color</div>
      <div class="beamline-accent-row">
        ${swatchHtml}
        <label class="beamline-accent-custom" title="Custom color">
          <input type="color" value="${currentHex}" data-role="accent-custom">
          <span>+</span>
        </label>
      </div>
      <div class="ctx-section-label">Layout</div>
      <div class="ctx-stats-grid three-col">
        <div class="ctx-stat"><div class="ctx-stat-label">Components</div><div class="ctx-stat-val neutral">${nodeCount}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Sources</div><div class="ctx-stat-val neutral">${entry.beamline.getAllNodes().filter(n => COMPONENTS[n.type]?.isSource).length}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Tiles</div><div class="ctx-stat-val neutral">${entry.beamline.getAllNodes().reduce((s, n) => s + (n.tiles ? n.tiles.length : 0), 0)}</div></div>
      </div>
    `;

    // Wire up swatch clicks and custom picker.
    const applyAccent = (hex) => {
      entry.accentColor = hex;
      if (this.game.renderer && typeof this.game.renderer.updateBeamlineAccent === 'function') {
        this.game.renderer.updateBeamlineAccent(this.beamlineId, hex);
      }
      // Re-render to update the "selected" outline.
      this._renderSettings(el);
    };

    el.querySelectorAll('.beamline-accent-swatch').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const hex = parseInt(btn.dataset.hex, 10);
        if (!Number.isNaN(hex)) applyAccent(hex);
      });
    });

    const customInput = el.querySelector('input[data-role="accent-custom"]');
    if (customInput) {
      customInput.addEventListener('input', (e) => {
        // e.target.value is "#rrggbb"
        const hex = parseInt(e.target.value.slice(1), 16);
        if (!Number.isNaN(hex)) applyAccent(hex);
      });
    }
  }
```

- [ ] **Step 3: Verify in browser**

Reload. Open a beamline window (click a beamline in the list). Click the "Settings" tab.

Expected:
- An "Accent Color" section appears with 8 colored swatches in a row, followed by a "+" custom-color button
- The swatch matching the current accent has a visible outline (you'll add the CSS in Task 13 — for now the outline may be missing, but clicks should still work)
- Clicking a different swatch immediately recolors every magnet on that beamline
- Clicking the "+" opens the system color picker; picking a color recolors live as you drag

- [ ] **Step 4: Commit**

```bash
git add src/ui/BeamlineWindow.js
git commit -m "feat(ui): accent color picker in beamline settings"
```

---

## Task 13: CSS for the accent swatch row

**Files:**
- Modify: `style.css` — add a new block at the end of the file

- [ ] **Step 1: Add styles**

Append to `style.css`:

```css
/* === Beamline accent color picker === */
.beamline-accent-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0 10px;
  flex-wrap: wrap;
}

.beamline-accent-swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
  cursor: pointer;
  padding: 0;
  transition: transform 0.1s, box-shadow 0.1s;
}

.beamline-accent-swatch:hover {
  transform: scale(1.1);
}

.beamline-accent-swatch.selected {
  box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgba(0, 0, 0, 0.6);
}

.beamline-accent-custom {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px dashed rgba(255, 255, 255, 0.4);
  cursor: pointer;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  line-height: 1;
  position: relative;
  overflow: hidden;
}

.beamline-accent-custom input[type="color"] {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
```

- [ ] **Step 2: Verify in browser**

Reload. Open the BeamlineWindow Settings tab. The swatches should be circles, the selected one has a white ring, the custom button has a dashed border with a "+" inside.

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "style: accent swatch row for beamline settings"
```

---

## Task 14: Full integration pass

**Files:** none modified — this task is pure manual verification

- [ ] **Step 1: Fresh-reload sanity check**

Fully reload the dev server (`Ctrl+C` then `npm run dev`) to clear all caches. Reload the browser with cache disabled (DevTools Network tab → Disable cache on).

- [ ] **Step 2: Single-beamline end-to-end**

1. Start a fresh game or load an existing save.
2. Create a new beamline.
3. Place a source, a drift pipe, a quadrupole, a dipole, and another quadrupole along the beam path.
4. Confirm the quadrupole and dipole render with the hybrid style (painted yoke in APS red for beamline 1), visible copper, dark poles.
5. Zoom out below 2.0 — bolts disappear.
6. Zoom back in — bolts reappear.
7. Open the BeamlineWindow, Settings tab.
8. Click through all 8 preset swatches — each magnet recolors instantly.
9. Click the custom picker, drag to pick a magenta — magnets recolor live.

- [ ] **Step 3: Multi-beamline independence**

1. Create a second beamline.
2. Confirm the new beamline defaults to Fermilab Blue (second canonical swatch).
3. Place a quadrupole on beamline 2.
4. Confirm it is blue while beamline 1's quads remain the color you left them at.
5. Switch colors on beamline 2 — beamline 1's magnets should not change.

- [ ] **Step 4: Thumbnail parity**

1. Open the placement palette (Beamline tab in the bottom HUD).
2. Visually compare the Quadrupole thumbnail to a placed quadrupole in the game view under normal lighting. They should look like they belong in the same world (matching brightness, matching color).
3. Same for Dipole.

- [ ] **Step 5: Performance spot-check**

1. Place 50-100 quadrupoles in a grid (use the designer or the `placeComponent` debug API).
2. Open DevTools → Performance → record a short session while panning the camera.
3. Confirm frame time is within a reasonable envelope (rough target: under 16ms for 100 quads at 1x zoom; no hard assertion, just eyeball).
4. In the rendering info panel (if available via DevTools) confirm draw calls are bounded — at 100 quads you should see ~500 draw calls from the component group, not 2500.

If the frame time regresses significantly, check:
- Material sharing is working: in console, `game.renderer.componentBuilder._meshMap.size` should equal the placed component count; materials should be repeated across meshes.
- The LOD system is hiding details at low zoom.

- [ ] **Step 6: Commit nothing**

No code changes in this task. If you found bugs, create a follow-up commit per bug with a clear message. Do not amend earlier task commits.

---

## Self-review checklist (for the implementer before marking this plan done)

- [ ] Every task's "Verify" step passed
- [ ] No `TODO`, `FIXME`, or commented-out code introduced
- [ ] Every new function has a JSDoc header explaining parameters and return shape (short is fine)
- [ ] The existing source/drift/pillbox builders still work (they were untouched by design)
- [ ] At least one beamline was tested with a custom (non-preset) color
- [ ] The implementer did not invoke worktrees, did not push to a remote, and did not amend any commits
