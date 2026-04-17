// src/renderer3d/materials/decals.js
// Loads and caches decal MeshStandardMaterial instances for hero faces.
// THREE is a CDN global — do NOT import it.
//
// Decals use ClampToEdgeWrapping (no tiling) and 0→1 face UVs. The
// authored PNG should match the target face aspect ratio.
//
// Initially empty — populated as decals are authored or generated.

const BASE = 'assets/textures/decals/';

const _loader = new THREE.TextureLoader();

function loadDecal(file) {
  const tex = _loader.load(BASE + file);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

function makeDecal(file, { roughness = 0.5, metalness = 0.2 } = {}) {
  return new THREE.MeshStandardMaterial({
    map: loadDecal(file),
    roughness,
    metalness,
  });
}

/**
 * Creates a soft-radial-gradient alpha texture used for ground flower decals.
 * White with alpha fading from 1.0 at center to 0.0 at edge. Small (32x32)
 * since it's rendered at ~0.2 world units.
 */
function gen_radialDot(size = 32) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

/** Shared procedural textures (not loaded from PNGs). Module-level singletons. */
export const PROC_DECAL_TEXTURES = {
  flower_dot: gen_radialDot(32),
};

/**
 * Map of decal name -> shared MeshStandardMaterial instance.
 * Populated incrementally as decals are authored. Module-level singletons.
 */
export const DECALS = {
  scope_screen: makeDecal('scope_screen.png', { roughness: 0.35, metalness: 0.1 }),
  // RF lab front-panel decals — full instrument face with bezel, screen,
  // knobs, buttons. PNG aspect matches visualSubW : visualSubH so the
  // pixel grid stays square when stretched across the 0→1 face UVs.
  oscilloscope_front:      makeDecal('oscilloscope_front.png',      { roughness: 0.6, metalness: 0.15 }),
  signal_generator_front:  makeDecal('signal_generator_front.png',  { roughness: 0.6, metalness: 0.2 }),
  spectrum_analyzer_front: makeDecal('spectrum_analyzer_front.png', { roughness: 0.6, metalness: 0.15 }),
  network_analyzer_front:  makeDecal('network_analyzer_front.png',  { roughness: 0.6, metalness: 0.15 }),
  oscilloscope_side:       makeDecal('oscilloscope_side.png',       { roughness: 0.7, metalness: 0.1 }),
  signal_generator_side:   makeDecal('signal_generator_side.png',   { roughness: 0.7, metalness: 0.15 }),
  spectrum_analyzer_side:  makeDecal('spectrum_analyzer_side.png',  { roughness: 0.7, metalness: 0.1 }),
  network_analyzer_side:   makeDecal('network_analyzer_side.png',   { roughness: 0.7, metalness: 0.1 }),

  // RF power
  klystron_pulsed_front:    makeDecal('klystron_pulsed_front.png',    { roughness: 0.6, metalness: 0.25 }),
  klystron_cw_front:        makeDecal('klystron_cw_front.png',        { roughness: 0.6, metalness: 0.25 }),
  klystron_multibeam_front: makeDecal('klystron_multibeam_front.png', { roughness: 0.6, metalness: 0.25 }),
  modulator_front:          makeDecal('modulator_front.png',          { roughness: 0.6, metalness: 0.2 }),
  ssa_rack_front:           makeDecal('ssa_rack_front.png',           { roughness: 0.6, metalness: 0.2 }),
  iot_front:                makeDecal('iot_front.png',                { roughness: 0.6, metalness: 0.25 }),

  // Cooling
  cold_box_front:           makeDecal('cold_box_front.png',           { roughness: 0.6, metalness: 0.2 }),
  he_compressor_front:      makeDecal('he_compressor_front.png',      { roughness: 0.6, metalness: 0.2 }),
  chiller_front:            makeDecal('chiller_front.png',            { roughness: 0.6, metalness: 0.2 }),

  // Vacuum
  bakeout_front:            makeDecal('bakeout_front.png',            { roughness: 0.65, metalness: 0.2 }),

  // Controls / safety / power
  rack_ioc_front:           makeDecal('rack_ioc_front.png',           { roughness: 0.55, metalness: 0.3 }),
  pps_panel:                makeDecal('pps_panel.png',                { roughness: 0.6, metalness: 0.15 }),
  mps_panel:                makeDecal('mps_panel.png',                { roughness: 0.6, metalness: 0.15 }),
  power_panel_front:        makeDecal('power_panel_front.png',        { roughness: 0.6, metalness: 0.2 }),
};

// Re-export so tests / future code can construct ad-hoc decal materials.
export { makeDecal };
