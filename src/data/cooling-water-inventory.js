// Authored make-up-water inventory values shared by the cooling-water port
// catalogue and solver tests. Storage and supply are intentionally separate:
// a tank may hold water without creating it, while a utility main may deliver
// water without providing any buffer volume.

export const COOLING_WATER_INVENTORY = Object.freeze({
  // Small float-valve tank: covers evaporation from a 50 kW loop indefinitely
  // and buffers a larger loop while its 500 L inventory lasts.
  waterTank: Object.freeze({
    supplyRateLPerTick: 1,
    storageCapacityL: 500,
  }),

  // Dedicated plant-scale replenishment connection. It can replace the
  // evaporation from 1 MW of heat load, but it needs a tank on the network.
  facilityWaterSupply: Object.freeze({
    supplyRateLPerTick: 20,
    storageCapacityL: 0,
  }),

  // Passive tank farm: ten times the small tank's buffer, no water creation.
  bulkWaterTank: Object.freeze({
    supplyRateLPerTick: 0,
    storageCapacityL: 5000,
  }),

  // Integrated packages retain finite commissioned inventory and their
  // existing slow mains make-up. Each feed matches evaporation at the unit's
  // own nameplate load, so spare flow restores a depleted tank gradually.
  packageChiller: Object.freeze({
    supplyRateLPerTick: 0.1,
    storageCapacityL: 100,
  }),
  lcwSkid: Object.freeze({
    supplyRateLPerTick: 0.5,
    storageCapacityL: 500,
  }),
});
