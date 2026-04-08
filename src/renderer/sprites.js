// === SPRITE MANAGER ===
// Generates and manages placeholder isometric box textures
// for all beamline components at multiple zoom levels.
// Note: PIXI is a CDN global — not imported

import { TILE_W, TILE_H } from '../data/directions.js';
import { COMPONENTS } from '../data/components.js';
import { ZONE_FURNISHINGS } from '../data/infrastructure.js';
import { tileCenterIso } from './grid.js';

export class SpriteManager {
  constructor() {
    this.textures = {}; // spriteKey -> PIXI.Texture
    this.tileTextures = {}; // gameId -> PIXI.Texture (single, for flooring)
    this.tileVariants = {}; // gameId -> [PIXI.Texture, ...] (multiple, for zones)
  }

  /**
   * Load tile PNG sprites from assets/tiles/ using the manifest.
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
          const textures = [];
          for (let i = 0; i < info.files.length; i++) {
            const alias = `tile_${gameId}_${i}`;
            try {
              PIXI.Assets.add({ alias, src: info.files[i] });
              const tex = await PIXI.Assets.load(alias);
              if (tex && tex.valid !== false) { textures.push(tex); count++; }
            } catch (e) {
              console.warn(`Failed to load tile variant: ${info.files[i]}`, e);
            }
          }
          if (textures.length) this.tileVariants[gameId] = textures;
        } else if (info.file) {
          // Single texture (flooring)
          const alias = `tile_${gameId}`;
          try {
            PIXI.Assets.add({ alias, src: info.file });
            const tex = await PIXI.Assets.load(alias);
            if (tex && tex.valid !== false) { this.tileTextures[gameId] = tex; count++; }
          } catch (e) {
            console.warn(`Failed to load tile sprite: ${info.file}`, e);
          }
        }
      }
      console.log(`Loaded ${count} tile sprites`);
    } catch {
      // No manifest yet — use colored fallbacks
    }
  }

  /**
   * Return single tile texture (flooring), or null.
   */
  getTileTexture(gameId) {
    return this.tileTextures[gameId] || null;
  }

  /**
   * Return a zone variant texture picked deterministically by position, or null.
   */
  getZoneTexture(gameId, col, row) {
    const variants = this.tileVariants[gameId];
    if (!variants || !variants.length) return null;
    const idx = ((col * 7 + row * 13) & 0xffff) % variants.length;
    return variants[idx];
  }

  /**
   * Generate a single isometric box texture for every component.
   * Zoom is handled by PixiJS container scaling, not texture swaps.
   */
  generatePlaceholders(app) {
    for (const key of Object.keys(COMPONENTS)) {
      const comp = COMPONENTS[key];
      const spriteKey = comp.spriteKey || key;
      const color = comp.spriteColor || 0x888888;

      // Always 1x1 tile size — multi-tile components draw one sprite per tile
      const gfx = this._drawIsoBox(TILE_W, TILE_H, color);
      this.textures[spriteKey] = app.renderer.generateTexture(gfx);
    }

    // Generate placeholders for zone furnishings
    if (typeof ZONE_FURNISHINGS !== 'undefined') {
      for (const key of Object.keys(ZONE_FURNISHINGS)) {
        const furn = ZONE_FURNISHINGS[key];
        const color = furn.spriteColor || 0x888888;
        const gfx = this._drawIsoBox(TILE_W, TILE_H, color);
        this.textures[key] = app.renderer.generateTexture(gfx);
      }
    }
  }

  /**
   * Return the texture for the given sprite key.
   */
  getTexture(spriteKey) {
    return this.textures[spriteKey] || null;
  }

  /**
   * Create a positioned PIXI.Sprite for a beamline node.
   */
  createNodeSprite(node) {
    const comp = COMPONENTS[node.type];
    if (!comp) return null;
    const spriteKey = comp.spriteKey || node.type;
    const texture = this.getTexture(spriteKey);
    if (!texture) return null;

    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.7);

    const pos = tileCenterIso(node.col, node.row);
    sprite.x = pos.x;
    sprite.y = pos.y;

    return sprite;
  }

  // --- Internal helpers ---

  /**
   * Draw an isometric box with top, left, and right faces.
   */
  _drawIsoBox(w, h, color) {
    const g = new PIXI.Graphics();
    const hw = w / 2;
    const hh = h / 2;
    const depth = hh; // box depth equals half-height

    // Top face — flat diamond filled with base color
    g.poly([0, 0, hw, -hh, w, 0, hw, hh]);
    g.fill({ color: color });

    // Left face — darkened (0.7x)
    const darkColor = this._darken(color, 0.7);
    g.poly([0, 0, hw, hh, hw, hh + depth, 0, depth]);
    g.fill({ color: darkColor });

    // Right face — slightly darkened (0.85x)
    const rightColor = this._darken(color, 0.85);
    g.poly([w, 0, hw, hh, hw, hh + depth, w, depth]);
    g.fill({ color: rightColor });

    // Top edge highlight stroke
    g.poly([0, 0, hw, -hh, w, 0, hw, hh]);
    g.stroke({ color: this._lighten(color, 1.3), width: 1 });

    return g;
  }

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
