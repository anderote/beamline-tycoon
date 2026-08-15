// Shared emissive-material and mesh tagging helpers for beamline components,
// facility equipment, and furnishings. THREE is a CDN global — do NOT import it.

import { BLOOM_LAYER } from './glow-pipeline.js';

const GLOW_BASE_EMISSIVE_INTENSITY = 4.0;
const GLOW_BASE_ROUGHNESS = 0.35;
const GLOW_BASE_METALNESS = 0.1;

/** Cache of (machine type + color) -> shared MeshStandardMaterial. */
const _glowMatCache = new Map();
/** Registry used by the renderer's single day/night glow dial. */
const _glowMatRegistry = new Set();
let _glowNightFactor = 1;

/**
 * Return a cached, night-aware emissive material. A dark albedo keeps the
 * surface readable as glass when the emission is washed out by daylight.
 */
export function getGlowMaterial(machineType, colorHex) {
  const key = `${machineType}|${colorHex.toString(16).padStart(6, '0')}`;
  let material = _glowMatCache.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      emissive: colorHex,
      emissiveIntensity: GLOW_BASE_EMISSIVE_INTENSITY * _glowNightFactor,
      roughness: GLOW_BASE_ROUGHNESS,
      metalness: GLOW_BASE_METALNESS,
    });
    _glowMatCache.set(key, material);
    _glowMatRegistry.add(material);
  }
  return material;
}

/** Scale every shared glow material in lockstep with the day/night grade. */
export function setGlowNightFactor(value) {
  _glowNightFactor = Math.max(0, Math.min(1, Number(value) || 0));
  const intensity = GLOW_BASE_EMISSIVE_INTENSITY * _glowNightFactor;
  for (const material of _glowMatRegistry) material.emissiveIntensity = intensity;
}

/**
 * Opt a mesh into bloom and the surface-animation system. `light: false`
 * keeps tiny LEDs visual-only; a descriptor lets one representative surface
 * compete for LightRig's bounded real point-light pool.
 */
export function configureGlowMesh(mesh, { profile = 'steady', light } = {}) {
  if (!mesh) return mesh;
  mesh.userData ||= {};
  mesh.userData.role = 'glow';
  mesh.userData.effectProfile = profile;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.layers?.enable(BLOOM_LAYER);
  if (light === false) {
    mesh.userData.ambientLight = false;
    delete mesh.userData.effectLightEmitter;
  } else if (light && typeof light === 'object') {
    mesh.userData.ambientLight = true;
    mesh.userData.effectLightEmitter = { ...light };
  }
  return mesh;
}
