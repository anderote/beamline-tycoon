# Three.js 3D World Renderer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PixiJS world rendering with a Three.js 3D world renderer using orthographic isometric camera, real lighting/shadows, and PixelLab flat textures mapped onto 3D primitives.

**Architecture:** Layered canvases — Three.js renders the 3D world (bottom), PixiJS renders 2D overlays (middle), HTML DOM for UI (top). A WorldSnapshot view-model decouples game state from rendering. The old PixiJS world renderer is built alongside, then swapped in and old code removed.

**Tech Stack:** Three.js (CDN, OrthographicCamera, InstancedMesh, MeshStandardMaterial), PixiJS 8 (existing, retained for 2D overlays), existing tile/decoration PNGs reused as Three.js textures.

---

## File Structure

### New files to create:

| File | Responsibility |
|------|---------------|
| `src/renderer3d/ThreeRenderer.js` | Three.js app, scene, camera, lighting, render loop, camera controls |
| `src/renderer3d/world-snapshot.js` | `buildWorldSnapshot(game)` — produces flat data object from game state |
| `src/renderer3d/texture-manager.js` | Load PNGs as THREE.Texture with NearestFilter, cache, variant selection |
| `src/renderer3d/terrain-builder.js` | InstancedMesh for grass tiles with brightness tinting |
| `src/renderer3d/infra-builder.js` | InstancedMesh per infrastructure floor type + zone overlays |
| `src/renderer3d/wall-builder.js` | Wall/door 3D BoxGeometry on tile edges |
| `src/renderer3d/component-builder.js` | Beamline component geometry factory (box/cylinder/composite) |
| `src/renderer3d/equipment-builder.js` | Facility equipment + zone furnishing meshes |
| `src/renderer3d/decoration-builder.js` | Tree, bench, etc. composite geometry |
| `src/renderer3d/connection-builder.js` | Pipe/cable geometry along paths |
| `src/renderer3d/beam-builder.js` | Beam path visualization (glowing tubes) |
| `src/renderer3d/overlay.js` | PixiJS 2D overlay canvas (grid, labels, cursors, previews) |
| `src/renderer3d/camera-sync.js` | Sync PixiJS overlay viewport to Three.js orthographic camera |

### Files to modify:

| File | Change |
|------|--------|
| `index.html` | Add Three.js CDN script tag, add second canvas container |
| `src/main.js` | Swap `Renderer` for `ThreeRenderer`, update init/wiring |
| `src/data/components.js` | Add `subH` and `geometryType` fields to all components |
| `src/data/infrastructure.js` | Add `subH` to infrastructure types, wall types, door types, furnishings |

### Files to eventually remove (Phase 6):

| File | Reason |
|------|--------|
| `src/renderer/Renderer.js` | Replaced by ThreeRenderer.js |
| `src/renderer/beamline-renderer.js` | Replaced by component-builder.js + beam-builder.js |
| `src/renderer/infrastructure-renderer.js` | Replaced by infra-builder.js + wall-builder.js |
| `src/renderer/grass-renderer.js` | Replaced by terrain-builder.js |
| `src/renderer/decoration-renderer.js` | Replaced by decoration-builder.js |
| `src/renderer/sprites.js` | Replaced by texture-manager.js (placeholder generation no longer needed) |

### Files kept unchanged:

| File | Reason |
|------|--------|
| `src/renderer/overlays.js` | DOM-based popups, tech tree, goals — no PixiJS world rendering |
| `src/renderer/hud.js` | DOM-based HUD panels — no PixiJS world rendering |
| `src/renderer/designer-renderer.js` | Canvas-based schematic — separate from world rendering |
| `src/renderer/grid.js` | Coordinate math still needed for overlay + input |

---

## Task 1: Three.js Scaffold + Isometric Camera

**Files:**
- Create: `src/renderer3d/ThreeRenderer.js`
- Modify: `index.html`

- [ ] **Step 1: Add Three.js CDN to index.html**

In `index.html`, add the Three.js script tag before the PixiJS tag (line 280):

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.170/build/three.min.js"></script>
```

- [ ] **Step 2: Create ThreeRenderer.js with scene, camera, and renderer**

```javascript
// src/renderer3d/ThreeRenderer.js
// Note: THREE is a CDN global — not imported.

import { TILE_W, TILE_H } from '../data/directions.js';

export class ThreeRenderer {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.canvas = null;

    // Camera state
    this.zoom = 1;
    this._panX = 0;
    this._panY = 0;

    // Scene groups
    this.terrainGroup = null;
    this.infrastructureGroup = null;
    this.wallGroup = null;
    this.zoneGroup = null;
    this.connectionGroup = null;
    this.equipmentGroup = null;
    this.componentGroup = null;
    this.decorationGroup = null;

    // Lights
    this.ambientLight = null;
    this.directionalLight = null;

    // Animation
    this._animationId = null;
    this._clock = new THREE.Clock();
  }

  async init() {
    // 1. Create renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.setClearColor(0x1a1a2e);
    this.canvas = this.renderer.domElement;

    // 2. Insert canvas into DOM
    const gameDiv = document.getElementById('game');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.zIndex = '10';
    gameDiv.prepend(this.canvas);

    // 3. Create scene
    this.scene = new THREE.Scene();

    // 4. Create orthographic camera for isometric view
    this._setupCamera();

    // 5. Create lights
    this._setupLights();

    // 6. Create scene groups
    this._setupGroups();

    // 7. Handle resize
    window.addEventListener('resize', () => this._onResize());

    // 8. Start render loop
    this._animate();
  }

  _setupCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    // Frustum size controls how much of the world is visible
    // At zoom=1, show roughly 20 tiles across
    const frustumSize = 20;
    this.camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,
       frustumSize * aspect / 2,
       frustumSize / 2,
      -frustumSize / 2,
      0.1,
      1000
    );

    // Standard isometric angle:
    // Rotate 45° around Y, then ~35.264° around X
    // This produces equal foreshortening on X and Z axes
    const isoAngle = Math.atan(Math.sin(Math.atan(1))); // ~35.264°
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = Math.PI / 4;
    this.camera.rotation.x = -isoAngle;

    // Position camera far enough to see everything
    this.camera.position.set(50, 50, 50);
  }

  _setupLights() {
    // Ambient fill light
    this.ambientLight = new THREE.AmbientLight(0xfff5e6, 0.4);
    this.scene.add(this.ambientLight);

    // Directional "sun" light — upper-left in isometric view
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.directionalLight.position.set(-30, 40, -30);
    this.directionalLight.castShadow = true;

    // Shadow camera — orthographic, covers play area
    const shadowSize = 60;
    this.directionalLight.shadow.camera.left = -shadowSize;
    this.directionalLight.shadow.camera.right = shadowSize;
    this.directionalLight.shadow.camera.top = shadowSize;
    this.directionalLight.shadow.camera.bottom = -shadowSize;
    this.directionalLight.shadow.camera.near = 0.1;
    this.directionalLight.shadow.camera.far = 200;
    this.directionalLight.shadow.mapSize.set(1024, 1024);

    this.scene.add(this.directionalLight);
  }

  _setupGroups() {
    this.terrainGroup = new THREE.Group();
    this.terrainGroup.name = 'terrain';
    this.scene.add(this.terrainGroup);

    this.infrastructureGroup = new THREE.Group();
    this.infrastructureGroup.name = 'infrastructure';
    this.scene.add(this.infrastructureGroup);

    this.wallGroup = new THREE.Group();
    this.wallGroup.name = 'walls';
    this.scene.add(this.wallGroup);

    this.zoneGroup = new THREE.Group();
    this.zoneGroup.name = 'zones';
    this.scene.add(this.zoneGroup);

    this.connectionGroup = new THREE.Group();
    this.connectionGroup.name = 'connections';
    this.scene.add(this.connectionGroup);

    this.equipmentGroup = new THREE.Group();
    this.equipmentGroup.name = 'equipment';
    this.scene.add(this.equipmentGroup);

    this.componentGroup = new THREE.Group();
    this.componentGroup.name = 'components';
    this.scene.add(this.componentGroup);

    this.decorationGroup = new THREE.Group();
    this.decorationGroup.name = 'decorations';
    this.scene.add(this.decorationGroup);
  }

  // --- Camera controls ---

  zoomAt(screenX, screenY, delta) {
    const oldZoom = this.zoom;
    this.zoom = Math.max(0.2, Math.min(5, this.zoom + delta));
    this._updateCameraFrustum();
  }

  panBy(dx, dy) {
    // Convert screen pixel delta to world units using camera
    // In orthographic, 1 screen pixel = (frustumWidth / screenWidth) world units
    const frustumWidth = this.camera.right - this.camera.left;
    const worldPerPixel = frustumWidth / window.innerWidth;
    this._panX += dx * worldPerPixel;
    this._panY += dy * worldPerPixel;
    this._updateCameraPosition();
  }

  _updateCameraFrustum() {
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 20 / this.zoom;
    this.camera.left = -frustumSize * aspect / 2;
    this.camera.right = frustumSize * aspect / 2;
    this.camera.top = frustumSize / 2;
    this.camera.bottom = -frustumSize / 2;
    this.camera.updateProjectionMatrix();
  }

  _updateCameraPosition() {
    // Pan offsets applied along the ground plane axes
    // In isometric view, screen-right maps to world (+X, -Z) direction
    // and screen-down maps to world (+X, +Z) direction
    const cos45 = Math.cos(Math.PI / 4);
    const worldDx = (this._panX + this._panY) * cos45;
    const worldDz = (-this._panX + this._panY) * cos45;
    this.camera.position.set(50 + worldDx, 50, 50 + worldDz);
    this.camera.lookAt(worldDx, 0, worldDz);
  }

  screenToWorld(screenX, screenY) {
    // Unproject screen point to ground plane (Y=0)
    const ndc = new THREE.Vector2(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, intersection);

    return intersection ? { x: intersection.x, y: intersection.z } : { x: 0, y: 0 };
  }

  // Convert world position (wx, wz on ground plane) to grid col, row
  worldToGrid(wx, wz) {
    // 1 tile = 2 world units (4 sub-units * 0.5m each)
    return {
      col: Math.floor(wx / 2),
      row: Math.floor(wz / 2),
    };
  }

  // Convert grid col, row to world position (center of tile)
  gridToWorld(col, row) {
    return {
      x: col * 2 + 1, // center of tile
      y: 0,
      z: row * 2 + 1, // center of tile
    };
  }

  _onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this._updateCameraFrustum();
  }

  _animate() {
    this._animationId = requestAnimationFrame(() => this._animate());
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this._animationId) cancelAnimationFrame(this._animationId);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
```

- [ ] **Step 3: Smoke-test — temporarily instantiate ThreeRenderer alongside existing renderer**

In `src/main.js`, temporarily add after line 48 (`await renderer.init()`):

```javascript
import { ThreeRenderer } from './renderer3d/ThreeRenderer.js';
// ... inside main():
const threeRenderer = new ThreeRenderer();
await threeRenderer.init();
window._three = threeRenderer; // for console debugging
```

Open the game. You should see:
- The existing PixiJS game renders as before
- Behind it (z-index 10 vs PixiJS canvas), a dark blue Three.js canvas exists
- In browser console: `window._three.scene.children.length` should be 10 (8 groups + 2 lights)

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/ThreeRenderer.js index.html src/main.js
git commit -m "feat: add Three.js scaffold with isometric camera and lighting"
```

