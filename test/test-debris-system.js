import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene,
} from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { DebrisSystem } from '../src/physics/debris-system.js';
import { WorldPhysics } from '../src/physics/world-physics.js';

await RAPIER.init();

function multipartEquipment() {
  const root = new Group();
  root.position.set(1, 0, 0);
  for (let i = 0; i < 3; i++) {
    const mesh = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial());
    mesh.position.set((i - 1) * 0.45, 0.25, 0);
    root.add(mesh);
  }
  root.updateMatrixWorld(true);
  return root;
}

test('multipart equipment fractures into mass-conserving rigid debris and restores', async () => {
  const scene = new Scene();
  const physics = await new WorldPhysics({ rapier: RAPIER }).init();
  physics.addGround();
  const equipment = multipartEquipment();
  scene.add(equipment);
  scene.updateMatrixWorld(true);
  const source = physics.registerObject(equipment, {
    id: 'world:equipment:test', kind: 'equipment', active: false, massKg: 120,
  });
  const debris = new DebrisSystem(physics, scene, { maxFragments: 16 });

  assert.deepEqual(debris.fractureNear({ x: 0, y: 0, z: 0 }, 5), ['world:equipment:test']);
  assert.equal(source.object.visible, false);
  assert.equal(source.body.isEnabled(), false);
  assert.equal(debris.getStats().fragments, 3);
  const fragments = [...physics.records.values()].filter((record) => record.kind === 'debris');
  const mass = fragments.reduce((sum, record) => sum + record.metrics.massKg, 0);
  assert.ok(Math.abs(mass - 120) < 1e-6, 'fragment masses sum to the original realistic weight');

  physics.explode({ x: 0, y: 0.3, z: 0 }, { radius: 5, strength: 50 });
  const start = fragments[0].object.position.clone();
  for (let i = 0; i < 8; i++) physics.update(1 / 60);
  assert.ok(fragments[0].object.position.distanceTo(start) > 0.01);

  debris.restoreAll();
  assert.equal(equipment.visible, true);
  assert.equal(source.body.isEnabled(), true);
  assert.equal(physics.records.size, 1);
  assert.equal(debris.getStats().fragments, 0);
  physics.dispose();
});
test('single-shell equipment tumbles whole instead of inventing fake fracture seams', async () => {
  const scene = new Scene();
  const physics = await new WorldPhysics({ rapier: RAPIER }).init();
  const single = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  scene.add(single);
  scene.updateMatrixWorld(true);
  physics.registerObject(single, { id: 'single', kind: 'equipment', active: false });
  const debris = new DebrisSystem(physics, scene);
  assert.deepEqual(debris.fractureNear({ x: 0, y: 0, z: 0 }, 5), []);
  assert.equal(single.visible, true);
  physics.dispose();
});
