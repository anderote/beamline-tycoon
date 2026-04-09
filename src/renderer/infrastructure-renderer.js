// === INFRASTRUCTURE RENDERER EXTENSION ===
// Adds infrastructure, zone, facility, connection, and drag preview rendering to Renderer.prototype.
// Note: PIXI is a CDN global — not imported.

import { Renderer } from './Renderer.js';
import { COMPONENTS } from '../data/components.js';
import { TILE_W, TILE_H } from '../data/directions.js';
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS, WALL_TYPES, DOOR_TYPES } from '../data/infrastructure.js';
import { CONNECTION_TYPES } from '../data/modes.js';
import { tileCenterIso, subGridToIso, gridToIso } from './grid.js';
import { Networks } from '../networks/networks.js';

// --- Infrastructure rendering ---

Renderer.prototype._renderInfrastructure = function() {
  this.infraLayer.removeChildren();
  this.infraSidesLayer.removeChildren();
  const tiles = this.game.state.infrastructure || [];
  // Build a lookup set for occupied positions
  const occupied = new Set();
  for (const tile of tiles) occupied.add(`${tile.col},${tile.row}`);
  // Sort by isometric depth so front tiles overlap back tiles
  const sorted = [...tiles].sort((a, b) => (a.col + a.row) - (b.col + b.row));
  for (const tile of sorted) {
    const infra = INFRASTRUCTURE[tile.type];
    if (!infra) continue;
    const hasRight = occupied.has(`${tile.col + 1},${tile.row}`);
    const hasBelow = occupied.has(`${tile.col},${tile.row + 1}`);
    // Use foundation side color if tile sits on a foundation
    const sideColor = tile.foundation ? (INFRASTRUCTURE[tile.foundation]?.color || infra.color) : infra.color;
    this._drawInfraTile(tile.col, tile.row, infra, hasRight, hasBelow, tile.variant, sideColor, tile.orientation);
  }

  // Re-render decorations since infra changes may have cleared some
  if (this._renderDecorations) this._renderDecorations();
};