---

## Task 2: Texture Manager

**Files:**
- Create: `src/renderer3d/texture-manager.js`

- [ ] **Step 1: Create texture-manager.js**

```javascript
// src/renderer3d/texture-manager.js
// Loads PNG textures as THREE.Texture with NearestFilter.
// Note: THREE is a CDN global.

export class TextureManager {
  constructor() {
    this._cache = new Map();        // path -> THREE.Texture
    this._loader = new THREE.TextureLoader();
    this._tileManifest = null;
    this._decorationManifest = null;
  }

  /**
   * Load a single texture from a path. Returns cached version if already loaded.
   * All textures use NearestFilter for crisp pixel art.
   */
  load(path) {
    if (this._cache.has(path)) return Promise.resolve(this._cache.get(path));

    return new Promise((resolve, reject) => {
      this._loader.load(
        path,
        (texture) => {
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestFilter;
          texture.colorSpace = THREE.SRGBColorSpace;
          this._cache.set(path, texture);
          resolve(texture);
        },
        undefined,
        (err) => {
          console.warn(`Failed to load texture: ${path}`, err);
          resolve(null);
        }
      );
    });
  }

  /**
   * Get a cached texture synchronously. Returns null if not loaded.
   */
  get(path) {
    return this._cache.get(path) || null;
  }

  /**
   * Load the tile manifest and all tile textures.
   * Returns a map of gameId -> { texture, variants, floorVariants }.
   */
  async loadTileManifest() {
    const resp = await fetch('assets/tiles/tile-manifest.json');
    if (!resp.ok) return;
    this._tileManifest = await resp.json();
    let count = 0;

    for (const [gameId, info] of Object.entries(this._tileManifest)) {
      if (info.files) {
        // Multiple variants (zones)
        for (const file of info.files) {
          await this.load(file);
          count++;
        }
      } else if (info.file) {
        // Single texture (flooring)
        await this.load(info.file);
        count++;
        if (info.variants) {
          for (const v of info.variants) {
            await this.load(v.file);
            count++;
          }
        }
      }
    }
    console.log(`TextureManager: loaded ${count} tile textures`);
  }

  /**
   * Load decoration manifest and textures.
   */
  async loadDecorationManifest() {
    const resp = await fetch('assets/decorations/decoration-manifest.json');
    if (!resp.ok) return;
    this._decorationManifest = await resp.json();
    let count = 0;

    for (const [key, info] of Object.entries(this._decorationManifest)) {
      if (info.file) {
        await this.load(info.file);
        count++;
      }
    }
    console.log(`TextureManager: loaded ${count} decoration textures`);
  }

  /**
   * Get the tile texture for a given infrastructure gameId.
   * Returns { texture, variants, floorVariants, variantTints } or null.
   */
  getTileInfo(gameId) {
    if (!this._tileManifest) return null;
    const info = this._tileManifest[gameId];
    if (!info) return null;

    if (info.files) {
      return {
        variants: info.files.map(f => this.get(f)).filter(Boolean),
        variantTints: info.variantTints || null,
      };
    } else if (info.file) {
      const result = { texture: this.get(info.file) };
      if (info.variants) {
        result.floorVariants = info.variants.map(v => this.get(v.file)).filter(Boolean);
        result.variantTints = info.variants.map(v => v.tint).filter(Boolean);
      }
      return result;
    }
    return null;
  }

  dispose() {
    for (const tex of this._cache.values()) {
      if (tex) tex.dispose();
    }
    this._cache.clear();
  }
}
```

- [ ] **Step 2: Verify texture loading works**

In browser console (with the temporary ThreeRenderer from Task 1):

```javascript
import('./renderer3d/texture-manager.js').then(async m => {
  const tm = new m.TextureManager();
  await tm.loadTileManifest();
  console.log(tm._cache.size, 'textures loaded');
});
```

Should log a positive number of textures.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/texture-manager.js
git commit -m "feat: add TextureManager for Three.js with NearestFilter pixel art textures"
```

---

## Task 3: WorldSnapshot — Terrain Section

**Files:**
- Create: `src/renderer3d/world-snapshot.js`

- [ ] **Step 1: Create world-snapshot.js with terrain extraction**

```javascript
// src/renderer3d/world-snapshot.js
// Produces a flat data snapshot of the game world for the renderer.
// The renderer never touches game.* directly — only reads this snapshot.

/**
 * Build the terrain section of the world snapshot.
 * Returns an array of { col, row, variant, brightness, occupied } for each grass tile.
 */
function buildTerrain(game, range = 20) {
  const blobs = game.state.terrainBlobs || [];
  const infraOccupied = game.state.infraOccupied || {};
  const zoneOccupied = game.state.zoneOccupied || {};
  const terrain = [];

  for (let col = -range; col <= range; col++) {
    for (let row = -range; row <= range; row++) {
      const key = `${col},${row}`;
      const isInfra = !!infraOccupied[key];
      const isZone = !!zoneOccupied[key];
      if (isInfra || isZone) continue;

      // Hash for pseudo-random variant (same algorithm as grass-renderer.js)
      let h = ((col * 374761393 + row * 668265263) ^ 0x5bf03635) | 0;
      h = ((h ^ (h >>> 13)) * 1274126177) | 0;
      const hash = ((h >>> 16) ^ h) & 0x7fffffff;

      // Sample brightness from gaussian blobs
      let brightness = 0;
      for (const blob of blobs) {
        const dx = col - blob.cx;
        const dy = row - blob.cy;
        const cos = Math.cos(blob.angle);
        const sin = Math.sin(blob.angle);
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        const ex = (lx * lx) / (2 * blob.sx * blob.sx);
        const ey = (ly * ly) / (2 * blob.sy * blob.sy);
        brightness += blob.brightness * Math.exp(-(ex + ey));
      }
      brightness = Math.max(-1, Math.min(1, brightness));

      terrain.push({ col, row, hash, brightness });
    }
  }
  return terrain;
}

/**
 * Build the infrastructure floor section.
 */
function buildInfrastructure(game) {
  const tiles = game.state.infrastructure || [];
  return tiles.map(tile => ({
    col: tile.col,
    row: tile.row,
    type: tile.type,
    orientation: tile.orientation || 0,
    variant: tile.variant,
    tint: tile.tint,
  }));
}

/**
 * Build the wall section.
 */
function buildWalls(game) {
  return (game.state.walls || []).map(w => ({
    col: w.col,
    row: w.row,
    edge: w.edge,
    type: w.type || 'standard',
  }));
}

/**
 * Build the door section.
 */
function buildDoors(game) {
  return (game.state.doors || []).map(d => ({
    col: d.col,
    row: d.row,
    edge: d.edge,
    type: d.type || 'standard',
  }));
}

/**
 * Build the zone section.
 */
function buildZones(game) {
  return (game.state.zones || []).map(z => ({
    col: z.col,
    row: z.row,
    zoneType: z.type,
  }));
}

/**
 * Build the component section (beamline nodes).
 */
function buildComponents(game) {
  const nodes = game.registry.getAllNodes();
  const editingId = game.editingBeamlineId;
  return nodes.map(node => {
    const beamline = game.registry.getBeamlineForNode(node.id);
    return {
      id: node.id,
      type: node.type,
      col: node.col,
      row: node.row,
      subCol: node.subCol || 0,
      subRow: node.subRow || 0,
      direction: node.direction,
      tiles: node.tiles || [{ col: node.col, row: node.row }],
      dimmed: beamline && beamline.id !== editingId,
      health: typeof game.getComponentHealth === 'function' ? game.getComponentHealth(node.id) : 1,
    };
  });
}

