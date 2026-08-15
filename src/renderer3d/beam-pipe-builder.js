// Instanced production renderer for beam-pipe runs and repeated fittings.

import {
  BEAM_PIPE_Y, pipePathRuns, splitRunExcludingModules,
} from '../beamline/pipe-geometry.js';

const PIPE_RADIUS = 0.06;
const FLANGE_R = 0.12;
const FLANGE_W = 0.045;
const STAND_W = 0.06;

function isModuleAt(moduleTiles, col, row) {
  const adjCol = col + 0.5, adjRow = row + 0.5;
  const tileCol = Math.floor(adjCol + 1e-6), tileRow = Math.floor(adjRow + 1e-6);
  const subCol = Math.round((adjCol - tileCol) * 4);
  const subRow = Math.round((adjRow - tileRow) * 4);
  return moduleTiles.has(`${tileCol},${tileRow},${subCol},${subRow}`);
}

function runPose(start, end) {
  const x1 = start.col * 2 + 1, z1 = start.row * 2 + 1;
  const x2 = end.col * 2 + 1, z2 = end.row * 2 + 1;
  const dx = x2 - x1, dz = z2 - z1;
  return {
    x1, z1, x2, z2, dx, dz,
    length: Math.hypot(dx, dz),
    angle: -Math.atan2(dz, dx),
  };
}

