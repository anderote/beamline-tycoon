// src/renderer3d/rack-builder.js
//
// Builds 3D geometry for carrier rack segments — wire cable tray on
// support legs. Each segment is 1 tile (2m), the tray is narrow (0.8m).
//
// THREE is a CDN global — do NOT import it.

import {
  RACK_HEIGHT, RACK_TRAY_WIDTH, RACK_TRAY_DEPTH,
  RACK_SUPPORT_WIDTH, RACK_SIZE,
  junctionRotation,
} from '../data/carrier-rack.js';

const TILE_W = 2.0;
const SEG_LEN = RACK_SIZE * TILE_W; // 2.0m

let _supportMat, _trayMat;

function ensureMaterials() {
  if (_supportMat) return;
  _supportMat = new THREE.MeshStandardMaterial({ color: 0x607070, roughness: 0.5, metalness: 0.5 });
  _trayMat = new THREE.MeshStandardMaterial({ color: 0x809090, roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide });
}

export class RackBuilder {
  constructor() {
    this._meshes = [];
  }

  build(rackData, parentGroup) {
    this.dispose(parentGroup);
    ensureMaterials();
    if (!rackData || rackData.length === 0) return;

    for (const seg of rackData) {
      // Tile center in world coords
      const cx = seg.col * TILE_W + TILE_W / 2;
      const cz = seg.row * TILE_W + TILE_W / 2;

      const wrapper = new THREE.Group();
      wrapper.position.set(cx, 0, cz);

      const rot = junctionRotation(seg.neighbors);
      if (rot !== 0) wrapper.rotation.y = rot;

      this._buildSegment(wrapper);

      wrapper.matrixAutoUpdate = false;
      wrapper.updateMatrix();
      parentGroup.add(wrapper);
      this._meshes.push(wrapper);
    }
  }

  _buildSegment(group) {
    const halfLen = SEG_LEN / 2;
    const halfW = RACK_TRAY_WIDTH / 2;
    const sw = RACK_SUPPORT_WIDTH;
    const trayBot = RACK_HEIGHT - RACK_TRAY_DEPTH;

    // ── Two support legs (one on each side of the tray, centered) ──
    const legGeo = new THREE.BoxGeometry(sw, RACK_HEIGHT, sw);
    for (const sx of [-halfW - sw / 2, halfW + sw / 2]) {
      const leg = new THREE.Mesh(legGeo, _supportMat);
      leg.position.set(sx, RACK_HEIGHT / 2, 0);
      leg.matrixAutoUpdate = false;
      leg.updateMatrix();
      group.add(leg);
    }

    // ── Cross-member connecting the two legs ──
    const crossGeo = new THREE.BoxGeometry(RACK_TRAY_WIDTH + sw * 2, sw, sw);
    const cross = new THREE.Mesh(crossGeo, _supportMat);
    cross.position.set(0, trayBot - sw / 2, 0);
    cross.matrixAutoUpdate = false;
    cross.updateMatrix();
    group.add(cross);

    // ── Tray bottom (wire mesh — thin solid panel) ──
    const bottomGeo = new THREE.BoxGeometry(RACK_TRAY_WIDTH, 0.012, SEG_LEN);
    const bottom = new THREE.Mesh(bottomGeo, _trayMat);
    bottom.position.set(0, trayBot, 0);
    bottom.matrixAutoUpdate = false;
    bottom.updateMatrix();
    group.add(bottom);

    // ── Tray side walls ──
    const sideGeo = new THREE.BoxGeometry(0.012, RACK_TRAY_DEPTH, SEG_LEN);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(sideGeo, _trayMat);
      wall.position.set(side * halfW, trayBot + RACK_TRAY_DEPTH / 2, 0);
      wall.matrixAutoUpdate = false;
      wall.updateMatrix();
      group.add(wall);
    }

    // ── Cross rungs inside tray (every ~0.25m) ──
    const rungGeo = new THREE.BoxGeometry(RACK_TRAY_WIDTH, 0.008, 0.008);
    const nRungs = Math.floor(SEG_LEN / 0.25);
    for (let i = 0; i <= nRungs; i++) {
      const rung = new THREE.Mesh(rungGeo, _trayMat);
      rung.position.set(0, trayBot + 0.006, -halfLen + i * 0.25);
      rung.matrixAutoUpdate = false;
      rung.updateMatrix();
      group.add(rung);
    }
  }

  dispose(parentGroup) {
    for (const obj of this._meshes) {
      parentGroup.remove(obj);
      obj.traverse(child => {
        if (child.isMesh && child.geometry) child.geometry.dispose();
      });
    }
    this._meshes = [];
  }
}
