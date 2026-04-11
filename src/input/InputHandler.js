import { COMPONENTS } from '../data/components.js';
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS, WALL_TYPES, DOOR_TYPES } from '../data/infrastructure.js';
import { DECORATIONS } from '../data/decorations.js';
import { MODES } from '../data/modes.js';
import { DIR, DIR_DELTA } from '../data/directions.js';
import { isoToGrid, isoToGridFloat, gridToIso, isoToSubGrid } from '../renderer/grid.js';
import { isFacilityCategory } from '../renderer/Renderer.js';
import { formatEnergy, UNITS } from '../data/units.js';
import { NetworkWindow } from '../ui/NetworkWindow.js';
import { ContextWindow } from '../ui/ContextWindow.js';

// === BEAMLINE TYCOON: INPUT HANDLER ===

function _demolishRefund(compOrDef) {
  if (!compOrDef) return 0;
  const cost = typeof compOrDef.cost === 'object' ? compOrDef.cost.funding || 0 : compOrDef.cost || 0;
  return Math.floor(cost * 0.5);
}

function _categoryColor(category) {
  const colors = {
    rfPower:       0xcc4444, // red
    rf:            0xcc4444, // red
    cooling:       0x4488cc, // blue
    vacuum:        0x999999, // grey
    power:         0xccaa44, // amber/yellow
    dataControls:  0x44cc88, // green
    ops:           0xcc8844, // orange
    diagnostic:    0x44aacc, // teal
    focusing:      0x8866cc, // purple
    source:        0xcccc44, // yellow
    beamOptics:    0x6688cc, // steel blue
    endpoint:      0xcc6688, // pink
  };
  return colors[category] || 0x88aaff;
}

function _effectLabel(key) {
  const labels = {
    zoneOutput: 'Zone Output', morale: 'Morale', research: 'Research',
    rfPower: 'RF Power', vacuumCapacity: 'Vacuum', coolingCapacity: 'Cooling',
    cryoCapacity: 'Cryo', powerCapacity: 'Power', dataCapacity: 'Data',
  };
  return labels[key] || key;
}

export class InputHandler {
  constructor(renderer, game) {
    this.renderer = renderer;
    this.game = game;
    this.selectedTool = null;       // component type string or null
    this.selectedCategory = 'source';
    this.dipoleBendDir = 'right';
    this.placementDir = DIR.NE;     // direction for source/free placement
    this.selectedNodeId = null;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.worldStart = { x: 0, y: 0 };
    // Infrastructure placement
    this.selectedInfraTool = null;  // infrastructure type or null
    this.selectedInfraVariant = 0;  // floor variant index
    this.selectedZoneTool = null;    // zone type or null
    this.demolishMode = false;       // structure demolish tool
    this.isDragging = false;
    this.dragStart = null;          // { col, row }
    this.dragEnd = null;            // { col, row }
    this.activeMode = 'beamline';
    this.selectedFacilityTool = null;
    this.selectedFurnishingTool = null; // zone furnishing type or null
    this.furnishingRotated = false;     // rotation state for sub-tile placement
    this.hoverSubCol = -1;              // sub-grid column under cursor
    this.hoverSubRow = -1;              // sub-grid row under cursor
    this.selectedDecorationTool = null; // decoration type or null
    this.selectedConnTool = null;
    this.isDrawingConn = false;
    this.connDrawMode = 'add';  // 'add' or 'remove'
    this.connPath = [];
    // Line placement (hallway)
    this.isDrawingLine = false;
    this.linePath = [];
    // Wall placement (edge-based)
    this.selectedWallTool = null;
    this.isDrawingWall = false;
    this.wallPath = [];
    // Door placement (edge-based, like walls)
    this.selectedDoorTool = null;
    this.isDrawingDoor = false;
    this.doorPath = [];
    // Continuous panning
    this.keysDown = new Set();
    // Bulldozer mode
    this.bulldozerMode = false;
    // Move mode
    this.moveMode = false;
    this._movePayload = null; // { kind, data } of picked-up object
    // Probe placement mode
    this.probeMode = false;
    // Beam pipe drawing
    this.beamPipeMode = false;
    this.drawingBeamPipe = false;
    this.beamPipeDrawMode = 'add'; // 'add' or 'remove'
    this.beamPipeStartId = null;
    this.beamPipePath = [];
    this.hoverPipePoint = null;
    // Palette keyboard navigation
    this.paletteIndex = -1;  // -1 = no keyboard focus
    // Hover tooltip state
    this._hoverTooltipTimer = null;
    this._hoverTooltipTarget = null; // 'furn:id' or 'equip:id'
    this._tooltipEl = null;
    this._bindKeyboard();
    this._bindMouse();
    this._startPanLoop();
  }

  // --- Hover tooltip ---

  _showTooltip(text, screenX, screenY) {
    this._hideTooltip();
    const el = document.createElement('div');
    el.className = 'hover-tooltip';
    el.innerHTML = text;
    el.style.left = (screenX + 12) + 'px';
    el.style.top = (screenY - 8) + 'px';
    document.body.appendChild(el);
    this._tooltipEl = el;
  }

  _hideTooltip() {
    if (this._tooltipEl) {
      this._tooltipEl.remove();
      this._tooltipEl = null;
    }
    if (this._hoverTooltipTimer) {
      clearTimeout(this._hoverTooltipTimer);
      this._hoverTooltipTimer = null;
    }
    this._hoverTooltipTarget = null;
  }

  _checkHoverTooltip(world, grid, screenX, screenY) {
    const col = grid.col, row = grid.row;
    const key = col + ',' + row;

    // Check furnishings (sub-tile)
    const subgrid = this.game.state.zoneFurnishingSubgrids[key];
    if (subgrid) {
      const tilePos = gridToIso(col, row);
      const sub = isoToSubGrid(world.x - tilePos.x, world.y - tilePos.y);
      const sc = Math.floor(sub.subCol);
      const sr = Math.floor(sub.subRow);
      if (sc >= 0 && sc < 4 && sr >= 0 && sr < 4) {
        const furnIdx = subgrid[sr][sc];
        if (furnIdx > 0) {
          const entry = this.game.state.zoneFurnishings[furnIdx - 1];
          if (entry) {
            const targetId = 'furn:' + entry.id;
            if (this._hoverTooltipTarget !== targetId) {
              this._hideTooltip();
              this._hoverTooltipTarget = targetId;
              this._hoverTooltipTimer = setTimeout(() => {
                const def = ZONE_FURNISHINGS[entry.type];
                if (!def) return;
                let html = `<b>${def.name}</b>`;
                if (def.effects) {
                  for (const [ek, ev] of Object.entries(def.effects)) {
                    if (ev === 0) continue;
                    const sign = ev > 0 ? '+' : '';
                    const label = _effectLabel(ek);
                    const val = typeof ev === 'number' && Math.abs(ev) < 1
                      ? (ev * 100).toFixed(0) + '%'
                      : String(ev);
                    html += `<br><span style="color:#8f8">${label}: ${sign}${val}</span>`;
                  }
                }
                this._showTooltip(html, screenX, screenY);
              }, 500);
            }
            return;
          }
        }
      }
    }

    // Check facility equipment
    const equipId = this.game.state.facilityGrid[key];
    if (equipId) {
      const targetId = 'equip:' + equipId;
      if (this._hoverTooltipTarget !== targetId) {
        this._hideTooltip();
        this._hoverTooltipTarget = targetId;
        this._hoverTooltipTimer = setTimeout(() => {
          const equip = this.game.state.facilityEquipment.find(e => e.id === equipId);
          if (!equip) return;
          const comp = COMPONENTS[equip.type];
          if (!comp) return;
          let html = `<b>${comp.name}</b>`;
          if (comp.category) html += `<br><span style="color:#888">${comp.category}</span>`;
          if (comp.energyCost) html += `<br><span style="color:#cc8">${comp.energyCost} kW</span>`;
          this._showTooltip(html, screenX, screenY);
        }, 500);
      }
      return;
    }

    // Nothing hovered — clear
    if (this._hoverTooltipTarget) {
      this._hideTooltip();
    }
  }

  // --- Demolish hover ---

  _updateDemolishHover(world, grid, screenX, screenY) {
    const col = grid.col, row = grid.row;
    const key = col + ',' + row;
    const dt = this.demolishType;

    // --- 3D raycast for components, equipment, furnishings ---
    // These are best detected by what's actually under the cursor in 3D.
    if (dt === 'demolishComponent' || dt === 'demolishFurnishing' || dt === 'demolishAll') {
      const hit = this.renderer.raycastScreen(screenX, screenY);
      if (hit) {
        const info = this.renderer.identifyHit(hit);
        if (info) {
          // Component
          if (info.group === 'component' && (dt === 'demolishComponent' || dt === 'demolishAll')) {
            let node = null;
            if (info.nodeId) {
              const nodes = this.game.registry.getAllNodes();
              node = nodes.find(n => n.id === info.nodeId);
            }
            // Fallback: derive tile from 3D position
            if (!node) {
              const p = info.rootObj.position;
              const hCol = Math.floor(p.x / 2);
              const hRow = Math.floor(p.z / 2);
              node = this._getNodeAtGrid(hCol, hRow);
            }
            if (!node) node = this._getNodeAtGrid(col, row);
            if (node) {
              const comp = COMPONENTS[node.type];
              this.renderer._clearPreview();
              this.renderer._outlineObject(info.rootObj);
              this._showDemolishTooltip(comp ? comp.name : node.type, _demolishRefund(comp), screenX, screenY);
              return;
            }
          }
          // Beam pipe
          if (info.group === 'beampipe' && (dt === 'demolishComponent' || dt === 'demolishAll')) {
            if (info.pipeId) {
              const pipe = (this.game.state.beamPipes || []).find(p => p.id === info.pipeId);
              if (pipe) {
                const segCount = Math.max(1, (pipe.path.length - 1) || 1);
                const driftDef = COMPONENTS.drift;
                const costPerTile = driftDef ? driftDef.cost.funding : 10000;
                const refund = Math.floor(costPerTile * segCount * 0.5);
                this.renderer._clearPreview();
                this.renderer._outlineObject(info.rootObj);
                this._showDemolishTooltip('Beam Pipe', refund, screenX, screenY);
                return;
              }
            }
          }
          // Equipment or furnishing — derive tile from 3D position, not iso grid
          if (info.group === 'equipment' && (dt === 'demolishFurnishing' || dt === 'demolishAll')) {
            const p = info.rootObj.position;
            const hitCol = Math.floor(p.x / 2);
            const hitRow = Math.floor(p.z / 2);
            const hitKey = hitCol + ',' + hitRow;

            // Check facility equipment at hit tile
            const equipId = this.game.state.facilityGrid[hitKey];
            if (equipId) {
              const equip = this.game.state.facilityEquipment.find(e => e.id === equipId);
              if (equip) {
                const comp = COMPONENTS[equip.type];
                this.renderer._clearPreview();
                this.renderer._outlineObject(info.rootObj);
                this._showDemolishTooltip(comp ? comp.name : equip.type, _demolishRefund(comp), screenX, screenY);
                return;
              }
            }

            // Check furnishings — find the entry whose sub-tile position matches
            const subgrid = this.game.state.zoneFurnishingSubgrids[hitKey];
            if (subgrid) {
              const subX = Math.floor((p.x - hitCol * 2) / 0.5);
              const subZ = Math.floor((p.z - hitRow * 2) / 0.5);
              if (subX >= 0 && subX < 4 && subZ >= 0 && subZ < 4) {
                const furnIdx = subgrid[subZ][subX];
                if (furnIdx > 0) {
                  const entry = this.game.state.zoneFurnishings[furnIdx - 1];
                  if (entry) {
                    const def = ZONE_FURNISHINGS[entry.type];
                    this.renderer._clearPreview();
                    this.renderer._outlineObject(info.rootObj);
                    this._showDemolishTooltip(def ? def.name : entry.type, def ? Math.floor((def.cost || 0) * 0.5) : 0, screenX, screenY);
                    return;
                  }
                }
              }
            }

            // Last resort — scan all facility equipment for closest match
            let bestEquip = null, bestDist = Infinity;
            for (const eq of this.game.state.facilityEquipment) {
              const ex = eq.col * 2 + 1, ez = eq.row * 2 + 1;
              const d = Math.abs(p.x - ex) + Math.abs(p.z - ez);
              if (d < bestDist) { bestDist = d; bestEquip = eq; }
            }
            if (bestEquip && bestDist < 3) {
              const comp = COMPONENTS[bestEquip.type];
              this.renderer._clearPreview();
              this.renderer._outlineObject(info.rootObj);
              this._showDemolishTooltip(comp ? comp.name : bestEquip.type, _demolishRefund(comp), screenX, screenY);
              return;
            }

            // Scan furnishings
            let bestFurn = null, bestFDist = Infinity;
            for (const f of this.game.state.zoneFurnishings) {
              if (!f) continue;
              const fx = f.col * 2 + (f.subCol || 0) * 0.5 + 0.25;
              const fz = f.row * 2 + (f.subRow || 0) * 0.5 + 0.25;
              const d = Math.abs(p.x - fx) + Math.abs(p.z - fz);
              if (d < bestFDist) { bestFDist = d; bestFurn = f; }
            }
            if (bestFurn && bestFDist < 3) {
              const def = ZONE_FURNISHINGS[bestFurn.type];
              this.renderer._clearPreview();
              this.renderer._outlineObject(info.rootObj);
              this._showDemolishTooltip(def ? def.name : bestFurn.type, def ? Math.floor((def.cost || 0) * 0.5) : 0, screenX, screenY);
              return;
            }

            // Truly unknown — still outline it but show generic
            this.renderer._clearPreview();
            this.renderer._outlineObject(info.rootObj);
            this._showDemolishTooltip('Unknown', 0, screenX, screenY);
            return;
          }
        }
      }
    }

    // --- Tile-based fallback for flat objects (zones, floors, connections) ---
    let found = false;

    // Zones
    if (!found && (dt === 'demolishZone' || dt === 'demolishAll')) {
      const zoneType = this.game.state.zoneOccupied[key];
      if (zoneType) {
        const zone = ZONES[zoneType];
        this.renderer.renderDemolishPreview(col, row, col, row);
        this._showDemolishTooltip(zone ? zone.name : zoneType, 0, screenX, screenY);
        found = true;
      }
    }

    // Connections
    if (!found && (dt === 'demolishConnection' || dt === 'demolishAll')) {
      const connTypes = this.game.state.connections.get(key);
      if (connTypes && connTypes.size > 0) {
        this.renderer.renderDemolishPreview(col, row, col, row);
        this._showDemolishTooltip([...connTypes].join(', '), 0, screenX, screenY);
        found = true;
      }
    }

    // Infrastructure / floor
    if (!found && (dt === 'demolishFloor' || dt === 'demolishAll')) {
      const infraType = this.game.state.infraOccupied[key];
      if (infraType) {
        const infra = INFRASTRUCTURE[infraType];
        this.renderer.renderDemolishPreview(col, row, col, row);
        this._showDemolishTooltip(infra ? infra.name : infraType, infra ? Math.floor((infra.cost || 0) * 0.5) : 0, screenX, screenY);
        found = true;
      }
    }

    if (!found) {
      this.renderer.clearDragPreview();
      this._hideDemolishTooltip();
    }
  }

