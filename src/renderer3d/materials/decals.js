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
  // Populated in Task 9 onwards. Example shape:
  // server_rack_front: makeDecal('server_rack_front.png'),
};

// Re-export so tests / future code can construct ad-hoc decal materials.
export { makeDecal };
