// Instanced production renderer for beam-pipe runs and repeated fittings.

import {
  BEAM_PIPE_Y, pipePathRuns, splitRunExcludingModules,
} from '../beamline/pipe-geometry.js';
import {
  BEAM_PIPE_RADIUS, BEAM_FLANGE_RADIUS, BEAM_FLANGE_WIDTH,
} from '../beamline/visual-geometry.js';
import { contentKey } from './content-hash.js';

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

function endpointKey(col, row) {
  return `${Math.round(col * 4)},${Math.round(row * 4)}`;
}

function nextCapacity(count) {
  let capacity = 1;
  while (capacity < count) capacity *= 2;
  return capacity;
}

function disposeInstanceMesh(mesh, parentGroup) {
  if (!mesh) return;
  parentGroup?.remove(mesh);
  mesh.dispose?.();
  mesh.geometry?.dispose?.();
  mesh.material?.dispose?.();
}

const MESH_SPECS = Object.freeze([
  {
    name: 'beam-pipe-runs', source: 'tubes', castShadow: true,
    geometry: () => {
      const geometry = new THREE.CylinderGeometry(BEAM_PIPE_RADIUS, BEAM_PIPE_RADIUS, 1, 8);
      geometry.rotateZ(Math.PI / 2);
      return geometry;
    },
    material: () => new THREE.MeshStandardMaterial({
      color: 0x99aabb, roughness: 0.3, metalness: 0.5,
    }),
  },
  {
    name: 'beam-pipe-flanges', source: 'flanges',
    geometry: () => {
      const geometry = new THREE.CylinderGeometry(
        BEAM_FLANGE_RADIUS, BEAM_FLANGE_RADIUS, BEAM_FLANGE_WIDTH, 8,
      );
      geometry.rotateZ(Math.PI / 2);
      return geometry;
    },
    material: () => new THREE.MeshStandardMaterial({
      color: 0xbbbbbb, roughness: 0.3, metalness: 0.6,
    }),
  },
  {
    name: 'beam-pipe-supports', source: 'supports',
    geometry: () => new THREE.BoxGeometry(
      STAND_W, BEAM_PIPE_Y - BEAM_PIPE_RADIUS, STAND_W,
    ),
    material: () => new THREE.MeshStandardMaterial({
      color: 0x555555, roughness: 0.7, metalness: 0.1,
    }),
  },
  {
    name: 'beam-pipe-open-caps', source: 'caps',
    geometry: () => {
      const geometry = new THREE.CylinderGeometry(
        BEAM_PIPE_RADIUS * 2.2, BEAM_PIPE_RADIUS * 2.2, 0.04, 12,
      );
      geometry.rotateZ(Math.PI / 2);
      return geometry;
    },
    material: () => new THREE.MeshStandardMaterial({
      color: 0xffaa22, roughness: 0.4, metalness: 0.2,
      emissive: 0xcc6600, emissiveIntensity: 0.6,
    }),
  },
  {
    name: 'beam-pipe-hitboxes', source: 'tubes', receiveShadow: false,
    geometry: () => {
      const geometry = new THREE.CylinderGeometry(0.4, 0.4, 1, 6);
      geometry.rotateZ(Math.PI / 2);
      return geometry;
    },
    material: () => new THREE.MeshBasicMaterial({ visible: false }),
  },
]);

