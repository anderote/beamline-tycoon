// src/renderer3d/equipment-builder.js
// Renders equipment and zone furnishings as 3D boxes with per-face
// textured materials. Each box uses a 6-entry material array (one per
// face) so a face can independently use a tiled MATERIAL or a DECAL.
// THREE is a CDN global — do NOT import it.

import { PLACEABLES } from '../data/placeables/index.js';
import { MATERIALS } from './materials/index.js';
import { DECALS } from './materials/decals.js';
import { applyTiledBoxUVs } from './uv-utils.js';
import { buildPortStubs } from './utility-port-builder.js';

// BoxGeometry face order is [+X, -X, +Y, -Y, +Z, -Z]; each face has 4 UVs,
// 8 floats per face in the uv attribute array.
const FACE_INDEX = { '+X': 0, '-X': 1, '+Y': 2, '-Y': 3, '+Z': 4, '-Z': 5 };

const SUB_UNIT = 0.5;

// Cache per (compType + faceKey + base + override) -> material so identical
// face configs share. Module-level cache lives across rebuilds and instances.
const _equipMatCache = new Map();

// Cache for simple single-material parts (no per-face overrides) keyed on
// `baseName|colorHex` so every leg/top/shelf sharing the same spec reuses
// a single MeshStandardMaterial.
const _partMatCache = new Map();

function _partMaterial(baseName, colorHex) {
  const key = `${baseName || '-'}|${colorHex ?? 'x'}`;
  let m = _partMatCache.get(key);
  if (m) return m;
  let map = null;
  let color = colorHex ?? 0x888888;
  if (baseName && MATERIALS[baseName]) {
    map = MATERIALS[baseName].map;
    if (colorHex == null) color = 0xffffff;
  }
  m = new THREE.MeshStandardMaterial({
    map, color, roughness: 0.7, metalness: 0.15,
  });
  _partMatCache.set(key, m);
  return m;
}

function _faceMaterial(compType, faceKey, baseName, faceOverride, fallbackColor) {
  const cacheKey = `${compType}|${faceKey}|${baseName}|${faceOverride ? JSON.stringify(faceOverride) : ''}`;
  let m = _equipMatCache.get(cacheKey);
  if (m) return m;

  if (faceOverride && faceOverride.decal && DECALS[faceOverride.decal]) {
    m = DECALS[faceOverride.decal];
    _equipMatCache.set(cacheKey, m);
    return m;
  }

  if (faceOverride && faceOverride.material && MATERIALS[faceOverride.material]) {
    m = MATERIALS[faceOverride.material];
    _equipMatCache.set(cacheKey, m);
    return m;
  }

  let map = null;
  let color = fallbackColor;
  if (baseName && MATERIALS[baseName]) {
    map = MATERIALS[baseName].map;
    color = 0xffffff;
  }
  m = new THREE.MeshStandardMaterial({
    map,
    color,
    roughness: 0.7,
    metalness: 0.2,
  });
  _equipMatCache.set(cacheKey, m);
  return m;
}

// Rewrite a single face's UVs to span 0→1 (needed for decal faces so the
// full decal texture shows instead of being cropped by the tiled UV span).
function _setFaceUVsClamped(geometry, faceKey) {
  const uv = geometry.attributes.uv;
  if (!uv) return;
  const face = FACE_INDEX[faceKey];
  if (face == null) return;
  const arr = uv.array;
  const off = face * 8;
  arr[off + 0] = 0; arr[off + 1] = 1;
  arr[off + 2] = 1; arr[off + 3] = 1;
  arr[off + 4] = 0; arr[off + 5] = 0;
  arr[off + 6] = 1; arr[off + 7] = 0;
  uv.needsUpdate = true;
}

export class EquipmentBuilder {
  constructor() {
    /** @type {THREE.Mesh[]} */
    this._meshes = [];
  }

