// Shared persistent-water inventory contract. Flexible legacy loops and the
// canonical rigid lukewarm plant circuit both use these rules so storage,
// make-up, evaporation, refill pricing, and topology reconciliation cannot
// drift between the two descriptors.

export const EVAP_PER_KW_PER_TICK = 0.02;
export const WATER_COST_PER_L = 12;

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function waterInventoryForNetwork(network) {
  const sources = network?.sources || [];
  return {
    supplyRateLPerTick: sources.reduce(
      (sum, source) => sum + positive(source.params?.supplyRateLPerTick), 0),
    storageCapacityL: sources.reduce(
      (sum, source) => sum + positive(source.params?.storageCapacityL), 0),
  };
}

export function boundWaterPersistentState(persistent, network) {
  const { storageCapacityL } = waterInventoryForNetwork(network);
  const rawVolume = persistent?.reservoirVolumeL;
  const reservoirVolumeL = Number.isFinite(rawVolume)
    ? Math.max(0, Math.min(storageCapacityL, rawVolume))
    : storageCapacityL;
  return {
    ...(persistent || {}),
    reservoirVolumeL,
    reservoirCapacityL: storageCapacityL,
  };
}

export function waterReservoirLevel(persistent) {
  const capacity = positive(persistent?.reservoirCapacityL);
  const current = Math.max(0, Math.min(
    capacity,
    Number.isFinite(persistent?.reservoirVolumeL) ? persistent.reservoirVolumeL : 0,
  ));
  return { current, capacity };
}

