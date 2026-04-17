// src/renderer3d/terrain-builder.js
// Renders ground grass as a single merged BufferGeometry — two triangles
// per tile with per-vertex Y from the tile's 4 corner heights. Per-vertex
// colors carry the brightness tint that gives the patchy-lawn appearance.
// Exposes getMesh() so ThreeRenderer can raycast against the surface.
//
// THREE is a CDN global — do NOT import it.

import { MATERIALS } from './materials/index.js';

export class TerrainBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    /** @type {THREE.Mesh | null} */
    this._mesh = null;
    this._cacheKey = null;
  }

  /**
   * Returns the built terrain mesh, or null if nothing has been built yet.
   * ThreeRenderer uses this for raycasting in place of the flat-plane hack.
   * @returns {THREE.Mesh | null}
   */
  getMesh() {
    return this._mesh;
  }

  /**
   * Build (or rebuild) terrain.
   * @param {Array<{col:number,row:number,hash:number,brightness:number,cornersY:{nw:number,ne:number,se:number,sw:number}}>} terrainData
   * @param {THREE.Group} parentGroup
   * @param {number} [cornerHeightsRevision] — monotonic counter from state;
   *   included in cache key so rebuilds trigger on elevation changes.
   */
  build(terrainData, parentGroup, cornerHeightsRevision = 0) {
    const newKey = terrainData.length + ':' + (cornerHeightsRevision | 0);
    if (newKey === this._cacheKey && this._mesh) return;

    this._cleanup(parentGroup);

    if (terrainData.length === 0) {
      this._cacheKey = newKey;
      return;
    }

    const n = terrainData.length;
    const vertexCount = n * 4;   // 4 corners per tile
    const indexCount = n * 6;    // 2 triangles × 3 indices per tile

    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(indexCount);

    for (let i = 0; i < n; i++) {
      const { col, row, brightness, cornersY } = terrainData[i];

      // Tile spans world-X [col*2 .. col*2+2], world-Z [row*2 .. row*2+2].
      // Per the corner convention (NW=0, NE=1, SE=2, SW=3):
      //   NW → (col*2,     row*2)
      //   NE → (col*2 + 2, row*2)
      //   SE → (col*2 + 2, row*2 + 2)
      //   SW → (col*2,     row*2 + 2)
      const x0 = col * 2;
      const x1 = col * 2 + 2;
      const z0 = row * 2;
      const z1 = row * 2 + 2;

      const vBase = i * 4;
      // NW
      positions[vBase * 3 + 0] = x0;
      positions[vBase * 3 + 1] = cornersY.nw;
      positions[vBase * 3 + 2] = z0;
      // NE
      positions[(vBase + 1) * 3 + 0] = x1;
      positions[(vBase + 1) * 3 + 1] = cornersY.ne;
      positions[(vBase + 1) * 3 + 2] = z0;
      // SE
      positions[(vBase + 2) * 3 + 0] = x1;
      positions[(vBase + 2) * 3 + 1] = cornersY.se;
      positions[(vBase + 2) * 3 + 2] = z1;
      // SW
      positions[(vBase + 3) * 3 + 0] = x0;
      positions[(vBase + 3) * 3 + 1] = cornersY.sw;
      positions[(vBase + 3) * 3 + 2] = z1;

      // UVs — 0..1 per tile, one full texture repetition per 2m tile.
      // Match the existing PlaneGeometry UV mapping after rotateX(-π/2):
      //   NW (x0, z0) → (0, 1)
      //   NE (x1, z0) → (1, 1)
      //   SE (x1, z1) → (1, 0)
      //   SW (x0, z1) → (0, 0)
      // (Default PlaneGeometry puts (0,1) at top-left and (1,0) at
      // bottom-right; the -π/2 X-rotation maps that onto NW/SE here.)
      uvs[vBase * 2 + 0] = 0; uvs[vBase * 2 + 1] = 1;             // NW
      uvs[(vBase + 1) * 2 + 0] = 1; uvs[(vBase + 1) * 2 + 1] = 1; // NE
      uvs[(vBase + 2) * 2 + 0] = 1; uvs[(vBase + 2) * 2 + 1] = 0; // SE
      uvs[(vBase + 3) * 2 + 0] = 0; uvs[(vBase + 3) * 2 + 1] = 0; // SW

      // Brightness tint — identical formula to the old InstancedMesh
      // setColorAt path. All 4 vertices of the tile share the tint.
      const tintFactor = 0.88 + brightness * 0.12;
      const warmth = brightness * 0.05;
      const r = Math.max(0, Math.min(1, (0.94 + warmth) * tintFactor));
      const g = Math.max(0, Math.min(1, tintFactor));
      const b = Math.max(0, Math.min(1, (0.94 - warmth) * tintFactor));
      for (let k = 0; k < 4; k++) {
        colors[(vBase + k) * 3 + 0] = r;
        colors[(vBase + k) * 3 + 1] = g;
        colors[(vBase + k) * 3 + 2] = b;
      }

      // Two triangles per tile, CCW when viewed from +Y (above).
      // Plane default winding (before rotateX(-π/2)) goes NW→SW→NE then
      // NE→SW→SE; after -π/2 rotation the visible face is +Y up. We
      // replicate: (NW, SW, NE) + (NE, SW, SE).
      const iBase = i * 6;
      indices[iBase + 0] = vBase + 0; // NW
      indices[iBase + 1] = vBase + 3; // SW
      indices[iBase + 2] = vBase + 1; // NE
      indices[iBase + 3] = vBase + 1; // NE
      indices[iBase + 4] = vBase + 3; // SW
      indices[iBase + 5] = vBase + 2; // SE
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    const grassMat = MATERIALS.tile_grass;
    const mat = new THREE.MeshStandardMaterial({
      map: grassMat?.map ?? null,
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.FrontSide,
      vertexColors: true,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;

    parentGroup.add(mesh);
    this._mesh = mesh;
    this._cacheKey = newKey;
  }

  dispose(parentGroup) {
    this._cleanup(parentGroup);
    this._cacheKey = null;
  }

  _cleanup(parentGroup) {
    if (this._mesh) {
      parentGroup.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
      this._mesh = null;
    }
  }
}