  /**
   * Build equipment and furnishing meshes from snapshot data.
   * @param {Array} equipmentData
   * @param {Array} furnishingData
   * @param {THREE.Group} parentGroup
   */
  build(equipmentData, furnishingData, parentGroup) {
    this.dispose(parentGroup);

    const FACE_KEYS = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

    const placeOne = (item, isFurnishing) => {
      const compDef = PLACEABLES[item.type];
      if (!compDef && !isFurnishing) return;

      // Footprint (in subtiles) — must match Placeable.footprintCells, which
      // swaps subW/subL when dir is 1 or 3. The visual mesh/group is then
      // rotated around its center (set below) so geometry matches occupancy.
      const dir = item.dir || 0;
      const swapFoot = (dir === 1 || dir === 3);
      const defW = compDef?.subW || (isFurnishing ? 1 : 2);
      const defL = compDef?.subL || compDef?.subH || (isFurnishing ? 1 : 2);
      const footW = (swapFoot ? defL : defW) * SUB_UNIT;
      const footL = (swapFoot ? defW : defL) * SUB_UNIT;

      const tileX = (item.col ?? 0) * 2;
      const tileZ = (item.row ?? 0) * 2;
      const subX = (item.subCol || 0) * SUB_UNIT;
      const subZ = (item.subRow || 0) * SUB_UNIT;
      const centerX = tileX + subX + footW / 2;
      const centerZ = tileZ + subZ + footL / 2;
      const baseY = (item.placeY || 0) * SUB_UNIT;
      const rotY = -dir * (Math.PI / 2);
      const fallbackColor = compDef?.spriteColor || compDef?.color || 0x888888;
      const baseName = compDef?.baseMaterial || null;

      // ── Parts path ────────────────────────────────────────────────
      // If the def lists `parts`, build a Group with one Mesh per part.
      // Part coords are in SUBTILES, centered on the footprint, with
      // y=0 at the floor and y increasing upward. w/h/l are subtile-
      // unit sizes. Each part may override baseMaterial/color.
      if (Array.isArray(compDef?.parts) && compDef.parts.length > 0) {
        const group = new THREE.Group();
        for (const part of compDef.parts) {
          const pw = (part.w || 1) * SUB_UNIT;
          const ph = (part.h || 1) * SUB_UNIT;
          const pl = (part.l || 1) * SUB_UNIT;
          const geo = new THREE.BoxGeometry(pw, ph, pl);
          applyTiledBoxUVs(geo, pw, ph, pl);
          const partBase = part.material ?? baseName;
          const partColor = part.color ?? (partBase ? null : fallbackColor);
          const mat = _partMaterial(partBase, partColor);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // Part position: (x, z) is the part's center in the footprint-
          // centered plane; y is its BOTTOM (easier to author), so we
          // lift by h/2 to get the BoxGeometry center.
          mesh.position.set(
            (part.x || 0) * SUB_UNIT,
            ((part.y || 0) + (part.h || 1) / 2) * SUB_UNIT,
            (part.z || 0) * SUB_UNIT,
          );
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();
          group.add(mesh);
        }
        group.position.set(centerX, baseY, centerZ);
        group.rotation.y = rotY;
        group.matrixAutoUpdate = false;
        group.updateMatrix();
        if (!isFurnishing) {
          const portStubs = buildPortStubs(
            item.type,
            ((compDef.subW || compDef.gridW || 2) * SUB_UNIT) / 2,
            (compDef.subL || compDef.gridH || 2) * SUB_UNIT,
          );
          if (portStubs) group.add(portStubs);
        }
        parentGroup.add(group);
        this._meshes.push(group);
        return;
      }

      // ── Single-box path ──────────────────────────────────────────
      // Visual dims — may be smaller (or larger) than the footprint so a
      // benchtop instrument can take a full subtile of room but render at
      // realistic scale. Defaults to the footprint when not authored.
      const vSubW = compDef?.visualSubW ?? compDef?.subW ?? (isFurnishing ? 1 : 2);
      const vSubH = compDef?.visualSubH ?? compDef?.subH ?? (isFurnishing ? 1 : 2);
      const vSubL = compDef?.visualSubL ?? compDef?.subL ?? compDef?.subH ?? (isFurnishing ? 1 : 2);
      const w = vSubW * SUB_UNIT;
      const h = vSubH * SUB_UNIT;
      const l = vSubL * SUB_UNIT;

      const geo = new THREE.BoxGeometry(w, h, l);
      applyTiledBoxUVs(geo, w, h, l);

      const faces = compDef?.faces || {};

      for (const key of FACE_KEYS) {
        if (faces[key]?.decal) _setFaceUVsClamped(geo, key);
      }

      const matArray = FACE_KEYS.map(key =>
        _faceMaterial(item.type, key, baseName, faces[key], fallbackColor)
      );

      const mesh = new THREE.Mesh(geo, matArray);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.position.set(0, h / 2, 0);
      mesh.updateMatrix();

      const wrapper = new THREE.Group();
      wrapper.position.set(centerX, baseY, centerZ);
      wrapper.rotation.y = rotY;
      wrapper.matrixAutoUpdate = false;
      wrapper.add(mesh);
      if (!isFurnishing) {
        const portStubs = buildPortStubs(
          item.type,
          ((compDef?.subW || compDef?.gridW || 2) * SUB_UNIT) / 2,
          (compDef?.subL || compDef?.gridH || 2) * SUB_UNIT,
        );
        if (portStubs) wrapper.add(portStubs);
      }
      wrapper.updateMatrix();

      parentGroup.add(wrapper);
      this._meshes.push(wrapper);
    };

    if (equipmentData) for (const eq of equipmentData) placeOne(eq, false);
    if (furnishingData) for (const furn of furnishingData) placeOne(furn, true);
  }

  /**
   * Remove all meshes from group and dispose geometries. Materials live in
   * _equipMatCache and are shared across instances and rebuilds — DO NOT
   * dispose them here.
   * @param {THREE.Group} parentGroup
   */
  dispose(parentGroup) {
    for (const obj of this._meshes) {
      parentGroup.remove(obj);
      obj.traverse((child) => {
        if (child.isMesh && child.geometry) child.geometry.dispose();
      });
    }
    this._meshes = [];
  }
}
