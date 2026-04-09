// src/renderer3d/terrain-builder.js
// Renders grass tiles as InstancedMeshes grouped by variant texture.
// 24 variants in 3 brightness pools (dark/mid/light), same as old grass-renderer.
// THREE is a CDN global — do NOT import it.

// 24 variants grouped by brightness: dark (0-7), mid (8-15), light (16-23)
const DARK_VARIANTS  = [8, 9, 10, 11, 16, 17, 18, 19];
const MID_VARIANTS   = [0, 1, 2, 3, 4, 5, 6, 7];
const LIGHT_VARIANTS = [12, 13, 14, 15, 20, 21, 22, 23];

function pickVariant(brightness, hash) {
  let pool;
  if (brightness < -0.25) pool = DARK_VARIANTS;
  else if (brightness > 0.25) pool = LIGHT_VARIANTS;
  else pool = MID_VARIANTS;
  return pool[hash % pool.length];
}

export class TerrainBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    this._meshes = [];
    this._cacheKey = null;
  }

  build(terrainData, parentGroup) {
    const newKey = terrainData.length;
    if (newKey === this._cacheKey && this._meshes.length > 0) return;

    this._cleanup(parentGroup);

    if (terrainData.length === 0) return;

    // Group tiles by variant index
    const byVariant = new Map();
    for (const tile of terrainData) {
      const varIdx = pickVariant(tile.brightness, tile.hash);
      if (!byVariant.has(varIdx)) byVariant.set(varIdx, []);
      byVariant.get(varIdx).push(tile);
    }

    // Shared geometry with rotated UVs for isometric diamond textures
    const S = 0.03; // UV inset to scale texture up slightly

    for (const [varIdx, tiles] of byVariant) {
      const geo = new THREE.PlaneGeometry(2, 2);
      geo.rotateX(-Math.PI / 2);

      const uvs = geo.attributes.uv;
      uvs.setXY(0, 0.5, 1.0 - S);
      uvs.setXY(1, 1.0 - S, 0.5);
      uvs.setXY(2, 0.0 + S, 0.5);
      uvs.setXY(3, 0.5, 0.0 + S);
      uvs.needsUpdate = true;

      const texPath = `assets/decorations/grass_tile_${varIdx}.png`;
      const tex = this._textureManager.get(texPath);

      const mat = new THREE.MeshStandardMaterial({
        map: tex || undefined,
        color: tex ? 0xffffff : 0x338833,
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.FrontSide,
      });

      const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;

      const dummy = new THREE.Object3D();
      const color = new THREE.Color();

      for (let i = 0; i < tiles.length; i++) {
        const { col, row, brightness } = tiles[i];

        dummy.position.set(col * 2 + 1, 0, row * 2 + 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        // Per-instance brightness tint
        const tintFactor = 0.88 + brightness * 0.12;
        const warmth = brightness * 0.05;
        const r = Math.max(0, Math.min(1, (0.94 + warmth) * tintFactor));
        const g = Math.max(0, Math.min(1, tintFactor));
        const b = Math.max(0, Math.min(1, (0.94 - warmth) * tintFactor));
        color.setRGB(r, g, b);
        mesh.setColorAt(i, color);
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      parentGroup.add(mesh);
      this._meshes.push(mesh);
    }

    this._cacheKey = newKey;
  }

  dispose(parentGroup) {
    this._cleanup(parentGroup);
    this._cacheKey = null;
  }

  _cleanup(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes = [];
  }
}
