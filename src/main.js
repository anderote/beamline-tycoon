// src/main.js — Beamline Tycoon entry point

import { BeamlineRegistry } from './beamline/BeamlineRegistry.js';
import { BeamPhysics } from './beamline/physics.js';
import { PARAM_DEFS } from './beamline/component-physics.js';
import { Game } from './game/Game.js';
import { SpriteManager } from './renderer/sprites.js';
import { Renderer } from './renderer/Renderer.js';
// Renderer prototype extensions — must import AFTER Renderer.js to avoid circular TDZ
import './renderer/beamline-renderer.js';
import './renderer/infrastructure-renderer.js';
import './renderer/grass-renderer.js';
import './renderer/decoration-renderer.js';
import './renderer/hud.js';
import './renderer/overlays.js';
import { InputHandler } from './input/InputHandler.js';
import { BeamlineDesigner } from './ui/BeamlineDesigner.js';
import { DesignLibrary } from './ui/DesignLibrary.js';
import { DesignPlacer } from './ui/DesignPlacer.js';
import './renderer/designer-renderer.js';
import { ProbeWindow } from './ui/probe.js';
import { ViewRouter } from './ui/ViewRouter.js';
import { MODES } from './data/modes.js';
import { COMPONENTS } from './data/components.js';
import { MACHINES } from './data/machines.js';
import { Networks } from './networks/networks.js';

// Some code may still reference these as globals (Pyodide bridge, etc.)
// Expose them on window during transition
window.COMPONENTS = COMPONENTS;
window.PARAM_DEFS = PARAM_DEFS;
window.MACHINES = MACHINES;
window.Networks = Networks;

// Clear old saves from the grid-based version
const oldSave = localStorage.getItem('beamlineCowboy');
if (oldSave) localStorage.removeItem('beamlineCowboy');

