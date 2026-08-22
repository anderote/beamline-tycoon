// Public utility-line input commands. Keep picking + undo + player feedback
// together so direct canvas actions and armed tools share one transaction
// boundary without teaching InputHandler how utility-line mutation works.

import { UTILITY_TYPES } from '../utility/registry.js';
import { OBJECT_PICK_TOLERANCE_PX } from './pick-tolerance.js';

/** Remove one utility line as a single undoable player action. */
export function removeUtilityLineById(game, lineId, utilityType = null) {
  if (!lineId || typeof game?.removeUtilityLine !== 'function'
      || typeof game?.runUndoableMutation !== 'function') return false;

  const line = game.state?.utilityLines?.get?.(lineId);
  const type = line?.utilityType || utilityType;
  let removed = false;
  game.runUndoableMutation(() => {
    removed = game.removeUtilityLine(lineId);
    return removed;
  });

  if (removed) {
    const label = UTILITY_TYPES[type]?.displayName || type || 'Utility';
    game.log?.(`Removed ${label} line`, 'info');
  }
  return removed;
}

/** Pick and remove the visible utility line under a screen-space cursor. */
export function removeUtilityLineAtScreen({
  game,
  renderer,
  screenX,
  screenY,
  tolerancePx = OBJECT_PICK_TOLERANCE_PX,
}) {
  const hit = renderer?.raycastUtilityLine?.(screenX, screenY, tolerancePx);
  if (!hit?.lineId) return false;
  return removeUtilityLineById(game, hit.lineId, hit.utilityType);
}
