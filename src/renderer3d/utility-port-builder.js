// src/renderer3d/utility-port-builder.js
//
// Builds colored port stub meshes on component lateral side faces.
// THREE is a CDN global — do NOT import it.

import { getUtilityPorts, UTILITY_PORT_PROFILES } from '../data/utility-ports.js';

const STUB_LENGTH = 0.15;
const PORT_Y = 0.5;
const SEGS = 8;

const _matCache = {};

function getPortMaterial(connType) {
  if (_matCache[connType]) return _matCache[connType];
  const profile = UTILITY_PORT_PROFILES[connType];
  if (!profile) return null;
  const mat = new THREE.MeshStandardMaterial({
    color: profile.color,
    roughness: 0.4,
    metalness: 0.3,
  });
  _matCache[connType] = mat;
  return mat;
}

function createStubGeometry(connType) {
  const profile = UTILITY_PORT_PROFILES[connType];
  if (!profile) return null;
  if (profile.shape === 'rect') {
    return new THREE.BoxGeometry(STUB_LENGTH, profile.height, profile.width);
  }
  return new THREE.CylinderGeometry(profile.radius, profile.radius, STUB_LENGTH, SEGS);
}

/**
 * Build port stubs for a component.
 * @param {string} compId — component or infrastructure ID
 * @param {number} sideHalfW — half-width of the component along X (lateral axis), in world units
 * @param {number} sideLength — length of the component along Z (beam axis), in world units
 * @returns {THREE.Group|null} — group of stub meshes, or null if no ports
 */
export function buildPortStubs(compId, sideHalfW, sideLength) {
  const ports = getUtilityPorts(compId);
  if (!ports || ports.length === 0) return null;

  const group = new THREE.Group();

  for (const port of ports) {
    const profile = UTILITY_PORT_PROFILES[port.type];
    if (!profile) continue;

    const geo = createStubGeometry(port.type);
    if (!geo) continue;
    const mat = getPortMaterial(port.type);

    const zPos = (port.offset - 0.5) * sideLength;

    for (const side of [-1, 1]) {
      const stub = new THREE.Mesh(geo, mat);
      stub.matrixAutoUpdate = false;

      const xPos = side * (sideHalfW + STUB_LENGTH / 2);

      if (profile.shape === 'rect') {
        stub.position.set(xPos, PORT_Y, zPos);
      } else {
        stub.position.set(xPos, PORT_Y, zPos);
        stub.rotation.z = Math.PI / 2;
      }
      stub.updateMatrix();
      group.add(stub);
    }
  }

  return group.children.length > 0 ? group : null;
}
