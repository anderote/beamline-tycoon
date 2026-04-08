# Decorative Assets & Grass Base Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the starting map into a grass-covered field with scattered trees/shrubs, add a decorative item system, and integrate extracted RCT2 sprites for paths, trees, benches, lamps, fences, and hedges.

**Architecture:** A new grass base layer renders below the grid. Decorations are a new entity type (like infrastructure/zones) with their own data definitions, game state array, occupied grid, and render layer. Placing infrastructure implicitly clears grass/decorations; demolishing restores grass. Starting map seeds random trees/shrubs using a simple noise distribution.

**Tech Stack:** PIXI.js v8 (CDN global), vanilla JS modules, Python 3 for asset extraction.

---

### File Structure

**New files:**
- `src/data/decorations.js` — decoration item definitions (trees, shrubs, benches, lamps, fences)
- `src/renderer/grass-renderer.js` — grass base layer rendering (extends Renderer.prototype)
- `src/renderer/decoration-renderer.js` — decoration sprite rendering (extends Renderer.prototype)
- `src/game/map-generator.js` — starting map generation (scatter trees/shrubs)
- `tools/extract-pob-sprites.py` — Python script to extract sprites from RCT2 .pob files
- `assets/decorations/decoration-manifest.json` — manifest mapping decoration IDs to sprite files
- `assets/decorations/*.png` — extracted/processed decoration sprites

**Modified files:**
- `src/game/Game.js` — add decoration state, placement/removal methods, morale/reputation calc
- `src/renderer/Renderer.js` — add grassLayer + decorationLayer, wire up rendering
- `src/renderer/infrastructure-renderer.js` — clear decorations on infra placement
- `src/renderer/sprites.js` — load decoration sprites from manifest
- `src/data/modes.js` — add "Decorations" category to structure mode
- `src/renderer/hud.js` — add decoration palette entries + morale/reputation display
- `src/input/InputHandler.js` — handle decoration placement clicks

---

### Task 1: Extract RCT2 Decoration Sprites

**Files:**
- Create: `tools/extract-pob-sprites.py`
- Create: `assets/decorations/*.png`
- Create: `assets/decorations/decoration-manifest.json`

This task extracts usable decoration sprites from the already-exported g1.dat PNGs and the RCT2 grass terrain tiles. The .pob files use a proprietary format that's hard to parse, so we'll use a pragmatic approach: visually identify the best sprites from the g1 export and copy/rename them.

- [ ] **Step 1: Create the extraction/curation script**

This script finds the best decoration sprites from the g1.dat export, selects front-facing isometric views, and copies them with meaningful names.

