// src/renderer3d/builders/port-fitting-builder.js
//
// The physical connectors on equipment: a small flange on the shell wherever a
// component declares a utility port.
//
// These are NOT interactive feedback. The available-port dots
// (utility-line-builder-v2.setAvailablePorts) appear only while a utility tool
// is armed and answer "what can I click right now"; fittings are always on and
// answer "what can this device be plugged into", which is a property of the
// machine and should be legible when no tool is armed at all. Without them a
// cable arrives at a blank wall of geometry.
//
// Kept deliberately small and desaturated: a hall with a hundred wired
// components has a hundred of these, and they must read as hardware detail
// rather than as UI.
//
// THREE is loaded as a CDN global — do NOT import it.

import { COMPONENTS } from '../../data/components.js';
import { portAnchor3D } from '../../utility/port-anchors.js';
import { UTILITY_TYPES } from '../../utility/registry.js';

const COLLAR_R = 0.075;   // flange plate radius, metres
const COLLAR_T = 0.025;   // flange plate thickness
const STUB_R = 0.035;     // spigot radius
const STUB_L = 0.07;      // spigot length

const _matCache = new Map();

function getFittingMaterial(color) {
  if (_matCache.has(color)) return _matCache.get(color);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.45,
    metalness: 0.55,
    // Just enough glow to stay readable against a dark shell, far below the
    // port markers — these are hardware, not a highlight.
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.18,
  });
  mat.userData.__shared = true;
  _matCache.set(color, mat);
  return mat;
}

/**
 * One fitting: a collar flat against the shell with a spigot standing out of
 * it, both aligned with the port's outward normal.
 */
export function buildPortFitting(anchor, color) {
  const mat = getFittingMaterial(color);
  const g = new THREE.Group();
  const out = anchor.out || { x: 0, z: 0 };
  const horizontal = Math.abs(out.x) > 1e-6 || Math.abs(out.z) > 1e-6;

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(COLLAR_R, COLLAR_R, COLLAR_T, 8), mat);
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(STUB_R, STUB_R, STUB_L, 8), mat);
  if (horizontal) {
    // Cylinders are Y-aligned; lay them along the outward normal.
    const axis = new THREE.Vector3(out.x, 0, out.z).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    collar.quaternion.copy(quat);
    stub.quaternion.copy(quat);
    collar.position.set(axis.x * (COLLAR_T / 2), 0, axis.z * (COLLAR_T / 2));
    stub.position.set(axis.x * (COLLAR_T + STUB_L / 2), 0, axis.z * (COLLAR_T + STUB_L / 2));
  } else {
    collar.position.set(0, COLLAR_T / 2, 0);
    stub.position.set(0, COLLAR_T + STUB_L / 2, 0);
  }
  g.add(collar);
  g.add(stub);
  g.position.set(anchor.x, anchor.y, anchor.z);
  g.userData = { isUtilityPortFitting: true };
  return g;
}

/**
 * Every declared utility port on every endpoint, as fittings.
 *
 * @param {Array} endpoints listUtilityEndpoints(state)
 * @returns {{group: THREE.Group, count: number}}
 */
export function buildPortFittings(endpoints) {
  const group = new THREE.Group();
  group.userData = { isUtilityPortFittings: true };
  let count = 0;
  for (const ep of endpoints || []) {
    const def = COMPONENTS[ep.type];
    if (!def || !def.ports) continue;
    for (const [name, spec] of Object.entries(def.ports)) {
      if (!spec || !spec.utility) continue;
      const anchor = portAnchor3D(ep, def, name);
      if (!anchor) continue;
      const color = UTILITY_TYPES[spec.utility]?.color || '#999999';
      group.add(buildPortFitting(anchor, color));
      count++;
    }
  }
  return { group, count };
}

/**
 * Signature over what the fittings depend on — endpoint identity, type, pose.
 * Anything else about the world can change without touching them.
 */
export function portFittingSignature(endpoints) {
  const parts = [];
  for (const ep of endpoints || []) {
    const def = COMPONENTS[ep.type];
    if (!def || !def.ports) continue;
    if (!Object.values(def.ports).some(s => s && s.utility)) continue;
    parts.push(`${ep.id}:${ep.type}:${ep.col},${ep.row},${ep.subCol || 0},${ep.subRow || 0},${ep.dir || 0}`);
  }
  return parts.join(';');
}

export default buildPortFittings;