/**
 * Build the beam path section.
 */
function buildBeamPaths(game) {
  const beamlines = game.registry.getAll();
  const editingId = game.editingBeamlineId;
  const paths = [];
  for (const bl of beamlines) {
    if (!bl.beamOn) continue;
    const nodes = bl.nodes || [];
    if (nodes.length < 2) continue;
    paths.push({
      beamlineId: bl.id,
      nodePositions: nodes.map(n => ({ col: n.col, row: n.row, tiles: n.tiles })),
      dimmed: bl.id !== editingId,
    });
  }
  return paths;
}

/**
 * Build the equipment section (facility).
 */
function buildEquipment(game) {
  const grid = game.state.facilityGrid || {};
  const items = [];
  for (const [key, entry] of Object.entries(grid)) {
    items.push({
      key,
      id: entry.id,
      type: entry.type,
      col: entry.col,
      row: entry.row,
      subCol: entry.subCol,
      subRow: entry.subRow,
    });
  }
  return items;
}

/**
 * Build the decoration section.
 */
function buildDecorations(game) {
  return (game.state.decorations || []).map(d => ({
    col: d.col,
    row: d.row,
    type: d.type,
    subCol: d.subCol,
    subRow: d.subRow,
    variant: d.variant,
    tall: d.tall,
  }));
}

/**
 * Build the connection section.
 */
function buildConnections(game) {
  return (game.state.connections || []).map(c => ({
    fromCol: c.fromCol,
    fromRow: c.fromRow,
    toCol: c.toCol,
    toRow: c.toRow,
    type: c.type,
    path: c.path,
  }));
}

/**
 * Build the furnishing section.
 */
function buildFurnishings(game) {
  return (game.state.zoneFurnishings || []).map(f => ({
    col: f.col,
    row: f.row,
    subCol: f.subCol,
    subRow: f.subRow,
    type: f.type,
  }));
}

/**
 * Build the complete world snapshot from game state.
 */
export function buildWorldSnapshot(game) {
  return {
    terrain: buildTerrain(game),
    infrastructure: buildInfrastructure(game),
    walls: buildWalls(game),
    doors: buildDoors(game),
    zones: buildZones(game),
    components: buildComponents(game),
    equipment: buildEquipment(game),
    decorations: buildDecorations(game),
    connections: buildConnections(game),
    beamPaths: buildBeamPaths(game),
    furnishings: buildFurnishings(game),
  };
}
```

- [ ] **Step 2: Verify snapshot builds without error**

In browser console:

```javascript
import('./renderer3d/world-snapshot.js').then(m => {
  const snap = m.buildWorldSnapshot(window._renderer.game);
  console.log('terrain tiles:', snap.terrain.length);
  console.log('infra tiles:', snap.infrastructure.length);
  console.log('components:', snap.components.length);
});
```

Should log counts matching what's visible in the game.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/world-snapshot.js
git commit -m "feat: add WorldSnapshot builder for game state -> renderer decoupling"
```

---

## Task 4: Terrain Builder (Grass Tiles)

**Files:**
- Create: `src/renderer3d/terrain-builder.js`

- [ ] **Step 1: Create terrain-builder.js**

```javascript
// src/renderer3d/terrain-builder.js
// Renders grass tiles as a single InstancedMesh with per-instance tinting.
// Note: THREE is a CDN global.

const DARK_VARIANTS  = [8, 9, 10, 11, 16, 17, 18, 19];
const MID_VARIANTS   = [0, 1, 2, 3, 4, 5, 6, 7];
const LIGHT_VARIANTS = [12, 13, 14, 15, 20, 21, 22, 23];

function pickVariantPool(brightness) {
  if (brightness < -0.25) return DARK_VARIANTS;
  if (brightness > 0.25) return LIGHT_VARIANTS;
  return MID_VARIANTS;
}

export class TerrainBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    this._mesh = null;
    this._cacheKey = null;
  }

  /**
   * Build or rebuild the terrain InstancedMesh from snapshot terrain data.
   * Each tile is a thin box at Y=0 with the appropriate grass texture tinted by brightness.
   *
   * For simplicity, we use one material per variant group (dark/mid/light)
   * and per-instance color for fine brightness tuning.
   */
  build(terrainData, parentGroup) {
    // Cache key to avoid unnecessary rebuilds
    const key = terrainData.length;
    if (key === this._cacheKey && this._mesh) return;
    this._cacheKey = key;

    // Clean up old mesh
    this.dispose(parentGroup);

    if (terrainData.length === 0) return;

    // Use a single PlaneGeometry for all tiles, oriented flat (XZ plane)
    // Tile size in world units: 2 x 2 (4 sub-units * 0.5m)
    const tileSize = 2;
    const geo = new THREE.PlaneGeometry(tileSize, tileSize);
    // Rotate from XY to XZ plane (face up)
    geo.rotateX(-Math.PI / 2);

    // Try to get the first grass texture for the material
    const tex = this._textureManager.get('assets/tiles/grass_tile_0.png');
    const mat = new THREE.MeshStandardMaterial({
      map: tex || undefined,
      color: tex ? 0xffffff : 0x338833,
      roughness: 1.0,
      metalness: 0.0,
    });
    mat.side = THREE.FrontSide;

    const mesh = new THREE.InstancedMesh(geo, mat, terrainData.length);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < terrainData.length; i++) {
      const tile = terrainData[i];
      // Position: col and row map to world X and Z
      // Tile center at (col * 2 + 1, 0, row * 2 + 1)
      dummy.position.set(tile.col * 2 + 1, 0, tile.row * 2 + 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Per-instance tint based on brightness
      const b = tile.brightness;
      const tintFactor = 0.88 + b * 0.12;
      const warmth = b * 0.05;
      const r = Math.min(1, (0.94 + warmth) * tintFactor);
      const g = Math.min(1, tintFactor);
      const bv = Math.min(1, (0.94 - warmth) * tintFactor);
      color.setRGB(r, g, bv);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this._mesh = mesh;
    parentGroup.add(mesh);
  }

  dispose(parentGroup) {
    if (this._mesh) {
      parentGroup.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
      this._mesh = null;
      this._cacheKey = null;
    }
  }
}
```

- [ ] **Step 2: Wire terrain builder into ThreeRenderer**

Add to `ThreeRenderer.js`:

```javascript
import { TextureManager } from './texture-manager.js';
import { TerrainBuilder } from './terrain-builder.js';
import { buildWorldSnapshot } from './world-snapshot.js';
```

In the constructor, add:

```javascript
this.textureManager = new TextureManager();
this.terrainBuilder = new TerrainBuilder(this.textureManager);
this._snapshot = null;
this.game = null;
```

Change constructor signature to `constructor(game)` and set `this.game = game;`.

Add a method:

```javascript
async loadAssets() {
  await this.textureManager.loadTileManifest();
  await this.textureManager.loadDecorationManifest();
}

applySnapshot(snapshot) {
  this._snapshot = snapshot;
  this.terrainBuilder.build(snapshot.terrain, this.terrainGroup);
}

refresh() {
  const snapshot = buildWorldSnapshot(this.game);
  this.applySnapshot(snapshot);
}
```

- [ ] **Step 3: Test terrain rendering**

Update the temporary main.js integration to pass `game` and call refresh:

```javascript
const threeRenderer = new ThreeRenderer(game);
await threeRenderer.init();
await threeRenderer.loadAssets();
threeRenderer.refresh();
window._three = threeRenderer;
```

Open the game. The Three.js canvas (behind PixiJS) should show grass-colored tiles at isometric angle. Use browser dev tools to temporarily hide the PixiJS canvas to verify:

```javascript
document.querySelector('canvas:not([style*="z-index"])').style.display = 'none';
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/terrain-builder.js src/renderer3d/ThreeRenderer.js src/main.js
git commit -m "feat: render grass terrain as InstancedMesh in Three.js"
```

---

## Task 5: Infrastructure Floor Builder

**Files:**
- Create: `src/renderer3d/infra-builder.js`

- [ ] **Step 1: Create infra-builder.js**

```javascript
// src/renderer3d/infra-builder.js
// Renders infrastructure floor tiles as InstancedMesh per type.
// Note: THREE is a CDN global.

import { INFRASTRUCTURE } from '../data/infrastructure.js';

export class InfraBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    this._meshes = [];  // Array of InstancedMesh, one per infra type
    this._cacheKey = null;
  }

  build(infraData, parentGroup) {
    const key = infraData.map(t => `${t.col},${t.row},${t.type}`).join('|');
    if (key === this._cacheKey) return;
    this._cacheKey = key;

    this.dispose(parentGroup);

    if (infraData.length === 0) return;

    // Group tiles by type for instancing
    const byType = new Map();
    for (const tile of infraData) {
      if (!byType.has(tile.type)) byType.set(tile.type, []);
      byType.get(tile.type).push(tile);
    }

    const tileSize = 2;
    const tileHeight = 0.05; // thin floor slab

    for (const [type, tiles] of byType) {
      const infra = INFRASTRUCTURE[type];
      if (!infra) continue;

      // Use a thin box for floors so they have slight visual thickness
      const geo = new THREE.BoxGeometry(tileSize, tileHeight, tileSize);

      // Try to get tile texture
      const tileInfo = this._textureManager.getTileInfo(type);
      let mat;
      if (tileInfo && tileInfo.texture) {
        mat = new THREE.MeshStandardMaterial({
          map: tileInfo.texture,
          roughness: 0.9,
          metalness: 0.0,
        });
      } else {
        const color = infra.topColor || infra.color || 0x888888;
        mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.9,
          metalness: 0.0,
        });
      }

      const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;

      const dummy = new THREE.Object3D();
      const color = new THREE.Color();

      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        dummy.position.set(
          tile.col * 2 + 1,
          tileHeight / 2, // sit on top of ground plane
          tile.row * 2 + 1
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        // Apply tint if present
        if (tile.tint) {
          color.set(tile.tint);
        } else {
          color.set(0xffffff);
        }
        mesh.setColorAt(i, color);
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      this._meshes.push(mesh);
      parentGroup.add(mesh);
    }
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes = [];
    this._cacheKey = null;
  }
}
```

