// src/renderer3d/utility-pipe-builder.js
//
// Renders floor-level utility pipe runs and Z-route connections to component ports.
// THREE is a CDN global — do NOT import it.

import { UTILITY_PORT_PROFILES } from '../data/utility-ports.js';

const FLOOR_Y = 0.05;
const PORT_Y = 0.5;
const STUB_OUT = 0.15;
const SEGS = 8;

// Sorted largest-first for side-by-side layout: largest on outside, smallest in center.
const SIZE_ORDER = ['cryoTransfer', 'vacuumPipe', 'rfWaveguide', 'coolingWater', 'powerCable', 'dataFiber'];

const _matCache = {};

function getMat(connType) {
  if (_matCache[connType]) return _matCache[connType];
  const p = UTILITY_PORT_PROFILES[connType];
  if (!p) return null;
  _matCache[connType] = new THREE.MeshStandardMaterial({
    color: p.color, roughness: 0.5, metalness: 0.3,
  });
  return _matCache[connType];
}

function pipeRadius(connType) {
  const p = UTILITY_PORT_PROFILES[connType];
  if (!p) return 0.02;
  return p.radius || Math.max(p.width, p.height) / 2;
}

function pipeWidth(connType) {
  const p = UTILITY_PORT_PROFILES[connType];
  if (!p) return 0.04;
  if (p.shape === 'rect') return p.width;
  return p.radius * 2;
}

function createPipeSegment(connType, length) {
  const p = UTILITY_PORT_PROFILES[connType];
  if (p.shape === 'rect') {
    return new THREE.BoxGeometry(length, p.height, p.width);
  }
  return new THREE.CylinderGeometry(p.radius, p.radius, length, SEGS);
}

function lateralOffset(types, index) {
  const gap = 0.01;
  const widths = types.map(t => pipeWidth(t));
  let totalWidth = 0;
  for (let i = 0; i < widths.length; i++) totalWidth += widths[i] + (i > 0 ? gap : 0);
  let pos = -totalWidth / 2 + widths[0] / 2;
  for (let i = 1; i <= index; i++) pos += widths[i - 1] / 2 + gap + widths[i] / 2;
  return pos;
}

export class UtilityPipeBuilder {
  constructor() {
    this._meshes = [];
  }

  build(utilityRouting, parentGroup) {
    this.dispose(parentGroup);
    if (!utilityRouting) return;

    const { floorSegments, portRoutes } = utilityRouting;

    this._buildFloorPipes(floorSegments, parentGroup);
    this._buildZRoutes(portRoutes, parentGroup);
  }

  _addMesh(mesh, parentGroup) {
    parentGroup.add(mesh);
    this._meshes.push(mesh);
  }

  _buildFloorPipes(segments, parentGroup) {
    // Group segments by tile
    const tileMap = new Map();
    for (const seg of segments) {
      const key = `${seg.col},${seg.row}`;
      if (!tileMap.has(key)) tileMap.set(key, []);
      tileMap.get(key).push(seg);
    }

    for (const [key, segs] of tileMap) {
      const [col, row] = key.split(',').map(Number);
      const cx = col * 2 + 1;
      const cz = row * 2 + 1;

      // Sort by size for side-by-side layout
      const sorted = segs.sort((a, b) =>
        SIZE_ORDER.indexOf(a.type) - SIZE_ORDER.indexOf(b.type)
      );
      const types = sorted.map(s => s.type);

      for (let i = 0; i < sorted.length; i++) {
        const seg = sorted[i];
        const mat = getMat(seg.type);
        if (!mat) continue;
        const profile = UTILITY_PORT_PROFILES[seg.type];

        const latOff = lateralOffset(types, i);
        const { north, south, east, west } = seg.neighbors;

        // No neighbors — short marker pip
        if (!north && !south && !east && !west) {
          const geo = createPipeSegment(seg.type, 0.3);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.matrixAutoUpdate = false;
          if (profile.shape === 'rect') {
            mesh.position.set(cx, FLOOR_Y, cz + latOff);
          } else {
            mesh.rotation.z = Math.PI / 2;
            mesh.position.set(cx, FLOOR_Y, cz + latOff);
          }
          mesh.updateMatrix();
          this._addMesh(mesh, parentGroup);
          this._maybeAddJacket(seg.type, mesh, 0.3, parentGroup);
          continue;
        }

        // N-S run (pipes along Z axis)
        if (north || south) {
          const startZ = north ? cz - 1.0 : cz;
          const endZ = south ? cz + 1.0 : cz;
          const length = endZ - startZ;
          if (length > 0.01) {
            const geo = createPipeSegment(seg.type, length);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.matrixAutoUpdate = false;
            if (profile.shape === 'rect') {
              mesh.position.set(cx + latOff, FLOOR_Y, (startZ + endZ) / 2);
              mesh.rotation.y = Math.PI / 2;
            } else {
              mesh.rotation.x = Math.PI / 2;
              mesh.position.set(cx + latOff, FLOOR_Y, (startZ + endZ) / 2);
            }
            mesh.updateMatrix();
            this._addMesh(mesh, parentGroup);
            this._maybeAddJacket(seg.type, mesh, length, parentGroup);
          }
        }

        // E-W run (pipes along X axis)
        if (east || west) {
          const startX = west ? cx - 1.0 : cx;
          const endX = east ? cx + 1.0 : cx;
          const length = endX - startX;
          if (length > 0.01) {
            const geo = createPipeSegment(seg.type, length);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.matrixAutoUpdate = false;
            if (profile.shape === 'rect') {
              mesh.position.set((startX + endX) / 2, FLOOR_Y, cz + latOff);
            } else {
              mesh.rotation.z = Math.PI / 2;
              mesh.position.set((startX + endX) / 2, FLOOR_Y, cz + latOff);
            }
            mesh.updateMatrix();
            this._addMesh(mesh, parentGroup);
            this._maybeAddJacket(seg.type, mesh, length, parentGroup);
          }
        }
      }
    }
  }

