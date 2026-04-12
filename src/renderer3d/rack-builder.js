// src/renderer3d/rack-builder.js
//
// Builds 3D geometry for carrier rack segments — elevated utility racks
// with vertical supports, lateral stringers, cross-bracing, a bottom
// pipe rail with hangers, and an open mesh cable tray on top.
// THREE is a CDN global — do NOT import it.

import {
  RACK_HEIGHT, RACK_TRAY_HEIGHT, RACK_RAIL_HEIGHT,
  RACK_SUPPORT_WIDTH, RACK_SIZE, BOTTOM_SLOTS,
  rackNeighborAnchors, junctionType, junctionRotation,
} from '../data/carrier-rack.js';

const SEGS = 8;
const TILE_W = 2.0;
const RACK_WORLD_SIZE = RACK_SIZE * TILE_W;

let _supportMat, _railMat, _trayMat, _braceMat, _hangerMat;

function ensureMaterials() {
  if (_supportMat) return;
  _supportMat = new THREE.MeshStandardMaterial({ color: 0x556666, roughness: 0.55, metalness: 0.5 });
  _railMat = new THREE.MeshStandardMaterial({ color: 0x667777, roughness: 0.5, metalness: 0.5 });
  _trayMat = new THREE.MeshStandardMaterial({
    color: 0x778888, roughness: 0.65, metalness: 0.35,
    side: THREE.DoubleSide,
  });
  _braceMat = new THREE.MeshStandardMaterial({ color: 0x556060, roughness: 0.6, metalness: 0.4 });
  _hangerMat = new THREE.MeshStandardMaterial({ color: 0x667070, roughness: 0.5, metalness: 0.5 });
}

// Vertical support column
function buildSupport(x, z) {
  const w = RACK_SUPPORT_WIDTH;
  const geo = new THREE.BoxGeometry(w, RACK_HEIGHT, w);
  const mesh = new THREE.Mesh(geo, _supportMat);
  mesh.position.set(x, RACK_HEIGHT / 2, z);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

// Horizontal stringer between two supports at a given height
function buildStringer(x1, z1, x2, z2, y) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dz, dx);
  const geo = new THREE.BoxGeometry(len, 0.05, 0.05);
  const mesh = new THREE.Mesh(geo, _railMat);
  mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
  mesh.rotation.y = -angle;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

