// Public command for the ordinary-cursor beam-pipe inspection gesture.

import { beamlineForPipe } from '../beamline/pipe-ownership.js';

export function inspectBeamPipe(game, pipeId, openWindow) {
  const entry = beamlineForPipe(game?.state, game?.registry, pipeId);
  if (!entry) return false;
  const pipe = (game.state?.beamPipes || []).find(candidate => candidate?.id === pipeId);

  game.selectedBeamlineId = entry.id;
  game.emit?.('beamlineSelected', entry.id);
  openWindow?.(entry.id, null, pipe?.path || null);
  return true;
}