- [ ] **Step 2: Wire into ThreeRenderer**

Add import and builder instance in ThreeRenderer constructor:

```javascript
import { InfraBuilder } from './infra-builder.js';
// In constructor:
this.infraBuilder = new InfraBuilder(this.textureManager);
```

Update `applySnapshot`:

```javascript
applySnapshot(snapshot) {
  this._snapshot = snapshot;
  this.terrainBuilder.build(snapshot.terrain, this.terrainGroup);
  this.infraBuilder.build(snapshot.infrastructure, this.infrastructureGroup);
}
```

- [ ] **Step 3: Test infrastructure rendering**

Open the game, place some infrastructure, hide the PixiJS canvas. Infrastructure floor tiles should appear as colored or textured thin slabs slightly above the grass plane.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/infra-builder.js src/renderer3d/ThreeRenderer.js
git commit -m "feat: render infrastructure floors as InstancedMesh per type"
```

---

## Task 6: Wall & Door Builder

**Files:**
- Create: `src/renderer3d/wall-builder.js`

- [ ] **Step 1: Create wall-builder.js**

```javascript
// src/renderer3d/wall-builder.js
// Renders walls and doors as 3D BoxGeometry slabs on tile edges.
// Note: THREE is a CDN global.

import { TILE_W, TILE_H } from '../data/directions.js';

const WALL_HEIGHT = 3.0;     // world units (6 sub-units * 0.5m)
const WALL_THICKNESS = 0.15; // world units
const TILE_SIZE = 2;         // world units per tile

// Edge positions relative to tile center
// Each edge is defined by its start and end points on the tile boundary
const EDGE_OFFSETS = {
  n: { x1: 0, z1: 0, x2: 1, z2: 0, nx: 0, nz: -1 },  // north edge: top of tile
  e: { x1: 1, z1: 0, x2: 1, z2: 1, nx: 1, nz: 0 },   // east edge: right of tile
  s: { x1: 0, z1: 1, x2: 1, z2: 1, nx: 0, nz: 1 },   // south edge: bottom of tile
  w: { x1: 0, z1: 0, x2: 0, z2: 1, nx: -1, nz: 0 },  // west edge: left of tile
};

export class WallBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    this._meshes = [];
    this._cacheKey = null;
  }

  build(wallData, doorData, parentGroup, wallVisibility = 'up') {
    const key = JSON.stringify({ w: wallData, d: doorData, v: wallVisibility });
    if (key === this._cacheKey) return;
    this._cacheKey = key;

    this.dispose(parentGroup);

    // Walls
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      roughness: 0.8,
      metalness: 0.0,
    });

    if (wallVisibility === 'down') return; // hide all walls

    const opacity = wallVisibility === 'transparent' ? 0.3 : 1.0;
    if (wallVisibility === 'transparent') {
      wallMat.transparent = true;
      wallMat.opacity = opacity;
    }

    for (const wall of wallData) {
      const edgeInfo = EDGE_OFFSETS[wall.edge];
      if (!edgeInfo) continue;

      const tileX = wall.col * TILE_SIZE;
      const tileZ = wall.row * TILE_SIZE;

      // Wall center position
      const cx = tileX + (edgeInfo.x1 + edgeInfo.x2) / 2;
      const cz = tileZ + (edgeInfo.z1 + edgeInfo.z2) / 2;
      const cy = WALL_HEIGHT / 2;

      // Wall dimensions: length along edge, thin, tall
      const edgeLength = Math.sqrt(
        Math.pow((edgeInfo.x2 - edgeInfo.x1) * TILE_SIZE, 2) +
        Math.pow((edgeInfo.z2 - edgeInfo.z1) * TILE_SIZE, 2)
      ) || TILE_SIZE;

      const geo = new THREE.BoxGeometry(
        wall.edge === 'n' || wall.edge === 's' ? TILE_SIZE : WALL_THICKNESS,
        WALL_HEIGHT,
        wall.edge === 'e' || wall.edge === 'w' ? TILE_SIZE : WALL_THICKNESS
      );

      // Offset wall slightly along its normal so it sits on the tile edge
      const offsetX = edgeInfo.nx * WALL_THICKNESS / 2;
      const offsetZ = edgeInfo.nz * WALL_THICKNESS / 2;

      const mesh = new THREE.Mesh(geo, wallMat.clone());
      mesh.position.set(cx + offsetX, cy, cz + offsetZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();

      this._meshes.push(mesh);
      parentGroup.add(mesh);
    }

    // Doors — similar to walls but with an opening (post-lintel-post composite)
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.7,
      metalness: 0.0,
    });
    if (wallVisibility === 'transparent') {
      doorMat.transparent = true;
      doorMat.opacity = opacity;
    }

    const DOOR_HEIGHT = 2.5;
    const POST_WIDTH = 0.2;
    const LINTEL_HEIGHT = 0.3;

    for (const door of doorData) {
      const edgeInfo = EDGE_OFFSETS[door.edge];
      if (!edgeInfo) continue;

      const tileX = door.col * TILE_SIZE;
      const tileZ = door.row * TILE_SIZE;
      const cx = tileX + (edgeInfo.x1 + edgeInfo.x2) / 2;
      const cz = tileZ + (edgeInfo.z1 + edgeInfo.z2) / 2;
      const offsetX = edgeInfo.nx * WALL_THICKNESS / 2;
      const offsetZ = edgeInfo.nz * WALL_THICKNESS / 2;

      const isNS = door.edge === 'n' || door.edge === 's';

      // Left post
      const postGeo = new THREE.BoxGeometry(
        isNS ? POST_WIDTH : WALL_THICKNESS,
        DOOR_HEIGHT,
        isNS ? WALL_THICKNESS : POST_WIDTH
      );
      const leftPost = new THREE.Mesh(postGeo, doorMat.clone());
      const postOffset = (TILE_SIZE / 2 - POST_WIDTH / 2);
      leftPost.position.set(
        cx + offsetX + (isNS ? -postOffset : 0),
        DOOR_HEIGHT / 2,
        cz + offsetZ + (isNS ? 0 : -postOffset)
      );
      leftPost.castShadow = true;
      leftPost.matrixAutoUpdate = false;
      leftPost.updateMatrix();
      this._meshes.push(leftPost);
      parentGroup.add(leftPost);

      // Right post
      const rightPost = new THREE.Mesh(postGeo.clone(), doorMat.clone());
      rightPost.position.set(
        cx + offsetX + (isNS ? postOffset : 0),
        DOOR_HEIGHT / 2,
        cz + offsetZ + (isNS ? 0 : postOffset)
      );
      rightPost.castShadow = true;
      rightPost.matrixAutoUpdate = false;
      rightPost.updateMatrix();
      this._meshes.push(rightPost);
      parentGroup.add(rightPost);

      // Lintel
      const lintelGeo = new THREE.BoxGeometry(
        isNS ? TILE_SIZE : WALL_THICKNESS,
        LINTEL_HEIGHT,
        isNS ? WALL_THICKNESS : TILE_SIZE
      );
      const lintel = new THREE.Mesh(lintelGeo, doorMat.clone());
      lintel.position.set(
        cx + offsetX,
        DOOR_HEIGHT + LINTEL_HEIGHT / 2,
        cz + offsetZ
      );
      lintel.castShadow = true;
      lintel.matrixAutoUpdate = false;
      lintel.updateMatrix();
      this._meshes.push(lintel);
      parentGroup.add(lintel);
    }
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      if (mesh.material.dispose) mesh.material.dispose();
    }
    this._meshes = [];
    this._cacheKey = null;
  }
}
```

- [ ] **Step 2: Wire into ThreeRenderer**

```javascript
import { WallBuilder } from './wall-builder.js';
// In constructor:
this.wallBuilder = new WallBuilder(this.textureManager);
this.wallVisibilityMode = 'up';
```

Update `applySnapshot`:

```javascript
this.wallBuilder.build(
  snapshot.walls, snapshot.doors,
  this.wallGroup, this.wallVisibilityMode
);
```

- [ ] **Step 3: Verify walls render**

Place infrastructure with walls in the game. Hide PixiJS canvas. Walls should appear as grey vertical slabs on tile edges casting shadows on the floor.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/wall-builder.js src/renderer3d/ThreeRenderer.js
git commit -m "feat: render walls and doors as 3D box geometry"
```

---

## Task 7: Component Builder (Beamline)

**Files:**
- Create: `src/renderer3d/component-builder.js`
- Modify: `src/data/components.js` (add `subH`, `geometryType`)
- Modify: `src/data/infrastructure.js` (add `subH` to INFRASTRUCTURE, ZONE_FURNISHINGS, wall/door type definitions)

