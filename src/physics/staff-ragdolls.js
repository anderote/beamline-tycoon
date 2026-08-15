import { Quaternion, Vector3 } from 'three/webgpu';

const _position = new Vector3();
const _rotation = new Quaternion();
const _scale = new Vector3();

const PART_MASSES = Object.freeze({
  torso: 34,
  head: 6,
  leftArm: 4,
  rightArm: 4,
  leftLeg: 10,
  rightLeg: 10,
  leftShin: 6,
  rightShin: 6,
});

function worldPosition(object) {
  return object.getWorldPosition(new Vector3());
}

function cloneInWorld(source, scene, detachChildren = false) {
  source.updateWorldMatrix?.(true, true);
  const clone = source.clone(true);
  if (detachChildren) clone.clear();
  source.matrixWorld.decompose(_position, _rotation, _scale);
  clone.position.copy(_position);
  clone.quaternion.copy(_rotation);
  clone.scale.copy(_scale);
  clone.matrixAutoUpdate = true;
  clone.castShadow = true;
  clone.receiveShadow = true;
  scene.add(clone);
  clone.updateMatrixWorld(true);
  return clone;
}

/** Articulated visual ragdolls built from the staff figure's actual meshes. */
export class StaffRagdolls {
  constructor(staffPawns, physics, scene) {
    this.staffPawns = staffPawns;
    this.physics = physics;
    this.scene = scene;
    this.ragdolls = new Map();
  }

  ragdollNear(position, radius = 7) {
    const origin = new Vector3(position?.x || 0, position?.y || 0, position?.z || 0);
    const created = [];
    for (const pawn of this.staffPawns?._pawns?.values?.() || []) {
      if (pawn.ragdolled || !pawn.figure?.group) continue;
      const distance = pawn.figure.group.getWorldPosition(new Vector3()).distanceTo(origin);
      if (distance > radius) continue;
      const ragdoll = this.ragdollPawn(pawn);
      if (ragdoll) created.push(ragdoll);
    }
    return created;
  }

  ragdollPawn(pawn) {
    if (!pawn || this.ragdolls.has(pawn.id)) return this.ragdolls.get(pawn?.id) || null;
    const figure = pawn.figure;
    figure.group.updateWorldMatrix?.(true, true);

    // Arms retain their hand child and shins retain their boot. Thigh clones
    // explicitly drop their shin child because the shin receives its own body.
    const sources = {
      torso: figure.torso,
      head: figure.head,
      leftArm: figure.leftArm,
      rightArm: figure.rightArm,
      leftLeg: figure.leftLeg,
      rightLeg: figure.rightLeg,
      leftShin: figure.leftShin,
      rightShin: figure.rightShin,
    };
    const jointWorld = {
      neck: worldPosition(figure.torso).lerp(worldPosition(figure.head), 0.58),
      leftShoulder: worldPosition(figure.leftArm),
      rightShoulder: worldPosition(figure.rightArm),
      leftHip: worldPosition(figure.leftLeg),
      rightHip: worldPosition(figure.rightLeg),
      leftKnee: worldPosition(figure.leftShin),
      rightKnee: worldPosition(figure.rightShin),
    };

    const objects = {};
    const records = {};
    for (const [name, source] of Object.entries(sources)) {
      const object = cloneInWorld(source, this.scene, name === 'leftLeg' || name === 'rightLeg');
      object.name = `ragdoll:${pawn.id}:${name}`;
      objects[name] = object;
      records[name] = this.physics.registerObject(object, {
        id: `ragdoll:${pawn.id}:${name}`,
        kind: 'staff',
        active: true,
        massKg: PART_MASSES[name],
        friction: 0.75,
        restitution: 0.08,
        linearDamping: 0.18,
        angularDamping: 0.3,
      });
    }

    const join = (a, b, anchor) => this.physics.createSphericalJoint(records[a], records[b], anchor);
    join('torso', 'head', jointWorld.neck);
    join('torso', 'leftArm', jointWorld.leftShoulder);
    join('torso', 'rightArm', jointWorld.rightShoulder);
    join('torso', 'leftLeg', jointWorld.leftHip);
    join('torso', 'rightLeg', jointWorld.rightHip);
    join('leftLeg', 'leftShin', jointWorld.leftKnee);
    join('rightLeg', 'rightShin', jointWorld.rightKnee);

    pawn.ragdolled = true;
    figure.group.visible = false;
    const ragdoll = { id: pawn.id, pawn, objects, records };
    this.ragdolls.set(pawn.id, ragdoll);
    return ragdoll;
  }

  restore(id) {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll) return false;
    for (const record of Object.values(ragdoll.records)) {
      this.physics.unregisterObject(record, { removeObject: true });
    }
    ragdoll.pawn.ragdolled = false;
    ragdoll.pawn.figure.group.visible = true;
    this.ragdolls.delete(id);
    return true;
  }

  restoreAll() {
    for (const id of [...this.ragdolls.keys()]) this.restore(id);
  }

  getStats() {
    return { ragdolls: this.ragdolls.size, articulatedBodies: this.ragdolls.size * 8 };
  }

  dispose() {
    this.restoreAll();
  }
}

export default StaffRagdolls;
