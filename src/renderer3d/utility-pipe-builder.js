// src/renderer3d/utility-pipe-builder.js
//
// Renders utility pipes inside carrier rack tray and vertical drops
// to component ports. All pipes ride in the tray at PIPE_Y.
// THREE is a CDN global — do NOT import it.

import { UTILITY_PORT_PROFILES } from '../data/utility-ports.js';
import {
  RACK_SIZE, PIPE_SLOTS, PIPE_Y,
} from '../data/carrier-rack.js';

const PORT_Y = 0.5;
const SEGS = 8;
const TILE_W = 2.0;
const SEG_LEN = RACK_SIZE * TILE_W;

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

function createPipeSegment(connType, length) {
  const p = UTILITY_PORT_PROFILES[connType];
  if (p.shape === 'rect') {
    return new THREE.BoxGeometry(length, p.height, p.width);
  }
  return new THREE.CylinderGeometry(p.radius, p.radius, length, SEGS);
}

export class UtilityPipeBuilder {
  constructor() {
    this._meshes = [];
    this._jacketMat = null;
  }

  build(utilityRouting, parentGroup) {
    this.dispose(parentGroup);
    if (!utilityRouting) return;

    const { rackPipes, portRoutes } = utilityRouting;

    if (rackPipes) this._buildRackPipes(rackPipes, parentGroup);
    if (portRoutes) this._buildVerticalDrops(portRoutes, parentGroup);
  }

  _addMesh(mesh, parentGroup) {
    parentGroup.add(mesh);
    this._meshes.push(mesh);
  }

  _buildRackPipes(rackPipes, parentGroup) {
    const halfSeg = SEG_LEN / 2;

    for (const pipe of rackPipes) {
      const mat = getMat(pipe.type);
      if (!mat) continue;
      const profile = UTILITY_PORT_PROFILES[pipe.type];

      // Segment center in world coords (sub-grid to world)
      const cx = pipe.col * TILE_W + TILE_W / 2;
      const cz = pipe.row * TILE_W + TILE_W / 2;

      const slotX = PIPE_SLOTS[pipe.type] ?? 0;
      const pipeYPos = PIPE_Y;

      const { north, south, east, west } = pipe.neighbors;

      // No neighbors — short marker
      if (!north && !south && !east && !west) {
        const geo = createPipeSegment(pipe.type, SEG_LEN * 0.6);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.matrixAutoUpdate = false;
        if (profile.shape === 'rect') {
          mesh.position.set(cx + slotX, pipeYPos, cz);
        } else {
          mesh.rotation.z = Math.PI / 2;
          mesh.position.set(cx + slotX, pipeYPos, cz);
        }
        mesh.updateMatrix();
        this._addMesh(mesh, parentGroup);
        this._maybeAddJacket(pipe.type, mesh, SEG_LEN * 0.6, parentGroup);
        continue;
      }

      // N-S run
      if (north || south) {
        const startZ = north ? cz - halfSeg : cz;
        const endZ = south ? cz + halfSeg : cz;
        const length = endZ - startZ;
        if (length > 0.01) {
          const geo = createPipeSegment(pipe.type, length);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.matrixAutoUpdate = false;
          if (profile.shape === 'rect') {
            mesh.position.set(cx + slotX, pipeYPos, (startZ + endZ) / 2);
            mesh.rotation.y = Math.PI / 2;
          } else {
            mesh.rotation.x = Math.PI / 2;
            mesh.position.set(cx + slotX, pipeYPos, (startZ + endZ) / 2);
          }
          mesh.updateMatrix();
          this._addMesh(mesh, parentGroup);
          this._maybeAddJacket(pipe.type, mesh, length, parentGroup);
        }
      }

      // E-W run
      if (east || west) {
        const startX = west ? cx - halfSeg : cx;
        const endX = east ? cx + halfSeg : cx;
        const length = endX - startX;
        if (length > 0.01) {
          const geo = createPipeSegment(pipe.type, length);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.matrixAutoUpdate = false;
          if (profile.shape === 'rect') {
            mesh.position.set((startX + endX) / 2, pipeYPos, cz + slotX);
          } else {
            mesh.rotation.z = Math.PI / 2;
            mesh.position.set((startX + endX) / 2, pipeYPos, cz + slotX);
          }
          mesh.updateMatrix();
          this._addMesh(mesh, parentGroup);
          this._maybeAddJacket(pipe.type, mesh, length, parentGroup);
        }
      }
    }
  }

  _maybeAddJacket(connType, innerMesh, length, parentGroup) {
    if (connType !== 'cryoTransfer') return;
    const r = UTILITY_PORT_PROFILES.cryoTransfer.radius * 1.5;
    const jacketGeo = new THREE.CylinderGeometry(r, r, length, SEGS);
    if (!this._jacketMat) {
      this._jacketMat = new THREE.MeshStandardMaterial({
        color: 0x1a3340, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.5,
      });
    }
    const jacket = new THREE.Mesh(jacketGeo, this._jacketMat);
    jacket.matrixAutoUpdate = false;
    jacket.position.copy(innerMesh.position);
    jacket.rotation.copy(innerMesh.rotation);
    jacket.updateMatrix();
    this._addMesh(jacket, parentGroup);
  }

  _buildVerticalDrops(portRoutes, parentGroup) {
    for (const route of portRoutes) {
      if (route.rackCol == null) continue;

      const profile = UTILITY_PORT_PROFILES[route.portType];
      if (!profile) continue;
      const mat = getMat(route.portType);

      const slotX = PIPE_SLOTS[route.portType] ?? 0;

      // Rack segment center in world coords
      const rackCx = route.rackCol * TILE_W + TILE_W / 2;
      const rackCz = route.rackRow * TILE_W + TILE_W / 2;

      const dropLen = PIPE_Y - PORT_Y;

      // Component center in world coords
      const compCx = route.col * 2 + 1;
      const compCz = route.row * 2 + 1;

      // Vertical drop
      const vertGeo = createPipeSegment(route.portType, dropLen);
      const vertMesh = new THREE.Mesh(vertGeo, mat);
      vertMesh.matrixAutoUpdate = false;
      vertMesh.position.set(rackCx + slotX, PORT_Y + dropLen / 2, rackCz);
      vertMesh.updateMatrix();
      this._addMesh(vertMesh, parentGroup);

      // Horizontal stub to component port
      const dx = compCx - (rackCx + slotX);
      const dz = compCz - rackCz;
      const horizLen = Math.sqrt(dx * dx + dz * dz);
      if (horizLen > 0.1) {
        const horizGeo = createPipeSegment(route.portType, horizLen);
        const horizMesh = new THREE.Mesh(horizGeo, mat);
        horizMesh.matrixAutoUpdate = false;
        const angle = Math.atan2(dz, dx);
        if (profile.shape === 'rect') {
          horizMesh.rotation.y = -angle;
        } else {
          horizMesh.rotation.z = Math.PI / 2;
          horizMesh.rotation.y = -angle;
        }
        horizMesh.position.set(
          (rackCx + slotX + compCx) / 2,
          PORT_Y,
          (rackCz + compCz) / 2
        );
        horizMesh.updateMatrix();
        this._addMesh(horizMesh, parentGroup);
      }
    }
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
    }
    this._meshes = [];
  }
}