  _showDemolishTooltip(name, refund, screenX, screenY) {
    if (!this._demolishTooltipEl) {
      const el = document.createElement('div');
      el.className = 'hover-tooltip demolish-tooltip';
      document.body.appendChild(el);
      this._demolishTooltipEl = el;
    }
    const el = this._demolishTooltipEl;
    let html = `<span style="color:#ff6666">${name}</span>`;
    if (refund > 0) {
      html += `<br><span style="color:#66ff88">+$${refund.toLocaleString()}</span>`;
    }
    el.innerHTML = html;
    el.style.left = (screenX + 14) + 'px';
    el.style.top = (screenY - 10) + 'px';
    el.style.display = 'block';
  }

  _hideDemolishTooltip() {
    if (this._demolishTooltipEl) {
      this._demolishTooltipEl.style.display = 'none';
    }
  }

  // --- Helper methods for multi-beamline support ---

  _getNodeAtGrid(col, row) {
    const blId = this.game.registry.sharedOccupied[col + ',' + row];
    if (!blId) return null;
    const entry = this.game.registry.get(blId);
    if (!entry) return null;
    return entry.beamline.getAllNodes().find(n =>
      n.tiles.some(t => t.col === col && t.row === row)
    ) || null;
  }

  /**
   * Find a beamline node by raycasting the 3D scene first, then falling back to tile lookup.
   */
  _getNodeAtScreenOrGrid(screenX, screenY, col, row) {
    // Try 3D raycast first (picks the visible object under the cursor)
    if (this.renderer.raycastScreen) {
      const hit = this.renderer.raycastScreen(screenX, screenY);
      if (hit) {
        const info = this.renderer.identifyHit(hit);
        if (info && info.group === 'component' && info.nodeId) {
          const nodes = this.game.registry.getAllNodes();
          const node = nodes.find(n => n.id === info.nodeId);
          if (node) return node;
        }
      }
    }
    // Fallback to tile-based lookup
    return this._getNodeAtGrid(col, row);
  }

  _getActiveBuildCursors() {
    if (!this.game.editingBeamlineId) return [];
    const entry = this.game.registry.get(this.game.editingBeamlineId);
    if (!entry) return [];
    return entry.beamline.getBuildCursors();
  }

  _getActiveBeamlineNodes() {
    if (!this.game.editingBeamlineId) return [];
    const entry = this.game.registry.get(this.game.editingBeamlineId);
    if (!entry) return [];
    return entry.beamline.getAllNodes();
  }

  _getNearestEdge(screenX, screenY) {
    const world = this.renderer.screenToWorld(screenX, screenY);
    const gf = isoToGridFloat(world.x, world.y);
    const col = Math.floor(gf.col);
    const row = Math.floor(gf.row);
    const fx = gf.col - col;
    const fy = gf.row - row;

    // Distance to each edge of THIS tile (no canonicalization)
    const dN = fy;        // north (NE edge)
    const dS = 1 - fy;    // south (SW edge)
    const dE = 1 - fx;    // east (SE edge)
    const dW = fx;         // west (NW edge)

    const min = Math.min(dN, dS, dE, dW);
    if (min === dN) return { col, row, edge: 'n' };
    if (min === dS) return { col, row, edge: 's' };
    if (min === dE) return { col, row, edge: 'e' };
    return { col, row, edge: 'w' };
  }

  /**
   * Build a straight line of wall edges from start to the cursor edge.
   * Walls lock to the start edge type and extend along the appropriate axis:
   *   'e'/'w' edges: same col, vary row (wall runs SE ↔ NW)
   *   'n'/'s' edges: same row, vary col (wall runs NE ↔ SW)
   */
  _buildWallLine(start, end) {
    const path = [];
    if (start.edge === 'e' || start.edge === 'w') {
      const col = start.col;
      const minR = Math.min(start.row, end.row);
      const maxR = Math.max(start.row, end.row);
      for (let r = minR; r <= maxR; r++) {
        path.push({ col, row: r, edge: start.edge });
      }
    } else {
      const row = start.row;
      const minC = Math.min(start.col, end.col);
      const maxC = Math.max(start.col, end.col);
      for (let c = minC; c <= maxC; c++) {
        path.push({ col: c, row, edge: start.edge });
      }
    }
    return path;
  }

  /**
   * Find a beamline placeable occupying the given tile.
   */
  _findBeamlineComponentAt(col, row) {
    // Check placeables
    const placeables = this.game.state.placeables;
    for (const p of placeables) {
      if (p.category !== 'beamline') continue;
      if (p.cells && p.cells.some(c => c.col === col && c.row === row)) {
        return p;
      }
      if (p.col === col && p.row === row) return p;
    }
    // Also check registry beamline nodes
    for (const entry of this.game.registry.getAll()) {
      for (const node of entry.beamline.nodes) {
        if (node.tiles && node.tiles.some(t => t.col === col && t.row === row)) {
          return { id: node.id, type: node.type, col: node.col, row: node.row, dir: node.dir, category: 'beamline' };
        }
      }
    }
    return null;
  }

