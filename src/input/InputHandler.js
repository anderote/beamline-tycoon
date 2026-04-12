import { COMPONENTS } from '../data/components.js';
import { FLOORS, WALL_TYPES, DOOR_TYPES } from '../data/structure.js';
import { ZONES, ZONE_FURNISHINGS } from '../data/facility.js';
import { DECORATIONS } from '../data/decorations.js';
import { MODES } from '../data/modes.js';
import { DIR, DIR_DELTA } from '../data/directions.js';
import { isoToGrid, isoToGridFloat, gridToIso, isoToSubGrid } from '../renderer/grid.js';
import { isFacilityCategory } from '../renderer/Renderer.js';
import { formatEnergy, UNITS } from '../data/units.js';
import { NetworkWindow } from '../ui/NetworkWindow.js';
import { ContextWindow } from '../ui/ContextWindow.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { snapForPlaceable, canPlace } from '../game/placement.js';
import { findStackTarget } from '../game/stacking.js';
import {
  DEMOLISH_PLACEABLE_SCOPE,
  DEMOLISH_STANDALONE,
  demolishRefund,
  refundForFound,
  nameForFound,
} from './demolishScopes.js';

// === BEAMLINE TYCOON: INPUT HANDLER ===

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
    optics:        0x8866cc, // purple
    source:        0xcccc44, // yellow
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
    this.floorOrientationOverride = null; // F-key override for orientable floors: null=auto, 0=horiz, 1=vert
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
    // Unified placeable selection (Task 8)
    this.selectedPlaceableId = null;
    this.hoverPlaceable = null; // { id, col, row, subCol, subRow, dir } | null
    this.selectedConnTool = null;
    this.isDrawingConn = false;
    this.connDrawMode = 'add';  // 'add' or 'remove'
    this.connPath = [];
    this.selectedRackTool = false;
    // Line placement (hallway)
    this.isDrawingLine = false;
    this.linePath = [];
    // Wall placement (edge-based)
    this.selectedWallTool = null;
    this.selectedWallVariant = 0;
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

    // --- Unified placeable detection ---
    // Any demolish mode with a placeable scope uses the same hover UX:
    // outline the mesh and show a tooltip with the refund.
    const scope = DEMOLISH_PLACEABLE_SCOPE[dt];
    if (scope) {
      const found = this._findDeletablePlaceable(world, grid, screenX, screenY, scope);
      if (found) {
        this.renderer._clearPreview();
        if (found.rootObj) this.renderer._outlineObject(found.rootObj);

        // Attachments: refund is 50% of the attachment component's cost.
        if (found.kind === 'attachment') {
          const def = found.placeable;
          const name = def?.name || found.attachment?.type || 'Attachment';
          const cost = def?.cost?.funding || 0;
          const refund = Math.floor(cost * 0.5);
          this._showDemolishTooltip(name, refund, screenX, screenY);
          return;
        }
        // Beam pipes have their own name/refund computation.
        if (found.kind === 'beampipe') {
          const pipe = (this.game.state.beamPipes || []).find(p => p.id === found.pipeId);
          if (pipe) {
            const segCount = Math.max(1, (pipe.path.length - 1) || 1);
            const driftDef = COMPONENTS.drift;
            const costPerTile = driftDef ? driftDef.cost.funding : 10000;
            const refund = Math.floor(costPerTile * segCount * 0.5);
            this._showDemolishTooltip('Beam Pipe', refund, screenX, screenY);
          } else {
            this._showDemolishTooltip('Beam Pipe', 0, screenX, screenY);
          }
          return;
        }

        const def = found.placeable;
        const name = def?.name ?? found.entry?.type ?? found.node?.type ?? 'Unknown';
        this._showDemolishTooltip(name, demolishRefund(def), screenX, screenY);
        return;
      }
    }

    // --- Tile-based fallback for flat objects (zones, floors, connections) ---
    let found = false;

    // Zones
    if (!found && (dt === 'demolishZone' || dt === 'demolishAll')) {
      const zoneType = this.game.state.zoneOccupied[key];
      if (zoneType) {
        const zone = ZONES[zoneType];
        this.renderer.renderDemolishTileOutline(col, row);
        this._showDemolishTooltip(zone ? zone.name : zoneType, 0, screenX, screenY);
        found = true;
      }
    }

    // Rack segments (formerly demolishConnection / utility connections)
    if (!found && (dt === 'demolishUtility' || dt === 'demolishAll')) {
      if (this.game.state.rackSegments.has(key)) {
        this.renderer.renderDemolishTileOutline(col, row);
        const seg = this.game.state.rackSegments.get(key);
        const label = seg.utilities.size > 0 ? [...seg.utilities].join(', ') : 'Carrier Rack';
        this._showDemolishTooltip(label, 0, screenX, screenY);
        found = true;
      }
    }

    // Infrastructure / floor
    if (!found && (dt === 'demolishFloor' || dt === 'demolishAll')) {
      const infraType = this.game.state.infraOccupied[key];
      if (infraType) {
        const infra = FLOORS[infraType];
        this.renderer.renderDemolishTileOutline(col, row);
        this._showDemolishTooltip(infra ? infra.name : infraType, infra ? Math.floor((infra.cost || 0) * 0.5) : 0, screenX, screenY);
        found = true;
      }
    }

    // Walls — edge-based hover. Walls live on tile edges in state.wallOccupied
    // keyed by 'col,row,edge'. Highlight the matched edge.
    if (!found && (dt === 'demolishWall' || dt === 'demolishAll')) {
      const edge = this._getNearestEdge?.(screenX, screenY);
      if (edge) {
        const ekey = edge.col + ',' + edge.row + ',' + edge.edge;
        const wallType = this.game.state.wallOccupied?.[ekey];
        if (wallType) {
          this.renderer.renderDemolishEdgeOutline(edge.col, edge.row, edge.edge);
          const def = WALL_TYPES[wallType];
          this._showDemolishTooltip(def?.name || 'Wall', demolishRefund(def), screenX, screenY);
          found = true;
        }
      }
    }

    // Doors — edge-based hover. Doors live on tile edges in state.doorOccupied
    // keyed by 'col,row,edge'. Highlight the matched edge.
    if (!found && (dt === 'demolishDoor' || dt === 'demolishAll')) {
      const edge = this._getNearestEdge?.(screenX, screenY);
      if (edge) {
        const ekey = edge.col + ',' + edge.row + ',' + edge.edge;
        const doorType = this.game.state.doorOccupied?.[ekey];
        if (doorType) {
          this.renderer.renderDemolishEdgeOutline(edge.col, edge.row, edge.edge);
          const def = DOOR_TYPES[doorType];
          this._showDemolishTooltip(def?.name || 'Door', demolishRefund(def), screenX, screenY);
          found = true;
        }
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

  /**
   * Show a green-dollar cost tooltip next to the cursor during infra drag.
   * Passing cost=0 shows "Free". Passing a non-zero skippedNoFoundation also
   * shows a red warning line about missing foundation.
   */
  _showDragCostTooltip(cost, screenX, screenY, opts = {}) {
    if (!this._dragCostTooltipEl) {
      const el = document.createElement('div');
      el.className = 'hover-tooltip drag-cost-tooltip';
      document.body.appendChild(el);
      this._dragCostTooltipEl = el;
    }
    const el = this._dragCostTooltipEl;
    let html;
    if (cost > 0) {
      html = `<span style="color:#66ff88">$${cost.toLocaleString()}</span>`;
    } else {
      html = `<span style="color:#88ccff">Free</span>`;
    }
    if (opts.skippedNoFoundation > 0) {
      html += `<br><span style="color:#ff6666">${opts.skippedNoFoundation} tile(s) need ${opts.foundationName || 'foundation'}</span>`;
    }
    if (opts.insufficientFunding) {
      html += `<br><span style="color:#ff6666">Insufficient funds</span>`;
    }
    el.innerHTML = html;
    el.style.left = (screenX + 14) + 'px';
    el.style.top = (screenY - 10) + 'px';
    el.style.display = 'block';
  }

  _hideDragCostTooltip() {
    if (this._dragCostTooltipEl) {
      this._dragCostTooltipEl.style.display = 'none';
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
   * Show or update the shift-wall floor-boundary preview at the current
   * cursor position. Called from both mousemove and keydown so that
   * pressing shift with a stationary cursor still shows the preview.
   */
  _refreshWallShiftPreview() {
    if (!this.selectedWallTool || this.isDrawingWall || this._shiftWallPending) return;
    if (this._lastScreenX == null) return;
    const edge = this._getNearestFloorEdge(this._lastScreenX, this._lastScreenY);
    const path = this._buildFloorBoundaryPath(edge);
    this.renderer.renderWallPreview(path, this.selectedWallTool);
    const cost = this._wallPathCost(path, this.selectedWallTool);
    this._showDragCostTooltip(cost, this._lastScreenX, this._lastScreenY, {
      insufficientFunding: this.game.state.resources.funding < cost,
    });
  }

  /**
   * Compute cost of placing walls along a path, skipping already-occupied edges.
   */
  _wallPathCost(path, wallType) {
    const wt = WALL_TYPES[wallType];
    if (!wt) return 0;
    const segCost = wt.variantCosts?.[this.selectedWallVariant] ?? wt.cost;
    let count = 0;
    for (const pt of path) {
      const key = `${pt.col},${pt.row},${pt.edge}`;
      if (this.game.state.wallOccupied[key] === wallType) continue;
      count++;
    }
    return count * segCost;
  }

  /**
   * Walk along a floor boundary from the clicked edge in both directions,
   * collecting every contiguous edge that sits on the same boundary.
   */
  _buildFloorBoundaryPath(origin) {
    const occ = this.game.state.infraOccupied;
    const { edge } = origin;

    const neighborKey = (col, row, e) => {
      if (e === 'n') return `${col},${row - 1}`;
      if (e === 's') return `${col},${row + 1}`;
      if (e === 'e') return `${col + 1},${row}`;
      return `${col - 1},${row}`;
    };

    const isBoundary = (col, row, e) => {
      const a = !!occ[`${col},${row}`];
      const b = !!occ[neighborKey(col, row, e)];
      return a !== b;
    };

    if (!isBoundary(origin.col, origin.row, edge)) return [origin];

    const horizontal = edge === 'n' || edge === 's';
    const path = [origin];

    for (const dir of [-1, 1]) {
      let col = origin.col;
      let row = origin.row;
      for (;;) {
        if (horizontal) col += dir; else row += dir;
        if (!isBoundary(col, row, edge)) break;
        const pt = { col, row, edge };
        if (dir === -1) path.unshift(pt); else path.push(pt);
      }
    }
    return path;
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
   * Find a beamline component at a half-tile endpoint by checking the
   * floor/ceil candidates of the coordinate (up to 4 adjacent tiles).
   * Returns `{ comp, cell }` where `cell.col/row` is the component's
   * *actual visual centre* expressed in pipe.col/row coordinates (i.e.
   * the inverse of the `col*2+1` renderer formula). This ensures pipe
   * paths terminate at the module's true centre rather than the tile
   * centre, which matters for subgrid-placed modules whose footprint is
   * smaller than a full tile.
   */
  _findBeamlineComponentNearEndpoint(col, row) {
    const cFloor = Math.floor(col);
    const cCeil = Math.ceil(col);
    const rFloor = Math.floor(row);
    const rCeil = Math.ceil(row);
    const cols = cFloor === cCeil ? [cFloor] : [cFloor, cCeil];
    const rows = rFloor === rCeil ? [rFloor] : [rFloor, rCeil];
    for (const c of cols) {
      for (const r of rows) {
        const comp = this._findBeamlineComponentAt(c, r);
        if (!comp) continue;
        const def = COMPONENTS[comp.type];
        const gwSub = def?.gridW || def?.subW || 4;
        const ghSub = def?.gridH || def?.subL || def?.subH || 4;
        const sc = comp.subCol || 0;
        const sr = comp.subRow || 0;
        // World-centre of the module (same formula ComponentBuilder.build
        // uses for subgrid-placed components):
        //   x = col*2 + (subCol + gwSub/2) * 0.5
        // Converted to pipe.col coordinates via `pipe_col = (world_x - 1) / 2`.
        const worldX = comp.col * 2 + (sc + gwSub / 2) * 0.5;
        const worldZ = comp.row * 2 + (sr + ghSub / 2) * 0.5;
        const pipeCol = (worldX - 1) / 2;
        const pipeRow = (worldZ - 1) / 2;
        return { comp, cell: { col: pipeCol, row: pipeRow } };
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
   * Build an L-shaped path from one point to another in 0.25-tile (single
   * sub-tile) steps so pipes snap to the sub-tile grid.
   */
  // Build an L-shaped tile path from `from` to `to` on integer tile
  // coordinates. Goes along the dominant axis first, then bends once to
  // reach the target — giving a clean straight line when the drag is axis-
  // aligned, and a single-bend L otherwise. Used for hallway placement.
  _buildLPath(from, to) {
    const fc = Math.round(from.col), fr = Math.round(from.row);
    const tc = Math.round(to.col),   tr = Math.round(to.row);
    const dCol = tc - fc;
    const dRow = tr - fr;
    const horizontalFirst = Math.abs(dCol) >= Math.abs(dRow);
    const path = [{ col: fc, row: fr }];
    let c = fc, r = fr;
    if (horizontalFirst) {
      const sc = Math.sign(dCol);
      while (c !== tc) { c += sc; path.push({ col: c, row: r }); }
      const sr = Math.sign(dRow);
      while (r !== tr) { r += sr; path.push({ col: c, row: r }); }
    } else {
      const sr = Math.sign(dRow);
      while (r !== tr) { r += sr; path.push({ col: c, row: r }); }
      const sc = Math.sign(dCol);
      while (c !== tc) { c += sc; path.push({ col: c, row: r }); }
    }
    return path;
  }

  _buildStraightPath(from, to) {
    const STEP = 0.25;
    const EPS = 0.001;
    // Constrain the path to a single straight line: keep whichever axis
    // has the larger drag delta and lock the other to `from`. This
    // prevents accidental L-shaped bends while click-dragging pipes.
    const dCol = to.col - from.col;
    const dRow = to.row - from.row;
    const useCol = Math.abs(dCol) >= Math.abs(dRow);
    const targetCol = useCol ? to.col : from.col;
    const targetRow = useCol ? from.row : to.row;

    const path = [{ col: from.col, row: from.row }];
    let c = from.col, r = from.row;
    const dc = targetCol > c + EPS ? STEP : (targetCol < c - EPS ? -STEP : 0);
    const dr = targetRow > r + EPS ? STEP : (targetRow < r - EPS ? -STEP : 0);

    let safety = 2048;
    while (safety-- > 0) {
      const moreCol = dc !== 0 && Math.abs(c - targetCol) > EPS;
      const moreRow = dr !== 0 && Math.abs(r - targetRow) > EPS;
      if (!moreCol && !moreRow) break;
      if (moreCol) c += dc;
      if (moreRow) r += dr;
      path.push({ col: c, row: r });
    }

    return path;
  }

  /**
   * Snap a world position to the nearest sub-tile gridline for beam pipes
   * (quarter-tile / 1 sub-unit resolution).
   *
   * Emits tile-index coordinates so that integer values correspond to
   * tile centres — i.e. `col=0` renders at world x=1 via the pipe
   * renderer's `col*2+1` formula. `isoToGridFloat` gives world-corner
   * fractions (0.5 = tile centre), so we subtract 0.5 to convert.
   */
  _snapPipePoint(worldX, worldY) {
    const fc = isoToGridFloat(worldX, worldY);
    return {
      col: Math.round((fc.col - 0.5) * 4) / 4,
      row: Math.round((fc.row - 0.5) * 4) / 4,
    };
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
   * Project a 3D world-space point onto a pipe polyline. Uses the same
   * `col*2+1, row*2+1` formula the renderer uses, so the projection is
   * grounded in where each path node is actually *drawn*. Both DesignPlacer
   * and `_snapPipePoint` emit pipe.path col/row in the same tile-index
   * coordinate system, so integer values correspond to tile centres.
   *
   * Returns `{ position, col, row, worldX, worldZ, dir }` where `position`
   * is the 0..1 arc-length fraction along the pipe in world metres, and
   * `col`/`row` are the interpolated pipe.path coordinates of the hit.
   */
  _projectOntoPipe(pipe, worldX, worldZ) {
    const path = pipe.path;
    if (!path || path.length === 0) return null;
    if (path.length === 1) {
      const wx = path[0].col * 2 + 1;
      const wz = path[0].row * 2 + 1;
      return { position: 0.5, col: path[0].col, row: path[0].row, worldX: wx, worldZ: wz, dir: 0 };
    }

    // Cumulative arc length (in world units) up to each node
    const cum = [0];
    for (let i = 1; i < path.length; i++) {
      const dwx = (path[i].col - path[i - 1].col) * 2;
      const dwz = (path[i].row - path[i - 1].row) * 2;
      cum.push(cum[i - 1] + Math.hypot(dwx, dwz));
    }
    const total = cum[path.length - 1];
    if (total <= 0) {
      const wx = path[0].col * 2 + 1;
      const wz = path[0].row * 2 + 1;
      return { position: 0, col: path[0].col, row: path[0].row, worldX: wx, worldZ: wz, dir: 0 };
    }

    let bestDist = Infinity;
    let bestLen = 0;
    let bestCol = path[0].col;
    let bestRow = path[0].row;
    let bestWx = path[0].col * 2 + 1;
    let bestWz = path[0].row * 2 + 1;
    let bestDir = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const ax = path[i].col * 2 + 1;
      const az = path[i].row * 2 + 1;
      const bx = path[i + 1].col * 2 + 1;
      const bz = path[i + 1].row * 2 + 1;
      const dx = bx - ax, dz = bz - az;
      const segLen2 = dx * dx + dz * dz;
      let t = 0;
      if (segLen2 > 0) {
        t = ((worldX - ax) * dx + (worldZ - az) * dz) / segLen2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
      }
      const hx = ax + t * dx;
      const hz = az + t * dz;
      const dist = Math.hypot(worldX - hx, worldZ - hz);
      if (dist < bestDist) {
        bestDist = dist;
        bestLen = cum[i] + t * Math.sqrt(segLen2);
        bestCol = path[i].col + t * (path[i + 1].col - path[i].col);
        bestRow = path[i].row + t * (path[i + 1].row - path[i].row);
        bestWx = hx;
        bestWz = hz;
        const dcol = path[i + 1].col - path[i].col;
        const drow = path[i + 1].row - path[i].row;
        if (dcol > 0) bestDir = 1;       // SE
        else if (dcol < 0) bestDir = 3;  // NW
        else if (drow > 0) bestDir = 2;  // SW
        else if (drow < 0) bestDir = 0;  // NE
      }
    }
    return {
      position: bestLen / total,
      col: bestCol,
      row: bestRow,
      worldX: bestWx,
      worldZ: bestWz,
      dir: bestDir,
    };
  }

  /**
   * Given a cursor world position (iso-pixel — i.e. the output of
   * `screenToWorld`), snap the attachment footprint to the subgrid using
   * the unified placement system, then project the snap center onto the
   * nearest pipe. Returns `{ snap, pipe, proj }` or null if no pipe is
   * within reach.
   */
  _snapAttachmentToPipe(worldX, worldY) {
    const compDef = COMPONENTS[this.selectedTool];
    if (!compDef) return null;
    const snap = snapForPlaceable(worldX, worldY, compDef, this.placementDir || 0);
    const swap = (this.placementDir || 0) === 1 || (this.placementDir || 0) === 3;
    const subW = swap ? (compDef.subL || 2) : (compDef.subW || 2);
    const subH = swap ? (compDef.subW || 2) : (compDef.subL || 2);
    // Footprint center in 3D world coordinates (matches placeable formula)
    const wx = snap.col * 2 + (snap.subCol + subW / 2) * 0.5;
    const wz = snap.row * 2 + (snap.subRow + subH / 2) * 0.5;
    // Find nearest pipe. _findNearestPipe uses integer tile col/row as a
    // rough Manhattan filter, so pass the tile containing the footprint
    // center.
    const intCol = Math.floor(wx / 2);
    const intRow = Math.floor(wz / 2);
    const pipe = this._findNearestPipe(intCol, intRow);
    if (!pipe) return null;
    const proj = this._projectOntoPipe(pipe, wx, wz);
    if (!proj) return null;
    // Compute the subtile cells the attachment will actually occupy at its
    // projected on-pipe position, then test against subgridOccupied so
    // attachments can't sit on top of placed modules / equipment.
    const cells = this._attachmentCellsAtProj(proj, compDef);
    let collidesWithModule = false;
    const occ = this.game.state.subgridOccupied || {};
    for (const c of cells) {
      const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
      if (occ[k]) {
        collidesWithModule = true;
        break;
      }
    }
    return { snap, pipe, proj, cells, collidesWithModule };
  }

  /**
   * Compute the subtile cells an attachment occupies when placed at a
   * projected on-pipe position. Mirrors the renderer's centering rule
   * (`col*2+1` world center) and rotates the footprint by `proj.dir`.
   */
  _attachmentCellsAtProj(proj, compDef) {
    const dir = proj.dir || 0;
    const swap = dir === 1 || dir === 3;
    // After accounting for orientation: footW is the col-axis extent in
    // subtiles, footH is the row-axis extent. subL is along the beam.
    const footW = swap ? (compDef.subL || 1) : (compDef.subW || 1);
    const footH = swap ? (compDef.subW || 1) : (compDef.subL || 1);
    // Absolute subtile center: world is (proj.col*2+1, proj.row*2+1) and
    // 1 subtile = 0.5 world units.
    const absCenterC = proj.col * 4 + 2;
    const absCenterR = proj.row * 4 + 2;
    const absOriginC = Math.round(absCenterC - footW / 2);
    const absOriginR = Math.round(absCenterR - footH / 2);
    const cells = [];
    for (let dr = 0; dr < footH; dr++) {
      for (let dc = 0; dc < footW; dc++) {
        const sc = absOriginC + dc;
        const sr = absOriginR + dr;
        cells.push({
          col: Math.floor(sc / 4),
          row: Math.floor(sr / 4),
          subCol: ((sc % 4) + 4) % 4,
          subRow: ((sr % 4) + 4) % 4,
        });
      }
    }
    return cells;
  }

  /**
   * Update the transparent hover ghost for the currently selected
   * attachment tool. Uses the unified subgrid snap for the footprint and
   * the pipe projection for pipe-alignment.
   */
  _updateAttachmentPreview(worldX, worldY) {
    const hit = this._snapAttachmentToPipe(worldX, worldY);
    if (!hit) {
      this.renderer._clearPreview?.();
      return;
    }
    this.renderer.renderAttachmentGhost(
      hit.proj.col, hit.proj.row,
      this.selectedTool,
      hit.proj.dir,
      !hit.collidesWithModule,
    );
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

  /**
   * Return the nearest edge that has a wall on it. Falls back to the
   * nearest floor-boundary edge if no walls are within reach.
   */
  _getNearestWallEdge(screenX, screenY) {
    const world = this.renderer.screenToWorld(screenX, screenY);
    const gf = isoToGridFloat(world.x, world.y);
    const col = Math.floor(gf.col);
    const row = Math.floor(gf.row);
    const fx = gf.col - col;
    const fy = gf.row - row;

    const candidates = [
      { col, row, edge: 'n', dist: fy },
      { col, row, edge: 's', dist: 1 - fy },
      { col, row, edge: 'e', dist: 1 - fx },
      { col, row, edge: 'w', dist: fx },
    ];

    const wo = this.game.state.wallOccupied;
    const hasWall = (e) => !!wo[`${e.col},${e.row},${e.edge}`];

    candidates.sort((a, b) => {
      const aScore = a.dist - (hasWall(a) ? 0.35 : 0);
      const bScore = b.dist - (hasWall(b) ? 0.35 : 0);
      return aScore - bScore;
    });

    return candidates[0];
  }

  // --- Keyboard bindings ---

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      this._shiftDown = e.shiftKey;
      if (e.key === 'Shift') this._refreshWallShiftPreview();
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

      // Track pan keys for continuous movement (WASD only).
      // Normalize to lowercase so Shift toggling mid-press doesn't strand
      // an uppercase entry in the set.
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
        this.keysDown.add(k);
        e.preventDefault();
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.game._pushUndo();
          if (this.selectedTool && COMPONENTS[this.selectedTool]?.placement === 'attachment') {
            // Attachment: snap footprint to subgrid, project onto nearest
            // pipe so the keyboard placement matches the hover ghost.
            const wx = this.lastMouseWorldX ?? 0;
            const wy = this.lastMouseWorldY ?? 0;
            const hit = this._snapAttachmentToPipe(wx, wy);
            if (!hit) {
              this.game.log('Must place on a beam pipe!', 'bad');
            } else if (hit.collidesWithModule) {
              const def = COMPONENTS[this.selectedTool];
              this.game.log(`${def?.name || 'Attachment'} would overlap a placed module!`, 'bad');
            } else {
              this.game.addAttachmentToPipe(
                hit.pipe.id,
                this.selectedTool,
                hit.proj.position,
                this.selectedParamOverrides,
              );
            }
          } else if (this.hoverPlaceable) {
            // Unified placement — handles beamline / equipment / furnishing / decoration.
            const placedId = this.game.placePlaceable({
              type: this.hoverPlaceable.id,
              col: this.hoverPlaceable.col,
              row: this.hoverPlaceable.row,
              subCol: this.hoverPlaceable.subCol,
              subRow: this.hoverPlaceable.subRow,
              dir: this.hoverPlaceable.dir,
              params: this.selectedParamOverrides,
            });
            // Auto-switch to beam pipe tool after placing a source.
            const comp = COMPONENTS[this.hoverPlaceable.id];
            if (placedId && comp?.isSource) {
              this.selectTool('drift');
            }
          } else if (this.selectedInfraTool) {
            const infra = FLOORS[this.selectedInfraTool];
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
          // Unified rotation: R always advances placementDir when a placeable
          // is selected (including during move mode, since move mode arms
          // selectedPlaceableId with the carried item's type).
          if (this.selectedPlaceableId) {
            this.placementDir = (this.placementDir + 1) % 4;
            this.renderer.updatePlacementDir?.(this.placementDir);
            this._updatePlaceablePreview();
            return;
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
        case 'q': case 'Q': {
          e.preventDefault();
          this.renderer.rotateView(-1);
          break;
        }
        case 'e': case 'E': {
          e.preventDefault();
          this.renderer.rotateView(+1);
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
          // If a placeable is armed, exit placement mode without clearing
          // the rest of the tool state.
          if (this.selectedPlaceableId) {
            this.selectPlaceable(null);
            this._hidePreview();
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
          this.deselectRackTool();
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
          // Orientable floor tool: F toggles texture rotation override.
          // Takes priority over the generic placeable rotation below because
          // no placeable ghost is active when an infra tool is selected.
          if (this.selectedInfraTool) {
            const infraDef = FLOORS[this.selectedInfraTool];
            if (infraDef?.orientable) {
              this.floorOrientationOverride = this.floorOrientationOverride ? 0 : 1;
              this._showToast(`Orientation: ${this.floorOrientationOverride ? 'vertical' : 'horizontal'}`);
              break;
            }
          }
          // Rotate placement direction (cycles NE→SE→SW→NW)
          this.placementDir = (this.placementDir + 1) % 4;
          this.renderer.updatePlacementDir(this.placementDir);
          // Re-render unified ghost so the preview rotates immediately.
          this._updatePlaceablePreview();
          // Beam pipe drawn connections still use the legacy ghost path.
          if (this.selectedTool && this.renderer.hoverCol !== undefined) {
            const comp = COMPONENTS[this.selectedTool];
            if (comp && comp.isDrawnConnection) {
              this.renderer.renderEquipmentGhost(this.renderer.hoverCol, this.renderer.hoverRow, this.selectedTool, 0x44cc44);
            }
          }
          // Also toggle dipole bend direction
          this.dipoleBendDir = this.dipoleBendDir === 'right' ? 'left' : 'right';
          this.renderer.updateCursorBendDir(this.dipoleBendDir);
          break;
        case 'c': case 'C':
          if (this.game._designer && !this.game._designer.isOpen) {
            e.preventDefault();
            const blId = this.game.selectedBeamlineId || this.game.editingBeamlineId;
            if (blId) {
              this.game._openDesignerForBeamline(blId);
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
            this.deselectRackTool();
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
      this._shiftDown = e.shiftKey;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keysDown.delete(k);
      this.keysDown.delete(e.key);
      if (e.key === 'Shift') {
        if (this._shiftWallPending) {
          this._shiftWallPending = false;
          this.wallPath = [];
        }
        if (this.selectedWallTool && !this.isDrawingWall) {
          this.renderer.clearDragPreview();
          this._hideDragCostTooltip();
          if (this._lastScreenX != null) {
            const edge = this._getNearestFloorEdge(this._lastScreenX, this._lastScreenY);
            this.renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
          }
        }
      }
    });

    // Clear all held keys when the window loses focus so pan doesn't stick
    // if the user alt-tabs, opens devtools, or a modal steals focus.
    const clearHeldKeys = () => {
      this.keysDown.clear();
      this._shiftDown = false;
    };
    window.addEventListener('blur', clearHeldKeys);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearHeldKeys();
    });
  }

  _startPanLoop() {
    const PAN_SPEED_BASE = 0.5; // world-pan units per frame at zoom=1
    const loop = () => {
      // Scale inversely with zoom so screen-space pan speed stays consistent
      // (at high zoom, world-space motion is slower).
      const shiftMul = this._shiftDown ? 2.5 : 1;
      const speed = (PAN_SPEED_BASE * shiftMul) / (this.renderer.zoom || 1);
      let dxRight = 0, dyUp = 0;
      if (this.keysDown.has('w') || this.keysDown.has('W')) dyUp += speed;
      if (this.keysDown.has('s') || this.keysDown.has('S')) dyUp -= speed;
      if (this.keysDown.has('d') || this.keysDown.has('D')) dxRight += speed;
      if (this.keysDown.has('a') || this.keysDown.has('A')) dxRight -= speed;
      if (dxRight !== 0 || dyUp !== 0) {
        this.renderer.panScreenAligned(dxRight, dyUp);
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
        this.panStartPan = { x: this.renderer._panX, y: this.renderer._panY };
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      // Rack placement (left click)
      if (this.selectedRackTool && e.button === 0) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        const col = Math.floor(grid.col / 2) * 2;
        const row = Math.floor(grid.row / 2) * 2;
        this.game._pushUndo();
        this.game.placeRackSegment(col, row);
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
        if (this.demolishType === 'demolishEquipment' || this.demolishType === 'demolishBeamline') {
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
        const infra = FLOORS[this.selectedInfraTool];
        if (infra && infra.isLinePlacement) {
          const world = this.renderer.screenToWorld(e.clientX, e.clientY);
          const grid = isoToGrid(world.x, world.y);
          this.isDrawingLine = true;
          this.lineStart = { col: grid.col, row: grid.row };
          this.linePath = [{ col: grid.col, row: grid.row }];
          this.renderer.renderLinePreview(this.linePath, this.selectedInfraTool);
          return;
        }
      }

      // Wall edge placement start
      if (e.button === 0 && this.selectedWallTool) {
        const edge = this._getNearestFloorEdge(e.clientX, e.clientY);
        if (this._shiftDown) {
          // Shift-click: auto-fill entire floor boundary
          this._shiftWallPending = true;
          this.wallPath = this._buildFloorBoundaryPath(edge);
          this.renderer.renderWallPreview(this.wallPath, this.selectedWallTool);
          const cost = this._wallPathCost(this.wallPath, this.selectedWallTool);
          this._showDragCostTooltip(cost, e.clientX, e.clientY, {
            insufficientFunding: this.game.state.resources.funding < cost,
          });
          return;
        }
        this.isDrawingWall = true;
        this._wallStart = edge;
        this.wallPath = [edge];
        this.renderer.renderWallPreview(this.wallPath, this.selectedWallTool);
        return;
      }

      // Door edge placement start
      if (e.button === 0 && this.selectedDoorTool) {
        const edge = this._getNearestWallEdge(e.clientX, e.clientY);
        this.isDrawingDoor = true;
        this._doorStart = edge;
        this.doorPath = [edge];
        this.renderer.renderDoorPreview(this.doorPath, this.selectedDoorTool);
        return;
      }

      // Infrastructure drag start (area placement)
      if (e.button === 0 && this.selectedInfraTool) {
        const infra = FLOORS[this.selectedInfraTool];
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        if (infra && infra.isDragPlacement) {
          this.isDragging = true;
          this.dragStart = { col: grid.col, row: grid.row };
          this.dragEnd = { col: grid.col, row: grid.row };
          this.renderer.renderDragPreview(grid.col, grid.row, grid.col, grid.row, this.selectedInfraTool);
          const cost = this.game.computeInfraRectCost(
            grid.col, grid.row, grid.col, grid.row, this.selectedInfraTool, this.selectedInfraVariant,
          );
          this._showDragCostTooltip(cost.totalCost, e.clientX, e.clientY, {
            skippedNoFoundation: cost.skippedNoFoundation,
            foundationName: infra.requiresFoundation
              ? (FLOORS[infra.requiresFoundation]?.name || infra.requiresFoundation)
              : null,
            insufficientFunding: this.game.state.resources.funding < cost.totalCost,
          });
        }
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.panStart.x;
        const dy = e.clientY - this.panStart.y;
        this.renderer.setPanFromDragDelta(this.panStartPan.x, this.panStartPan.y, dx, dy);
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
          // Cost tooltip for infra drag placement
          const cost = this.game.computeInfraRectCost(
            this.dragStart.col, this.dragStart.row,
            grid.col, grid.row, this.selectedInfraTool, this.selectedInfraVariant,
          );
          const def = FLOORS[this.selectedInfraTool];
          this._showDragCostTooltip(cost.totalCost, e.clientX, e.clientY, {
            skippedNoFoundation: cost.skippedNoFoundation,
            foundationName: def?.requiresFoundation
              ? (FLOORS[def.requiresFoundation]?.name || def.requiresFoundation)
              : null,
            insufficientFunding: this.game.state.resources.funding < cost.totalCost,
          });
        }
      } else if (this.isDrawingLine && this.selectedInfraTool) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        const start = this.lineStart || this.linePath[0];
        this.linePath = this._buildLPath(start, grid);
        this.renderer.renderLinePreview(this.linePath, this.selectedInfraTool);
        // Cost tooltip for line placement (hallway)
        const lineCost = this.game.computeInfraLineCost(
          this.linePath, this.selectedInfraTool, this.selectedInfraVariant,
        );
        const lineDef = FLOORS[this.selectedInfraTool];
        this._showDragCostTooltip(lineCost.totalCost, e.clientX, e.clientY, {
          skippedNoFoundation: lineCost.skippedNoFoundation,
          foundationName: lineDef?.requiresFoundation
            ? (FLOORS[lineDef.requiresFoundation]?.name || lineDef.requiresFoundation)
            : null,
          insufficientFunding: this.game.state.resources.funding < lineCost.totalCost,
        });
      } else if (this.isDrawingWall && this.selectedWallTool) {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        this.wallPath = this._buildWallLine(this._wallStart, edge);
        this.renderer.renderWallPreview(this.wallPath, this.selectedWallTool);
        const cost = this._wallPathCost(this.wallPath, this.selectedWallTool);
        this._showDragCostTooltip(cost, e.clientX, e.clientY, {
          insufficientFunding: this.game.state.resources.funding < cost,
        });
      } else if (this.isDrawingWall && this.demolishMode && this.demolishType === 'demolishWall') {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        this.wallPath = this._buildWallLine(this._wallStart, edge);
        this.renderer.renderWallPreview(this.wallPath, this.selectedWallTool || 'exteriorWall');
      } else if (this.isDrawingDoor && this.demolishMode && this.demolishType === 'demolishDoor') {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        this.doorPath = this._buildWallLine(this._doorStart, edge);
        this.renderer.renderDoorPreview(this.doorPath, 'officeDoor');
      } else if (this.selectedWallTool && !this.isDrawingWall && !this._shiftWallPending) {
        const edge = this._getNearestFloorEdge(e.clientX, e.clientY);
        if (this._shiftDown) {
          const path = this._buildFloorBoundaryPath(edge);
          this.renderer.renderWallPreview(path, this.selectedWallTool);
          const cost = this._wallPathCost(path, this.selectedWallTool);
          this._showDragCostTooltip(cost, e.clientX, e.clientY, {
            insufficientFunding: this.game.state.resources.funding < cost,
          });
        } else {
          this._hideDragCostTooltip();
          this.renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
        }
      } else if (this.isDrawingDoor && this.selectedDoorTool) {
        const edge = this._getNearestWallEdge(e.clientX, e.clientY);
        this.doorPath = this._buildWallLine(this._doorStart, edge);
        this.renderer.renderDoorPreview(this.doorPath, this.selectedDoorTool);
      } else if (this.selectedDoorTool && !this.isDrawingDoor) {
        const edge = this._getNearestWallEdge(e.clientX, e.clientY);
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
          const infra = this.selectedInfraTool ? FLOORS[this.selectedInfraTool] : null;
          const zone = this.selectedZoneTool ? ZONES[this.selectedZoneTool] : null;
          const color = infra?.topColor || zone?.color || 0xffffff;
          this.renderer.renderInfraHoverCursor(grid.col, grid.row, color);
        } else if (this.selectedTool && COMPONENTS[this.selectedTool]?.isDrawnConnection) {
          // Hover preview for beam pipe: snap to sub-tile so it matches where
          // the pipe will actually be drawn on click. Stored on the input
          // handler so the animate loop can keep the preview alive across frames.
          this.hoverPipePoint = this._snapPipePoint(world.x, world.y);
        }
        // Unified placeable preview. Replaces the previous four branches
        // (equipment / beamline / furnishing / decoration).
        this.lastMouseWorldX = world.x;
        this.lastMouseWorldY = world.y;
        this._lastScreenX = e.clientX;
        this._lastScreenY = e.clientY;
        this._updatePlaceablePreview();
        // Attachment hover preview: snap footprint to subgrid, project
        // onto the nearest pipe, render a transparent ghost on top of it.
        if (this.selectedTool && COMPONENTS[this.selectedTool]?.placement === 'attachment') {
          this._updateAttachmentPreview(world.x, world.y);
        }
        // Demolish hover: highlight the object under cursor with red + show tooltip
        if (this.demolishMode && !this.isDragging && !this.isDrawingWall && !this.isDrawingDoor) {
          this._updateDemolishHover(world, grid, e.clientX, e.clientY);
        }
        // Move-mode hover outline (only when not carrying anything — once a
        // payload is picked up, `selectedPlaceableId` is armed and the
        // unified placeable preview above renders the ghost automatically).
        if (this.moveMode && !this._movePayload) {
          this._updateMoveHover(grid, e.clientX, e.clientY);
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
      this._hideDragCostTooltip();
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
          const EPS = 0.13; // allow quarter-tile tolerance for matching
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
          // Single-click (no drag): extend by one sub-tile along placementDir
          if (this.beamPipePath.length === 1) {
            const start = this.beamPipePath[0];
            const delta = DIR_DELTA[this.placementDir || 0];
            this.beamPipePath.push({ col: start.col + delta.dc * 0.25, row: start.row + delta.dr * 0.25 });
          }
          let startTile = this.beamPipePath[0];
          let endTile = this.beamPipePath[this.beamPipePath.length - 1];
          const startHit = this._findBeamlineComponentNearEndpoint(startTile.col, startTile.row);
          const endHit = this._findBeamlineComponentNearEndpoint(endTile.col, endTile.row);

          // Fill gaps: extend the pipe path so it actually touches the matched
          // component cell when the endpoint lands on a half-tile between major
          // tiles. Only runs when the user dragged the pipe onto the component.
          if (startHit) {
            const cell = startHit.cell;
            if (cell.col !== startTile.col || cell.row !== startTile.row) {
              const prefix = this._buildStraightPath({ col: cell.col, row: cell.row }, startTile);
              this.beamPipePath = [...prefix.slice(0, -1), ...this.beamPipePath];
              startTile = this.beamPipePath[0];
            }
          }
          if (endHit) {
            const cell = endHit.cell;
            if (cell.col !== endTile.col || cell.row !== endTile.row) {
              const suffix = this._buildStraightPath(endTile, { col: cell.col, row: cell.row });
              this.beamPipePath = [...this.beamPipePath, ...suffix.slice(1)];
              endTile = this.beamPipePath[this.beamPipePath.length - 1];
            }
          }

          const startComp = startHit?.comp || null;
          const endComp = endHit?.comp || null;

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
        const seen = new Set();
        for (const pt of this.connPath) {
          const rackSeg = this.game.getRackSegmentAt(pt.col, pt.row);
          if (!rackSeg) continue;
          const rackKey = rackSeg.col + ',' + rackSeg.row;
          if (seen.has(rackKey)) continue;
          seen.add(rackKey);
          if (this.connDrawMode === 'add') {
            this.game.paintRackUtility(rackSeg.col, rackSeg.row, this.selectedConnTool);
          } else {
            this.game.removeRackUtility(rackSeg.col, rackSeg.row, this.selectedConnTool);
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
        this.lineStart = null;
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

      // Shift-wall placement end (auto-fill floor boundary)
      if (this._shiftWallPending && this.wallPath.length > 0) {
        this.game._pushUndo();
        this.game.placeWallPath(this.wallPath, this.selectedWallTool, this.selectedWallVariant);
        this._shiftWallPending = false;
        this.wallPath = [];
        this.renderer.clearDragPreview();
        return;
      }

      // Wall placement end
      if (this.isDrawingWall && this.wallPath.length > 0) {
        this.game._pushUndo();
        this.game.placeWallPath(this.wallPath, this.selectedWallTool, this.selectedWallVariant);
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

          if (this.demolishType === 'demolishBeamline') {
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
          } else if (this.demolishType === 'demolishUtility') {
            // Remove rack segments in rect
            for (let c = minCol; c <= maxCol; c++) {
              for (let r = minRow; r <= maxRow; r++) {
                this.game.removeRackSegment(c, r);
              }
            }
          } else if (this.demolishType === 'demolishEquipment') {
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
            this.selectedInfraVariant,
            this.floorOrientationOverride,
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
        } else if (this.selectedRackTool) {
          this.deselectRackTool();
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
        // Pipe-specific bulldozer: only remove the selected utility from the rack
        this.game.removeRackUtility(col, row, this.bulldozerConnType);
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
      const infra = FLOORS[this.selectedInfraTool];
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
      // Unified placeable delete path. Any demolish mode with a scope
      // routes through _findDeletablePlaceable for consistent hover UX
      // and click behavior. Mode-specific non-placeable branches
      // (connections, zones, floors, walls, doors) still fall through
      // below.
      const scope = DEMOLISH_PLACEABLE_SCOPE[this.demolishType];
      if (scope) {
        const found = this._findDeletablePlaceable({ x: world.x, y: world.y }, grid, screenX, screenY, scope);
        if (found) {
          this.game.demolishTarget(found);
          return;
        }
        // For the top-level demolish modes we treat "clicked nothing
        // deletable" as a no-op and let the click fall through to any
        // non-placeable tile branches below (walls/zones/floors).
      }
      if (this.demolishType === 'demolishUtility') {
        // Remove rack segment (and all its utilities) at this tile
        this.game.removeRackSegment(col, row);
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

    // Beamline attachment placement (attachments are not PLACEABLES entries —
    // they snap to an existing beam pipe). Keep this branch separate from the
    // unified hoverPlaceable commit below. The click path mirrors the hover
    // ghost: snap the footprint to the subgrid, project onto the nearest
    // pipe, and store the projected position along that pipe.
    if (this.selectedTool && COMPONENTS[this.selectedTool]?.placement === 'attachment') {
      const hit = this._snapAttachmentToPipe(world.x, world.y);
      if (!hit) {
        this.game.log('Must place on a beam pipe!', 'bad');
        return;
      }
      if (hit.collidesWithModule) {
        const def = COMPONENTS[this.selectedTool];
        this.game.log(`${def?.name || 'Attachment'} would overlap a placed module!`, 'bad');
        return;
      }
      this.game._pushUndo();
      this.game.addAttachmentToPipe(
        hit.pipe.id,
        this.selectedTool,
        hit.proj.position,
        this.selectedParamOverrides,
      );
      return;
    }

    // Unified placeable commit — handles beamline / equipment / furnishing / decoration.
    // Replaces the four legacy commit branches (beamline, equipment, furnishing, decoration).
    if (this.hoverPlaceable) {
      // For beamline modules, check if the click landed on an existing node
      // (opens its beamline window instead of placing).
      const comp = COMPONENTS[this.hoverPlaceable.id];
      if (comp && comp.placement !== 'attachment') {
        const existingNode = this._getNodeAtScreenOrGrid(screenX, screenY, col, row);
        if (existingNode) {
          this.selectedNodeId = existingNode.id;
          const entry = this.game.registry.getBeamlineForNode(existingNode.id);
          if (entry) {
            this.game.selectedBeamlineId = entry.id;
            this.renderer._openBeamlineWindow(entry.id);
            this.game.emit('beamlineSelected', entry.id);
          }
          return;
        }
      }
      this.game._pushUndo();
      const placedId = this.game.placePlaceable({
        type: this.hoverPlaceable.id,
        col: this.hoverPlaceable.col,
        row: this.hoverPlaceable.row,
        subCol: this.hoverPlaceable.subCol,
        subRow: this.hoverPlaceable.subRow,
        dir: this.hoverPlaceable.dir,
        params: this.selectedParamOverrides,
      });
      // Auto-switch to beam pipe tool after placing a source.
      if (placedId && comp?.isSource) {
        this.selectTool('drift');
      }
      return;
    }

    if (this.probeMode) {
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
        // Check for rack segment click (network info)
        const connKey = col + ',' + row;
        const rackSeg = this.game.state.rackSegments.get(connKey);
        if (rackSeg && rackSeg.utilities.size > 0) {
          const networkData = this.game.state.networkData || {};
          for (const connType of rackSeg.utilities) {
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

  /**
   * Unified placeable selection. Clears legacy per-kind fields so only the
   * new unified preview/commit path is active.
   */
  selectPlaceable(id) {
    this.selectedPlaceableId = id;
    this.selectedTool = null;
    this.selectedFurnishingTool = null;
    this.selectedFacilityTool = null;
    this.selectedDecorationTool = null;
    this.hoverPlaceable = null;
    this.renderer._clearPreview?.();
  }

  /**
   * Locate a deletable placeable under the cursor, honoring the demolish
   * mode's kind scope. Returns { kind, placeable, entry?, node?, rootObj? }
   * or null. Strategy:
   *   1. Raycast. If it hits a beamline component and 'beamline' is in
   *      scope, return the registry node + root mesh for outlining.
   *   2. If raycast hits equipment / decoration, derive the world (x,z)
   *      from the root mesh position and probe subgridOccupied.
   *   3. If raycast missed, fall back to probing the subgrid cell under
   *      the cursor world position.
   * Never returns an entry whose kind isn't in the scope set.
   */
  _findDeletablePlaceable(world, grid, screenX, screenY, scope) {
    if (!scope) return null;

    // --- 1. Raycast for precise 3D hit detection ---
    const hit = this.renderer.raycastScreen(screenX, screenY);
    if (hit) {
      const info = this.renderer.identifyHit(hit);
      if (info) {
        // Beamline components go through the legacy beam-graph registry
        // because their lifecycle is tracked there, not only in state.placeables.
        // Infrastructure modules share the same componentBuilder render path,
        // so they hit info.group === 'component' too — but they live only in
        // state.placeables (no registry node), so fall through to the unified
        // probe below if no node is found.
        if (info.group === 'component' && (scope.has('beamline') || scope.has('infrastructure'))) {
          let node = null;
          if (info.nodeId) {
            node = this.game.registry.getAllNodes().find(n => n.id === info.nodeId);
          }
          if (!node) {
            const p = info.rootObj.position;
            node = this._getNodeAtGrid(Math.floor(p.x / 2), Math.floor(p.z / 2));
          }
          if (!node) node = this._getNodeAtGrid(grid.col, grid.row);
          if (node && scope.has('beamline')) {
            const placeable = PLACEABLES[node.type] || COMPONENTS[node.type];
            return { kind: 'beamline', node, placeable, rootObj: info.rootObj };
          }
          // No registry node — likely an infrastructure module. Resolve via
          // the unified subgridOccupied probe using the hit world position.
          const p = info.rootObj.position;
          const entry = this._placeableAtWorldPos(p.x, p.z);
          if (entry && scope.has(entry.kind)) {
            return {
              kind: entry.kind,
              entry,
              placeable: PLACEABLES[entry.type],
              rootObj: info.rootObj,
            };
          }
        }
        // Beam pipes are handled separately from kind-based scope — still
        // reachable from any mode that allows beamline.
        if (info.group === 'beampipe' && scope.has('beamline')) {
          return { kind: 'beampipe', pipeId: info.pipeId, rootObj: info.rootObj };
        }
        // Beam-pipe attachments piggyback on 'beamline' scope.
        if (info.group === 'attachment' && scope.has('beamline')) {
          const pipe = (this.game.state.beamPipes || []).find(p => p.id === info.pipeId);
          const att = pipe?.attachments?.find(a => a.id === info.attachmentId) || null;
          return {
            kind: 'attachment',
            pipeId: info.pipeId,
            attachmentId: info.attachmentId,
            attachment: att,
            placeable: att ? COMPONENTS[att.type] : null,
            rootObj: info.rootObj,
          };
        }
        // Equipment / furnishing / decoration all route through the same
        // unified subgridOccupied probe, using the hit mesh's world
        // position as the probe point.
        if (info.group === 'equipment' || info.group === 'decoration') {
          const p = info.rootObj.position;
          const entry = this._placeableAtWorldPos(p.x, p.z);
          if (entry && scope.has(entry.kind)) {
            return {
              kind: entry.kind,
              entry,
              placeable: PLACEABLES[entry.type],
              rootObj: info.rootObj,
            };
          }
        }
      }
    }

    // --- 2. Fallback: probe the subgrid cell under the cursor ---
    // Used when the raycast missed the mesh (e.g. hovering over a hollow
    // region of a multi-tile beamline module that's on legs). Resolve the
    // rootObj from the component builder so the outline can still render.
    if (grid && grid.col !== undefined && grid.row !== undefined) {
      const tilePos = gridToIso(grid.col, grid.row);
      const sub = isoToSubGrid(world.x - tilePos.x, world.y - tilePos.y);
      const sc = Math.floor(sub.subCol);
      const sr = Math.floor(sub.subRow);
      if (sc >= 0 && sc < 4 && sr >= 0 && sr < 4) {
        const k = grid.col + ',' + grid.row + ',' + sc + ',' + sr;
        const occ = this.game.state.subgridOccupied[k];
        if (occ && scope.has(occ.kind)) {
          const entry = this.game.getPlaceable(occ.id);
          if (entry) {
            const rootObj = this.renderer.componentBuilder?._meshMap?.get(entry.id) || null;
            return {
              kind: occ.kind,
              entry,
              placeable: PLACEABLES[entry.type],
              rootObj,
            };
          }
        }
      }
    }

    // --- 3. Tile-level fallback for beamline + infrastructure modules ---
    // If the cursor is over a major tile occupied by a beamline or infra
    // placeable (checked via p.cells, not just subgrid), highlight it. This
    // covers the case where a large module spans a tile the raycast/subgrid
    // probe didn't resolve (e.g. hollow leg regions not registered to subgrid).
    if (grid && grid.col !== undefined && grid.row !== undefined) {
      for (const p of this.game.state.placeables) {
        if (p.category !== 'beamline' && p.category !== 'infrastructure') continue;
        if (!scope.has(p.category)) continue;
        if (!p.cells) continue;
        if (p.cells.some(c => c.col === grid.col && c.row === grid.row)) {
          const rootObj = this.renderer.componentBuilder?._meshMap?.get(p.id) || null;
          return {
            kind: p.category,
            entry: p,
            placeable: PLACEABLES[p.type] || COMPONENTS[p.type],
            rootObj,
          };
        }
      }
    }

    // --- 4. Generous beam-pipe fallback ---
    // Beam pipes are long and narrow; if nothing else matched but the cursor
    // is close to a pipe segment, prefer that pipe. Only when 'beamline' is in scope.
    // world.x and world.y are isometric screen-space coords (pixels).
    if (scope.has('beamline') && world && typeof world.x === 'number') {
      const pipe = this._beamPipeNearWorldPos(world.x, world.y, 0.5);
      if (pipe) {
        return { kind: 'beampipe', pipeId: pipe.id, rootObj: null };
      }
    }

    return null;
  }

  /**
   * Generous beam-pipe hit test. Beam pipes are narrow, so the raycast may
   * miss them when the cursor is just to the side. Returns the first pipe
   * whose path has any segment within `pad` tile units of the cursor.
   *
   * @param {number} isoX  - isometric screen-space X (world.x)
   * @param {number} isoY  - isometric screen-space Y (world.y)
   * @param {number} pad   - perpendicular tolerance in tile units (default 0.5 = half tile)
   * @returns {object|null} the pipe entry, or null
   */
  _beamPipeNearWorldPos(isoX, isoY, pad = 0.5) {
    const pipes = this.game.state.beamPipes || [];
    // Convert isometric screen coords to fractional tile coords.
    const fc = isoToGridFloat(isoX, isoY);
    // isoToGridFloat returns col/row of the cursor in tile space.
    const cx = fc.col;
    const cz = fc.row;
    for (const pipe of pipes) {
      if (!pipe.path || pipe.path.length < 2) continue;
      for (let i = 0; i < pipe.path.length - 1; i++) {
        const a = pipe.path[i];
        const b = pipe.path[i + 1];
        // Segment endpoints in tile space (tile centers at col+0.5, row+0.5).
        const ax = a.col + 0.5, az = a.row + 0.5;
        const bx = b.col + 0.5, bz = b.row + 0.5;
        // Distance from cursor tile point to segment (a, b).
        const dx = bx - ax, dz = bz - az;
        const len2 = dx * dx + dz * dz;
        if (len2 === 0) continue;
        let t = ((cx - ax) * dx + (cz - az) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx, pz = az + t * dz;
        const ddx = cx - px, ddz = cz - pz;
        if (ddx * ddx + ddz * ddz <= pad * pad) {
          return pipe;
        }
      }
    }
    return null;
  }

  /**
   * Look up a placed instance whose footprint contains the given
   * world-space (x, z) point. Used by _findDeletablePlaceable to map a
   * raycast hit's rootObj.position back to the placeable that owns it.
   */
  _placeableAtWorldPos(worldX, worldZ) {
    const col = Math.floor(worldX / 2);
    const row = Math.floor(worldZ / 2);
    const subCol = Math.max(0, Math.min(3, Math.floor((worldX - col * 2) / 0.5)));
    const subRow = Math.max(0, Math.min(3, Math.floor((worldZ - row * 2) / 0.5)));
    const k = col + ',' + row + ',' + subCol + ',' + subRow;
    const occ = this.game.state.subgridOccupied[k];
    if (occ) return this.game.getPlaceable(occ.id);
    return null;
  }

  /**
   * Recompute the unified placeable ghost from the last known cursor
   * world position. Called from the mousemove handler and from the
   * rotation key so rotating refreshes the preview immediately.
   */
  _updatePlaceablePreview() {
    if (!this.selectedPlaceableId) {
      this.hoverPlaceable = null;
      return;
    }
    // Drawn connections (beam pipes) have their own preview system; skip the
    // full-tile ghost/grid overlay so hovering with the pipe tool stays clean.
    if (this.selectedTool && COMPONENTS[this.selectedTool]?.isDrawnConnection) {
      this.hoverPlaceable = null;
      return;
    }
    const placeable = PLACEABLES[this.selectedPlaceableId];
    if (!placeable) return;
    const wx = this.lastMouseWorldX ?? 0;
    const wy = this.lastMouseWorldY ?? 0;
    const snap = snapForPlaceable(wx, wy, placeable, this.placementDir);

    let placeY = 0;
    let stackTargetId = null;
    let ok = false;

    if (placeable.stackable) {
      const getEntry = (id) => {
        const idx = this.game.state.placeableIndex[id];
        return idx !== undefined ? this.game.state.placeables[idx] : null;
      };
      const getDef = (t) => PLACEABLES[t] || null;
      const st = findStackTarget(
        placeable, snap.col, snap.row, snap.subCol, snap.subRow, this.placementDir,
        this.game.state.subgridOccupied, getEntry, getDef,
      );
      if (st) {
        placeY = st.placeY;
        stackTargetId = st.targetEntry.id;
        ok = true;
      } else {
        const result = canPlace(
          this.game, placeable,
          snap.col, snap.row, snap.subCol, snap.subRow,
          this.placementDir,
        );
        ok = result.ok;
      }
    } else {
      const result = canPlace(
        this.game, placeable,
        snap.col, snap.row, snap.subCol, snap.subRow,
        this.placementDir,
      );
      ok = result.ok;
    }

    this.hoverPlaceable = {
      id: this.selectedPlaceableId,
      col: snap.col,
      row: snap.row,
      subCol: snap.subCol,
      subRow: snap.subRow,
      dir: this.placementDir,
      placeY,
      stackTargetId,
    };
    this.renderer.renderPlaceableGhost(this.hoverPlaceable, ok);
  }

  selectTool(compType, paramOverrides) {
    this.selectedInfraTool = null;
    this.bulldozerMode = false;
    this.selectedParamOverrides = paramOverrides || null;
    this.selectedNodeId = null;
    // Route through unified selection...
    this.selectPlaceable(compType);
    // ...but beam pipes (drawn connections) still run through the legacy
    // selectedTool path, so keep the legacy field set as a shadow copy.
    // Harmless for non-drawn tools since Task 12 removes these reads.
    this.selectedTool = compType;
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
    this.deselectRackTool();
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
    this.floorOrientationOverride = null;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
  }

  deselectInfraTool() {
    this.selectedInfraTool = null;
    this.floorOrientationOverride = null;
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
    this.deselectInfraTool();
    this.deselectConnTool();
    this.deselectRackTool();
    this.selectedNodeId = null;
    // Route through unified selection.
    this.selectPlaceable(compType);
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
    this.deselectRackTool();
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

  selectRackTool() {
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectFurnishingTool();
    this.deselectConnTool();
    this.bulldozerMode = false;
    this.renderer.setBulldozerMode(false);
    this.selectedRackTool = true;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
  }

  deselectRackTool() {
    this.selectedRackTool = false;
  }

  selectZoneTool(zoneType) {
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectFurnishingTool();
    this.deselectDecorationTool();
    this.deselectConnTool();
    this.deselectRackTool();
    this.demolishMode = false;
    this.selectedZoneTool = zoneType;
  }

  deselectZoneTool() {
    this.selectedZoneTool = null;
    this.renderer.clearDragPreview();
  }

  selectFurnishingTool(furnType) {
    this.deselectInfraTool();
    this.deselectConnTool();
    this.deselectRackTool();
    this.deselectZoneTool();
    this.demolishMode = false;
    // Route through unified selection.
    this.selectPlaceable(furnType);
  }

  deselectFurnishingTool() {
    this.selectedFurnishingTool = null;
    this.furnishingRotated = false;
  }

  selectDecorationTool(decType) {
    this.deselectInfraTool();
    this.deselectConnTool();
    this.deselectRackTool();
    this.deselectZoneTool();
    this.demolishMode = false;
    // Route through unified selection.
    this.selectPlaceable(decType);
  }

  deselectDecorationTool() {
    this.selectedDecorationTool = null;
  }

  selectWallTool(wallType, variant = 0) {
    this.deselectInfraTool();
    this.selectedDoorTool = null;
    this.selectedWallTool = wallType;
    this.selectedWallVariant = variant;
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
    this.deselectRackTool();
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
    // Remove rack segment (and its utilities)
    this.game.removeRackSegment(col, row);
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
    this.deselectRackTool();
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
    // If still carrying a lifted placeable, restore it to its origin.
    // Beamline components are never lifted (they stay in place during move),
    // so there's nothing to restore for the 'component' kind.
    if (this._movePayload && this._movePayload.kind === 'placeable') {
      const p = this._movePayload;
      this.game.placePlaceable({
        type: p.type,
        col: p.originCol, row: p.originRow,
        subCol: p.originSubCol, subRow: p.originSubRow,
        dir: p.originDir,
        params: p.params,
        free: true,
        silent: true,
      });
    }
    this.moveMode = false;
    this._movePayload = null;
    this.selectPlaceable(null);
    this.renderer.canvas.style.cursor = '';
    this.renderer._clearPreview();
    this._showToast('Move mode off');
  }

  // Arms the unified placeable preview with a carried item so mousemove
  // renders the rotated ghost + validity coloring automatically.
  _armMovePreview(type, dir) {
    this.selectPlaceable(type);
    this.placementDir = dir || 0;
    this.renderer.updatePlacementDir?.(this.placementDir);
    this._updatePlaceablePreview();
  }

  _handleMoveClick(col, row, screenX, screenY) {
    if (this._movePayload) {
      // Carrying — try to drop. Stay in move mode on success so the user
      // can keep clicking to move more things.
      if (this._placeMovedObject(col, row)) {
        this._movePayload = null;
        this.selectPlaceable(null);
        this.renderer._clearPreview();
        this.renderer.canvas.style.cursor = 'grab';
      }
      return;
    }

    // Not carrying — try to pick up.
    const picked = this._pickUpAt(col, row, screenX, screenY);
    if (picked) {
      this._movePayload = picked;
      this._armMovePreview(picked.type, picked.dir);
      this.renderer.canvas.style.cursor = 'grabbing';
    }
  }

  _pickUpAt(col, row, screenX, screenY) {
    // Beamline component (not lifted — moved on placement so attached beam
    // pipes get fixed up by moveComponent).
    const node = this._getNodeAtGrid(col, row);
    if (node) {
      const comp = COMPONENTS[node.type];
      this._showToast(`Moving ${comp ? comp.name : node.type}`);
      return {
        kind: 'component',
        nodeId: node.id,
        type: node.type,
        dir: node.dir || 0,
        originCol: node.col,
        originRow: node.row,
      };
    }

    // Unified placeables (equipment, furnishing, decoration, infrastructure).
    // Use the 3D raycast when available so the hit matches what the user
    // sees; fall back to subgrid lookup at the cursor tile center.
    let hitEntry = null;
    const world = this.renderer.screenToWorld
      ? this.renderer.screenToWorld(screenX, screenY)
      : null;
    if (world && typeof this._placeableAtWorldPos === 'function') {
      hitEntry = this._placeableAtWorldPos(world.x, world.y);
    }
    if (!hitEntry) {
      // Fallback: scan a few subtile cells at the clicked tile center.
      for (let sr = 0; sr < 4 && !hitEntry; sr++) {
        for (let sc = 0; sc < 4 && !hitEntry; sc++) {
          const k = col + ',' + row + ',' + sc + ',' + sr;
          const occ = this.game.state.subgridOccupied[k];
          if (occ) hitEntry = this.game.getPlaceable(occ.id);
        }
      }
    }
    if (hitEntry && hitEntry.kind !== 'beamline') {
      this.game._pushUndo();
      const snap = this.game.liftPlaceable(hitEntry.id);
      if (!snap) return null;
      const def = PLACEABLES[snap.type];
      this._showToast(`Moving ${def?.name || snap.type}`);
      return {
        kind: 'placeable',
        type: snap.type,
        params: snap.params,
        originCol: snap.col,
        originRow: snap.row,
        originSubCol: snap.subCol,
        originSubRow: snap.subRow,
        originDir: snap.dir,
        dir: snap.dir,
      };
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
      return this.game.moveComponent(p.nodeId, col, row, this.placementDir);
    }

    if (p.kind === 'placeable') {
      // Drive target snap from the unified preview. `hoverPlaceable` is
      // kept in sync by `_updatePlaceablePreview` on every mousemove and
      // on rotation, so it already reflects the current cursor + dir.
      const hp = this.hoverPlaceable;
      if (!hp) return false;
      const placedId = this.game.placePlaceable({
        type: p.type,
        col: hp.col,
        row: hp.row,
        subCol: hp.subCol,
        subRow: hp.subRow,
        dir: hp.dir ?? this.placementDir ?? 0,
        params: p.params,
        free: true,
        silent: true,
      });
      return placedId !== false;
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
    // Pick demolish type based on active tool context.
    // Standalone modes (wall/door/floor/zone/utility) get their own scope.
    // Everything else falls into two tiers: beamline mode → demolishBeamline,
    // all other placeable modes → demolishEquipment.
    let demolishType;
    const cat = this.selectedCategory;
    const catDef = MODES[this.activeMode]?.categories?.[cat];
    if (this.selectedWallTool || catDef?.isWallTab || cat === 'walls' || cat === 'hedges' || cat === 'fencing') {
      demolishType = 'demolishWall';
    } else if (this.selectedDoorTool || cat === 'doors') {
      demolishType = 'demolishDoor';
    } else if (this.selectedInfraTool || cat === 'flooring' || catDef?.isSurfaceTab) {
      demolishType = 'demolishFloor';
    } else if (this.selectedZoneTool) {
      demolishType = 'demolishZone';
    } else if (this.selectedConnTool) {
      demolishType = 'demolishUtility';
    } else if (this.activeMode === 'beamline') {
      demolishType = 'demolishBeamline';
    } else {
      demolishType = 'demolishEquipment';
    }

    // Activate demolish in-place without changing mode/menu
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectFurnishingTool();
    this.deselectDecorationTool();
    this.deselectConnTool();
    this.deselectRackTool();
    this.deselectZoneTool();
    this.bulldozerMode = false;
    this.renderer.setBulldozerMode(false);
    this.selectDemolishTool(demolishType);
    const names = { demolishBeamline: 'Remove Beamline', demolishEquipment: 'Remove Equipment', demolishWall: 'Remove Walls', demolishDoor: 'Remove Doors', demolishFloor: 'Remove Floors', demolishZone: 'Remove Zones', demolishUtility: 'Remove Utilities', demolishAll: 'Clear Everything' };
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
    this.deselectRackTool();
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
    this.deselectRackTool();
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
      this.deselectRackTool();
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
        ['Cost', `$${typeof wt.cost === 'object' ? wt.cost.funding : wt.cost}/segment`],
        ['Placement', 'Drag along edges'],
      ]);
      return;
    }

    if (this.selectedCategory === 'doors') {
      const dt = DOOR_TYPES[key];
      if (!dt) { this._hidePreview(); return; }
      this._renderPreview(dt.name, dt.desc || '', [
        ['Cost', `$${typeof dt.cost === 'object' ? dt.cost.funding : dt.cost}/segment`],
        ['Placement', 'Drag along edges'],
      ]);
      return;
    }

    if (this.selectedCategory === 'flooring' || this.selectedCategory === 'infrastructure') {
      const infra = FLOORS[key];
      if (!infra) { this._hidePreview(); return; }
      this._renderPreview(infra.name, infra.desc || '', [
        ['Cost', `$${typeof infra.cost === 'object' ? infra.cost.funding : infra.cost}/tile`],
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
          ['Requires', FLOORS[zone.requiredFloor]?.name || zone.requiredFloor],
          ['Placement', 'Drag area'],
        ]);
      } else {
        const furn = ZONE_FURNISHINGS[key];
        if (!furn) { this._hidePreview(); return; }
        this._renderPreview(furn.name, '', [
          ['Cost', `$${typeof furn.cost === 'object' ? furn.cost.funding : furn.cost}`],
          ['Zone', ZONES[furn.zoneType]?.name || furn.zoneType],
        ]);
      }
      return;
    }

    // Demolish tools
    if (this.selectedCategory === 'demolish') {
      const names = { demolishBeamline: 'Remove Beamline', demolishEquipment: 'Remove Equipment', demolishUtility: 'Remove Utilities', demolishZone: 'Remove Zone', demolishFloor: 'Remove Floor', demolishWall: 'Remove Walls', demolishDoor: 'Remove Doors', demolishAll: 'Clear Everything' };
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
      return ['demolishBeamline', 'demolishEquipment', 'demolishUtility', 'demolishZone', 'demolishFloor', 'demolishWall', 'demolishDoor', 'demolishAll'];
    }
    if (category === 'infrastructure') {
      return Object.keys(FLOORS);
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