- [ ] **Step 1: Add subH and geometryType to component definitions**

In `src/data/components.js`, add `subH` and `geometryType` to each component. Apply these rules:

- Beam pipes/drifts: `subH: 2, geometryType: 'cylinder'`
- Quadrupoles: `subH: 3, geometryType: 'cylinder'`
- Sextupoles: `subH: 3, geometryType: 'cylinder'`
- Dipoles: `subH: 4, geometryType: 'box'`
- RF cavities (RFQ, DTL, SRF): `subH: 4, geometryType: 'cylinder'`
- Cryomodules: `subH: 5, geometryType: 'box'`
- Correctors/BPMs/diagnostics: `subH: 2, geometryType: 'cylinder'`
- Solenoids: `subH: 3, geometryType: 'cylinder'`
- Undulators: `subH: 3, geometryType: 'box'`
- Targets/collimators: `subH: 3, geometryType: 'box'`
- Sources: `subH: 4, geometryType: 'box'`
- Default for anything not listed: `subH: 2, geometryType: 'box'`

Example for the first few entries:

```javascript
source: {
  // ... existing fields ...
  subH: 4,
  geometryType: 'box',
},
drift: {
  // ... existing fields ...
  subH: 2,
  geometryType: 'cylinder',
},
dipole: {
  // ... existing fields ...
  subH: 4,
  geometryType: 'box',
},
quadrupole: {
  // ... existing fields ...
  subH: 3,
  geometryType: 'cylinder',
},
```

Apply to ALL components in the file.

Also add `subH` to `src/data/infrastructure.js`:
- INFRASTRUCTURE entries: `subH: 0.25` (thin floor slab) for all floor types
- Wall type definitions: `subH: 6` (3m tall standard wall)
- Door type definitions: `subH: 5` (2.5m door opening)
- ZONE_FURNISHINGS entries: `subH: 1-3` per item (chair ~2, monitor ~1, desk ~2, rack ~5, etc.)

- [ ] **Step 2: Create component-builder.js**

```javascript
// src/renderer3d/component-builder.js
// Creates 3D meshes for beamline components from snapshot data.
// Note: THREE is a CDN global.

import { COMPONENTS } from '../data/components.js';

const SUB_UNIT = 0.5; // meters per sub-unit = world units

export class ComponentBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    this._meshMap = new Map(); // component id -> THREE.Mesh or Group
  }

  /**
   * Create a 3D mesh for a component based on its type definition.
   */
  _createMesh(compDef) {
    const w = (compDef.subW || 2) * SUB_UNIT;
    const h = (compDef.subH || 2) * SUB_UNIT;
    const l = (compDef.subL || 2) * SUB_UNIT;
    const geoType = compDef.geometryType || 'box';

    let geo;
    if (geoType === 'cylinder') {
      // Cylinder along the beam axis (local Z)
      // radius = min(w, h) / 2, length = l
      const radius = Math.min(w, h) / 2;
      geo = new THREE.CylinderGeometry(radius, radius, l, 8);
      // CylinderGeometry is Y-axis by default; rotate to Z-axis later via mesh rotation
      geo.rotateZ(Math.PI / 2);
    } else {
      // Box: width (perpendicular to beam) x height x length (along beam)
      geo = new THREE.BoxGeometry(w, h, l);
    }

    // Color from spriteColor, fallback to grey
    const color = compDef.spriteColor || 0x888888;

    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }

  /**
   * Update the scene from snapshot component data.
   * Adds new meshes, updates positions of existing ones, removes stale ones.
   */
  build(componentData, parentGroup) {
    const seen = new Set();

    for (const comp of componentData) {
      seen.add(comp.id);
      const compDef = COMPONENTS[comp.type];
      if (!compDef) continue;

      let mesh = this._meshMap.get(comp.id);
      if (!mesh) {
        mesh = this._createMesh(compDef);
        this._meshMap.set(comp.id, mesh);
        parentGroup.add(mesh);
      }

      // Position: tile center + sub-tile offset
      // Component center along beam axis
      const subH = (compDef.subH || 2) * SUB_UNIT;
      const cx = comp.col * 2 + 1;
      const cy = subH / 2 + 0.05; // sit on floor (floor is at 0.05)
      const cz = comp.row * 2 + 1;
      mesh.position.set(cx, cy, cz);

      // Rotation based on direction (0=NE, 1=SE, 2=SW, 3=NW)
      mesh.rotation.y = -(comp.direction || 0) * (Math.PI / 2);

      // Dimming
      mesh.material.opacity = comp.dimmed ? 0.3 : 1.0;
      mesh.material.transparent = comp.dimmed;

      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
    }

    // Remove stale meshes
    for (const [id, mesh] of this._meshMap) {
      if (!seen.has(id)) {
        parentGroup.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this._meshMap.delete(id);
      }
    }
  }

  dispose(parentGroup) {
    for (const [id, mesh] of this._meshMap) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshMap.clear();
  }
}
```

- [ ] **Step 3: Wire into ThreeRenderer**

```javascript
import { ComponentBuilder } from './component-builder.js';
// In constructor:
this.componentBuilder = new ComponentBuilder(this.textureManager);
```

Update `applySnapshot`:

```javascript
this.componentBuilder.build(snapshot.components, this.componentGroup);
```

- [ ] **Step 4: Verify components render**

Place a beamline with several components. Hide PixiJS canvas. Components should appear as colored 3D boxes/cylinders at isometric angle with shadows.

- [ ] **Step 5: Commit**

```bash
git add src/renderer3d/component-builder.js src/data/components.js src/renderer3d/ThreeRenderer.js
git commit -m "feat: render beamline components as 3D geometry with subH heights"
```

---

## Task 8: Beam Path Builder

**Files:**
- Create: `src/renderer3d/beam-builder.js`

- [ ] **Step 1: Create beam-builder.js**

```javascript
// src/renderer3d/beam-builder.js
// Renders beam paths as glowing tube geometry between component positions.
// Note: THREE is a CDN global.

export class BeamBuilder {
  constructor() {
    this._meshes = [];
  }

  build(beamPathData, parentGroup) {
    this.dispose(parentGroup);

    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x44ff44,
      transparent: true,
      opacity: 0.7,
    });

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x44ff44,
      transparent: true,
      opacity: 0.2,
    });

    for (const path of beamPathData) {
      const nodes = path.nodePositions;
      if (nodes.length < 2) continue;

      const dimFactor = path.dimmed ? 0.3 : 1.0;
      const coreMat = beamMat.clone();
      coreMat.opacity = 0.7 * dimFactor;
      const outerMat = glowMat.clone();
      outerMat.opacity = 0.2 * dimFactor;

      for (let i = 0; i < nodes.length - 1; i++) {
        const from = nodes[i];
        const to = nodes[i + 1];

        // Use tile centers
        const fromTiles = from.tiles || [{ col: from.col, row: from.row }];
        const toTiles = to.tiles || [{ col: to.col, row: to.row }];
        const fc = fromTiles[Math.floor(fromTiles.length / 2)];
        const tc = toTiles[Math.floor(toTiles.length / 2)];

        const x1 = fc.col * 2 + 1;
        const z1 = fc.row * 2 + 1;
        const x2 = tc.col * 2 + 1;
        const z2 = tc.row * 2 + 1;
        const y = 0.5; // beam height — roughly center of beam pipe

        const dx = x2 - x1;
        const dz = z2 - z1;
        const length = Math.sqrt(dx * dx + dz * dz);
        if (length < 0.01) continue;

        // Core beam tube
        const coreGeo = new THREE.CylinderGeometry(0.05, 0.05, length, 4);
        coreGeo.rotateZ(Math.PI / 2);
        const core = new THREE.Mesh(coreGeo, coreMat);

        // Position at midpoint
        core.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
        // Rotate to face from -> to
        core.rotation.y = -Math.atan2(dz, dx);
        core.matrixAutoUpdate = false;
        core.updateMatrix();
        this._meshes.push(core);
        parentGroup.add(core);

        // Glow tube (larger, more transparent)
        const glowGeo = new THREE.CylinderGeometry(0.15, 0.15, length, 4);
        glowGeo.rotateZ(Math.PI / 2);
        const glow = new THREE.Mesh(glowGeo, outerMat);
        glow.position.copy(core.position);
        glow.rotation.copy(core.rotation);
        glow.matrixAutoUpdate = false;
        glow.updateMatrix();
        this._meshes.push(glow);
        parentGroup.add(glow);
      }
    }
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes = [];
  }
}
```

- [ ] **Step 2: Wire into ThreeRenderer**

```javascript
import { BeamBuilder } from './beam-builder.js';
// In constructor:
this.beamBuilder = new BeamBuilder();
```

Update `applySnapshot`:

```javascript
this.beamBuilder.build(snapshot.beamPaths, this.componentGroup);
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/beam-builder.js src/renderer3d/ThreeRenderer.js
git commit -m "feat: render beam paths as glowing tube geometry"
```

---

## Task 9: Equipment & Decoration Builders

**Files:**
- Create: `src/renderer3d/equipment-builder.js`
- Create: `src/renderer3d/decoration-builder.js`

- [ ] **Step 1: Create equipment-builder.js**