(async function main() {
  const registry = new BeamlineRegistry();
  const game = new Game(registry);
  const router = new ViewRouter();
  const spriteManager = new SpriteManager();

  const renderer = new Renderer(game, spriteManager);
  await renderer.init();

  await spriteManager.loadTileSprites();
  await spriteManager.loadDecorationSprites();
  // Force re-render now that textures are loaded (initial render used fallbacks)
  renderer._grassCacheKey = null;
  renderer._renderGrass();
  renderer._renderDecorations();
  renderer._renderInfrastructure();
  renderer._renderZones();

  const input = new InputHandler(renderer, game);
  const designer = new BeamlineDesigner(game, renderer);
  game._designer = designer;
  const designLibrary = new DesignLibrary(game, designer, renderer);
  const designPlacer = new DesignPlacer(game, renderer);
  game._designPlacer = designPlacer;

  // Wire "Place" from design library
  designLibrary.onPlace = (design) => {
    designPlacer.start(design);
    game.log('Click to place design. F=rotate, R=reflect, Esc=cancel', 'info');
  };

  renderer._onToolSelect = (compType) => {
    if (designer.handlePaletteClick(compType)) return;
    // Pass any param overrides from the palette flyout
    const overrides = renderer._selectedParamOverrides?.[compType];
    input.selectTool(compType, overrides);
  };
  renderer._onInfraSelect = (infraType, variant) => input.selectInfraTool(infraType, variant);
  renderer._onFacilitySelect = (compType) => input.selectFacilityTool(compType);
  renderer._onConnSelect = (connType) => input.selectConnTool(connType);
  renderer._onZoneSelect = (zoneType) => input.selectZoneTool(zoneType);
  renderer._onFurnishingSelect = (furnType) => input.selectFurnishingTool(furnType);
  renderer._onDecorationSelect = (decType) => input.selectDecorationTool(decType);
  renderer._onDemolishSelect = (demolishType) => input.selectDemolishTool(demolishType);
  renderer._onPaletteClick = (idx) => input._syncPaletteClick(idx);
  renderer._onTabSelect = (category) => { input.selectedCategory = category; input.paletteIndex = -1; input._hidePreview(); };

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (MODES[mode]?.disabled) return;
      input.setActiveMode(mode);
    });
  });

  const probeWindow = new ProbeWindow(game);
  renderer.onProbeClick = (node) => probeWindow.addPin(node);

  const origSave = game.save.bind(game);
  game.save = function() {
    this.state.probe = probeWindow.toJSON();
    this.state.view = {
      zoom: renderer.zoom,
      worldX: renderer.world.x,
      worldY: renderer.world.y,
    };
    this.state.designerState = designer.serializeState();
    origSave();
  };

  game.on((event) => {
    if (event === 'beamlineChanged') {
      renderer._renderProbeFlags(probeWindow.pins);
    }
  });

  game.load();

  if (game.state.view) {
    renderer.zoom = game.state.view.zoom;
    renderer.world.x = game.state.view.worldX;
    renderer.world.y = game.state.view.worldY;
    renderer.world.scale.set(renderer.zoom);
  }

  if (game.state.probe) {
    probeWindow.fromJSON(game.state.probe);
  }

  // Restore designer state if it was open
  if (game.state.designerState && game.state.designerState.isOpen) {
    designer.restoreState(game.state.designerState);
  }

  // View routing
  router.on((view, params) => {
    if (view === 'designer') {
      if (designLibrary.isOpen) {
        designLibrary._suppressHashUpdate = true;
        designLibrary.close();
      }
      if (params.edit) {
        const blId = parseInt(params.edit, 10);
        if (!designer.isOpen || designer.beamlineId !== blId) {
          designer.open(blId);
        }
      } else if (params.design) {
        const designId = parseInt(params.design, 10);
        const design = game.getDesign(designId);
        if (design && (!designer.isOpen || designer.designId !== designId)) {
          designer.openDesign(design);
        }
      } else {
        if (!designer.isOpen) designer.openDesign(null);
      }
    } else if (view === 'designs') {
      if (designer.isOpen) {
        designer._suppressHashUpdate = true;
        designer._cleanup();
      }
      if (!designLibrary.isOpen) designLibrary.open();
    } else {
      // #game or default
      if (designer.isOpen) {
        designer._suppressHashUpdate = true;
        designer._cleanup();
      }
      if (designLibrary.isOpen) {
        designLibrary._suppressHashUpdate = true;
        designLibrary.close();
      }
    }
  });

  // Beamline Designer button — opens blank designer
  document.getElementById('btn-designer').addEventListener('click', () => {
    router.navigate('designer');
  });

  // Designs button — opens library
  document.getElementById('btn-designs').addEventListener('click', () => {
    router.navigate('designs');
  });

  // Menu dropdown toggle
  const menuBtn = document.getElementById('btn-menu');
  const menuDropdown = document.getElementById('menu-dropdown');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle('hidden');
  });
  document.addEventListener('click', () => menuDropdown.classList.add('hidden'));
  menuDropdown.addEventListener('click', (e) => {
    const action = e.target.dataset?.action;
    if (!action) return;
    menuDropdown.classList.add('hidden');
    switch (action) {
      case 'new-game':
        if (confirm('Start a new game? All progress will be lost.')) {
          localStorage.removeItem('beamlineTycoon');
          location.reload();
        }
        break;
      case 'save-game':
        game.save();
        game.log('Game saved.', 'good');
        break;
      case 'load-game':
        game.log('Load game — coming soon.', 'info');
        break;
      case 'scenarios':
        game.log('Scenarios — coming soon.', 'info');
        break;
      case 'options':
        game.log('Options — coming soon.', 'info');
        break;
      case 'guide':
        game.log('Guide — coming soon.', 'info');
        break;
    }
  });

  router.init();
  game.start();

  BeamPhysics.init().then(() => {
    game.log('Beam physics engine loaded.', 'good');
    game.recalcAllBeamlines();
    game.emit('beamlineChanged');
  }).catch(err => {
    game.log('Physics engine failed to load — using simplified model.', 'bad');
    console.error('BeamPhysics init error:', err);
  });
})();
