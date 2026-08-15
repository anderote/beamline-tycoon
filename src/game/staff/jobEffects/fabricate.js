import { registerJobEffect } from './registry.js';
import { logCareerEvent } from '../careerLog.js';

const HISTORY_LOG_EVERY = 100;

registerJobEffect('fabricate', (game, member) => {
  const made = 1 + Math.floor((member.skills?.construction ?? 0) / 3);
  game.state.resources.spares = (game.state.resources.spares || 0) + made;

  const before = member.stats.sparesMade || 0;
  const after = before + made;
  member.stats.sparesMade = after;
  if (Math.floor(before / HISTORY_LOG_EVERY) < Math.floor(after / HISTORY_LOG_EVERY)) {
    logCareerEvent(member, game.state.tick, 'fabricate', `Fabricated ${after} spares over their career.`);
  }
});
