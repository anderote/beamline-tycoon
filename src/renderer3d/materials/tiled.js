// src/renderer3d/materials/tiled.js
// Loads and caches tiled MeshStandardMaterial instances for base materials.
// THREE is a CDN global — do NOT import it.

const BASE = 'assets/textures/materials/';

const _loader = new THREE.TextureLoader();

function loadTiled(file) {
  const tex = _loader.load(BASE + file);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

function makeMat(file, { roughness = 0.6, metalness = 0.3 } = {}) {
  return new THREE.MeshStandardMaterial({
    map: loadTiled(file),
    roughness,
    metalness,
  });
}

/**
 * Map of material name -> shared MeshStandardMaterial instance.
 * These are module-level singletons. Do NOT dispose them from builders.
 * Adding a new material: add a PNG, add an entry here.
 */
export const MATERIALS = {
  metal_dark:          makeMat('metal_dark.png',          { roughness: 0.5, metalness: 0.5 }),
  metal_brushed:       makeMat('metal_brushed.png',       { roughness: 0.4, metalness: 0.6 }),
  metal_painted_white: makeMat('metal_painted_white.png', { roughness: 0.6, metalness: 0.2 }),
  copper:              makeMat('copper.png',              { roughness: 0.4, metalness: 0.6 }),
  concrete_floor:      makeMat('concrete_floor.png',      { roughness: 0.9, metalness: 0.0 }),
  concrete_wall:       makeMat('concrete_wall.png',       { roughness: 0.9, metalness: 0.0 }),
  drywall_painted:     makeMat('drywall_painted.png',     { roughness: 0.8, metalness: 0.0 }),
  rubber_mat:          makeMat('rubber_mat.png',          { roughness: 0.95, metalness: 0.0 }),
  tile_floor_white:    makeMat('tile_floor_white.png',    { roughness: 0.5, metalness: 0.0 }),
  rack_vent_mesh:      makeMat('rack_vent_mesh.png',      { roughness: 0.7, metalness: 0.4 }),
  cable_tray:          makeMat('cable_tray.png',          { roughness: 0.7, metalness: 0.3 }),
  // Tile materials extracted from hand-painted isometric diamond PNGs
  tile_controlRoom: makeMat('tile_controlRoom.png', { roughness: 0.9, metalness: 0.0 }),
  tile_machineShop: makeMat('tile_machineShop.png', { roughness: 0.9, metalness: 0.0 }),
  tile_maintenance: makeMat('tile_maintenance.png', { roughness: 0.9, metalness: 0.0 }),
  tile_officeSpace: makeMat('tile_officeSpace.png', { roughness: 0.9, metalness: 0.0 }),
  tile_rfLab:       makeMat('tile_rfLab.png',       { roughness: 0.9, metalness: 0.0 }),
  tile_vacuumLab:   makeMat('tile_vacuumLab.png',   { roughness: 0.9, metalness: 0.0 }),
  tile_brick:       makeMat('tile_brick.png',       { roughness: 0.9, metalness: 0.0 }),
  tile_cobblestone: makeMat('tile_cobblestone.png', { roughness: 0.9, metalness: 0.0 }),
  tile_concrete:    makeMat('tile_concrete.png',    { roughness: 0.9, metalness: 0.0 }),
  tile_dirt:        makeMat('tile_dirt.png',        { roughness: 0.9, metalness: 0.0 }),
  tile_hallway:     makeMat('tile_hallway.png',     { roughness: 0.9, metalness: 0.0 }),
  tile_labFloor:    makeMat('tile_labFloor.png',    { roughness: 0.9, metalness: 0.0 }),
  tile_officeFloor: makeMat('tile_officeFloor.png', { roughness: 0.9, metalness: 0.0 }),
  tile_pavement:    makeMat('tile_pavement.png',    { roughness: 0.9, metalness: 0.0 }),
};
