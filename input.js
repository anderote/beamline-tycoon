// === BEAMLINE TYCOON: INPUT HANDLER ===

class InputHandler {
  constructor(renderer, game) {
    this.renderer = renderer;
    this.game = game;
    this.selectedTool = null;       // component type string or null
    this.selectedCategory = 'sources';
    this.dipoleBendDir = 'right';
    this.selectedNodeId = null;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.worldStart = { x: 0, y: 0 };
    // Infrastructure placement
    this.selectedInfraTool = null;  // infrastructure type or null
    this.isDragging = false;
    this.dragStart = null;          // { col, row }
    this.dragEnd = null;            // { col, row }
    this.activeMode = 'beamline';
    this.selectedFacilityTool = null;
    this.selectedConnTool = null;
    this.isDrawingConn = false;
    this.connPath = [];
    // Continuous panning
    this.keysDown = new Set();
    // Bulldozer mode
    this.bulldozerMode = false;
    this._bindKeyboard();
    this._bindMouse();
    this._startPanLoop();
  }

  // --- Keyboard bindings ---

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Skip if focused on text input
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Track pan keys for continuous movement
      const panKeys = ['w','W','ArrowUp','s','S','ArrowDown','a','A','ArrowLeft','d','D','ArrowRight'];
      if (panKeys.includes(e.key)) {
        this.keysDown.add(e.key);
        e.preventDefault();
        return;
      }

      switch (e.key) {
        case ' ':
          this.game.toggleBeam();
          e.preventDefault();
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
          // Close all overlays
          document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
          this.deselectTool();
          this.deselectInfraTool();
          this.deselectFacilityTool();
          this.deselectConnTool();
          this.bulldozerMode = false;
          this.renderer.setBulldozerMode(false);
          this.selectedNodeId = null;
          this.renderer.hidePopup();
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
          break;
        }
        case 'f': case 'F':
          this.dipoleBendDir = this.dipoleBendDir === 'right' ? 'left' : 'right';
          this.renderer.updateCursorBendDir(this.dipoleBendDir);
          break;
        case 'Delete': case 'Backspace':
          if (this.selectedTool || this.buildMode) {
            // In build mode: remove the most recently placed component
            const nodes = this.game.beamline.getAllNodes();
            if (nodes.length > 0) {
              const last = nodes[nodes.length - 1];
              this.game.removeComponent(last.id);
            }
          } else if (this.selectedNodeId) {
            this.game.removeComponent(this.selectedNodeId);
            this.selectedNodeId = null;
            this.renderer.hidePopup();
          } else {
            // Toggle bulldozer mode
            this.bulldozerMode = !this.bulldozerMode;
            this.deselectTool();
            this.deselectInfraTool();
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
      if (this.keysDown.has('w') || this.keysDown.has('W') || this.keysDown.has('ArrowUp')) dy -= PAN_SPEED;
      if (this.keysDown.has('s') || this.keysDown.has('S') || this.keysDown.has('ArrowDown')) dy += PAN_SPEED;
      if (this.keysDown.has('a') || this.keysDown.has('A') || this.keysDown.has('ArrowLeft')) dx -= PAN_SPEED;
      if (this.keysDown.has('d') || this.keysDown.has('D') || this.keysDown.has('ArrowRight')) dx += PAN_SPEED;
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

      // Connection drawing start
      if (e.button === 0 && this.selectedConnTool) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        this.isDrawingConn = true;
        this.connPath = [{ col: grid.col, row: grid.row }];
        this.game.placeConnection(grid.col, grid.row, this.selectedConnTool);
        return;
      }