Renderer.prototype._drawInfraTile = function(col, row, infra, hasRight, hasBelow, variant, sideColor, orientation) {
  const pos = tileCenterIso(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const depth = 6;
  const sColor = sideColor || infra.color;
  const isoDepth = col + row;

  // Side faces — drawn below the grid layer so grid lines appear on top
  if ((!hasRight || !hasBelow) && !infra.noBase) {
    const sides = new PIXI.Graphics();
    if (!hasRight) {
      sides.poly([pos.x, pos.y + hh, pos.x + hw, pos.y, pos.x + hw, pos.y + depth, pos.x, pos.y + hh + depth]);
      sides.fill({ color: sColor });
    }
    if (!hasBelow) {
      sides.poly([pos.x - hw, pos.y, pos.x, pos.y + hh, pos.x, pos.y + hh + depth, pos.x - hw, pos.y + depth]);
      sides.fill({ color: sColor });
    }
    this.infraSidesLayer.addChild(sides);
  }

  // Top face — use sprite if available, otherwise colored polygon
  const texture = this.sprites.getTileTexture(infra.id, variant);
  if (texture) {
    const sprite = new PIXI.Sprite(texture);
    // RCT2 tiles are isometric diamond-shaped (64x31 or 64x48) — scale by width only
    // Old hand-drawn square tiles (64x64) need the 1.35x multiplier to fill the diamond
    const isIsoDiamond = texture.height < TILE_H * 2.1;
    const scale = isIsoDiamond
      ? (TILE_W / texture.width) * 1.03
      : (TILE_W / texture.width) * 1.35;
    sprite.anchor.set(0.5, 0.5);
    sprite.x = pos.x;
    sprite.y = pos.y - (isIsoDiamond ? 0 : texture.height * scale * 0.04);
    // Flip horizontally for orientable tiles (rotates pattern in iso space)
    const baseFlip = infra.id === 'groomedGrass' ? -1 : 1;
    const flipX = (orientation === 1 && infra.orientable) ? -baseFlip : baseFlip;
    sprite.scale.set(scale * flipX, scale);
    // Apply variant tint if defined (e.g. lab floor color variants)
    if (variant != null && infra.variantTints && infra.variantTints[variant] != null) {
      sprite.tint = infra.variantTints[variant];
    }
    sprite.zIndex = isoDepth;
    this.infraLayer.addChild(sprite);
  } else {
    const top = new PIXI.Graphics();
    top.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
    top.fill({ color: infra.topColor });
    top.zIndex = isoDepth;
    this.infraLayer.addChild(top);
  }
};

// --- Wall rendering (edge-based) ---

Renderer.prototype._renderWalls = function() {
  // Remove previous wall graphics from componentLayer
  if (this.wallGraphics) {
    for (const key in this.wallGraphics) {
      const g = this.wallGraphics[key];
      g.destroy();
    }
  }
  this.wallGraphics = {};
  const walls = this.game.state.walls || [];
  const sorted = [...walls].sort((a, b) => (a.col + a.row) - (b.col + b.row));
  const renderedWalls = new Set();
  for (const wall of sorted) {
    const wt = WALL_TYPES[wall.type];
    if (!wt) continue;
    // Skip walls where a door exists (door frame replaces the wall segment)
    if (this._hasDoorOnEdge(wall.col, wall.row, wall.edge)) continue;
    // Normalize n/w edges to s/e on the adjacent tile with flipped thickness
    let { col: rc, row: rr, edge: re } = wall;
    let flip = false;
    if (wall.edge === 'n') { rr -= 1; re = 's'; flip = true; }
    else if (wall.edge === 'w') { rc -= 1; re = 'e'; flip = true; }
    // Skip duplicate walls that normalize to the same edge (e.g. tile A 'e' and tile B 'w')
    const renderKey = `${rc},${rr},${re}`;
    if (renderedWalls.has(renderKey)) continue;
    renderedWalls.add(renderKey);
    this._drawWallEdge(rc, rr, re, wt, flip);
  }
  this._cutawayHoverKey = null; // invalidate room cache on wall data change
  this._applyWallVisibility();
};

Renderer.prototype._drawWallEdge = function(col, row, edge, wt, flip) {
  const pos = tileCenterIso(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const h = wt.wallHeight;
  const t = wt.thickness || 0;
  const g = new PIXI.Graphics();
  const s = flip ? -1 : 1; // flip thickness direction for n/w edges

  // Perpendicular offset for thickness (inward from edge toward tile center)
  // 'e' edge normal points NW: (-0.447, -0.894) per pixel of thickness
  // 's' edge normal points NE: ( 0.447, -0.894) per pixel of thickness
  // side 1 flips outward
  const pdx = (edge === 'e' ? -0.447 * t : 0.447 * t) * s;
  const pdy = -0.894 * t * s;

  if (edge === 'e') {
    const rx = pos.x + hw, ry = pos.y;      // right vertex
    const bx = pos.x, by = pos.y + hh;      // bottom vertex

    if (t > 0) {
      // Back face (further from camera, darker)
      g.poly([
        rx + pdx, ry + pdy,
        bx + pdx, by + pdy,
        bx + pdx, by + pdy - h,
        rx + pdx, ry + pdy - h,
      ]);
      g.fill({ color: this._darkenWallColor(wt.color, 0.6) });

      // Top surface (connects front top edge to back top edge)
      g.poly([
        rx, ry - h,
        bx, by - h,
        bx + pdx, by + pdy - h,
        rx + pdx, ry + pdy - h,
      ]);
      g.fill({ color: wt.topColor });
    }

    // Front face (SE edge, closest to camera)
    g.poly([rx, ry, bx, by, bx, by - h, rx, ry - h]);
    g.fill({ color: this._darkenWallColor(wt.color, 0.85) });

    // Top edge highlight
    g.moveTo(rx, ry - h);
    g.lineTo(bx, by - h);
    g.stroke({ color: wt.topColor, width: 1, alpha: 0.6 });
  } else {
    const bx = pos.x, by = pos.y + hh;      // bottom vertex
    const lx = pos.x - hw, ly = pos.y;      // left vertex

    if (t > 0) {
      // Back face
      g.poly([
        bx + pdx, by + pdy,
        lx + pdx, ly + pdy,
        lx + pdx, ly + pdy - h,
        bx + pdx, by + pdy - h,
      ]);
      g.fill({ color: this._darkenWallColor(wt.color, 0.5) });

      // Top surface
      g.poly([
        bx, by - h,
        lx, ly - h,
        lx + pdx, ly + pdy - h,
        bx + pdx, by + pdy - h,
      ]);
      g.fill({ color: wt.topColor });
    }

    // Front face (SW edge)
    g.poly([bx, by, lx, ly, lx, ly - h, bx, by - h]);
    g.fill({ color: this._darkenWallColor(wt.color, 0.7) });

    // Top edge highlight
    g.moveTo(bx, by - h);
    g.lineTo(lx, ly - h);
    g.stroke({ color: wt.topColor, width: 1, alpha: 0.6 });
  }

  g.zIndex = col + row + 0.6;
  this.componentLayer.addChild(g);
  this.wallGraphics[`${col},${row},${edge}`] = g;
};

// Check if a door exists on this edge (checking both sides of the shared edge)
Renderer.prototype._hasDoorOnEdge = function(col, row, edge) {
  const doorOcc = this.game.state.doorOccupied || {};
  if (doorOcc[`${col},${row},${edge}`]) return true;
  if (edge === 'e' && doorOcc[`${col + 1},${row},w`]) return true;
  if (edge === 'w' && doorOcc[`${col - 1},${row},e`]) return true;
  if (edge === 's' && doorOcc[`${col},${row + 1},n`]) return true;
  if (edge === 'n' && doorOcc[`${col},${row - 1},s`]) return true;
  return false;
};

Renderer.prototype._darkenWallColor = function(color, factor) {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const gn = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (gn << 8) | b;
};

Renderer.prototype._detectRoom = function(startCol, startRow) {
  const wallOcc = this.game.state.wallOccupied || {};
  const doorOcc = this.game.state.doorOccupied || {};
  const room = new Set();
  const queue = [`${startCol},${startRow}`];
  room.add(queue[0]);
  const MAX_TILES = 500;

  // An edge is blocked only if a wall exists AND no door provides passage
  const edgeBlocked = (wallKey1, wallKey2, doorKey1, doorKey2) =>
    (wallOcc[wallKey1] || wallOcc[wallKey2]) && !doorOcc[doorKey1] && !doorOcc[doorKey2];

  while (queue.length > 0 && room.size < MAX_TILES) {
    const key = queue.shift();
    const [c, r] = key.split(',').map(Number);

    // East: blocked by wall at (c,r,'e') or (c+1,r,'w'), unless door exists
    const eKey = `${c + 1},${r}`;
    if (!room.has(eKey) && !edgeBlocked(`${c},${r},e`, `${c+1},${r},w`, `${c},${r},e`, `${c+1},${r},w`)) {
      room.add(eKey);
      queue.push(eKey);
    }

    // West: blocked by wall at (c-1,r,'e') or (c,r,'w'), unless door exists
    const wKey = `${c - 1},${r}`;
    if (!room.has(wKey) && !edgeBlocked(`${c-1},${r},e`, `${c},${r},w`, `${c-1},${r},e`, `${c},${r},w`)) {
      room.add(wKey);
      queue.push(wKey);
    }

    // South: blocked by wall at (c,r,'s') or (c,r+1,'n'), unless door exists
    const sKey = `${c},${r + 1}`;
    if (!room.has(sKey) && !edgeBlocked(`${c},${r},s`, `${c},${r+1},n`, `${c},${r},s`, `${c},${r+1},n`)) {
      room.add(sKey);
      queue.push(sKey);
    }

    // North: blocked by wall at (c,r-1,'s') or (c,r,'n'), unless door exists
    const nKey = `${c},${r - 1}`;
    if (!room.has(nKey) && !edgeBlocked(`${c},${r-1},s`, `${c},${r},n`, `${c},${r-1},s`, `${c},${r},n`)) {
      room.add(nKey);
      queue.push(nKey);
    }
  }

  return room;
};

// Flood-fill to find contiguous tiles of the same type as the hovered tile,
// then expand by one tile to include neighbors.
Renderer.prototype._detectContiguousTileRegion = function(startCol, startRow) {
  const tiles = this.game.state.infrastructure || [];

  // Build a lookup: "col,row" -> tile type
  const tileMap = {};
  for (const tile of tiles) {
    tileMap[`${tile.col},${tile.row}`] = tile.type;
  }

  const startKey = `${startCol},${startRow}`;
  const startType = tileMap[startKey];
  if (!startType) return null; // not hovering over an infrastructure tile

  // BFS flood-fill for contiguous same-type tiles
  const contiguous = new Set();
  const queue = [startKey];
  contiguous.add(startKey);
  const MAX_TILES = 1000;

  while (queue.length > 0 && contiguous.size < MAX_TILES) {
    const key = queue.shift();
    const [c, r] = key.split(',').map(Number);

    const neighbors = [
      `${c + 1},${r}`, `${c - 1},${r}`,
      `${c},${r + 1}`, `${c},${r - 1}`,
    ];

    for (const nKey of neighbors) {
      if (!contiguous.has(nKey) && tileMap[nKey] === startType) {
        contiguous.add(nKey);
        queue.push(nKey);
      }
    }
  }

  // Expand region: add all tiles that touch the contiguous set
  const expanded = new Set(contiguous);
  for (const key of contiguous) {
    const [c, r] = key.split(',').map(Number);
    const neighbors = [
      `${c + 1},${r}`, `${c - 1},${r}`,
      `${c},${r + 1}`, `${c},${r - 1}`,
    ];
    for (const nKey of neighbors) {
      if (tileMap[nKey]) {
        expanded.add(nKey);
      }
    }
  }

  return expanded;
};

Renderer.prototype._applyWallVisibility = function() {
  const mode = this.wallVisibilityMode;

  if (mode === 'down') {
    for (const key in this.wallGraphics) {
      this.wallGraphics[key].visible = false;
    }
    return;
  }

  if (mode === 'up') {
    for (const key in this.wallGraphics) {
      const g = this.wallGraphics[key];
      g.visible = true;
      g.alpha = 1.0;
    }
    return;
  }

  if (mode === 'transparent') {
    for (const key in this.wallGraphics) {
      const g = this.wallGraphics[key];
      g.visible = true;
      const edge = key.split(',')[2];
      g.alpha = (edge === 'e' || edge === 's') ? 0.25 : 1.0;
    }
    return;
  }

  if (mode === 'cutaway') {
    const hoverKey = `${this.hoverCol},${this.hoverRow}`;
    if (hoverKey !== this._transparentHoverKey) {
      this._transparentHoverKey = hoverKey;
      this._transparentTiles = this._detectContiguousTileRegion(this.hoverCol, this.hoverRow);
    }
    const region = this._transparentTiles;
    if (!region || region.size === 0) {
      for (const key in this.wallGraphics) {
        this.wallGraphics[key].visible = true;
        this.wallGraphics[key].alpha = 1.0;
      }
      return;
    }

    const walls = this.game.state.walls || [];
    for (const wall of walls) {
      let nc = wall.col, nr = wall.row, ne = wall.edge;
      if (wall.edge === 'n') { nr -= 1; ne = 's'; }
      else if (wall.edge === 'w') { nc -= 1; ne = 'e'; }

      const g = this.wallGraphics[`${nc},${nr},${ne}`];
      if (!g) continue;

      let bordersRegion = false;
      if (ne === 'e') {
        bordersRegion = region.has(`${nc},${nr}`) || region.has(`${nc + 1},${nr}`);
      } else {
        bordersRegion = region.has(`${nc},${nr}`) || region.has(`${nc},${nr + 1}`);
      }

      if (bordersRegion) {
        g.visible = true;
        g.alpha = 0.15;
      } else {
        g.visible = true;
        g.alpha = 1.0;
      }
    }
    return;
  }
};

Renderer.prototype._applyDoorVisibility = function() {
  const mode = this.wallVisibilityMode;

  if (mode === 'down') {
    for (const key in this.doorGraphics) {
      this.doorGraphics[key].visible = false;
    }
    return;
  }

  if (mode === 'up') {
    for (const key in this.doorGraphics) {
      const g = this.doorGraphics[key];
      g.visible = true;
      g.alpha = 1.0;
    }
    return;
  }

  if (mode === 'transparent') {
    for (const key in this.doorGraphics) {
      const g = this.doorGraphics[key];
      g.visible = true;
      const edge = key.split(',')[2];
      g.alpha = (edge === 'e' || edge === 's') ? 0.25 : 1.0;
    }
    return;
  }

  if (mode === 'cutaway') {
    const region = this._transparentTiles;
    if (!region || region.size === 0) {
      for (const key in this.doorGraphics) {
        this.doorGraphics[key].visible = true;
        this.doorGraphics[key].alpha = 1.0;
      }
      return;
    }

    const doors = this.game.state.doors || [];
    for (const door of doors) {
      let nc = door.col, nr = door.row, ne = door.edge;
      if (door.edge === 'n') { nr -= 1; ne = 's'; }
      else if (door.edge === 'w') { nc -= 1; ne = 'e'; }

      const g = this.doorGraphics[`${nc},${nr},${ne}`];
      if (!g) continue;

      let bordersRegion = false;
      if (ne === 'e') {
        bordersRegion = region.has(`${nc},${nr}`) || region.has(`${nc + 1},${nr}`);
      } else {
        bordersRegion = region.has(`${nc},${nr}`) || region.has(`${nc},${nr + 1}`);
      }

      if (bordersRegion) {
        g.visible = true;
        g.alpha = 0.15;
      } else {
        g.visible = true;
        g.alpha = 1.0;
      }
    }
    return;
  }
};

Renderer.prototype.renderWallPreview = function(path, wallType) {
  this.dragPreviewLayer.removeChildren();
  if (!path || path.length === 0) return;

  const wt = WALL_TYPES[wallType];
  if (!wt) return;
  const totalCost = path.length * wt.cost;
  const canAfford = this.game.state.resources.funding >= totalCost;

  for (const pt of path) {
    // Normalize n/w to s/e on adjacent tile for rendering
    let rc = pt.col, rr = pt.row, re = pt.edge;
    if (pt.edge === 'n') { rr -= 1; re = 's'; }
    else if (pt.edge === 'w') { rc -= 1; re = 'e'; }

    const pos = tileCenterIso(rc, rr);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const h = wt.wallHeight;
    const occupied = this.game.state.wallOccupied[`${pt.col},${pt.row},${pt.edge}`];
    const ok = canAfford && !occupied;
    const g = new PIXI.Graphics();

    if (re === 'e') {
      g.poly([
        pos.x + hw, pos.y,
        pos.x, pos.y + hh,
        pos.x, pos.y + hh - h,
        pos.x + hw, pos.y - h,
      ]);
    } else {
      g.poly([
        pos.x, pos.y + hh,
        pos.x - hw, pos.y,
        pos.x - hw, pos.y - h,
        pos.x, pos.y + hh - h,
      ]);
    }
    g.fill({ color: ok ? wt.color : 0xcc3333, alpha: 0.5 });
    g.stroke({ color: ok ? 0xffffff : 0xff4444, width: 1, alpha: 0.5 });
    this.dragPreviewLayer.addChild(g);
  }

  const last = path[path.length - 1];
  const labelPos = tileCenterIso(last.col, last.row);
  const label = new PIXI.Text({
    text: `$${totalCost} (${path.length} segments)`,
    style: { fontFamily: 'monospace', fontSize: 10, fill: canAfford ? 0xffffff : 0xff4444 },
  });
  label.anchor.set(0.5, 0.5);
  label.x = labelPos.x;
  label.y = labelPos.y - 16;
  this.dragPreviewLayer.addChild(label);
};

Renderer.prototype.renderWallEdgeHighlight = function(col, row, edge, color) {
  this.dragPreviewLayer.removeChildren();
  if (col == null || edge == null) return;
  const tint = color || 0xffffff;

  // Cross indicator on the owning tile
  const tilePos = tileCenterIso(col, row);
  const cg = new PIXI.Graphics();
  const cs = 4; // cross arm length
  cg.moveTo(tilePos.x - cs, tilePos.y);
  cg.lineTo(tilePos.x + cs, tilePos.y);
  cg.moveTo(tilePos.x, tilePos.y - cs);
  cg.lineTo(tilePos.x, tilePos.y + cs);
  cg.stroke({ color: tint, width: 1.5, alpha: 0.8 });
  this.dragPreviewLayer.addChild(cg);

  // Normalize n/w to s/e on adjacent tile for edge line
  let rc = col, rr = row, re = edge;
  if (edge === 'n') { rr -= 1; re = 's'; }
  else if (edge === 'w') { rc -= 1; re = 'e'; }

  const pos = tileCenterIso(rc, rr);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const g = new PIXI.Graphics();

  if (re === 'e') {
    g.moveTo(pos.x + hw, pos.y);
    g.lineTo(pos.x, pos.y + hh);
  } else {
    g.moveTo(pos.x, pos.y + hh);
    g.lineTo(pos.x - hw, pos.y);
  }
  g.stroke({ color: tint, width: 2, alpha: 0.7 });
  this.dragPreviewLayer.addChild(g);
};

// --- Door rendering (edge-based, drawn as opening in wall) ---

Renderer.prototype._renderDoors = function() {
  if (this.doorGraphics) {
    for (const key in this.doorGraphics) {
      this.doorGraphics[key].destroy();
    }
  }
  this.doorGraphics = {};
  this.doorLayer.removeChildren();
  const doors = this.game.state.doors || [];
  const sorted = [...doors].sort((a, b) => (a.col + a.row) - (b.col + b.row));
  const renderedDoors = new Set();
  for (const door of sorted) {
    const dt = DOOR_TYPES[door.type];
    if (!dt) continue;
    // Normalize n/w edges to s/e on adjacent tile for rendering
    let { col: rc, row: rr, edge: re } = door;
    if (door.edge === 'n') { rr -= 1; re = 's'; }
    else if (door.edge === 'w') { rc -= 1; re = 'e'; }
    const renderKey = `${rc},${rr},${re}`;
    if (renderedDoors.has(renderKey)) continue;
    renderedDoors.add(renderKey);
    this._drawDoorEdge(rc, rr, re, dt);
  }
  this._applyDoorVisibility();
};

Renderer.prototype._drawDoorEdge = function(col, row, edge, dt) {
  const pos = tileCenterIso(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const h = dt.wallHeight;
  const isoDepth = (col + row) * 10 + 5;
  const g = new PIXI.Graphics();

  // Door frame posts (two narrow pillars at each end of the edge)
  const postWidth = 0.15; // fraction of edge length for each post

  if (edge === 'e') {
    // SE edge: right vertex (pos.x+hw, pos.y) to bottom vertex (pos.x, pos.y+hh)
    const x0 = pos.x + hw, y0 = pos.y;
    const x1 = pos.x, y1 = pos.y + hh;
    const dx = x1 - x0, dy = y1 - y0;

    // Left post
    g.poly([
      x0, y0,
      x0 + dx * postWidth, y0 + dy * postWidth,
      x0 + dx * postWidth, y0 + dy * postWidth - h,
      x0, y0 - h,
    ]);
    g.fill({ color: this._darkenWallColor(dt.color, 0.85) });

    // Right post
    g.poly([
      x0 + dx * (1 - postWidth), y0 + dy * (1 - postWidth),
      x1, y1,
      x1, y1 - h,
      x0 + dx * (1 - postWidth), y0 + dy * (1 - postWidth) - h,
    ]);
    g.fill({ color: this._darkenWallColor(dt.color, 0.85) });

    // Top lintel connecting the posts
    g.moveTo(x0, y0 - h);
    g.lineTo(x1, y1 - h);
    g.stroke({ color: dt.topColor, width: 2, alpha: 0.8 });

    // Threshold line at ground level (dashed look via short segment)
    g.moveTo(x0 + dx * postWidth, y0 + dy * postWidth);
    g.lineTo(x0 + dx * (1 - postWidth), y0 + dy * (1 - postWidth));
    g.stroke({ color: dt.topColor, width: 1, alpha: 0.3 });
  } else {
    // SW edge: bottom vertex (pos.x, pos.y+hh) to left vertex (pos.x-hw, pos.y)
    const x0 = pos.x, y0 = pos.y + hh;
    const x1 = pos.x - hw, y1 = pos.y;
    const dx = x1 - x0, dy = y1 - y0;

    // Left post
    g.poly([
      x0, y0,
      x0 + dx * postWidth, y0 + dy * postWidth,
      x0 + dx * postWidth, y0 + dy * postWidth - h,
      x0, y0 - h,
    ]);
    g.fill({ color: this._darkenWallColor(dt.color, 0.7) });

    // Right post
    g.poly([
      x0 + dx * (1 - postWidth), y0 + dy * (1 - postWidth),
      x1, y1,
      x1, y1 - h,
      x0 + dx * (1 - postWidth), y0 + dy * (1 - postWidth) - h,
    ]);
    g.fill({ color: this._darkenWallColor(dt.color, 0.7) });

    // Top lintel
    g.moveTo(x0, y0 - h);
    g.lineTo(x1, y1 - h);
    g.stroke({ color: dt.topColor, width: 2, alpha: 0.8 });

    // Threshold line
    g.moveTo(x0 + dx * postWidth, y0 + dy * postWidth);
    g.lineTo(x0 + dx * (1 - postWidth), y0 + dy * (1 - postWidth));
    g.stroke({ color: dt.topColor, width: 1, alpha: 0.3 });
  }

  g.zIndex = isoDepth;
  this.doorLayer.addChild(g);
  this.doorGraphics[`${col},${row},${edge}`] = g;
};

Renderer.prototype.renderDoorPreview = function(path, doorType) {
  this.dragPreviewLayer.removeChildren();
  if (!path || path.length === 0) return;

  const dt = DOOR_TYPES[doorType];
  if (!dt) return;
  const totalCost = path.length * dt.cost;
  const canAfford = this.game.state.resources.funding >= totalCost;

  for (const pt of path) {
    let rc = pt.col, rr = pt.row, re = pt.edge;
    if (pt.edge === 'n') { rr -= 1; re = 's'; }
    else if (pt.edge === 'w') { rc -= 1; re = 'e'; }

    const pos = tileCenterIso(rc, rr);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const h = dt.wallHeight;
    const occupied = this.game.state.doorOccupied[`${pt.col},${pt.row},${pt.edge}`];
    const ok = canAfford && !occupied;
    const g = new PIXI.Graphics();

    if (re === 'e') {
      g.poly([
        pos.x + hw, pos.y,
        pos.x, pos.y + hh,
        pos.x, pos.y + hh - h,
        pos.x + hw, pos.y - h,
      ]);
    } else {
      g.poly([
        pos.x, pos.y + hh,
        pos.x - hw, pos.y,
        pos.x - hw, pos.y - h,
        pos.x, pos.y + hh - h,
      ]);
    }
    g.fill({ color: ok ? dt.color : 0xcc3333, alpha: 0.5 });
    g.stroke({ color: ok ? 0xffffff : 0xff4444, width: 1, alpha: 0.5 });
    this.dragPreviewLayer.addChild(g);
  }

  const last = path[path.length - 1];
  const labelPos = tileCenterIso(last.col, last.row);
  const label = new PIXI.Text({
    text: `$${totalCost} (${path.length} segments)`,
    style: { fontFamily: 'monospace', fontSize: 10, fill: canAfford ? 0xffffff : 0xff4444 },
  });
  label.anchor.set(0.5, 0.5);
  label.x = labelPos.x;
  label.y = labelPos.y - 16;
  this.dragPreviewLayer.addChild(label);
};

// --- Zone rendering ---

Renderer.prototype._renderZones = function() {
  this.zoneLayer.removeChildren();
  const zones = this.game.state.zones || [];
  const connectivity = this.game.state.zoneConnectivity || {};

  for (const tile of zones) {
    const zone = ZONES[tile.type];
    if (!zone) continue;
    const conn = connectivity[tile.type];
    const active = conn ? conn.active : false;
    this._drawZoneTile(tile.col, tile.row, zone, active);
  }

  // Draw zone labels for each zone type
  this._drawZoneLabels(zones, connectivity);

  // Draw placed furnishings
  this._renderZoneFurnishings();
};

Renderer.prototype._drawZoneTile = function(col, row, zone, active) {
  const pos = tileCenterIso(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const isoDepth = col + row;

  // Simple transparent colored tile for the zone
  const g = new PIXI.Graphics();
  g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
  g.fill({ color: zone.color, alpha: active ? 0.35 : 0.22 });
  g.zIndex = isoDepth;
  this.zoneLayer.addChild(g);
};

Renderer.prototype._drawZoneLabels = function(zones, connectivity) {
  // Build a lookup of tile positions by type
  const tilesByType = {};
  for (const z of zones) {
    if (!tilesByType[z.type]) tilesByType[z.type] = [];
    tilesByType[z.type].push(z);
  }

  for (const [type, tiles] of Object.entries(tilesByType)) {
    const zone = ZONES[type];
    if (!zone) continue;
    const conn = connectivity[type];
    const totalCount = conn ? conn.tileCount : tiles.length;

    // Flood-fill to find contiguous groups
    const tileSet = new Set(tiles.map(t => t.col + ',' + t.row));
    const visited = new Set();
    const groups = [];

    for (const t of tiles) {
      const key = t.col + ',' + t.row;
      if (visited.has(key)) continue;

      // BFS to find contiguous group
      const group = [];
      const queue = [key];
      visited.add(key);
      while (queue.length > 0) {
        const cur = queue.shift();
        group.push(cur);
        const [cc, cr] = cur.split(',').map(Number);
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nk = (cc + dc) + ',' + (cr + dr);
          if (tileSet.has(nk) && !visited.has(nk)) {
            visited.add(nk);
            queue.push(nk);
          }
        }
      }
      groups.push(group);
    }

    // Draw a label at the center of each contiguous group
    for (const group of groups) {
      let avgCol = 0, avgRow = 0;
      for (const key of group) {
        const [c, r] = key.split(',').map(Number);
        avgCol += c;
        avgRow += r;
      }
      avgCol /= group.length;
      avgRow /= group.length;

      const labelText = groups.length > 1
        ? `${zone.name} (${group.length}/${totalCount})`
        : `${zone.name} (${totalCount})`;

      const pos = tileCenterIso(avgCol, avgRow);
      const label = new PIXI.Text({
        text: labelText,
        style: { fontFamily: 'monospace', fontSize: 12, fill: 0xffffff, align: 'center',
          dropShadow: true, dropShadowColor: 0x000000, dropShadowDistance: 1, dropShadowBlur: 2 },
      });
      label.anchor.set(0.5, 0.5);
      label.x = pos.x;
      label.y = pos.y;
      label.alpha = conn?.active ? 1.0 : 0.7;
      this.zoneLayer.addChild(label);
    }
  }
};

// --- Zone furnishing rendering ---

Renderer.prototype._renderZoneFurnishings = function() {
  const furnishings = this.game.state.zoneFurnishings || [];
  for (const furn of furnishings) {
    const furnDef = ZONE_FURNISHINGS[furn.type];
    if (!furnDef) continue;
    const texture = this.sprites.getTexture(furn.type);
    if (!texture) continue;

    const gw = furn.rotated ? furnDef.gridH : furnDef.gridW;
    const gh = furn.rotated ? furnDef.gridW : furnDef.gridH;

    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.5);

    // Position: tile origin + sub-grid offset to the CENTER of the item footprint
    const tilePos = gridToIso(furn.col, furn.row);
    const subOffset = subGridToIso(furn.subCol + gw / 2, furn.subRow + gh / 2);
    sprite.x = tilePos.x + subOffset.x;
    sprite.y = tilePos.y + subOffset.y;

    // Depth: base tile depth + sub-row for within-tile ordering
    sprite.zIndex = (furn.col + furn.row) * 16 + (furn.subRow + gh);
    this.zoneLayer.addChild(sprite);
  }
};

Renderer.prototype._renderFurnishingPreview = function(col, row, subCol, subRow, furnType, rotated) {
  this.dragPreviewLayer.removeChildren();

  const furnDef = ZONE_FURNISHINGS[furnType];
  if (!furnDef) return;

  const gw = rotated ? furnDef.gridH : furnDef.gridW;
  const gh = rotated ? furnDef.gridW : furnDef.gridH;

  // Check if placement is valid
  const key = col + ',' + row;
  const subgrid = this.game.state.zoneFurnishingSubgrids[key];
  let valid = subCol >= 0 && subRow >= 0 && subCol + gw <= 4 && subRow + gh <= 4;
  if (valid && subgrid) {
    for (let r = subRow; r < subRow + gh && valid; r++) {
      for (let c = subCol; c < subCol + gw && valid; c++) {
        if (subgrid[r][c] !== 0) valid = false;
      }
    }
  }

  const tilePos = gridToIso(col, row);
  const color = valid ? 0xffffff : 0xff4444;
  const gfx = new PIXI.Graphics();

  // Draw the item footprint as a single outline (outer boundary of all cells)
  const topPt = subGridToIso(subCol, subRow);
  const rightPt = subGridToIso(subCol + gw, subRow);
  const bottomPt = subGridToIso(subCol + gw, subRow + gh);
  const leftPt = subGridToIso(subCol, subRow + gh);

  gfx.poly([
    tilePos.x + topPt.x, tilePos.y + topPt.y,
    tilePos.x + rightPt.x, tilePos.y + rightPt.y,
    tilePos.x + bottomPt.x, tilePos.y + bottomPt.y,
    tilePos.x + leftPt.x, tilePos.y + leftPt.y,
  ]);
  gfx.stroke({ color, width: 1.5, alpha: 0.8 });

  // Small cross at center of footprint
  const cx = subGridToIso(subCol + gw / 2, subRow + gh / 2);
  const ps = 3;
  gfx.moveTo(tilePos.x + cx.x - ps, tilePos.y + cx.y);
  gfx.lineTo(tilePos.x + cx.x + ps, tilePos.y + cx.y);
  gfx.stroke({ color, width: 1.5, alpha: 0.8 });
  gfx.moveTo(tilePos.x + cx.x, tilePos.y + cx.y - ps);
  gfx.lineTo(tilePos.x + cx.x, tilePos.y + cx.y + ps);
  gfx.stroke({ color, width: 1.5, alpha: 0.8 });

  this.dragPreviewLayer.addChild(gfx);
};

// --- Facility equipment rendering ---

Renderer.prototype._renderFacilityEquipment = function() {
  this.facilityLayer.removeChildren();
  const equipment = this.game.state.facilityEquipment || [];
  for (const equip of equipment) {
    const comp = COMPONENTS[equip.type];
    if (!comp) continue;
    const spriteKey = comp.spriteKey || equip.type;
    const texture = this.sprites.getTexture(spriteKey);
    if (!texture) continue;

    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.7);
    const pos = tileCenterIso(equip.col, equip.row);
    sprite.x = pos.x;
    sprite.y = pos.y;
    sprite.zIndex = equip.col + equip.row;
    this.facilityLayer.addChild(sprite);

    // Label
    const label = new PIXI.Text({
      text: comp.name,
      style: { fontFamily: 'monospace', fontSize: 9, fill: 0xcccccc },
    });
    label.anchor.set(0.5, 0);
    label.x = pos.x;
    label.y = pos.y + 8;
    this.labelLayer.addChild(label);
  }
};

// --- Connection rendering ---

Renderer.prototype._renderConnections = function() {
  this.connectionLayer.removeChildren();
  const connections = this.game.state.connections;
  if (!connections || connections.size === 0) return;

  // Fixed draw order — each type always gets the same global offset index
  const CONN_ORDER = ['vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer', 'powerCable', 'dataFiber'];
  const LINE_WIDTH = 2;
  const LINE_GAP = 4; // snug gap so pipes fit within one tile

  // Global offset: each type always at the same position regardless of which
  // other types are present on this tile. Center the full set of 6 slots.
  const TOTAL_SLOTS = CONN_ORDER.length;
  const startOffset = -(TOTAL_SLOTS - 1) * LINE_GAP / 2;

  // Perpendicular offset directions for each axis.
  // E/W segments run along (16,8) — perp is (-1,2)/sqrt(5)
  // N/S segments run along (16,-8) — perp is (1,2)/sqrt(5)
  // Their intersection offset is (0, sqrt(5)/2) per unit off.
  const INV_SQRT5 = 1 / Math.sqrt(5);
  const HALF_SQRT5 = Math.sqrt(5) / 2;
  const EW_PX = -INV_SQRT5, EW_PY = 2 * INV_SQRT5;
  const NS_PX =  INV_SQRT5, NS_PY = 2 * INV_SQRT5;

  for (let slotIdx = 0; slotIdx < CONN_ORDER.length; slotIdx++) {
    const connType = CONN_ORDER[slotIdx];
    const conn = CONNECTION_TYPES[connType];
    if (!conn) continue;

    const off = startOffset + slotIdx * LINE_GAP;

    const g = new PIXI.Graphics();

    for (const [key, typeSet] of connections) {
      if (!typeSet.has(connType)) continue;

      const [colStr, rowStr] = key.split(',');
      const col = parseInt(colStr);
      const row = parseInt(rowStr);

      // Highlight network tiles white
      const isNetTile = this._networkTileSet && this._networkConnType === connType && this._networkTileSet.has(key);
      const tileColor = isNetTile ? 0xffffff : conn.color;
      const tileWidth = isNetTile ? LINE_WIDTH + 1 : LINE_WIDTH;

      const center = tileCenterIso(col, row);

      // Check 4 neighbors for same connection type
      const hasN = this._hasConnection(col, row - 1, connType);
      const hasS = this._hasConnection(col, row + 1, connType);
      const hasE = this._hasConnection(col + 1, row, connType);
      const hasW = this._hasConnection(col - 1, row, connType);

      const neighbors = [hasN, hasE, hasS, hasW];
      const count = neighbors.filter(Boolean).length;

      // Edge midpoints (unoffset)
      const midN = tileCenterIso(col, row - 0.5);
      const midS = tileCenterIso(col, row + 0.5);
      const midE = tileCenterIso(col + 0.5, row);
      const midW = tileCenterIso(col - 0.5, row);

      // Per-direction perpendicular offsets: N/S use NS perp, E/W use EW perp
      const perps = [
        { px: NS_PX, py: NS_PY },  // N
        { px: EW_PX, py: EW_PY },  // E
        { px: NS_PX, py: NS_PY },  // S
        { px: EW_PX, py: EW_PY },  // W
      ];
      const mids = [midN, midE, midS, midW];

      if (count === 0) {
        const ox = off * NS_PX, oy = off * NS_PY;
        g.circle(center.x + ox, center.y + oy, tileWidth + 1);
        g.fill({ color: tileColor, alpha: 0.8 });
      } else {
        const hasNS = hasN || hasS;
        const hasEW = hasE || hasW;

        // Center point depends on connectivity:
        // Straight runs use axis-specific perpendicular offset.
        // Corners/junctions use the geometric intersection of
        // the two offset lines: (0, off * sqrt(5)/2).
        let cx, cy;
        if (hasNS && hasEW) {
          cx = center.x;
          cy = center.y + off * HALF_SQRT5;
        } else if (hasNS) {
          cx = center.x + NS_PX * off;
          cy = center.y + NS_PY * off;
        } else {
          cx = center.x + EW_PX * off;
          cy = center.y + EW_PY * off;
        }

        // Draw half-segments from center to each offset edge midpoint
        for (let i = 0; i < 4; i++) {
          if (!neighbors[i]) continue;
          const px = perps[i].px * off;
          const py = perps[i].py * off;
          g.moveTo(cx, cy);
          g.lineTo(mids[i].x + px, mids[i].y + py);
          g.stroke({ color: tileColor, width: tileWidth, alpha: 0.9 });
        }
      }
    }

    this.connectionLayer.addChild(g);
  }
};

Renderer.prototype._hasConnection = function(col, row, connType) {
  const key = col + ',' + row;
  const set = this.game.state.connections.get(key);
  return set ? set.has(connType) : false;
};

// --- Drag previews ---

Renderer.prototype.renderDragPreview = function(startCol, startRow, endCol, endRow, type, isZone = false) {
  this.dragPreviewLayer.removeChildren();
  if (startCol == null || endCol == null) return;

  let previewColor, cost;
  if (isZone) {
    const zone = ZONES[type];
    if (!zone) return;
    previewColor = zone.color;
    cost = 0; // zones are free to assign
  } else {
    const infra = INFRASTRUCTURE[type];
    if (!infra) return;
    previewColor = infra.topColor;
    cost = infra.cost;
  }

  const minCol = Math.min(startCol, endCol);
  const maxCol = Math.max(startCol, endCol);
  const minRow = Math.min(startRow, endRow);
  const maxRow = Math.max(startRow, endRow);

  const tileCount = (maxCol - minCol + 1) * (maxRow - minRow + 1);
  const totalCost = tileCount * cost;
  const canAfford = cost === 0 || this.game.state.resources.funding >= totalCost;

  // Check if any tiles are missing required foundation
  const infra = !isZone ? INFRASTRUCTURE[type] : null;
  let needsFoundation = false;
  if (infra?.requiresFoundation) {
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const k = c + ',' + r;
        const existing = this.game.state.infraOccupied[k];
        const existingTile = this.game.state.infrastructure.find(t => t.col === c && t.row === r);
        const baseType = existingTile?.foundation || existing;
        if (baseType !== infra.requiresFoundation) { needsFoundation = true; break; }
      }
      if (needsFoundation) break;
    }
  }

  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) {
      const g = new PIXI.Graphics();
      const pos = tileCenterIso(c, r);
      const hw = TILE_W / 2;
      const hh = TILE_H / 2;

      const tileOk = !needsFoundation || (() => {
        const k = c + ',' + r;
        const existing = this.game.state.infraOccupied[k];
        const existingTile = this.game.state.infrastructure.find(t => t.col === c && t.row === r);
        const baseType = existingTile?.foundation || existing;
        return baseType === infra.requiresFoundation;
      })();
      g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
      g.fill({ color: (canAfford && tileOk) ? previewColor : 0xcc3333, alpha: isZone ? 0.4 : 0.5 });
      g.stroke({ color: (canAfford && tileOk) ? 0xffffff : 0xff4444, width: 1, alpha: 0.4 });

      this.dragPreviewLayer.addChild(g);
    }
  }

  // Cost label at center of preview
  const centerCol = (minCol + maxCol) / 2;
  const centerRow = (minRow + maxRow) / 2;
  const centerPos = tileCenterIso(centerCol, centerRow);
  const labelText = cost > 0 ? `$${totalCost} (${tileCount} tiles)` : `${tileCount} tiles`;
  const label = new PIXI.Text({
    text: labelText,
    style: { fontFamily: 'monospace', fontSize: 10, fill: canAfford ? 0xffffff : 0xff4444 },
  });
  label.anchor.set(0.5, 0.5);
  label.x = centerPos.x;
  label.y = centerPos.y - 12;
  this.dragPreviewLayer.addChild(label);

  // "Needs foundation!" warning below cost label
  if (needsFoundation) {
    const warn = new PIXI.Text({
      text: 'Needs foundation!',
      style: { fontFamily: 'monospace', fontSize: 10, fill: 0xff4444 },
    });
    warn.anchor.set(0.5, 0.5);
    warn.x = centerPos.x;
    warn.y = centerPos.y + 2;
    this.dragPreviewLayer.addChild(warn);
  }
};

