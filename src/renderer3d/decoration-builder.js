// src/renderer3d/decoration-builder.js
// Renders decorations (trees, shrubs, etc.) as 3D geometry.
// THREE is a CDN global — do NOT import it.

import { DECORATIONS_RAW } from '../data/decorations.raw.js';

const SUB = 0.5; // 1 sub-tile = 0.5 world units

// --- Helpers -------------------------------------------------------------

function _trunk(group, radius, height, color) {
  const geo = new THREE.CylinderGeometry(radius * 0.7, radius, height, 6);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height / 2;
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function _sphere(group, radius, y, color, scaleY) {
  const geo = new THREE.SphereGeometry(radius, 7, 5);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  if (scaleY != null) mesh.scale.y = scaleY;
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function _cone(group, radius, height, y, color) {
  const geo = new THREE.ConeGeometry(radius, height, 7);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

// --- Per-species tree builders -------------------------------------------

// Oak: broad, wide canopy — flattened sphere, thick trunk
function _oakTree(footW, footL, totalH) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const trunkH = totalH * 0.4;
  _trunk(group, s * 0.14, trunkH, 0x8b5a2b);
  const r = s * 0.48;
  _sphere(group, r, trunkH + r * 0.45, 0x2d8b2d, 0.7);
  return group;
}

// Maple: irregular crown — two overlapping spheres offset to the sides
function _mapleTree(footW, footL, totalH) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const trunkH = totalH * 0.42;
  _trunk(group, s * 0.11, trunkH, 0x7a4a28);
  const r = s * 0.35;
  const y = trunkH + r * 0.7;
  _sphere(group, r, y, 0xcc5522, 0.85);
  _sphere(group, r * 0.8, y + r * 0.3, 0xdd6633, 0.75).position.x = r * 0.3;
  _sphere(group, r * 0.7, y - r * 0.1, 0xbb4411, 0.8).position.z = r * 0.25;
  return group;
}

// Elm: tall vase shape — vertically stretched sphere, slender trunk
function _elmTree(footW, footL, totalH) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const trunkH = totalH * 0.5;
  _trunk(group, s * 0.09, trunkH, 0x6b3a1a);
  const r = s * 0.38;
  _sphere(group, r, trunkH + r * 0.9, 0x1e6b1e, 1.4);
  return group;
}

// Birch: slender white trunk, small clustered oval canopy
function _birchTree(footW, footL, totalH) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const trunkH = totalH * 0.55;
  _trunk(group, s * 0.07, trunkH, 0xccbbaa);
  const r = s * 0.3;
  const y = trunkH + r * 0.6;
  _sphere(group, r, y, 0x55aa44, 1.2);
  _sphere(group, r * 0.6, y + r * 0.7, 0x66bb55, 1.1);
  return group;
}

// Willow: drooping canopy — sphere on top + a wide skirt cone hanging down
function _willowTree(footW, footL, totalH) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const trunkH = totalH * 0.35;
  _trunk(group, s * 0.12, trunkH, 0x8b5a2b);
  const r = s * 0.35;
  // top crown
  _sphere(group, r, trunkH + r * 0.7, 0x66bb44, 0.8);
  // drooping foliage skirt — inverted-ish cone
  const skirtR = s * 0.45;
  const skirtH = totalH * 0.45;
  const skirtGeo = new THREE.CylinderGeometry(r * 0.6, skirtR, skirtH, 8, 1, true);
  const skirtMat = new THREE.MeshStandardMaterial({
    color: 0x55aa33, roughness: 0.85, side: THREE.DoubleSide,
  });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.position.y = trunkH + r * 0.3 - skirtH * 0.15;
  skirt.castShadow = true;
  group.add(skirt);
  return group;
}

// Small tree: compact round canopy, thin trunk — simple but scaled down
function _smallTree(footW, footL, totalH) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const trunkH = totalH * 0.45;
  _trunk(group, s * 0.1, trunkH, 0x8b6530);
  const r = s * 0.38;
  _sphere(group, r, trunkH + r * 0.6, 0x33aa33);
  return group;
}

// Pine: tall narrow conical silhouette, short trunk
function _pineTree(footW, footL, totalH) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const trunkH = totalH * 0.15;
  _trunk(group, s * 0.08, trunkH, 0x8b5a2b);
  // Two stacked cones for a layered look
  const coneR = s * 0.38;
  const coneH = totalH * 0.55;
  _cone(group, coneR, coneH, trunkH + coneH * 0.5, 0x1a5c1a);
  _cone(group, coneR * 0.65, coneH * 0.6, trunkH + coneH * 0.75, 0x1f6b1f);
  return group;
}

// Cedar: broad spreading shape — wide, shorter layered cones
function _cedarTree(footW, footL, totalH) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const trunkH = totalH * 0.25;
  _trunk(group, s * 0.1, trunkH, 0x9b5533);
  // Three stacked layers, each wider than pine
  const r = s * 0.46;
  const lh = totalH * 0.3;
  _cone(group, r, lh, trunkH + lh * 0.5, 0x1e6b2e);
  _cone(group, r * 0.75, lh * 0.8, trunkH + lh * 0.95, 0x237a33);
  _cone(group, r * 0.45, lh * 0.55, trunkH + lh * 1.3, 0x28853a);
  return group;
}

