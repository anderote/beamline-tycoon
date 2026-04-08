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
      if (this.game.state.infraOccupied[key] || this.game.state.zoneOccupied[key]) continue;

      const pos = tileCenterIso(col, row);
      const hw = TILE_W / 2;
      const hh = TILE_H / 2;
      const variant = ((col * 7 + row * 13) & 0xffff) % 4;
      const texture = this.sprites.getTexture(`grass_tile_${variant}`) || this.sprites.getTexture('grass_tile_0');

      if (texture) {
        const sprite = new PIXI.Sprite(texture);
        const scale = (TILE_W / texture.width) * 1.03;
        sprite.anchor.set(0.5, 0.5);
        sprite.x = pos.x;
        sprite.y = pos.y;
        sprite.scale.set(scale, scale);
        this.grassLayer.addChild(sprite);
      } else {
        const g = new PIXI.Graphics();
        const shade = 0x338833 + ((col * 7 + row * 13) & 0x0f) * 0x010100;
        g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
        g.fill({ color: shade });
        this.grassLayer.addChild(g);
      }
    }
  }
};