```javascript
// src/renderer3d/equipment-builder.js
// Renders facility equipment and zone furnishings as 3D meshes.
// Note: THREE is a CDN global.

import { COMPONENTS } from '../data/components.js';
import { ZONE_FURNISHINGS } from '../data/infrastructure.js';

const SUB_UNIT = 0.5;

export class EquipmentBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    this._meshes = [];
  }

  build(equipmentData, furnishingData, parentGroup) {
    this.dispose(parentGroup);

    // Facility equipment
    for (const eq of equipmentData) {
      const compDef = COMPONENTS[eq.type];
      if (!compDef) continue;

      const w = (compDef.subW || 2) * SUB_UNIT;
      const h = (compDef.subH || 2) * SUB_UNIT;
      const l = (compDef.subL || 2) * SUB_UNIT;

      const geo = new THREE.BoxGeometry(w, h, l);
      const mat = new THREE.MeshStandardMaterial({
        color: compDef.spriteColor || 0x888888,
        roughness: 0.7,
        metalness: 0.1,
      });

      const mesh = new THREE.Mesh(geo, mat);
      // Position from tile + sub-tile offset
      const tileX = eq.col * 2;
      const tileZ = eq.row * 2;
      const subX = (eq.subCol || 0) * SUB_UNIT;
      const subZ = (eq.subRow || 0) * SUB_UNIT;
      mesh.position.set(
        tileX + subX + w / 2,
        h / 2 + 0.05,
        tileZ + subZ + l / 2
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();

      this._meshes.push(mesh);
      parentGroup.add(mesh);
    }

    // Zone furnishings
    for (const furn of furnishingData) {
      const furnDef = ZONE_FURNISHINGS?.[furn.type];
      const w = ((furnDef?.subW || 1) * SUB_UNIT);
      const h = ((furnDef?.subH || 1) * SUB_UNIT);
      const l = ((furnDef?.subL || 1) * SUB_UNIT);

      const geo = new THREE.BoxGeometry(w, h, l);
      const color = furnDef?.color || 0x666666;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.0 });

      const mesh = new THREE.Mesh(geo, mat);
      const tileX = furn.col * 2;
      const tileZ = furn.row * 2;
      const subX = (furn.subCol || 0) * SUB_UNIT;
      const subZ = (furn.subRow || 0) * SUB_UNIT;
      mesh.position.set(
        tileX + subX + w / 2,
        h / 2 + 0.05,
        tileZ + subZ + l / 2
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();

      this._meshes.push(mesh);
      parentGroup.add(mesh);
    }
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes = [];
  }
}
```

- [ ] **Step 2: Create decoration-builder.js**

```javascript
// src/renderer3d/decoration-builder.js
// Renders decorations (trees, benches, etc.) as composite 3D geometry.
// Note: THREE is a CDN global.

const SUB_UNIT = 0.5;

export class DecorationBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    this._groups = [];
  }

  _createTree() {
    const group = new THREE.Group();

    // Trunk — brown cylinder
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 1.5, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.75;
    trunk.castShadow = true;
    group.add(trunk);

    // Canopy — green sphere
    const canopyGeo = new THREE.SphereGeometry(0.7, 6, 4);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2d8b2d, roughness: 0.8 });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.y = 2.0;
    canopy.castShadow = true;
    group.add(canopy);

    return group;
  }

  _createShrub() {
    const geo = new THREE.SphereGeometry(0.4, 6, 4);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a7a3a, roughness: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.4;
    mesh.castShadow = true;
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  }

  _createDefault() {
    const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.25;
    mesh.castShadow = true;
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  }

  build(decorationData, parentGroup) {
    this.dispose(parentGroup);

    for (const dec of decorationData) {
      let group;
      if (dec.type === 'tree' || dec.tall) {
        group = this._createTree();
      } else if (dec.type === 'shrub') {
        group = this._createShrub();
      } else {
        group = this._createDefault();
      }

      // Position at tile + sub-tile
      const tileX = dec.col * 2;
      const tileZ = dec.row * 2;
      const subX = (dec.subCol || 2) * SUB_UNIT; // default center of tile
      const subZ = (dec.subRow || 2) * SUB_UNIT;
      group.position.set(tileX + subX, 0, tileZ + subZ);

      this._groups.push(group);
      parentGroup.add(group);
    }
  }

  dispose(parentGroup) {
    for (const group of this._groups) {
      parentGroup.remove(group);
      group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this._groups = [];
  }
}
```

- [ ] **Step 3: Wire both into ThreeRenderer**

```javascript
import { EquipmentBuilder } from './equipment-builder.js';
import { DecorationBuilder } from './decoration-builder.js';
// In constructor:
this.equipmentBuilder = new EquipmentBuilder(this.textureManager);
this.decorationBuilder = new DecorationBuilder(this.textureManager);
```

Update `applySnapshot`:

```javascript
this.equipmentBuilder.build(snapshot.equipment, snapshot.furnishings, this.equipmentGroup);
this.decorationBuilder.build(snapshot.decorations, this.decorationGroup);
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/equipment-builder.js src/renderer3d/decoration-builder.js src/renderer3d/ThreeRenderer.js
git commit -m "feat: render equipment, furnishings, and decorations as 3D geometry"
```

---

## Task 10: Connection Builder

**Files:**
- Create: `src/renderer3d/connection-builder.js`

- [ ] **Step 1: Create connection-builder.js**

```javascript
// src/renderer3d/connection-builder.js
// Renders pipe/cable connections as thin cylinders along paths.
// Note: THREE is a CDN global.

const CONN_COLORS = {
  powerCable:   0xffcc00,
  coolingWater:  0x4488ff,
  cryogenics:    0x88ddff,
  vacuum:        0x888888,
  rfWaveguide:   0xff8844,
  dataFiber:     0x44ff88,
};

const CONN_RADIUS = 0.04;
const CONN_Y = 0.15; // run along the floor

export class ConnectionBuilder {
  constructor() {
    this._meshes = [];
  }

  build(connectionData, parentGroup) {
    this.dispose(parentGroup);

    for (const conn of connectionData) {
      const color = CONN_COLORS[conn.type] || 0x888888;
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.5,
        metalness: 0.3,
      });

      const path = conn.path || [];
      // If no path, draw a straight line between from and to
      const points = path.length >= 2 ? path : [
        { col: conn.fromCol, row: conn.fromRow },
        { col: conn.toCol, row: conn.toRow },
      ];

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        const x1 = p1.col * 2 + 1;
        const z1 = p1.row * 2 + 1;
        const x2 = p2.col * 2 + 1;
        const z2 = p2.row * 2 + 1;

        const dx = x2 - x1;
        const dz = z2 - z1;
        const length = Math.sqrt(dx * dx + dz * dz);
        if (length < 0.01) continue;

        const geo = new THREE.CylinderGeometry(CONN_RADIUS, CONN_RADIUS, length, 4);
        geo.rotateZ(Math.PI / 2);

        const mesh = new THREE.Mesh(geo, mat.clone());
        mesh.position.set((x1 + x2) / 2, CONN_Y, (z1 + z2) / 2);
        mesh.rotation.y = -Math.atan2(dz, dx);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();

        this._meshes.push(mesh);
        parentGroup.add(mesh);
      }
    }
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes = [];
  }
}
```

- [ ] **Step 2: Wire into ThreeRenderer**

```javascript
import { ConnectionBuilder } from './connection-builder.js';
// In constructor:
this.connectionBuilder = new ConnectionBuilder();
```

Update `applySnapshot`:

```javascript
this.connectionBuilder.build(snapshot.connections, this.connectionGroup);
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/connection-builder.js src/renderer3d/ThreeRenderer.js
git commit -m "feat: render connections as colored pipe geometry"
```

---

## Task 11: Camera Sync + PixiJS Overlay

**Files:**
- Create: `src/renderer3d/camera-sync.js`
- Create: `src/renderer3d/overlay.js`

- [ ] **Step 1: Create camera-sync.js**

```javascript
// src/renderer3d/camera-sync.js
// Syncs PixiJS overlay viewport to match Three.js orthographic camera.
// Note: THREE and PIXI are CDN globals.

/**
 * Project a 3D world position to 2D screen coordinates using the Three.js camera.
 */
export function worldToScreen(camera, worldX, worldY, worldZ, screenWidth, screenHeight) {
  const vec = new THREE.Vector3(worldX, worldY, worldZ);
  vec.project(camera);
  return {
    x: (vec.x * 0.5 + 0.5) * screenWidth,
    y: (-vec.y * 0.5 + 0.5) * screenHeight,
  };
}

/**
 * Sync a PixiJS world container's transform so it matches the Three.js camera.
 * Call this whenever the Three.js camera changes (pan, zoom, resize).
 */
export function syncOverlay(camera, pixiWorld, screenWidth, screenHeight) {
  // Project two known world points to find the PixiJS transform
  const origin = worldToScreen(camera, 0, 0, 0, screenWidth, screenHeight);
  const right = worldToScreen(camera, 2, 0, 0, screenWidth, screenHeight);
  const down = worldToScreen(camera, 0, 0, 2, screenWidth, screenHeight);

  // Scale: how many screen pixels per 2 world units (1 tile)
  const tileScreenW = Math.sqrt(
    Math.pow(right.x - origin.x, 2) + Math.pow(right.y - origin.y, 2)
  );

  // The PixiJS world uses the gridToIso coordinate system where
  // 1 tile = TILE_W=64 pixels at zoom=1
  // So the effective zoom = tileScreenW / (TILE_W / 2)
  // (TILE_W/2 because gridToIso uses half-tile for the x component)
  const pixiZoom = tileScreenW / 32; // 32 = TILE_W/2

  pixiWorld.scale.set(pixiZoom);
  pixiWorld.x = origin.x;
  pixiWorld.y = origin.y;
}
```

