# Three.js 3D World Renderer — Design Spec

**Date:** 2026-04-09
**Scope:** Replace PixiJS world rendering with Three.js 3D geometry + PixelLab textures. Keep all HTML DOM UI, Beamline Designer, and HUD unchanged.

## Motivation

The current PixiJS renderer fakes 3D with isometric math and manual face-darkening across ~9,400 lines of tightly coupled code. This approach cannot support:

- Consistent depth sorting without hacks (z-index per layer + sortableChildren)
- Object stacking (placing items on desks, equipment on shelves)
- Multiple floors / underground levels
- Dynamic lighting and shadows
- Generating isometric pixel art consistently at different sizes and orientations via PixelLab

By using true 3D geometry with an orthographic camera, the z-buffer handles depth sorting automatically, lighting/shadows are real, stacking is just Y-axis positioning, and PixelLab only needs to generate flat 2D textures (which it does reliably) rather than isometric sprites (which it cannot do consistently).

## Architecture

### Rendering Stack (bottom to top)

Three layered rendering surfaces:

1. **Three.js Canvas** (z-index: 10) — Full 3D world: terrain, infrastructure, walls, doors, zones, beamline components, facility equipment, decorations, connections, beam paths. OrthographicCamera at isometric angle. DirectionalLight for shadows + AmbientLight for fill.

2. **PixiJS Canvas** (z-index: 20, transparent background) — 2D overlays: grid lines, text labels, placement cursors/previews, selection highlights, beam glow effects. Viewport synced to Three.js camera.

3. **HTML DOM** (z-index: 30) — All UI panels: HUD, palettes, component popup, tech tree, goals, designer window, warnings, menus. Unchanged from current implementation.

### Why Layered Canvases (Not Shared WebGL Context)

PixiJS 8 documents a shared WebGL context approach, but layered canvases are better for this case:

- The PixiJS overlay is lightweight 2D (labels, cursors, grid) — doesn't need pixel-perfect blending with 3D
- Shared context requires careful state management between two engines — fragile and hard to debug
- Layered canvases allow independent development and debugging of each layer
- Camera sync is trivial for orthographic projection (simple scale + translate)
- Makes it easy to eventually drop the PixiJS layer entirely if desired

### Camera Setup

Three.js `OrthographicCamera` positioned for true isometric view:
- Camera rotation: `(Math.atan(Math.sin(Math.atan(1))), Math.PI / 4, 0)` with Euler order `'YXZ'` — this produces the standard isometric projection where X and Z axes are equally foreshortened.
- The current `gridToIso()` formula `{ x: (col - row) * 32, y: (col + row) * 16 }` maps to this 3D projection: grid column = +X axis, grid row = +Z axis, height = +Y axis.
- Orthographic frustum sized to match current zoom levels (0.2x–5x range).

**Coordinate mapping:** Three.js world position (wx, wy, wz) maps to grid position as: col = wx, row = wz, height = wy. Sub-units: 1 sub-unit = 0.5 world units. A tile = 4 sub-units = 2 world units.

The PixiJS overlay canvas syncs its viewport by projecting 3D world positions through the camera's projection matrix to get 2D screen coordinates for labels, cursors, etc. Since the projection is orthographic, this is a linear transform (scale + translate).

Pan via WASD/arrow keys/mouse drag. Zoom via mouse wheel toward cursor. Same controls as current implementation.

## Texture Pipeline

### PixelLab → Three.js Material Flow

1. Generate flat 2D texture in PixelLab (e.g., "steel panel", "magnet coil face", "quadrupole top view")
2. Save as PNG in `assets/textures/`
3. Load as `THREE.Texture` with `NearestFilter` (magFilter and minFilter) for crisp pixel art
4. Create `MeshStandardMaterial({ map: texture })` for lit surfaces that receive shadows
5. Apply to `BoxGeometry` / `CylinderGeometry` / composite shape
6. Per-face UV mapping: different texture for top vs front vs side where needed

### Existing Textures

All current PNGs carry over directly — they just load as `THREE.Texture` instead of `PIXI.Texture`:

- `assets/tiles/` — floor/infrastructure tile textures, loaded via existing tile-manifest.json
- `assets/decorations/` — decoration sprites
- Variant selection (deterministic per-tile hash) and tinting work the same way

### Per-Face Texture Assignment

Each component type defines a texture map:

