/** Roofs are an explicit fifth architectural view; every wall-only mode hides them. */
export function roofVisibleForWallMode(wallMode) {
  return wallMode === 'roof';
}
