# Detailed 3D Magnet Models + Per-Beamline Accent Color

**Date:** 2026-04-10
**Scope:** Dipole + Quadrupole 3D models, per-beamline accent color system, performance-conscious builder refactor, thumbnail lighting parity.

## Goal

Replace the generic fallback geometry for `dipole` and `quadrupole` with hybrid-style 3D models that read as accelerator magnets at a glance and can be individually recolored per beamline. Establish the pattern (templates, material roles, merged geometry) so the rest of the beamline catalog can adopt it incrementally.

## Non-goals

- Pixel textures on large faces. The geometry will expose large flat faces ready for textures, but the texture authoring pipeline is a follow-up.
- Other component types (solenoid, sextupole, RF cavities, diagnostics). Only dipole and quadrupole in this pass.
- `InstancedMesh` rewrite. Template-and-tint pattern in this spec, instancing is a future optimization if draw calls become a problem.
- Refactor of the existing `source`, `drift`, `pillboxCavity` builders to the new pattern. Those keep working as-is; new builders follow the new pattern.

## Visual style (style "C" from brainstorm)

Accurate physical silhouettes painted in bright real-world lab colors, with visible copper coils, dark iron pole faces, and chunky bolts on the painted yoke.

**Quadrupole (1 m × 1 m × 1.5 m, 2×2 footprint, `placement: 'attachment'`):**
- 4 painted iron yoke slabs forming a square frame around the beam axis.
- 4 dark iron pole tips pointing inward toward the beam pipe.
- 4 copper coil torus rings wrapped around the pole bases.
- Chunky bolt heads at each yoke corner, on both front and back faces. Bolts tagged `userData.lod='detail'`.
- Beam pipe passes through the center along the component's local Z axis.

**Dipole (3 m × 1.5 m × 2 m, 3×6 footprint, `isDipole: true`, 90° bend):**
- H-frame iron yoke: painted top slab, bottom slab, two painted side posts.
- Thin orange (or accent-contrasting) stripe along the top edge as a visual marker.
- Dark iron pole face visible in the gap between yoke and coils.
- Two rectangular copper coil bundles at the front and back of the pole (top and bottom of gap).
- Row of chunky bolts along the visible upper yoke edge.
- Straight beam pipe through the gap for this iteration; the actual 90° curvature of the beam path is handled by the existing bend logic and is out of scope for the model geometry.

**Shared geometry constants** (reused from `component-builder.js:13-19`): `BEAM_HEIGHT`, `PIPE_R`, `FLANGE_R`, `FLANGE_H`, `PIPE_COLOR`, `FLANGE_COLOR`, `STAND_COLOR`.

## Accent color system

### Data model

Add `accentColor` (hex integer) to each entry in `BeamlineRegistry`:

```js
// src/beamline/BeamlineRegistry.js
createBeamline(machineType) {
  // ...
  const accentColor = CANONICAL_ACCENTS[this.nextBeamlineId % CANONICAL_ACCENTS.length];
  const entry = {
    id,
    name,
    accentColor,
    status: 'stopped',
    beamline: new Beamline(),
    beamState: makeDefaultBeamState(machineType),
  };
  // ...
}
```

New entries get the next canonical swatch in rotation, so a player who creates three beamlines without thinking about color gets three visually distinct ones (red, blue, gold).

### The 8 canonical swatches

Defined in a new module `src/beamline/accent-colors.js`:

```js
export const CANONICAL_ACCENTS = [
  { name: 'APS Red',        hex: 0xc62828 },
  { name: 'Fermilab Blue',  hex: 0x1e4a9e },
  { name: 'SLAC Gold',      hex: 0xe8a417 },
  { name: 'CERN Green',     hex: 0x2e7d32 },
  { name: 'JLab Violet',    hex: 0x6a3d9a },
  { name: 'KEK Orange',     hex: 0xe65100 },
  { name: 'DESY Teal',      hex: 0x00838f },
  { name: 'BNL Graphite',   hex: 0x37474f },
];
```

### Picker UI

Add a color row to `BeamlineWindow` (`src/ui/BeamlineWindow.js`), placed under the beamline name:

- 8 circular swatches, 20 px diameter, outlined when selected.
- One "custom" button to the right of the swatches. Clicking opens a hidden `<input type="color">` bound to `entry.accentColor`.
- Clicking any swatch or picking a custom color immediately sets `entry.accentColor` and calls a new `ThreeRenderer.updateBeamlineAccent(beamlineId, hex)` which updates the accent material for all placed components belonging to that beamline.

