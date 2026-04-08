// === BEAMLINE RENDERER EXTENSION ===
// Adds beamline component, beam, cursor, and probe rendering to Renderer.prototype.
// Note: PIXI is a CDN global — not imported.

import { Renderer } from './Renderer.js';
import { COMPONENTS } from '../data/components.js';
import { TILE_W, TILE_H, DIR, DIR_DELTA, turnLeft, turnRight } from '../data/directions.js';
import { CONNECTION_TYPES } from '../data/modes.js';
import { gridToIso, tileCenterIso } from './grid.js';

// --- Component rendering ---

Renderer.prototype._getRequiredConnections = function(comp) {
  return comp.requiredConnections || [];
};

Renderer.prototype._renderComponents = function() {
  this.componentLayer.removeChildren();
  this.labelLayer.removeChildren();
  this.nodeSprites = {};

  const nodes = this.game.beamline.getAllNodes();

  // Auto-name: count instances of each component type in placement order
  const typeCounts = {};
  const typeTotals = {};
  for (const node of nodes) typeTotals[node.type] = (typeTotals[node.type] || 0) + 1;

  const nodeNames = {};
  for (const node of nodes) {
    const comp = COMPONENTS[node.type];
    if (!comp) continue;
    typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
    nodeNames[node.id] = typeTotals[node.type] > 1
      ? `${comp.name} #${typeCounts[node.type]}`
      : comp.name;
  }

  const warnings = [];

  for (const node of nodes) {
    const comp = COMPONENTS[node.type];
    if (!comp) continue;

    const spriteKey = comp.spriteKey || node.type;
    const texture = this.sprites.getTexture(spriteKey);
    if (!texture) continue;

    // Draw one sprite per occupied tile
    const tiles = node.tiles || [{ col: node.col, row: node.row }];
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5, 0.7);
      const pos = tileCenterIso(tile.col, tile.row);
      sprite.x = pos.x;
      sprite.y = pos.y;
      sprite.zIndex = tile.col + tile.row;
      this.componentLayer.addChild(sprite);
      if (i === 0) this.nodeSprites[node.id] = sprite;
    }

    const center = this._nodeCenter(node);
    const displayName = nodeNames[node.id] || comp.name;

    // Add label at mid/close zoom (at center tile)
    if (this.zoom >= 0.7) {
      const label = new PIXI.Text({
        text: displayName,
        style: {
          fontFamily: 'monospace',
          fontSize: 10,
          fill: 0xffffff,
        },
      });
      const firstTile = tiles[0];
      const topLeft = tileCenterIso(firstTile.col, firstTile.row);
      label.anchor.set(0, 1);
      label.x = topLeft.x;
      label.y = topLeft.y - 12;
      this.labelLayer.addChild(label);
    }

    // Check for missing utility connections
    const required = this._getRequiredConnections(comp);
    const missing = [];
    for (const connType of required) {
      if (!this.game.hasValidConnection(node, connType)) {
        missing.push(connType);
      }
    }

    // Check if data-producing endpoint is wired to control room
    let needsControlRoom = false;
    if ((comp.stats?.dataRate || comp.stats?.collisionRate) && comp.isEndpoint) {
      if (!missing.includes('dataFiber') && typeof Networks !== 'undefined' && this.game.state.networkData) {
        // Has dataFiber, but does it reach the control room?
        let reachesControl = false;
        for (const net of (this.game.state.networkData.dataFiber || [])) {
          const touchesNode = net.beamlineNodes.some(n => n.id === node.id);
          if (touchesNode && Networks.touchesControlRoom(this.game.state, net)) {
            reachesControl = true;
            break;
          }
        }
        if (!reachesControl) needsControlRoom = true;
      }
    }

    // Warning indicator for missing connections
    if (missing.length > 0 || needsControlRoom) {
      const warn = new PIXI.Text({
        text: '!',
        style: { fontFamily: 'monospace', fontSize: 14, fill: 0xff4444, fontWeight: 'bold' },
      });
      warn.anchor.set(0.5, 1);
      warn.x = center.x + 10;
      warn.y = center.y - 10;
      warn.zIndex = 9999;
      this.labelLayer.addChild(warn);

      for (const connType of missing) {
        warnings.push({ name: displayName, connType });
      }
      if (needsControlRoom) {
        warnings.push({ name: displayName, connType: '_controlRoom' });
      }
    }

  }

  this._updateWarningsPanel(warnings);
};

