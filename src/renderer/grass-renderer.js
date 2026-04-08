// === GRASS BASE LAYER RENDERER ===
// Renders grass tiles into a cached RenderTexture for performance.
// Only re-renders when built tiles change.
// Note: PIXI is a CDN global — not imported.

import { Renderer } from './Renderer.js';
import { TILE_W, TILE_H } from '../data/directions.js';
import { tileCenterIso, gridToIso } from './grid.js';

const GRASS_RANGE = 20;

// 24 variants grouped by brightness: dark (0-7), mid (8-15), light (16-23)
const DARK_VARIANTS  = [8, 9, 10, 11, 16, 17, 18, 19];   // dark + flipped-dark
const MID_VARIANTS   = [0, 1, 2, 3, 4, 5, 6, 7];         // base + flipped
const LIGHT_VARIANTS = [12, 13, 14, 15, 20, 21, 22, 23];  // light + flipped-light

/**
 * Sample the terrain brightness at a grid position using the stored gaussian blobs.
 * Returns a value roughly in [-1, 1].
 */
function sampleTerrainBrightness(col, row, blobs) {
  let val = 0;
  for (const blob of blobs) {
    // Rotate point into blob's local frame
    const dx = col - blob.cx;
    const dy = row - blob.cy;
    const cos = Math.cos(blob.angle);
    const sin = Math.sin(blob.angle);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    // 2D gaussian
    const ex = (lx * lx) / (2 * blob.sx * blob.sx);
    const ey = (ly * ly) / (2 * blob.sy * blob.sy);
    val += blob.brightness * Math.exp(-(ex + ey));
  }
  // Clamp to [-1, 1]
  return Math.max(-1, Math.min(1, val));
}

/**
 * Pick a grass variant index based on brightness and a hash for randomness.
 */
function pickVariant(brightness, hash) {
  let pool;
  if (brightness < -0.25) {
    pool = DARK_VARIANTS;
  } else if (brightness > 0.25) {
    pool = LIGHT_VARIANTS;
  } else {
    pool = MID_VARIANTS;
  }
  return pool[hash % pool.length];
}

/**
 * Rebuild the grass RenderTexture if the occupied tiles have changed.
 */
Renderer.prototype._renderGrass = function() {
  // Build cache key from occupied tiles
  const infraKeys = Object.keys(this.game.state.infraOccupied || {});
  const zoneKeys = Object.keys(this.game.state.zoneOccupied || {});
  const cacheKey = infraKeys.length + ',' + zoneKeys.length + ':' +
    infraKeys.slice(0, 20).join(';') + '|' + zoneKeys.slice(0, 20).join(';');

  if (this._grassCacheKey === cacheKey && this._grassSprite) return;
  this._grassCacheKey = cacheKey;

  // Calculate texture bounds
  const range = GRASS_RANGE;
  const texW = (range * 2 + 1) * TILE_W;
  const texH = (range * 2 + 1) * TILE_H;
  const offsetX = texW / 2;
  const offsetY = texH / 2;

  // Create or reuse RenderTexture
  if (!this._grassRT || this._grassRT.width !== texW || this._grassRT.height !== texH) {
    if (this._grassRT) this._grassRT.destroy();
    this._grassRT = PIXI.RenderTexture.create({ width: texW, height: texH });
  }

  const blobs = this.game.state.terrainBlobs || [];

  // Build a temporary container with all grass sprites
  const container = new PIXI.Container();

  for (let col = -range; col <= range; col++) {
    for (let row = -range; row <= range; row++) {
      const key = col + ',' + row;
      if (this.game.state.infraOccupied[key] || this.game.state.zoneOccupied[key]) continue;

      const pos = tileCenterIso(col, row);

      // Hash for pseudo-random variant within brightness bucket
      let h = ((col * 374761393 + row * 668265263) ^ 0x5bf03635) | 0;
      h = ((h ^ (h >>> 13)) * 1274126177) | 0;
      const hash = ((h >>> 16) ^ h) & 0x7fffffff;

      // Sample terrain brightness from gaussian blobs
      const brightness = sampleTerrainBrightness(col, row, blobs);
      const variantIdx = pickVariant(brightness, hash);
      const texture = this.sprites.getTexture(`grass_tile_${variantIdx}`) || this.sprites.getTexture('grass_tile_0');

      if (texture) {
        texture.source.scaleMode = 'nearest';
        const sprite = new PIXI.Sprite(texture);
        const scale = (TILE_W / texture.width) * 1.03;
        sprite.anchor.set(0.5, 0.5);
        sprite.x = pos.x + offsetX;
        sprite.y = pos.y + offsetY;
        sprite.scale.set(scale, scale);

        // Tint from continuous brightness — wider range for visible variation
        const tintFactor = 0.88 + brightness * 0.12; // 0.76 to 1.0
        const warmth = brightness * 0.05;
        const r = Math.min(255, Math.round((0.94 + warmth) * 255 * tintFactor));
        const g = Math.min(255, Math.round(255 * tintFactor));
        const b = Math.min(255, Math.round((0.94 - warmth) * 255 * tintFactor));
        sprite.tint = (r << 16) | (g << 8) | b;

        container.addChild(sprite);
      } else {
        const hw = TILE_W / 2;
        const hh = TILE_H / 2;
        const g = new PIXI.Graphics();
        const px = pos.x + offsetX;
        const py = pos.y + offsetY;
        const shade = 0x338833 + ((col * 7 + row * 13) & 0x0f) * 0x010100;
        g.poly([px, py - hh, px + hw, py, px, py + hh, px - hw, py]);
        g.fill({ color: shade });
        container.addChild(g);
      }
    }
  }

  // Render into the texture
  this.app.renderer.render({ container, target: this._grassRT, clear: true });
  container.destroy({ children: true });

  // Replace the grassLayer contents with a single sprite
  this.grassLayer.removeChildren();
  if (!this._grassSprite) {
    this._grassSprite = new PIXI.Sprite(this._grassRT);
  } else {
    this._grassSprite.texture = this._grassRT;
  }
  this._grassSprite.x = -offsetX;
  this._grassSprite.y = -offsetY;
  this.grassLayer.addChild(this._grassSprite);
};
