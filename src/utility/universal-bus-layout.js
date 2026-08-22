// Fixed physical lanes for the universal utility bus.
//
// Lane identity belongs to the utility, not to connection order. That keeps a
// power cable in the same visible tray position on every carrier and lets all
// supported utility types coexist without competing for a generic slot.

export const UNIVERSAL_BUS_LANES = Object.freeze({
  hvCable: Object.freeze({ slot: 0, tier: 'top', lateral: -0.27, runY: 0.84, portY: 0.96 }),
  powerCable: Object.freeze({ slot: 1, tier: 'top', lateral: -0.09, runY: 0.82, portY: 0.94 }),
  coolingWater: Object.freeze({ slot: 2, tier: 'top', lateral: 0.09, runY: 0.82, portY: 0.94 }),
  dataFiber: Object.freeze({ slot: 3, tier: 'top', lateral: 0.27, runY: 0.84, portY: 0.96 }),
  vacuumPipe: Object.freeze({ slot: 4, tier: 'bottom', lateral: -0.23, runY: 0.49, portY: 0.39 }),
  cryoTransfer: Object.freeze({ slot: 5, tier: 'bottom', lateral: 0, runY: 0.43, portY: 0.33 }),
  rfWaveguide: Object.freeze({ slot: 6, tier: 'bottom', lateral: 0.23, runY: 0.49, portY: 0.39 }),
});

export const UNIVERSAL_BUS_LANE_LIST = Object.freeze(
  Object.entries(UNIVERSAL_BUS_LANES)
    .map(([utilityType, lane]) => Object.freeze({ utilityType, ...lane }))
    .sort((a, b) => a.slot - b.slot),
);

export const UNIVERSAL_BUS_LANE_COUNT = UNIVERSAL_BUS_LANE_LIST.length;

export function universalBusLane(utilityType) {
  return UNIVERSAL_BUS_LANES[utilityType] || null;
}
