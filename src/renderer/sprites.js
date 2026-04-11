// === SPRITE MANAGER ===
// Generates and manages placeholder isometric box textures
// for all beamline components at multiple zoom levels.
// Note: PIXI is a CDN global — not imported

import { TILE_W, TILE_H } from '../data/directions.js';
import { COMPONENTS } from '../data/components.js';
import { ZONE_FURNISHINGS, INFRASTRUCTURE } from '../data/infrastructure.js';
import { tileCenterIso } from './grid.js';

export class SpriteManager {
  constructor() {
    this.textures = {}; // spriteKey -> PIXI.Texture
    this.tileTextures = {}; // gameId -> PIXI.Texture (single, for flooring)
    this.tileVariants = {}; // gameId -> [PIXI.Texture, ...] (multiple, for zones)
    this.floorVariants = {}; // gameId -> [PIXI.Texture, ...] (floor color variants)
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
          const paths = [];
          for (let i = 0; i < info.files.length; i++) {
            const alias = `tile_${gameId}_${i}`;
            try {
              PIXI.Assets.add({ alias, src: info.files[i] });
              const tex = await PIXI.Assets.load(alias);
              if (tex && tex.valid !== false) { textures.push(tex); paths.push(info.files[i]); count++; }
            } catch (e) {
              console.warn(`Failed to load tile variant: ${info.files[i]}`, e);
            }
          }
          if (textures.length) this.tileVariants[gameId] = textures;
          if (paths.length) this.zoneVariantPaths[gameId] = paths;
        } else if (info.file) {
          // Single texture (flooring)
          const alias = `tile_${gameId}`;
          try {
            PIXI.Assets.add({ alias, src: info.file });
            const tex = await PIXI.Assets.load(alias);
            if (tex && tex.valid !== false) { this.tileTextures[gameId] = tex; this.tilePaths[gameId] = info.file; count++; }
          } catch (e) {
            console.warn(`Failed to load tile sprite: ${info.file}`, e);
          }
          // Load floor color variants if present
          if (info.variants) {
            const varTextures = [];
            for (let i = 0; i < info.variants.length; i++) {
              const vAlias = `tile_${gameId}_v${i}`;
              try {
                PIXI.Assets.add({ alias: vAlias, src: info.variants[i].file });
                const vTex = await PIXI.Assets.load(vAlias);
                if (vTex && vTex.valid !== false) { varTextures.push(vTex); count++; }
              } catch (e) {
                console.warn(`Failed to load floor variant: ${info.variants[i].file}`, e);
              }
            }
            if (varTextures.length) this.floorVariants[gameId] = varTextures;
          }
        }
      }
      console.log(`Loaded ${count} tile sprites`);
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
        const alias = `dec_${key}`;
        try {
          PIXI.Assets.add({ alias, src: info.file });
          const tex = await PIXI.Assets.load(alias);
          if (tex && tex.valid !== false) {
            this.textures[key] = tex;
            this.spritePaths[key] = info.file;
            count++;
          }
        } catch (e) {
          console.warn(`Failed to load decoration sprite: ${info.file}`, e);
        }
      }
      console.log(`Loaded ${count} decoration sprites`);
    } catch {
      // No manifest yet
    }
  }

  /**
   * Return single tile texture (flooring), or null.
   * If variantIndex is provided, return that floor variant texture.
   */
  getTileTexture(gameId, variantIndex) {
    if (variantIndex != null && this.floorVariants[gameId]) {
      return this.floorVariants[gameId][variantIndex] || this.tileTextures[gameId] || null;
    }
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

    // Generate placeholders for zone furnishings using proper isometric projection
    if (typeof ZONE_FURNISHINGS !== 'undefined') {
      for (const key of Object.keys(ZONE_FURNISHINGS)) {
        const furn = ZONE_FURNISHINGS[key];
        const color = furn.spriteColor || 0x888888;
        const gw = furn.gridW || 1;
        const gh = furn.gridH || 1;
        const gfx = this._drawIsoSubgridBox(gw, gh, color);
        this.textures[key] = app.renderer.generateTexture(gfx);

        // Generate rotated variant for non-square furnishings
        if (gw !== gh) {
          const rotGfx = this._drawIsoSubgridBox(gh, gw, color);
          this.textures[key + '_rotated'] = app.renderer.generateTexture(rotGfx);
        }
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
   * Return the file path for a sprite/decoration/tile for use in HTML img tags.
   */
  getSpritePath(key) {
    return this.spritePaths[key] || null;
  }

  getTilePath(gameId) {
    // Prefer the new texture-material PNG if the INFRASTRUCTURE entry
    // declares one — these are the same square seamless textures the
    // 3D renderer applies to floors, and read better as palette
    // previews than the old isometric diamond images.
    const infra = INFRASTRUCTURE[gameId];
    if (infra && infra.texture) {
      return `assets/textures/materials/${infra.texture}.png`;
    }
    return this.tilePaths[gameId] || null;
  }

  getZoneVariantPath(gameId, col, row) {
    const paths = this.zoneVariantPaths[gameId];
    if (!paths || !paths.length) return null;
    const idx = ((col * 7 + row * 13) & 0xffff) % paths.length;
    return paths[idx];
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

    // Apply per-sprite offsets from asset generator
    const path = this.spritePaths[spriteKey];
    if (path) {
      const off = this.getSpriteOffset(path);
      sprite.x = pos.x + (off.x || 0);
      sprite.y = pos.y + (off.y || 0);
      if (off.scale && off.scale !== 1) sprite.scale.set(off.scale);
    } else {
      sprite.x = pos.x;
      sprite.y = pos.y;
    }

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
   * Draw an isometric box for a sub-grid furnishing using proper isometric projection.
   * gw/gh are sub-grid cell counts. The diamond matches subGridToIso math.
   */
  _drawIsoSubgridBox(gw, gh, color) {
    const g = new PIXI.Graphics();
    const subW = TILE_W / 4;
    const subH = TILE_H / 4;

    // Top face corners via isometric projection (matching subGridToIso)
    const top   = { x: 0, y: 0 };
    const right = { x:  gw * subW / 2, y: gw * subH / 2 };
    const bot   = { x: (gw - gh) * subW / 2, y: (gw + gh) * subH / 2 };
    const left  = { x: -gh * subW / 2, y: gh * subH / 2 };

    const depth = Math.max(gw, gh) * subH / 2;

    // Top face
    g.poly([top.x, top.y, right.x, right.y, bot.x, bot.y, left.x, left.y]);
    g.fill({ color });

    // Left face (left → bottom, extend down)
    const darkColor = this._darken(color, 0.7);
    g.poly([left.x, left.y, bot.x, bot.y, bot.x, bot.y + depth, left.x, left.y + depth]);
    g.fill({ color: darkColor });

    // Right face (right → bottom, extend down)
    const rightColor = this._darken(color, 0.85);
    g.poly([right.x, right.y, bot.x, bot.y, bot.x, bot.y + depth, right.x, right.y + depth]);
    g.fill({ color: rightColor });

    // Top edge highlight
    g.poly([top.x, top.y, right.x, right.y, bot.x, bot.y, left.x, left.y]);
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
