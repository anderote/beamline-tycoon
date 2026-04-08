// Direction constants for isometric track-laying
export const DIR = { NE: 0, SE: 1, SW: 2, NW: 3 };
export const DIR_NAMES = ['NE', 'SE', 'SW', 'NW'];
export const DIR_DELTA = [
  { dc: 0, dr: -1 },  // NE — along -row axis, visually upper-right on grid
  { dc: 1, dr: 0 },   // SE — along +col axis, visually lower-right on grid
  { dc: 0, dr: 1 },   // SW — along +row axis, visually lower-left on grid
  { dc: -1, dr: 0 },  // NW — along -col axis, visually upper-left on grid
];
export function turnLeft(dir) { return (dir + 3) % 4; }
export function turnRight(dir) { return (dir + 1) % 4; }
export function reverseDir(dir) { return (dir + 2) % 4; }

// Isometric tile dimensions
export const TILE_W = 64;
export const TILE_H = 32;