Renderer.prototype._updateWarningsPanel = function(warnings) {
  const panel = document.getElementById('beamline-warnings');
  if (!panel) return;
  if (warnings.length === 0) { panel.innerHTML = ''; return; }

  // Group by connection type
  const byType = {};
  for (const w of warnings) {
    if (!byType[w.connType]) byType[w.connType] = [];
    byType[w.connType].push(w.name);
  }

  const lines = [];
  for (const [connType, names] of Object.entries(byType)) {
    const nameStr = names.length <= 3
      ? names.join(', ')
      : names.slice(0, 3).join(', ') + ` +${names.length - 3} more`;
    if (connType === '_controlRoom') {
      lines.push(`<div class="bl-warn">Not wired to Control Room: <span class="warn-name">${nameStr}</span></div>`);
    } else {
      const connName = CONNECTION_TYPES[connType]?.name || connType;
      lines.push(`<div class="bl-warn">No ${connName}: <span class="warn-name">${nameStr}</span></div>`);
    }
  }
  panel.innerHTML = lines.join('');
};

// --- Beam rendering ---

Renderer.prototype._renderBeam = function() {
  this.beamLayer.removeChildren();

  if (!this.game.state.beamOn) return;

  const nodes = this.game.beamline.getAllNodes();
  if (nodes.length < 2) return;

  const g = new PIXI.Graphics();
  const nodeById = {};
  for (const n of nodes) nodeById[n.id] = n;

  // Draw beam along parent-child edges
  for (const node of nodes) {
    if (node.parentId == null) continue;
    const parent = nodeById[node.parentId];
    if (!parent) continue;

    const from = this._nodeCenter(parent);
    const to = this._nodeCenter(node);

    // Outer glow
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.stroke({ color: 0x00ff00, width: 3, alpha: 0.6 });

    // Bright core
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.stroke({ color: 0xaaffaa, width: 1.5, alpha: 0.9 });
  }

  this.beamLayer.addChild(g);
};

// --- Cursor rendering ---

Renderer.prototype._renderCursors = function() {
  this.cursorLayer.removeChildren();

  if (this.bulldozerMode) {
    // Show red X at hover position
    this._drawBulldozerCursor(this.hoverCol, this.hoverRow);
    return;
  }

  if (!this.buildMode) return;

  const nodes = this.game.beamline.getAllNodes();

  if (nodes.length === 0) {
    // Draw hover cursor showing full footprint of selected tool
    const comp = this.selectedToolType ? COMPONENTS[this.selectedToolType] : null;
    const trackLength = comp ? (comp.trackLength || 1) : 1;
    const trackWidth = comp ? (comp.trackWidth || 1) : 1;
    const dir = DIR.NE;
    const delta = DIR_DELTA[dir];
    const perpDelta = DIR_DELTA[turnLeft(dir)];
    const widthOffsets = [];
    for (let j = 0; j < trackWidth; j++) {
      widthOffsets.push(j - (trackWidth - 1) / 2);
    }
    for (let i = 0; i < trackLength; i++) {
      for (const wOff of widthOffsets) {
        this._drawDiamond(
          this.hoverCol + delta.dc * i + perpDelta.dc * wOff,
          this.hoverRow + delta.dr * i + perpDelta.dr * wOff,
          0x4488ff, 0.6
        );
      }
    }
    return;
  }

  // Draw cursors at build positions, highlight the one under the mouse
  const cursors = this.game.beamline.getBuildCursors();
  for (const cursor of cursors) {
    const isHovered = cursor.col === this.hoverCol && cursor.row === this.hoverRow;
    this._drawCursorMarker(cursor, isHovered);
  }
};