Renderer.prototype.renderLinePreview = function(path, infraType) {
  this.dragPreviewLayer.removeChildren();
  if (!path || path.length === 0) return;

  const infra = INFRASTRUCTURE[infraType];
  if (!infra) return;
  const cost = infra.cost;
  const totalCost = path.length * cost;
  const canAfford = this.game.state.resources.funding >= totalCost;
  const previewColor = infra.topColor;

  // Check if any tiles are missing required foundation
  let needsFoundation = false;
  if (infra.requiresFoundation) {
    for (const pt of path) {
      const k = pt.col + ',' + pt.row;
      const existing = this.game.state.infraOccupied[k];
      const existingTile = this.game.state.infrastructure.find(t => t.col === pt.col && t.row === pt.row);
      const baseType = existingTile?.foundation || existing;
      if (baseType !== infra.requiresFoundation) { needsFoundation = true; break; }
    }
  }

  for (const pt of path) {
    const g = new PIXI.Graphics();
    const pos = tileCenterIso(pt.col, pt.row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const tileOk = !needsFoundation || (() => {
      const k = pt.col + ',' + pt.row;
      const existing = this.game.state.infraOccupied[k];
      const existingTile = this.game.state.infrastructure.find(t => t.col === pt.col && t.row === pt.row);
      const baseType = existingTile?.foundation || existing;
      return baseType === infra.requiresFoundation;
    })();
    g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
    g.fill({ color: (canAfford && tileOk) ? previewColor : 0xcc3333, alpha: 0.5 });
    g.stroke({ color: (canAfford && tileOk) ? 0xffffff : 0xff4444, width: 1, alpha: 0.4 });
    this.dragPreviewLayer.addChild(g);
  }

  // Cost label at last tile
  const last = path[path.length - 1];
  const centerPos = tileCenterIso(last.col, last.row);
  const label = new PIXI.Text({
    text: `$${totalCost} (${path.length} tiles)`,
    style: { fontFamily: 'monospace', fontSize: 10, fill: canAfford ? 0xffffff : 0xff4444 },
  });
  label.anchor.set(0.5, 0.5);
  label.x = centerPos.x;
  label.y = centerPos.y - 12;
  this.dragPreviewLayer.addChild(label);

  // "Needs foundation!" warning below cost label
  if (needsFoundation) {
    const warn = new PIXI.Text({
      text: 'Needs foundation!',
      style: { fontFamily: 'monospace', fontSize: 10, fill: 0xff4444 },
    });
    warn.anchor.set(0.5, 0.5);
    warn.x = centerPos.x;
    warn.y = centerPos.y + 2;
    this.dragPreviewLayer.addChild(warn);
  }
};

Renderer.prototype.renderConnLinePreview = function(path, connType, mode) {
  this.dragPreviewLayer.removeChildren();
  if (!path || path.length === 0) return;

  const conn = CONNECTION_TYPES[connType];
  if (!conn) return;
  const previewColor = conn.color;
  const isRemove = mode === 'remove';

  for (const pt of path) {
    const g = new PIXI.Graphics();
    const pos = tileCenterIso(pt.col, pt.row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
    g.fill({ color: isRemove ? 0xcc3333 : previewColor, alpha: 0.45 });
    g.stroke({ color: isRemove ? 0xff4444 : 0xffffff, width: 1, alpha: 0.4 });
    this.dragPreviewLayer.addChild(g);
  }

  // Tile count label at last tile
  const last = path[path.length - 1];
  const centerPos = tileCenterIso(last.col, last.row);
  const label = new PIXI.Text({
    text: `${path.length} tiles`,
    style: { fontFamily: 'monospace', fontSize: 10, fill: isRemove ? 0xff4444 : 0xffffff },
  });
  label.anchor.set(0.5, 0.5);
  label.x = centerPos.x;
  label.y = centerPos.y - 12;
  this.dragPreviewLayer.addChild(label);
};

Renderer.prototype.renderDemolishPreview = function(startCol, startRow, endCol, endRow) {
  this.dragPreviewLayer.removeChildren();
  if (startCol == null || endCol == null) return;

  const minCol = Math.min(startCol, endCol);
  const maxCol = Math.max(startCol, endCol);
  const minRow = Math.min(startRow, endRow);
  const maxRow = Math.max(startRow, endRow);

  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) {
      const key = c + ',' + r;
      const hasContent = this.game.state.infraOccupied[key] || this.game.state.zoneOccupied[key];
      const g = new PIXI.Graphics();
      const pos = tileCenterIso(c, r);
      const hw = TILE_W / 2;
      const hh = TILE_H / 2;

      g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
      g.fill({ color: 0xff0000, alpha: hasContent ? 0.3 : 0.1 });
      g.stroke({ color: 0xff4444, width: 1, alpha: 0.6 });

      this.dragPreviewLayer.addChild(g);
    }
  }
};

