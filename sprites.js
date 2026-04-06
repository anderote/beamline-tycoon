// === BEAMLINE COWBOY: COORDINATE UTILITIES & SPRITE MANAGER ===

/**
 * Convert grid coordinates (col, row) to isometric screen position.
 */
function gridToIso(col, row) {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}

/**
 * Convert isometric screen position back to grid coordinates (col, row).
 */
function isoToGrid(screenX, screenY) {
  return {
    col: Math.floor((screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2),
    row: Math.floor((screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2),
  };
}

/**
 * SpriteManager — generates and manages placeholder isometric box textures
 * for all beamline components at multiple zoom levels.
 */
class SpriteManager {
  constructor() {
    this.textures = {}; // spriteKey -> { far, mid, close }
  }

  /**
   * Generate placeholder isometric box textures for every component
   * at three zoom levels (far, mid, close).
   */
  generatePlaceholders(app) {
    for (const key of Object.keys(COMPONENTS)) {
      const comp = COMPONENTS[key];
      const spriteKey = comp.spriteKey || key;
      const color = comp.spriteColor || 0x888888;
      const tl = Math.min(comp.trackLength || 1, 2); // cap at 2

      // far: small diamond
      const farW = TILE_W * 0.6;
      const farH = TILE_H * 0.6;
      const farGfx = this._drawIsoBox(farW, farH, color);
      const farTex = app.renderer.generateTexture(farGfx);

      // mid: normal size based on trackLength (capped at 2)
      const midW = TILE_W * tl;
      const midH = TILE_H * tl;
      const midGfx = this._drawIsoBox(midW, midH, color);
      const midTex = app.renderer.generateTexture(midGfx);

      // close: 1.5x of mid
      const closeW = midW * 1.5;
      const closeH = midH * 1.5;
      const closeGfx = this._drawIsoBox(closeW, closeH, color);
      const closeTex = app.renderer.generateTexture(closeGfx);

      this.textures[spriteKey] = {
        far: farTex,
        mid: midTex,
        close: closeTex,
      };
    }
  }

  /**
   * Return the appropriate texture for the given zoom level.
   */
  getTexture(spriteKey, zoom) {
    const entry = this.textures[spriteKey];
    if (!entry) return null;
    if (zoom < 0.5) return entry.far;
    if (zoom < 1.5) return entry.mid;
    return entry.close;
  }

  /**
   * Create a positioned PIXI.Sprite for a beamline node.
   */
  createNodeSprite(node, zoom) {
    const comp = COMPONENTS[node.type];
    if (!comp) return null;
    const spriteKey = comp.spriteKey || node.type;
    const texture = this.getTexture(spriteKey, zoom);
    if (!texture) return null;

    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.7);

    const pos = gridToIso(node.col, node.row);
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