Renderer.prototype._drawDiamond = function(col, row, color, alpha) {
  const g = new PIXI.Graphics();
  const pos = tileCenterIso(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;

  g.poly([
    pos.x, pos.y - hh,
    pos.x + hw, pos.y,
    pos.x, pos.y + hh,
    pos.x - hw, pos.y,
  ]);
  g.stroke({ color: color, width: 2, alpha: alpha });

  this.cursorLayer.addChild(g);
};

Renderer.prototype._drawBulldozerCursor = function(col, row) {
  const g = new PIXI.Graphics();
  const pos = tileCenterIso(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;

  // Check if there's something to demolish here
  const key = col + ',' + row;
  const node = this.game.beamline.getNodeAt(col, row);
  const hasInfra = this.game.state.infraOccupied[key];
  const hasFacility = this.game.state.facilityGrid[key];
  const hasMachine = this.game.state.machineGrid[key];
  const hasTarget = node || hasInfra || hasFacility || hasMachine;
  const color = hasTarget ? 0xff4444 : 0xff6644;
  const alpha = hasTarget ? 0.8 : 0.3;

  // Diamond outline
  g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
  g.fill({ color: 0xff0000, alpha: hasTarget ? 0.15 : 0.05 });
  g.stroke({ color: color, width: 2, alpha: alpha });

  // X mark
  const xs = 8;
  g.moveTo(pos.x - xs, pos.y - xs * 0.5);
  g.lineTo(pos.x + xs, pos.y + xs * 0.5);
  g.stroke({ color: color, width: 2.5, alpha: alpha });
  g.moveTo(pos.x + xs, pos.y - xs * 0.5);
  g.lineTo(pos.x - xs, pos.y + xs * 0.5);
  g.stroke({ color: color, width: 2.5, alpha: alpha });

  // Label
  const label = new PIXI.Text({
    text: 'DEMOLISH',
    style: { fontFamily: 'monospace', fontSize: 8, fill: 0xff4444 },
  });
  label.anchor.set(0.5, 0);
  label.x = pos.x;
  label.y = pos.y + hh + 2;
  label.alpha = 0.7;
  this.cursorLayer.addChild(label);

  this.cursorLayer.addChild(g);
};

Renderer.prototype._drawCursorMarker = function(cursor, isHovered) {
  const g = new PIXI.Graphics();
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;

  // Dim non-hovered cursors so the active one stands out
  const baseAlpha = isHovered ? 1.0 : 0.3;

  // Compute preview tiles based on the selected tool (including width)
  const comp = this.selectedToolType ? COMPONENTS[this.selectedToolType] : null;
  const trackLength = comp ? (comp.trackLength || 1) : 1;
  const trackWidth = comp ? (comp.trackWidth || 1) : 1;

  // Calculate exit direction (dipoles bend)
  let exitDir = cursor.dir;
  if (comp && comp.isDipole && this.cursorBendDir) {
    exitDir = this.cursorBendDir === 'left' ? turnLeft(cursor.dir) : turnRight(cursor.dir);
  }

  const delta = DIR_DELTA[exitDir];
  const perpDir = turnLeft(exitDir);
  const perpDelta = DIR_DELTA[perpDir];

  // Width offsets centered on beam
  const widthOffsets = [];
  for (let j = 0; j < trackWidth; j++) {
    widthOffsets.push(j - (trackWidth - 1) / 2);
  }

  const tiles = [];
  for (let i = 0; i < trackLength; i++) {
    for (const wOff of widthOffsets) {
      tiles.push({
        col: cursor.col + delta.dc * i + perpDelta.dc * wOff,
        row: cursor.row + delta.dr * i + perpDelta.dr * wOff,
      });
    }
  }

  // Check if tiles are available (use exact fractional key check)
  const available = tiles.every(t =>
    this.game.beamline.occupied[t.col + ',' + t.row] === undefined
  );
  const color = available ? 0x4488ff : 0xff4444;

  // Draw each tile as a filled diamond
  for (const tile of tiles) {
    const pos = tileCenterIso(tile.col, tile.row);
    g.poly([
      pos.x, pos.y - hh,
      pos.x + hw, pos.y,
      pos.x, pos.y + hh,
      pos.x - hw, pos.y,
    ]);
    g.fill({ color: color, alpha: 0.15 * baseAlpha });
    g.stroke({ color: color, width: 1.5, alpha: 0.6 * baseAlpha });
  }

  // Draw dashed outline on the first tile
  const pos = tileCenterIso(cursor.col, cursor.row);
  const points = [
    { x: pos.x, y: pos.y - hh },
    { x: pos.x + hw, y: pos.y },
    { x: pos.x, y: pos.y + hh },
    { x: pos.x - hw, y: pos.y },
  ];
  for (let i = 0; i < 4; i++) {
    const from = points[i];
    const to = points[(i + 1) % 4];
    const segments = 4;
    for (let s = 0; s < segments; s += 2) {
      const t0 = s / segments;
      const t1 = (s + 1) / segments;
      g.moveTo(from.x + (to.x - from.x) * t0, from.y + (to.y - from.y) * t0);
      g.lineTo(from.x + (to.x - from.x) * t1, from.y + (to.y - from.y) * t1);
      g.stroke({ color: color, width: 1.5, alpha: 0.8 * baseAlpha });
    }
  }

  // Plus sign in center of first tile
  const ps = 6;
  g.moveTo(pos.x - ps, pos.y);
  g.lineTo(pos.x + ps, pos.y);
  g.stroke({ color: color, width: 1.5, alpha: 0.8 * baseAlpha });
  g.moveTo(pos.x, pos.y - ps);
  g.lineTo(pos.x, pos.y + ps);
  g.stroke({ color: color, width: 1.5, alpha: 0.8 * baseAlpha });

  // Direction arrow showing exit direction
  const isoDir = gridToIso(delta.dc, delta.dr);
  const lastTile = tiles[tiles.length - 1];
  const lastPos = tileCenterIso(lastTile.col, lastTile.row);
  const arrowScale = 0.35;
  const ax = lastPos.x + isoDir.x * arrowScale;
  const ay = lastPos.y + isoDir.y * arrowScale;
  g.moveTo(lastPos.x, lastPos.y);
  g.lineTo(ax, ay);
  g.stroke({ color: 0x88bbff, width: 2, alpha: 0.9 * baseAlpha });

  // Component name label (only on hovered cursor)
  if (comp && isHovered) {
    const midTile = tiles[Math.floor(tiles.length / 2)];
    const midPos = tileCenterIso(midTile.col, midTile.row);
    const label = new PIXI.Text({
      text: comp.name,
      style: { fontFamily: 'monospace', fontSize: 9, fill: color },
    });
    label.anchor.set(0.5, 0);
    label.x = midPos.x;
    label.y = midPos.y + hh + 2;
    this.cursorLayer.addChild(label);
  }

  this.cursorLayer.addChild(g);
};

// --- Probe pin flags ---

Renderer.prototype._renderProbeFlags = function(pins) {
  if (this._flagLayer) this._flagLayer.removeChildren();
  else {
    this._flagLayer = new PIXI.Container();
    this.app.stage.addChild(this._flagLayer);
  }
  if (!pins || pins.length === 0) return;

  const ordered = this.game.state.beamline;
  for (const pin of pins) {
    const node = ordered.find(n => n.id === pin.nodeId);
    if (!node) continue;
    const pos = tileCenterIso(node.col, node.row);

    const g = new PIXI.Graphics();
    // Flag pole
    g.moveTo(pos.x + 8, pos.y - 20);
    g.lineTo(pos.x + 8, pos.y - 4);
    g.stroke({ color: 0xaaaaaa, width: 1 });
    // Flag body
    const flagColor = parseInt(pin.color.replace('#', ''), 16);
    g.poly([
      pos.x + 8, pos.y - 20,
      pos.x + 20, pos.y - 16,
      pos.x + 8, pos.y - 12,
    ]);
    g.fill({ color: flagColor, alpha: 0.9 });

    this._flagLayer.addChild(g);
  }
};
