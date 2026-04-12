// src/renderer3d/rack-builder.js
//
// Builds 3D geometry for carrier rack segments.
// THREE is a CDN global — do NOT import it.

import {
  RACK_HEIGHT, RACK_TRAY_HEIGHT, RACK_RAIL_HEIGHT,
  RACK_SUPPORT_WIDTH, RACK_SIZE,
  rackNeighborAnchors, junctionType, junctionRotation,
} from '../data/carrier-rack.js';

const SEGS = 8;
const TILE_W = 2.0;
const RACK_WORLD_SIZE = RACK_SIZE * TILE_W;

let _supportMat, _railMat, _trayMat;

function ensureMaterials() {
  if (_supportMat) return;
  _supportMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.6, metalness: 0.4 });
  _railMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.5, metalness: 0.5 });
  _trayMat = new THREE.MeshStandardMaterial({
    color: 0x888888, roughness: 0.7, metalness: 0.3,
    side: THREE.DoubleSide,
  });
}

function buildSupport(x, z) {
  const w = RACK_SUPPORT_WIDTH;
  const geo = new THREE.BoxGeometry(w, RACK_HEIGHT, w);
  const mesh = new THREE.Mesh(geo, _supportMat);
  mesh.position.set(x, RACK_HEIGHT / 2, z);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

function buildBottomRail(length, height) {
  const geo = new THREE.BoxGeometry(length, 0.06, 0.08);
  const mesh = new THREE.Mesh(geo, _railMat);
  mesh.position.set(0, height, 0);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

function buildTray(length) {
  const group = new THREE.Group();
  const trayW = 1.2;
  const trayH = 0.05;
  const lipH = 0.12;

  const bottom = new THREE.Mesh(
    new THREE.BoxGeometry(length, trayH, trayW),
    _trayMat
  );
  bottom.position.set(0, RACK_TRAY_HEIGHT, 0);
  bottom.matrixAutoUpdate = false;
  bottom.updateMatrix();
  group.add(bottom);

  for (const side of [-1, 1]) {
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(length, lipH, trayH),
      _trayMat
    );
    lip.position.set(0, RACK_TRAY_HEIGHT + lipH / 2, side * trayW / 2);
    lip.matrixAutoUpdate = false;
    lip.updateMatrix();
    group.add(lip);
  }

  return group;
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
      const cx = seg.col * TILE_W + RACK_WORLD_SIZE / 2;
      const cz = seg.row * TILE_W + RACK_WORLD_SIZE / 2;

      const wrapper = new THREE.Group();
      wrapper.position.set(cx, 0, cz);

      const rot = junctionRotation(seg.neighbors);
      if (rot !== 0) wrapper.rotation.y = rot;

      const halfSize = RACK_WORLD_SIZE / 2 - 0.2;
      const sideOff = RACK_WORLD_SIZE / 2 - 0.15;
      wrapper.add(buildSupport(-sideOff, -halfSize));
      wrapper.add(buildSupport(-sideOff,  halfSize));
      wrapper.add(buildSupport( sideOff, -halfSize));
      wrapper.add(buildSupport( sideOff,  halfSize));

      const rail = buildBottomRail(RACK_WORLD_SIZE, RACK_RAIL_HEIGHT);
      wrapper.add(rail);

      const tray = buildTray(RACK_WORLD_SIZE);
      wrapper.add(tray);

      wrapper.matrixAutoUpdate = false;
      wrapper.updateMatrix();

      parentGroup.add(wrapper);
      this._meshes.push(wrapper);
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
