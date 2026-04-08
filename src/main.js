// src/main.js — Beamline Tycoon entry point

import { Beamline } from './beamline/Beamline.js';
import { BeamPhysics } from './beamline/physics.js';
import { PARAM_DEFS } from './beamline/component-physics.js';
import { Game } from './game/Game.js';
import { SpriteManager } from './renderer/sprites.js';
import { Renderer } from './renderer/Renderer.js';
import { InputHandler } from './input/InputHandler.js';
import { ProbeWindow } from './ui/probe.js';
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
  const beamline = new Beamline();
  const game = new Game(beamline);
  const spriteManager = new SpriteManager();

  const renderer = new Renderer(game, spriteManager);
  await renderer.init();

  await spriteManager.loadTileSprites();
  renderer._renderInfrastructure();
  renderer._renderZones();

  const input = new InputHandler(renderer, game);
  renderer._onToolSelect = (compType) => input.selectTool(compType);
  renderer._onInfraSelect = (infraType) => input.selectInfraTool(infraType);
  renderer._onFacilitySelect = (compType) => input.selectFacilityTool(compType);
  renderer._onConnSelect = (connType) => input.selectConnTool(connType);
  renderer._onZoneSelect = (zoneType) => input.selectZoneTool(zoneType);
  renderer._onFurnishingSelect = (furnType) => input.selectFurnishingTool(furnType);
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
    origSave();
  };

  game.on((event) => {
    if (event === 'beamlineChanged') {
      renderer._renderProbeFlags(probeWindow.pins);
    }
  });

  game.load();

  if (game.state.probe) {
    probeWindow.fromJSON(game.state.probe);
  }

  document.getElementById('btn-new-game').addEventListener('click', () => {
    if (confirm('Start a new game? All progress will be lost.')) {
      localStorage.removeItem('beamlineTycoon');
      location.reload();
    }
  });

  game.start();

  BeamPhysics.init().then(() => {
    game.log('Beam physics engine loaded.', 'good');
    game.recalcBeamline();
    game.emit('beamlineChanged');
  }).catch(err => {
    game.log('Physics engine failed to load — using simplified model.', 'bad');
    console.error('BeamPhysics init error:', err);
  });
})();
