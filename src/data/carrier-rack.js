// src/data/carrier-rack.js
//
// Carrier rack data: constants, slot positions, adjacency logic.
// Rack segments are 2x2 tiles (4m × 4m). The anchor is the top-left tile.

export const RACK_HEIGHT = 4.0;
export const RACK_TRAY_HEIGHT = 4.0;
export const RACK_RAIL_HEIGHT = 3.7;
export const RACK_PIPE_CENTER_Y = 3.5;
export const RACK_SUPPORT_WIDTH = 0.1;
export const RACK_SIZE = 2; // tiles per side

export const RACK_COST = { funding: 5000 };

// Fixed slot positions for bottom-rail pipes.
// X offset from rack center, looking down the primary axis.
// Ordered left-to-right: cryo, vacuum, RF, cooling.
export const BOTTOM_SLOTS = {
  cryoTransfer: -0.6,
  vacuumPipe:   -0.2,
  rfWaveguide:   0.2,
  coolingWater:   0.6,
};

// Top tray cable positions (X offset from center).
export const TOP_SLOTS = {
  powerCable: -0.3,
  dataFiber:   0.3,
};

// All slot types (bottom + top) for iteration.
export const ALL_SLOTS = { ...BOTTOM_SLOTS, ...TOP_SLOTS };

export function rackTiles(col, row) {
  return [
    { col, row },
    { col: col + 1, row },
    { col, row: row + 1 },
    { col: col + 1, row: row + 1 },
  ];
}

export function rackNeighborAnchors(col, row) {
  return {
    north: { col, row: row - RACK_SIZE },
    south: { col, row: row + RACK_SIZE },
    west:  { col: col - RACK_SIZE, row },
    east:  { col: col + RACK_SIZE, row },
  };
}

export function junctionType(neighbors) {
  const { north, south, east, west } = neighbors;
  const count = [north, south, east, west].filter(Boolean).length;
  if (count === 0) return 'isolated';
  if (count === 1) return 'end';
  if (count === 4) return 'cross';
  if (count === 3) return 'tee';
  if ((north && south) || (east && west)) return 'straight';
  return 'bend';
}

export function junctionRotation(neighbors) {
  const { north, south, east, west } = neighbors;
  const type = junctionType(neighbors);

  if (type === 'straight') {
    return (east || west) ? 0 : Math.PI / 2;
  }
  if (type === 'end') {
    if (east) return 0;
    if (south) return Math.PI / 2;
    if (west) return Math.PI;
    return -Math.PI / 2;
  }
  if (type === 'bend') {
    if (south && east) return 0;
    if (south && west) return Math.PI / 2;
    if (north && west) return Math.PI;
    return -Math.PI / 2;
  }
  if (type === 'tee') {
    if (!north) return 0;
    if (!west) return Math.PI / 2;
    if (!south) return Math.PI;
    return -Math.PI / 2;
  }
  return 0;
}
