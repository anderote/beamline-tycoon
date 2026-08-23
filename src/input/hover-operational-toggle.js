// Resolve and execute the one reversible on/off action represented by a
// world-hover target. InputHandler owns hover identity; Game and its domain
// coordinators remain the only writers of beam and electrical state.

import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { findBeamlineComponent } from '../beamline/component-operation.js';

const POWER_TOGGLE_ACTIONS = new Set(['toggleSwitch', 'toggleGenerator']);

function hoveredPlaceableId(hoverTarget) {
  const match = /^(?:placeable|equip|furn):(.+)$/.exec(hoverTarget || '');
  return match?.[1] || null;
}

function placeableById(game, id) {
  return game?.getPlaceable?.(id)
    || game?.state?.placeables?.find?.(entry => entry?.id === id)
    || findBeamlineComponent(game?.state, id)
    || null;
}

/**
 * Return the public command represented by the hovered object, or null when
 * that object has no simple on/off control.
 */
export function hoveredOperationalTarget(game, hoverTarget) {
  const placeableId = hoveredPlaceableId(hoverTarget);
  if (!placeableId) return null;

  const entry = placeableById(game, placeableId);
  const def = entry && (COMPONENTS[entry.type] || PLACEABLES[entry.type]);
  if (!entry || !def) return null;

  // A source is the physical control point for its complete beamline. Prefer
  // the id stamped on modern source instances, with the registry lookup as a
  // compatibility path for older/scenario-authored source records.
  if (def.isSource) {
    const beamlineId = entry.beamlineId
      || game?.registry?.getBySourceId?.(entry.id)?.id
      || null;
    if (beamlineId) return { kind: 'beamline', id: beamlineId, placeableId };
  }

  if ((entry.kind === 'beamline' || entry.category === 'beamline'
      || def.role === 'placement' || def.role === 'junction') && !def.isSource) {
    return {
      kind: 'beamlineComponent', id: placeableId, placeableId,
    };
  }

  // Device panels may expose several maintenance/transfer actions. Space is
  // intentionally limited to the two actions whose meaning is truly on/off.
  const action = (game?.getPowerDeviceActions?.(placeableId) || [])
    .find(candidate => POWER_TOGGLE_ACTIONS.has(candidate?.id) && !candidate.disabled);
  return action
    ? { kind: 'powerDevice', id: placeableId, actionId: action.id, placeableId }
    : null;
}

/** Execute the hovered command as one undoable mutation. */
export function toggleHoveredOperationalTarget(game, hoverTarget) {
  const target = hoveredOperationalTarget(game, hoverTarget);
  if (!target) return { handled: false, target: null, result: null };

  let result = null;
  const mutate = () => {
    if (target.kind === 'beamline') {
      result = game?.toggleBeam?.(target.id);
    } else if (target.kind === 'beamlineComponent') {
      result = game?.toggleBeamlineComponent?.(target.id);
    } else {
      result = game?.dispatchPowerDeviceAction?.(target.id, target.actionId);
    }
    return result;
  };
  const run = game?.runUndoableMutation;
  if (typeof run === 'function') run.call(game, mutate);
  else mutate();
  return { handled: true, target, result };
}
