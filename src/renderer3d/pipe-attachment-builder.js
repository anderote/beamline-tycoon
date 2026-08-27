// Batched renderer for components mounted along beam and utility pipes.
// Near geometry retains the authored model in a few material batches. Far
// geometry is exported from those same authored primitives by ComponentBuilder
// and instanced here; this keeps both runtime ownership paths visually aligned.

import { COMPONENTS } from '../data/components.js';
import { ComponentBuilder, componentPose, isDetailedComponent } from './component-builder.js';

const SUB = 0.5;
const BEAM_Y = 1.0;

function triangles(geometry) {
  if (!geometry?.attributes?.position) return 0;
  return (geometry.index?.count || geometry.attributes.position.count) / 3;
}

function makeFallbackFarGeometry(def, width, height, depth) {
  if (def.geometryType === 'cylinder') {
    const radius = width / 2;
    const geometry = new THREE.CylinderGeometry(radius, radius, depth, 12);
    geometry.rotateX(Math.PI / 2);
    geometry.scale(1, height / width, 1);
    return geometry;
  }
  return new THREE.BoxGeometry(width, height, depth);
}

function makeRoot(comp, def, pose) {
  const root = new THREE.Group();
  root.position.set(pose.x, pose.y, pose.z);
  root.rotation.y = pose.rotY;
  root.userData.nodeId = comp.id;
  root.userData.pipeId = comp.pipeId || null;
  root.userData.utilityLineId = comp.utilityLineId || null;
  root.userData.compType = comp.type;
  root.userData.batchedAttachmentRoot = true;
  root.userData.outlineBounds = {
    width: Math.max(SUB, (def.subW || 2) * SUB),
    height: Math.max(SUB, (def.subH || 2) * SUB),
    depth: Math.max(SUB, (comp.subL ?? def.subL ?? 2) * SUB),
  };
  return root;
}

export class PipeAttachmentBuilder {
  constructor() {
    this._factory = new ComponentBuilder({ buildFarBatches: false });
    this._ordinary = new ComponentBuilder({ buildFarBatches: false });
    this._meshMap = new Map();
    this._nearBatches = [];
    this._farBatches = [];
    this._stats = { attachments: 0, nearBatches: 0, farBatches: 0, authoredParts: 0 };
    this._showDetail = true;
    this._farMaterial = null;
  }

  getGroup(id) { return this._meshMap.get(id) || this._ordinary.getGroup(id); }
  getBatchStats() { return { ...this._stats }; }

  resolveBatchHit(hit) {
    const object = hit?.object;
    if (!object?.userData?.batchedAttachments) return null;
    const index = hit.batchId ?? hit.instanceId;
    if (!Number.isInteger(index)) return null;
    const attachmentId = object.userData.attachmentIds?.[index] ?? null;
    return {
      attachmentId,
      pipeId: object.userData.pipeIds?.[index] ?? null,
      lineId: object.userData.lineIds?.[index] ?? null,
      rootObj: attachmentId != null ? (this.getGroup(attachmentId) || object) : object,
    };
  }

