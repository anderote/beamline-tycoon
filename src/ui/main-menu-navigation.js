// Explicit navigation contract for Menu > Main Menu.
//
// A generic reload preserves query parameters, hashes, and one-shot boot
// flags. Those are exactly the signals main.js uses to bypass the title
// screen, so returning to the menu must clear them and navigate to the clean
// application path.

import { PENDING_SCENARIO_KEY } from '../data/scenarios.js';

export const SKIP_TITLE_SESSION_KEY = 'beamlineTycoon.skipTitle';

export function returnToMainMenu(game, {
  storage = globalThis.localStorage,
  session = globalThis.sessionStorage,
  location = globalThis.location,
} = {}) {
  game.save();
  session?.removeItem(SKIP_TITLE_SESSION_KEY);
  storage?.removeItem(PENDING_SCENARIO_KEY);

  const target = location?.pathname || '/';
  if (location) location.href = target;
  return target;
}