```
{
  top:    "quadrupole-top.png",     // bird's eye view of magnet poles
  front:  "quadrupole-front.png",   // coil windings visible
  side:   "quadrupole-side.png",    // iron yoke cross-section
  back:   null,                     // reuse front (symmetric)
  bottom: null                      // not visible in isometric, skip
}
```

Simple objects (beam pipe, floor tile, wall) use a single tinted material or 1-2 textures. Complex objects (dipole, cryomodule) use up to 3 unique face textures. Bottom face is never visible in isometric view — always skipped.

### Pixel Art Settings

- `texture.magFilter = THREE.NearestFilter` — no smoothing on upscale
- `texture.minFilter = THREE.NearestFilter` — no smoothing on downscale
- `material.alphaTest = 0.5` — hard-edge transparency for cutouts, avoids sort issues
- `renderer.setPixelRatio(1)` — no DPI scaling artifacts

## Object Geometry System

### Dimensions: subL, subW, subH

Every placeable object defines its 3D dimensions. `subL` (length along beam or primary axis) and `subW` (width) already exist. `subH` (height) is added. All measured in sub-units where 1 sub-unit = 0.5m.

**subH values by object category:**

| Category | Examples | subH Range | Notes |
|---|---|---|---|
| Beamline components | Beam pipe, quad, dipole, cavity | 2-6 | Reflects real proportions — pipe is short, cryomodule is tall |
| Infrastructure floors | Concrete, lab floor, clean room | 0 | Flat plane at Y=0, zero height — objects sit directly on ground |
| Walls | Standard wall | 6-8 | ~3-4m tall, matching real room height |
| Doors | Standard door | 5-6 | Opening height + lintel |
| Facility equipment | Racks, pumps, cryo units, desks | 2-6 | Desk ~2 (1m), rack ~5 (2.5m) |
| Zone furnishings | Chairs, monitors, small items | 1-3 | Sub-tile items on the grid |
| Decorations | Trees, benches, fountains | 2-16 | Bench ~2, tree ~12+ |

### Geometry Types

Each object specifies a `geometryType`:

- **box** — Default. Most infrastructure, furniture, rectangular components. Uses `BoxGeometry`.
- **cylinder** — Beam pipes, magnets with circular cross-section, tanks. Uses `CylinderGeometry`.
- **composite** — Multiple primitives combined with relative positions. Dipole C-magnet = 3 boxes. Door frame = 3 boxes. Tree = cylinder trunk + cone/sphere canopy. Defined as an array of sub-shapes.

No custom mesh files or .glb imports. Everything built from Three.js primitives. This keeps the asset pipeline simple — PixelLab generates flat textures only.

### Object Stacking

Every 3D object exposes a `surfaceHeight` = position.Y + (subH * 0.5m). When placing an object "on" another:

1. Query what's at the target (col, row, subCol, subRow) position
2. Get the highest object's surfaceHeight at that position
3. Place the new object at Y = surfaceHeight

Example: desk (subH:2, surfaceHeight=1.0m) → monitor placed at Y=1.0m. The z-buffer handles the visual overlap automatically.

## Scene Structure

### Scene Graph

```
Scene
  terrainGroup          // InstancedMesh of grass tiles
  infrastructureGroup   // InstancedMesh per infra floor type
  wallGroup             // Wall/door 3D geometry
  zoneGroup             // Zone floor overlays (semi-transparent)
  connectionGroup       // Pipes/cables as thin cylinders
  equipmentGroup        // Facility equipment meshes
  componentGroup        // Beamline component meshes
  decorationGroup       // Trees, benches, etc.
  Lights
    AmbientLight        // Base fill illumination
    DirectionalLight    // Primary "sun" — casts shadows
```

Groups replace the current 14+ PixiJS layers. Objects within groups don't need manual z-sorting — the z-buffer handles it. Groups exist for batch operations (show/hide a floor, toggle decorations, etc.).

### Lighting

**AmbientLight:**
- Purpose: Base fill so shadowed areas aren't pure black
- Color: Soft warm white (0xfff5e6)
- Intensity: ~0.4
- Illuminates all faces equally

**DirectionalLight:**
- Purpose: Primary "sun" — creates face shading and casts shadows
- Color: White (0xffffff)
- Intensity: ~0.8
- Position: Upper-left in isometric view (matches the current convention where left face is darker)
- Replaces manual 0.7x/0.85x face-darkening with real light math