  _buildNear(components, parentGroup) {
    const buckets = new Map();
    const sources = [];
    const accepted = [];
    const rejected = [];
    for (const comp of components) {
      const def = COMPONENTS[comp.type] || {};
      const detailed = isDetailedComponent(comp.type, def);
      const pose = componentPose(def, comp, detailed);
      const root = makeRoot(comp, def, pose);
      this._meshMap.set(comp.id, root);

      const object = this._factory.createObject(def, comp.accentColor ?? 0xc62828);
      object.position.set(pose.x, pose.y, pose.z);
      object.rotation.y = pose.rotY;
      object.updateMatrixWorld(true);
      let batchable = true;
      object.traverse(child => {
        if (!child.isMesh || child.material?.visible === false) return;
        if (!child.geometry || !child.material || Array.isArray(child.material)) batchable = false;
      });
      if (!batchable || comp.dimmed) {
        this._factory.disposeObject(object);
        this._meshMap.delete(comp.id);
        rejected.push(comp);
        continue;
      }
      accepted.push(comp);

      object.traverse(child => {
        if (!child.isMesh || child.material?.visible === false || !child.geometry) return;
        const key = [child.material.uuid, child.castShadow ? 1 : 0,
          child.receiveShadow ? 1 : 0].join('|');
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = {
            material: child.material,
            castShadow: child.castShadow,
            receiveShadow: child.receiveShadow,
            entries: [],
            geometries: new Set(),
          };
          buckets.set(key, bucket);
        }
        bucket.geometries.add(child.geometry);
        bucket.entries.push({
          geometry: child.geometry,
          matrix: child.matrixWorld.clone(),
          id: comp.id,
          pipeId: comp.pipeId || null,
          lineId: comp.utilityLineId || null,
          triangles: triangles(child.geometry),
        });
      });
      sources.push(object);
    }