```python
#!/usr/bin/env python3
"""Extract and curate RCT2 decoration sprites from g1.dat export."""
import os
import shutil
import json
from PIL import Image

G1_DIR = "assets/rct2-extracted/g1"
OUT_DIR = "assets/decorations"
os.makedirs(OUT_DIR, exist_ok=True)

# Grass terrain tiles (flat isometric, various grass textures)
# g1 indices 1955-1962: flat grass tiles facing different directions
GRASS_TILES = {
    "grass_0": 1955,
    "grass_1": 1956,
    "grass_2": 1957,
    "grass_3": 1958,
}

# Hedges/garden walls from the g1.dat (identified earlier as green isometric blocks)
# These are the 20900+ range hedges
HEDGE_SPRITES = {
    "hedge_front": 21179,
    "hedge_side": 21182,
}

# Benches, lamps, fences — from g1.dat UI/scenery ranges
# We'll identify these by scanning for small, distinctive sprites
# For items not in g1.dat (trees, shrubs), we'll generate simple procedural sprites

manifest = {}

# Copy grass tiles
for name, idx in GRASS_TILES.items():
    src = os.path.join(G1_DIR, f"{idx:05d}.png")
    if os.path.exists(src):
        dst = os.path.join(OUT_DIR, f"{name}.png")
        shutil.copy2(src, dst)
        img = Image.open(dst)
        manifest[name] = {
            "file": f"assets/decorations/{name}.png",
            "size": {"width": img.width, "height": img.height},
            "category": "grass"
        }
        print(f"  {name}: {img.width}x{img.height}")

# Copy hedge sprites
for name, idx in HEDGE_SPRITES.items():
    src = os.path.join(G1_DIR, f"{idx:05d}.png")
    if os.path.exists(src):
        dst = os.path.join(OUT_DIR, f"{name}.png")
        shutil.copy2(src, dst)
        img = Image.open(dst)
        manifest[name] = {
            "file": f"assets/decorations/{name}.png",
            "size": {"width": img.width, "height": img.height},
            "category": "hedge"
        }
        print(f"  {name}: {img.width}x{img.height}")

# Generate simple procedural tree sprites (isometric pixel art)
# These are better than trying to parse .pob binary format
def make_tree(name, trunk_color, canopy_color, width, height, canopy_h):
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    px = img.load()
    cx = width // 2
    # Draw trunk (2-3px wide brown rectangle)
    trunk_w = 2
    for y in range(height - 1, height - (height - canopy_h) - 1, -1):
        for x in range(cx - trunk_w // 2, cx + trunk_w // 2 + 1):
            if 0 <= x < width:
                px[x, y] = trunk_color
    # Draw canopy (diamond/oval shape)
    for y in range(canopy_h):
        # Width expands then contracts
        progress = y / canopy_h
        if progress < 0.6:
            w = int((progress / 0.6) * (width // 2))
        else:
            w = int((1.0 - (progress - 0.6) / 0.4) * (width // 2))
        w = max(1, w)
        for x in range(cx - w, cx + w + 1):
            if 0 <= x < width:
                # Slight color variation
                shade = 1.0 + (((x * 7 + y * 13) % 5) - 2) * 0.08
                r = min(255, int(canopy_color[0] * shade))
                g = min(255, int(canopy_color[1] * shade))
                b = min(255, int(canopy_color[2] * shade))
                px[x, y] = (r, g, b, 255)
    dst = os.path.join(OUT_DIR, f"{name}.png")
    img.save(dst)
    manifest[name] = {
        "file": f"assets/decorations/{name}.png",
        "size": {"width": width, "height": height},
        "category": "tree"
    }
    print(f"  {name}: {width}x{height} (generated)")

make_tree("oak_tree", (101, 67, 33, 255), (34, 120, 34), 20, 32, 24)
make_tree("pine_tree", (101, 67, 33, 255), (20, 80, 20), 14, 36, 30)
make_tree("small_tree", (101, 67, 33, 255), (50, 140, 50), 12, 20, 14)

# Generate shrub sprites
def make_shrub(name, color, width, height):
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    px = img.load()
    cx, cy = width // 2, height // 2
    for y in range(height):
        for x in range(width):
            dx = (x - cx) / (width / 2)
            dy = (y - cy) / (height / 2)
            if dx * dx + dy * dy <= 1.0:
                shade = 1.0 + (((x * 7 + y * 13) % 5) - 2) * 0.1
                r = min(255, int(color[0] * shade))
                g = min(255, int(color[1] * shade))
                b = min(255, int(color[2] * shade))
                px[x, y] = (r, g, b, 255)
    dst = os.path.join(OUT_DIR, f"{name}.png")
    img.save(dst)
    manifest[name] = {
        "file": f"assets/decorations/{name}.png",
        "size": {"width": width, "height": height},
        "category": "shrub"
    }
    print(f"  {name}: {width}x{height} (generated)")

make_shrub("shrub", (40, 110, 30), 10, 8)
make_shrub("flower_bed", (180, 60, 80), 12, 8)

# Generate simple bench, lamp, fence sprites
def make_bench(name):
    img = Image.new("RGBA", (16, 10), (0, 0, 0, 0))
    px = img.load()
    # Seat (brown plank)
    for x in range(2, 14):
        for y in range(3, 6):
            px[x, y] = (139, 90, 43, 255)
    # Legs
    for y in range(6, 10):
        px[3, y] = (80, 50, 20, 255)
        px[12, y] = (80, 50, 20, 255)
    # Back
    for x in range(2, 14):
        px[x, 2] = (120, 75, 35, 255)
    dst = os.path.join(OUT_DIR, f"{name}.png")
    img.save(dst)
    manifest[name] = {
        "file": f"assets/decorations/{name}.png",
        "size": {"width": 16, "height": 10},
        "category": "furniture"
    }
    print(f"  {name}: 16x10 (generated)")

def make_lamp(name):
    img = Image.new("RGBA", (6, 20), (0, 0, 0, 0))
    px = img.load()
    # Pole
    for y in range(4, 20):
        px[2, y] = (60, 60, 60, 255)
        px[3, y] = (80, 80, 80, 255)
    # Light
    for x in range(1, 5):
        for y in range(0, 4):
            px[x, y] = (255, 240, 180, 255)
    # Base
    for x in range(1, 5):
        px[x, 19] = (50, 50, 50, 255)
    dst = os.path.join(OUT_DIR, f"{name}.png")
    img.save(dst)
    manifest[name] = {
        "file": f"assets/decorations/{name}.png",
        "size": {"width": 6, "height": 20},
        "category": "lighting"
    }
    print(f"  {name}: 6x20 (generated)")

def make_fence(name):
    img = Image.new("RGBA", (32, 12), (0, 0, 0, 0))
    px = img.load()
    # Posts
    for y in range(0, 12):
        px[1, y] = (60, 60, 60, 255)
        px[15, y] = (60, 60, 60, 255)
        px[30, y] = (60, 60, 60, 255)
    # Rails
    for x in range(0, 32):
        px[x, 3] = (80, 80, 80, 255)
        px[x, 8] = (80, 80, 80, 255)
    dst = os.path.join(OUT_DIR, f"{name}.png")
    img.save(dst)
    manifest[name] = {
        "file": f"assets/decorations/{name}.png",
        "size": {"width": 32, "height": 12},
        "category": "fence"
    }
    print(f"  {name}: 32x12 (generated)")

make_bench("park_bench")
make_lamp("lamppost")
make_fence("iron_fence")

# Write manifest
manifest_path = os.path.join(OUT_DIR, "decoration-manifest.json")
with open(manifest_path, "w") as f:
    json.dump(manifest, f, indent=2)
print(f"\nManifest written: {manifest_path}")
print(f"Total assets: {len(manifest)}")
```