### Shadows

- `DirectionalLight.castShadow = true`
- Shadow map resolution: 1024x1024 (modest — chunky shadows match pixel art aesthetic)
- Shadow type: `BasicShadowMap` — hard edges, no blur, complements pixel art style
- Shadow camera: Orthographic (DirectionalLight uses this by default), bounds cover visible play area
- Per-object: `mesh.castShadow = true` on components, walls, equipment, decorations. `mesh.receiveShadow = true` on terrain, floors, desk surfaces.

### Multi-Level Support

Scene groups organized by floor level. Currently only floor 0 (ground). The architecture supports:

- **Underground:** Floors at Y < 0. Toggle ground-level terrain visibility to see below.
- **Upper floors:** Floors at Y > 0. Same visibility toggling.
- **Cutaway view:** A clipping plane at a specific Y height — everything above is invisible. Replaces the current wall cutaway flood-fill system with a single clipping plane.

## View-Model Layer (WorldSnapshot)

### The Problem

The current renderer has 40+ direct reads into `game.state.*`, 15+ registry queries, and 10+ game method calls. Renderers access private fields (`game._designPlacer`, `game.editingBeamlineId`). This tight coupling makes the renderer fragile and untestable.

### The Solution

A `WorldSnapshot` — a single flat data object the game produces and the renderer consumes. The renderer never touches `game.*` directly.

```
Game State  →  buildWorldSnapshot()  →  WorldSnapshot  →  ThreeRenderer
```

### WorldSnapshot Structure

```javascript
WorldSnapshot {
  terrain:      [{ col, row, variant, brightness }]
  infrastructure: [{ col, row, type, orientation, variant, tint }]
  walls:        [{ col, row, edge, height, materialId }]
  doors:        [{ col, row, edge, materialId }]
  zones:        [{ col, row, zoneType, active, label }]
  components:   [{
    id, type, col, row, subCol, subRow, direction,
    subL, subW, subH, geometryType, textures,
    health, warnings, dimmed
  }]
  equipment:    [{ id, type, col, row, subCol, subRow, subL, subW, subH, ... }]
  decorations:  [{ col, row, type, variant, subH }]
  connections:  [{ from, to, type, path }]
  beamPaths:    [{ nodes: [{x, y, z}], color, dimmed }]
  furnishings:  [{ col, row, subCol, subRow, type, subH, ... }]

  // Interaction state
  cursor:           { col, row, tool, valid, footprint }
  selection:        { id, type } | null
  placementPreview: { type, col, row, direction, valid } | null
  wallPreview:      { segments: [...], cost } | null
  wallVisibility:   "up" | "transparent" | "cutaway" | "down"
  activeFloor:      0
}
```

### Reconciliation

The renderer maintains a `Map<id, Mesh>` for each group. On snapshot update:

- For each item in the new snapshot: if not in mesh map → create mesh. If changed → update position/material/visibility.
- For each mesh in the map: if not in new snapshot → remove from scene, dispose.
- For instanced groups (terrain, walls): rebuild the full InstancedMesh when the set changes (infrequent — only on build/demolish).

### Update Paths

- **Game events** (`beamlineChanged`, `infrastructureChanged`, etc.) → adapter calls `buildWorldSnapshot(game)` → full reconciliation
- **High-frequency updates** (cursor, hover) → lightweight `updateCursor()` path, no full snapshot rebuild

### Benefits

- **Testable:** Construct a WorldSnapshot by hand, pass to renderer, verify scene. No game instance needed.
- **Debuggable:** Log the snapshot to see exactly what the renderer sees.
- **Swappable:** Could swap Three.js for another engine by writing a new snapshot consumer.
- **Shared:** Both Three.js world and PixiJS overlay read from the same WorldSnapshot.

## Performance Strategy

- **InstancedMesh for terrain** — all grass tiles = one geometry + one material, one draw call
- **InstancedMesh per infrastructure type** — all "concrete floor" tiles instanced together, all "lab floor" together, etc.
- **InstancedMesh per wall material** — wall segments of same type batched
- **Individual meshes for components/equipment** — fewer of these, potentially unique textures, still only a few hundred max
- **Frustum culling** — automatic in Three.js, off-screen objects not rendered
- **Static flags** — `mesh.matrixAutoUpdate = false` on objects that don't move (most of them)
- **Target: <200 draw calls** for a fully built-out facility

## Migration Plan

