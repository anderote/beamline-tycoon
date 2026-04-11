// src/renderer3d/infra-builder.js
// Renders infrastructure floor tiles as InstancedMesh per type.
// THREE is a CDN global — do NOT import it.

import { INFRASTRUCTURE } from '../data/infrastructure.js';
import { TEXEL_SCALE } from './materials/index.js';

export class InfraBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    /** @type {THREE.InstancedMesh[]} */
    this._meshes = [];
    this._cacheKey = null;
  }

  /**
   * Build (or rebuild) infrastructure floor tiles from infraData.
   * @param {Array<{ col: number, row: number, type: string, orientation: string, variant: number, tint: number|null }>} infraData
   * @param {THREE.Group} parentGroup
   * @param {number} viewRotationIndex 0..3 — camera rotation index used to orient diamond UVs
   */
  build(infraData, parentGroup, viewRotationIndex = 0) {
    if (!infraData || infraData.length === 0) {
      this._cleanup(parentGroup);
      this._cacheKey = '';
      return;
    }

    // Cache key: stringify the data + rotation index to detect changes
    const newKey = JSON.stringify(infraData) + '|rot' + viewRotationIndex;
    if (newKey === this._cacheKey && this._meshes.length > 0) return;

    // Dispose old meshes before rebuilding
    this._cleanup(parentGroup);

    // Group tiles by type
    const byType = new Map();
    for (const tile of infraData) {
      if (!byType.has(tile.type)) byType.set(tile.type, []);
      byType.get(tile.type).push(tile);
    }

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (const [type, tiles] of byType) {
      const infra = INFRASTRUCTURE[type];
      if (!infra) continue;

      const baseColor = infra.topColor ?? infra.color ?? 0x888888;
      const tileInfo = this._textureManager.getTileInfo(type);
      const hasTex = !!(tileInfo && tileInfo.texture);

      // 1) Solid background plane — fills the full square so diamond texture
      //    corners don't show gaps. Uses the infra type's primary color.
      const bgGeo = new THREE.PlaneGeometry(2, 2);
      bgGeo.rotateX(-Math.PI / 2);
      const bgMat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.9,
        metalness: 0.0,
      });
      const bgMesh = new THREE.InstancedMesh(bgGeo, bgMat, tiles.length);
      bgMesh.receiveShadow = true;
      bgMesh.castShadow = false;
      bgMesh.matrixAutoUpdate = false;

      for (let i = 0; i < tiles.length; i++) {
        dummy.position.set(tiles[i].col * 2 + 1, 0.001, tiles[i].row * 2 + 1);
        dummy.updateMatrix();
        bgMesh.setMatrixAt(i, dummy.matrix);
      }
      bgMesh.instanceMatrix.needsUpdate = true;
      parentGroup.add(bgMesh);
      this._meshes.push(bgMesh);

      // 2) Textured overlay plane (if texture exists) — diamond texture on top
      if (hasTex) {
        const texGeo = new THREE.PlaneGeometry(2, 2);
        texGeo.rotateX(-Math.PI / 2);

        // Remap UVs: tile textures are isometric diamond images.
        // Shrink UVs slightly inward to scale texture up ~3%, closing gaps between tiles.
        // The diamond corners are rotated by viewRotationIndex quarter-turns so the
        // correct diamond face always aligns with the camera's "north".
        const S = 0.03; // overshoot factor
        const TOP    = [0.5,       1.0 - S];
        const RIGHT  = [1.0 - S,   0.5    ];
        const LEFT   = [0.0 + S,   0.5    ];
        const BOTTOM = [0.5,       0.0 + S];
        // Each row is [v0, v1, v2, v3] for rotation indices 0..3.
        // Rotating the camera clockwise shifts which diamond corner faces "up" on screen.
        const DIAMOND_ROTATIONS = [
          [TOP,    RIGHT,  LEFT,   BOTTOM], // rot 0
          [LEFT,   TOP,    BOTTOM, RIGHT ], // rot 1
          [BOTTOM, LEFT,   RIGHT,  TOP   ], // rot 2
          [RIGHT,  BOTTOM, TOP,    LEFT  ], // rot 3
        ];
        const corners = DIAMOND_ROTATIONS[((viewRotationIndex % 4) + 4) % 4];
        const uvs = texGeo.attributes.uv;
        uvs.setXY(0, corners[0][0], corners[0][1]);
        uvs.setXY(1, corners[1][0], corners[1][1]);
        uvs.setXY(2, corners[2][0], corners[2][1]);
        uvs.setXY(3, corners[3][0], corners[3][1]);
        uvs.needsUpdate = true;

        // Scale UVs by world size so texel density stays constant.
        // Each tile is 2×2 world meters; METERS_PER_TILE = 64 / TEXEL_SCALE (currently 2m).
        const METERS_PER_TILE = 64 / TEXEL_SCALE;
        const tileWorldSize = 2; // each infra tile is 2×2 world units
        const sx = tileWorldSize / METERS_PER_TILE;
        const sz = tileWorldSize / METERS_PER_TILE;
        const uvAttr = texGeo.attributes.uv;
        const uvArr = uvAttr.array;
        for (let i = 0; i < uvArr.length; i += 2) {
          uvArr[i + 0] = (uvArr[i + 0] - 0.5) * sx + 0.5;
          uvArr[i + 1] = (uvArr[i + 1] - 0.5) * sz + 0.5;
        }
        uvAttr.needsUpdate = true;

        const texMat = new THREE.MeshStandardMaterial({
          map: tileInfo.texture,
          transparent: true, // diamond texture has transparent corners
          roughness: 0.9,
          metalness: 0.0,
        });

        // Ensure texture tiles correctly when UVs exceed [0,1].
        if (texMat.map) {
          texMat.map.wrapS = THREE.RepeatWrapping;
          texMat.map.wrapT = THREE.RepeatWrapping;
          texMat.map.needsUpdate = true;
        }

        const texMesh = new THREE.InstancedMesh(texGeo, texMat, tiles.length);
        texMesh.receiveShadow = true;
        texMesh.castShadow = false;
        texMesh.matrixAutoUpdate = false;

        for (let i = 0; i < tiles.length; i++) {
          const { col, row, tint } = tiles[i];
          dummy.position.set(col * 2 + 1, 0.002, row * 2 + 1); // slightly above bg
          dummy.updateMatrix();
          texMesh.setMatrixAt(i, dummy.matrix);

          if (tint != null) {
            color.set(tint);
          } else {
            color.set(0xffffff);
          }
          texMesh.setColorAt(i, color);
        }

        texMesh.instanceMatrix.needsUpdate = true;
        if (texMesh.instanceColor) texMesh.instanceColor.needsUpdate = true;

        parentGroup.add(texMesh);
        this._meshes.push(texMesh);
      }
    }

    this._cacheKey = newKey;
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
      mesh.material.dispose();
    }
    this._meshes = [];
  }
}