- [ ] **Step 2: Run the extraction script**

Run: `cd /Users/andrewcote/Documents/software/beamline-tycoon && python3 tools/extract-pob-sprites.py`
Expected: Output listing each extracted/generated sprite with dimensions, manifest written to `assets/decorations/decoration-manifest.json`

- [ ] **Step 3: Verify sprites visually**

Open a few of the generated PNGs to confirm they look reasonable. Check that grass tiles from g1.dat copied correctly and procedural trees/shrubs/benches have visible content.

- [ ] **Step 4: Commit**

```bash
git add tools/extract-pob-sprites.py assets/decorations/
git commit -m "feat: extract and generate decoration sprites from RCT2 assets"
```

---

### Task 2: Decoration Data Definitions

**Files:**
- Create: `src/data/decorations.js`

- [ ] **Step 1: Create decoration definitions**

```javascript
// Decoration items — placeable cosmetic/morale items on the map
export const DECORATIONS = {
  // === Outdoor (grass-only) ===
  oakTree: {
    id: 'oakTree', name: 'Oak Tree', cost: 15, removeCost: 10,
    morale: 1, placement: 'outdoor', spriteKey: 'oak_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  pineTree: {
    id: 'pineTree', name: 'Pine Tree', cost: 12, removeCost: 8,
    morale: 1, placement: 'outdoor', spriteKey: 'pine_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  smallTree: {
    id: 'smallTree', name: 'Small Tree', cost: 8, removeCost: 5,
    morale: 0.5, placement: 'outdoor', spriteKey: 'small_tree',
    blocksBuild: true, category: 'treesPlants',
  },
  shrub: {
    id: 'shrub', name: 'Shrub', cost: 3, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'shrub',
    blocksBuild: false, category: 'treesPlants',
  },
  flowerBed: {
    id: 'flowerBed', name: 'Flower Bed', cost: 5, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'flower_bed',
    blocksBuild: false, category: 'treesPlants',
  },
  parkBench: {
    id: 'parkBench', name: 'Park Bench', cost: 10, removeCost: 0,
    morale: 1, placement: 'outdoor', spriteKey: 'park_bench',
    blocksBuild: false, category: 'furniture',
  },
  lamppost: {
    id: 'lamppost', name: 'Lamppost', cost: 8, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'lamppost',
    blocksBuild: false, category: 'lighting',
  },
  ironFence: {
    id: 'ironFence', name: 'Iron Fence', cost: 4, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'iron_fence',
    blocksBuild: false, category: 'fencing',
  },
  hedge: {
    id: 'hedge', name: 'Hedge', cost: 6, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'hedge_front',
    blocksBuild: false, category: 'fencing',
  },
};

// Morale calculation: sum of all decoration morale values
// Multiplier = 1.0 + (totalMorale * 0.005), capped at 1.25
export function computeMoraleMultiplier(decorations) {
  let total = 0;
  for (const dec of decorations) {
    const def = DECORATIONS[dec.type];
    if (def) total += def.morale;
  }
  return Math.min(1.25, 1.0 + total * 0.005);
}

// Reputation tiers based on decoration count
export function getReputationTier(decorationCount) {
  if (decorationCount >= 60) return { label: 'Distinguished', fundingBonus: 0.10 };
  if (decorationCount >= 30) return { label: 'Pleasant', fundingBonus: 0.05 };
  if (decorationCount >= 10) return { label: 'Functional', fundingBonus: 0.02 };
  return { label: 'Spartan', fundingBonus: 0 };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/data/decorations.js
git commit -m "feat: add decoration item definitions with morale/reputation"
```

---

### Task 3: Game State & Placement Logic

**Files:**
- Modify: `src/game/Game.js`