Custom colors persist on the beamline entry exactly like a preset — no distinction between "custom" and "preset" at the data layer.

### What gets tinted

Only the "painted metal" role (see Material roles below). Un-tinted: vacuum pipe (stainless), copper coils (copper), supports (dark gray), dark iron pole faces, bolts.

In this iteration only dipole and quadrupole have a painted role. When future components add their own painted parts (RF cavities, chamber housings), they inherit the same accent system automatically by assigning their painted meshes to the `accent` role.

## Performance architecture — template-and-tint

### Material roles

Every detailed builder groups its meshes into exactly one of six roles:

| Role | Material | Shared? | Notes |
|------|----------|---------|-------|
| `accent`  | painted metal | per-color, cached | this is the only recolored role |
| `iron`    | dark iron     | single shared instance | pole faces, un-painted iron |
| `copper`  | oxidized copper | single shared instance | all coils |
| `pipe`    | stainless     | single shared instance | vacuum beam pipe |
| `stand`   | dark gray     | single shared instance | supports, foot plates |
| `detail`  | context-dependent | shared per sub-type | bolts, small rings; `userData.lod='detail'` |

### Templates

For each component type with a detail builder, build a template ONCE at module load (first access, lazily cached). A template is a `THREE.Group` containing one merged mesh per role, where the accent mesh has a placeholder material that is replaced per placement.

**Merge helper.** `BufferGeometryUtils` isn't loaded in `index.html` today (only the three.js core build is). Rather than pulling in another CDN script, add a small local helper in `component-builder.js` that merges a list of `BufferGeometry` into one. It only needs to handle non-indexed geometries with `position` and `normal` attributes — which is all the primitives we use (Box, Cylinder, Torus, Plane). ~30 lines. Each input geometry gets its world-space transform baked in via `.applyMatrix4()` before collection, so the merge is a straight concatenation of attribute arrays.

```js
// sketch
const _templates = new Map(); // compType -> { accent: Mesh, iron: Mesh, ... }

function getTemplate(compType) {
  if (_templates.has(compType)) return _templates.get(compType);
  const parts = DETAIL_BUILDERS[compType]();   // returns { accent: [geoms], iron: [geoms], ... }
  const template = {};
  for (const [role, geoms] of Object.entries(parts)) {
    const merged = BufferGeometryUtils.mergeGeometries(geoms);
    template[role] = new THREE.Mesh(merged, SHARED_MATERIALS[role]);
    template[role].userData.role = role;
    if (role === 'detail') template[role].userData.lod = 'detail';
  }
  _templates.set(compType, template);
  return template;
}
```

**Builder signature change:** detail builders now return `{ accent: [BufferGeometry...], iron: [...], copper: [...], pipe: [...], stand: [...], detail: [...] }` instead of a fully assembled `THREE.Group`. Individual pieces get built, positioned, and baked into a BufferGeometry via `.applyMatrix4()` on their transform before being collected into their role bucket. This is what lets the merge step collapse them.

### Per-placement instantiation

When a placement is created:

```js
function instantiate(compType, accentColorHex) {
  const template = getTemplate(compType);
  const group = new THREE.Group();
  for (const [role, templateMesh] of Object.entries(template)) {
    const mesh = new THREE.Mesh(
      templateMesh.geometry,                      // SHARED geometry
      role === 'accent'
        ? getAccentMaterial(compType, accentColorHex)  // cached per (type, color)
        : SHARED_MATERIALS[role],
    );
    mesh.userData.role = role;
    if (role === 'detail') {
      mesh.userData.lod = 'detail';
      mesh.castShadow = false;
    } else {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    group.add(mesh);
  }
  return group;
}
```

The accent material cache is keyed by `(compType, colorHex)`, so all placements of "quadrupoles on the APS-red beamline" share one material instance. Changing a beamline's color swaps the accent material on all its placements.

### Live recolor path

`ThreeRenderer.updateBeamlineAccent(beamlineId, hexColor)`:

1. Look up all `placeable.meshWrapper` objects for placements owned by `beamlineId`.
2. For each, find the child mesh with `userData.role === 'accent'` and replace its `.material` with `getAccentMaterial(compType, hexColor)`.
3. No geometry changes — O(N) in placements on that beamline, O(1) materials created if the color is new.

### Draw-call budget (sanity check)

