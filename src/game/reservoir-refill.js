// Reservoir refill commands shared by direct world clicks and the utility
// inspector. The utility descriptor owns inventory units and refill pricing;
// this module owns the transaction so every entry point charges, mutates, and
// reports failure through the same public seam.

import { getUtilityPortsV2 } from '../data/utility-ports-v2.js';
import { UTILITY_TYPES } from '../utility/registry.js';

function networkList(state, utilityType) {
  const networks = state?.utilityNetworks?.get?.(utilityType);
  return Array.isArray(networks) ? networks : [];
}

function storageUtilitiesForType(type) {
  const utilities = new Set();
  for (const port of Object.values(getUtilityPortsV2(type) || {})) {
    if (port?.role !== 'source') continue;
    if (!(Number(port.params?.storageCapacityL) > 0)) continue;
    utilities.add(port.utility);
  }
  return utilities;
}

/**
 * Refill one solved utility network.
 *
 * Returns a result object rather than logging so Game remains the owner of
 * player-facing events. `onlyIfEmpty` is used by world clicks; the inspector
 * deliberately retains its existing ability to top up a partial reservoir.
 */
export function refillUtilityNetwork(state, utilityType, networkId, {
  onlyIfEmpty = false,
  canAfford = () => true,
  charge = () => {},
} = {}) {
  const descriptor = UTILITY_TYPES[utilityType];
  if (!descriptor
      || typeof descriptor.refillCost !== 'function'
      || typeof descriptor.refilledPersistentState !== 'function') {
    return { ok: false, reason: 'not_refillable', utilityType, networkId };
  }

  const persistentMap = state?.utilityNetworkState;
  if (!persistentMap || typeof persistentMap.get !== 'function'
      || typeof persistentMap.set !== 'function') {
    return { ok: false, reason: 'unsolved', utilityType, networkId };
  }
  const persistent = persistentMap.get(networkId);
  if (!persistent) return { ok: false, reason: 'unsolved', utilityType, networkId };

  if (onlyIfEmpty) {
    if (typeof descriptor.reservoirLevel !== 'function') {
      return { ok: false, reason: 'not_reservoir', utilityType, networkId };
    }
    const level = descriptor.reservoirLevel(persistent);
    if (!(level?.capacity > 0)) {
      return { ok: false, reason: 'no_capacity', utilityType, networkId };
    }
    if (level.current > 0) {
      return { ok: false, reason: 'not_empty', utilityType, networkId };
    }
  }

  let cost = null;
  try { cost = descriptor.refillCost(persistent); } catch (_) { cost = null; }
  if (!cost) return { ok: false, reason: 'full', utilityType, networkId };
  if (!canAfford(cost)) {
    return { ok: false, reason: 'unaffordable', utilityType, networkId, cost };
  }

  const nextPersistentState = descriptor.refilledPersistentState(persistent);
  charge(cost);
  persistentMap.set(networkId, nextPersistentState);
  return {
    ok: true,
    utilityType,
    networkId,
    cost,
    displayName: descriptor.displayName || utilityType,
    nextPersistentState,
  };
}

/** Refill the empty solved reservoir network owned by a clicked storage item. */
export function refillEmptyReservoirForPlaceable(state, placeableId, options = {}) {
  const placeable = (state?.placeables || []).find(entry => entry?.id === placeableId);
  if (!placeable) return { ok: false, reason: 'missing_placeable', placeableId };

  const storageUtilities = storageUtilitiesForType(placeable.type);
  if (storageUtilities.size === 0) {
    return { ok: false, reason: 'not_reservoir', placeableId };
  }

  let fallback = { ok: false, reason: 'unconnected', placeableId };
  for (const utilityType of storageUtilities) {
    for (const network of networkList(state, utilityType)) {
      const ownsStorage = (network.sources || []).some(source =>
        source?.placeableId === placeableId
          && Number(source.params?.storageCapacityL) > 0);
      if (!ownsStorage) continue;
      const result = refillUtilityNetwork(state, utilityType, network.id, {
        ...options,
        onlyIfEmpty: true,
      });
      if (result.ok || result.reason === 'unaffordable') return result;
      fallback = { ...result, placeableId };
    }
  }
  return fallback;
}