Add decoration state arrays, placement methods, removal methods, and tree-blocking logic to the existing Game class.

- [ ] **Step 1: Add decoration state to Game constructor**

In `src/game/Game.js`, add these fields to `this.state` after the `zoneFurnishingNextId` line (~line 50):

```javascript
      // Decorations (trees, shrubs, benches, etc.)
      decorations: [],              // [{ id, type, col, row }]
      decorationOccupied: {},       // "col,row" -> decoration id
      decorationNextId: 1,
```

- [ ] **Step 2: Add decoration import at top of Game.js**

Add to the imports at the top of `src/game/Game.js`:

```javascript
import { DECORATIONS, computeMoraleMultiplier, getReputationTier } from '../data/decorations.js';
```

- [ ] **Step 3: Add decoration placement methods**

Add these methods to the Game class, after the zone furnishing methods:

```javascript
  // === DECORATIONS ===

  placeDecoration(col, row, decType) {
    const dec = DECORATIONS[decType];
    if (!dec) return false;
    const key = col + ',' + row;

    // Check placement rules
    if (this.state.decorationOccupied[key]) return false;
    if (dec.placement === 'outdoor') {
      // Outdoor items: must NOT be on infrastructure or zones
      if (this.state.infraOccupied[key] || this.state.zoneOccupied[key]) return false;
    } else if (dec.placement === 'indoor') {
      // Indoor items: must be on built flooring
      if (!this.state.infraOccupied[key]) return false;
    }

    // Check existing occupants (facility equipment, beamline, furnishings)
    if (this.state.facilityGrid[key]) return false;
    if (this.state.zoneFurnishingGrid[key]) return false;

    if (this.state.resources.funding < dec.cost) return false;

    const id = 'dec_' + (this.state.decorationNextId++);
    this.state.resources.funding -= dec.cost;
    this.state.decorations.push({ id, type: decType, col, row });
    this.state.decorationOccupied[key] = id;
    this.emit('decorationsChanged');
    return true;
  }

  removeDecoration(col, row) {
    const key = col + ',' + row;
    const decId = this.state.decorationOccupied[key];
    if (!decId) return false;

    const idx = this.state.decorations.findIndex(d => d.id === decId);
    if (idx === -1) return false;

    const dec = this.state.decorations[idx];
    const def = DECORATIONS[dec.type];
    const removeCost = def ? def.removeCost : 0;

    if (removeCost > 0 && this.state.resources.funding < removeCost) {
      this.log(`Need $${removeCost} to remove ${def.name}!`, 'bad');
      return false;
    }

    if (removeCost > 0) {
      this.state.resources.funding -= removeCost;
      this.log(`Removed ${def.name} ($${removeCost})`, '');
    }

    this.state.decorations.splice(idx, 1);
    delete this.state.decorationOccupied[key];
    this.emit('decorationsChanged');
    return true;
  }

  /** Check if a tile has a tree that blocks building. */
  hasBlockingDecoration(col, row) {
    const key = col + ',' + row;
    const decId = this.state.decorationOccupied[key];
    if (!decId) return false;
    const dec = this.state.decorations.find(d => d.id === decId);
    if (!dec) return false;
    const def = DECORATIONS[dec.type];
    return def ? def.blocksBuild : false;
  }

  /** Auto-clear non-blocking decorations when placing infrastructure. */
  _clearNonBlockingDecoration(col, row) {
    const key = col + ',' + row;
    const decId = this.state.decorationOccupied[key];
    if (!decId) return;
    const dec = this.state.decorations.find(d => d.id === decId);
    if (!dec) return;
    const def = DECORATIONS[dec.type];
    if (def && !def.blocksBuild) {
      this.state.decorations = this.state.decorations.filter(d => d.id !== decId);
      delete this.state.decorationOccupied[key];
    }
  }
```

- [ ] **Step 4: Modify placeInfraTile to check for blocking decorations and auto-clear non-blocking ones**

In `placeInfraTile` (line ~234), add at the start of the method, after `const key = col + ',' + row;`:

```javascript
    // Check for blocking decorations (trees)
    if (this.hasBlockingDecoration(col, row)) {
      this.log('Clear the tree first! (Use demolish)', 'bad');
      return false;
    }
    // Auto-clear non-blocking decorations (shrubs, benches)
    this._clearNonBlockingDecoration(col, row);
```

Add the same two lines in `placeInfraRect` inside the per-tile loop, before the placement logic (after `const key = c + ',' + r;` around line 295):

```javascript
        // Skip tiles with blocking decorations
        if (this.hasBlockingDecoration(c, r)) continue;
        // Auto-clear non-blocking decorations
        this._clearNonBlockingDecoration(c, r);
```

