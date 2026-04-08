// === GRASS BASE LAYER RENDERER ===
// Renders grass tiles into a cached RenderTexture for performance.
// Only re-renders when built tiles change.
// Note: PIXI is a CDN global — not imported.

import { Renderer } from './Renderer.js';
import { TILE_W, TILE_H } from '../data/directions.js';
import { tileCenterIso, gridToIso } from './grid.js';

const GRASS_RANGE = 20;

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
  // Isometric extents: the diamond spans from (-range,-range) to (range,range)
  // Screen bounds: x from -(range)*TILE_W to (range)*TILE_W, y from -(range)*TILE_H to (range)*TILE_H
  const texW = (range * 2 + 1) * TILE_W;
  const texH = (range * 2 + 1) * TILE_H;
  const offsetX = texW / 2;
  const offsetY = texH / 2;

  // Create or reuse RenderTexture
  if (!this._grassRT || this._grassRT.width !== texW || this._grassRT.height !== texH) {
    if (this._grassRT) this._grassRT.destroy();
    this._grassRT = PIXI.RenderTexture.create({ width: texW, height: texH });
  }

  // Build a temporary container with all grass sprites
  const container = new PIXI.Container();

  for (let col = -range; col <= range; col++) {
    for (let row = -range; row <= range; row++) {
      const key = col + ',' + row;
      if (this.game.state.infraOccupied[key] || this.game.state.zoneOccupied[key]) continue;

      const pos = tileCenterIso(col, row);
      const variant = ((col * 7 + row * 13) & 0xffff) % 4;
      const texture = this.sprites.getTexture(`grass_tile_${variant}`) || this.sprites.getTexture('grass_tile_0');

      if (texture) {
        const sprite = new PIXI.Sprite(texture);
        const scale = (TILE_W / texture.width) * 1.03;
        sprite.anchor.set(0.5, 0.5);
        sprite.x = pos.x + offsetX;
        sprite.y = pos.y + offsetY;
        sprite.scale.set(scale, scale);
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
