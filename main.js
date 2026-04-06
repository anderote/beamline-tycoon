// === BEAMLINE TYCOON: MAIN ===

// Clear old saves from the grid-based version
const oldSave = localStorage.getItem('beamlineCowboy');
if (oldSave) localStorage.removeItem('beamlineCowboy');

(async function main() {
  // Create core objects
  const beamline = new Beamline();
  const game = new Game(beamline);
  const spriteManager = new SpriteManager();

  // Create renderer (async — initializes PixiJS)
  const renderer = new Renderer(game, spriteManager);
  await renderer.init();

  // Create input handler and wire tool selection
  const input = new InputHandler(renderer, game);
  renderer._onToolSelect = (compType) => input.selectTool(compType);
  renderer._onInfraSelect = (infraType) => input.selectInfraTool(infraType);
  renderer._onFacilitySelect = (compType) => input.selectFacilityTool(compType);
  renderer._onConnSelect = (connType) => input.selectConnTool(connType);

  // Sync mode changes to input handler
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (MODES[mode]?.disabled) return;
      input.setActiveMode(mode);
    });
  });

  // Create probe window and wire to renderer
  const probeWindow = new ProbeWindow(game);
  renderer.onProbeClick = (node) => probeWindow.addPin(node);

  // Hook probe state into save
  const origSave = game.save.bind(game);
  game.save = function() {
    this.state.probe = probeWindow.toJSON();
    origSave();
  };

  // Render pin flags on beamline changes
  game.on('beamlineChanged', () => {
    renderer._renderProbeFlags(probeWindow.pins);
  });

  // Load saved game (if any)
  game.load();

  // Restore probe state from save
  if (game.state.probe) {
    probeWindow.fromJSON(game.state.probe);
  }

  // New Game button
  document.getElementById('btn-new-game').addEventListener('click', () => {
    if (confirm('Start a new game? All progress will be lost.')) {
      localStorage.removeItem('beamlineTycoon');
      location.reload();
    }
  });

  // Start game loop
  game.start();

  // Initialize beam physics engine (async — game works with fallback until ready)
  BeamPhysics.init().then(() => {
    game.log('Beam physics engine loaded.', 'good');
    game.recalcBeamline();
    game.emit('beamlineChanged');
  }).catch(err => {
    game.log('Physics engine failed to load — using simplified model.', 'bad');
    console.error('BeamPhysics init error:', err);
  });
})();