- [ ] **Step 2: Create overlay.js — PixiJS overlay canvas for grid, labels, cursors**

```javascript
// src/renderer3d/overlay.js
// Lightweight PixiJS canvas for 2D overlays (grid lines, labels, cursors).
// Note: PIXI is a CDN global.

import { TILE_W, TILE_H } from '../data/directions.js';
import { gridToIso, tileCenterIso } from '../renderer/grid.js';

export class Overlay {
  constructor() {
    this.app = null;
    this.world = null;
    this.gridLayer = null;
    this.labelLayer = null;
    this.cursorLayer = null;
  }

  async init() {
    this.app = new PIXI.Application();
    await this.app.init({
      resizeTo: window,
      backgroundAlpha: 0, // transparent
      antialias: false,
      resolution: 1,
    });

    // Style the overlay canvas
    this.app.canvas.style.position = 'absolute';
    this.app.canvas.style.top = '0';
    this.app.canvas.style.left = '0';
    this.app.canvas.style.zIndex = '20';
    this.app.canvas.style.pointerEvents = 'none'; // clicks pass through to Three.js

    const gameDiv = document.getElementById('game');
    gameDiv.appendChild(this.app.canvas);

    // World container — transform synced to Three.js camera
    this.world = new PIXI.Container();
    this.app.stage.addChild(this.world);

    this.gridLayer = new PIXI.Container();
    this.world.addChild(this.gridLayer);

    this.labelLayer = new PIXI.Container();
    this.world.addChild(this.labelLayer);

    this.cursorLayer = new PIXI.Container();
    this.world.addChild(this.cursorLayer);
  }

  drawGrid(infraOccupied, noGridSet) {
    this.gridLayer.removeChildren();
    const g = new PIXI.Graphics();
    const range = 30;

    for (let i = -range; i <= range; i++) {
      for (let j = -range; j < range; j++) {
        const k1 = `${i - 1},${j}`;
        const k2 = `${i},${j}`;
        if (noGridSet.has(k1) && noGridSet.has(k2)) continue;
        const start = gridToIso(i, j);
        const end = gridToIso(i, j + 1);
        g.moveTo(start.x, start.y);
        g.lineTo(end.x, end.y);
        g.stroke({ color: 0xffffff, width: 1, alpha: 0.04 });
      }
      for (let j = -range; j < range; j++) {
        const k1 = `${j},${i - 1}`;
        const k2 = `${j},${i}`;
        if (noGridSet.has(k1) && noGridSet.has(k2)) continue;
        const rStart = gridToIso(j, i);
        const rEnd = gridToIso(j + 1, i);
        g.moveTo(rStart.x, rStart.y);
        g.lineTo(rEnd.x, rEnd.y);
        g.stroke({ color: 0xffffff, width: 1, alpha: 0.04 });
      }
    }

    this.gridLayer.addChild(g);
  }

  clearLabels() {
    this.labelLayer.removeChildren();
  }

  clearCursors() {
    this.cursorLayer.removeChildren();
  }

  dispose() {
    this.app.destroy(true);
  }
}
```

- [ ] **Step 3: Wire overlay into ThreeRenderer**

In `ThreeRenderer.js`, add:

```javascript
import { Overlay } from './overlay.js';
import { syncOverlay } from './camera-sync.js';

// In constructor:
this.overlay = new Overlay();

// In init(), after setting up Three.js:
await this.overlay.init();

// In _animate(), after rendering:
syncOverlay(this.camera, this.overlay.world, window.innerWidth, window.innerHeight);

// In _onResize():
// overlay auto-resizes via resizeTo: window

// In zoomAt() and panBy(), after updating camera:
// syncOverlay is called every frame in _animate, so no extra call needed
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/camera-sync.js src/renderer3d/overlay.js src/renderer3d/ThreeRenderer.js
git commit -m "feat: add PixiJS overlay canvas with camera sync for grid/labels/cursors"
```

---

## Task 12: Event Wiring + Game Integration

**Files:**
- Modify: `src/renderer3d/ThreeRenderer.js`

- [ ] **Step 1: Add game event listener to ThreeRenderer**

Add to `ThreeRenderer.init()`:

```javascript
// Listen to game events and refresh relevant builders
this.game.on((event, data) => {
  switch (event) {
    case 'beamlineChanged':
    case 'loaded':
      this.refresh();
      break;
    case 'infrastructureChanged':
      this._refreshTerrain();
      this._refreshInfra();
      break;
    case 'decorationsChanged':
      this._refreshTerrain();
      this._refreshDecorations();
      break;
    case 'zonesChanged':
      this._refreshTerrain();
      this._refreshZones();
      break;
    case 'wallsChanged':
    case 'doorsChanged':
      this._refreshWalls();
      break;
    case 'facilityChanged':
      this._refreshEquipment();
      break;
    case 'connectionsChanged':
      this._refreshConnections();
      break;
    case 'beamToggled':
      this._refreshBeam();
      break;
  }
});
```

- [ ] **Step 2: Add partial refresh methods**

```javascript
_refreshTerrain() {
  const snap = buildWorldSnapshot(this.game);
  this.terrainBuilder.build(snap.terrain, this.terrainGroup);
}

_refreshInfra() {
  const snap = buildWorldSnapshot(this.game);
  this.infraBuilder.build(snap.infrastructure, this.infrastructureGroup);
}

_refreshWalls() {
  const snap = buildWorldSnapshot(this.game);
  this.wallBuilder.build(snap.walls, snap.doors, this.wallGroup, this.wallVisibilityMode);
}

_refreshZones() {
  // Zones are semi-transparent floor overlays — will be added when zone builder exists
}

_refreshEquipment() {
  const snap = buildWorldSnapshot(this.game);
  this.equipmentBuilder.build(snap.equipment, snap.furnishings, this.equipmentGroup);
}

_refreshDecorations() {
  const snap = buildWorldSnapshot(this.game);
  this.decorationBuilder.build(snap.decorations, this.decorationGroup);
}

_refreshConnections() {
  const snap = buildWorldSnapshot(this.game);
  this.connectionBuilder.build(snap.connections, this.connectionGroup);
}

_refreshBeam() {
  const snap = buildWorldSnapshot(this.game);
  this.beamBuilder.build(snap.beamPaths, this.componentGroup);
}
```

- [ ] **Step 3: Add screenToWorld for input compatibility**

The existing `InputHandler` calls `renderer.screenToWorld(x, y)`. The ThreeRenderer version (Task 1) uses raycasting to the ground plane — this already exists. Verify it returns `{ x, y }` in isometric screen coordinates that `isoToGrid()` can consume.

Actually, the InputHandler uses `isoToGrid(world.x, world.y)` on the result. The Three.js `screenToWorld` returns ground-plane coordinates, which need to be converted to grid differently. Add a helper:

```javascript
screenToGrid(screenX, screenY) {
  const world = this.screenToWorld(screenX, screenY);
  // world.x and world.y are 3D ground plane (X, Z) coordinates
  // Grid: col = floor(worldX / 2), row = floor(worldZ / 2)
  return {
    col: Math.floor(world.x / 2),
    row: Math.floor(world.y / 2), // world.y is actually Z in our mapping
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/ThreeRenderer.js
git commit -m "feat: wire game events to Three.js renderer refresh cycle"
```

---

## Task 13: Main.js Swap

**Files:**
- Modify: `src/main.js`
- Modify: `index.html`

- [ ] **Step 1: Update main.js to use ThreeRenderer**

Replace the renderer instantiation block. The ThreeRenderer needs to expose the same interface that `main.js` and `InputHandler` use:

- `screenToWorld(x, y)` — already implemented
- `zoomAt(x, y, delta)` — already implemented
- `panBy(dx, dy)` — already implemented
- `updateHover(col, row)` — add stub
- `setBuildMode(active, toolType)` — add stub
- `setBulldozerMode(active)` — add stub
- `setProbeMode(active)` — add stub
- `cycleLabelLevel()` — add stub
- `toggleZoneOverlay()` — add stub
- `updateCursorBendDir(dir)` — add stub
- `updatePlacementDir(dir)` — add stub
- `_renderCursors()` — add stub
- `_renderComponents()` — delegate to componentBuilder
- `_renderBeam()` — delegate to beamBuilder
- All `_on*Select` callback properties — add as null stubs
- `activeMode` — add property
- `zoom`, `world.x`, `world.y` — for save/load compatibility

Add these stubs/delegates to ThreeRenderer:

```javascript
// --- Compatibility interface for InputHandler and main.js ---

updateHover(col, row) {
  this.hoverCol = col;
  this.hoverRow = row;
}

setBuildMode(active, toolType) {
  this.buildMode = active;
  this.selectedToolType = toolType || null;
}

setBulldozerMode(active) {
  this.bulldozerMode = active;
  this.canvas.style.cursor = active ? 'crosshair' : '';
}

setProbeMode(active) {
  this.probeMode = active;
  this.canvas.style.cursor = active ? 'crosshair' : '';
}

cycleLabelLevel() {
  this.labelLevel = ((this.labelLevel || 0) + 1) % 5;
  return ['Everything', 'Furniture + Equipment + Beamline', 'Equipment + Beamline', 'Beamline', 'Nothing'][this.labelLevel];
}

toggleZoneOverlay() {
  this.zoneOverlayVisible = !this.zoneOverlayVisible;
  return this.zoneOverlayVisible;
}

updateCursorBendDir(dir) { this.cursorBendDir = dir; }
updatePlacementDir(dir) { this.placementDir = dir; }

// Render delegation
_renderCursors() { /* overlay cursor rendering — Phase 5 */ }
_renderComponents() { this._refreshComponents(); }
_renderBeam() { this._refreshBeam(); }
_renderInfrastructure() { this._refreshInfra(); }
_renderZones() { this._refreshZones(); }
_renderWalls() { this._refreshWalls(); }
_renderDoors() { this._refreshWalls(); }
_renderFacilityEquipment() { this._refreshEquipment(); }
_renderConnections() { this._refreshConnections(); }
_renderGrass() { this._refreshTerrain(); }
_renderDecorations() { this._refreshDecorations(); }

_refreshComponents() {
  const snap = buildWorldSnapshot(this.game);
  this.componentBuilder.build(snap.components, this.componentGroup);
}
```

