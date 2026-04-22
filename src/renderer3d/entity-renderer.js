// src/renderer3d/entity-renderer.js
// 3D GLB model renderer for deer entities.
// Each entity is a cloned THREE.Group from a static-pose GLB.
// Pose is swapped (whole mesh replaced) when entity state changes.
// THREE is a CDN global — do NOT import it.

import { cloneDeerModel } from './deer-models.js';
import { ENTITIES } from '../data/entities.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lerp between two angles (radians) taking the shortest arc.
 */
function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff >  Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}

/**
 * Dispose all geometries and materials in a mesh hierarchy.
 * Does NOT dispose textures — they are shared via the GLB cache.
 */
function disposeMesh(mesh) {
  mesh.traverse(o => {
    o.geometry?.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) {
        o.material.forEach(m => m.dispose());
      } else {
        o.material.dispose();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Pose selection
// ---------------------------------------------------------------------------

function pickPose(entity, species) {
  if (entity.state === 'graze') return 'graze';
  if (entity.state === 'flee')  return 'run';
  const speed = Math.hypot(entity.vel?.x ?? 0, entity.vel?.z ?? 0);
  return speed < species.walkMinSpeed ? 'stand' : 'walk';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {THREE.Group} scene  The entity group to add meshes to.
 */
export function createEntityRenderer(scene) {
  // Map<entityId, { mesh: THREE.Group, currentPose: string }>
  const _pool = new Map();

  function _getSpecies(type) {
    return ENTITIES[type] || ENTITIES.deer;
  }

  function _buildMesh(pose, species) {
    const mesh = cloneDeerModel(pose);
    if (!mesh) return null;
    const s = species.modelScale;
    mesh.scale.set(s, s, s);
    return mesh;
  }

  function _addEntity(entity) {
    const species = _getSpecies(entity.type);
    const pose = pickPose(entity, species);

    const mesh = _buildMesh(pose, species);
    if (!mesh) {
      // Models not loaded yet — store a null entry; update() will retry
      _pool.set(entity.id, { mesh: null, currentPose: pose });
      return;
    }

    mesh.position.set(
      entity.pos.x,
      (entity.pos.y ?? 0) + species.modelYOffset,
      entity.pos.z,
    );
    mesh.rotation.y = (entity.heading ?? 0) + species.modelHeadingOffset;

    scene.add(mesh);
    _pool.set(entity.id, { mesh, currentPose: pose });
  }

  function _swapPose(entry, newPose, species) {
    const oldMesh = entry.mesh;
    const savedX = oldMesh?.position.x ?? 0;
    const savedY = oldMesh?.position.y ?? 0;
    const savedZ = oldMesh?.position.z ?? 0;
    const savedRotY = oldMesh?.rotation.y ?? 0;

    if (oldMesh) {
      scene.remove(oldMesh);
      disposeMesh(oldMesh);
    }

    const newMesh = _buildMesh(newPose, species);
    if (!newMesh) {
      // New pose not loaded — keep entry with null mesh
      entry.mesh = null;
      entry.currentPose = newPose;
      return;
    }

    newMesh.position.set(savedX, savedY, savedZ);
    newMesh.rotation.y = savedRotY;
    scene.add(newMesh);

    entry.mesh = newMesh;
    entry.currentPose = newPose;
  }

  function _syncPool(entities) {
    const seen = new Set();
    for (const entity of entities) {
      seen.add(entity.id);
      if (!_pool.has(entity.id)) {
        _addEntity(entity);
      }
    }
    for (const [id, entry] of _pool) {
      if (!seen.has(id)) {
        if (entry.mesh) {
          scene.remove(entry.mesh);
          disposeMesh(entry.mesh);
        }
        _pool.delete(id);
      }
    }
  }

  function update(dt, state) {
    if (!state?.entities?.length) return;
    _syncPool(state.entities);

    const smooth = 1 - Math.exp(-dt * 6);
    const angleLerp = 1 - Math.exp(-dt * 10);

    for (const entity of state.entities) {
      const entry = _pool.get(entity.id);
      if (!entry) continue;

      const species = _getSpecies(entity.type);
      const pose = pickPose(entity, species);

      // If mesh is null (models weren't loaded at _addEntity time), retry building it
      if (!entry.mesh) {
        const mesh = _buildMesh(pose, species);
        if (mesh) {
          mesh.position.set(
            entity.pos.x,
            (entity.pos.y ?? 0) + species.modelYOffset,
            entity.pos.z,
          );
          mesh.rotation.y = (entity.heading ?? 0) + species.modelHeadingOffset;
          scene.add(mesh);
          entry.mesh = mesh;
          entry.currentPose = pose;
        }
        // Still not loaded — skip this frame
        if (!entry.mesh) continue;
      }

      // Swap pose if changed
      if (pose !== entry.currentPose) {
        _swapPose(entry, pose, species);
        if (!entry.mesh) continue;
      }

      const { mesh } = entry;

      // Position smoothing with terrain y-tracking
      const targetY = (entity.pos.y ?? 0) + species.modelYOffset;
      mesh.position.x += (entity.pos.x - mesh.position.x) * smooth;
      mesh.position.z += (entity.pos.z - mesh.position.z) * smooth;
      mesh.position.y += (targetY      - mesh.position.y) * smooth;

      // Heading rotation (smooth shortest-arc lerp around Y axis)
      const targetRotY = (entity.heading ?? 0) + species.modelHeadingOffset;
      mesh.rotation.y = lerpAngle(mesh.rotation.y, targetRotY, angleLerp);
    }
  }

  function dispose() {
    for (const entry of _pool.values()) {
      if (entry.mesh) {
        scene.remove(entry.mesh);
        disposeMesh(entry.mesh);
      }
    }
    _pool.clear();
  }

  return { update, dispose, _pool };
}
