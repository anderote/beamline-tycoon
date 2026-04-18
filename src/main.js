// src/main.js — Beamline Tycoon entry point

import { BeamlineRegistry } from './beamline/BeamlineRegistry.js';
import { BeamPhysics } from './beamline/physics.js';
import { PARAM_DEFS } from './beamline/component-physics.js';
import { Game } from './game/Game.js';
import { SpriteManager } from './renderer/sprites.js';
// designer-renderer attaches methods to BeamlineDesigner.prototype.
import './renderer/designer-renderer.js';
// ThreeRenderer transitively loads UIHost + hud.js + overlays.js, which
// attach DOM-side UI methods to UIHost.prototype.
import { ThreeRenderer } from './renderer3d/ThreeRenderer.js';
import { InputHandler } from './input/InputHandler.js';
import { BeamlineDesigner } from './ui/BeamlineDesigner.js';
import { DesignLibrary } from './ui/DesignLibrary.js';
import { DesignPlacer } from './ui/DesignPlacer.js';
import { ProbeWindow } from './ui/probe.js';
import { ViewRouter } from './ui/ViewRouter.js';
import { MODES } from './data/modes.js';
import { COMPONENTS } from './data/components.js';
import { MACHINES } from './data/machines.js';
import { Networks } from './networks/networks.js';
import { SCENARIOS } from './data/scenarios.js';
import { MusicPlayer } from './ui/MusicPlayer.js';
import { UtilityInspector } from './ui/UtilityInspector.js';
import { UtilityStatsPanel } from './ui/UtilityStatsPanel.js';
import { discoverNetworks, makeDefaultPortLookup } from './utility/network-discovery.js';

// Some code may still reference these as globals (Pyodide bridge, etc.)
// Expose them on window during transition
window.COMPONENTS = COMPONENTS;
window.PARAM_DEFS = PARAM_DEFS;
window.MACHINES = MACHINES;
window.Networks = Networks;

// Clear old saves from the grid-based version
const oldSave = localStorage.getItem('beamlineCowboy');
if (oldSave) localStorage.removeItem('beamlineCowboy');