Big bang build: construct the full Three.js renderer alongside the existing one, then swap.

### Phase 1 — Foundation

Three.js scaffold, OrthographicCamera at isometric angle, pan/zoom input. Terrain tiles as InstancedMesh using existing grass PNGs with NearestFilter. Gaussian brightness via per-instance tinting. AmbientLight + DirectionalLight with BasicShadowMap. WorldSnapshot adapter (terrain section).

**Testable:** Isometric grass map with lighting and shadows.

### Phase 2 — Infrastructure & Structure

Infrastructure floor tiles (InstancedMesh per type, existing tile PNGs). Walls as 3D BoxGeometry slabs with real lighting. Doors as composite geometry. Zone overlays as semi-transparent planes. Wall visibility modes via clipping planes and material opacity. WorldSnapshot: infrastructure, walls, doors, zones.

**Testable:** Build rooms with floors, walls, doors. Walls cast shadows. Cutaway via clipping plane.

### Phase 3 — Beamline Components

Geometry factory: component type → Three.js mesh. Texture loading: assets/textures/ → THREE.Texture with NearestFilter. Per-face UV mapping. subH added to all component definitions. Component placement with 3D positioning. Beam path as glowing geometry. WorldSnapshot: components, beamPaths.

**Testable:** Place beamline with 3D components. Shadows on floor. Beam visible.

### Phase 4 — Equipment, Decorations & Connections

Facility equipment as 3D meshes. Zone furnishings at sub-tile positions. Decorations as composite geometry. Connections as thin cylinder geometry. Object stacking via surfaceHeight. WorldSnapshot: equipment, decorations, furnishings, connections.

**Testable:** Place desk, put monitor on it. Trees cast shadows. Pipes route between equipment.

### Phase 5 — PixiJS Overlay & Interaction

PixiJS overlay canvas (transparent, layered above Three.js). Camera sync. Grid lines, text labels, placement cursors, selection highlights. Raycasting from mouse → Three.js scene for click/hover on 3D objects. WorldSnapshot: cursor, selection, preview.

**Testable:** Click component → popup. Drag to place → cursor preview. Labels track 3D positions.

### Phase 6 — Swap & Cleanup

Wire ThreeRenderer into main.js. Verify all game flows. Remove old PixiJS world rendering code (beamline-renderer.js, infrastructure-renderer.js, grass-renderer.js, decoration-renderer.js, sprites.js placeholder generation). Keep: overlays.js, hud.js, designer-renderer.js, grid.js. Update asset-gen tool for flat texture generation.

## What Stays Untouched

- All HTML DOM UI — HUD, palettes, component popup, tech tree, goals, warnings, menus
- Beamline Designer window — canvas-based schematic + plots
- Game logic — state management, physics sim, research, events
- Existing tile/decoration PNGs — reused as Three.js textures
- overlays.js, hud.js, designer-renderer.js

## New File Structure

```
src/renderer/
  ThreeRenderer.js        // Three.js app, camera, scene, lighting, render loop
  world-snapshot.js       // buildWorldSnapshot(game) adapter
  terrain-builder.js      // InstancedMesh for grass + infra floors
  wall-builder.js         // Wall/door 3D geometry
  component-builder.js    // Beamline component geometry factory
  equipment-builder.js    // Facility equipment + furnishing meshes
  decoration-builder.js   // Tree, bench, etc. composite geometry
  connection-builder.js   // Pipe/cable geometry along paths
  beam-builder.js         // Beam path visualization
  texture-manager.js      // Load PNGs as THREE.Texture with NearestFilter
  overlay.js              // PixiJS 2D overlay (grid, labels, cursors)
  grid.js                 // Isometric math (kept from current)
  --- unchanged ---
  overlays.js             // Component popup, tech tree, etc. (DOM)
  hud.js                  // HUD panels (DOM)
  designer-renderer.js    // Beamline designer (canvas)
```

## PixelLab Texture Generation

Parallel with migration, generate flat 2D textures:

- **Priority 1:** Top + front textures for all beamline components (~30 types × 2 faces = ~60 textures)
- **Priority 2:** Side textures where front ≠ side (dipoles, large cavities)
- **Priority 3:** Equipment face textures (racks, pumps, desks)
- **Fallback:** Tinted solid materials work during development — textures added incrementally

The asset-gen tool extends to manage flat texture generation via PixelLab instead of isometric sprite generation.