    for (const bucket of buckets.values()) {
      const geometries = [...bucket.geometries];
      const maxVertices = geometries.reduce(
        (sum, geometry) => sum + geometry.getAttribute('position').count, 0);
      const maxIndices = geometries.reduce(
        (sum, geometry) => sum + (geometry.getIndex()?.count || 0), 0);
      const batch = new THREE.BatchedMesh(
        bucket.entries.length,
        maxVertices,
        Math.max(maxIndices, maxVertices),
        // The temporary source wrapper may own its material. Keep the batch
        // independent so source teardown can never invalidate a live batch.
        bucket.material.clone(),
      );
      const geometryIds = new Map();
      batch.userData.batchedAttachments = true;
      batch.userData.attachmentIds = [];
      batch.userData.pipeIds = [];
      batch.userData.lineIds = [];
      batch.userData.lod = 'attachment-near';
      batch.userData.renderedTriangles = 0;
      batch.castShadow = bucket.castShadow;
      batch.receiveShadow = bucket.receiveShadow;
      for (const entry of bucket.entries) {
        let geometryId = geometryIds.get(entry.geometry);
        if (geometryId == null) {
          geometryId = batch.addGeometry(entry.geometry);
          geometryIds.set(entry.geometry, geometryId);
        }
        const batchId = batch.addInstance(geometryId);
        batch.setMatrixAt(batchId, entry.matrix);
        batch.userData.attachmentIds[batchId] = entry.id;
        batch.userData.pipeIds[batchId] = entry.pipeId;
        batch.userData.lineIds[batchId] = entry.lineId;
        batch.userData.renderedTriangles += entry.triangles;
      }
      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      parentGroup.add(batch);
      this._nearBatches.push(batch);
    }
    for (const source of sources) this._factory.disposeObject(source);
    this._stats.authoredParts = [...buckets.values()]
      .reduce((sum, bucket) => sum + bucket.entries.length, 0);
    return { accepted, rejected };
  }

  _buildFar(components, parentGroup) {
    const byType = new Map();
    for (const comp of components) {
      const def = COMPONENTS[comp.type] || {};
      const pose = componentPose(def, comp, isDetailedComponent(comp.type, def));
      let bucket = byType.get(comp.type);
      if (!bucket) {
        bucket = { def, entries: [] };
        byType.set(comp.type, bucket);
      }
      bucket.entries.push({ comp, pose });
    }

    for (const [type, bucket] of byType) {
      const { def } = bucket;
      const width = Math.max(SUB, (def.subW || 2) * SUB);
      const height = Math.max(SUB, (def.subH || 2) * SUB);
      const depth = Math.max(SUB, (def.subL || 2) * SUB);
      const accentColor = bucket.entries[0]?.comp?.accentColor ?? 0xc62828;
      const geometry = this._factory.getAuthoredFarGeometry(def, accentColor)
        || makeFallbackFarGeometry(def, width, height, depth);
      const usesVertexColors = !!geometry.attributes?.color;
      this._farMaterial ??= new THREE.MeshStandardMaterial({
          color: usesVertexColors ? 0xffffff : (def.spriteColor ?? 0x778899),
          vertexColors: usesVertexColors,
          roughness: usesVertexColors ? 0.58 : 0.7,
          metalness: usesVertexColors ? 0.28 : 0.15,
        });
      this._farMaterial.userData.sharedFarMaterial = true;
      const mesh = new THREE.InstancedMesh(
        geometry,
        this._farMaterial,
        bucket.entries.length,
      );
      mesh.name = `attachment-far-${type}`;
      mesh.userData.batchedAttachments = true;
      mesh.userData.attachmentIds = [];
      mesh.userData.pipeIds = [];
      mesh.userData.lineIds = [];
      mesh.userData.lod = 'attachment-far';
      mesh.userData.farSilhouetteKind = geometry.userData?.farSilhouetteKind || 'footprint';
      mesh.userData.farPartRoles = geometry.userData?.farPartRoles || ['body'];
      mesh.userData.farPartCount = geometry.userData?.farPartCount || 1;
      mesh.userData.farPrimitiveCount = geometry.userData?.farPrimitiveCount
        || geometry.userData?.farPartCount || 1;
      mesh.userData.farSourcePartCount = geometry.userData?.farSourcePartCount || 1;
      mesh.userData.farSelectedPartNames = geometry.userData?.farSelectedPartNames || [];
      mesh.userData.farSelectedGroupNames = geometry.userData?.farSelectedGroupNames || [];
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const position = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      const scale = new THREE.Vector3(1, 1, 1);
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < bucket.entries.length; i++) {
        const { comp, pose } = bucket.entries[i];
        position.set(pose.x, Number.isFinite(pose.y) ? pose.y : BEAM_Y, pose.z);
        rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.rotY);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(i, matrix);
        mesh.userData.attachmentIds[i] = comp.id;
        mesh.userData.pipeIds[i] = comp.pipeId || null;
        mesh.userData.lineIds[i] = comp.utilityLineId || null;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      parentGroup.add(mesh);
      this._farBatches.push(mesh);
    }
  }

  build(componentData, parentGroup) {
    if (!parentGroup) return;
    this.dispose(parentGroup);
    const all = componentData || [];
    if (typeof THREE.BatchedMesh !== 'function') {
      this._ordinary.build(all, parentGroup);
      return;
    }
    const batchable = all.filter(comp => !comp.dimmed && COMPONENTS[comp.type]);
    const batchableSet = new Set(batchable);
    const ordinary = all.filter(comp => !batchableSet.has(comp));
    const { accepted, rejected } = this._buildNear(batchable, parentGroup);
    this._ordinary.build([...ordinary, ...rejected], parentGroup);
    this._buildFar(accepted, parentGroup);
    this._stats.attachments = all.length;
    this._stats.nearBatches = this._nearBatches.length;
    this._stats.farBatches = this._farBatches.length;
    this.setDetailLevel(this._showDetail);
  }

  setDetailLevel(showDetail) {
    this._showDetail = !!showDetail;
    for (const batch of this._nearBatches) batch.visible = this._showDetail;
    for (const batch of this._farBatches) batch.visible = !this._showDetail;
  }

  dispose(parentGroup) {
    this._ordinary.dispose(parentGroup);
    for (const batch of this._nearBatches) {
      parentGroup?.remove(batch);
      batch.dispose?.();
      batch.material?.dispose?.();
    }
    for (const mesh of this._farBatches) {
      parentGroup?.remove(mesh);
      mesh.dispose?.();
      if (!mesh.geometry?.userData?.sharedFarGeometry) mesh.geometry?.dispose?.();
    }
    this._nearBatches = [];
    this._farBatches = [];
    this._meshMap.clear();
    this._stats = { attachments: 0, nearBatches: 0, farBatches: 0, authoredParts: 0 };
    this._farMaterial?.dispose?.();
    this._farMaterial = null;
  }
}
