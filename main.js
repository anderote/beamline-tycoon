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

  // Load saved game (if any)
  game.load();

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