// Lookup table — maps typeId → per-species builder
const TREE_BUILDERS = {
  oakTree:    _oakTree,
  mapleTree:  _mapleTree,
  elmTree:    _elmTree,
  birchTree:  _birchTree,
  willowTree: _willowTree,
  smallTree:  _smallTree,
  pineTree:   _pineTree,
  cedarTree:  _cedarTree,
};

function _shrub(footW, footL, totalH) {
  const group = new THREE.Group();
  const r = Math.min(footW, footL, totalH) * 0.45;
  const geo = new THREE.SphereGeometry(r, 6, 4);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a7a3a, roughness: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = r;
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}

function _flowerBed(footW, footL, totalH) {
  const group = new THREE.Group();
  const bh = Math.min(totalH * 0.4, 0.15);
  const baseGeo = new THREE.BoxGeometry(footW * 0.85, bh, footL * 0.85);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x3a7a3a, roughness: 0.8 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = bh / 2;
  group.add(base);

  const colors = [0xff4466, 0xffaa22, 0xff66aa, 0xffdd33];
  const count = Math.max(3, Math.round(footW * footL * 4));
  for (let i = 0; i < count; i++) {
    const fr = 0.06;
    const fGeo = new THREE.SphereGeometry(fr, 4, 3);
    const fMat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.6 });
    const flower = new THREE.Mesh(fGeo, fMat);
    const fx = (Math.random() - 0.5) * footW * 0.7;
    const fz = (Math.random() - 0.5) * footL * 0.7;
    flower.position.set(fx, bh + fr, fz);
    group.add(flower);
  }
  return group;
}

function _flowerGarden(footW, footL, totalH) {
  const group = new THREE.Group();
  const bh = Math.min(totalH * 0.3, 0.15);
  const baseGeo = new THREE.BoxGeometry(footW * 0.9, bh, footL * 0.9);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x2e7a2e, roughness: 0.8 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = bh / 2;
  group.add(base);

  const colors = [0xff4466, 0xffaa22, 0xff66aa, 0xffdd33, 0xaa44ff, 0xff6633];
  const count = Math.max(5, Math.round(footW * footL * 6));
  for (let i = 0; i < count; i++) {
    const fr = 0.07;
    const fGeo = new THREE.SphereGeometry(fr, 4, 3);
    const fMat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.6 });
    const flower = new THREE.Mesh(fGeo, fMat);
    const fx = (Math.random() - 0.5) * footW * 0.8;
    const fz = (Math.random() - 0.5) * footL * 0.8;
    flower.position.set(fx, bh + fr + Math.random() * 0.05, fz);
    group.add(flower);
  }
  return group;
}

function _defaultBox(footW, footL, totalH) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(footW * 0.6, totalH * 0.6, footL * 0.6);
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = totalH * 0.3;
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}

// --- Public builder class -----------------------------------------------

export class DecorationBuilder {
  constructor() {
    /** @type {THREE.Group[]} */
    this._groups = [];
  }

  /**
   * Build a single decoration group from type + footprint dims (world units).
   */
  _buildOne(typeId, category, footW, footL, totalH) {
    if (TREE_BUILDERS[typeId]) return TREE_BUILDERS[typeId](footW, footL, totalH);
    if (category === 'treesPlants') {
      // Unknown tree-like — fall back to generic oak shape
      if (totalH > 1.5) return _oakTree(footW, footL, totalH);
    }
    if (typeId === 'shrub')         return _shrub(footW, footL, totalH);
    if (typeId === 'flowerBed')     return _flowerBed(footW, footL, totalH);
    if (typeId === 'flowerGarden')  return _flowerGarden(footW, footL, totalH);
    if (category === 'treesPlants') return _shrub(footW, footL, totalH);
    return _defaultBox(footW, footL, totalH);
  }

  /**
   * Create a ghost preview for placement. Looks up footprint from defs.
   */
  _createGhost(typeId, placeable) {
    const raw = DECORATIONS_RAW[typeId];
    if (!raw) return null;
    const sw = raw.subW ?? raw.gridW ?? 4;
    const sl = raw.subL ?? raw.gridH ?? 4;
    const sh = raw.subH ?? 4;
    return this._buildOne(typeId, raw.category, sw * SUB, sl * SUB, sh * SUB);
  }

  /**
   * Build decoration groups from snapshot data.
   * @param {Array} decorationData - Array of decoration objects from WorldSnapshot
   * @param {THREE.Group} parentGroup
   */
  build(decorationData, parentGroup) {
    this.dispose(parentGroup);
    if (!decorationData) return;

    for (const dec of decorationData) {
      const footW = (dec.subW ?? 4) * SUB;
      const footL = (dec.subL ?? 4) * SUB;
      const totalH = (dec.subH ?? 4) * SUB;

      const group = this._buildOne(dec.type, dec.category, footW, footL, totalH);

      const tileX = (dec.col ?? 0) * 2;
      const tileZ = (dec.row ?? 0) * 2;
      const subX = (dec.subCol ?? 0) * SUB;
      const subZ = (dec.subRow ?? 0) * SUB;
      // Center the geometry within the footprint; sit on terrain via dec.y.
      group.position.set(tileX + subX + footW / 2, dec.y ?? 0, tileZ + subZ + footL / 2);

      parentGroup.add(group);
      this._groups.push(group);
    }
  }

  /**
   * Remove all groups and dispose their geometry and materials.
   * @param {THREE.Group} parentGroup
   */
  dispose(parentGroup) {
    for (const group of this._groups) {
      parentGroup.remove(group);
      group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this._groups = [];
  }
}
