// src/renderer3d/camera-sync.js — Project Three.js world positions to screen, sync PixiJS overlay
// THREE is a CDN global — do NOT import it

/**
 * Project a 3D world position through the camera to 2D screen coordinates.
 */
export function worldToScreen(camera, worldX, worldY, worldZ, screenWidth, screenHeight) {
  const vec = new THREE.Vector3(worldX, worldY, worldZ);
  vec.project(camera);
  return {
    x: (vec.x * 0.5 + 0.5) * screenWidth,
    y: (-vec.y * 0.5 + 0.5) * screenHeight,
  };
}

/**
 * Sync a PixiJS world container's transform to match the Three.js camera projection.
 * Projects the world origin and one tile-width offset to determine the correct
 * scale and position for the overlay.
 */
export function syncOverlay(camera, pixiWorld, screenWidth, screenHeight) {
  const origin = worldToScreen(camera, 0, 0, 0, screenWidth, screenHeight);
  const tileRight = worldToScreen(camera, 2, 0, 0, screenWidth, screenHeight);

  const dx = tileRight.x - origin.x;
  const dy = tileRight.y - origin.y;
  const tileScreenW = Math.sqrt(dx * dx + dy * dy);

  // 32 = TILE_W / 2, since gridToIso uses half-tile for X
  const pixiZoom = tileScreenW / 32;

  pixiWorld.scale.set(pixiZoom);
  pixiWorld.x = origin.x;
  pixiWorld.y = origin.y;
}
