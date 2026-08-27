// In-place title-screen New Game coordinator.
//
// The title has already paid the cost of creating a graphics device. Reset the
// session and replace its world while preserving that renderer; runtime New
// Game actions continue through ScenarioPicker's reload fallback.

import { launchScenario } from '../game/scenario-launch.js';

export function startTitleScenario({
  game,
  scenario,
  renderer,
  input,
  router,
  probeWindow,
  guidedSetup,
  utilityPlantGuide,
  titleScreen,
  maybeShowWelcome,
}) {
  renderer.setRenderingSuspended(true);
  if (!game.resetForNewSession() || !launchScenario(game, scenario)) return false;

  input.setActiveMode('beamline');
  renderer._generateCategoryTabs?.();
  renderer.updatePalette(input.selectedCategory, { freshTab: true });
  probeWindow.resetForNewSession();
  guidedSetup.resetForNewSession();
  utilityPlantGuide.resetForNewSession();
  renderer.resetViewForNewSession();
  router.navigate('game');
  renderer.refreshForNewSession();

  game.save();
  game.log(`Scenario "${scenario.name}" loaded.`, 'good');
  game.start();
  titleScreen.dismiss();
  maybeShowWelcome();
  return true;
}