  /**
   * Find the nearest beamline component within a search radius.
   */
  _findNearestBeamlineComponent(col, row, radius = 3) {
    let best = null;
    let bestDist = Infinity;
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const comp = this._findBeamlineComponentAt(col + dc, row + dr);
        if (comp) {
          const dist = Math.abs(dc) + Math.abs(dr);
          if (dist < bestDist) {
            bestDist = dist;
            best = comp;
          }
        }
      }
    }
    return best;
  }

  /**
   * Check if a beam pipe approaching from (approachDc, approachDr) is aligned
   * with a component's beam axis. Returns true if the pipe arrives along the
   * component's axis (either end), false if perpendicular.
   */
  _isPipeAlignedWithComponent(comp, approachDc, approachDr) {
    const dir = comp.dir;
    if (dir === undefined || dir === null) return true; // no direction info, allow
    const axis = DIR_DELTA[dir]; // e.g. NE={dc:0,dr:-1}
    // Pipe is aligned if its approach vector is parallel to the component axis
    // (same or opposite direction). Check via cross product = 0.
    return (approachDc * axis.dr - approachDr * axis.dc) === 0;
  }

  /**
   * Build an L-shaped path from one point to another in 0.5-tile (half-tile)
   * steps so pipes snap to sub-tile gridlines (2 sub-units per step).
   */
  _buildStraightPath(from, to) {
    const STEP = 0.5;
    const EPS = 0.001;
    const path = [];
    const dc = to.col > from.col + EPS ? STEP : (to.col < from.col - EPS ? -STEP : 0);
    const dr = to.row > from.row + EPS ? STEP : (to.row < from.row - EPS ? -STEP : 0);

    let c = from.col, r = from.row;
    path.push({ col: c, row: r });

    let safety = 2048;
    while (dc !== 0 && Math.abs(c - to.col) > EPS && safety-- > 0) {
      c += dc;
      path.push({ col: c, row: r });
    }
    while (dr !== 0 && Math.abs(r - to.row) > EPS && safety-- > 0) {
      r += dr;
      path.push({ col: c, row: r });
    }

    return path;
  }

  /**
   * Snap a world position to the nearest half-tile gridline for beam pipes.
   */
  _snapPipePoint(worldX, worldY) {
    const fc = isoToGridFloat(worldX, worldY);
    return {
      col: Math.round(fc.col * 2) / 2,
      row: Math.round(fc.row * 2) / 2,
    };
  }

  /**
   * Snap a beamline module to the nearest integer sub-cell under the cursor.
   * Works at sub-tile resolution without clamping to the hovered tile, so
   * large modules (undulator, linacCell) can span tile boundaries at 0.5m
   * granularity. Returns the origin {col,row,subCol,subRow} expected by
   * Game.placePlaceable.
   */
  _computeModuleSubSnap(worldX, worldY, compDef) {
    const gw = compDef.gridW || compDef.subW || 4;
    const gh = compDef.gridH || compDef.subL || 4;
    const fc = isoToGridFloat(worldX, worldY);
    // Cursor in absolute sub-cell units (4 sub-cells per tile along each axis)
    const subCenterCol = fc.col * 4;
    const subCenterRow = fc.row * 4;
    const topLeftSubCol = Math.round(subCenterCol - gw / 2);
    const topLeftSubRow = Math.round(subCenterRow - gh / 2);
    const col = Math.floor(topLeftSubCol / 4);
    const row = Math.floor(topLeftSubRow / 4);
    const subCol = topLeftSubCol - col * 4;
    const subRow = topLeftSubRow - row * 4;
    return { col, row, subCol, subRow };
  }

  /**
   * Find an available (unconnected) port on a module.
   * @param {string} placeableId
   * @param {'entry'|'exit'} direction - 'exit' for source-side ports, 'entry' for dest-side ports
   * @returns {string|null} port name or null if all matching ports are taken
   */
  _findAvailablePort(placeableId, direction) {
    const placeable = this.game.getPlaceable(placeableId);
    if (!placeable) return null;
    const def = COMPONENTS[placeable.type];
    if (!def || !def.ports) return null;

    const connectedPorts = new Set();
    for (const pipe of this.game.state.beamPipes) {
      if (pipe.fromId === placeableId) connectedPorts.add(pipe.fromPort);
      if (pipe.toId === placeableId) connectedPorts.add(pipe.toPort);
    }

    for (const [portName, portDef] of Object.entries(def.ports)) {
      if (connectedPorts.has(portName)) continue;
      if (direction === 'exit') {
        // Exit ports: name starts with 'exit', or side is 'front' / 'left' / 'right'
        if (portName.startsWith('exit') || portDef.side === 'front' || portDef.side === 'left' || portDef.side === 'right') return portName;
      } else {
        // Entry ports: name is 'entry', or side is 'back'
        if (portName === 'entry' || portDef.side === 'back') return portName;
      }
    }
    return null;
  }

  /**
   * Find the beam pipe closest to the given grid position.
   * Returns null if no pipe is within 1 tile of the position.
   */
  _findNearestPipe(col, row) {
    let bestPipe = null;
    let bestDist = Infinity;

    for (const pipe of this.game.state.beamPipes) {
      for (const pt of pipe.path) {
        const dist = Math.abs(pt.col - col) + Math.abs(pt.row - row);
        if (dist < bestDist) {
          bestDist = dist;
          bestPipe = pipe;
        }
      }
    }

    return bestDist <= 1 ? bestPipe : null;
  }

  /**
   * Get the normalized 0..1 position along a pipe for a given grid coordinate.
   */
  _getPipePosition(pipe, col, row) {
    if (pipe.path.length <= 1) return 0.5;

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pipe.path.length; i++) {
      const dist = Math.abs(pipe.path[i].col - col) + Math.abs(pipe.path[i].row - row);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    return bestIdx / (pipe.path.length - 1);
  }

  /**
   * Return the nearest edge of the cursor's tile, preferring edges that sit
   * on a flooring boundary (one side has infrastructure, the other doesn't).
   */
  _getNearestFloorEdge(screenX, screenY) {
    const world = this.renderer.screenToWorld(screenX, screenY);
    const gf = isoToGridFloat(world.x, world.y);
    const col = Math.floor(gf.col);
    const row = Math.floor(gf.row);
    const fx = gf.col - col;
    const fy = gf.row - row;

    // All 4 edges of this tile with distances (no canonicalization)
    const candidates = [
      { col, row, edge: 'n', dist: fy },
      { col, row, edge: 's', dist: 1 - fy },
      { col, row, edge: 'e', dist: 1 - fx },
      { col, row, edge: 'w', dist: fx },
    ];

    const occ = this.game.state.infraOccupied;

    // Neighbor tile across each edge
    const neighbor = (e) => {
      if (e.edge === 'n') return `${e.col},${e.row - 1}`;
      if (e.edge === 's') return `${e.col},${e.row + 1}`;
      if (e.edge === 'e') return `${e.col + 1},${e.row}`;
      return `${e.col - 1},${e.row}`;
    };

    const isFloorBoundary = (e) => {
      const a = !!occ[`${e.col},${e.row}`];
      const b = !!occ[neighbor(e)];
      return a !== b;
    };

    candidates.sort((a, b) => {
      const aScore = a.dist - (isFloorBoundary(a) ? 0.15 : 0);
      const bScore = b.dist - (isFloorBoundary(b) ? 0.15 : 0);
      return aScore - bScore;
    });

    return candidates[0];
  }

  // --- Keyboard bindings ---

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Skip if focused on text input
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Skip normal input handling when controller overlay is open
      if (this.game._designer && this.game._designer.isOpen) return;

      // Ctrl+Z → undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        this.game.undo();
        return;
      }

      // Handle DesignPlacer keys
      if (this.game._designPlacer && this.game._designPlacer.active) {
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          this.game._designPlacer.rotate();
          this.renderer._renderCursors();
          return;
        }
        if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          this.game._designPlacer.reflect();
          this.renderer._renderCursors();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          this.game._designPlacer.cancel();
          return;
        }
        return; // block other keys while placing
      }

      // Arrow keys → palette navigation
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this._handlePaletteNav(e.key);
        return;
      }

      // Track pan keys for continuous movement (WASD only)
      const panKeys = ['w','W','s','S','a','A','d','D'];
      if (panKeys.includes(e.key)) {
        this.keysDown.add(e.key);
        e.preventDefault();
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.game._pushUndo();
          if (this.selectedTool) {
            const comp = COMPONENTS[this.selectedTool];
            if (comp && !comp.isDrawnConnection) {
              if (comp.placement === 'attachment') {
                // Attachment: snap to the nearest pipe
                const pipe = this._findNearestPipe(this.renderer.hoverCol, this.renderer.hoverRow);
                if (pipe) {
                  const position = this._getPipePosition(pipe, this.renderer.hoverCol, this.renderer.hoverRow);
                  this.game.addAttachmentToPipe(pipe.id, this.selectedTool, position, this.selectedParamOverrides);
                } else {
                  this.game.log('Must place on a beam pipe!', 'bad');
                }
              } else if (comp.isSource) {
                // Sources are regular beamline placeables (isSource=true on the definition)
                const snap = this.hoverCompSnap || { col: this.renderer.hoverCol, row: this.renderer.hoverRow, subCol: 0, subRow: 0 };
                const entryId = this.game.placePlaceable({
                  type: this.selectedTool,
                  category: 'beamline',
                  col: snap.col,
                  row: snap.row,
                  subCol: snap.subCol,
                  subRow: snap.subRow,
                  rotated: false,
                  dir: this.placementDir,
                  params: this.selectedParamOverrides,
                });
                if (entryId) {
                  // Auto-switch to beam pipe tool after placing source
                  this.selectTool('drift');
                }
              } else {
                // Non-source module — unified placement
                const snap = this.hoverCompSnap || { col: this.renderer.hoverCol, row: this.renderer.hoverRow, subCol: 0, subRow: 0 };
                this.game.placePlaceable({
                  type: this.selectedTool,
                  category: 'beamline',
                  col: snap.col,
                  row: snap.row,
                  subCol: snap.subCol,
                  subRow: snap.subRow,
                  rotated: false,
                  dir: this.placementDir,
                  params: this.selectedParamOverrides,
                });
              }
            }
          } else if (this.selectedFacilityTool) {
            this.game.placeFacilityEquipment(this.renderer.hoverCol, this.renderer.hoverRow, this.selectedFacilityTool);
          } else if (this.selectedFurnishingTool) {
            this.game.placeZoneFurnishing(this.renderer.hoverCol, this.renderer.hoverRow, this.selectedFurnishingTool, this.hoverSubCol, this.hoverSubRow, this.furnishingRotated);
          } else if (this.selectedInfraTool) {
            const infra = INFRASTRUCTURE[this.selectedInfraTool];
            if (infra && !infra.isDragPlacement && !infra.isLinePlacement) {
              if (this.game.placeInfraTile(this.renderer.hoverCol, this.renderer.hoverRow, this.selectedInfraTool, this.selectedInfraVariant)) {
                this.game.emit('infrastructureChanged');
              }
            }
          } else {
            this.game.toggleBeam();
          }
          break;
        case 'r': case 'R': {
          if (this.moveMode && this._movePayload && this._movePayload.kind === 'furnishing') {
            this._movePayload.rotated = !this._movePayload.rotated;
            return;
          }
          if (this.selectedFurnishingTool) {
            this.furnishingRotated = !this.furnishingRotated;
            return;
          }
          if (this.selectedDecorationTool) {
            const dd = DECORATIONS[this.selectedDecorationTool];
            if (dd && dd.gridW && dd.gridH) {
              this.furnishingRotated = !this.furnishingRotated;
              return;
            }
          }
          const overlay = document.getElementById('research-overlay');
          if (overlay) overlay.classList.toggle('hidden');
          break;
        }
        case 'g': case 'G': {
          const overlay = document.getElementById('goals-overlay');
          if (overlay) overlay.classList.toggle('hidden');
          break;
        }
        case 'Escape':
          // Close topmost context window first
          if (ContextWindow.closeTopmost()) break;
          // Exit move mode
          if (this.moveMode) {
            this._exitMoveMode();
            break;
          }
          // If in context-aware demolish (mode didn't change), just deselect
          if (this.demolishMode && this.activeMode !== 'demolish') {
            this.deselectDemolishTool();
            this._hidePreview();
            break;
          }
          // If in full demolish mode, restore previous mode
          if (this.demolishMode || this.bulldozerMode) {
            this._restorePreviousMode();
            break;
          }
          // Exit edit mode if active
          if (this.game.editingBeamlineId) {
            this.game.editingBeamlineId = null;
            this.game.emit('editModeChanged', null);
          }
          // Close network overlay if active
          if (this.renderer.activeNetworkType) {
            this.renderer.clearNetworkOverlay();
            // Don't return — let other Escape handling also run
          }
          // Close all overlays
          document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
          this.deselectTool();
          this.deselectInfraTool();
          this.deselectFacilityTool();
          this.deselectFurnishingTool();
          this.deselectConnTool();
          this.deselectZoneTool();
          this.deselectDemolishTool();
          this.bulldozerMode = false;
          this.renderer.setBulldozerMode(false);
          this.probeMode = false;
          this.renderer.setProbeMode(false);
          this.selectedNodeId = null;
          this.renderer.hidePopup();
          this.paletteIndex = -1;
          this._hidePreview();
          document.querySelectorAll('.palette-item').forEach(el => el.classList.remove('kb-focus'));
          break;
        case 'Tab': {
          e.preventDefault();
          const mode = MODES[this.activeMode];
          if (!mode || mode.disabled) break;
          const catKeys = Object.keys(mode.categories);
          const tabs = document.querySelectorAll('.cat-tab');
          const tabCats = Array.from(tabs).map(t => t.dataset.category);
          const curIdx = tabCats.indexOf(this.selectedCategory);
          const nextIdx = (curIdx + 1) % tabCats.length;
          this.selectedCategory = tabCats[nextIdx];
          tabs.forEach(t => t.classList.remove('active'));
          tabs[nextIdx].classList.add('active');
          this.renderer.updatePalette(this.selectedCategory);
          this.paletteIndex = -1;
          this._hidePreview();
          break;
        }
        case 'f': case 'F':
          // Rotate placement direction (cycles NE→SE→SW→NW)
          this.placementDir = (this.placementDir + 1) % 4;
          this.renderer.updatePlacementDir(this.placementDir);
          // Re-render equipment ghost so the 3D preview rotates immediately
          if (this.selectedTool && this.renderer.hoverCol !== undefined) {
            const comp = COMPONENTS[this.selectedTool];
            if (comp && comp.isDrawnConnection) {
              this.renderer.renderEquipmentGhost(this.renderer.hoverCol, this.renderer.hoverRow, this.selectedTool, 0x44cc44);
            }
          }
          // Also toggle dipole bend direction
          this.dipoleBendDir = this.dipoleBendDir === 'right' ? 'left' : 'right';
          this.renderer.updateCursorBendDir(this.dipoleBendDir);
          // Rotate furnishings and decorations
          if (this.selectedFurnishingTool) {
            this.furnishingRotated = !this.furnishingRotated;
          }
          if (this.selectedDecorationTool) {
            const dd = DECORATIONS[this.selectedDecorationTool];
            if (dd && dd.gridW && dd.gridH) {
              this.furnishingRotated = !this.furnishingRotated;
            }
          }
          // Rotate move payload
          if (this.moveMode && this._movePayload) {
            if (this._movePayload.kind === 'furnishing') {
              this._movePayload.rotated = !this._movePayload.rotated;
            } else if (this._movePayload.kind === 'component') {
              this._movePayload.direction = ((this._movePayload.direction || 0) + 1) % 4;
            }
          }
          break;
        case 'c': case 'C':
          if (this.game._designer && !this.game._designer.isOpen) {
            e.preventDefault();
            const blId = this.game.selectedBeamlineId || this.game.editingBeamlineId;
            if (blId) {
              this.game._designer.open(blId);
            } else {
              // Reopen last designer session or open blank
              const saved = this.game.state.designerState;
              if (saved && saved.mode === 'edit' && saved.beamlineId) {
                this.game._designer.open(saved.beamlineId);
              } else if (saved && saved.mode === 'design') {
                const design = saved.designId ? this.game.getDesign(saved.designId) : null;
                this.game._designer.openDesign(design);
              } else {
                this.game._designer.openDesign(null);
              }
            }
          }
          break;
        case 'p': case 'P':
          this.probeMode = !this.probeMode;
          if (this.probeMode) {
            this.deselectTool();
            this.deselectInfraTool();
            this.deselectFacilityTool();
            this.deselectFurnishingTool();
            this.deselectConnTool();
            this.deselectZoneTool();
            this.deselectDemolishTool();
            this.bulldozerMode = false;
            this.renderer.setBulldozerMode(false);
            this.renderer.setProbeMode(true);
          } else {
            this.renderer.setProbeMode(false);
          }
          break;
        case 'i': case 'I': {
          const levelName = this.renderer.cycleLabelLevel();
          this._showToast(`Labels: ${levelName}`);
          break;
        }
        case 'z': case 'Z': {
          if (e.ctrlKey || e.metaKey) break; // let Ctrl+Z undo through
          const visible = this.renderer.toggleZoneOverlay();
          this._showToast(`Zones: ${visible ? 'On' : 'Off'}`);
          break;
        }
        case 'm': case 'M':
          this._toggleMoveMode();
          break;
        case 'Delete': case 'Backspace':
          e.preventDefault();
          // Toggle context-aware demolish without leaving current menu
          this._toggleContextDemolish();
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.key);
    });
  }

  _startPanLoop() {
    const PAN_SPEED = 5;
    const loop = () => {
      let dx = 0, dy = 0;
      if (this.keysDown.has('w') || this.keysDown.has('W')) dy -= PAN_SPEED;
      if (this.keysDown.has('s') || this.keysDown.has('S')) dy += PAN_SPEED;
      if (this.keysDown.has('a') || this.keysDown.has('A')) dx -= PAN_SPEED;
      if (this.keysDown.has('d') || this.keysDown.has('D')) dx += PAN_SPEED;
      if (dx !== 0 || dy !== 0) {
        this.renderer.panBy(dx, dy);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // --- Mouse bindings ---

  _bindMouse() {
    const canvas = this.renderer.app.canvas;

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      this.renderer.zoomAt(e.clientX, e.clientY, delta);
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
      // Middle mouse button or alt+left click → start panning
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this.isPanning = true;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.worldStart = { x: this.renderer.world.x, y: this.renderer.world.y };
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      // Connection drawing start (left click = add, right click = remove)
      if (this.selectedConnTool && (e.button === 0 || e.button === 2)) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        this.isDrawingConn = true;
        this.connDrawMode = e.button === 0 ? 'add' : 'remove';
        this.connPath = [{ col: grid.col, row: grid.row }];
        this.renderer.renderConnLinePreview(this.connPath, this.selectedConnTool, this.connDrawMode);
        return;
      }

      // Beam pipe drawing start
      if ((e.button === 0 || e.button === 2) && this.selectedTool && COMPONENTS[this.selectedTool]?.isDrawnConnection) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const startPt = this._snapPipePoint(world.x, world.y);

        if (e.button === 2) {
          // Right-click on pipe to remove (drag to select multiple)
          this.drawingBeamPipe = true;
          this.beamPipeDrawMode = 'remove';
          this.beamPipeStartId = null;
          this.beamPipePath = [startPt];
          this.renderer.renderBeamPipePreview(this.beamPipePath, 'remove');
          return;
        }

        // Left-click: start drawing anywhere. Endpoints resolve on mouseup.
        this.drawingBeamPipe = true;
        this.beamPipeDrawMode = 'add';
        this.beamPipeStartId = null;
        this.beamPipePath = [startPt];
        this.renderer.renderBeamPipePreview(this.beamPipePath, 'add');
        return;
      }

      // Demolish drag start
      if (e.button === 0 && this.demolishMode) {
        if (this.demolishType === 'demolishWall') {
          const edge = this._getNearestEdge(e.clientX, e.clientY);
          this.isDrawingWall = true;
          this._wallStart = edge;
          this.wallPath = [edge];
          return;
        }
        if (this.demolishType === 'demolishDoor') {
          const edge = this._getNearestEdge(e.clientX, e.clientY);
          this.isDrawingDoor = true;
          this._doorStart = edge;
          this.doorPath = [edge];
          return;
        }
        // Component and furnishing demolish are click-on-object, not drag-based
        if (this.demolishType === 'demolishFurnishing' || this.demolishType === 'demolishComponent') {
          return; // handled in _handleClick
        }
        this.isDragging = true;
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        this.dragStart = { col: grid.col, row: grid.row };
        this.dragEnd = { col: grid.col, row: grid.row };
      }

      // Zone drag start
      if (e.button === 0 && this.selectedZoneTool) {
        this.isDragging = true;
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        this.dragStart = { col: grid.col, row: grid.row };
        this.dragEnd = { col: grid.col, row: grid.row };
      }

      // Infrastructure line placement start (hallway)
      if (e.button === 0 && this.selectedInfraTool) {
        const infra = INFRASTRUCTURE[this.selectedInfraTool];
        if (infra && infra.isLinePlacement) {
          const world = this.renderer.screenToWorld(e.clientX, e.clientY);
          const grid = isoToGrid(world.x, world.y);
          this.isDrawingLine = true;
          this.linePath = [{ col: grid.col, row: grid.row }];
          this.renderer.renderLinePreview(this.linePath, this.selectedInfraTool);
          return;
        }
      }

      // Wall edge placement start
      if (e.button === 0 && this.selectedWallTool) {
        const edge = this._getNearestFloorEdge(e.clientX, e.clientY);
        this.isDrawingWall = true;
        this._wallStart = edge;
        this.wallPath = [edge];
        this.renderer.renderWallPreview(this.wallPath, this.selectedWallTool);
        return;
      }

      // Door edge placement start
      if (e.button === 0 && this.selectedDoorTool) {
        const edge = this._getNearestFloorEdge(e.clientX, e.clientY);
        this.isDrawingDoor = true;
        this._doorStart = edge;
        this.doorPath = [edge];
        this.renderer.renderDoorPreview(this.doorPath, this.selectedDoorTool);
        return;
      }

      // Infrastructure drag start (area placement)
      if (e.button === 0 && this.selectedInfraTool) {
        const infra = INFRASTRUCTURE[this.selectedInfraTool];
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        if (infra && infra.isDragPlacement) {
          this.isDragging = true;
          this.dragStart = { col: grid.col, row: grid.row };
          this.dragEnd = { col: grid.col, row: grid.row };
          this.renderer.renderDragPreview(grid.col, grid.row, grid.col, grid.row, this.selectedInfraTool);
        }
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.panStart.x;
        const dy = e.clientY - this.panStart.y;
        this.renderer.world.x = this.worldStart.x + dx;
        this.renderer.world.y = this.worldStart.y + dy;
      } else if (this.isDragging && this.dragStart) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        this.dragEnd = { col: grid.col, row: grid.row };
        if (this.demolishMode) {
          this.renderer.renderDemolishPreview(
            this.dragStart.col, this.dragStart.row,
            grid.col, grid.row
          );
        } else if (this.selectedZoneTool) {
          this.renderer.renderDragPreview(
            this.dragStart.col, this.dragStart.row,
            grid.col, grid.row, this.selectedZoneTool, true
          );
        } else {
          this.renderer.renderDragPreview(
            this.dragStart.col, this.dragStart.row,
            grid.col, grid.row, this.selectedInfraTool
          );
        }
      } else if (this.isDrawingLine && this.selectedInfraTool) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        const last = this.linePath[this.linePath.length - 1];
        if (grid.col !== last.col || grid.row !== last.row) {
          // Only add if adjacent (no diagonal jumps)
          const dc = Math.abs(grid.col - last.col);
          const dr = Math.abs(grid.row - last.row);
          if (dc + dr === 1) {
            this.linePath.push({ col: grid.col, row: grid.row });
          } else {
            // Bridge gap with straight line to cursor
            const steps = Math.max(dc, dr);
            for (let i = 1; i <= steps; i++) {
              const ic = last.col + Math.round((grid.col - last.col) * i / steps);
              const ir = last.row + Math.round((grid.row - last.row) * i / steps);
              const prev = this.linePath[this.linePath.length - 1];
              if (ic !== prev.col || ir !== prev.row) {
                this.linePath.push({ col: ic, row: ir });
              }
            }
          }
          this.renderer.renderLinePreview(this.linePath, this.selectedInfraTool);
        }
      } else if (this.isDrawingWall && this.selectedWallTool) {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        this.wallPath = this._buildWallLine(this._wallStart, edge);
        this.renderer.renderWallPreview(this.wallPath, this.selectedWallTool);
      } else if (this.isDrawingWall && this.demolishMode && this.demolishType === 'demolishWall') {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        this.wallPath = this._buildWallLine(this._wallStart, edge);
        this.renderer.renderWallPreview(this.wallPath, this.selectedWallTool || 'exteriorWall');
      } else if (this.isDrawingDoor && this.demolishMode && this.demolishType === 'demolishDoor') {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        this.doorPath = this._buildWallLine(this._doorStart, edge);
        this.renderer.renderDoorPreview(this.doorPath, 'officeDoor');
      } else if (this.selectedWallTool && !this.isDrawingWall) {
        const edge = this._getNearestFloorEdge(e.clientX, e.clientY);
        this.renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
      } else if (this.isDrawingDoor && this.selectedDoorTool) {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        this.doorPath = this._buildWallLine(this._doorStart, edge);
        this.renderer.renderDoorPreview(this.doorPath, this.selectedDoorTool);
      } else if (this.selectedDoorTool && !this.isDrawingDoor) {
        const edge = this._getNearestFloorEdge(e.clientX, e.clientY);
        this.renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
      } else if (this.demolishMode && !this.isDragging && !this.isDrawingWall && !this.isDrawingDoor &&
                 (this.demolishType === 'demolishWall' || this.demolishType === 'demolishDoor')) {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        this.renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge, 0xff4444);
      } else if (this.isDrawingConn && this.selectedConnTool) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        const last = this.connPath[this.connPath.length - 1];
        if (grid.col !== last.col || grid.row !== last.row) {
          const dc = Math.abs(grid.col - last.col);
          const dr = Math.abs(grid.row - last.row);
          if (dc + dr === 1) {
            this.connPath.push({ col: grid.col, row: grid.row });
          } else {
            // Bridge gap with straight line to cursor
            const steps = Math.max(dc, dr);
            for (let i = 1; i <= steps; i++) {
              const ic = last.col + Math.round((grid.col - last.col) * i / steps);
              const ir = last.row + Math.round((grid.row - last.row) * i / steps);
              const prev = this.connPath[this.connPath.length - 1];
              if (ic !== prev.col || ir !== prev.row) {
                this.connPath.push({ col: ic, row: ir });
              }
            }
          }
          this.renderer.renderConnLinePreview(this.connPath, this.selectedConnTool, this.connDrawMode);
        }
      } else if (this.drawingBeamPipe) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const pt = this._snapPipePoint(world.x, world.y);
        const last = this.beamPipePath[this.beamPipePath.length - 1];
        if (last && (last.col !== pt.col || last.row !== pt.row)) {
          this.beamPipePath = this._buildStraightPath(this.beamPipePath[0], pt);
          this.renderer.renderBeamPipePreview(this.beamPipePath, this.beamPipeDrawMode);
        }
      } else {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        this.renderer.updateHover(grid.col, grid.row);
        this.hoverPipePoint = null;
        // Show cross cursor when an infra/zone/facility tool is selected
        if (this.selectedInfraTool || this.selectedZoneTool) {
          const infra = this.selectedInfraTool ? INFRASTRUCTURE[this.selectedInfraTool] : null;
          const zone = this.selectedZoneTool ? ZONES[this.selectedZoneTool] : null;
          const color = infra?.topColor || zone?.color || 0xffffff;
          this.renderer.renderInfraHoverCursor(grid.col, grid.row, color);
        } else if (this.selectedFacilityTool) {
          const comp = COMPONENTS[this.selectedFacilityTool];
          const color = comp ? _categoryColor(comp.category) : 0x88aaff;
          this.renderer.renderEquipmentGhost(grid.col, grid.row, this.selectedFacilityTool, color);
        } else if (this.selectedTool && COMPONENTS[this.selectedTool]?.isDrawnConnection) {
          // Hover preview for beam pipe: snap to sub-tile so it matches where
          // the pipe will actually be drawn on click. Stored on the input
          // handler so the animate loop can keep the preview alive across frames.
          this.hoverPipePoint = this._snapPipePoint(world.x, world.y);
        } else if (this.selectedTool && COMPONENTS[this.selectedTool] && !COMPONENTS[this.selectedTool].isDrawnConnection && COMPONENTS[this.selectedTool].placement !== 'attachment') {
          // Non-drawn beamline module: snap to sub-cell under cursor, allow
          // footprint to cross tile boundaries.
          const compDef = COMPONENTS[this.selectedTool];
          const color = _categoryColor(compDef.category);
          const snap = this._computeModuleSubSnap(world.x, world.y, compDef);
          this.hoverCompSnap = snap;
          this.renderer.renderComponentGhost(
            snap.col, snap.row, this.selectedTool,
            this.placementDir || 0, color,
            snap.subCol, snap.subRow,
          );
        }
        // Sub-grid hover: calculate which sub-cell the cursor is over
        if (this.selectedFurnishingTool && this.renderer.hoverCol !== undefined) {
          const tilePos = gridToIso(this.renderer.hoverCol, this.renderer.hoverRow);
          const offsetX = world.x - tilePos.x;
          const offsetY = world.y - tilePos.y;
          const sub = isoToSubGrid(offsetX, offsetY);
          const furnDef = ZONE_FURNISHINGS[this.selectedFurnishingTool];
          if (furnDef) {
            const gw = this.furnishingRotated ? furnDef.gridH : furnDef.gridW;
            const gh = this.furnishingRotated ? furnDef.gridW : furnDef.gridH;
            this.hoverSubCol = Math.max(0, Math.min(4 - gw, Math.floor(sub.subCol)));
            this.hoverSubRow = Math.max(0, Math.min(4 - gh, Math.floor(sub.subRow)));
          }
          // Render furnishing placement ghost preview
          const key = grid.col + ',' + grid.row;
          if (this.game.state.infraOccupied[key]) {
            this.renderer.renderFurnishingGhost(
              grid.col, grid.row, this.hoverSubCol, this.hoverSubRow,
              this.selectedFurnishingTool, this.furnishingRotated, 0x88ccff
            );
          } else {
            this.renderer._clearPreview();
          }
        }
        // Sub-grid hover for sub-tile decorations
        if (this.selectedDecorationTool && this.renderer.hoverCol !== undefined) {
          const decDef = DECORATIONS[this.selectedDecorationTool];
          if (decDef && decDef.gridW && decDef.gridH) {
            const tilePos = gridToIso(this.renderer.hoverCol, this.renderer.hoverRow);
            const offsetX = world.x - tilePos.x;
            const offsetY = world.y - tilePos.y;
            const sub = isoToSubGrid(offsetX, offsetY);
            const gw = this.furnishingRotated ? decDef.gridH : decDef.gridW;
            const gh = this.furnishingRotated ? decDef.gridW : decDef.gridH;
            this.hoverSubCol = Math.max(0, Math.min(4 - gw, Math.floor(sub.subCol)));
            this.hoverSubRow = Math.max(0, Math.min(4 - gh, Math.floor(sub.subRow)));
            this.renderer._renderSubtilePreview(
              grid.col, grid.row, this.hoverSubCol, this.hoverSubRow,
              decDef.gridW, decDef.gridH, this.furnishingRotated
            );
          }
        }
        // Demolish hover: highlight the object under cursor with red + show tooltip
        if (this.demolishMode && !this.isDragging && !this.isDrawingWall && !this.isDrawingDoor) {
          this._updateDemolishHover(world, grid, e.clientX, e.clientY);
        }
        // Move mode hover: outline objects that can be picked up
        if (this.moveMode && !this._movePayload) {
          this._updateMoveHover(grid, e.clientX, e.clientY);
        } else if (this.moveMode && this._movePayload) {
          // Show placement preview matching normal build previews
          const mp = this._movePayload;
          if (mp.kind === 'component') {
            const comp = COMPONENTS[mp.type];
            const color = comp ? _categoryColor(comp.category) : 0x88aaff;
            this.renderer.renderComponentGhost(grid.col, grid.row, mp.type, mp.direction, color);
          } else if (mp.kind === 'furnishing') {
            const furnDef = ZONE_FURNISHINGS[mp.type];
            if (furnDef) {
              const tilePos = gridToIso(grid.col, grid.row);
              const sub = isoToSubGrid(world.x - tilePos.x, world.y - tilePos.y);
              const gw = mp.rotated ? furnDef.gridH : furnDef.gridW;
              const gh = mp.rotated ? furnDef.gridW : furnDef.gridH;
              mp._hoverSubCol = Math.max(0, Math.min(4 - gw, Math.floor(sub.subCol)));
              mp._hoverSubRow = Math.max(0, Math.min(4 - gh, Math.floor(sub.subRow)));
              const key = grid.col + ',' + grid.row;
              if (this.game.state.infraOccupied[key]) {
                this.renderer.renderFurnishingGhost(
                  grid.col, grid.row, mp._hoverSubCol, mp._hoverSubRow,
                  mp.type, mp.rotated, 0x88ccff
                );
              } else {
                this.renderer._clearPreview();
              }
            }
          } else if (mp.kind === 'facility') {
            const comp = COMPONENTS[mp.type];
            const color = comp ? _categoryColor(comp.category) : 0x88aaff;
            this.renderer.renderEquipmentGhost(grid.col, grid.row, mp.type, color);
          } else {
            this.renderer.renderInfraHoverCursor(grid.col, grid.row, 0x88aaff);
          }
        }
        // Update design placer position
        if (this.game._designPlacer && this.game._designPlacer.active) {
          this.game._designPlacer.setPosition(grid.col, grid.row);
          this.renderer._renderCursors();
        }
        // Hover tooltip for furnishings/equipment (when no tool active)
        if (!this.selectedTool && !this.selectedInfraTool && !this.selectedFacilityTool &&
            !this.selectedFurnishingTool && !this.selectedDecorationTool &&
            !this.selectedWallTool && !this.selectedDoorTool && !this.selectedConnTool &&
            !this.selectedZoneTool && !this.demolishMode && !this.bulldozerMode) {
          this._checkHoverTooltip(world, grid, e.clientX, e.clientY);
        } else if (this._hoverTooltipTarget) {
          this._hideTooltip();
        }
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      console.log('[MOUSEUP]', { button: e.button, isPanning: this.isPanning, isDrawingConn: this.isDrawingConn, isDragging: this.isDragging });
      if (this.isPanning) {
        this.isPanning = false;
        canvas.style.cursor = '';
        return;
      }

      // Beam pipe drawing end
      if (this.drawingBeamPipe) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const endPt = this._snapPipePoint(world.x, world.y);
        this.beamPipePath = this._buildStraightPath(this.beamPipePath[0], endPt);

        if (this.beamPipeDrawMode === 'remove') {
          // Right-click drag: find and remove pipes whose path intersects the drawn path
          const pipesToRemove = new Set();
          const EPS = 0.26; // allow half-tile tolerance for matching
          for (const pipe of this.game.state.beamPipes) {
            for (const pt of this.beamPipePath) {
              if (pipe.path.some(pp => Math.abs(pp.col - pt.col) < EPS && Math.abs(pp.row - pt.row) < EPS)) {
                pipesToRemove.add(pipe.id);
                break;
              }
            }
          }
          if (pipesToRemove.size > 0) {
            this.game._pushUndo();
            for (const id of pipesToRemove) {
              this.game.removeBeamPipe(id);
            }
          }
        } else {
          // Left-click: place the pipe. Auto-link endpoints to modules if
          // the path starts/ends on a module's tile; otherwise create a
          // free-standing pipe.
          // Single-click (no drag): extend to a half-tile segment along placementDir
          if (this.beamPipePath.length === 1) {
            const start = this.beamPipePath[0];
            const delta = DIR_DELTA[this.placementDir || 0];
            this.beamPipePath.push({ col: start.col + delta.dc * 0.5, row: start.row + delta.dr * 0.5 });
          }
          const startTile = this.beamPipePath[0];
          const endTile = this.beamPipePath[this.beamPipePath.length - 1];
          const startComp = this._findBeamlineComponentAt(Math.round(startTile.col), Math.round(startTile.row));
          const endComp = this._findBeamlineComponentAt(Math.round(endTile.col), Math.round(endTile.row));

          let fromId = null, fromPort = null;
          if (startComp && COMPONENTS[startComp.type]?.placement === 'module') {
            fromId = startComp.id;
            fromPort = this._findAvailablePort(fromId, 'exit');
          }
          let toId = null, toPort = null;
          if (endComp && COMPONENTS[endComp.type]?.placement === 'module' && endComp.id !== fromId) {
            toId = endComp.id;
            toPort = this._findAvailablePort(toId, 'entry');
          }

          this.game._pushUndo();
          this.game.createBeamPipe(fromId, fromPort, toId, toPort, this.beamPipePath);
        }

        this.drawingBeamPipe = false;
        this.beamPipeStartId = null;
        this.beamPipePath = [];
        this.beamPipeDrawMode = 'add';
        this.renderer.clearDragPreview();
        return;
      }

      // Connection drawing end — commit all tiles on release
      if (this.isDrawingConn) {
        this.game._pushUndo();
        for (const pt of this.connPath) {
          if (this.connDrawMode === 'add') {
            this.game.placeConnection(pt.col, pt.row, this.selectedConnTool);
          } else {
            this.game.removeConnection(pt.col, pt.row, this.selectedConnTool);
          }
        }
        this.isDrawingConn = false;
        this.connPath = [];
        this.renderer.clearDragPreview();
        return;
      }

      // Line placement end (hallway)
      if (this.isDrawingLine && this.linePath.length > 0) {
        this.game._pushUndo();
        for (const pt of this.linePath) {
          this.game.placeInfraTile(pt.col, pt.row, this.selectedInfraTool, this.selectedInfraVariant);
        }
        this.game.emit('infrastructureChanged');
        this.isDrawingLine = false;
        this.linePath = [];
        this.renderer.clearDragPreview();
        return;
      }

      // Wall demolish end
      if (this.demolishType === 'demolishWall' && this.isDrawingWall && this.wallPath.length > 0) {
        this.game._pushUndo();
        for (const pt of this.wallPath) {
          this.game.removeWall(pt.col, pt.row, pt.edge);
        }
        this.isDrawingWall = false;
        this.wallPath = [];
        this.renderer.clearDragPreview();
        return;
      }

      // Door demolish end
      if (this.demolishType === 'demolishDoor' && this.isDrawingDoor && this.doorPath.length > 0) {
        this.game._pushUndo();
        for (const pt of this.doorPath) {
          this.game.removeDoor(pt.col, pt.row, pt.edge);
        }
        this.isDrawingDoor = false;
        this.doorPath = [];
        this.renderer.clearDragPreview();
        return;
      }

      // Wall placement end
      if (this.isDrawingWall && this.wallPath.length > 0) {
        this.game._pushUndo();
        this.game.placeWallPath(this.wallPath, this.selectedWallTool);
        this.isDrawingWall = false;
        this.wallPath = [];
        this.renderer.clearDragPreview();
        return;
      }

      // Door placement end
      if (this.isDrawingDoor && this.doorPath.length > 0) {
        this.game._pushUndo();
        this.game.placeDoorPath(this.doorPath, this.selectedDoorTool);
        this.isDrawingDoor = false;
        this.doorPath = [];
        this.renderer.clearDragPreview();
        return;
      }

      // Infrastructure, zone, or demolish drag end
      if (this.isDragging && this.dragStart && this.dragEnd) {
        this.game._pushUndo();
        if (this.demolishMode) {
          const minCol = Math.min(this.dragStart.col, this.dragEnd.col);
          const maxCol = Math.max(this.dragStart.col, this.dragEnd.col);
          const minRow = Math.min(this.dragStart.row, this.dragEnd.row);
          const maxRow = Math.max(this.dragStart.row, this.dragEnd.row);

          if (this.demolishType === 'demolishComponent') {
            // Remove beamline components in rect
            for (let c = minCol; c <= maxCol; c++) {
              for (let r = minRow; r <= maxRow; r++) {
                const node = this._getNodeAtGrid(c, r);
                if (node) {
                  if (this.game.editingBeamlineId) {
                    const entry = this.game.registry.getBeamlineForNode(node.id);
                    if (!entry || entry.id !== this.game.editingBeamlineId) continue;
                  }
                  this.game.removeComponent(node.id);
                }
              }
            }
          } else if (this.demolishType === 'demolishConnection') {
            // Remove utility connections in rect
            for (let c = minCol; c <= maxCol; c++) {
              for (let r = minRow; r <= maxRow; r++) {
                const conns = this.game.getConnectionsAt(c, r);
                for (const ct of [...conns]) {
                  this.game.removeConnection(c, r, ct);
                }
              }
            }
          } else if (this.demolishType === 'demolishFurnishing') {
            for (let c = minCol; c <= maxCol; c++) {
              for (let r = minRow; r <= maxRow; r++) {
                const subgrid = this.game.state.zoneFurnishingSubgrids[c + ',' + r];
                if (subgrid) {
                  for (let sr = 0; sr < 4; sr++) {
                    for (let sc = 0; sc < 4; sc++) {
                      const furnIdx = subgrid[sr][sc];
                      if (furnIdx > 0) {
                        const entry = this.game.state.zoneFurnishings[furnIdx - 1];
                        if (entry) this.game.removeZoneFurnishing(entry.id);
                      }
                    }
                  }
                }
              }
            }
          } else if (this.demolishType === 'demolishZone') {
            this.game.removeZoneRect(
              this.dragStart.col, this.dragStart.row,
              this.dragEnd.col, this.dragEnd.row
            );
          } else if (this.demolishType === 'demolishFloor') {
            this.game.removeZoneRect(
              this.dragStart.col, this.dragStart.row,
              this.dragEnd.col, this.dragEnd.row
            );
            this.game.removeInfraRect(
              this.dragStart.col, this.dragStart.row,
              this.dragEnd.col, this.dragEnd.row
            );
          } else if (this.demolishType === 'demolishAll') {
            for (let c = minCol; c <= maxCol; c++) {
              for (let r = minRow; r <= maxRow; r++) {
                this._demolishEverythingAt(c, r);
              }
            }
          }
        } else if (this.selectedZoneTool) {
          this.game.placeZoneRect(
            this.dragStart.col, this.dragStart.row,
            this.dragEnd.col, this.dragEnd.row,
            this.selectedZoneTool
          );
        } else if (this.selectedInfraTool) {
          this.game.placeInfraRect(
            this.dragStart.col, this.dragStart.row,
            this.dragEnd.col, this.dragEnd.row,
            this.selectedInfraTool,
            this.selectedInfraVariant
          );
        }
        this.isDragging = false;
        this.dragStart = null;
        this.dragEnd = null;
        this.renderer.clearDragPreview();
        return;
      }

      if (e.button === 0) {
        // Left click
        this._handleClick(e.clientX, e.clientY);
      } else if (e.button === 2) {
        // Right click
        if (this.selectedTool) {
          // Deselect current tool
          this.deselectTool();
        } else if (this.selectedInfraTool) {
          this.deselectInfraTool();
        } else if (this.selectedFacilityTool) {
          this.deselectFacilityTool();
        } else if (this.selectedFurnishingTool) {
          this.deselectFurnishingTool();
        } else if (this.selectedConnTool) {
          this.deselectConnTool();
        } else if (this.selectedZoneTool) {
          this.deselectZoneTool();
        } else if (this.demolishMode) {
          this.deselectDemolishTool();
          this._hidePreview();
        }
      }
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Double-click: enter edit mode for the clicked beamline and open its window
    canvas.addEventListener('dblclick', (e) => {
      const world = this.renderer.screenToWorld(e.clientX, e.clientY);
      const grid = isoToGrid(world.x, world.y);
      const clickedNode = this._getNodeAtScreenOrGrid(e.clientX, e.clientY, grid.col, grid.row);
      if (clickedNode) {
        const entry = this.game.registry.getBeamlineForNode(clickedNode.id);
        if (entry) {
          this.game.editingBeamlineId = entry.id;
          this.game.selectedBeamlineId = entry.id;
          this.renderer._openBeamlineWindow(entry.id);
          this.game.emit('editModeChanged', entry.id);
        }
      }
    });
  }

  // --- Click handling ---

  _handleClick(screenX, screenY) {
    const world = this.renderer.screenToWorld(screenX, screenY);
    const grid = isoToGrid(world.x, world.y);
    const col = grid.col;
    const row = grid.row;

    // Recompute sub-tile snap fresh from the click position so the build
    // agrees with the hover preview even if the cursor crossed a tile edge
    // between the last mousemove and the click.
    if (this.selectedTool && COMPONENTS[this.selectedTool] && !COMPONENTS[this.selectedTool].isDrawnConnection && COMPONENTS[this.selectedTool].placement !== 'attachment') {
      this.hoverCompSnap = this._computeModuleSubSnap(world.x, world.y, COMPONENTS[this.selectedTool]);
    }

    console.log('[CLICK]', { col, row, selectedTool: this.selectedTool, selectedInfraTool: this.selectedInfraTool, selectedFacilityTool: this.selectedFacilityTool, selectedConnTool: this.selectedConnTool, bulldozer: this.bulldozerMode, nodes: this.game.registry.getAllNodes().length });

    // DesignPlacer confirmation
    if (this.game._designPlacer && this.game._designPlacer.active) {
      if (this.game._designPlacer.valid) {
        this.game._designPlacer.confirm();
      } else {
        this.game.log('Invalid placement!', 'bad');
      }
      return;
    }

    // Move mode handling
    if (this.moveMode) {
      this._handleMoveClick(col, row, screenX, screenY);
      return;
    }

    if (this.bulldozerMode) {
      this.game._pushUndo();
      if (this.bulldozerConnType) {
        // Pipe-specific bulldozer: only remove the selected connection type
        this.game.removeConnection(col, row, this.bulldozerConnType);
      } else {
        // General bulldozer: remove furniture and components only
        // (does not affect zones, floors/walls, or pipes)
        const key = col + ',' + row;
        const node = this._getNodeAtGrid(col, row);
        if (node) {
          if (this.game.editingBeamlineId) {
            const entry = this.game.registry.getBeamlineForNode(node.id);
            if (entry && entry.id === this.game.editingBeamlineId) {
              this.game.removeComponent(node.id);
            }
          } else {
            this.game.removeComponent(node.id);
          }
        }
        // Remove decorations
        this.game.removeDecoration(col, row);
        // Remove zone furnishings
        const subgrid = this.game.state.zoneFurnishingSubgrids[key];
        if (subgrid) {
          const tilePos = gridToIso(col, row);
          const offsetX = world.x - tilePos.x;
          const offsetY = world.y - tilePos.y;
          const sub = isoToSubGrid(offsetX, offsetY);
          const sc = Math.floor(sub.subCol);
          const sr = Math.floor(sub.subRow);
          if (sc >= 0 && sc < 4 && sr >= 0 && sr < 4) {
            const furnIdx = subgrid[sr][sc];
            if (furnIdx > 0) {
              const entry = this.game.state.zoneFurnishings[furnIdx - 1];
              if (entry) this.game.removeZoneFurnishing(entry.id);
            }
          }
        }
        // Remove facility equipment
        const equipId = this.game.state.facilityGrid[key];
        if (equipId) {
          this.game.removeFacilityEquipment(equipId);
        }
        // Remove machines
        const machineId = this.game.state.machineGrid[key];
        if (machineId) {
          this.game.removeMachine(machineId);
        }
      }
      return;
    }

    if (this.selectedInfraTool) {
      // Infrastructure placement (single tile for non-drag items like path)
      const infra = INFRASTRUCTURE[this.selectedInfraTool];
      if (infra && !infra.isDragPlacement && !infra.isLinePlacement) {
        this.game._pushUndo();
        if (this.game.placeInfraTile(col, row, this.selectedInfraTool, this.selectedInfraVariant)) {
          this.game.emit('infrastructureChanged');
        }
      }
      return;
    }

    // Zone placement (single tile click)
    if (this.selectedZoneTool) {
      this.game._pushUndo();
      if (this.game.placeZoneTile(col, row, this.selectedZoneTool)) {
        this.game.emit('zonesChanged');
      }
      return;
    }

    if (this.demolishMode) {
      this.game._pushUndo();
      const key = col + ',' + row;
      if (this.demolishType === 'demolishComponent') {
        // Raycast to find the component or beam pipe under the cursor
        const hit = this.renderer.raycastScreen(screenX, screenY);
        let node = null;
        if (hit) {
          const info = this.renderer.identifyHit(hit);
          // Beam pipe hit
          if (info && info.group === 'beampipe' && info.pipeId) {
            this.game.removeBeamPipe(info.pipeId);
            return;
          }
          if (info && info.group === 'component' && info.nodeId) {
            const nodes = this.game.registry.getAllNodes();
            node = nodes.find(n => n.id === info.nodeId);
          }
        }
        // Fallback to tile-based lookup
        if (!node) node = this._getNodeAtGrid(col, row);
        if (node) {
          if (this.game.editingBeamlineId) {
            const entry = this.game.registry.getBeamlineForNode(node.id);
            if (entry && entry.id === this.game.editingBeamlineId) {
              this.game.removeComponent(node.id);
            }
          } else {
            this.game.removeComponent(node.id);
          }
        }
      } else if (this.demolishType === 'demolishConnection') {
        // Remove all connection types at this tile
        const conns = this.game.getConnectionsAt(col, row);
        for (const ct of [...conns]) {
          this.game.removeConnection(col, row, ct);
        }
      } else if (this.demolishType === 'demolishFurnishing') {
        // Click-on-object: check furnishings first, then facility equipment
        let removed = false;
        const subgrid = this.game.state.zoneFurnishingSubgrids[key];
        if (subgrid) {
          const tilePos = gridToIso(col, row);
          const offsetX = world.x - tilePos.x;
          const offsetY = world.y - tilePos.y;
          const sub = isoToSubGrid(offsetX, offsetY);
          const sc = Math.floor(sub.subCol);
          const sr = Math.floor(sub.subRow);
          if (sc >= 0 && sc < 4 && sr >= 0 && sr < 4) {
            const furnIdx = subgrid[sr][sc];
            if (furnIdx > 0) {
              const entry = this.game.state.zoneFurnishings[furnIdx - 1];
              if (entry) {
                this.game.removeZoneFurnishing(entry.id);
                removed = true;
              }
            }
          }
        }
        // Also check facility equipment on this tile
        if (!removed) {
          const equipId = this.game.state.facilityGrid[key];
          if (equipId) this.game.removeFacilityEquipment(equipId);
        }
      } else if (this.demolishType === 'demolishZone') {
        if (this.game.state.zoneOccupied[key]) {
          this.game.removeZoneTile(col, row);
        }
      } else if (this.demolishType === 'demolishFloor') {
        if (this.game.state.zoneOccupied[key]) {
          this.game.removeZoneTile(col, row);
        }
        if (this.game.state.infraOccupied[key]) {
          this.game.removeInfraTile(col, row);
        }
      } else if (this.demolishType === 'demolishAll') {
        this._demolishEverythingAt(col, row);
      } else if (this.demolishType === 'demolishWall') {
        const edge = this._getNearestEdge(screenX, screenY);
        this.game.removeWall(edge.col, edge.row, edge.edge);
      } else if (this.demolishType === 'demolishDoor') {
        const edge = this._getNearestEdge(screenX, screenY);
        this.game.removeDoor(edge.col, edge.row, edge.edge);
      }
      return;
    }

    // Decoration placement
    if (this.selectedDecorationTool) {
      this.game._pushUndo();
      const decDef = DECORATIONS[this.selectedDecorationTool];
      if (decDef && decDef.gridW && decDef.gridH) {
        // Sub-tile decoration
        if (this.game.placeDecoration(col, row, this.selectedDecorationTool, this.hoverSubCol, this.hoverSubRow, this.furnishingRotated)) {
          this.game.emit('decorationsChanged');
        }
      } else {
        // Full-tile decoration
        if (this.game.placeDecoration(col, row, this.selectedDecorationTool)) {
          this.game.emit('decorationsChanged');
        }
      }
      return;
    }

    // Zone furnishing placement
    if (this.selectedFurnishingTool) {
      this.game._pushUndo();
      this.game.placeZoneFurnishing(col, row, this.selectedFurnishingTool, this.hoverSubCol, this.hoverSubRow, this.furnishingRotated);
      return;
    }

    // Facility equipment placement
    if (this.selectedFacilityTool) {
      this.game._pushUndo();
      this.game.placeFacilityEquipment(col, row, this.selectedFacilityTool);
      return;
    }

    if (this.selectedTool) {
      const comp = COMPONENTS[this.selectedTool];
      if (comp && !comp.isDrawnConnection) {
        this.game._pushUndo();
        if (comp.placement === 'attachment') {
          // Attachment: snap to the nearest pipe
          const pipe = this._findNearestPipe(col, row);
          if (pipe) {
            const position = this._getPipePosition(pipe, col, row);
            this.game.addAttachmentToPipe(pipe.id, this.selectedTool, position, this.selectedParamOverrides);
          } else {
            this.game.log('Must place on a beam pipe!', 'bad');
          }
        } else if (comp.isSource) {
          const snap = this.hoverCompSnap || { col, row, subCol: 0, subRow: 0 };
          const entryId = this.game.placePlaceable({
            type: this.selectedTool,
            category: 'beamline',
            col: snap.col,
            row: snap.row,
            subCol: snap.subCol,
            subRow: snap.subRow,
            rotated: false,
            dir: this.placementDir,
            params: this.selectedParamOverrides,
          });
          if (entryId) {
            // Auto-switch to beam pipe tool after placing source
            this.selectTool('drift');
          }
        } else {
          // Check if clicking an existing component (to open its window)
          const existingNode = this._getNodeAtScreenOrGrid(screenX, screenY, col, row);
          if (existingNode) {
            this.selectedNodeId = existingNode.id;
            const entry = this.game.registry.getBeamlineForNode(existingNode.id);
            if (entry) {
              this.game.selectedBeamlineId = entry.id;
              this.renderer._openBeamlineWindow(entry.id);
              this.game.emit('beamlineSelected', entry.id);
            }
          } else {
            const snap = this.hoverCompSnap || { col, row, subCol: 0, subRow: 0 };
            this.game.placePlaceable({
              type: this.selectedTool,
              category: 'beamline',
              col: snap.col,
              row: snap.row,
              subCol: snap.subCol,
              subRow: snap.subRow,
              rotated: false,
              dir: this.placementDir,
              params: this.selectedParamOverrides,
            });
          }
        }
      }
    } else if (this.probeMode) {
      // Probe placement mode — click nodes to add probes
      const node = this._getNodeAtGrid(col, row);
      if (node && this.renderer.onProbeClick) {
        this.renderer.onProbeClick(node);
      }
      return;
    } else {
      // Selection mode
      const node = this._getNodeAtScreenOrGrid(screenX, screenY, col, row);
      if (node) {
        this.selectedNodeId = node.id;
        // Select the beamline this node belongs to and open its context window
        const entry = this.game.registry.getBeamlineForNode(node.id);
        if (entry) {
          this.game.selectedBeamlineId = entry.id;
          this.renderer._openBeamlineWindow(entry.id);
          this.game.emit('beamlineSelected', entry.id);
        }
      } else {
        // Check for connection tile click (network info)
        const connKey = col + ',' + row;
        const connTypes = this.game.state.connections.get(connKey);
        if (connTypes && connTypes.size > 0) {
          const networkData = this.game.state.networkData || {};
          for (const connType of connTypes) {
            const clusters = networkData[connType] || [];
            for (let ci = 0; ci < clusters.length; ci++) {
              const inCluster = clusters[ci].tiles.some(t => t.col === col && t.row === row);
              if (inCluster) {
                new NetworkWindow(this.game, connType, ci);
                return;
              }
            }
          }
        }
        // Check for machine tile click
        const machineId = this.game.state.machineGrid[col + ',' + row];
        if (machineId) {
          this.renderer._openMachineWindow(machineId);
          return;
        }
        // Check for facility equipment click
        const facKey = col + ',' + row;
        const facId = this.game.state.facilityGrid[facKey];
        if (facId) {
          const equip = this.game.state.facilityEquipment.find(e => e.id === facId);
          if (equip) {
            const comp = COMPONENTS[equip.type];
            if (comp) {
              this.renderer.showNetworkOverlay(facId);
              this.renderer._openEquipmentWindow(equip);
              return;
            }
          }
        }
        // Clicked empty space — exit edit mode if active
        if (this.game.editingBeamlineId) {
          this.game.editingBeamlineId = null;
          this.game.emit('editModeChanged', null);
        }
        this.selectedNodeId = null;
        this.renderer.hidePopup();
        this.renderer.clearNetworkOverlay();
      }
    }
  }

  // --- Tool selection ---

  selectTool(compType, paramOverrides) {
    this.selectedInfraTool = null;
    this.selectedFacilityTool = null;
    this.selectedFurnishingTool = null;
    this.furnishingRotated = false;
    this.selectedDecorationTool = null;
    this.bulldozerMode = false;
    this.selectedTool = compType;
    this.selectedParamOverrides = paramOverrides || null;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
    this.renderer.setBuildMode(true, compType);
  }

  // Select tool without auto-placing (for keyboard navigation preview)
  _selectToolPreview(compType) {
    this.selectedInfraTool = null;
    this.selectedFacilityTool = null;
    this.selectedFurnishingTool = null;
    this.furnishingRotated = false;
    this.selectedDecorationTool = null;
    this.selectedTool = compType;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
    this.renderer.setBuildMode(true, compType);
  }

  _selectFacilityToolPreview(compType) {
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFurnishingTool();
    this.deselectDecorationTool();
    this.deselectConnTool();
    this.selectedFacilityTool = compType;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
  }

  _selectInfraToolPreview(infraType) {
    this.selectedTool = null;
    this.selectedFacilityTool = null;
    this.selectedFurnishingTool = null;
    this.furnishingRotated = false;
    this.selectedDecorationTool = null;
    this.renderer.setBuildMode(false);
    this.selectedInfraTool = infraType;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
  }

  deselectTool() {
    this.selectedTool = null;
    this.renderer.setBuildMode(false);
  }

  selectInfraTool(infraType, variant = 0) {
    this.selectedTool = null;
    this.selectedFurnishingTool = null;
    this.furnishingRotated = false;
    this.selectedDecorationTool = null;
    this.demolishMode = false;
    this.renderer.setBuildMode(false);
    this.renderer.clearDragPreview();
    this.selectedInfraTool = infraType;
    this.selectedInfraVariant = variant;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
  }

  deselectInfraTool() {
    this.selectedInfraTool = null;
    this.isDragging = false;
    this.dragStart = null;
    this.dragEnd = null;
    this.isDrawingLine = false;
    this.linePath = [];
    this.selectedWallTool = null;
    this.isDrawingWall = false;
    this.wallPath = [];
    this._wallStart = null;
    this.selectedDoorTool = null;
    this.isDrawingDoor = false;
    this.doorPath = [];
    this._doorStart = null;
    this.renderer.clearDragPreview();
  }

  selectFacilityTool(compType) {
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFurnishingTool();
    this.deselectDecorationTool();
    this.deselectConnTool();
    this.selectedFacilityTool = compType;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
  }

  deselectFacilityTool() {
    this.selectedFacilityTool = null;
  }

  selectConnTool(connType) {
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectFurnishingTool();
    this.bulldozerMode = false;
    this.renderer.setBulldozerMode(false);
    this.selectedConnTool = connType;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
  }

  deselectConnTool() {
    this.selectedConnTool = null;
    this.isDrawingConn = false;
    this.connPath = [];
  }

  selectZoneTool(zoneType) {
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectFurnishingTool();
    this.deselectDecorationTool();
    this.deselectConnTool();
    this.demolishMode = false;
    this.selectedZoneTool = zoneType;
  }

  deselectZoneTool() {
    this.selectedZoneTool = null;
    this.renderer.clearDragPreview();
  }

  selectFurnishingTool(furnType) {
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectDecorationTool();
    this.deselectConnTool();
    this.deselectZoneTool();
    this.demolishMode = false;
    this.selectedFurnishingTool = furnType;
  }

  deselectFurnishingTool() {
    this.selectedFurnishingTool = null;
    this.furnishingRotated = false;
  }

  selectDecorationTool(decType) {
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectFurnishingTool();
    this.deselectConnTool();
    this.deselectZoneTool();
    this.demolishMode = false;
    this.selectedDecorationTool = decType;
  }

  deselectDecorationTool() {
    this.selectedDecorationTool = null;
  }

  selectWallTool(wallType) {
    this.deselectInfraTool();
    this.selectedDoorTool = null;
    this.selectedWallTool = wallType;
  }

  selectDoorTool(doorType) {
    this.deselectInfraTool();
    this.selectedWallTool = null;
    this.selectedDoorTool = doorType;
  }

  selectDemolishTool(demolishType) {
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectFurnishingTool();
    this.deselectDecorationTool();
    this.deselectConnTool();
    this.deselectZoneTool();
    this.demolishMode = true;
    this.demolishType = demolishType || 'demolishFloor';
    this.renderer.canvas.style.cursor = 'crosshair';
  }

  deselectDemolishTool() {
    this.demolishMode = false;
    this.demolishType = null;
    this.renderer.clearDragPreview();
    this._hideDemolishTooltip();
    this.renderer.canvas.style.cursor = '';
  }

  _demolishEverythingAt(col, row) {
    const key = col + ',' + row;
    // Remove beamline components
    const node = this._getNodeAtGrid(col, row);
    if (node) this.game.removeComponent(node.id);
    // Remove utility connections
    const conns = this.game.getConnectionsAt(col, row);
    for (const ct of [...conns]) this.game.removeConnection(col, row, ct);
    // Remove furnishings
    const subgrid = this.game.state.zoneFurnishingSubgrids[key];
    if (subgrid) {
      for (let sr = 0; sr < 4; sr++) {
        for (let sc = 0; sc < 4; sc++) {
          const furnIdx = subgrid[sr][sc];
          if (furnIdx > 0) {
            const entry = this.game.state.zoneFurnishings[furnIdx - 1];
            if (entry) this.game.removeZoneFurnishing(entry.id);
          }
        }
      }
    }
    // Remove decorations
    this.game.removeDecoration(col, row);
    // Remove zones
    if (this.game.state.zoneOccupied[key]) this.game.removeZoneTile(col, row);
    // Remove walls and doors on both edges of this tile
    this.game.removeWall(col, row, 'e');
    this.game.removeWall(col, row, 's');
    this.game.removeDoor(col, row, 'e');
    this.game.removeDoor(col, row, 's');
    // Remove floor last
    if (this.game.state.infraOccupied[key]) this.game.removeInfraTile(col, row);
  }

  _contextDemolishType() {
    const mode = this.activeMode;
    const cat = this.selectedCategory;
    const catDef = MODES[mode]?.categories?.[cat];
    if (mode === 'beamline') return 'demolishComponent';
    if (mode === 'infra') return 'demolishConnection';
    if (mode === 'facility') return 'demolishFurnishing';
    if (mode === 'structure') {
      if (cat === 'flooring') return 'demolishFloor';
      if (cat === 'walls') return 'demolishWall';
      if (cat === 'doors') return 'demolishDoor';
    }
    if (mode === 'grounds') {
      if (cat === 'surfaces') return 'demolishFloor';
      if (catDef?.isWallTab) return 'demolishWall';
      if (catDef?.isDecorationTab) return 'demolishFurnishing';
    }
    return null;
  }

  // --- Move mode ---

  _toggleMoveMode() {
    if (this.moveMode) {
      this._exitMoveMode();
      return;
    }
    // Enter move mode — clear all other tools
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectFurnishingTool();
    this.deselectConnTool();
    this.deselectZoneTool();
    this.deselectDemolishTool();
    this.bulldozerMode = false;
    this.renderer.setBulldozerMode(false);
    this.probeMode = false;
    this.renderer.setProbeMode(false);
    this.moveMode = true;
    this._movePayload = null;
    this.renderer.canvas.style.cursor = 'grab';
    this._showToast('Move mode (click to pick up, ESC to exit)');
  }

  _exitMoveMode() {
    // If carrying an object, put it back where it came from
    // Components haven't been removed from the beamline, so nothing to restore
    if (this._movePayload && this._movePayload.kind !== 'component') {
      this._placeMovedObject(this._movePayload.originCol, this._movePayload.originRow);
    }
    this.moveMode = false;
    this._movePayload = null;
    this.renderer.canvas.style.cursor = '';
    this.renderer._clearPreview();
    this._showToast('Move mode off');
  }

  _handleMoveClick(col, row, screenX, screenY) {
    const key = col + ',' + row;
    if (this._movePayload) {
      // We're carrying something — try to place it
      if (this._placeMovedObject(col, row)) {
        this._movePayload = null;
        this.renderer._clearPreview();
        this.renderer.canvas.style.cursor = 'grab';
        // Immediately try to pick up whatever is at the destination
        // (allows chaining: place then pick up the next thing)
      } else {
        // Placement failed — try picking up something else at this tile instead
        const picked = this._pickUpAt(col, row, screenX, screenY);
        if (picked) {
          // Put the old one back first (not needed for components — they're still in place)
          if (this._movePayload.kind !== 'component') {
            this._placeMovedObject(this._movePayload.originCol, this._movePayload.originRow);
          }
          this._movePayload = picked;
          this.renderer.canvas.style.cursor = 'grabbing';
        }
      }
      return;
    }

    // Not carrying anything — try to pick something up
    const picked = this._pickUpAt(col, row, screenX, screenY);
    if (picked) {
      this._movePayload = picked;
      this.renderer.canvas.style.cursor = 'grabbing';
    }
  }

  _pickUpAt(col, row, screenX, screenY) {
    const key = col + ',' + row;

    // Beamline component (not removed on pickup — moved on placement)
    const node = this._getNodeAtGrid(col, row);
    if (node) {
      const comp = COMPONENTS[node.type];
      this._showToast(`Moving ${comp ? comp.name : node.type}`);
      return { kind: 'component', nodeId: node.id, type: node.type, direction: node.dir, originCol: node.col, originRow: node.row };
    }

    // Facility equipment
    const equipId = this.game.state.facilityGrid[key];
    if (equipId) {
      const equip = this.game.state.facilityEquipment.find(e => e.id === equipId);
      if (equip) {
        const comp = COMPONENTS[equip.type];
        this.game._pushUndo();
        // Remove without refund — we'll re-place it
        delete this.game.state.facilityGrid[key];
        const idx = this.game.state.facilityEquipment.findIndex(e => e.id === equipId);
        if (idx !== -1) this.game.state.facilityEquipment.splice(idx, 1);
        this.game.computeSystemStats();
        this.game.emit('facilityChanged');
        this._showToast(`Moving ${comp ? comp.name : equip.type}`);
        return { kind: 'facility', type: equip.type, originCol: col, originRow: row };
      }
    }

    // Zone furnishing
    const subgrid = this.game.state.zoneFurnishingSubgrids[key];
    if (subgrid) {
      const tilePos = gridToIso(col, row);
      const world = this.renderer.screenToWorld(screenX, screenY);
      const sub = isoToSubGrid(world.x - tilePos.x, world.y - tilePos.y);
      const sc = Math.floor(sub.subCol);
      const sr = Math.floor(sub.subRow);
      if (sc >= 0 && sc < 4 && sr >= 0 && sr < 4) {
        const furnIdx = subgrid[sr][sc];
        if (furnIdx > 0) {
          const entry = this.game.state.zoneFurnishings[furnIdx - 1];
          if (entry) {
            const def = ZONE_FURNISHINGS[entry.type];
            this.game._pushUndo();
            this.game.removeZoneFurnishing(entry.id);
            this._showToast(`Moving ${def ? def.name : entry.type}`);
            return {
              kind: 'furnishing', type: entry.type,
              originCol: col, originRow: row,
              subCol: entry.subCol || 0, subRow: entry.subRow || 0,
              rotated: entry.rotated || false,
            };
          }
        }
      }
    }

    // Machine
    const machineId = this.game.state.machineGrid[key];
    if (machineId) {
      // Machines are complex — skip for now
    }

    return null;
  }

  _updateMoveHover(grid, screenX, screenY) {
    // Only highlight when raycast actually hits a moveable object (like demolish mode)
    const hit = this.renderer.raycastScreen(screenX, screenY);
    if (hit) {
      const info = this.renderer.identifyHit(hit);
      if (info && info.group === 'component') {
        // Beamline component
        const comp = info.nodeId ? COMPONENTS[this.game.registry.getAllNodes().find(n => n.id === info.nodeId)?.type] : null;
        const color = comp ? _categoryColor(comp.category) : 0x88aaff;
        this.renderer._clearPreview();
        this.renderer._outlineObject(info.rootObj, color);
        return;
      }
      if (info && info.group === 'equipment') {
        // Derive tile from 3D position to find the equipment entry
        const p = info.rootObj.position;
        const hitCol = Math.floor(p.x / 2);
        const hitRow = Math.floor(p.z / 2);
        const hitKey = hitCol + ',' + hitRow;
        const equipId = this.game.state.facilityGrid[hitKey];
        if (equipId) {
          const equip = this.game.state.facilityEquipment.find(e => e.id === equipId);
          const comp = equip ? COMPONENTS[equip.type] : null;
          const color = comp ? _categoryColor(comp.category) : 0x88aaff;
          this.renderer._clearPreview();
          this.renderer._outlineObject(info.rootObj, color);
          return;
        }
        // Furnishing hit
        const subgrid = this.game.state.zoneFurnishingSubgrids[hitKey];
        if (subgrid) {
          this.renderer._clearPreview();
          this.renderer._outlineObject(info.rootObj, 0x88ccff);
          return;
        }
      }
    }
    this.renderer._clearPreview();
  }

  _placeMovedObject(col, row) {
    const p = this._movePayload;
    if (!p) return false;

    if (p.kind === 'component') {
      this.game._pushUndo();
      return this.game.moveComponent(p.nodeId, col, row, p.direction);
    }

    if (p.kind === 'facility') {
      const key = col + ',' + row;
      const comp = COMPONENTS[p.type];
      // Check placement validity (same checks as placeFacilityEquipment but without cost)
      const floor = this.game.state.infraOccupied[key];
      if (floor !== 'concrete') {
        this.game.log('Need concrete flooring!', 'bad');
        return false;
      }
      if (this.game.state.facilityGrid[key]) {
        this.game.log('Tile occupied!', 'bad');
        return false;
      }
      if (this.game.registry.isTileOccupied(col, row)) {
        this.game.log('Tile occupied by beamline!', 'bad');
        return false;
      }
      if (this.game.state.machineGrid[key]) {
        this.game.log('Tile occupied!', 'bad');
        return false;
      }
      // Place without cost
      const id = 'fac_' + this.game.state.facilityNextId++;
      const entry = { id, type: p.type, col, row };
      this.game.state.facilityEquipment.push(entry);
      this.game.state.facilityGrid[key] = id;
      this.game.log(`Placed ${comp ? comp.name : p.type}`, 'good');
      this.game.computeSystemStats();
      this.game.emit('facilityChanged');
      this.game.validateInfrastructure();
      return true;
    }

    if (p.kind === 'furnishing') {
      // Use live hover sub-coords if available, otherwise fall back to original
      const sc = p._hoverSubCol != null ? p._hoverSubCol : p.subCol;
      const sr = p._hoverSubRow != null ? p._hoverSubRow : p.subRow;
      const placed = this.game.placeZoneFurnishing(col, row, p.type, sc, sr, p.rotated);
      return placed !== false;
    }

    return false;
  }

  _showToast(msg) {
    let el = document.getElementById('key-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'key-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 1200);
  }

  _toggleContextDemolish() {
    // If already in demolish mode, toggle it off
    if (this.demolishMode) {
      this.deselectDemolishTool();
      this._hidePreview();
      return;
    }
    // Determine the right demolish type for current context
    const demolishType = this._contextDemolishType();
    if (!demolishType) {
      // No context (e.g. already on demolish tab) — fall through to full demolish menu
      this._switchToDemolishMode();
      return;
    }
    // Activate demolish in-place without changing mode/menu
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectFurnishingTool();
    this.deselectDecorationTool();
    this.deselectConnTool();
    this.deselectZoneTool();
    this.bulldozerMode = false;
    this.renderer.setBulldozerMode(false);
    this.selectDemolishTool(demolishType);
    const names = { demolishFloor: 'Remove Floor', demolishZone: 'Remove Zone', demolishFurnishing: 'Remove Furniture', demolishWall: 'Remove Walls', demolishDoor: 'Remove Doors', demolishComponent: 'Delete Beamline', demolishConnection: 'Remove Connection', demolishAll: 'Clear Everything' };
    this._renderPreview(names[demolishType] || 'Demolish', 'Press Delete or Esc to exit', []);
  }

  _switchToDemolishMode() {
    // Save current mode/category so Esc can restore it
    if (!this.demolishMode && this.activeMode !== 'demolish') {
      this._prevMode = this.activeMode;
      this._prevCategory = this.selectedCategory;
    }
    // Switch to demolish mode
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectFurnishingTool();
    this.deselectDecorationTool();
    this.deselectConnTool();
    this.deselectZoneTool();
    this.bulldozerMode = false;
    this.renderer.setBulldozerMode(false);
    this.activeMode = 'demolish';
    this.renderer.activeMode = 'demolish';
    this.selectedCategory = 'demolish';
    // Update mode button UI
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === 'demolish');
    });
    this.renderer._generateCategoryTabs();
    this.renderer.updatePalette('demolish');
    this.paletteIndex = -1;
    this._hidePreview();
  }

  _restorePreviousMode() {
    this.deselectDemolishTool();
    this.bulldozerMode = false;
    this.renderer.setBulldozerMode(false);
    const mode = this._prevMode || 'beamline';
    const category = this._prevCategory || Object.keys(MODES[mode]?.categories || {})[0] || '';
    this.activeMode = mode;
    this.renderer.activeMode = mode;
    this.selectedCategory = category;
    // Update mode button UI
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    this.renderer._generateCategoryTabs();
    this.renderer.updatePalette(category);
    // Activate the right tab
    document.querySelectorAll('.cat-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.category === category);
    });
    this.paletteIndex = -1;
    this._hidePreview();
    this._prevMode = null;
    this._prevCategory = null;
  }

  setActiveMode(mode) {
    this.activeMode = mode;
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectFurnishingTool();
    this.deselectDecorationTool();
    this.deselectConnTool();
    this.deselectZoneTool();
    this.deselectDemolishTool();
    this.paletteIndex = -1;
    this._hidePreview();
    // Reset selected category to first in new mode
    const modeData = MODES[mode];
    if (modeData && !modeData.disabled) {
      const catKeys = Object.keys(modeData.categories);
      this.selectedCategory = catKeys[0] || '';
    }
    this.renderer.activeMode = mode;
  }

  // --- Palette click sync ---

  _syncPaletteClick(idx) {
    this.paletteIndex = idx;
    // Update kb-focus visual
    const items = document.querySelectorAll('#component-palette .palette-item');
    items.forEach(el => el.classList.remove('kb-focus'));
    if (idx >= 0 && idx < items.length) {
      items[idx].classList.add('kb-focus');
    }
    this._showPreviewForIndex();
  }

  // --- Palette keyboard navigation ---

  _handlePaletteNav(key) {
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      this._handleVerticalNav(key === 'ArrowUp' ? -1 : 1);
      return;
    }

    const items = document.querySelectorAll('#component-palette .palette-item');
    if (items.length === 0) return;

    if (key === 'ArrowRight') {
      this.paletteIndex = Math.min(this.paletteIndex + 1, items.length - 1);
    } else if (key === 'ArrowLeft') {
      this.paletteIndex = Math.max(this.paletteIndex - 1, 0);
    }

    this._applyPaletteFocus(items);
  }

  _handleVerticalNav(dir) {
    // Build a flat list: all modes and their category tabs
    const modeKeys = Object.keys(MODES).filter(k => !MODES[k].disabled);
    const allEntries = []; // { mode, category }
    for (const mk of modeKeys) {
      const catKeys = Object.keys(MODES[mk].categories);
      for (const ck of catKeys) {
        allEntries.push({ mode: mk, category: ck });
      }
    }
    if (allEntries.length === 0) return;

    // Find current position
    let curIdx = allEntries.findIndex(
      e => e.mode === this.activeMode && e.category === this.selectedCategory
    );
    if (curIdx < 0) curIdx = 0;

    const nextIdx = (curIdx + dir + allEntries.length) % allEntries.length;
    const next = allEntries[nextIdx];

    // Switch mode if needed
    if (next.mode !== this.activeMode) {
      this.activeMode = next.mode;
      this.deselectTool();
      this.deselectInfraTool();
      this.deselectFacilityTool();
      this.deselectFurnishingTool();
      this.deselectConnTool();
      this.deselectZoneTool();
      this.deselectDemolishTool();
      this.renderer.activeMode = next.mode;
      // Update mode buttons
      document.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === next.mode);
      });
      this.renderer._generateCategoryTabs();
    }

    // Switch category tab
    this.selectedCategory = next.category;
    const tabs = document.querySelectorAll('.cat-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.category === next.category));
    this.renderer.updatePalette(next.category);

    // Keep palette index position, clamped to new tab's item count
    const newItems = document.querySelectorAll('#component-palette .palette-item');
    if (this.paletteIndex < 0) this.paletteIndex = 0;
    if (newItems.length > 0 && this.paletteIndex >= newItems.length) {
      this.paletteIndex = newItems.length - 1;
    }
    this._applyPaletteFocus(newItems);
  }

  _applyPaletteFocus(items) {
    if (!items || items.length === 0) return;
    if (this.paletteIndex < 0) this.paletteIndex = 0;
    if (this.paletteIndex >= items.length) this.paletteIndex = items.length - 1;

    // Update visual focus
    items.forEach(el => el.classList.remove('kb-focus'));
    const focused = items[this.paletteIndex];
    focused.classList.add('kb-focus');

    // Scroll into view
    focused.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });

    // Select the component as the active tool (without auto-placing)
    const compKeys = this._getPaletteCompKeys();
    if (this.paletteIndex < compKeys.length) {
      const compKey = compKeys[this.paletteIndex];
      const catDef = MODES.facility?.categories?.[this.selectedCategory];
      if (catDef?.isZoneTab) {
        // First item is zone paint tool, rest are furnishings
        if (this.paletteIndex === 0) {
          this.selectZoneTool(compKey);
        } else {
          this.selectFurnishingTool(compKey);
        }
      } else if (this.selectedCategory === 'demolish') {
        this.selectDemolishTool(compKey);
      } else if (this.selectedCategory === 'walls') {
        this.selectWallTool(compKey);
      } else if (this.selectedCategory === 'doors') {
        this.selectDoorTool(compKey);
      } else if (this.selectedCategory === 'flooring' || this.selectedCategory === 'infrastructure') {
        this._selectInfraToolPreview(compKey);
      } else if (isFacilityCategory(this.selectedCategory)) {
        this._selectFacilityToolPreview(compKey);
      } else {
        this._selectToolPreview(compKey);
      }
    }

    // Show preview panel
    this._showPreviewForIndex();
  }

  _showPreviewForIndex() {
    // Gather the component keys in the current palette
    const compKeys = this._getPaletteCompKeys();
    if (this.paletteIndex < 0 || this.paletteIndex >= compKeys.length) {
      this._hidePreview();
      return;
    }

    const key = compKeys[this.paletteIndex];

    // Could be infrastructure, flooring, or component
    if (this.selectedCategory === 'walls') {
      const wt = WALL_TYPES[key];
      if (!wt) { this._hidePreview(); return; }
      this._renderPreview(wt.name, wt.desc || '', [
        ['Cost', `$${wt.cost}/segment`],
        ['Placement', 'Drag along edges'],
      ]);
      return;
    }

    if (this.selectedCategory === 'doors') {
      const dt = DOOR_TYPES[key];
      if (!dt) { this._hidePreview(); return; }
      this._renderPreview(dt.name, dt.desc || '', [
        ['Cost', `$${dt.cost}/segment`],
        ['Placement', 'Drag along edges'],
      ]);
      return;
    }

    if (this.selectedCategory === 'flooring' || this.selectedCategory === 'infrastructure') {
      const infra = INFRASTRUCTURE[key];
      if (!infra) { this._hidePreview(); return; }
      this._renderPreview(infra.name, infra.desc || '', [
        ['Cost', `$${infra.cost}/tile`],
        ['Placement', infra.isDragPlacement ? 'Drag area' : infra.isLinePlacement ? 'Draw line' : 'Click'],
      ]);
      return;
    }

    // Zone tab items
    const zoneCatDef = MODES.facility?.categories?.[this.selectedCategory];
    if (zoneCatDef?.isZoneTab) {
      if (this.paletteIndex === 0) {
        const zone = ZONES[key];
        if (!zone) { this._hidePreview(); return; }
        this._renderPreview(zone.name, '', [
          ['Requires', INFRASTRUCTURE[zone.requiredFloor]?.name || zone.requiredFloor],
          ['Placement', 'Drag area'],
        ]);
      } else {
        const furn = ZONE_FURNISHINGS[key];
        if (!furn) { this._hidePreview(); return; }
        this._renderPreview(furn.name, '', [
          ['Cost', `$${furn.cost}`],
          ['Zone', ZONES[furn.zoneType]?.name || furn.zoneType],
        ]);
      }
      return;
    }

    // Demolish tools
    if (this.selectedCategory === 'demolish') {
      const names = { demolishComponent: 'Remove Components', demolishConnection: 'Remove Pipes', demolishFurnishing: 'Remove Furniture', demolishZone: 'Remove Zone', demolishFloor: 'Remove Floor', demolishWall: 'Remove Walls', demolishDoor: 'Remove Doors', demolishAll: 'Clear Everything' };
      this._renderPreview(names[key] || 'Demolish', '', []);
      return;
    }

    const comp = COMPONENTS[key];
    if (!comp) { this._hidePreview(); return; }

    const costs = Object.entries(comp.cost).map(([r, a]) => `${a} ${r}`).join(', ');
    const statEntries = [
      ['Cost', costs],
      ['Energy Cost', `${comp.energyCost} kW`],
      ['Length', `${((comp.subL || 4) * 0.5).toFixed(1)} m`],
    ];
    if (comp.stats) {
      for (const [k, v] of Object.entries(comp.stats)) {
        const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        if (k === 'energyGain') {
          const e = formatEnergy(v);
          statEntries.push([label, `${e.val} ${e.unit}`]);
        } else {
          const unit = typeof UNITS !== 'undefined' && UNITS[k] ? ` ${UNITS[k]}` : '';
          statEntries.push([label, `${v}${unit}`]);
        }
      }
    }
    if (comp.requires) {
      const reqs = Array.isArray(comp.requires) ? comp.requires : [comp.requires];
      statEntries.push(['Requires', reqs.join(', ')]);
    }

    this._renderPreview(comp.name, comp.desc || '', statEntries, comp.id);
  }

  _renderPreview(name, desc, stats, componentId) {
    const panel = document.getElementById('component-preview');
    const nameEl = document.getElementById('preview-name');
    const descEl = document.getElementById('preview-desc');
    const statsEl = document.getElementById('preview-stats');
    if (!panel) return;

    nameEl.textContent = name;
    descEl.textContent = desc;
    statsEl.innerHTML = '';
    for (const [label, val] of stats) {
      const row = document.createElement('div');
      row.className = 'prev-stat-row';
      row.innerHTML = `<span>${label}</span><span class="prev-stat-val">${val}</span>`;
      statsEl.appendChild(row);
    }
    // Draw schematic if available
    const schematicCanvas = document.getElementById('preview-schematic');
    if (schematicCanvas && componentId && this.renderer._schematicDrawers[componentId]) {
      schematicCanvas.style.display = 'block';
      this.renderer.drawSchematic(schematicCanvas, componentId);
    } else if (schematicCanvas) {
      schematicCanvas.style.display = 'none';
    }

    panel.classList.remove('hidden');
  }

  _hidePreview() {
    const panel = document.getElementById('component-preview');
    if (panel) panel.classList.add('hidden');
  }

  _getPaletteCompKeys() {
    const category = this.selectedCategory;
    if (category === 'flooring') {
      return ['labFloor', 'officeFloor', 'concrete', 'hallway'];
    }
    if (category === 'walls') {
      return Object.keys(WALL_TYPES);
    }
    if (category === 'doors') {
      return Object.keys(DOOR_TYPES);
    }
    if (category === 'demolish') {
      return ['demolishComponent', 'demolishConnection', 'demolishFurnishing', 'demolishZone', 'demolishFloor', 'demolishWall', 'demolishAll'];
    }
    if (category === 'infrastructure') {
      return Object.keys(INFRASTRUCTURE);
    }
    // Zone tabs: first item is zone type, then furnishings
    const catDef = MODES.facility?.categories?.[category];
    if (catDef?.isZoneTab) {
      const zoneType = catDef.zoneType;
      const furnKeys = Object.keys(ZONE_FURNISHINGS).filter(k => ZONE_FURNISHINGS[k].zoneType === zoneType);
      return [zoneType, ...furnKeys];
    }
    const keys = [];
    for (const [key, comp] of Object.entries(COMPONENTS)) {
      if (comp.category === category) keys.push(key);
    }
    return keys;
  }
}