  _maybeAddJacket(connType, innerMesh, length, parentGroup) {
    if (connType !== 'cryoTransfer') return;
    const r = UTILITY_PORT_PROFILES.cryoTransfer.radius * 1.5;
    const jacketGeo = new THREE.CylinderGeometry(r, r, length, SEGS);
    const jacketMat = new THREE.MeshStandardMaterial({
      color: 0x1a3340, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.5,
    });
    const jacket = new THREE.Mesh(jacketGeo, jacketMat);
    jacket.matrixAutoUpdate = false;
    jacket.position.copy(innerMesh.position);
    jacket.rotation.copy(innerMesh.rotation);
    jacket.updateMatrix();
    this._addMesh(jacket, parentGroup);
  }

  _buildZRoutes(portRoutes, parentGroup) {
    for (const route of portRoutes) {
      if (!route.connectedSide) continue;

      const profile = UTILITY_PORT_PROFILES[route.portType];
      if (!profile) continue;
      const mat = getMat(route.portType);

      // Component center in world coords
      const ccx = route.col * 2 + 1;
      const ccz = route.row * 2 + 1;

      // Half-width along the component's lateral axis (in world units)
      const halfW = (route.subW * 0.5) / 2;

      // Port Z position along component length
      const portLocalZ = (route.portOffset - 0.5) * (route.subL * 0.5);

      // Which side to connect
      const sideSign = route.connectedSide === 'left' ? -1 : 1;

      // Rotate based on component direction
      // dir 0: front=+row → lateral axis is X
      // dir 1: front=-col → lateral axis is Z  (rotated 90° CW)
      // dir 2: front=-row → lateral axis is -X
      // dir 3: front=+col → lateral axis is -Z
      const cosD = [1, 0, -1, 0][route.dir];
      const sinD = [0, -1, 0, 1][route.dir];

      const localX = sideSign * (halfW + STUB_OUT);
      const localZ = portLocalZ;

      const portWorldX = ccx + localX * cosD - localZ * sinD;
      const portWorldZ = ccz + localX * sinD + localZ * cosD;

      // Vertical segment (PORT_Y down to FLOOR_Y)
      const vertLen = PORT_Y - FLOOR_Y;
      const vertGeo = createPipeSegment(route.portType, vertLen);
      const vertMesh = new THREE.Mesh(vertGeo, mat);
      vertMesh.matrixAutoUpdate = false;
      vertMesh.position.set(portWorldX, FLOOR_Y + vertLen / 2, portWorldZ);
      vertMesh.updateMatrix();
      this._addMesh(vertMesh, parentGroup);

      // Horizontal floor run toward the nearest floor network tile
      const floorDirX = sideSign * cosD;
      const floorDirZ = sideSign * sinD;
      const floorRunLen = 0.5;

      const floorGeo = createPipeSegment(route.portType, floorRunLen);
      const floorMesh = new THREE.Mesh(floorGeo, mat);
      floorMesh.matrixAutoUpdate = false;

      const fx = portWorldX + floorDirX * floorRunLen / 2;
      const fz = portWorldZ + floorDirZ * floorRunLen / 2;

      if (profile.shape === 'rect') {
        const angle = Math.atan2(floorDirZ, floorDirX);
        floorMesh.rotation.y = -angle;
        floorMesh.position.set(fx, FLOOR_Y, fz);
      } else {
        floorMesh.rotation.z = Math.PI / 2;
        const angle = Math.atan2(floorDirZ, floorDirX);
        floorMesh.rotation.y = -angle;
        floorMesh.position.set(fx, FLOOR_Y, fz);
      }
      floorMesh.updateMatrix();
      this._addMesh(floorMesh, parentGroup);
    }
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
    }
    this._meshes = [];
  }
}
