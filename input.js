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
    this._bindKeyboard();
    this._bindMouse();
  }

  // --- Keyboard bindings ---

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Skip if focused on text input
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.key) {
        case 'w': case 'W': case 'ArrowUp':
          this.renderer.panBy(0, -40);
          break;
        case 's': case 'S': case 'ArrowDown':
          this.renderer.panBy(0, 40);
          break;
        case 'a': case 'A': case 'ArrowLeft':
          this.renderer.panBy(-40, 0);
          break;
        case 'd': case 'D': case 'ArrowRight':
          this.renderer.panBy(40, 0);
          break;
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
          this.selectedNodeId = null;
          this.renderer.hidePopup();
          break;
        case 'Tab': {
          e.preventDefault();
          const catKeys = Object.keys(CATEGORIES);
          const tabs = document.querySelectorAll('.cat-tab');
          // Map tab data-category to CATEGORIES keys
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
          if (this.selectedNodeId) {
            this.game.removeComponent(this.selectedNodeId);
            this.selectedNodeId = null;
            this.renderer.hidePopup();
          }
          break;
      }
    });
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
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.panStart.x;
        const dy = e.clientY - this.panStart.y;
        this.renderer.world.x = this.worldStart.x + dx;
        this.renderer.world.y = this.worldStart.y + dy;
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

      if (e.button === 0) {
        // Left click
        this._handleClick(e.clientX, e.clientY);
      } else if (e.button === 2) {
        // Right click — remove selected component or deselect tool
        if (this.selectedNodeId) {
          this.game.removeComponent(this.selectedNodeId);
          this.selectedNodeId = null;
          this.renderer.hidePopup();
        } else if (this.selectedTool) {
          this.deselectTool();
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
        this.selectedNodeId = null;
        this.renderer.hidePopup();
      }
    }
  }

  // --- Tool selection ---

  selectTool(compType) {
    this.selectedTool = compType;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
    this.renderer.setBuildMode(true);
  }

  deselectTool() {
    this.selectedTool = null;
    this.renderer.setBuildMode(false);
  }
}