- [ ] **Step 5: Modify removeInfraTile to NOT restore decorations (grass layer handles this visually)**

No changes needed — grass is rendered as a base layer, so demolishing infrastructure automatically shows grass again.

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: add decoration placement/removal with tree blocking"
```

---

### Task 4: Sprite Loading for Decorations

**Files:**
- Modify: `src/renderer/sprites.js`

- [ ] **Step 1: Add decoration sprite loading to SpriteManager**

Add this method to the `SpriteManager` class in `src/renderer/sprites.js`, after the `loadTileSprites` method:

```javascript
  /**
   * Load decoration PNG sprites from assets/decorations/ using the manifest.
   */
  async loadDecorationSprites() {
    try {
      const resp = await fetch('assets/decorations/decoration-manifest.json');
      if (!resp.ok) return;
      const manifest = await resp.json();
      let count = 0;

      for (const [key, info] of Object.entries(manifest)) {
        const alias = `dec_${key}`;
        try {
          PIXI.Assets.add({ alias, src: info.file });
          const tex = await PIXI.Assets.load(alias);
          if (tex && tex.valid !== false) {
            this.textures[key] = tex;
            count++;
          }
        } catch (e) {
          console.warn(`Failed to load decoration sprite: ${info.file}`, e);
        }
      }
      console.log(`Loaded ${count} decoration sprites`);
    } catch {
      // No manifest yet — decorations will use colored fallbacks
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/sprites.js
git commit -m "feat: add decoration sprite loading from manifest"
```

---

### Task 5: Grass Base Layer Rendering

**Files:**
- Create: `src/renderer/grass-renderer.js`
- Modify: `src/renderer/Renderer.js`

- [ ] **Step 1: Create grass-renderer.js**

```javascript
// === GRASS BASE LAYER RENDERER ===
// Renders grass tiles on all unbuilt map tiles.
// Note: PIXI is a CDN global — not imported.

import { Renderer } from './Renderer.js';
import { TILE_W, TILE_H } from '../data/directions.js';
import { tileCenterIso } from './grid.js';

Renderer.prototype._renderGrass = function() {
  this.grassLayer.removeChildren();

  const range = 30;
  for (let col = -range; col <= range; col++) {
    for (let row = -range; row <= range; row++) {
      const key = col + ',' + row;
      // Skip tiles that have infrastructure or zones
      if (this.game.state.infraOccupied[key] || this.game.state.zoneOccupied[key]) continue;

      const pos = tileCenterIso(col, row);
      const hw = TILE_W / 2;
      const hh = TILE_H / 2;

      // Try to use grass texture, fall back to colored diamond
      const variant = ((col * 7 + row * 13) & 0xffff) % 4;
      const texture = this.sprites.getTexture(`grass_${variant}`) || this.sprites.getTexture('grass_0');

      if (texture) {
        const sprite = new PIXI.Sprite(texture);
        const scale = TILE_W / texture.width;
        sprite.anchor.set(0.5, 0.5);
        sprite.x = pos.x;
        sprite.y = pos.y;
        sprite.scale.set(scale, scale);
        this.grassLayer.addChild(sprite);
      } else {
        // Fallback: green diamond
        const g = new PIXI.Graphics();
        // Vary green shade by position for visual interest
        const shade = 0x338833 + ((col * 7 + row * 13) & 0x0f) * 0x010100;
        g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
        g.fill({ color: shade });
        this.grassLayer.addChild(g);
      }
    }
  }
};
```

- [ ] **Step 2: Add grassLayer to Renderer.init()**

In `src/renderer/Renderer.js`, add the grass layer in the `init()` method, right after the gridLayer creation (after line 124):

```javascript
    this.grassLayer = new PIXI.Container();
    this.grassLayer.zIndex = -0.5;
    this.world.addChild(this.grassLayer);
```

- [ ] **Step 3: Import grass-renderer.js in Renderer.js**

Add at the top of `src/renderer/Renderer.js`, after the existing extension imports (look for where `infrastructure-renderer.js` is imported — it may be in `main.js` instead). Find where infrastructure-renderer.js is imported and add alongside it:

```javascript
import './grass-renderer.js';
```

- [ ] **Step 4: Wire grass rendering to game events**

In `Renderer.js` `init()`, in the event listener switch (around line 190), add `this._renderGrass();` to the `'beamlineChanged'` / `'loaded'` case and the `'infrastructureChanged'` case:

```javascript
        case 'beamlineChanged':
        case 'loaded':
          this._renderGrass();
          // ... existing render calls ...
          break;
        case 'infrastructureChanged':
          this._renderGrass();
          this._renderInfrastructure();
          break;
```

Also add a new case for decorations:

```javascript
        case 'decorationsChanged':
          this._renderGrass();
          this._renderDecorations();
          break;
```

And add `this._renderGrass();` to the initial renders block (around line 237):

```javascript
    // 10. Initial renders
    this._renderGrass();
    this._generateCategoryTabs();
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/grass-renderer.js src/renderer/Renderer.js
git commit -m "feat: add grass base layer rendering on all unbuilt tiles"
```

---

### Task 6: Decoration Rendering

**Files:**
- Create: `src/renderer/decoration-renderer.js`
- Modify: `src/renderer/Renderer.js`

- [ ] **Step 1: Create decoration-renderer.js**

```javascript
// === DECORATION RENDERER ===
// Renders placed decorations (trees, shrubs, benches, etc.)
// Note: PIXI is a CDN global — not imported.

import { Renderer } from './Renderer.js';
import { TILE_W, TILE_H } from '../data/directions.js';
import { DECORATIONS } from '../data/decorations.js';
import { tileCenterIso } from './grid.js';

Renderer.prototype._renderDecorations = function() {
  this.decorationLayer.removeChildren();
  const decorations = this.game.state.decorations || [];

  // Sort by isometric depth
  const sorted = [...decorations].sort((a, b) => (a.col + a.row) - (b.col + b.row));

  for (const dec of sorted) {
    const def = DECORATIONS[dec.type];
    if (!def) continue;

    const pos = tileCenterIso(dec.col, dec.row);
    const texture = this.sprites.getTexture(def.spriteKey);

    if (texture) {
      const sprite = new PIXI.Sprite(texture);
      // Trees anchor at bottom-center so they extend upward
      // Other items anchor at center
      if (def.category === 'treesPlants' && def.blocksBuild) {
        sprite.anchor.set(0.5, 1.0);
      } else {
        sprite.anchor.set(0.5, 0.5);
      }
      sprite.x = pos.x;
      sprite.y = pos.y;
      sprite.zIndex = dec.col + dec.row;
      this.decorationLayer.addChild(sprite);
    } else {
      // Fallback: colored circle/diamond
      const g = new PIXI.Graphics();
      if (def.blocksBuild) {
        // Tree fallback: green triangle
        g.poly([pos.x, pos.y - 16, pos.x + 6, pos.y, pos.x - 6, pos.y]);
        g.fill({ color: 0x228822 });
        // Trunk
        g.rect(pos.x - 1, pos.y, 2, 6);
        g.fill({ color: 0x664422 });
      } else {
        // Small item fallback: colored dot
        g.circle(pos.x, pos.y, 3);
        g.fill({ color: 0x448844 });
      }
      g.zIndex = dec.col + dec.row;
      this.decorationLayer.addChild(g);
    }
  }
};
```

- [ ] **Step 2: Add decorationLayer to Renderer.init()**

In `src/renderer/Renderer.js`, add the decoration layer after the grassLayer (around where infraSidesLayer is defined):

```javascript
    this.decorationLayer = new PIXI.Container();
    this.decorationLayer.zIndex = 0.3;
    this.decorationLayer.sortableChildren = true;
    this.world.addChild(this.decorationLayer);
```

- [ ] **Step 3: Import decoration-renderer.js**

Same location as the grass-renderer import:

```javascript
import './decoration-renderer.js';
```

- [ ] **Step 4: Add initial decoration render call**

In the initial renders block of `Renderer.init()`:

```javascript
    this._renderGrass();
    this._renderDecorations();
    this._generateCategoryTabs();
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/decoration-renderer.js src/renderer/Renderer.js
git commit -m "feat: add decoration rendering layer with sprite and fallback support"
```

---

### Task 7: Starting Map Generation

**Files:**
- Create: `src/game/map-generator.js`
- Modify: `src/game/Game.js`

- [ ] **Step 1: Create map-generator.js**

```javascript
// === STARTING MAP GENERATOR ===
// Populates the map with scattered trees and shrubs for an RCT2-style green field start.

/**
 * Simple seeded pseudo-random number generator (mulberry32).
 */
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Generate starting decorations for a fresh map.
 * @param {number} seed — random seed for reproducibility
 * @param {number} range — half-size of map (default 30, so map is -30..30)
 * @returns {{ decorations: Array, nextId: number }}
 */
export function generateStartingMap(seed = 42, range = 30) {
  const rng = mulberry32(seed);
  const decorations = [];
  let nextId = 1;

  const treeTypes = ['oakTree', 'pineTree', 'smallTree'];
  const centerClearRadius = 8; // sparse center area for building

  for (let col = -range; col <= range; col++) {
    for (let row = -range; row <= range; row++) {
      // Distance from center (0,0)
      const dist = Math.sqrt(col * col + row * row);

      // Tree density increases with distance from center
      let treeProbability;
      if (dist < centerClearRadius) {
        treeProbability = 0.02; // very sparse in center
      } else if (dist < range * 0.5) {
        treeProbability = 0.08; // moderate in middle ring
      } else if (dist < range * 0.8) {
        treeProbability = 0.15; // denser outer ring
      } else {
        treeProbability = 0.25; // dense at edges
      }

      const roll = rng();
      if (roll < treeProbability) {
        // Place a tree
        const treeType = treeTypes[Math.floor(rng() * treeTypes.length)];
        decorations.push({
          id: 'dec_' + nextId++,
          type: treeType,
          col, row,
        });
      } else if (roll < treeProbability + 0.03 && dist > centerClearRadius) {
        // Small chance of shrub near trees
        const shrubType = rng() < 0.6 ? 'shrub' : 'flowerBed';
        decorations.push({
          id: 'dec_' + nextId++,
          type: shrubType,
          col, row,
        });
      }
    }
  }

  return { decorations, nextId };
}
```

- [ ] **Step 2: Wire map generation into Game constructor**

In `src/game/Game.js`, import the generator at the top:

```javascript
import { generateStartingMap } from './map-generator.js';
```

Then at the end of the Game constructor (after the `this.TICK_MS = 1000;` line), add:

```javascript
    // Generate starting map
    const startMap = generateStartingMap(Date.now());
    this.state.decorations = startMap.decorations;
    this.state.decorationNextId = startMap.nextId;
    // Build occupied lookup
    for (const dec of this.state.decorations) {
      this.state.decorationOccupied[dec.col + ',' + dec.row] = dec.id;
    }
```

- [ ] **Step 3: Commit**

```bash
git add src/game/map-generator.js src/game/Game.js
git commit -m "feat: generate starting map with scattered trees and shrubs"
```

---

### Task 8: Decoration Placement UI

**Files:**
- Modify: `src/data/modes.js`
- Modify: `src/renderer/hud.js`
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Add Decorations categories to structure mode in modes.js**

In `src/data/modes.js`, add these entries to the `structure.categories` object, after the `maintenance` entry:

```javascript
      treesPlants: { name: 'Trees & Plants', color: '#4a4', subsections: { treesPlants: { name: 'Trees & Plants' } } },
      furniture:   { name: 'Furniture',      color: '#864', subsections: { furniture: { name: 'Furniture' } } },
      lighting:    { name: 'Lighting',       color: '#aa8', subsections: { lighting: { name: 'Lighting' } } },
      fencing:     { name: 'Fencing',        color: '#686', subsections: { fencing: { name: 'Fencing' } } },
```

- [ ] **Step 2: Add decoration items to the HUD palette**

In `src/renderer/hud.js`, find where zone furnishing palette items are generated (search for `ZONE_FURNISHINGS`). After that section, add decoration palette generation. The pattern follows the existing furnishing rendering — look for how items are rendered in the palette for the current category and add:

```javascript
import { DECORATIONS } from '../data/decorations.js';
```

Then in the palette rendering logic, where items are listed for a selected category, add a check for decoration categories:

```javascript
    // Decoration items for Trees & Plants, Furniture, Lighting, Fencing tabs
    const decCategory = selectedCategory; // e.g., 'treesPlants', 'furniture', etc.
    const decItems = Object.values(DECORATIONS).filter(d => d.category === decCategory);
    for (const dec of decItems) {
      // Render palette item button with name, cost, and morale indicator
      // Follow the same pattern as furnishing palette items
    }
```

The exact integration depends on how `hud.js` structures its palette rendering. Match the existing pattern — each item should show name, cost ($X), and a small leaf/star icon with morale value.

- [ ] **Step 3: Handle decoration placement clicks in InputHandler.js**

In `src/input/InputHandler.js`, find where infrastructure/furnishing placement is handled on click. Add a branch for decoration placement:

```javascript
import { DECORATIONS } from '../data/decorations.js';
```

In the click handler, when the active mode is `structure` and the selected tool is a decoration type:

```javascript
    // Check if selected tool is a decoration
    if (DECORATIONS[this.selectedToolType]) {
      this.game.placeDecoration(col, row, this.selectedToolType);
      return;
    }
```

- [ ] **Step 4: Handle decoration demolishing**

In the demolish/bulldoze handler in `InputHandler.js`, add decoration removal before infrastructure removal:

```javascript
    // Try to remove decoration first
    if (this.game.removeDecoration(col, row)) return;
```

- [ ] **Step 5: Commit**

```bash
git add src/data/modes.js src/renderer/hud.js src/input/InputHandler.js
git commit -m "feat: add decoration placement UI with build menu tabs"
```

---

### Task 9: Morale & Reputation Integration

**Files:**
- Modify: `src/game/Game.js`
- Modify: `src/game/economy.js`

- [ ] **Step 1: Add morale/reputation to tick computation**

In `src/game/Game.js`, find the tick method (search for `tick()`). Add morale and reputation calculation:

```javascript
import { computeMoraleMultiplier, getReputationTier } from '../data/decorations.js';
```

In the tick method, after existing economy calculations:

```javascript
    // Decoration effects
    const moraleMultiplier = computeMoraleMultiplier(this.state.decorations);
    const repTier = getReputationTier(this.state.decorations.length);
    this.state.moraleMultiplier = moraleMultiplier;
    this.state.reputationTier = repTier;
```

- [ ] **Step 2: Apply morale multiplier to research speed**

Find where research progress is incremented in the tick (search for `researchProgress`). Multiply the increment by `moraleMultiplier`:

```javascript
    // Apply morale bonus to research speed
    this.state.researchProgress += researchRate * (this.state.moraleMultiplier || 1.0);
```

- [ ] **Step 3: Apply reputation bonus to funding generation**

Find where funding is generated per tick. Apply the reputation bonus:

```javascript
    const repBonus = this.state.reputationTier ? this.state.reputationTier.fundingBonus : 0;
    fundingGain *= (1.0 + repBonus);
```

- [ ] **Step 4: Commit**

```bash
git add src/game/Game.js src/game/economy.js
git commit -m "feat: integrate morale/reputation effects from decorations"
```

---

### Task 10: Load Decoration Sprites on Startup

**Files:**
- Modify: `src/renderer/Renderer.js` or `main.js` (wherever `loadTileSprites` is called)

- [ ] **Step 1: Call loadDecorationSprites after loadTileSprites**

Find where `sprites.loadTileSprites()` is called (likely in `main.js` or `Renderer.init()`). Add right after it:

```javascript
    await this.sprites.loadDecorationSprites();
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/Renderer.js
git commit -m "feat: load decoration sprites on startup"
```

---

### Task 11: Save/Load Support

**Files:**
- Modify: `src/game/Game.js` (wherever save/load is implemented)

- [ ] **Step 1: Include decorations in save data**

Find the save method (search for `save` or `toJSON` or `serialize`). Add decorations to the saved state:

```javascript
    // In save:
    saved.decorations = this.state.decorations;
    saved.decorationNextId = this.state.decorationNextId;
```

- [ ] **Step 2: Restore decorations on load**

Find the load method. Add decoration restoration:

```javascript
    // In load:
    this.state.decorations = saved.decorations || [];
    this.state.decorationNextId = saved.decorationNextId || 1;
    this.state.decorationOccupied = {};
    for (const dec of this.state.decorations) {
      this.state.decorationOccupied[dec.col + ',' + dec.row] = dec.id;
    }
```

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: save/load decoration state"
```

---

### Task 12: Final Integration & Polish

**Files:**
- Modify: `src/renderer/Renderer.js`
- Modify: `src/renderer/infrastructure-renderer.js`

- [ ] **Step 1: Re-render decorations when infrastructure changes**

In `infrastructure-renderer.js`, at the end of `_renderInfrastructure`, add:

```javascript
  // Re-render decorations since infra changes may have cleared some
  if (this._renderDecorations) this._renderDecorations();
```

- [ ] **Step 2: Ensure grass re-renders on zone changes too**

In the Renderer event handler, for the `'zonesChanged'` case, add:

```javascript
        case 'zonesChanged':
          this._renderGrass();
          this._renderZones();
          this._refreshPalette();
          break;
```

- [ ] **Step 3: Verify the full rendering layer order is correct**

Confirm the z-index ordering in Renderer.init():
```
grassLayer:       -0.5  (below grid)
infraSidesLayer:  -0.1
gridLayer:         0
decorationLayer:   0.3  (above grid, below infra)
infraLayer:        0.5
zoneLayer:         0.55
dragPreviewLayer:  0.6
connectionLayer:   0.7
beamLayer:         1
facilityLayer:     1.5
componentLayer:    2
cursorLayer:       3
labelLayer:        4
networkOverlay:    5000
```

- [ ] **Step 4: Test the full flow**

Open the game in browser. Verify:
1. Map starts covered in grass with scattered trees/shrubs
2. Trees block infrastructure placement (error message shown)
3. Bulldoze tool removes trees (costs money)
4. Placing concrete/labFloor clears grass visually
5. Demolishing infrastructure shows grass again
6. Decorations tab in Structure mode shows items
7. Can place benches, lamps on grass tiles
8. Cannot place outdoor items on built flooring

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete decoration system integration and polish"
```
