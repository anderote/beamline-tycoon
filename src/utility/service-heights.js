// Canonical physical elevations and support geometry for independently routed
// rigid utilities. Runs that share the same plan path form a service stack:
// their centre lines stay vertically separated while their periodic support
// frames land at the same stations.
//
// Fixed-height fabricated services own one facility-wide datum. Equipment may keep
// physically authored fittings at another height; the renderer adds the short
// local transition between that hardware and the long run. Soft-rendered
// services use the same subtile construction grid off-rack and receive a stable
// slot while carried by the universal utility rack.

export const RIGID_UTILITY_SERVICE_HEIGHTS = Object.freeze({
  cryoTransfer: 0.30,
  waterSupplyPipeCold: 0.60,
  waterSupplyPipeRoom: 1.80,
  waterSupplyPipeHot: 0.90,
  rfWaveguide: 1.20,
  vacuumPipe: 1.50,
});

// Keep fabricated RF guides and pipework visibly carried without crowding
// their routes. A two-metre pitch keeps long spans supported while leaving
// bends and stacked services visually legible.
export const RIGID_UTILITY_SUPPORT_SPACING_METERS = 2;
export const RIGID_UTILITY_SUPPORT_MINIMUM_RUN_METERS = 3;

export const UNIVERSAL_RACK_SERVICE_HEIGHTS = Object.freeze({
  // Legacy save compatibility only. New lines never use the universal rack.
  cryoTransfer: 0.30,
  rfWaveguide: 0.60,
  vacuumPipe: 0.90,
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
