// === INFRASTRUCTURE RENDERER EXTENSION ===
// Adds infrastructure, zone, facility, connection, and drag preview rendering to Renderer.prototype.
// Note: PIXI is a CDN global — not imported.

import { Renderer } from './Renderer.js';
import { COMPONENTS } from '../data/components.js';
import { TILE_W, TILE_H } from '../data/directions.js';
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS } from '../data/infrastructure.js';
import { CONNECTION_TYPES } from '../data/modes.js';
import { tileCenterIso } from './grid.js';
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
    this._drawInfraTile(tile.col, tile.row, infra, hasRight, hasBelow, tile.variant);
  }

  // Re-render decorations since infra changes may have cleared some
  if (this._renderDecorations) this._renderDecorations();
};

Renderer.prototype._drawInfraTile = function(col, row, infra, hasRight, hasBelow, variant) {
  const pos = tileCenterIso(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const depth = 6;

  // Side faces — drawn below the grid layer so grid lines appear on top
  if (!hasRight || !hasBelow) {
    const sides = new PIXI.Graphics();
    if (!hasRight) {
      sides.poly([pos.x, pos.y + hh, pos.x + hw, pos.y, pos.x + hw, pos.y + depth, pos.x, pos.y + hh + depth]);
      sides.fill({ color: infra.color });
    }
    if (!hasBelow) {
      sides.poly([pos.x - hw, pos.y, pos.x, pos.y + hh, pos.x, pos.y + hh + depth, pos.x - hw, pos.y + depth]);
      sides.fill({ color: infra.color });
    }
    this.infraSidesLayer.addChild(sides);
  }

  // Top face — use sprite if available, otherwise colored polygon
  const isoDepth = col + row;
  const texture = this.sprites.getTileTexture(infra.id, variant);
  if (texture) {
    const sprite = new PIXI.Sprite(texture);
    // RCT2 tiles are isometric diamond-shaped (64x31 or 64x48) — scale by width only
    // Old hand-drawn square tiles (64x64) need the 1.35x multiplier to fill the diamond
    const isIsoDiamond = texture.height < TILE_H * 1.8;
    const scale = isIsoDiamond
      ? (TILE_W / texture.width) * 1.03
      : (TILE_W / texture.width) * 1.35;
    sprite.anchor.set(0.5, 0.5);
    sprite.x = pos.x;
    sprite.y = pos.y - (isIsoDiamond ? 0 : texture.height * scale * 0.04);
    sprite.scale.set(scale, scale);
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

  // Draw the zone's required floor type as the base (into infraLayer so it's beneath everything)
  const floorId = zone.requiredFloor;
  const floorTexture = floorId ? this.sprites.getTileTexture(floorId) : null;
  if (floorTexture) {
    const fs = new PIXI.Sprite(floorTexture);
    const isIsoDiamond = floorTexture.height <= TILE_H + 2;
    const fScale = isIsoDiamond
      ? (TILE_W / floorTexture.width) * 1.03
      : (TILE_W / floorTexture.width) * 1.35;
    fs.anchor.set(0.5, 0.5);
    fs.x = pos.x;
    fs.y = pos.y - (isIsoDiamond ? 0 : floorTexture.height * fScale * 0.04);
    fs.scale.set(fScale, fScale);
    fs.zIndex = isoDepth;
    this.infraLayer.addChild(fs);
  } else if (floorId) {
    const floorInfo = INFRASTRUCTURE[floorId];
    if (floorInfo) {
      const g = new PIXI.Graphics();
      g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
      g.fill({ color: floorInfo.topColor });
      g.zIndex = isoDepth;
      this.infraLayer.addChild(g);
    }
  }

  // Tint overlay to show zone boundary
  const g = new PIXI.Graphics();
  g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
  g.fill({ color: zone.color, alpha: active ? 0.15 : 0.07 });
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
  // Zone furnishings render into the zoneLayer (after zones are drawn)
  const furnishings = this.game.state.zoneFurnishings || [];
  for (const furn of furnishings) {
    const furnDef = ZONE_FURNISHINGS[furn.type];
    if (!furnDef) continue;
    const texture = this.sprites.getTexture(furn.type);
    if (!texture) continue;

    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.7);
    const pos = tileCenterIso(furn.col, furn.row);
    sprite.x = pos.x;
    sprite.y = pos.y;
    sprite.zIndex = furn.col + furn.row;
    this.zoneLayer.addChild(sprite);

    const label = new PIXI.Text({
      text: furnDef.name,
      style: { fontFamily: 'monospace', fontSize: 9, fill: 0xcccccc },
    });
    label.anchor.set(0.5, 0);
    label.x = pos.x;
    label.y = pos.y + 8;
    this.labelLayer.addChild(label);
  }
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

  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) {
      const g = new PIXI.Graphics();
      const pos = tileCenterIso(c, r);
      const hw = TILE_W / 2;
      const hh = TILE_H / 2;

      g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
      g.fill({ color: canAfford ? previewColor : 0xcc3333, alpha: isZone ? 0.4 : 0.5 });
      g.stroke({ color: canAfford ? 0xffffff : 0xff4444, width: 1, alpha: 0.4 });

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

  for (const pt of path) {
    const g = new PIXI.Graphics();
    const pos = tileCenterIso(pt.col, pt.row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
    g.fill({ color: canAfford ? previewColor : 0xcc3333, alpha: 0.5 });
    g.stroke({ color: canAfford ? 0xffffff : 0xff4444, width: 1, alpha: 0.4 });
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
