// === SPRITE MANAGER ===
// Path/manifest bookkeeping for sprite assets. The Three.js renderer loads
// its own textures (see renderer3d/texture-manager.js); what survives here
// is the manifest → file-path mapping used by the DOM HUD (palette previews
// via <img> tags) plus per-sprite offset data from the asset generator.

import { FLOORS, WALL_TYPES, DOOR_TYPES, WINDOW_TYPES } from '../data/structure.js';

export class SpriteManager {
  constructor() {
    this.spritePaths = {}; // spriteKey -> file path (for HTML img previews)
    this.tilePaths = {}; // gameId -> file path
    this.zoneVariantPaths = {}; // gameId -> [file path, ...]
    this.spriteOffsets = {}; // file path -> { x, y, rotation, scale }
  }

  /**
   * Load sprite offsets from assets/components/offsets.json.
   * These are per-sprite-file adjustments set in the asset generator preview grid.
   */
  async loadSpriteOffsets() {
    try {
      const resp = await fetch('assets/components/offsets.json');
      if (!resp.ok) return;
      this.spriteOffsets = await resp.json();
      console.log(`Loaded sprite offsets for ${Object.keys(this.spriteOffsets).length} sprites`);
    } catch {
      // No offsets file yet
    }
  }

  /**
   * Get offset for a sprite path. Returns { x, y, rotation, scale } or defaults.
   */
  getSpriteOffset(path) {
    return this.spriteOffsets[path] || { x: 0, y: 0, scale: 1 };
  }

  /**
   * Record tile sprite paths from assets/tiles/tile-manifest.json.
   * Supports both single file (flooring) and files array (zone variants).
   */
  async loadTileSprites() {
    try {
      const resp = await fetch('assets/tiles/tile-manifest.json');
      if (!resp.ok) return;
      const manifest = await resp.json();
      let count = 0;

      for (const [gameId, info] of Object.entries(manifest)) {
        if (info.files) {
          // Multiple variants (zones)
          this.zoneVariantPaths[gameId] = info.files.slice();
          count += info.files.length;
        } else if (info.file) {
          // Single path (flooring)
          this.tilePaths[gameId] = info.file;
          count++;
        }
      }
      console.log(`Indexed ${count} tile sprites`);
    } catch {
      // No manifest yet — use colored fallbacks
    }
  }

  async loadDecorationSprites() {
    try {
      const resp = await fetch('assets/decorations/decoration-manifest.json');
      if (!resp.ok) return;
      const manifest = await resp.json();
      let count = 0;
      for (const [key, info] of Object.entries(manifest)) {
        if (info.file) {
          this.spritePaths[key] = info.file;
          count++;
        }
      }
      console.log(`Indexed ${count} decoration sprites`);
    } catch {
      // No manifest yet
    }
  }

  /**
   * Return the file path for a sprite/decoration/tile for use in HTML img tags.
   */
  getSpritePath(key) {
    return this.spritePaths[key] || null;
  }

  getTilePath(gameId, variant = 0) {
    // Prefer the new texture-material PNG if the FLOORS or WALL_TYPES
    // entry declares one. Variant-aware: if the def declares
    // variantTextures, pick the one matching the currently selected
    // variant so the palette preview mirrors what will be placed.
    // WINDOW_TYPES entries have no `texture`/`variantTextures` of their
    // own (frameTexture drives the 3D frame material, not a palette
    // thumbnail) — including them here just means a window key resolves to
    // no def-driven path and falls through to the tilePaths/swatch
    // fallback below, matching the design's colour-swatch-only scope.
    const def = FLOORS[gameId] || WALL_TYPES[gameId] || DOOR_TYPES[gameId] || WINDOW_TYPES[gameId];
    if (def) {
      const varTex = def.variantTextures?.[variant];
      if (varTex) return `assets/textures/materials/${varTex}.png`;
      if (def.texture) return `assets/textures/materials/${def.texture}.png`;
    }
    return this.tilePaths[gameId] || null;
  }

  getZoneVariantPath(gameId, col, row) {
    const paths = this.zoneVariantPaths[gameId];
    if (!paths || !paths.length) return null;
    const idx = ((col * 7 + row * 13) & 0xffff) % paths.length;
    return paths[idx];
  }

  // --- Color helpers (used by hud.js for CSS iso-box previews) ---

  /**
   * Darken a color by multiplying each RGB channel by factor.
   */
  _darken(color, factor) {
    const r = Math.floor(((color >> 16) & 0xff) * factor);
    const g = Math.floor(((color >> 8) & 0xff) * factor);
    const b = Math.floor((color & 0xff) * factor);
    return (r << 16) | (g << 8) | b;
  }

  /**
   * Lighten a color by multiplying each RGB channel by factor, capping at 255.
   */
  _lighten(color, factor) {
    const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor));
    const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor));
    const b = Math.min(255, Math.floor((color & 0xff) * factor));
    return (r << 16) | (g << 8) | b;
  }
}