Renderer.prototype.clearDragPreview = function() {
  this.dragPreviewLayer.removeChildren();
};

Renderer.prototype.renderInfraHoverCursor = function(col, row, color) {
  this.dragPreviewLayer.removeChildren();
  const pos = tileCenterIso(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const c = color || 0xffffff;

  const g = new PIXI.Graphics();
  // Diamond outline
  g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
  g.stroke({ color: c, width: 1.5, alpha: 0.6 });
  // Cross lines
  g.moveTo(pos.x - hw * 0.4, pos.y);
  g.lineTo(pos.x + hw * 0.4, pos.y);
  g.moveTo(pos.x, pos.y - hh * 0.4);
  g.lineTo(pos.x, pos.y + hh * 0.4);
  g.stroke({ color: c, width: 1.5, alpha: 0.8 });

  this.dragPreviewLayer.addChild(g);
};

// --- Network overlay ---

Renderer.prototype._drawIsoBoxOutline = function(col, row, color, lineWidth) {
  const pos = tileCenterIso(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const depth = hh;
  // Sprite anchor is (0.5, 0.7) on a 48px tall texture (hh*3).
  // The box center in the texture is at the diamond center (y=0 in box coords),
  // which is at texture y=16. Anchor is at texture y=33.6.
  // So box is drawn 33.6 - 16 = 17.6px above the anchor point.
  const yOff = -(0.7 * (hh * 3) - hh);
  const cx = pos.x;
  const cy = pos.y + yOff;
  const g = new PIXI.Graphics();
  // Trace full iso box: top diamond + left side + right side + bottom edge
  g.moveTo(cx, cy - hh);              // top
  g.lineTo(cx + hw, cy);              // right of top diamond
  g.lineTo(cx + hw, cy + depth);      // down right side
  g.lineTo(cx, cy + hh + depth);      // bottom center
  g.lineTo(cx - hw, cy + depth);      // down left side
  g.lineTo(cx - hw, cy);              // left of top diamond
  g.closePath();
  g.stroke({ color, width: lineWidth, alpha: 0.9 });
  this.networkOverlayLayer.addChild(g);
};

Renderer.prototype._showNetworkPanel = function(connType, network) {
  if (this.networkPanel) this.networkPanel.remove();

  const panel = document.createElement('div');
  panel.id = 'network-panel';
  panel.style.cssText = 'position:fixed;top:80px;right:16px;width:280px;background:rgba(0,0,0,0.85);color:#eee;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;z-index:10000;border:1px solid rgba(255,255,255,0.2);';

  const title = CONNECTION_TYPES[connType]?.name || connType;
  let html = `<div style="font-size:14px;font-weight:bold;margin-bottom:8px">${title} Network</div>`;

  if (connType === 'powerCable' && typeof Networks !== 'undefined') {
    const stats = Networks.validatePowerNetwork(network);
    const util = stats.capacity > 0 ? (stats.draw / stats.capacity * 100).toFixed(0) : 0;
    const color = stats.ok ? '#4c4' : '#f44';
    html += `<div>Capacity: ${stats.capacity} kW</div>`;
    html += `<div>Draw: ${stats.draw} kW</div>`;
    html += `<div>Utilization: ${util}%</div>`;
    html += `<div style="color:${color}">Status: ${stats.ok ? 'OK' : 'OVERLOADED'}</div>`;
    html += `<div style="margin-top:6px;font-size:11px">Substations: ${stats.substations.length}</div>`;
    html += `<div style="font-size:11px">Consumers: ${stats.consumers.length}</div>`;
  } else if (connType === 'rfWaveguide' && typeof Networks !== 'undefined') {
    const stats = Networks.validateRfNetwork(network);
    const freq = stats.sources.length > 0 ? stats.sources[0].frequency : '\u2014';
    html += `<div>Frequency: ${freq === 'broadband' ? 'Broadband' : freq + ' MHz'}</div>`;
    html += `<div>Forward Power: ${stats.forwardPower} kW</div>`;
    html += `<div>Reflected: ${stats.reflectedPower.toFixed(1)} kW</div>`;
    html += `<div>Sources: ${stats.sources.length} | Cavities: ${stats.cavities.length}</div>`;
    if (stats.missingModulator) html += `<div style="color:#f44">Missing modulator!</div>`;
    if (!stats.frequencyMatch) html += `<div style="color:#f44">Frequency mismatch!</div>`;
    html += `<div>Circulator: ${stats.hasCirculator ? 'Yes' : 'No'}</div>`;
    html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'ISSUES'}</div>`;
  } else if (connType === 'coolingWater' && typeof Networks !== 'undefined') {
    const stats = Networks.validateCoolingNetwork(network);
    html += `<div>Capacity: ${stats.capacity} kW</div>`;
    html += `<div>Heat Load: ${stats.heatLoad.toFixed(1)} kW</div>`;
    html += `<div>Margin: ${stats.margin.toFixed(0)}%</div>`;
    html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'OVERLOADED'}</div>`;
  } else if (connType === 'cryoTransfer' && typeof Networks !== 'undefined') {
    const stats = Networks.validateCryoNetwork(network);
    html += `<div>Capacity: ${stats.capacity} W</div>`;
    html += `<div>Heat Load: ${stats.heatLoad} W</div>`;
    html += `<div>Op Temp: ${stats.opTemp > 0 ? stats.opTemp + ' K' : 'N/A'}</div>`;
    html += `<div>Compressor: ${stats.hasCompressor ? 'Yes' : 'No'}</div>`;
    html += `<div>Margin: ${stats.margin.toFixed(0)}%</div>`;
    html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'ISSUES'}</div>`;
  } else if (connType === 'vacuumPipe' && typeof Networks !== 'undefined') {
    const stats = Networks.validateVacuumNetwork(network, this.game.state.beamline);
    html += `<div>Eff. Pump Speed: ${stats.effectivePumpSpeed.toFixed(1)} L/s</div>`;
    html += `<div>Pressure: ${stats.avgPressure === Infinity ? '\u2014' : stats.avgPressure.toExponential(1)} mbar</div>`;
    html += `<div>Quality: ${stats.pressureQuality}</div>`;
    html += `<div>Pumps: ${stats.pumps.length}</div>`;
    html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'POOR'}</div>`;
  } else if (connType === 'dataFiber') {
    const hasIoc = network.equipment.some(eq => eq.type === 'rackIoc');
    html += `<div>Rack/IOC: ${hasIoc ? 'Connected' : 'None'}</div>`;
    html += `<div>Diagnostics: ${network.beamlineNodes.length}</div>`;
    html += `<div style="color:${hasIoc ? '#4c4' : '#f44'}">Status: ${hasIoc ? 'OK' : 'NO IOC'}</div>`;
  }

  html += `<div style="margin-top:8px;font-size:10px;color:#888">Click elsewhere or Esc to close</div>`;
  panel.innerHTML = html;
  document.body.appendChild(panel);
  this.networkPanel = panel;
};

