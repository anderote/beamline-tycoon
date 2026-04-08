import { COMPONENTS } from '../data/components.js';
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS } from '../data/infrastructure.js';
import { DECORATIONS } from '../data/decorations.js';
import { MODES } from '../data/modes.js';
import { DIR } from '../data/directions.js';
import { isoToGrid } from '../renderer/grid.js';
import { isFacilityCategory } from '../renderer/Renderer.js';
import { formatEnergy, UNITS } from '../data/units.js';

// === BEAMLINE TYCOON: INPUT HANDLER ===

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
    this.selectedDecorationTool = null; // decoration type or null
    this.selectedConnTool = null;
    this.isDrawingConn = false;
    this.connDrawMode = 'add';  // 'add' or 'remove'
    this.connPath = [];
    // Line placement (hallway)
    this.isDrawingLine = false;
    this.linePath = [];
    // Continuous panning
    this.keysDown = new Set();
    // Bulldozer mode
    this.bulldozerMode = false;
    // Probe placement mode
    this.probeMode = false;
    // Palette keyboard navigation
    this.paletteIndex = -1;  // -1 = no keyboard focus
    this._bindKeyboard();
    this._bindMouse();
    this._startPanLoop();
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

  // --- Keyboard bindings ---

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Skip if focused on text input
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Skip normal input handling when controller overlay is open
      if (this.game._designer && this.game._designer.isOpen) return;

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
          if (this.selectedTool) {
            // Place at cursor position
            const nodes = this._getActiveBeamlineNodes();
            if (nodes.length === 0) {
              const comp = COMPONENTS[this.selectedTool];
              if (comp && comp.isSource) {
                this.game.placeSource(this.renderer.hoverCol, this.renderer.hoverRow, this.placementDir, this.selectedTool, this.selectedParamOverrides);
              }
            } else {
              const cursors = this._getActiveBuildCursors();
              // If only one cursor, place there; otherwise place at hovered cursor
              const cursor = cursors.length === 1
                ? cursors[0]
                : cursors.find(c => c.col === this.renderer.hoverCol && c.row === this.renderer.hoverRow);
              if (cursor) {
                this.game.placeComponent(cursor, this.selectedTool, this.dipoleBendDir, this.selectedParamOverrides);
              }
            }
          } else if (this.selectedFacilityTool) {
            this.game.placeFacilityEquipment(this.renderer.hoverCol, this.renderer.hoverRow, this.selectedFacilityTool);
          } else if (this.selectedFurnishingTool) {
            this.game.placeZoneFurnishing(this.renderer.hoverCol, this.renderer.hoverRow, this.selectedFurnishingTool);
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
          // Also toggle dipole bend direction
          this.dipoleBendDir = this.dipoleBendDir === 'right' ? 'left' : 'right';
          this.renderer.updateCursorBendDir(this.dipoleBendDir);
          break;
        case 'c': case 'C':
          if (this.game._designer && !this.game._designer.isOpen) {
            const blId = this.game.selectedBeamlineId || this.game.editingBeamlineId;
            if (blId) {
              e.preventDefault();
              this.game._designer.open(blId);
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
        case 'Delete': case 'Backspace':
          if (this.selectedTool || this.buildMode) {
            // In build mode: remove the most recently placed component
            const nodes = this._getActiveBeamlineNodes();
            if (nodes.length > 0) {
              const last = nodes[nodes.length - 1];
              this.game.removeComponent(last.id);
            }
          } else if (this.selectedNodeId) {
            this.game.removeComponent(this.selectedNodeId);
            this.selectedNodeId = null;
            this.renderer.hidePopup();
          } else {
            // Nothing selected: toggle general bulldozer mode
            this.bulldozerMode = !this.bulldozerMode;
            this.deselectTool();
            this.deselectInfraTool();
            this.deselectFurnishingTool();
            this.renderer.setBulldozerMode(this.bulldozerMode);
          }
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

      // Demolish drag start
      if (e.button === 0 && this.demolishMode) {
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
      } else {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        this.renderer.updateHover(grid.col, grid.row);
        // Update design placer position
        if (this.game._designPlacer && this.game._designPlacer.active) {
          this.game._designPlacer.setPosition(grid.col, grid.row);
          this.renderer._renderCursors();
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

      // Connection drawing end — commit all tiles on release
      if (this.isDrawingConn) {
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
        for (const pt of this.linePath) {
          this.game.placeInfraTile(pt.col, pt.row, this.selectedInfraTool, this.selectedInfraVariant);
        }
        this.game.emit('infrastructureChanged');
        this.isDrawingLine = false;
        this.linePath = [];
        this.renderer.clearDragPreview();
        return;
      }

      // Infrastructure, zone, or demolish drag end
      if (this.isDragging && this.dragStart && this.dragEnd) {
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
                const fId = this.game.state.zoneFurnishingGrid[c + ',' + r];
                if (fId) this.game.removeZoneFurnishing(fId);
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
      const clickedNode = this._getNodeAtGrid(grid.col, grid.row);
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

    if (this.bulldozerMode) {
      if (this.bulldozerConnType) {
        // Pipe-specific bulldozer: only remove the selected connection type
        this.game.removeConnection(col, row, this.bulldozerConnType);
      } else {
        // General bulldozer: remove whatever is at the clicked tile
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
        if (this.game.state.decorationOccupied[key]) {
          this.game.removeDecoration(col, row);
        }
        // Remove zones
        if (this.game.state.zoneOccupied[key]) {
          this.game.removeZoneTile(col, row);
        }
        // Remove infrastructure (cascades to zones)
        if (this.game.state.infraOccupied[key]) {
          this.game.removeInfraTile(col, row);
        }
        // Remove zone furnishings
        const furnId = this.game.state.zoneFurnishingGrid[key];
        if (furnId) {
          this.game.removeZoneFurnishing(furnId);
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
        // Remove all connections at this tile
        const conns = this.game.getConnectionsAt(col, row);
        for (const connType of conns) {
          this.game.removeConnection(col, row, connType);
        }
      }
      return;
    }

    if (this.selectedInfraTool) {
      // Infrastructure placement (single tile for non-drag items like path)
      const infra = INFRASTRUCTURE[this.selectedInfraTool];
      if (infra && !infra.isDragPlacement && !infra.isLinePlacement) {
        if (this.game.placeInfraTile(col, row, this.selectedInfraTool, this.selectedInfraVariant)) {
          this.game.emit('infrastructureChanged');
        }
      }
      return;
    }

    // Zone placement (single tile click)
    if (this.selectedZoneTool) {
      if (this.game.placeZoneTile(col, row, this.selectedZoneTool)) {
        this.game.emit('zonesChanged');
      }
      return;
    }

    if (this.demolishMode) {
      const key = col + ',' + row;
      if (this.demolishType === 'demolishComponent') {
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
      } else if (this.demolishType === 'demolishConnection') {
        // Remove all connection types at this tile
        const conns = this.game.getConnectionsAt(col, row);
        for (const ct of [...conns]) {
          this.game.removeConnection(col, row, ct);
        }
      } else if (this.demolishType === 'demolishFurnishing') {
        const fId = this.game.state.zoneFurnishingGrid[key];
        if (fId) this.game.removeZoneFurnishing(fId);
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
      }
      return;
    }

    // Decoration placement
    if (this.selectedDecorationTool) {
      if (this.game.placeDecoration(col, row, this.selectedDecorationTool)) {
        this.game.emit('decorationsChanged');
      }
      return;
    }

    // Zone furnishing placement
    if (this.selectedFurnishingTool) {
      this.game.placeZoneFurnishing(col, row, this.selectedFurnishingTool);
      return;
    }

    // Facility equipment placement
    if (this.selectedFacilityTool) {
      this.game.placeFacilityEquipment(col, row, this.selectedFacilityTool);
      return;
    }

    if (this.selectedTool) {
      // Placement mode
      const nodes = this._getActiveBeamlineNodes();
      if (nodes.length === 0) {
        // Place first component (must be a source type)
        const comp = COMPONENTS[this.selectedTool];
        if (comp && comp.isSource) {
          this.game.placeSource(col, row, this.placementDir, this.selectedTool, this.selectedParamOverrides);
        }
      } else {
        // Find matching cursor
        const cursors = this._getActiveBuildCursors();
        const cursor = cursors.find(c => c.col === col && c.row === row);
        if (cursor) {
          this.game.placeComponent(cursor, this.selectedTool, this.dipoleBendDir, this.selectedParamOverrides);
        } else {
          // Clicked an existing component — open its beamline window
          const node = this._getNodeAtGrid(col, row);
          if (node) {
            this.selectedNodeId = node.id;
            const entry = this.game.registry.getBeamlineForNode(node.id);
            if (entry) {
              this.game.selectedBeamlineId = entry.id;
              this.renderer._openBeamlineWindow(entry.id);
              this.game.emit('beamlineSelected', entry.id);
            }
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
      const node = this._getNodeAtGrid(col, row);
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
              this.renderer.showFacilityPopup(equip, comp, screenX, screenY);
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
  }

  deselectDemolishTool() {
    this.demolishMode = false;
    this.demolishType = null;
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
      const catDef = MODES.structure?.categories?.[this.selectedCategory];
      if (catDef?.isZoneTab) {
        // First item is zone paint tool, rest are furnishings
        if (this.paletteIndex === 0) {
          this.selectZoneTool(compKey);
        } else {
          this.selectFurnishingTool(compKey);
        }
      } else if (this.selectedCategory === 'demolish') {
        this.selectDemolishTool(compKey);
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
    const zoneCatDef = MODES.structure?.categories?.[this.selectedCategory];
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
      const names = { demolishFloor: 'Remove Floor', demolishZone: 'Remove Zone', demolishFurnishing: 'Remove Furniture' };
      this._renderPreview(names[key] || 'Demolish', '', []);
      return;
    }

    const comp = COMPONENTS[key];
    if (!comp) { this._hidePreview(); return; }

    const costs = Object.entries(comp.cost).map(([r, a]) => `${a} ${r}`).join(', ');
    const statEntries = [
      ['Cost', costs],
      ['Energy Cost', `${comp.energyCost} kW`],
      ['Length', `${comp.length} m`],
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
    if (category === 'demolish') {
      return ['demolishFloor', 'demolishZone', 'demolishFurnishing'];
    }
    if (category === 'infrastructure') {
      return Object.keys(INFRASTRUCTURE);
    }
    // Zone tabs: first item is zone type, then furnishings
    const catDef = MODES.structure?.categories?.[category];
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
