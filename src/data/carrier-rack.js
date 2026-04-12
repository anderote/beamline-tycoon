// src/data/carrier-rack.js
//
// Carrier rack data: constants, slot positions, adjacency logic.
// Rack segments are 1×1 tile (2m × 2m), directional.
// Visually a narrow wire cable tray on support legs at ~3m height.

export const RACK_HEIGHT = 3.0;       // top of tray (m)
export const RACK_TRAY_WIDTH = 0.8;   // lateral width of wire tray (m)
export const RACK_TRAY_DEPTH = 0.1;   // tray side wall height (m)
export const RACK_SUPPORT_WIDTH = 0.04;
export const RACK_SIZE = 1;           // tiles per segment side

export const RACK_COST = { funding: 2000 };

// Slot X offsets from tray center for each utility type.
// Everything rides inside the tray.
export const PIPE_SLOTS = {
  cryoTransfer: -0.25,
  vacuumPipe:   -0.12,
  rfWaveguide:   0.0,
  coolingWater:   0.12,
  powerCable:   -0.30,
  dataFiber:     0.30,
};

// Pipe Y: everything rests on the tray bottom
export const PIPE_Y = RACK_HEIGHT - RACK_TRAY_DEPTH;

/**
 * Neighbor anchor positions for a rack segment at (col, row) in tile coords.
 * Segments are 1 tile apart.
 */
export function rackNeighborAnchors(col, row) {
  return {
    north: { col, row: row - 1 },
    south: { col, row: row + 1 },
    west:  { col: col - 1, row },
    east:  { col: col + 1, row },
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