function buildPipeFragment(pipe, moduleTiles, endpointCounts) {
  const fragment = { tubes: [], flanges: [], supports: [], caps: [] };
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const addMatrix = (list, x, y, z, angle, sx = 1, sy = 1, sz = 1) => {
    position.set(x, y, z);
    rotation.setFromAxisAngle(yAxis, angle);
    scale.set(sx, sy, sz);
    matrix.compose(position, rotation, scale);
    list.push({ pipeId: pipe.id, matrix: matrix.clone() });
  };

  const runs = pipePathRuns(pipe.path);
  for (let r = 0; r < runs.length; r++) {
    const origStart = runs[r].start, origEnd = runs[r].end;
    for (const { start, end } of splitRunExcludingModules(origStart, origEnd, moduleTiles)) {
      const pose = runPose(start, end);
      if (pose.length < 0.01) continue;
      addMatrix(
        fragment.tubes,
        (pose.x1 + pose.x2) / 2, BEAM_PIPE_Y, (pose.z1 + pose.z2) / 2,
        pose.angle, pose.length, 1, 1,
      );

      const addFlange = (x, z) => addMatrix(
        fragment.flanges, x, BEAM_PIPE_Y, z, pose.angle,
      );
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

      const standH = BEAM_PIPE_Y - BEAM_PIPE_RADIUS;
      const standCount = Math.max(1, Math.round(pose.length / 2));
      for (let k = 0; k < standCount; k++) {
        const t = (k + 0.5) / standCount;
        const x = pose.x1 + pose.dx * t, z = pose.z1 + pose.dz * t;
        if (!isModuleAt(moduleTiles, (x - 1) / 2, (z - 1) / 2)) {
          addMatrix(fragment.supports, x, standH / 2, z, 0);
        }
      }
    }
  }

  const addCap = (tip, previous) => {
    const pose = runPose(previous, tip);
    if (pose.length < 0.01) return;
    addMatrix(fragment.caps, pose.x2, BEAM_PIPE_Y, pose.z2, pose.angle);
  };
  if (pipe.openStart) addCap(pipe.path[0], pipe.path[1]);
  if (pipe.openEnd) addCap(pipe.path.at(-1), pipe.path.at(-2));
  return fragment;
}

export class BeamPipeBuilder {
  constructor() {
    this._meshes = [];
    this._meshesByName = new Map();
    this._fragmentsById = new Map();
    this._fragmentSignatures = new Map();
    this._inputSignature = null;
    this._moduleSignature = null;
    this._showDetail = true;
    this._stats = {
      pipes: 0, runs: 0, flanges: 0, supports: 0, caps: 0,
      nearDrawCalls: 0, farDrawCalls: 0, authoredDetailObjects: 0,
      reconciledPipes: 0, reusedPipes: 0, resizedMeshes: 0,
    };
  }

  getStats() { return { ...this._stats }; }

  resolveBatchHit(hit) {
    const object = hit?.object;
    if (!object?.userData?.batchedBeamPipes || !Number.isInteger(hit.instanceId)) return null;
    const pipeId = object.userData.pipeIds?.[hit.instanceId] ?? null;
    return pipeId == null ? null : { pipeId, rootObj: object };
  }

  _syncInstanceMesh(spec, entries, parentGroup) {
    const existing = this._meshesByName.get(spec.name);
    if (entries.length === 0) {
      if (existing) {
        disposeInstanceMesh(existing, parentGroup);
        this._meshesByName.delete(spec.name);
      }
      return { mesh: null, resized: !!existing };
    }

    let mesh = existing;
    const capacity = existing?.userData?.instanceCapacity || 0;
    let resized = false;
    if (!mesh || capacity < entries.length) {
      if (mesh) disposeInstanceMesh(mesh, parentGroup);
      const next = nextCapacity(entries.length);
      mesh = new THREE.InstancedMesh(spec.geometry(), spec.material(), next);
      mesh.name = spec.name;
      mesh.castShadow = spec.castShadow === true;
      mesh.receiveShadow = spec.receiveShadow !== false;
      mesh.userData.batchedBeamPipes = true;
      mesh.userData.instanceCapacity = next;
      mesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage);
      parentGroup?.add(mesh);
      this._meshesByName.set(spec.name, mesh);
      resized = true;
    }

