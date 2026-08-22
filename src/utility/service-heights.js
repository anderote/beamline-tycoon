// Canonical physical elevations for utility routing and the universal rack.
//
// Fixed-height fabricated services own one facility-wide datum. Equipment may keep
// physically authored fittings at another height; the renderer adds the short
// local transition between that hardware and the long run. Soft-rendered
// services use the same subtile construction grid off-rack and receive a stable
// slot while carried by the universal utility rack.

export const RIGID_UTILITY_SERVICE_HEIGHTS = Object.freeze({
  cryoTransfer: 0.30,
  rfWaveguide: 0.60,
  vacuumPipe: 0.90,
});

export const UNIVERSAL_RACK_SERVICE_HEIGHTS = Object.freeze({
  cryoTransfer: RIGID_UTILITY_SERVICE_HEIGHTS.cryoTransfer,
  rfWaveguide: RIGID_UTILITY_SERVICE_HEIGHTS.rfWaveguide,
  vacuumPipe: RIGID_UTILITY_SERVICE_HEIGHTS.vacuumPipe,
  coolingWater: 1.18,
  powerCable: 1.38,
  dataFiber: 1.54,
  hvCable: 1.76,
});

export const UNIVERSAL_RACK_TOP_Y = 1.88;

export function rigidUtilityServiceHeight(utilityType) {
  const height = RIGID_UTILITY_SERVICE_HEIGHTS[utilityType];
  return Number.isFinite(height) ? height : null;
}

export function universalRackServiceHeight(utilityType) {
  const height = UNIVERSAL_RACK_SERVICE_HEIGHTS[utilityType];
  return Number.isFinite(height) ? height : null;
}
