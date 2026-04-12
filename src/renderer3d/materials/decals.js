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
};

// Re-export so tests / future code can construct ad-hoc decal materials.
export { makeDecal };
