// Fixed physical slots for the universal vertical utility rack.
//
// Lane identity belongs to the utility, not to connection order. That keeps a
// power cable at the same visible height on every carrier and lets all
// supported utility types coexist without competing for a generic slot.

import {
  UNIVERSAL_RACK_SERVICE_HEIGHTS,
  UNIVERSAL_RACK_TOP_Y,
} from './service-heights.js';

// Physical rack dimensions are shared by rendering and ground-clearance
// validation. The upright frame is narrow in plan because service separation
// is vertical rather than lateral.
export const UNIVERSAL_BUS_DECK_Y = 0.08;
export { UNIVERSAL_RACK_TOP_Y };
export const UNIVERSAL_BUS_HALF_WIDTH_METERS = 0.24;
export const UNIVERSAL_BUS_HALF_WIDTH_TILES = UNIVERSAL_BUS_HALF_WIDTH_METERS / 2;
export const UNIVERSAL_BUS_PORT_LATERAL_METERS = 0.34;

export const UNIVERSAL_BUS_LANES = Object.freeze({
  // Bottom -> top. Rigid services reuse their facility-wide route datums, so
  // a branch meets the rack without changing elevation. Flexible utilities
  // rise locally to their assigned rack socket and are tensioned between the
  // rack posts instead of lying on a continuous shelf.
  cryoTransfer: Object.freeze({
    slot: 0, tier: 'vertical', lateral: 0,
    runY: UNIVERSAL_RACK_SERVICE_HEIGHTS.cryoTransfer,
    portY: UNIVERSAL_RACK_SERVICE_HEIGHTS.cryoTransfer,
    portLateral: UNIVERSAL_BUS_PORT_LATERAL_METERS,
  }),
  rfWaveguide: Object.freeze({
    slot: 1, tier: 'vertical', lateral: 0,
    runY: UNIVERSAL_RACK_SERVICE_HEIGHTS.rfWaveguide,
    portY: UNIVERSAL_RACK_SERVICE_HEIGHTS.rfWaveguide,
    portLateral: UNIVERSAL_BUS_PORT_LATERAL_METERS,
  }),
  vacuumPipe: Object.freeze({
    slot: 2, tier: 'vertical', lateral: 0,
    runY: UNIVERSAL_RACK_SERVICE_HEIGHTS.vacuumPipe,
    portY: UNIVERSAL_RACK_SERVICE_HEIGHTS.vacuumPipe,
    portLateral: UNIVERSAL_BUS_PORT_LATERAL_METERS,
  }),
  coolingWater: Object.freeze({
    slot: 3, tier: 'vertical', lateral: 0,
    supportMode: 'tensioned-span',
    runY: UNIVERSAL_RACK_SERVICE_HEIGHTS.coolingWater,
    portY: UNIVERSAL_RACK_SERVICE_HEIGHTS.coolingWater,
    portLateral: UNIVERSAL_BUS_PORT_LATERAL_METERS,
  }),
  powerCable: Object.freeze({
    slot: 4, tier: 'vertical', lateral: 0,
    supportMode: 'tensioned-span',
    runY: UNIVERSAL_RACK_SERVICE_HEIGHTS.powerCable,
    portY: UNIVERSAL_RACK_SERVICE_HEIGHTS.powerCable,
    portLateral: UNIVERSAL_BUS_PORT_LATERAL_METERS,
  }),
  dataFiber: Object.freeze({
    slot: 5, tier: 'vertical', lateral: 0,
    supportMode: 'tensioned-span',
    runY: UNIVERSAL_RACK_SERVICE_HEIGHTS.dataFiber,
    portY: UNIVERSAL_RACK_SERVICE_HEIGHTS.dataFiber,
    portLateral: UNIVERSAL_BUS_PORT_LATERAL_METERS,
  }),
  hvCable: Object.freeze({
    slot: 6, tier: 'vertical', lateral: 0,
    supportMode: 'tensioned-span',
    runY: UNIVERSAL_RACK_SERVICE_HEIGHTS.hvCable,
    portY: UNIVERSAL_RACK_SERVICE_HEIGHTS.hvCable,
    portLateral: UNIVERSAL_BUS_PORT_LATERAL_METERS,
  }),
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
