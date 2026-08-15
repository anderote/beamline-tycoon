import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene,
} from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { StaffRagdolls } from '../src/physics/staff-ragdolls.js';
import { WorldPhysics } from '../src/physics/world-physics.js';

await RAPIER.init();

function part(w, h, d, x, y, z) {
  const mesh = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial());
  mesh.position.set(x, y, z);
  return mesh;
}

function makePawn(id = 'staff-1') {
  const group = new Group();
  const body = new Group();
  group.add(body);
  group.position.set(1, 0.01, 0);
  const torso = part(0.35, 0.55, 0.22, 0, 0.9, 0);
  const head = part(0.28, 0.3, 0.26, 0, 1.35, 0);
  const leftArm = part(0.12, 0.5, 0.12, -0.28, 1.12, 0);
  const rightArm = part(0.12, 0.5, 0.12, 0.28, 1.12, 0);
  const leftLeg = part(0.15, 0.45, 0.16, -0.12, 0.55, 0);
  const rightLeg = part(0.15, 0.45, 0.16, 0.12, 0.55, 0);
  const leftShin = part(0.13, 0.42, 0.15, 0, -0.4, 0);
  const rightShin = part(0.13, 0.42, 0.15, 0, -0.4, 0);
  leftLeg.add(leftShin);
  rightLeg.add(rightShin);
  body.add(torso, head, leftArm, rightArm, leftLeg, rightLeg);
  return {
    id,
    figure: {
      group, body, torso, head, leftArm, rightArm,
      leftLeg, rightLeg, leftShin, rightShin,
    },
    x: 1, z: 0,
  };
}

test('nearby staff become an eight-body, seven-joint articulation and restore cleanly', async () => {
  const scene = new Scene();
  const physics = await new WorldPhysics({ rapier: RAPIER }).init();
  physics.addGround();
  const pawn = makePawn();
  scene.add(pawn.figure.group);
  scene.updateMatrixWorld(true);
  const staffPawns = { _pawns: new Map([[pawn.id, pawn]]) };
  const manager = new StaffRagdolls(staffPawns, physics, scene);

  const made = manager.ragdollNear({ x: 0, y: 0, z: 0 }, 4);
  assert.equal(made.length, 1);
  assert.equal(pawn.ragdolled, true);
  assert.equal(pawn.figure.group.visible, false);
  assert.equal(physics.records.size, 8);
  assert.equal(physics.getStats().joints, 7);

  const torsoStart = made[0].objects.torso.position.clone();
  physics.explode({ x: 0, y: 0.5, z: 0 }, { radius: 5, strength: 45 });
  for (let i = 0; i < 10; i++) physics.update(1 / 60);
  assert.ok(made[0].objects.torso.position.distanceTo(torsoStart) > 0.01,
    'the connected articulation receives the blast and moves');

  assert.equal(manager.restore(pawn.id), true);
  assert.equal(pawn.ragdolled, false);
  assert.equal(pawn.figure.group.visible, true);
  assert.equal(physics.records.size, 0);
  assert.equal(physics.getStats().joints, 0);
  physics.dispose();
});
test('staff outside the incident radius keep their authored animation rig', async () => {
  const scene = new Scene();
  const physics = await new WorldPhysics({ rapier: RAPIER }).init();
  const pawn = makePawn('far-staff');
  pawn.figure.group.position.x = 20;
  scene.add(pawn.figure.group);
  scene.updateMatrixWorld(true);
  const manager = new StaffRagdolls({ _pawns: new Map([[pawn.id, pawn]]) }, physics, scene);
  assert.deepEqual(manager.ragdollNear({ x: 0, y: 0, z: 0 }, 4), []);
  assert.equal(pawn.ragdolled, undefined);
  assert.equal(pawn.figure.group.visible, true);
  physics.dispose();
});
