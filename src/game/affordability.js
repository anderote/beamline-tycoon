/**
 * Public affordability adapter for previews and lightweight test fixtures.
 * Real games route through Game.canAfford so sandbox mode is respected; the
 * balance fallback keeps pure UI fixtures from needing a full Game instance.
 */
export function canAffordFunding(game, amount) {
  if (typeof game?.canAfford === 'function') {
    return game.canAfford({ funding: amount });
  }
  return (game?.state?.resources?.funding || 0) >= amount;
}
