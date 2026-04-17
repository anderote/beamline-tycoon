// src/renderer3d/floor-builder.js
// Renders floor tiles as merged BufferGeometry per (type, variant) group.
// Each zone type may declare a `texture` field referencing a material in
// MATERIALS; floors use those materials directly with plain 0..1 UVs (each
// tile is exactly METERS_PER_TILE = 2m on a side, so one full repetition
// fits). The bg mesh provides a solid-color fallback for tiles without a
// texture, and also shows through any transparency in the overlay.
//
// Per-tile Y comes from `cornersY` (populated in world-snapshot.buildFloors
// from the terrain heightmap). Flat tiles have all-zero cornersY and render
// exactly as before — i.e. a tiny Y offset above the terrain surface to
// prevent Z-fighting (0.001 for bg, 0.002 for textured overlay).
//
// THREE is a CDN global — do NOT import it.

import { FLOORS } from '../data/structure.js';
import { MATERIALS } from './materials/index.js';

// Tiny Y offsets above the terrain surface to prevent Z-fighting. Match the
// values used by the previous InstancedMesh implementation.
const BG_Y_OFFSET = 0.001;
const TEX_Y_OFFSET = 0.002;

export class FloorBuilder {
  constructor(textureManager) {
    // textureManager is retained for the constructor signature but no
    // longer used by the floor renderer — floors use MATERIALS directly.
    this._textureManager = textureManager;
    /** @type {THREE.Mesh[]} */
    this._meshes = [];
    this._cacheKey = null;
  }

  /**
   * Build (or rebuild) floor tiles from floorData.
   * @param {Array<{
   *   col: number,
   *   row: number,
   *   type: string,
   *   orientation: string|null,
   *   variant: number|null,
   *   tint: number|null,
   *   cornersY: { nw: number, ne: number, se: number, sw: number },
   * }>} floorData
   * @param {THREE.Group} parentGroup
   */
  build(floorData, parentGroup) {
    if (!floorData || floorData.length === 0) {
      this._cleanup(parentGroup);
      this._cacheKey = '';
      return;
    }

    const newKey = JSON.stringify(floorData);
    if (newKey === this._cacheKey && this._meshes.length > 0) return;

    this._cleanup(parentGroup);

    // Group tiles by type+variant so each group can resolve its own
    // texture (via variantTextures) and tint (via variantTints).
    const byGroup = new Map();
    for (const tile of floorData) {
      const variant = tile.variant ?? 0;
      const groupKey = tile.type + ':' + variant;
      let group = byGroup.get(groupKey);
      if (!group) {
        group = { type: tile.type, variant, tiles: [] };
        byGroup.set(groupKey, group);
      }
      group.tiles.push(tile);
    }

    for (const group of byGroup.values()) {
      const { type, variant, tiles } = group;
      const def = FLOORS[type];
      if (!def) continue;

      const baseColor = def.topColor ?? def.color ?? 0x888888;
      const textureName = def.variantTextures?.[variant] ?? def.texture;
      const matFromCatalog = textureName ? MATERIALS[textureName] : null;
      const variantTint = def.variantTints?.[variant] ?? null;

      // 1) Solid background plane — fills the full square so any transparency
      //    in the textured plane shows the zone's solid color underneath.
      const bgMesh = this._buildBgMesh(tiles, baseColor);
      parentGroup.add(bgMesh);
      this._meshes.push(bgMesh);

      // 2) Textured overlay plane (if a material is mapped for this type) —
      //    plain 0..1 UVs since each tile is exactly METERS_PER_TILE = 2m.
      if (matFromCatalog) {
        const texMesh = this._buildTexMesh(tiles, matFromCatalog, variantTint);
        parentGroup.add(texMesh);
        this._meshes.push(texMesh);
      }
    }

    this._cacheKey = newKey;
  }