For a beamline with 100 quads + 20 dipoles, all on one accent color:
- 100 quads × 5 roles (accent, iron, copper, pipe, detail) = 500 draw calls
- 20 dipoles × 5 roles = 100 draw calls
- Materials: 10 total (2 types × 5 roles)

For three beamlines each with a different accent, the accent row becomes 3× unique materials but geometry is still shared, so it's still ~600 draw calls total.

At 500-1000 draw calls for components, the renderer has headroom for infrastructure, terrain, and UI.

### What we defer

- **True instancing (`InstancedMesh`)**: bigger win, more complexity (custom hitbox handling, per-instance attributes for tinting). Revisit if draw calls climb past ~3000.
- **Merge across different component types of the same role** (e.g. one giant "all pipes" mesh): complicates per-component operations like dimming/deletion.
- **Vertex-color-based tinting within a single shared accent material**: saves material switches but adds per-geometry baking work and obscures the simple color-per-beamline mental model.

## Thumbnail lighting fix

Update `renderComponentThumbnail()` in `component-builder.js:387` so previews match the game view:

1. Ambient light: `0xfff5e6 @ 0.55` (was `0xffffff @ 0.6`).
2. Directional sun: position `(-6, 10, -4)`, intensity `0.9` (was `(3, 5, 2)` @ `0.8`).
3. Add a cool fill `DirectionalLight(0x88aaff, 0.25)` at position `(6, 4, 6)`.
4. Add a large neutral floor plane at y=0, color `0x262a48`, so GI bounces aren't pure black behind the model.
5. Accent color for the thumbnail defaults to the first canonical swatch (APS Red).

This is the exact lighting rig used in the browser preview shared during brainstorm.

## Files touched

- `src/renderer3d/component-builder.js` — new builder pattern, template/instantiate helpers, new `_buildDipole()` and `_buildQuadrupole()` functions, updated `renderComponentThumbnail()` lighting. This file is already ~600 lines; if the new code pushes it over ~850, split `template-registry.js` out.
- `src/beamline/accent-colors.js` — new, ~20 lines. Exports `CANONICAL_ACCENTS`.
- `src/beamline/BeamlineRegistry.js` — add `accentColor` to entry, auto-rotate through canonical list on create.
- `src/ui/BeamlineWindow.js` — accent swatch row + custom picker.
- `src/renderer3d/ThreeRenderer.js` — new `updateBeamlineAccent()` method; pass beamline accent color when instantiating a placed component's mesh. Look up the owning beamline via `registry.getBeamlineForNode()` or the existing beam graph mapping.
- `style.css` — small block for `.beamline-accent-swatch` / picker row (~20 lines).

## Testing

**Unit-level (pure JS, can run in node):**
- `accent-colors.js` exports exactly 8 entries, all hex integers in valid range.
- `BeamlineRegistry.createBeamline()` assigns distinct colors in rotation for the first 8 beamlines.

**Integration-level (manual, browser):**
- Place a quadrupole and a dipole on a fresh beamline. Confirm they render as the hybrid style and the accent matches the beamline's assigned default swatch.
- Open the BeamlineWindow, click a different preset swatch. All magnets on that beamline recolor immediately, no flicker, no geometry rebuild.
- Pick a custom color. Same result.
- Create a second beamline, place magnets on it. The second beamline has a different default color and its magnets are tinted independently from the first.
- Compare thumbnail in the placement palette to the placed magnet in the game view. Lighting and color should match visibly.
- Zoom out below 2.0 — bolts and small detail geometry disappear (LOD still works).
- Stress test: place 100 quads + 20 dipoles across 3 beamlines. Frame time stays within current envelope (eyeball test; if noticeable drop, check draw-call count in dev tools and confirm material sharing is working).

**What we can't easily automate:** visual comparison of the styles, color accuracy on different monitors, subjective "does this read as a magnet at a glance". These rely on eyeball checks during manual testing.

## Open questions (to resolve during implementation)

- Exact torus segment counts for copper coils — start at `(10 tube, 20 radial)` for quads and adjust based on visible tessellation at 1× zoom.
- Whether the orange stripe on the dipole should *also* change with the accent color, or stay a fixed contrast accent. Default to fixed for now; revisit if it looks wrong against non-blue accents.
- Whether `BeamlineWindow` is the right surface for the color picker, or whether the designer window should also expose it. Start with `BeamlineWindow` only; add elsewhere if it turns out users want to recolor from the designer.
