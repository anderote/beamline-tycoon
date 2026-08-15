import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoxGeometry, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { WorldPhysics } from '../src/physics/world-physics.js';

await RAPIER.init();

function boxAt(x, y, z, size = 1) {
  const object = new Group();
  object.position.set(x, y, z);
  object.add(new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial()));
  object.updateMatrixWorld(true);
  return object;
}

test('fixed-step Rapier integration moves active Three objects and collides with the floor', async () => {
  const physics = await new WorldPhysics({ rapier: RAPIER }).init();
  physics.addGround();
  const object = boxAt(0, 3, 0);
  const record = physics.registerObject(object, { id: 'falling', active: true, massKg: 10 });
  for (let i = 0; i < 180; i++) physics.update(1 / 60);

  assert.ok(object.position.y > 0.45 && object.position.y < 0.6,
    `the one-metre box settles on the floor (y=${object.position.y})`);
  assert.ok(record.body.isSleeping() || Math.abs(record.body.linvel().y) < 0.05);
  assert.equal(record.metrics.massKg, 10);
  assert.ok(Math.abs(record.body.mass() - 10) < 1e-4,
    'the known mass remains effective after fixed-to-dynamic promotion');
  physics.dispose();
});

test('portable drop support settles visually and restores the canonical pose', async () => {
  const physics = await new WorldPhysics({ rapier: RAPIER }).init();
  physics.addGround({ y: -10 });
  const object = new Group();
  object.position.set(2, 1, 3);
  const shell = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial());
  shell.position.y = 0.2; // equipment roots sit at the bottom of their art
  object.add(shell);
  object.updateMatrixWorld(true);
  const record = physics.registerObject(object, {
    id: 'portable-scope', active: false, massKg: 8, friction: 0.8, restitution: 0.03,
  });
  const canonical = physics.startDrop(record, { height: 0.8 });
  const support = physics.addTemporarySupport({
    x: 2, topY: 1, z: 3, halfWidth: 0.3, halfDepth: 0.3,
  });
  for (let i = 0; i < 180; i++) physics.update(1 / 60);

  assert.ok(object.position.y > 0.98 && object.position.y < 1.04,
    `portable body lands on its authored surface (y=${object.position.y})`);
  assert.equal(physics.restoreRecordPose(record, canonical), true);
  assert.ok(Math.abs(object.position.y - 1) < 1e-6,
    'settling restores the exact canonical root pose');
  assert.equal(record.active, false, 'restored portable body leaves the active solver set');
  assert.equal(physics.removeTemporarySupport(support), true,
    'temporary landing support is removed explicitly');
  physics.dispose();
});

test('off-pivot geometry installs its measured center of mass in the rigid body', async () => {
  const physics = await new WorldPhysics({ rapier: RAPIER }).init();
  const object = new Group();
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  mesh.position.set(2, 0.5, -1);
  object.add(mesh);
  object.updateMatrixWorld(true);
  const record = physics.registerObject(object, { id: 'off-pivot', active: true, massKg: 25 });
  const com = record.body.localCom();
  assert.ok(Math.abs(com.x - 2) < 1e-5);
  assert.ok(Math.abs(com.y - 0.5) < 1e-5);
  assert.ok(Math.abs(com.z + 1) < 1e-5);
  assert.ok(Math.abs(record.body.mass() - 25) < 1e-4);
  physics.dispose();
});

test('rendered terrain triangles become the static collision surface', async () => {
  const physics = await new WorldPhysics({ rapier: RAPIER }).init();
  physics.addGround({ y: -10 });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    -5, 1, -5, 5, 1, -5, 5, 1, 5, -5, 1, 5,
  ]), 3));
  geometry.setIndex([0, 3, 1, 1, 3, 2]);
  const terrain = new Mesh(geometry, new MeshBasicMaterial());
  terrain.updateMatrixWorld(true);
  const first = physics.setTerrainMesh(terrain);
  assert.equal(physics.setTerrainMesh(terrain), first, 'unchanged geometry reuses its collider');

  const object = boxAt(0, 3, 0);
  physics.registerObject(object, { id: 'terrain-fall', active: true, massKg: 10 });
  for (let i = 0; i < 180; i++) physics.update(1 / 60);
  assert.ok(object.position.y > 1.45 && object.position.y < 1.6,
    `the box settles on the rendered y=1 surface (y=${object.position.y})`);
  physics.dispose();
});

test('world scale participates in uniform-density mass and inertia', async () => {
  const physics = await new WorldPhysics({ rapier: RAPIER }).init();
  const object = boxAt(0, 0, 0);
  object.scale.set(2, 3, 4);
  object.updateMatrixWorld(true);
  const record = physics.registerObject(object, {
    id: 'scaled-density', active: true, densityKgM3: 10,
  });
  assert.ok(Math.abs(record.metrics.volumeM3 - 24) < 1e-5);
  assert.ok(Math.abs(record.metrics.massKg - 240) < 1e-4);
  assert.deepEqual(record.metrics.size.toArray(), [2, 3, 4]);
  assert.ok(record.metrics.principalInertia.x > record.metrics.principalInertia.z);
  physics.dispose();
});

test('dormant world objects remain authored until an explosion activates them', async () => {
  const physics = await new WorldPhysics({ rapier: RAPIER }).init();
  physics.addGround();
  const near = boxAt(1, 0.5, 0);
  const far = boxAt(20, 0.5, 0);
  const nearRecord = physics.registerObject(near, { id: 'near', active: false, kind: 'equipment' });
  const farRecord = physics.registerObject(far, { id: 'far', active: false, kind: 'equipment' });
  physics.update(1);
  assert.equal(near.position.x, 1);
  assert.equal(nearRecord.active, false);

  const impacted = physics.explode({ x: 0, y: 0.5, z: 0 }, { radius: 5, strength: 60 });
  assert.deepEqual(impacted.map((hit) => hit.record.id), ['near']);
  assert.equal(nearRecord.active, true);
  assert.equal(farRecord.active, false);
  for (let i = 0; i < 10; i++) physics.update(1 / 60);
  assert.ok(near.position.x > 1, 'the near object receives an outward impulse');
  assert.equal(far.position.x, 20, 'the far object does not enter the solver island');
  physics.dispose();
});

test('incident snapshots restore transforms and remove transient debris bodies atomically', async () => {
  const physics = await new WorldPhysics({ rapier: RAPIER }).init();
  physics.addGround();
  const original = boxAt(0, 0.5, 0);
  const record = physics.registerObject(original, { id: 'original', active: false });
  const snapshot = physics.captureSnapshot();

  physics.explode({ x: 0, y: 0, z: 0 }, { radius: 4, strength: 30 });
  for (let i = 0; i < 5; i++) physics.update(1 / 60);
  const debris = boxAt(0, 2, 0, 0.2);
  physics.registerObject(debris, { id: 'transient-debris', active: true });
  assert.equal(physics.records.size, 2);

  assert.equal(physics.restoreSnapshot(snapshot), true);
  assert.equal(physics.records.size, 1);
  assert.equal(physics.records.has('transient-debris'), false);
  assert.equal(record.active, false);
  assert.equal(physics.getStats().activeBodies, 0);
  assert.ok(Math.abs(original.position.x) < 1e-4);
  assert.ok(Math.abs(original.position.y - 0.5) < 1e-4);
  physics.dispose();
});