- [ ] **Step 2: Update main.js imports**

Replace:

```javascript
import { Renderer } from './renderer/Renderer.js';
import './renderer/beamline-renderer.js';
import './renderer/infrastructure-renderer.js';
import './renderer/grass-renderer.js';
import './renderer/decoration-renderer.js';
```

With:

```javascript
import { ThreeRenderer } from './renderer3d/ThreeRenderer.js';
```

Keep these imports (still needed for DOM UI):

```javascript
import './renderer/hud.js';
import './renderer/overlays.js';
import './renderer/designer-renderer.js';
```

Change the renderer creation:

```javascript
const renderer = new ThreeRenderer(game);
window._renderer = renderer;
await renderer.init();
await renderer.loadAssets();
renderer.refresh();
```

- [ ] **Step 3: Handle the HUD/overlays prototype extensions**

The `hud.js`, `overlays.js`, and `designer-renderer.js` extend `Renderer.prototype`. They won't automatically attach to `ThreeRenderer`. For the swap, we need them to still work. Two options:

Option A: Make ThreeRenderer extend Renderer (inherits all prototype methods).
Option B: Import old Renderer and attach the HUD/overlay methods to ThreeRenderer prototype.

Option B is cleaner — keeps the classes separate:

```javascript
// At the top of main.js, after ThreeRenderer import:
import { Renderer as LegacyRenderer } from './renderer/Renderer.js';

// After ThreeRenderer is defined, copy over the DOM-based methods:
// hud.js, overlays.js, and designer-renderer.js extend Renderer.prototype
// We need those methods on ThreeRenderer.prototype too
const domMethods = [
  '_updateHUD', '_updateBeamSummary', '_generateCategoryTabs',
  '_renderPalette', '_refreshPalette', 'updatePalette',
  '_renderMachineTypeSelector', '_bindHUDEvents',
  '_updateSystemStatsVisibility', '_updateSystemStatsContent',
  '_renderVacuumStats', '_renderRfPowerStats', '_renderCryoStats',
  '_renderCoolingStats', '_renderPowerStats', '_renderDataControlsStats', '_renderOpsStats',
  '_buildTreeLayout', '_renderTechTree', '_bindTreeEvents', '_updateTreeProgress',
  '_renderGoalsOverlay',
  '_openBeamlineWindow', '_openMachineWindow', '_refreshContextWindows',
  '_updateAnchoredWindows',
  // designer-renderer methods used by BeamlineDesigner
  '_renderProbeFlags',
  'renderConnLinePreview', 'renderLinePreview',
  '_renderSubtilePreview', '_renderZoneFurnishings',
  '_renderNetworkOverlay',
];

for (const method of domMethods) {
  if (LegacyRenderer.prototype[method] && !ThreeRenderer.prototype[method]) {
    ThreeRenderer.prototype[method] = LegacyRenderer.prototype[method];
  }
}
```

This allows the DOM-based UI methods to work on the ThreeRenderer instance since they access `this.game`, `this.app` (for the overlay PixiJS app), etc.

Note: The ThreeRenderer needs `this.app` to point to the overlay PixiJS app for these methods to work. Set `this.app = this.overlay.app;` after overlay init.

- [ ] **Step 4: Test the full swap**

Open the game. The Three.js 3D world should render terrain, infrastructure, walls, components, equipment, decorations, connections, and beam paths. The DOM UI (HUD, palettes, popups, tech tree) should work as before. Click interaction will need InputHandler updates (next task).

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/renderer3d/ThreeRenderer.js
git commit -m "feat: swap main.js to use ThreeRenderer with legacy DOM method bridging"
```

---

## Task 14: InputHandler Adaptation

**Files:**
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Update mouse coordinate conversion**

The InputHandler calls `renderer.screenToWorld(x, y)` and then `isoToGrid(world.x, world.y)` to get grid coordinates. With ThreeRenderer, `screenToWorld` returns ground-plane world coordinates, not isometric screen coordinates.

Add a `screenToGrid` call path. In `InputHandler._bindMouse()`, where it calls:

```javascript
const world = renderer.screenToWorld(e.clientX, e.clientY);
const { col, row } = isoToGrid(world.x, world.y);
```

Replace with:

```javascript
const { col, row } = renderer.screenToGrid
  ? renderer.screenToGrid(e.clientX, e.clientY)
  : isoToGrid(renderer.screenToWorld(e.clientX, e.clientY).x, renderer.screenToWorld(e.clientX, e.clientY).y);
```

Or simpler — add `screenToGrid` to ThreeRenderer (already done in Task 12) and update InputHandler to use it throughout.

Find all instances of `isoToGrid(world.x, world.y)` in InputHandler.js and replace with `renderer.screenToGrid(e.clientX, e.clientY)`.

- [ ] **Step 2: Update wheel/zoom handler**

The zoom handler calls `renderer.zoomAt(x, y, delta)` — this already works in ThreeRenderer.

- [ ] **Step 3: Update pan handler**

The pan handler calls `renderer.panBy(dx, dy)` — this already works in ThreeRenderer.

- [ ] **Step 4: Test input**

Click on tiles, place infrastructure, drag to build walls, scroll to zoom, pan with WASD. All input should map correctly to the 3D world.

- [ ] **Step 5: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "feat: adapt InputHandler to ThreeRenderer coordinate system"
```

---

## Task 15: Cleanup — Remove Old Renderer Code

**Files:**
- Delete: `src/renderer/Renderer.js` (after verifying all DOM methods are bridged)
- Delete: `src/renderer/beamline-renderer.js`
- Delete: `src/renderer/infrastructure-renderer.js`
- Delete: `src/renderer/grass-renderer.js`
- Delete: `src/renderer/decoration-renderer.js`
- Delete: `src/renderer/sprites.js`
- Modify: `src/main.js` — remove old imports

- [ ] **Step 1: Verify nothing breaks with old files still present**

Run the game end-to-end. Place infrastructure, build beamlines, toggle beam, open tech tree, open designer, save/load. Everything should work via ThreeRenderer + bridged DOM methods.

- [ ] **Step 2: Remove old world-rendering files**

Delete:
- `src/renderer/beamline-renderer.js`
- `src/renderer/infrastructure-renderer.js`
- `src/renderer/grass-renderer.js`
- `src/renderer/decoration-renderer.js`

Keep `src/renderer/Renderer.js` for now — it's still imported for the DOM method bridging. Keep `src/renderer/sprites.js` — the SpriteManager is still referenced for PixelLab placeholder generation in the overlay/HUD.

- [ ] **Step 3: Clean up main.js imports**

Remove the old prototype extension imports that were for world rendering:

```javascript
// Remove these:
import './renderer/beamline-renderer.js';
import './renderer/infrastructure-renderer.js';
import './renderer/grass-renderer.js';
import './renderer/decoration-renderer.js';
```

The `hud.js`, `overlays.js`, and `designer-renderer.js` imports stay — they extend `Renderer.prototype` which is still used for the DOM method bridge.

- [ ] **Step 4: Commit**

```bash
git rm src/renderer/beamline-renderer.js src/renderer/infrastructure-renderer.js src/renderer/grass-renderer.js src/renderer/decoration-renderer.js
git add src/main.js
git commit -m "refactor: remove old PixiJS world rendering code, keep DOM UI methods"
```

---

## Task 16: Verify Full Game Flow

- [ ] **Step 1: End-to-end testing checklist**

Run through each of these in the browser:

1. Game loads — terrain visible with grass, brightness variation
2. Place infrastructure — floors appear with textures/colors
3. Build walls — 3D walls visible, cast shadows on floor
4. Place doors — door frames visible
5. Create zones — zone overlays visible
6. Place beamline components — 3D boxes/cylinders with correct colors
7. Toggle beam — green beam path visible between components
8. Place facility equipment — 3D meshes at sub-tile positions
9. Place decorations — trees with trunk + canopy, shrubs
10. Build connections — colored pipes between equipment
11. Pan/zoom — camera moves correctly, all objects stay aligned
12. Click component — popup opens (DOM UI works)
13. Open tech tree — renders correctly
14. Open beamline designer — schematic + plots work
15. Save/load — game state persists and restores
16. Labels visible at appropriate zoom levels
17. Wall visibility modes (W key) cycle correctly

- [ ] **Step 2: Fix any issues found**

Address each broken feature individually. Common issues to watch for:
- Coordinate misalignment between Three.js world and PixiJS overlay
- Missing DOM methods on ThreeRenderer (add to bridge list)
- Z-fighting between terrain and infrastructure floors (adjust Y offsets)
- Shadow artifacts (adjust shadow camera bounds)

- [ ] **Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix: address integration issues from renderer swap"
```
