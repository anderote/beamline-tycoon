// src/main.js — Beamline Tycoon entry point

import './three-global.js';
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
import { YAW_STEP } from './renderer3d/free-orbit-math.js';
import { InputHandler } from './input/InputHandler.js';
import { BeamlineDesigner } from './ui/BeamlineDesigner.js';
import { GuidedBeamlineSetup } from './ui/GuidedBeamlineSetup.js';
import { DesignLibrary } from './ui/DesignLibrary.js';
import { DesignPlacer } from './ui/DesignPlacer.js';
import { ProbeWindow } from './ui/probe.js';
import { ViewRouter } from './ui/ViewRouter.js';
import { MODES } from './data/modes.js';
import { COMPONENTS } from './data/components.js';
import { SCENARIOS, CUSTOM_SCENARIO_ID, loadCustomScenario, resolveScenario } from './data/scenarios.js';
import { MusicPlayer } from './ui/MusicPlayer.js';
import { TitleScreen } from './ui/TitleScreen.js';
import { WelcomeDialog } from './ui/WelcomeDialog.js';
import { SaveLoadDialog } from './ui/SaveLoadDialog.js';
import { CloudSaves } from './game/CloudSaves.js';
import { SaveSlots } from './game/SaveSlots.js';
import { OptionsDialog } from './ui/OptionsDialog.js';
import { UtilityInspector } from './ui/UtilityInspector.js';
import { EconomyWindow } from './ui/EconomyWindow.js';
import { AdvisorEngine, ADVICE_LEVEL_STORAGE_KEY } from './advisor/engine.js';
import { buildAdvisorContext } from './advisor/context.js';
import { Stubby } from './ui/Stubby.js';
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
  overlay.className = 'ui-modal-backdrop';

  const panel = document.createElement('div');
  panel.className = 'scenario-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'scenario-dialog-title');

  let html = '<div class="scenario-header"><h2 class="scenario-title" id="scenario-dialog-title">Scenarios</h2></div>';
  html += '<div class="scenario-body">';
  html += '<p class="scenario-intro">Start a new game with a pre-built scenario. Current progress will be lost.</p>';

  // Editor-exported custom scenario (localStorage slot), if present.
  const customScenario = loadCustomScenario();
  const pickerScenarios = customScenario
    ? [...SCENARIOS, {
        id: CUSTOM_SCENARIO_ID,
        name: `Custom: ${customScenario.name || 'Untitled'}`,
        desc: 'Scenario exported from the in-game Scenario Editor (stored in localStorage).',
        difficulty: 'Custom',
      }]
    : SCENARIOS;

  for (const sc of pickerScenarios) {
    html += `<button type="button" class="scenario-card" data-id="${sc.id}">`;
    html += `<span class="scenario-card-header">`;
    html += `<strong class="scenario-card-name">${sc.name}</strong>`;
    html += `<span class="scenario-difficulty">${sc.difficulty}</span>`;
    html += `</span>`;
    html += `<span class="scenario-description">${sc.desc}</span>`;
    html += `</button>`;
  }

  html += '</div>';
  html += '<div class="scenario-footer"><button type="button" id="scenario-cancel" class="ui-button">Cancel</button></div>';

  panel.innerHTML = html;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Card click
  panel.addEventListener('click', (e) => {
    const card = e.target.closest('.scenario-card');
    if (!card) return;
    const id = card.dataset.id;
    // resolveScenario also handles the custom (editor-exported) slot.
    const scenario = resolveScenario(id);
    if (!scenario) return;

    if (!confirm(`Start "${scenario.name}"? Your current game will be kept in recovery saves.`)) return;

    // Clear current save, set pending scenario, reload.
    // skipTitle makes the post-selection reload go straight into the game.
    game.save();
    SaveSlots.preserveActive('Before ' + scenario.name);
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
  // Dev-only Scenario Editor mode (?editor=1 or Menu > Scenario Editor).
  // Compile-time gated: in production builds import.meta.env.DEV is false,
  // so IS_EDITOR is always false and the dynamic import of ScenarioEditor
  // below is dead-code-eliminated from the bundle.
  const IS_EDITOR = import.meta.env.DEV && bootParams.has('editor');
  const skipTitleFlag = !!sessionStorage.getItem('beamlineTycoon.skipTitle');
  if (skipTitleFlag) sessionStorage.removeItem('beamlineTycoon.skipTitle');
  const skipTitle = skipTitleFlag
    || IS_EDITOR
    || bootParams.has('demo') || location.hash.includes('demo')
    || !!localStorage.getItem('beamlineTycoon.pendingScenario');
  const titleScreen = skipTitle ? null : new TitleScreen();

  // Music player boots first: its manifest fetch is tiny, so the soundtrack
  // becomes playable (via the title screen's click-anywhere gesture) long
  // before the heavy renderer/sprite/physics loading finishes.
  const musicPlayer = new MusicPlayer();

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
    explode(position, options) { return renderer.explodeWorld(position, options); },
    undoPhysics() { return renderer.undoLastPhysicsIncident(); },
    physicsStats() { return renderer.getPhysicsStats(); },
    lightingStats() { return renderer.getLightingStats(); },
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
  const guidedSetup = new GuidedBeamlineSetup(game, renderer, input);
  game._guidedSetup = guidedSetup;
  const designLibrary = new DesignLibrary(game, designer, renderer);
  const designPlacer = new DesignPlacer(game, renderer);
  game._designPlacer = designPlacer;

  // The one way a design becomes a placement ghost. Three surfaces reach it —
  // the design library's "Place" button, its Stock tab, and the blueprint
  // gallery in the New Beamline picker — and they must behave identically, so
  // the sequencing lives here rather than three times over.
  const startDesignPlacement = (design) => {
    if (!design) return;
    if (designer.isOpen) {
      designer._suppressHashUpdate = true;
      designer._cleanup();
    }
    if (window.location.hash !== '#game') window.location.hash = 'game';

    // ORDER IS LOAD BEARING. A stock blueprint carries the beamline type it IS,
    // and its first component is a source — so DesignPlacer.confirm()'s first
    // placeJunction is what mints the registry entry, and
    // Game._ensureBeamlineForSourcePlaceable stamps it from
    // pendingBeamlineTypeId at that instant. Arming here, before the ghost even
    // exists, puts the pick strictly ahead of any click that could place
    // anything; arming it inside the placer would put the same rule in a second
    // place. A player-saved design has no typeId and arms nothing, exactly as
    // before.
    if (design.typeId) game.startNewBeamline(design.typeId);

    designPlacer.start(design);
    game.log('Click to place design. F=rotate, R=reflect, Esc=cancel', 'info');
  };
  game._startDesignPlacement = startDesignPlacement;
  designLibrary.onPlace = startDesignPlacement;

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
  game.registerSerializer('guidedSetup', {
    save: () => guidedSetup.toJSON(),
    load: (data) => guidedSetup.fromJSON(data),
  });

  game.on((event) => {
    if (event === 'beamlineChanged') {
      renderer._renderProbeFlags(probeWindow.pins);
    }
  });

  // --- Stubby, the facility advisor -----------------------------------------
  // Evaluated on the tick rather than per frame: every rule is a cheap
  // predicate, but the context assembles arrays and the tutorial's conditions
  // walk the pipe list, which is not work to do sixty times a second.
  const advisorEngine = new AdvisorEngine();
  const stubby = new Stubby(game, advisorEngine, renderer);
  game._advisor = advisorEngine;
  game._stubby = stubby;

  const ADVISOR_TICK_INTERVAL = 2;   // TICK_MS is 1000, so ~2 s of game time
  // AdvisorEngine already wraps every rule, but context assembly and the DOM
  // update are outside it — and this runs from a `tick` listener that
  // Game.emit invokes with a bare forEach, so anything thrown here takes out
  // every listener registered after it AND the rest of the tick. An advisor
  // is the last thing in this game that should be able to stop the sim.
  const runAdvisor = () => {
    try {
      stubby.update(advisorEngine.evaluate(buildAdvisorContext(game, game._designer)));
    } catch (e) {
      console.error('[advisor] evaluation failed:', e);
    }
  };
  game._runAdvisor = runAdvisor;

  let lastAdvisorTick = -Infinity;
  game.on((event) => {
    if (event !== 'tick') return;
    const tick = game.state.tick || 0;
    if (tick - lastAdvisorTick < ADVISOR_TICK_INTERVAL) return;
    lastAdvisorTick = tick;
    runAdvisor();
  });

  // Silenced advice is a durable preference; cooldowns and dismissals are
  // session state, so a reloaded game says again what is still broken.
  game.registerSerializer('advisor', {
    save: () => advisorEngine.toJSON(),
    load: (data) => advisorEngine.fromJSON(data),
  });

  // Scenario Editor (dev-only): fresh blank world — skip loading the
  // player's save AND suppress autosave, so their real game survives the
  // editor session untouched. Exit reloads without ?editor=1 and the
  // normal boot path picks the save right back up.
  if (IS_EDITOR) {
    const { ScenarioEditor } = await import('./ui/ScenarioEditor.js');
    const scenarioEditor = new ScenarioEditor(game);
    scenarioEditor.init();
    window.scenarioEditor = scenarioEditor;
  } else {
    game.load();

    // Apply pending scenario (set by scenario picker or the editor's
    // "Play This Scenario" before reload). resolveScenario also checks the
    // beamlineTycoon.customScenario slot for editor-exported scenarios.
    const pendingScenario = localStorage.getItem('beamlineTycoon.pendingScenario');
    if (pendingScenario) {
      localStorage.removeItem('beamlineTycoon.pendingScenario');
      const scenario = resolveScenario(pendingScenario);
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
  }

  // Advice level is both save-portable (the advisor serializer above) and a
  // global player preference. The global choice wins when switching slots or
  // starting a new facility; if it does not exist yet, migrate the level from
  // the active save into it.
  try {
    const preferredAdviceLevel = localStorage.getItem(ADVICE_LEVEL_STORAGE_KEY);
    if (preferredAdviceLevel) advisorEngine.setLevel(preferredAdviceLevel);
    else localStorage.setItem(ADVICE_LEVEL_STORAGE_KEY, advisorEngine.level());
  } catch {
    /* Storage may be unavailable in privacy-restricted embeds. */
  }

  if (restoredView) {
    renderer.zoom = restoredView.zoom;
    if (typeof restoredView.panX === 'number') {
      renderer._panX = restoredView.panX;
      renderer._panY = restoredView.panY;
      renderer._isoYawIdx = restoredView.viewRotationIndex || 0;
      renderer._viewRotationAngle = renderer._isoYawIdx * YAW_STEP;
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
      // setActiveMode does not rebuild the tab bar, so without this the bar
      // still shows the mode init() built and the restored tab is missing.
      renderer._generateCategoryTabs?.();
      if (restoredView.selectedCategory) {
        input.selectedCategory = restoredView.selectedCategory;
        renderer.updatePalette(restoredView.selectedCategory, {
          freshTab: restoredView.activeMode === 'infra',
        });
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

  // Economy button — toggles the cash-flow window (same gesture as the K key)
  document.getElementById('btn-economy').addEventListener('click', () => {
    EconomyWindow.toggle(game);
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
  // Dev-only Scenario Editor entry — appended at runtime so it never
  // exists in production (import.meta.env.DEV is compile-time false there).
  if (import.meta.env.DEV) {
    const editorItem = document.createElement('button');
    editorItem.className = 'menu-item';
    editorItem.dataset.action = 'scenario-editor';
    editorItem.textContent = 'Scenario Editor';
    const scenariosItem = menuDropdown.querySelector('[data-action="scenarios"]');
    if (scenariosItem) scenariosItem.after(editorItem);
    else menuDropdown.appendChild(editorItem);
  }
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
        if (confirm('Start a new game? Your current game will be kept in recovery saves.')) {
          // skipTitle so the reload lands in a fresh game rather than on the
          // title screen — which, with the save just deleted, would show no
          // Continue button and force a second New Game click.
          sessionStorage.setItem('beamlineTycoon.skipTitle', '1');
          game.save();
          SaveSlots.preserveActive('Before new game');
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
      case 'scenario-editor':
        if (import.meta.env.DEV) {
          if (!confirm('Enter the Scenario Editor?\n\nYour current game is saved and resumes when you exit the editor.')) break;
          game.save();
          location.href = location.pathname + '?editor=1';
        }
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

  // (Music player is constructed at the top of main() so it can start
  // playing during boot.)

  // Options dialog (Menu > Options) — music / view / gameplay settings.
  // Declared after musicPlayer; the menu click handler above only runs
  // post-init, so the binding is live by then.
  const optionsDialog = new OptionsDialog({ game, renderer, musicPlayer });

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
  // Start the sim paused behind the title screen. game.start() spins up the
  // 1 Hz tick — upkeep, staff needs, research progress, objectives, and an
  // autosave every 30 ticks — so leaving the title screen up used to charge
  // the player for minutes of idle time and overwrite the very save they had
  // not chosen to continue yet. onContinue resumes.
  const pausedBeforeTitle = game.state.paused;
  if (titleScreen) game.state.paused = true;
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
      onContinue: () => {
        titleScreen.dismiss();
        // Restore whatever pause state the loaded save had, not an
        // unconditional resume.
        if (!pausedBeforeTitle) game.resume();
        maybeShowWelcome();
      },
      onNewGame: () => {
        // Mirrors the menu-dropdown 'new-game' action (clear save, reload),
        // with skipTitle set so the reload goes straight into the game.
        if (hadSave && !confirm('Start a new game? Your current game will be kept in recovery saves.')) return;
        sessionStorage.setItem('beamlineTycoon.skipTitle', '1');
        game.save();
        SaveSlots.preserveActive('Before new game');
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
    let demoBpm = null;
    if (pipe) {
      game.beamline.placeOnPipe(pipe,{type:'quadrupole',position:0.25,mode:'snap'}); renderer.refresh(); await sleep(500);
      game.beamline.placeOnPipe(pipe,{type:'rfCavity',position:0.55,mode:'snap'}); renderer.refresh(); await sleep(500);
      demoBpm = game.beamline.placeOnPipe(pipe,{type:'bpm',position:0.85,mode:'snap'}); renderer.refresh(); await sleep(500);
    }
    // Utility gating: every ON-PIPE component is gated individually too, so
    // the showcase has to feed the quad / cavity / BPM as well as the two
    // junctions. Row 13 is the distribution row (one bus per utility, each
    // standing in for a handful of stubs), row 14 the service row. The
    // 2856 MHz cavity needs a source covering S-band — an SSA stops at UHF,
    // and a frequency mismatch is only a soft error, so getting it wrong would
    // show a dead beam with no blocker to explain it.
    for (let c = 0; c <= 9; c++) for (const r of [13, 14]) {
      const d = game._decorationAtTile?.(c, r); if (d) game.removeDecoration(c, r, {skipRefund:true});
    }
    const gear = game.placePlaceable({type:'switchgear', col:0, row:14});
    const pump = game.placePlaceable({type:'turboPump', col:2, row:14});
    const ioc  = game.placePlaceable({type:'rackIoc', col:4, row:14});
    const chil = game.placePlaceable({type:'chiller', col:6, row:14});
    const tank = game.placePlaceable({type:'waterTank', col:0, row:16});
    const condenser = game.placePlaceable({type:'fanCoilCooler', col:3, row:16});
    const kly  = game.placePlaceable({type:'pulsedKlystron', col:8, row:14});
    const pwrBus = game.placePlaceable({type:'powerBus', col:1, row:13});
    const vacBus = game.placePlaceable({type:'vacuumManifold', col:3, row:13});
    const rfBus  = game.placePlaceable({type:'waveguideManifold', col:5, row:13});
    const coolBus= game.placePlaceable({type:'coolingManifold', col:7, row:13});
    const wire = (util, fromId, fromPort, toId, toPort) => {
      if (fromId && toId) wireUtility(game, util, {id:fromId, port:fromPort}, {id:toId, port:toPort});
    };
    for (const [id, port] of [[src,'pwr_in'],[far,'pwr_in'],[pump,'pwr_in'],[ioc,'pwr_in'],
      [chil,'pwr_in'],[kly,'pwr_in'],[pwrBus,'bus_left']]) wire('powerCable', gear,'pwr_out', id, port);
    for (const [id, port] of [[src,'vac_in'],[far,'vac_in'],[vacBus,'bus_left']])
      wire('vacuumPipe', pump,'vac_out', id, port);
    wire('rfWaveguide', kly,'rf_out', rfBus,'bus_left');
    wire('coolingWater', tank,'cool_out', condenser,'cool_out');
    wire('coolingWater', condenser,'cool_out', chil,'cool_out');
    for (const [id, port] of [[src,'cool_in'],[coolBus,'bus_left']])
      wire('coolingWater', chil,'cool_out', id, port);
    for (const [id, port] of [[far,'data_in'],[demoBpm,'data_in']])
      wire('dataFiber', ioc,'data_out', id, port);
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

  // Pyodide + numpy is a ~30MB download — by far the heaviest part of boot.
  // The title screen doesn't need physics, so defer the download until the
  // player actually enters the game (the sim already tolerates physics
  // arriving late: we recalc when it lands).
  let physicsStarted = false;
  const startPhysics = () => {
    if (physicsStarted) return;
    physicsStarted = true;
    BeamPhysics.init().then(() => {
      game.log('Beam physics engine loaded.', 'good');
      game.recalcAllBeamlines();
      game.emit('beamlineChanged');
      if (designer.isOpen) {
        designer._recalcDraft();
        designer._renderAll();
      }
    }).catch(err => {
      game.log('Physics engine failed to load — using simplified model.', 'bad');
      console.error('BeamPhysics init error:', err);
    });
  };
  if (titleScreen) {
    // Kick off once the player leaves the title for the game. New Game /
    // Scenarios reload with skipTitle set and take the immediate branch.
    const prevDismiss = titleScreen.dismiss.bind(titleScreen);
    titleScreen.dismiss = (...args) => { startPhysics(); return prevDismiss(...args); };
  } else {
    startPhysics();
  }


})();