Renderer.prototype.clearNetworkOverlay = function() {
  if (this.networkOverlayLayer) this.networkOverlayLayer.removeChildren();
  if (this.networkPanel) {
    this.networkPanel.remove();
    this.networkPanel = null;
  }
  this.activeNetworkType = null;
  // Clear network highlight and re-render connections in normal colors
  if (this._networkTileSet) {
    this._networkTileSet = null;
    this._networkConnType = null;
    this._renderConnections();
  }
};

Renderer.prototype.showNetworkOverlay = function(equipId) {
  this.clearNetworkOverlay();

  const equip = this.game.state.facilityEquipment.find(e => e.id === equipId);
  if (!equip) return;

  // Get the connection type this equipment produces/provides
  const connType = this.game._getEquipmentConnectionType(equip.type);
  if (!connType || !this.game.state.networkData) return;

  // Find which network this equipment belongs to
  const networks = this.game.state.networkData[connType] || [];
  let targetNet = null;
  for (const net of networks) {
    if (net.equipment.some(e => e.id === equipId)) {
      targetNet = net;
      break;
    }
  }
  if (!targetNet) return;

  this.activeNetworkType = connType;
  this._networkTileSet = new Set(targetNet.tiles.map(t => t.col + ',' + t.row));
  this._networkConnType = connType;

  // Draw white isometric box outlines around connected beamline components
  for (const node of targetNet.beamlineNodes) {
    const tiles = node.tiles || [{ col: node.col, row: node.row }];
    for (const tile of tiles) {
      this._drawIsoBoxOutline(tile.col, tile.row, 0xffffff, 2);
    }
  }

  // Draw white isometric box outlines around connected equipment
  for (const eq of targetNet.equipment) {
    this._drawIsoBoxOutline(eq.col, eq.row, 0xffffff, 2);
  }

  // Re-render connections so network pipes appear white
  this._renderConnections();

  // Show stats panel
  this._showNetworkPanel(connType, targetNet);
};
