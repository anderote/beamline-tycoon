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
  constructor(renderObjects, dependencies = {}) {
    this.renderObjects = renderObjects;
    this.createWorld = dependencies.createWorld || (() => new WorldPhysics());
    this.createDebris = dependencies.createDebris || ((world, scene) => new DebrisSystem(world, scene));
    this.createRagdolls = dependencies.createRagdolls
      || ((staffPawns, world, scene) => new StaffRagdolls(staffPawns, world, scene));
    this.world = null;
    this.worldIds = new Set();
    this.portableDrops = new Map();
    this.bodiesDirty = true;
    this.incidentSnapshot = null;
    this.staffRagdolls = null;
    this.debris = null;
    this.scene = null;
    this.staffPawns = null;
    this.initPromise = null;
    this.idleHandle = null;
    this.idleKind = null;
    this.disposed = false;
  }

  async init(scene) {
    if (scene) this.scene = scene;
    if (this.disposed) return null;
    if (this.world?.ready) return this.world;
    if (this.initPromise) return this.initPromise;
    this.cancelScheduledInit();
    this.initPromise = (async () => {
      const world = await this.createWorld().init();
      if (this.disposed) {
        world.dispose();
        return null;
      }
      // A low safety slab catches objects that leave the finite terrain mesh
      // without duplicating contacts on the ordinary y≈0 terrain surface.
      world.addGround({ y: -20 });
      this.world = world;
      this.debris = this.createDebris(world, this.scene);
      if (this.staffPawns) {
        this.staffRagdolls = this.createRagdolls(this.staffPawns, world, this.scene);
      }
      this.syncTerrain();
      return world;
    })();
    try {
      return await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  scheduleInit(scene) {
    if (scene) this.scene = scene;
    if (this.disposed || this.world?.ready || this.initPromise || this.idleHandle != null) return;
    const start = () => {
      this.idleHandle = null;
      this.idleKind = null;
      this.init().catch(error => console.warn('[Physics] Deferred initialization failed.', error));
    };
    if (typeof requestIdleCallback === 'function') {
      this.idleKind = 'idle';
      this.idleHandle = requestIdleCallback(start, { timeout: 2500 });
    } else {
      this.idleKind = 'timeout';
      this.idleHandle = setTimeout(start, 0);
    }
  }

  cancelScheduledInit() {
    if (this.idleHandle == null) return;
    if (this.idleKind === 'idle' && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(this.idleHandle);
    } else {
      clearTimeout(this.idleHandle);
    }
    this.idleHandle = null;
    this.idleKind = null;
  }

  attachStaff(staffPawns, scene) {
    this.staffPawns = staffPawns;
    if (scene) this.scene = scene;
    if (!this.world?.ready) return;
    this.staffRagdolls?.dispose();
    this.staffRagdolls = this.createRagdolls(staffPawns, this.world, this.scene);
  }

  update(dt) {
    this.world?.update(dt);
    if (!this.portableDrops.size) return;
    const elapsed = Math.max(0, Number(dt) || 0);
    for (const [id, drop] of [...this.portableDrops]) {
      drop.elapsed += elapsed;
      const sleeping = drop.record?.body?.isSleeping?.() === true;
      if ((drop.elapsed >= 0.18 && sleeping) || drop.elapsed >= drop.maxDuration) {
        this._finishPortableDrop(id);
      }
    }
  }

  /**
   * Drop one canonical small placeable from just above its committed pose.
   * The rigid-body transform is presentation-only; settling restores the
   * exact authored pose so occupancy, save data, utilities, and undo do not
   * inherit floating-point physics drift.
   */
  async dropPortable(placeableId, options = {}) {
    if (!placeableId || this.disposed) return false;
    const world = this.world?.ready ? this.world : await this.init(this.scene);
    if (!world || this.disposed) return false;

    const object = (this.renderObjects.equipmentMeshes?.() || [])
      .find(candidate => candidate?.userData?.placeableId === placeableId);
    const def = PLACEABLES[object?.userData?.placeableType];
    if (!object || def?.portable !== true) return false;

    // A construction gesture supersedes transient incident/drop transforms.
    // Restore first so a body is always registered from its canonical pose.
    this._finishPortableDrops();
    if (this.incidentSnapshot) this.undo();
    this._releaseAuthoredBodies();
    this.bodiesDirty = true;

    const id = `portable:${placeableId}`;
    let record;
    try {
      record = world.registerObject(object, {
        id,
        kind: object.userData.physicsKind || 'equipment',
        active: false,
        destructible: false,
        massKg: object.userData.physicsMassKg,
        densityKgM3: object.userData.physicsDensityKgM3,
        friction: 0.82,
        restitution: 0.03,
      });
    } catch (error) {
      console.warn(`[Physics] Could not drop ${placeableId}.`, error);
      return false;
    }
    if (!record) return false;

    const visualW = def.visualSubW ?? def.subW ?? 1;
    const visualL = def.visualSubL ?? def.subL ?? 1;
    const footprintRadius = Math.max(def.subW || 1, def.subL || 1, visualW, visualL) * 0.25;
    const height = Number.isFinite(options.height)
      ? options.height
      : Math.max(0.6, (def.visualSubH ?? def.subH ?? 1) * 0.35 + 0.35);
    const canonical = world.startDrop(record, { height });
    if (!canonical) {
      world.unregisterObject(record);
      return false;
    }
    const support = world.addTemporarySupport({
      x: canonical.translation.x,
      topY: canonical.translation.y,
      z: canonical.translation.z,
      halfWidth: footprintRadius + 0.03,
      halfDepth: footprintRadius + 0.03,
    });
    this.worldIds.add(id);
    this.portableDrops.set(id, {
      record,
      canonical,
      support,
      elapsed: 0,
      maxDuration: Math.max(0.5, Number(options.maxDuration) || 3),
    });
    return true;
  }

  explode(position, options = {}, emitVisualEffect = null) {
    if (!position) return [];
    if (!this.world?.ready) {
      const queuedPosition = {
        x: Number(position.x) || 0,
        y: Number(position.y) || 0,
        z: Number(position.z) || 0,
      };
      const queuedOptions = { ...options };
      this.init().then(world => {
        if (world && !this.disposed) this.explode(queuedPosition, queuedOptions, emitVisualEffect);
      }).catch(error => console.warn('[Physics] Could not run queued incident.', error));
      return [];
    }
    this._finishPortableDrops();
    // Incident undo is one-level and atomic: restore the prior presentation
    // before capturing the next baseline.
    if (this.incidentSnapshot) this.undo();
    this.ensureBodies();
    this.incidentSnapshot = this.world.captureSnapshot();

    const radius = Math.max(0.1, Number(options.radius) || 7);
    const strength = Math.max(0, Number(options.strength) || 90);
    const visualRadius = options.visualRadius ?? Math.max(0.35, radius * 0.08);
    const floorY = options.floorY;
    // Layered packets share the existing bounded instanced-effect path: a
    // short white-hot ignition, the orange fireball, and a flatter expanding
    // pressure front. Only the ignition borrows a physical light slot.
    const effects = [
      {
        kind: 'burst', position, color: options.coreColor ?? 0xfff4c2,
        intensity: options.lightIntensity ?? Math.min(80, strength * 0.55),
        durationMs: Math.min(220, options.durationMs ?? 700),
        radius: visualRadius * 0.58,
        groundRadius: options.groundRadius ?? radius * 0.38,
        floorY,
      },
      {
        kind: 'burst', position, color: options.color ?? 0xff8a2a,
        physicalLight: false,
        durationMs: options.durationMs ?? 700,
        radius: visualRadius,
        groundRadius: options.groundRadius ?? radius * 0.45,
        floorY,
      },
      {
        kind: 'burst', position, color: options.waveColor ?? 0xffc06a,
        physicalLight: false, groundSpill: false,
        durationMs: Math.max(320, (options.durationMs ?? 700) * 0.72),
        radius: visualRadius * 1.18,
        horizontalScale: 1.7,
        verticalScale: 0.16,
        floorY,
      },
    ];
    for (const effect of effects) emitVisualEffect?.(effect);

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
      portableDrops: this.portableDrops.size,
    };
  }

  markBodiesDirty() {
    if (!this.world?.ready) return;
    this._finishPortableDrops();
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
    this._finishPortableDrops();
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
    this.disposed = true;
    this.cancelScheduledInit();
    this._finishPortableDrops();
    this.staffRagdolls?.dispose();
    this.staffRagdolls = null;
    this.debris?.dispose();
    this.debris = null;
    this.world?.dispose();
    this.world = null;
    this.worldIds.clear();
    this.portableDrops.clear();
    this.incidentSnapshot = null;
    this.bodiesDirty = true;
    this.scene = null;
    this.staffPawns = null;
  }

  _releaseAuthoredBodies() {
    for (const id of this.worldIds) this.world?.unregisterObject(id);
    this.worldIds.clear();
  }

  _finishPortableDrop(id) {
    const drop = this.portableDrops.get(id);
    if (!drop) return false;
    this.world?.restoreRecordPose?.(drop.record, drop.canonical);
    this.world?.removeTemporarySupport?.(drop.support);
    this.world?.unregisterObject?.(drop.record);
    this.worldIds.delete(id);
    this.portableDrops.delete(id);
    return true;
  }

  _finishPortableDrops() {
    for (const id of [...this.portableDrops.keys()]) this._finishPortableDrop(id);
  }
}

export default WorldPhysicsPresentation;