// Diagonal cross-brace between supports
function buildBrace(x1, z1, y1, x2, z2, y2) {
  const dx = x2 - x1, dz = z2 - z1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const geo = new THREE.BoxGeometry(len, 0.025, 0.025);
  const mesh = new THREE.Mesh(geo, _braceMat);
  mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
  const horizLen = Math.sqrt(dx * dx + dz * dz);
  mesh.rotation.z = Math.atan2(dy, horizLen);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

// Bottom pipe rail — two parallel L-angles running the length
function buildBottomRails(length) {
  const group = new THREE.Group();
  const railSpacing = 1.6;
  for (const side of [-1, 1]) {
    const z = side * railSpacing / 2;
    // Horizontal flange
    const hGeo = new THREE.BoxGeometry(length, 0.04, 0.06);
    const hMesh = new THREE.Mesh(hGeo, _railMat);
    hMesh.position.set(0, RACK_RAIL_HEIGHT, z);
    hMesh.matrixAutoUpdate = false;
    hMesh.updateMatrix();
    group.add(hMesh);
    // Vertical flange (L-angle)
    const vGeo = new THREE.BoxGeometry(length, 0.06, 0.03);
    const vMesh = new THREE.Mesh(vGeo, _railMat);
    vMesh.position.set(0, RACK_RAIL_HEIGHT + 0.03, z - side * 0.03);
    vMesh.matrixAutoUpdate = false;
    vMesh.updateMatrix();
    group.add(vMesh);
  }
  return group;
}

// Pipe hanger — U-shaped bracket hanging from rail
function buildHanger(x, z, radius) {
  const group = new THREE.Group();
  const hangH = 0.15;
  const w = 0.02;
  // Vertical drop from rail
  const dropGeo = new THREE.BoxGeometry(w, hangH, w);
  for (const side of [-1, 1]) {
    const drop = new THREE.Mesh(dropGeo, _hangerMat);
    drop.position.set(x + side * (radius + w), RACK_RAIL_HEIGHT - hangH / 2, z);
    drop.matrixAutoUpdate = false;
    drop.updateMatrix();
    group.add(drop);
  }
  // Bottom cradle (curved approximated as flat bar)
  const cradleGeo = new THREE.BoxGeometry(radius * 2 + w * 2, w, w);
  const cradle = new THREE.Mesh(cradleGeo, _hangerMat);
  cradle.position.set(x, RACK_RAIL_HEIGHT - hangH, z);
  cradle.matrixAutoUpdate = false;
  cradle.updateMatrix();
  group.add(cradle);
  return group;
}

// Top cable tray — open mesh tray with side lips and cross rungs
function buildTray(length) {
  const group = new THREE.Group();
  const trayW = 1.0;
  const trayH = 0.03;
  const lipH = 0.08;

  // Bottom panel (mesh represented as thin solid)
  const bottom = new THREE.Mesh(
    new THREE.BoxGeometry(length, trayH, trayW),
    _trayMat
  );
  bottom.position.set(0, RACK_TRAY_HEIGHT, 0);
  bottom.matrixAutoUpdate = false;
  bottom.updateMatrix();
  group.add(bottom);

  // Side lips
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

  // Cross rungs every 0.5m
  const rungSpacing = 0.5;
  const numRungs = Math.floor(length / rungSpacing);
  const rungGeo = new THREE.BoxGeometry(0.02, 0.02, trayW);
  for (let i = 0; i <= numRungs; i++) {
    const rung = new THREE.Mesh(rungGeo, _trayMat);
    rung.position.set(-length / 2 + i * rungSpacing, RACK_TRAY_HEIGHT + 0.01, 0);
    rung.matrixAutoUpdate = false;
    rung.updateMatrix();
    group.add(rung);
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

      const half = RACK_WORLD_SIZE / 2 - 0.15;
      const sideOff = RACK_WORLD_SIZE / 2 - 0.15;

      // 4 vertical supports at corners
      wrapper.add(buildSupport(-sideOff, -half));
      wrapper.add(buildSupport(-sideOff,  half));
      wrapper.add(buildSupport( sideOff, -half));
      wrapper.add(buildSupport( sideOff,  half));

      // Lateral stringers at top and mid-height
      const midY = RACK_HEIGHT * 0.5;
      wrapper.add(buildStringer(-sideOff, -half, sideOff, -half, RACK_HEIGHT));
      wrapper.add(buildStringer(-sideOff,  half, sideOff,  half, RACK_HEIGHT));
      wrapper.add(buildStringer(-sideOff, -half, -sideOff,  half, RACK_HEIGHT));
      wrapper.add(buildStringer( sideOff, -half,  sideOff,  half, RACK_HEIGHT));
      // Mid-height stringers (sides only)
      wrapper.add(buildStringer(-sideOff, -half, -sideOff,  half, midY));
      wrapper.add(buildStringer( sideOff, -half,  sideOff,  half, midY));

      // X-bracing on sides (between mid and top)
      wrapper.add(buildBrace(-sideOff, -half, midY, -sideOff, half, RACK_HEIGHT));
      wrapper.add(buildBrace(-sideOff, half, midY, -sideOff, -half, RACK_HEIGHT));
      wrapper.add(buildBrace(sideOff, -half, midY, sideOff, half, RACK_HEIGHT));
      wrapper.add(buildBrace(sideOff, half, midY, sideOff, -half, RACK_HEIGHT));

      // Bottom pipe rails
      wrapper.add(buildBottomRails(RACK_WORLD_SIZE));

      // Pipe hangers for each slot position
      const pipeSlots = Object.entries(BOTTOM_SLOTS);
      for (const [type, slotX] of pipeSlots) {
        const present = seg.utilities && seg.utilities.includes(type);
        // Always build hanger positions (structural), but only if utility is present
        if (present) {
          const r = type === 'rfWaveguide' ? 0.04 : 0.05;
          wrapper.add(buildHanger(slotX, 0, r));
        }
      }

      // Top cable tray
      wrapper.add(buildTray(RACK_WORLD_SIZE));

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
