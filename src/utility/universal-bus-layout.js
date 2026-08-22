// Fixed physical lanes for the universal utility bus.
//
// Lane identity belongs to the utility, not to connection order. That keeps a
// power cable in the same visible tray position on every carrier and lets all
// supported utility types coexist without competing for a generic slot.

// Physical tray dimensions are shared by rendering and ground-clearance
// validation. One tile is two world metres, so the 0.50 m tray half-width is
// 0.25 tile in plan view. A one-metre tray is wide enough for all seven real
// service geometries and their access fittings to remain distinct on top.
export const UNIVERSAL_BUS_DECK_Y = 0.70;
export const UNIVERSAL_BUS_HALF_WIDTH_METERS = 0.50;
export const UNIVERSAL_BUS_HALF_WIDTH_TILES = UNIVERSAL_BUS_HALF_WIDTH_METERS / 2;

export const UNIVERSAL_BUS_LANES = Object.freeze({
  // Left rail -> right rail. Spacing is intentionally non-uniform: the
  // jacketed cryogenic line and vacuum pipe need more physical width than a
  // power cord or fibre bundle. All seven centre lines remain above the tray
  // deck and inside its rails.
  hvCable: Object.freeze({ slot: 0, tier: 'top', lateral: -0.413, runY: 0.84, portY: 0.96 }),
  powerCable: Object.freeze({ slot: 1, tier: 'top', lateral: -0.307, runY: 0.82, portY: 0.94 }),
  coolingWater: Object.freeze({ slot: 2, tier: 'top', lateral: -0.212, runY: 0.82, portY: 0.94 }),
  dataFiber: Object.freeze({ slot: 3, tier: 'top', lateral: -0.117, runY: 0.82, portY: 0.94 }),
  vacuumPipe: Object.freeze({ slot: 4, tier: 'top', lateral: 0.029, runY: 0.84, portY: 0.96 }),
  cryoTransfer: Object.freeze({ slot: 5, tier: 'top', lateral: 0.231, runY: 0.84, portY: 0.98 }),
  rfWaveguide: Object.freeze({ slot: 6, tier: 'top', lateral: 0.403, runY: 0.84, portY: 0.96 }),
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
