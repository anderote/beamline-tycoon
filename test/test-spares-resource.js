import { Game } from '../src/game/Game.js';
import { onJobComplete } from '../src/game/staff/jobRunner.js';

let failed = 0;
function assertOk(condition, message) {
  if (condition) console.log('PASS:', message);
  else { failed++; console.error('FAIL:', message); }
}

const game = new Game();
assertOk(game.state.resources.spares === 50, 'a new facility starts with maintenance spares');

const machinist = {
  skills: { construction: 8 },
  stats: { sparesMade: 0 },
  history: [],
};
onJobComplete(game, machinist, { jobType: 'fabricate' });
assertOk(game.state.resources.spares === 53, 'machinist fabrication adds maintenance spares');
assertOk(machinist.stats.sparesMade === 3, 'fabrication tracks the produced maintenance spares');

process.exitCode = failed ? 1 : 0;
