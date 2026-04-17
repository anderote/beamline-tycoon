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

function makeMat(file, { roughness = 0.6, metalness = 0.3, alphaTest = 0 } = {}) {
  const opts = { map: loadTiled(file), roughness, metalness };
  if (alphaTest > 0) { opts.alphaTest = alphaTest; opts.transparent = true; }
  return new THREE.MeshStandardMaterial(opts);
}

/**
 * Procedurally generates a 64x64 flower-bed tile texture: dark soil base
 * with saturated dots in rough rows (cultivated flowers) + short leaf strokes.
 * First procedural CanvasTexture in this module; all other entries load PNGs.
 */
function gen_flowerBed(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Soil base (dark brown with slight variation)
  ctx.fillStyle = '#3a2820';
  ctx.fillRect(0, 0, size, size);
  // Noise freckles of slightly lighter soil
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = `rgba(80, 56, 40, ${0.3 + Math.random() * 0.4})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // Leaf strokes (short green lines)
  ctx.strokeStyle = '#3b6e2b';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const a = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3);
    ctx.stroke();
  }

  // Flower dots in rough rows (3 rows, jittered)
  const palette = ['#ffe14d', '#f2f2f2', '#ffe14d', '#ff8fa3',
                   '#c58df5', '#ffe14d', '#e84a4a', '#7db9ff'];
  const rows = 3;
  const perRow = 7;
  for (let r = 0; r < rows; r++) {
    const baseY = (r + 0.5) * size / rows;
    for (let i = 0; i < perRow; i++) {
      const x = (i + 0.5) * size / perRow + (Math.random() - 0.5) * 4;
      const y = baseY + (Math.random() - 0.5) * 4;
      const col = palette[Math.floor(Math.random() * palette.length)];
      const rad = 2 + Math.random() * 1.5;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
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
  wall_cement:         makeMat('wall_cement.png',         { roughness: 0.9, metalness: 0.0 }),
  wall_shingle:        makeMat('wall_shingle.png',        { roughness: 0.85, metalness: 0.0 }),
  wall_siding:         makeMat('wall_siding.png',         { roughness: 0.8, metalness: 0.0 }),
  wall_brick:          makeMat('wall_brick.png',          { roughness: 0.9, metalness: 0.0 }),
  wall_chain_link:     makeMat('wall_chain_link.png',     { roughness: 0.5, metalness: 0.6 }),
  wall_barbed_wire:    makeMat('wall_barbed_wire.png',    { roughness: 0.5, metalness: 0.6 }),
  rubber_mat:          makeMat('rubber_mat.png',          { roughness: 0.95, metalness: 0.0 }),
  tile_floor_white:    makeMat('tile_floor_white.png',    { roughness: 0.5, metalness: 0.0 }),
  rack_vent_mesh:      makeMat('rack_vent_mesh.png',      { roughness: 0.7, metalness: 0.4 }),
  cable_tray:          makeMat('cable_tray.png',          { roughness: 0.7, metalness: 0.3 }),
  metal_painted_red:    makeMat('metal_painted_red.png',    { roughness: 0.6, metalness: 0.2 }),
  metal_painted_blue:   makeMat('metal_painted_blue.png',   { roughness: 0.6, metalness: 0.2 }),
  metal_painted_green:  makeMat('metal_painted_green.png',  { roughness: 0.6, metalness: 0.2 }),
  metal_painted_yellow: makeMat('metal_painted_yellow.png', { roughness: 0.6, metalness: 0.2 }),
  metal_painted_gray:   makeMat('metal_painted_gray.png',   { roughness: 0.6, metalness: 0.2 }),
  metal_corrugated:     makeMat('metal_corrugated.png',     { roughness: 0.5, metalness: 0.5 }),
  cryo_frost:           makeMat('cryo_frost.png',           { roughness: 0.85, metalness: 0.05 }),
  hazard_stripe:        makeMat('hazard_stripe.png',        { roughness: 0.7, metalness: 0.15 }),
  // Tile materials extracted from hand-painted isometric diamond PNGs (floor surfaces only)
  tile_brick:       makeMat('tile_brick.png',       { roughness: 0.9, metalness: 0.0 }),
  tile_cobblestone: makeMat('tile_cobblestone.png', { roughness: 0.9, metalness: 0.0 }),
  tile_concrete:    makeMat('tile_concrete.png',    { roughness: 0.9, metalness: 0.0 }),
  tile_dirt:        makeMat('tile_dirt.png',        { roughness: 0.9, metalness: 0.0 }),
  tile_rocky_dirt:  makeMat('tile_rocky_dirt.png',  { roughness: 1.0, metalness: 0.0 }),
  tile_grass:       makeMat('tile_grass.png',       { roughness: 0.95, metalness: 0.0 }),
  tile_groomedGrass: makeMat('tile_groomedGrass.png', { roughness: 0.95, metalness: 0.0 }),
  tile_flower_bed:  new THREE.MeshStandardMaterial({ map: gen_flowerBed(64), roughness: 0.95, metalness: 0.0 }),
  tile_hallway:     makeMat('tile_hallway.png',     { roughness: 0.9, metalness: 0.0 }),
  tile_hardwood:         makeMat('tile_hardwood.png',         { roughness: 0.7, metalness: 0.0 }),
  tile_hardwood_birch:   makeMat('tile_hardwood_birch.png',   { roughness: 0.7, metalness: 0.0 }),
  tile_hardwood_oak:     makeMat('tile_hardwood_oak.png',     { roughness: 0.7, metalness: 0.0 }),
  tile_carpet_diamond:   makeMat('tile_carpet_diamond.png',   { roughness: 0.95, metalness: 0.0 }),
  tile_labFloor:         makeMat('tile_labFloor.png',         { roughness: 0.9, metalness: 0.0 }),
  tile_lab_check_black:  makeMat('tile_lab_check_black.png',  { roughness: 0.5, metalness: 0.0 }),
  tile_lab_check_red:    makeMat('tile_lab_check_red.png',    { roughness: 0.5, metalness: 0.0 }),
  tile_lab_houndstooth:  makeMat('tile_lab_houndstooth.png',  { roughness: 0.5, metalness: 0.0 }),
  tile_officeFloor: makeMat('tile_officeFloor.png', { roughness: 0.9, metalness: 0.0 }),
  tile_pavement:    makeMat('tile_pavement.png',    { roughness: 0.9, metalness: 0.0 }),
  // Door panel textures (non-tiling, mapped 1:1 across panel face)
  door_double:         makeMat('door_double.png',         { roughness: 0.6, metalness: 0.3 }),
  door_security:       makeMat('door_security.png',       { roughness: 0.7, metalness: 0.4 }),
  door_office:         makeMat('door_office.png',         { roughness: 0.8, metalness: 0.0 }),
  door_fire:           makeMat('door_fire.png',           { roughness: 0.7, metalness: 0.2 }),
  door_lab:            makeMat('door_lab.png',            { roughness: 0.6, metalness: 0.2 }),
  door_chain_link:     makeMat('door_chain_link.png',     { roughness: 0.5, metalness: 0.5, alphaTest: 0.3 }),
  door_wood_gate:      makeMat('door_wood_gate.png',      { roughness: 0.8, metalness: 0.0 }),
  door_security_gate:  makeMat('door_security_gate.png',  { roughness: 0.5, metalness: 0.5, alphaTest: 0.3 }),
  door_rolling_shutter: makeMat('door_rolling_shutter.png', { roughness: 0.5, metalness: 0.4 }),
};