function showScenarioPicker(game) {
  // Remove existing dialog if any
  const existing = document.getElementById('scenario-dialog');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'scenario-dialog';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';

  const panel = document.createElement('div');
  panel.style.cssText = 'background:#1a1a2e;border:1px solid #444;border-radius:8px;padding:24px;max-width:520px;width:90%;color:#ddd;font-family:monospace;';

  let html = '<h2 style="margin:0 0 16px;color:#fff;font-size:18px;">Scenarios</h2>';
  html += '<p style="margin:0 0 16px;color:#999;font-size:12px;">Start a new game with a pre-built scenario. Current progress will be lost.</p>';

  for (const sc of SCENARIOS) {
    html += `<div class="scenario-card" data-id="${sc.id}" style="border:1px solid #555;border-radius:6px;padding:12px;margin-bottom:10px;cursor:pointer;transition:border-color 0.15s;">`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;">`;
    html += `<strong style="color:#fff;font-size:14px;">${sc.name}</strong>`;
    html += `<span style="color:#888;font-size:11px;border:1px solid #555;padding:2px 6px;border-radius:3px;">${sc.difficulty}</span>`;
    html += `</div>`;
    html += `<p style="margin:6px 0 0;color:#aaa;font-size:12px;line-height:1.4;">${sc.desc}</p>`;
    html += `</div>`;
  }

  html += '<div style="text-align:right;margin-top:12px;"><button id="scenario-cancel" style="background:#333;color:#ddd;border:1px solid #555;padding:6px 16px;border-radius:4px;cursor:pointer;font-family:monospace;">Cancel</button></div>';

  panel.innerHTML = html;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Hover effect
  panel.querySelectorAll('.scenario-card').forEach(card => {
    card.addEventListener('mouseenter', () => card.style.borderColor = '#88f');
    card.addEventListener('mouseleave', () => card.style.borderColor = '#555');
  });

  // Card click
  panel.addEventListener('click', (e) => {
    const card = e.target.closest('.scenario-card');
    if (!card) return;
    const id = card.dataset.id;
    const scenario = SCENARIOS.find(s => s.id === id);
    if (!scenario) return;

    if (!confirm(`Start "${scenario.name}"? Current progress will be lost.`)) return;

    // Clear current save, set pending scenario, reload
    localStorage.removeItem('beamlineTycoon');
    if (scenario.generator) {
      localStorage.setItem('beamlineTycoon.pendingScenario', id);
    }
    location.reload();
  });

  // Cancel / overlay click
  document.getElementById('scenario-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

(async function main() {
  const registry = new BeamlineRegistry();
  const game = new Game(registry);
  const router = new ViewRouter();
  game.viewRouter = router;
  const spriteManager = new SpriteManager();

  const renderer = new ThreeRenderer(game, spriteManager);
  window._renderer = renderer;
  window.game = game;
  window.dev = {
    enable() { game.setDevMode(true); },
    disable() { game.setDevMode(false); },
    toggle() { game.setDevMode(!game.devMode); },
    get on() { return game.devMode; },
  };
  if (game.devMode) {
    // Apply the unlimited-funding boost immediately so the HUD reflects it
    // before the first tick. setDevMode also emits resourcesChanged.
    game.setDevMode(true);
  }
  await renderer.init();

  await spriteManager.loadTileSprites();
  await spriteManager.loadDecorationSprites();
  await spriteManager.loadSpriteOffsets();
  // Force re-render now that textures are loaded (initial render used fallbacks)
  renderer.refresh();

  const input = new InputHandler(renderer, game);
  renderer._inputHandler = input;
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
  renderer._onUtilityLineSelect = (utilityType) => input.setUtilityLineTool(utilityType);
  renderer._onRackSelect = () => input.selectRackTool();
  renderer._onZoneSelect = (zoneType) => input.selectZoneTool(zoneType);
  renderer._onWallSelect = (wallType, variant = 0) => input.selectWallTool(wallType, variant);
  renderer._onDoorSelect = (doorType, variant = 0) => input.selectDoorTool(doorType, variant);
  renderer._onFurnishingSelect = (furnType) => input.selectFurnishingTool(furnType);
  renderer._onDecorationSelect = (decType, variant = 0) => input.selectDecorationTool(decType, variant);
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
      panX: renderer._panX,
      panY: renderer._panY,
      viewRotationIndex: renderer._isoYawIdx,
      activeMode: input.activeMode,
      selectedCategory: input.selectedCategory,
      route: window.location.hash.slice(1) || 'game',
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

  // Apply pending scenario (set by scenario picker before reload)
  const pendingScenario = localStorage.getItem('beamlineTycoon.pendingScenario');
  if (pendingScenario) {
    localStorage.removeItem('beamlineTycoon.pendingScenario');
    const scenario = SCENARIOS.find(s => s.id === pendingScenario);
    if (scenario?.generator) {
      const mapData = scenario.generator();
      game.applyScenario(mapData);
      game.save();
      game.log(`Scenario "${scenario.name}" loaded.`, 'good');
    }
  }

  if (game.state.view) {
    renderer.zoom = game.state.view.zoom;
    if (typeof game.state.view.panX === 'number') {
      renderer._panX = game.state.view.panX;
      renderer._panY = game.state.view.panY;
      renderer._isoYawIdx = game.state.view.viewRotationIndex || 0;
      renderer._viewRotationAngle = renderer._isoYawIdx * Math.PI / 2;
    } else {
      // Legacy save: derive pan from the old world.x/y offset (rotation=0 math).
      const screenW = renderer.app.screen.width;
      const screenH = renderer.app.screen.height;
      const centerIsoX = (screenW / 2 - game.state.view.worldX) / renderer.zoom;
      const centerIsoY = (screenH / 2 - game.state.view.worldY) / renderer.zoom;
      const col = (centerIsoX / 32 + centerIsoY / 16) / 2;
      const row = (centerIsoY / 16 - centerIsoX / 32) / 2;
      renderer._panX = col * 2;
      renderer._panY = row * 2;
    }
    renderer._syncOverlayFromPan();
    renderer._updateCameraLookAt();
    // Restore active mode and selected category/tab
    if (game.state.view.activeMode && MODES[game.state.view.activeMode]) {
      // For facility mode, restore the Labs/Rooms group toggle before regenerating tabs
      if (game.state.view.activeMode === 'facility' && game.state.view.selectedCategory) {
        const restoredCat = MODES.facility.categories[game.state.view.selectedCategory];
        if (restoredCat?.group) renderer._facilityGroup = restoredCat.group;
      }
      input.setActiveMode(game.state.view.activeMode);
      if (game.state.view.selectedCategory) {
        input.selectedCategory = game.state.view.selectedCategory;
        renderer.updatePalette(game.state.view.selectedCategory);
        document.querySelectorAll('.cat-tab').forEach(t => {
          t.classList.toggle('active', t.dataset.category === game.state.view.selectedCategory);
        });
      }
    }
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
        const entry = game.registry.get(`bl-${blId}`);
        if (entry && entry.sourceId && (!designer.isOpen || designer.editSourceId !== entry.sourceId)) {
          designer.openFromSource(entry.sourceId);
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
        showScenarioPicker(game);
        break;
      case 'options':
        game.log('Options — coming soon.', 'info');
        break;
      case 'guide':
        game.log('Guide — coming soon.', 'info');
        break;
    }
  });

  // Music player
  const musicPlayer = new MusicPlayer();

  // Utility stats side panel — positioned just below the music player
  // (top:56px right:12px) so it sits in the same right-rail region.
  // Visible only in infra mode; mount/destroy driven by 'activeModeChanged'.
  const utilityStatsContainer = document.createElement('div');
  utilityStatsContainer.id = 'utility-stats-container';
  utilityStatsContainer.style.cssText = [
    'position:absolute',
    'top:108px',       // below music player (56 + ~44 height)
    'right:12px',
    'z-index:98',
    'pointer-events:auto',
    'display:none',
  ].join(';');
  document.body.appendChild(utilityStatsContainer);

  let utilityStatsPanel = null;
  const syncUtilityStatsPanel = (mode) => {
    if (mode === 'infra') {
      utilityStatsContainer.style.display = '';
      if (!utilityStatsPanel) {
        utilityStatsPanel = new UtilityStatsPanel(game, utilityStatsContainer);
      } else {
        utilityStatsPanel.render();
      }
    } else {
      utilityStatsContainer.style.display = 'none';
      if (utilityStatsPanel) {
        utilityStatsPanel.destroy();
        utilityStatsPanel = null;
      }
    }
  };
  game.on((event, data) => {
    if (event === 'activeModeChanged') {
      syncUtilityStatsPanel(data?.mode);
    }
  });
  // Initial sync — handles the restored-from-save case where setActiveMode
  // fired before this listener was registered.
  syncUtilityStatsPanel(input.activeMode);

  // Debug fallback: open a utility inspector for a given line id from the
  // browser console. Unblocks Phase 6 playtesting if the 3D click path
  // misbehaves. window.openUtilityInspector('line-abc123').
  window.openUtilityInspector = (lineId) => {
    const lines = game.state?.utilityLines;
    if (!lines || typeof lines.get !== 'function') { console.warn('no utilityLines'); return null; }
    const line = lines.get(lineId);
    if (!line) { console.warn('line not found', lineId); return null; }
    const lookup = makeDefaultPortLookup(game.state);
    const nets = discoverNetworks(line.utilityType, lines, lookup);
    const net = nets.find(n => (n.lineIds || []).includes(lineId));
    if (!net) { console.warn('network not found for line', lineId); return null; }
    return new UtilityInspector(game, line.utilityType, net.id);
  };

  router.init(game.state.view?.route);
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
