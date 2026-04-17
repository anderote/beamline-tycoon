// src/renderer3d/cliff-builder.js
// Renders vertical rocky-dirt cliff faces at inter-tile edges where the
// two tiles' shared-edge corners differ in Y. One merged BufferGeometry
// for the whole map, one tiled MeshStandardMaterial (tile_rocky_dirt).
//
// UVs are keyed to world coords so tiling stays consistent across
// adjacent cliff segments: u runs along the edge (X for south edges,
// Z for east edges), v runs along world-Y; both divided by 2 so one
// 64-px texture repetition covers 2 m (one tile) on every axis.
//
// THREE is a CDN global — do NOT import it.

import { MATERIALS } from './materials/index.js';

/**
 * Push a vertical quad (two triangles) onto the running arrays.
 *
 *   leftTop ---- rightTop
 *      |              |
 *   leftBot ---- rightBot
 *
 * uv* arrays are [u, v] pairs in the same corner order.
 */
function pushQuad(
  positions, uvs, indices,
  leftTop, rightTop, leftBot, rightBot,
  uvLT, uvRT, uvLB, uvRB,
) {
  const vBase = positions.length / 3;
  positions.push(
    leftTop[0],  leftTop[1],  leftTop[2],   // 0: LT
    rightTop[0], rightTop[1], rightTop[2],  // 1: RT
    rightBot[0], rightBot[1], rightBot[2],  // 2: RB
    leftBot[0],  leftBot[1],  leftBot[2],   // 3: LB
  );
  uvs.push(
    uvLT[0], uvLT[1],
    uvRT[0], uvRT[1],
    uvRB[0], uvRB[1],
    uvLB[0], uvLB[1],
  );
  indices.push(vBase + 0, vBase + 3, vBase + 1);
  indices.push(vBase + 1, vBase + 3, vBase + 2);
}

/**
 * Append cliff quads for a single inter-tile edge.
 *
 * Edge geometry (after world-space mapping):
 *   - Edge 'e': vertical line at X = (col+1)*2, running from
 *     Z = row*2 (north end = "left") to Z = row*2 + 2 (south end = "right").
 *   - Edge 's': horizontal line at Z = (row+1)*2, running from
 *     X = col*2     (west  end = "left") to X = col*2 + 2 (east  end = "right").
 *
 * Sign flip handling: if `selfY[0] - neighborY[0]` and `selfY[1] -
 * neighborY[1]` have opposite signs, the two sides cross somewhere along
 * the edge. Emit two sub-quads meeting at the crossing point.
 */
function appendCliff(positions, uvs, indices, col, row, edge, selfY, neighborY) {
  let leftX, leftZ, rightX, rightZ;
  if (edge === 'e') {
    leftX  = (col + 1) * 2; leftZ  = row * 2;
    rightX = (col + 1) * 2; rightZ = row * 2 + 2;
  } else {
    // edge === 's'
    leftX  = col * 2;       leftZ  = (row + 1) * 2;
    rightX = col * 2 + 2;   rightZ = (row + 1) * 2;
  }

  // World-coord → UV mapping. One 2m tile covers one texture repetition.
  const uLeft  = edge === 'e' ? leftZ  * 0.5 : leftX  * 0.5;
  const uRight = edge === 'e' ? rightZ * 0.5 : rightX * 0.5;
  const vOf = (y) => y * 0.5;

  const dLeft  = selfY[0] - neighborY[0];
  const dRight = selfY[1] - neighborY[1];

  if ((dLeft > 0 && dRight < 0) || (dLeft < 0 && dRight > 0)) {
    const t = dLeft / (dLeft - dRight);
    const midX = leftX + (rightX - leftX) * t;
    const midZ = leftZ + (rightZ - leftZ) * t;
    const selfMid = selfY[0] + (selfY[1] - selfY[0]) * t;
    const uMid = uLeft + (uRight - uLeft) * t;
    const vMid = vOf(selfMid);

    // Sub-quad 1: left → mid
    const lTop = Math.max(selfY[0], neighborY[0]);
    const lBot = Math.min(selfY[0], neighborY[0]);
    pushQuad(
      positions, uvs, indices,
      [leftX, lTop, leftZ],
      [midX, selfMid, midZ],
      [leftX, lBot, leftZ],
      [midX, selfMid, midZ],
      [uLeft, vOf(lTop)],
      [uMid,  vMid],
      [uLeft, vOf(lBot)],
      [uMid,  vMid],
    );

    // Sub-quad 2: mid → right
    const rTop = Math.max(selfY[1], neighborY[1]);
    const rBot = Math.min(selfY[1], neighborY[1]);
    pushQuad(
      positions, uvs, indices,
      [midX, selfMid, midZ],
      [rightX, rTop, rightZ],
      [midX, selfMid, midZ],
      [rightX, rBot, rightZ],
      [uMid,   vMid],
      [uRight, vOf(rTop)],
      [uMid,   vMid],
      [uRight, vOf(rBot)],
    );
    return;
  }

  // No sign flip — one quad covers the whole edge.
  const lTop = Math.max(selfY[0], neighborY[0]);
  const lBot = Math.min(selfY[0], neighborY[0]);
  const rTop = Math.max(selfY[1], neighborY[1]);
  const rBot = Math.min(selfY[1], neighborY[1]);
  pushQuad(
    positions, uvs, indices,
    [leftX, lTop, leftZ],
    [rightX, rTop, rightZ],
    [leftX, lBot, leftZ],
    [rightX, rBot, rightZ],
    [uLeft,  vOf(lTop)],
    [uRight, vOf(rTop)],
    [uLeft,  vOf(lBot)],
    [uRight, vOf(rBot)],
  );
}

export class CliffBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    /** @type {THREE.Mesh | null} */
    this._mesh = null;
    this._cacheKey = null;
  }

  /**
   * Build (or rebuild) cliff faces.
   * @param {Array<{col:number,row:number,edge:'e'|'s',selfY:number[],neighborY:number[]}>} cliffData
   * @param {THREE.Group} parentGroup
   * @param {number} [cornerHeightsRevision]
   */
  build(cliffData, parentGroup, cornerHeightsRevision = 0) {
    const len = cliffData ? cliffData.length : 0;
    const newKey = len + ':' + (cornerHeightsRevision | 0);
    if (newKey === this._cacheKey && (this._mesh || len === 0)) return;

    this._cleanup(parentGroup);

    if (!cliffData || len === 0) {
      this._cacheKey = newKey;
      return;
    }

    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i < len; i++) {
      const c = cliffData[i];
      appendCliff(positions, uvs, indices, c.col, c.row, c.edge, c.selfY, c.neighborY);
    }

    if (positions.length === 0) {
      this._cacheKey = newKey;
      return;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geo.computeVertexNormals();

    const rockyMat = MATERIALS.tile_rocky_dirt;
    const mat = new THREE.MeshStandardMaterial({
      map: rockyMat?.map ?? null,
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
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
