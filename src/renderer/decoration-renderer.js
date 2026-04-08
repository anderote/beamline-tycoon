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
  const sorted = [...decorations].sort((a, b) => (a.col + a.row) - (b.col + b.row));

  for (const dec of sorted) {
    const def = DECORATIONS[dec.type];
    if (!def) continue;
    const pos = tileCenterIso(dec.col, dec.row);
    const texture = this.sprites.getTexture(def.spriteKey);

    if (texture) {
      texture.source.scaleMode = 'nearest';
      const sprite = new PIXI.Sprite(texture);
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
      const g = new PIXI.Graphics();
      if (def.blocksBuild) {
        g.poly([pos.x, pos.y - 16, pos.x + 6, pos.y, pos.x - 6, pos.y]);
        g.fill({ color: 0x228822 });
        g.rect(pos.x - 1, pos.y, 2, 6);
        g.fill({ color: 0x664422 });
      } else {
        g.circle(pos.x, pos.y, 3);
        g.fill({ color: 0x448844 });
      }
      g.zIndex = dec.col + dec.row;
      this.decorationLayer.addChild(g);
    }
  }
};