  /**
   * Build the solid-color background mesh for a group of tiles.
   * Two triangles per tile, positions derived from cornersY + BG_Y_OFFSET.
   * @param {Array<object>} tiles
   * @param {number} baseColor
   * @returns {THREE.Mesh}
   */
  _buildBgMesh(tiles, baseColor) {
    const n = tiles.length;
    const positions = new Float32Array(n * 4 * 3);
    const indices = new Uint32Array(n * 6);

    for (let i = 0; i < n; i++) {
      const { col, row, cornersY } = tiles[i];
      const x0 = col * 2;
      const x1 = col * 2 + 2;
      const z0 = row * 2;
      const z1 = row * 2 + 2;
      const vBase = i * 4;

      // NW, NE, SE, SW — same corner convention as terrain-builder.
      positions[vBase * 3 + 0] = x0;
      positions[vBase * 3 + 1] = cornersY.nw + BG_Y_OFFSET;
      positions[vBase * 3 + 2] = z0;
      positions[(vBase + 1) * 3 + 0] = x1;
      positions[(vBase + 1) * 3 + 1] = cornersY.ne + BG_Y_OFFSET;
      positions[(vBase + 1) * 3 + 2] = z0;
      positions[(vBase + 2) * 3 + 0] = x1;
      positions[(vBase + 2) * 3 + 1] = cornersY.se + BG_Y_OFFSET;
      positions[(vBase + 2) * 3 + 2] = z1;
      positions[(vBase + 3) * 3 + 0] = x0;
      positions[(vBase + 3) * 3 + 1] = cornersY.sw + BG_Y_OFFSET;
      positions[(vBase + 3) * 3 + 2] = z1;

      // Winding: (NW, SW, NE) + (NE, SW, SE) — matches terrain-builder.
      const iBase = i * 6;
      indices[iBase + 0] = vBase + 0;
      indices[iBase + 1] = vBase + 3;
      indices[iBase + 2] = vBase + 1;
      indices[iBase + 3] = vBase + 1;
      indices[iBase + 4] = vBase + 3;
      indices[iBase + 5] = vBase + 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.9,
      metalness: 0.0,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /**
   * Build the textured overlay mesh for a group of tiles. Tiles may
   * individually set `orientation` (which rotates UVs 90°) and `tint`
   * (per-tile vertex color; falls back to variantTint, then white).
   * @param {Array<object>} tiles
   * @param {object} matFromCatalog - entry from MATERIALS
   * @param {number|null} variantTint
   * @returns {THREE.Mesh}
   */
  _buildTexMesh(tiles, matFromCatalog, variantTint) {
    const n = tiles.length;
    const positions = new Float32Array(n * 4 * 3);
    const uvs = new Float32Array(n * 4 * 2);
    const colors = new Float32Array(n * 4 * 3);
    const indices = new Uint32Array(n * 6);

    const color = new THREE.Color();

    for (let i = 0; i < n; i++) {
      const { col, row, cornersY, tint, orientation } = tiles[i];
      const x0 = col * 2;
      const x1 = col * 2 + 2;
      const z0 = row * 2;
      const z1 = row * 2 + 2;
      const vBase = i * 4;

      // Positions — same corner layout as bg mesh, slightly higher Y offset.
      positions[vBase * 3 + 0] = x0;
      positions[vBase * 3 + 1] = cornersY.nw + TEX_Y_OFFSET;
      positions[vBase * 3 + 2] = z0;
      positions[(vBase + 1) * 3 + 0] = x1;
      positions[(vBase + 1) * 3 + 1] = cornersY.ne + TEX_Y_OFFSET;
      positions[(vBase + 1) * 3 + 2] = z0;
      positions[(vBase + 2) * 3 + 0] = x1;
      positions[(vBase + 2) * 3 + 1] = cornersY.se + TEX_Y_OFFSET;
      positions[(vBase + 2) * 3 + 2] = z1;
      positions[(vBase + 3) * 3 + 0] = x0;
      positions[(vBase + 3) * 3 + 1] = cornersY.sw + TEX_Y_OFFSET;
      positions[(vBase + 3) * 3 + 2] = z1;

      // UVs — default mapping matches PlaneGeometry(2,2).rotateX(-π/2):
      //   NW → (0,1), NE → (1,1), SE → (1,0), SW → (0,0)
      // Orientable tiles (hardwood, groomed grass, brick paving) rotate the
      // texture 90° by spinning the instance around Y in the old code. With
      // a symmetric square, that rotation effectively permutes which UV
      // lands at which world corner. Rotating +π/2 around Y sends local
      // (-1,-1)→(-1,+1), i.e. NW's UV now carried by SW, NE's by NW,
      // SE's by NE, SW's by SE:
      //   NW → (1,1), NE → (1,0), SE → (0,0), SW → (0,1)
      let uNW, vNW, uNE, vNE, uSE, vSE, uSW, vSW;
      if (orientation) {
        uNW = 1; vNW = 1;
        uNE = 1; vNE = 0;
        uSE = 0; vSE = 0;
        uSW = 0; vSW = 1;
      } else {
        uNW = 0; vNW = 1;
        uNE = 1; vNE = 1;
        uSE = 1; vSE = 0;
        uSW = 0; vSW = 0;
      }
      uvs[vBase * 2 + 0] = uNW; uvs[vBase * 2 + 1] = vNW;
      uvs[(vBase + 1) * 2 + 0] = uNE; uvs[(vBase + 1) * 2 + 1] = vNE;
      uvs[(vBase + 2) * 2 + 0] = uSE; uvs[(vBase + 2) * 2 + 1] = vSE;
      uvs[(vBase + 3) * 2 + 0] = uSW; uvs[(vBase + 3) * 2 + 1] = vSW;

      // Per-tile tint (priority: explicit tint → variantTint → white). The
      // old InstancedMesh used setColorAt to drive per-instance multiplicative
      // tint; here we use vertex colors on a material with vertexColors=true,
      // which multiplies against the base color (white) identically.
      if (tint != null) {
        color.set(tint);
      } else if (variantTint != null) {
        color.set(variantTint);
      } else {
        color.set(0xffffff);
      }
      const r = color.r, g = color.g, b = color.b;
      for (let k = 0; k < 4; k++) {
        colors[(vBase + k) * 3 + 0] = r;
        colors[(vBase + k) * 3 + 1] = g;
        colors[(vBase + k) * 3 + 2] = b;
      }

      const iBase = i * 6;
      indices[iBase + 0] = vBase + 0;
      indices[iBase + 1] = vBase + 3;
      indices[iBase + 2] = vBase + 1;
      indices[iBase + 3] = vBase + 1;
      indices[iBase + 4] = vBase + 3;
      indices[iBase + 5] = vBase + 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    // Per-tile tint requires a fresh material that mirrors the catalog
    // one's map but drives color from vertex colors.
    const mat = new THREE.MeshStandardMaterial({
      map: matFromCatalog.map,
      color: 0xffffff,
      roughness: matFromCatalog.roughness,
      metalness: matFromCatalog.metalness,
      vertexColors: true,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /**
   * Remove all meshes from group and dispose resources.
   * @param {THREE.Group} parentGroup
   */
  dispose(parentGroup) {
    this._cleanup(parentGroup);
    this._cacheKey = null;
  }

  _cleanup(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      // bg material and per-group tex material are constructed per-build
      // and owned by the mesh — dispose them. (They're not in MATERIALS;
      // the tex mat is a cloned wrapper with the catalog map.)
      mesh.material.dispose();
    }
    this._meshes = [];
  }
}