      // Infrastructure drag start
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
        this.renderer.renderDragPreview(
          this.dragStart.col, this.dragStart.row,
          grid.col, grid.row, this.selectedInfraTool
        );
      } else if (this.isDrawingConn && this.selectedConnTool) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        const last = this.connPath[this.connPath.length - 1];
        if (grid.col !== last.col || grid.row !== last.row) {
          this.connPath.push({ col: grid.col, row: grid.row });
          this.game.placeConnection(grid.col, grid.row, this.selectedConnTool);
        }
      } else {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        this.renderer.updateHover(grid.col, grid.row);
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (this.isPanning) {
        this.isPanning = false;
        canvas.style.cursor = '';
        return;
      }

      // Connection drawing end
      if (this.isDrawingConn) {
        this.isDrawingConn = false;
        this.connPath = [];
        return;
      }

      // Infrastructure drag end
      if (this.isDragging && this.dragStart && this.dragEnd) {
        this.game.placeInfraRect(
          this.dragStart.col, this.dragStart.row,
          this.dragEnd.col, this.dragEnd.row,
          this.selectedInfraTool
        );
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
        } else if (this.selectedConnTool) {
          this.deselectConnTool();
        } else {
          // Right-click on the grid: check if clicking on a beamline component
          const world = this.renderer.screenToWorld(e.clientX, e.clientY);
          const grid = isoToGrid(world.x, world.y);
          const node = this.game.beamline.getNodeAt(grid.col, grid.row);
          if (node || this.game.beamline.getAllNodes().length > 0) {
            // Enter build mode — activate Sources tab and build mode
            this.selectedTool = 'source'; // default tool, user can pick another
            this.renderer.setBuildMode(true, 'source');
            // Activate the Sources tab visually
            const tabs = document.querySelectorAll('.cat-tab');
            tabs.forEach(t => t.classList.remove('active'));
            const srcTab = document.querySelector('.cat-tab[data-category="sources"]');
            if (srcTab) srcTab.classList.add('active');
            this.renderer.updatePalette('sources');
          }
        }
      }
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  // --- Click handling ---

  _handleClick(screenX, screenY) {
    const world = this.renderer.screenToWorld(screenX, screenY);
    const grid = isoToGrid(world.x, world.y);
    const col = grid.col;
    const row = grid.row;

    if (this.bulldozerMode) {
      // Bulldozer: remove whatever is at the clicked tile
      const node = this.game.beamline.getNodeAt(col, row);
      if (node) {
        this.game.removeComponent(node.id);
      }
      // Also remove infrastructure
      const infraKey = col + ',' + row;
      if (this.game.state.infraOccupied[infraKey]) {
        const idx = this.game.state.infrastructure.findIndex(t => t.col === col && t.row === row);
        if (idx !== -1) {
          this.game.state.infrastructure.splice(idx, 1);
          delete this.game.state.infraOccupied[infraKey];
          this.game.emit('infrastructureChanged');
        }
      }
      return;
    }

    if (this.selectedInfraTool) {
      // Infrastructure placement (single tile for non-drag items like path)
      const infra = INFRASTRUCTURE[this.selectedInfraTool];
      if (infra && !infra.isDragPlacement) {
        if (this.game.placeInfraTile(col, row, this.selectedInfraTool)) {
          this.game.emit('infrastructureChanged');
        }
      }
      return;
    }

    // Facility equipment placement
    if (this.selectedFacilityTool) {
      this.game.placeFacilityEquipment(col, row, this.selectedFacilityTool);
      return;
    }

    if (this.selectedTool) {
      // Placement mode
      const nodes = this.game.beamline.getAllNodes();
      if (nodes.length === 0 && this.selectedTool === 'source') {
        // Place first source
        this.game.placeSource(col, row, DIR.NE);
      } else {
        // Find matching cursor
        const cursors = this.game.beamline.getBuildCursors();
        const cursor = cursors.find(c => c.col === col && c.row === row);
        if (cursor) {
          this.game.placeComponent(cursor, this.selectedTool, this.dipoleBendDir);
        }
      }
    } else {
      // Selection mode
      const node = this.game.beamline.getNodeAt(col, row);
      if (node) {
        this.selectedNodeId = node.id;
        this.renderer.showPopup(node, screenX, screenY);
      } else {
        // Check for facility equipment click
        const facKey = col + ',' + row;
        const facId = this.game.state.facilityGrid[facKey];
        if (facId) {
          const equip = this.game.state.facilityEquipment.find(e => e.id === facId);
          if (equip) {
            const comp = COMPONENTS[equip.type];
            if (comp) {
              this.renderer.showFacilityPopup(equip, comp, screenX, screenY);
              return;
            }
          }
        }
        this.selectedNodeId = null;
        this.renderer.hidePopup();
      }
    }
  }

  // --- Tool selection ---

  selectTool(compType) {
    this.selectedInfraTool = null;
    this.selectedTool = compType;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
    this.renderer.setBuildMode(true, compType);

    // Auto-place at the first available build cursor
    const nodes = this.game.beamline.getAllNodes();
    if (nodes.length > 0) {
      const cursors = this.game.beamline.getBuildCursors();
      if (cursors.length > 0) {
        this.game.placeComponent(cursors[0], compType, this.dipoleBendDir);
      }
    }
  }

  deselectTool() {
    this.selectedTool = null;
    this.renderer.setBuildMode(false);
  }

  selectInfraTool(infraType) {
    this.selectedTool = null;
    this.renderer.setBuildMode(false);
    this.selectedInfraTool = infraType;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
  }

  deselectInfraTool() {
    this.selectedInfraTool = null;
    this.isDragging = false;
    this.dragStart = null;
    this.dragEnd = null;
    this.renderer.clearDragPreview();
  }

  selectFacilityTool(compType) {
    this.deselectTool();
    this.deselectInfraTool();
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
    this.selectedConnTool = connType;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
  }

  deselectConnTool() {
    this.selectedConnTool = null;
    this.isDrawingConn = false;
    this.connPath = [];
  }

  setActiveMode(mode) {
    this.activeMode = mode;
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectConnTool();
    // Reset selected category to first in new mode
    const modeData = MODES[mode];
    if (modeData && !modeData.disabled) {
      const catKeys = Object.keys(modeData.categories);
      this.selectedCategory = catKeys[0] || '';
    }
    this.renderer.activeMode = mode;
  }
}
