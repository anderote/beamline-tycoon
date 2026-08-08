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
import { SCENARIOS } from './data/scenarios.js';
import { MusicPlayer } from './ui/MusicPlayer.js';
import { TitleScreen } from './ui/TitleScreen.js';
import { WelcomeDialog } from './ui/WelcomeDialog.js';
import { SaveLoadDialog } from './ui/SaveLoadDialog.js';
import { CloudSaves } from './game/CloudSaves.js';
import { OptionsDialog } from './ui/OptionsDialog.js';
import { UtilityInspector } from './ui/UtilityInspector.js';
import { UtilityStatsPanel } from './ui/UtilityStatsPanel.js';
import { discoverNetworks, makeDefaultPortLookup } from './utility/network-discovery.js';
import { wireUtility } from './data/scenarios/scenario-wiring.js';

// Some code may still reference these as globals (Pyodide bridge, etc.)
// Expose them on window during transition
window.COMPONENTS = COMPONENTS;
window.PARAM_DEFS = PARAM_DEFS;

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

    // Clear current save, set pending scenario, reload.
    // skipTitle makes the post-selection reload go straight into the game.
    localStorage.removeItem('beamlineTycoon');
    if (scenario.generator) {
      localStorage.setItem('beamlineTycoon.pendingScenario', id);
    }
    sessionStorage.setItem('beamlineTycoon.skipTitle', '1');
    location.reload();
  });

  // Cancel / overlay click
  document.getElementById('scenario-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

(async function main() {
  // Capture save existence BEFORE game.load()/start() can autosave.
  const hadSave = !!localStorage.getItem('beamlineTycoon');

  // Title screen — skipped on demo mode, after in-menu "New Game" /
  // scenario-picker reloads (skipTitle flag), or with a pending scenario.
  const bootParams = new URLSearchParams(location.search);
  const skipTitleFlag = !!sessionStorage.getItem('beamlineTycoon.skipTitle');
  if (skipTitleFlag) sessionStorage.removeItem('beamlineTycoon.skipTitle');
  const skipTitle = skipTitleFlag
    || bootParams.has('demo') || location.hash.includes('demo')
    || !!localStorage.getItem('beamlineTycoon.pendingScenario');
  const titleScreen = skipTitle ? null : new TitleScreen();

  const registry = new BeamlineRegistry();
  const game = new Game(registry);

  // Cloud-save detection (Deep Tech Week deployment). Non-blocking — local
  // dev has no API and stays in local mode. The Save/Load dialog reads
  // game.cloud each time it opens, so a late-arriving result still applies.
  game.cloud = { checked: false, available: false };
  CloudSaves.detect().then((r) => { game.cloud = { checked: true, ...r }; });
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
    if (designer.isOpen) {
      designer._suppressHashUpdate = true;
      designer._cleanup();
    }
    if (window.location.hash !== '#game') window.location.hash = 'game';
    designPlacer.start(design);
    game.log('Click to place design. F=rotate, R=reflect, Esc=cancel', 'info');
  };

  // Palette item clicks route straight from hud.js into
  // InputHandler.selectPaletteTool via each item's {kind, key} dataset —
  // no per-family renderer callback slots anymore.
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

  // Host-layer save sections (camera/UI mode, probe pins, designer session).
  // Registered before game.load() so their sections restore on boot; the
  // load callbacks only stash — the actual restore runs after load returns
  // (and after any pending scenario is applied) in the blocks below.
  let restoredView = null;
  let restoredProbe = null;
  game.registerSerializer('probe', {
    save: () => probeWindow.toJSON(),
    load: (data) => { restoredProbe = data; },
  });
  game.registerSerializer('view', {
    save: () => ({
      zoom: renderer.zoom,
      worldX: renderer.world.x,
      worldY: renderer.world.y,
      panX: renderer._panX,
      panY: renderer._panY,
      viewRotationIndex: renderer._isoYawIdx,
      activeMode: input.activeMode,
      selectedCategory: input.selectedCategory,
      route: window.location.hash.slice(1) || 'game',
    }),
    load: (data) => { restoredView = data; },
  });
  game.registerSerializer('designer', {
    save: () => designer.serializeState(),
    // designerState's runtime home stays on game.state (BeamlineDesigner and
    // InputHandler read it directly); only its persistence moved to aux.
    load: (data) => { game.state.designerState = data || null; },
  });

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
      // Dynamic scenario content (beamline, pipes, utility wiring) builds
      // through the normal Game APIs so it satisfies utility gating.
      if (scenario.setup) scenario.setup(game);
      game.save();
      game.log(`Scenario "${scenario.name}" loaded.`, 'good');
    }
  }

  if (restoredView) {
    renderer.zoom = restoredView.zoom;
    if (typeof restoredView.panX === 'number') {
      renderer._panX = restoredView.panX;
      renderer._panY = restoredView.panY;
      renderer._isoYawIdx = restoredView.viewRotationIndex || 0;
      renderer._viewRotationAngle = renderer._isoYawIdx * Math.PI / 2;
    } else {
      // Legacy save: derive pan from the old world.x/y offset (rotation=0 math).
      const screenW = renderer.app.screen.width;
      const screenH = renderer.app.screen.height;
      const centerIsoX = (screenW / 2 - restoredView.worldX) / renderer.zoom;
      const centerIsoY = (screenH / 2 - restoredView.worldY) / renderer.zoom;
      const col = (centerIsoX / 32 + centerIsoY / 16) / 2;
      const row = (centerIsoY / 16 - centerIsoX / 32) / 2;
      renderer._panX = col * 2;
      renderer._panY = row * 2;
    }
    renderer._syncOverlayFromPan();
    renderer._updateCameraLookAt();
    // Restore active mode and selected category/tab
    if (restoredView.activeMode && MODES[restoredView.activeMode]) {
      // For facility mode, restore the Labs/Rooms group toggle before regenerating tabs
      if (restoredView.activeMode === 'facility' && restoredView.selectedCategory) {
        const restoredCat = MODES.facility.categories[restoredView.selectedCategory];
        if (restoredCat?.group) renderer._facilityGroup = restoredCat.group;
      }
      input.setActiveMode(restoredView.activeMode);
      if (restoredView.selectedCategory) {
        input.selectedCategory = restoredView.selectedCategory;
        renderer.updatePalette(restoredView.selectedCategory);
        document.querySelectorAll('.cat-tab').forEach(t => {
          t.classList.toggle('active', t.dataset.category === restoredView.selectedCategory);
        });
      }
    }
  }

  if (restoredProbe) {
    probeWindow.fromJSON(restoredProbe);
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

  // Load Design button inside the designer — opens library as a modal on top
  document.getElementById('dsgn-load-design').addEventListener('click', () => {
    designLibrary.open(true);
  });

  // Welcome/goals dialog — auto-shown on fresh games (below), reopenable
  // anytime via Menu > Guide. Marks welcomeSeen + saves on dismiss.
  const welcomeDialog = new WelcomeDialog(() => {
    if (!game.state.welcomeSeen) {
      game.state.welcomeSeen = true;
      game.save();
    }
  });

  // Named save/load slots dialog (Menu > Save Game / Load Game)
  const saveLoadDialog = new SaveLoadDialog(game);

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
        saveLoadDialog.open('save');
        break;
      case 'load-game':
        saveLoadDialog.open('load');
        break;
      case 'scenarios':
        showScenarioPicker(game);
        break;
      case 'options':
        optionsDialog.open();
        break;
      case 'guide':
        welcomeDialog.open();
        break;
      case 'main-menu':
        // Save first so the title screen's Continue picks up right here.
        game.save();
        location.reload();
        break;
    }
  });

  // Music player
  const musicPlayer = new MusicPlayer();

  // Options dialog (Menu > Options) — music / view / gameplay settings.
  // Declared after musicPlayer; the menu click handler above only runs
  // post-init, so the binding is live by then.
  const optionsDialog = new OptionsDialog({ game, renderer, musicPlayer });

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

  router.init(restoredView?.route);
  game.start();

  // First-run welcome popup: only once the player is actually looking at
  // the game. With no title screen (New Game reload / demo / scenario boot)
  // that's right now; otherwise it's hooked into onContinue below. The other
  // title-screen paths (New Game / Scenarios) reload with skipTitle set and
  // land in the immediate branch on the next boot.
  const maybeShowWelcome = () => {
    if (!game.state.welcomeSeen) welcomeDialog.open();
  };
  if (!titleScreen) maybeShowWelcome();

  if (titleScreen) {
    titleScreen.ready({
      hasSave: hadSave,
      onContinue: () => { titleScreen.dismiss(); maybeShowWelcome(); },
      onNewGame: () => {
        // Mirrors the menu-dropdown 'new-game' action (clear save, reload),
        // with skipTitle set so the reload goes straight into the game.
        if (hadSave && !confirm('Start a new game? All progress will be lost.')) return;
        sessionStorage.setItem('beamlineTycoon.skipTitle', '1');
        localStorage.removeItem('beamlineTycoon');
        location.reload();
      },
      onScenarios: () => showScenarioPicker(game),
    });
  }

  // ── Live demo / remote-drive for watch-while-iterating ──────────────
  // 1) ?demo=1 auto-builds a showcase facility+beamline on load so
  //    http://localhost:8000/?demo=1#game animates without pasting.
  // 2) Polling public/demo-commands.json lets the agent drive the
  //    *user's* tab live (same-origin fetch) — puppeteer and user Chrome
  //    share the file via vite's static serving, not localStorage.
  window.game = game; window._renderer = renderer; // ensure global for console
  async function runDemoBuild() {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const panTo = (x, y, z) => { renderer._panX = x; renderer._panY = y; if (z) renderer.zoom = z; renderer.refresh(); };
    game.setDevMode(true);
    console.log('[demo] building showcase...');
    game.placeInfraRect(0,0,4,4,'concrete'); renderer.refresh(); await sleep(500);
    game.placeInfraRect(0,0,4,4,'officeFloor'); renderer.refresh(); await sleep(500);
    game.placeZoneRect(0,0,2,2,'controlRoom'); await sleep(250);
    game.placeZoneRect(3,0,4,2,'cafeteria'); await sleep(250);
    game.placeZoneRect(0,3,4,4,'officeSpace'); renderer.refresh(); panTo(2,2,1.2); await sleep(700);
    game.placeInfraRect(0,6,4,9,'concrete'); await sleep(350);
    game.placeInfraRect(0,6,4,9,'labFloor'); await sleep(350);
    game.placeZoneRect(0,6,4,9,'rfLab'); renderer.refresh(); panTo(2,5,1.2); await sleep(700);
    for (let c=-2;c<10;c++){ const d=game._decorationAtTile?.(c,12); if(d) game.removeDecoration(c,12,{skipRefund:true}); }
    await sleep(300);
    const src = game.beamline.placeJunction({type:'source', col:0, row:12, dir:3}); renderer.refresh(); await sleep(600);
    const far = game.beamline.placeJunction({type:'faradayCup', col:8, row:12, dir:3}); renderer.refresh(); await sleep(600);
    const pipe = game.beamline.drawPipe({junctionId:src,portName:'exit'},{junctionId:far,portName:'entry'},[{col:0,row:12},{col:8,row:12}]);
    renderer.refresh(); panTo(4,7,1.3); await sleep(800);
    if (pipe) {
      game.beamline.placeOnPipe(pipe,{type:'quadrupole',position:0.25,mode:'snap'}); renderer.refresh(); await sleep(500);
      game.beamline.placeOnPipe(pipe,{type:'rfCavity',position:0.55,mode:'snap'}); renderer.refresh(); await sleep(500);
      game.beamline.placeOnPipe(pipe,{type:'bpm',position:0.85,mode:'snap'}); renderer.refresh(); await sleep(500);
    }
    // Utility gating (Phase 6/7): junction power + vacuum sinks are
    // hard-required, so wire the source + faraday cup before starting beam.
    for (const [c, r] of [[2,14],[6,14]]) { const d = game._decorationAtTile?.(c, r); if (d) game.removeDecoration(c, r, {skipRefund:true}); }
    const xfmr = game.placePlaceable({type:'padMountTransformer', col:2, row:14});
    const pump = game.placePlaceable({type:'roughingPump', col:6, row:14});
    if (xfmr && src) wireUtility(game,'powerCable',{id:xfmr,port:'pwr_out'},{id:src,port:'pwr_in'});
    if (xfmr && far) wireUtility(game,'powerCable',{id:xfmr,port:'pwr_out'},{id:far,port:'pwr_in'});
    if (pump && src) wireUtility(game,'vacuumPipe',{id:pump,port:'vac_out'},{id:src,port:'vac_in'});
    if (pump && far) wireUtility(game,'vacuumPipe',{id:pump,port:'vac_out'},{id:far,port:'vac_in'});
    renderer.refresh(); await sleep(500);
    // Turn the beam on once the gate has seen the wired topology.
    game.tick();
    const demoEntry = game.registry.getAll().find(e => e.sourceId === src);
    if (demoEntry && demoEntry.status !== 'running') game.toggleBeam(demoEntry.id);
    renderer.setViewMode('iso',0); renderer.refresh(); await sleep(700);
    renderer.setViewMode('top',0); renderer.refresh(); await sleep(700);
    renderer.setViewMode('iso',2); renderer.refresh(); panTo(4,7,1.3); await sleep(700);
    console.log('[demo] done — use 1/2/3 tabs, Q/E rotate, middle-drag orbit');
  }
  const params = new URLSearchParams(location.search);
  if (params.has('demo') || location.hash.includes('demo')) {
    setTimeout(runDemoBuild, 1200);
  }
  // Expose for manual trigger: window.__btDemo()
  window.__btDemo = runDemoBuild;
  // Live polling — agent writes public/demo-commands.json, your tab executes.
  // Dev-only: never poll (or eval) on production deploys.
  let lastSeq = 0;
  if (import.meta.env.DEV) setInterval(async () => {
    try {
      const res = await fetch('demo-commands.json?'+Date.now(), {cache:'no-store'});
      if (!res.ok) return;
      const j = await res.json();
      if (!j || typeof j.seq !== 'number' || j.seq <= lastSeq) return;
      lastSeq = j.seq;
      const c = j.cmd;
      if (!c) return;
      console.log('[remote]', c);
      if (c.action === 'demo') await runDemoBuild();
      else if (c.action === 'eval' && typeof c.js === 'string') Function('game','renderer',c.js)(game, renderer);
      else if (c.action === 'reset') { localStorage.clear(); location.reload(); }
    } catch {}
  }, 800);

  BeamPhysics.init().then(() => {
    game.log('Beam physics engine loaded.', 'good');
    game.recalcAllBeamlines();
    game.emit('beamlineChanged');
  }).catch(err => {
    game.log('Physics engine failed to load — using simplified model.', 'bad');
    console.error('BeamPhysics init error:', err);
  });


})();
