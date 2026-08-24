// Apply the gameplay mode and optional authored world behind one resolved
// New Game choice. Keeping this transaction outside main.js gives the picker
// boot path a public, headless test seam.

export function launchScenario(game, scenario) {
  if (!game || !scenario) return false;

  if (game.devMode) game.setDevMode(false);
  game.setSandboxMode(scenario.sandbox === true);
  game.setScenarioRules(scenario.rules);

  if (scenario.generator) {
    game.applyScenario(scenario.generator());
    scenario.setup?.(game);
  }
  return true;
}