function instanceMesh(name, geometry, material, entries, { castShadow = false, receiveShadow = true } = {}) {
  if (entries.length === 0) {
    geometry.dispose(); material.dispose();
    return null;
  }
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.userData.batchedBeamPipes = true;
  mesh.userData.pipeIds = [];
  for (let i = 0; i < entries.length; i++) {
    mesh.setMatrixAt(i, entries[i].matrix);
    mesh.userData.pipeIds[i] = entries[i].pipeId;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

export class BeamPipeBuilder {
  constructor() {
    this._meshes = [];
    this._showDetail = true;
    this._stats = {
      pipes: 0, runs: 0, flanges: 0, supports: 0, caps: 0,
      nearDrawCalls: 0, farDrawCalls: 0, authoredDetailObjects: 0,
    };
  }

  getStats() { return { ...this._stats }; }

  resolveBatchHit(hit) {
    const object = hit?.object;
    if (!object?.userData?.batchedBeamPipes || !Number.isInteger(hit.instanceId)) return null;
    const pipeId = object.userData.pipeIds?.[hit.instanceId] ?? null;
    return pipeId == null ? null : { pipeId, rootObj: object };
  }

  build({ beamPipes = [], moduleSubTiles = [] } = {}, parentGroup) {
    this.dispose(parentGroup);
    const moduleTiles = new Set(moduleSubTiles);
    const endpointKey = (col, row) => `${Math.round(col * 4)},${Math.round(row * 4)}`;
    const endpointCounts = new Map();
    for (const pipe of beamPipes) {
      if (!pipe.path || pipe.path.length < 2) continue;
      for (const point of [pipe.path[0], pipe.path[pipe.path.length - 1]]) {
        const key = endpointKey(point.col, point.row);
        endpointCounts.set(key, (endpointCounts.get(key) || 0) + 1);
      }
    }

    const tubes = [], flanges = [], supports = [], caps = [];
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const addMatrix = (list, pipeId, x, y, z, angle, sx = 1, sy = 1, sz = 1) => {
      position.set(x, y, z);
      rotation.setFromAxisAngle(yAxis, angle);
      scale.set(sx, sy, sz);
      matrix.compose(position, rotation, scale);
      list.push({ pipeId, matrix: matrix.clone() });
    };

    for (const pipe of beamPipes) {
      if (!pipe.path || pipe.path.length < 2) continue;
      const runs = pipePathRuns(pipe.path);
      for (let r = 0; r < runs.length; r++) {
        const origStart = runs[r].start, origEnd = runs[r].end;
        for (const { start, end } of splitRunExcludingModules(origStart, origEnd, moduleTiles)) {
          const pose = runPose(start, end);
          if (pose.length < 0.01) continue;
          addMatrix(tubes, pipe.id,
            (pose.x1 + pose.x2) / 2, BEAM_PIPE_Y, (pose.z1 + pose.z2) / 2,
            pose.angle, pose.length, 1, 1);

          const addFlange = (x, z) => addMatrix(
            flanges, pipe.id, x, BEAM_PIPE_Y, z, pose.angle);
          const isOrigStart = Math.abs(start.col - origStart.col) < 0.01
            && Math.abs(start.row - origStart.row) < 0.01;
          const isOrigEnd = Math.abs(end.col - origEnd.col) < 0.01
            && Math.abs(end.row - origEnd.row) < 0.01;
          if (isOrigStart && r === 0) {
            const shared = (endpointCounts.get(endpointKey(start.col, start.row)) || 0) > 1;
            if (!shared && !isModuleAt(moduleTiles, start.col, start.row)) {
              addFlange(pose.x1, pose.z1);
            }
          }
          if (isOrigStart && r > 0) addFlange(pose.x1, pose.z1);
          if (isOrigEnd && r === runs.length - 1) {
            const shared = (endpointCounts.get(endpointKey(end.col, end.row)) || 0) > 1;
            if (!shared && !isModuleAt(moduleTiles, end.col, end.row)) {
              addFlange(pose.x2, pose.z2);
            }
          }
          if (pose.length > 2.01) {
            const count = Math.floor(pose.length / 2 - 1e-3);
            for (let k = 1; k <= count; k++) {
              const t = (k * 2) / pose.length;
              const x = pose.x1 + pose.dx * t, z = pose.z1 + pose.dz * t;
              if (!isModuleAt(moduleTiles, (x - 1) / 2, (z - 1) / 2)) addFlange(x, z);
            }
          }

          const standH = BEAM_PIPE_Y - PIPE_RADIUS;
          const standCount = Math.max(1, Math.round(pose.length / 2));
          for (let k = 0; k < standCount; k++) {
            const t = (k + 0.5) / standCount;
            const x = pose.x1 + pose.dx * t, z = pose.z1 + pose.dz * t;
            if (!isModuleAt(moduleTiles, (x - 1) / 2, (z - 1) / 2)) {
              addMatrix(supports, pipe.id, x, standH / 2, z, 0);
            }
          }
        }
      }
      const addCap = (tip, previous) => {
        const pose = runPose(previous, tip);
        if (pose.length < 0.01) return;
        addMatrix(caps, pipe.id, pose.x2, BEAM_PIPE_Y, pose.z2, pose.angle);
      };
      if (pipe.openStart) addCap(pipe.path[0], pipe.path[1]);
      if (pipe.openEnd) addCap(pipe.path.at(-1), pipe.path.at(-2));
    }

    const tubeGeo = new THREE.CylinderGeometry(PIPE_RADIUS, PIPE_RADIUS, 1, 8);
    tubeGeo.rotateZ(Math.PI / 2);
    const flangeGeo = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_W, 8);
    flangeGeo.rotateZ(Math.PI / 2);
    const standGeo = new THREE.BoxGeometry(STAND_W, BEAM_PIPE_Y - PIPE_RADIUS, STAND_W);
    const capGeo = new THREE.CylinderGeometry(PIPE_RADIUS * 2.2, PIPE_RADIUS * 2.2, 0.04, 12);
    capGeo.rotateZ(Math.PI / 2);
    const hitGeo = new THREE.CylinderGeometry(0.4, 0.4, 1, 6);
    hitGeo.rotateZ(Math.PI / 2);
    const created = [
      instanceMesh('beam-pipe-runs', tubeGeo, new THREE.MeshStandardMaterial({
        color: 0x99aabb, roughness: 0.3, metalness: 0.5,
      }), tubes, { castShadow: true }),
      instanceMesh('beam-pipe-flanges', flangeGeo, new THREE.MeshStandardMaterial({
        color: 0xbbbbbb, roughness: 0.3, metalness: 0.6,
      }), flanges),
      instanceMesh('beam-pipe-supports', standGeo, new THREE.MeshStandardMaterial({
        color: 0x555555, roughness: 0.7, metalness: 0.1,
      }), supports),
      instanceMesh('beam-pipe-open-caps', capGeo, new THREE.MeshStandardMaterial({
        color: 0xffaa22, roughness: 0.4, metalness: 0.2,
        emissive: 0xcc6600, emissiveIntensity: 0.6,
      }), caps),
      instanceMesh('beam-pipe-hitboxes', hitGeo, new THREE.MeshBasicMaterial({
        visible: false,
      }), tubes, { receiveShadow: false }),
    ].filter(Boolean);
    for (const mesh of created) parentGroup?.add(mesh);
    this._meshes = created;
    this._stats = {
      pipes: beamPipes.length,
      runs: tubes.length,
      flanges: flanges.length,
      supports: supports.length,
      caps: caps.length,
      nearDrawCalls: created.filter(mesh => mesh.material?.visible !== false).length,
      farDrawCalls: (tubes.length ? 1 : 0) + (caps.length ? 1 : 0),
      authoredDetailObjects: tubes.length + flanges.length + supports.length + caps.length,
    };
    this.setDetailLevel(this._showDetail);
  }

  setDetailLevel(showDetail) {
    this._showDetail = !!showDetail;
    for (const mesh of this._meshes) {
      if (mesh.name === 'beam-pipe-flanges' || mesh.name === 'beam-pipe-supports') {
        mesh.visible = this._showDetail;
      }
      if (mesh.name === 'beam-pipe-runs') mesh.castShadow = this._showDetail;
    }
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup?.remove(mesh);
      mesh.dispose?.();
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
    }
    this._meshes = [];
  }
}
