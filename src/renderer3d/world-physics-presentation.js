import { PLACEABLES } from '../data/placeables/index.js';
import { DebrisSystem } from '../physics/debris-system.js';
import { StaffRagdolls } from '../physics/staff-ragdolls.js';
import { WorldPhysics } from '../physics/world-physics.js';

/**
 * Owns the optional physics presentation layered over the canonical game world.
 *
 * The renderer remains the source of authored meshes, but it does not need to
 * know how incident snapshots, lazy Rapier bodies, ragdolls, and debris fit
 * together. None of the transforms managed here are written back to game state.
 */
export class WorldPhysicsPresentation {
  constructor(renderObjects) {
    this.renderObjects = renderObjects;
    this.world = null;
    this.worldIds = new Set();
    this.bodiesDirty = true;
    this.incidentSnapshot = null;
    this.staffRagdolls = null;
    this.debris = null;
  }

  async init(scene) {
    this.world = await new WorldPhysics().init();
    // A low safety slab catches objects that leave the finite terrain mesh
    // without duplicating contacts on the ordinary y≈0 terrain surface.
    this.world.addGround({ y: -20 });
    this.debris = new DebrisSystem(this.world, scene);
  }

  attachStaff(staffPawns, scene) {
    this.staffRagdolls?.dispose();
    this.staffRagdolls = new StaffRagdolls(staffPawns, this.world, scene);
  }

  update(dt) {
    this.world?.update(dt);
  }

  explode(position, options = {}, emitVisualEffect = null) {
    if (!this.world?.ready || !position) return [];
    // Incident undo is one-level and atomic: restore the prior presentation
    // before capturing the next baseline.
    if (this.incidentSnapshot) this.undo();
    this.ensureBodies();
    this.incidentSnapshot = this.world.captureSnapshot();

    const radius = Math.max(0.1, Number(options.radius) || 7);
    const strength = Math.max(0, Number(options.strength) || 90);
    emitVisualEffect?.({
      kind: 'burst', position,
      color: options.color ?? 0xffb04a,
      intensity: options.lightIntensity ?? Math.min(80, strength * 0.55),
      durationMs: options.durationMs ?? 700,
      radius: options.visualRadius ?? Math.max(0.35, radius * 0.08),
      groundRadius: options.groundRadius ?? radius * 0.45,
    });

    const ragdolls = options.ragdolls === false
      ? [] : (this.staffRagdolls?.ragdollNear(position, options.ragdollRadius ?? radius) || []);
    const fractures = options.fracture === false
      ? [] : (this.debris?.fractureNear(position, options.fractureRadius ?? radius) || []);
    const impacts = this.world.explode(position, { ...options, radius, strength });
    impacts.ragdolls = ragdolls;
    impacts.fractures = fractures;
    return impacts;
  }

  undo() {
    if (!this.incidentSnapshot || !this.world) return false;
    this.staffRagdolls?.restoreAll();
    this.debris?.restoreAll();
    const restored = this.world.restoreSnapshot(this.incidentSnapshot);
    if (restored) {
      this.incidentSnapshot = null;
      this._releaseAuthoredBodies();
      this.bodiesDirty = true;
    }
    return restored;
  }

  stats() {
    return {
      ...(this.world?.getStats?.() || { ready: false, bodies: 0, joints: 0 }),
      ...(this.staffRagdolls?.getStats?.() || { ragdolls: 0, articulatedBodies: 0 }),
      ...(this.debris?.getStats?.() || { fracturedObjects: 0, fragments: 0 }),
    };
  }

  markBodiesDirty() {
    if (!this.world?.ready) return;
    // Construction can arrive while an incident is active. Restore authored
    // transforms before releasing their lazy colliders.
    if (this.incidentSnapshot && this.undo()) return;
    this.staffRagdolls?.restoreAll();
    this.debris?.restoreAll();
    this.incidentSnapshot = null;
    this._releaseAuthoredBodies();
    this.bodiesDirty = true;
  }

  ensureBodies() {
    if (this.bodiesDirty) this.syncBodies();
  }

  syncBodies() {
    if (!this.world?.ready) return;
    this.staffRagdolls?.restoreAll();
    this.debris?.restoreAll();
    this.incidentSnapshot = null;
    this._releaseAuthoredBodies();

    const register = (object, id, kind, options = {}) => {
      if (!object || !id) return;
      try {
        this.world.registerObject(object, {
          id, kind, active: false,
          destructible: options.destructible !== false,
          densityKgM3: options.densityKgM3,
          massKg: options.massKg,
          friction: options.friction,
          restitution: options.restitution,
        });
        this.worldIds.add(id);
      } catch (error) {
        console.warn(`[Physics] Could not register ${id}.`, error);
      }
    };

    const source = this.renderObjects;
    for (const object of source.equipmentMeshes?.() || []) {
      const data = object.userData || {};
      register(object, `world:${data.physicsId}`, data.physicsKind || 'equipment', {
        massKg: data.physicsMassKg,
        densityKgM3: data.physicsDensityKgM3,
      });
    }
    for (const [id, object] of source.componentMeshes?.() || []) {
      const def = PLACEABLES[object.userData?.compType];
      register(object, `world:beamline:${id}`, 'beamline', {
        restitution: 0.04,
        massKg: def?.physicsMassKg,
        densityKgM3: def?.physicsDensityKgM3,
      });
    }
    for (const object of source.decorationGroups?.() || []) {
      const id = object.userData?.nodeId;
      const def = PLACEABLES[object.userData?.placeableType];
      if (id != null) register(object, `world:decoration:${id}`, 'decoration', {
        massKg: def?.physicsMassKg,
        densityKgM3: def?.physicsDensityKgM3,
      });
    }

    // Walls stop thrown objects but never activate under radial impulses.
    let wallIndex = 0;
    source.forEachWallMesh?.((object) => {
      if (!object.isMesh || object.material?.visible === false) return;
      register(object, `world:wall:${wallIndex++}`, 'concrete', {
        destructible: false, friction: 0.85, restitution: 0.02,
      });
    });
    this.syncTerrain();
    this.bodiesDirty = false;
  }

  syncTerrain() {
    if (!this.world?.ready) return;
    try {
      this.world.setTerrainMesh(this.renderObjects.terrainMesh?.());
    } catch (error) {
      console.warn('[Physics] Could not rebuild the terrain collider.', error);
    }
  }

  dispose() {
    this.staffRagdolls?.dispose();
    this.staffRagdolls = null;
    this.debris?.dispose();
    this.debris = null;
    this.world?.dispose();
    this.world = null;
    this.worldIds.clear();
    this.incidentSnapshot = null;
    this.bodiesDirty = true;
  }

  _releaseAuthoredBodies() {
    for (const id of this.worldIds) this.world?.unregisterObject(id);
    this.worldIds.clear();
  }
}

export default WorldPhysicsPresentation;