    mesh.count = entries.length;
    mesh.userData.pipeIds = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) {
      mesh.setMatrixAt(i, entries[i].matrix);
      mesh.userData.pipeIds[i] = entries[i].pipeId;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    return { mesh, resized };
  }

  build({ beamPipes = [], moduleSubTiles = [] } = {}, parentGroup) {
    const inputSignature = contentKey([beamPipes, moduleSubTiles]);
    if (inputSignature === this._inputSignature) {
      return { changed: false, reconciledPipes: 0, reusedPipes: beamPipes.length, resizedMeshes: 0 };
    }

    const moduleSignature = contentKey(moduleSubTiles);
    if (moduleSignature !== this._moduleSignature) {
      // A module can split any intersecting run. This is intentionally the
      // broad fallback; ordinary pipe edits retain every unaffected fragment.
      this._fragmentsById.clear();
      this._fragmentSignatures.clear();
      this._moduleSignature = moduleSignature;
    }
    const moduleTiles = new Set(moduleSubTiles);
    const endpointCounts = new Map();
    for (const pipe of beamPipes) {
      if (!pipe.path || pipe.path.length < 2) continue;
      for (const point of [pipe.path[0], pipe.path[pipe.path.length - 1]]) {
        const key = endpointKey(point.col, point.row);
        endpointCounts.set(key, (endpointCounts.get(key) || 0) + 1);
      }
    }

    const orderedIds = [];
    const seen = new Set();
    let reconciledPipes = 0;
    let reusedPipes = 0;
    for (let index = 0; index < beamPipes.length; index++) {
      const pipe = beamPipes[index];
      if (!pipe?.path || pipe.path.length < 2) continue;
      const id = pipe.id ?? `beam-pipe:${index}`;
      const first = pipe.path[0];
      const last = pipe.path[pipe.path.length - 1];
      const signature = contentKey([
        pipe,
        endpointCounts.get(endpointKey(first.col, first.row)) || 0,
        endpointCounts.get(endpointKey(last.col, last.row)) || 0,
      ]);
      orderedIds.push(id);
      seen.add(id);
      if (this._fragmentSignatures.get(id) === signature && this._fragmentsById.has(id)) {
        reusedPipes++;
        continue;
      }
      this._fragmentsById.set(id, buildPipeFragment(pipe, moduleTiles, endpointCounts));
      this._fragmentSignatures.set(id, signature);
      reconciledPipes++;
    }
    for (const id of [...this._fragmentsById.keys()]) {
      if (seen.has(id)) continue;
      this._fragmentsById.delete(id);
      this._fragmentSignatures.delete(id);
    }

    const entriesBySource = { tubes: [], flanges: [], supports: [], caps: [] };
    for (const id of orderedIds) {
      const fragment = this._fragmentsById.get(id);
      if (!fragment) continue;
      for (const source of Object.keys(entriesBySource)) {
        entriesBySource[source].push(...fragment[source]);
      }
    }

    let resizedMeshes = 0;
    for (const spec of MESH_SPECS) {
      const result = this._syncInstanceMesh(spec, entriesBySource[spec.source], parentGroup);
      if (result.resized) resizedMeshes++;
    }
    this._meshes = MESH_SPECS
      .map(spec => this._meshesByName.get(spec.name))
      .filter(Boolean);
    const tubes = entriesBySource.tubes;
    const flanges = entriesBySource.flanges;
    const supports = entriesBySource.supports;
    const caps = entriesBySource.caps;
    this._stats = {
      pipes: beamPipes.length,
      runs: tubes.length,
      flanges: flanges.length,
      supports: supports.length,
      caps: caps.length,
      nearDrawCalls: this._meshes.filter(mesh => mesh.material?.visible !== false).length,
      farDrawCalls: (tubes.length ? 1 : 0) + (caps.length ? 1 : 0),
      authoredDetailObjects: tubes.length + flanges.length + supports.length + caps.length,
      reconciledPipes,
      reusedPipes,
      resizedMeshes,
    };
    this._inputSignature = inputSignature;
    this.setDetailLevel(this._showDetail);
    return { changed: true, reconciledPipes, reusedPipes, resizedMeshes };
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
    for (const mesh of this._meshesByName.values()) disposeInstanceMesh(mesh, parentGroup);
    this._meshes = [];
    this._meshesByName.clear();
    this._fragmentsById.clear();
    this._fragmentSignatures.clear();
    this._inputSignature = null;
    this._moduleSignature = null;
  }
}
