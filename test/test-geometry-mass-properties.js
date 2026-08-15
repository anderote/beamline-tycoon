import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry,
} from 'three';
import {
  densityForKind, geometryMassProperties,
} from '../src/physics/geometry-mass-properties.js';

const close = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
};

test('closed geometry yields uniform-density volume, center of mass, mass, and inertia', () => {
  const root = new Group();
  const cube = new Mesh(new BoxGeometry(2, 4, 6), new MeshBasicMaterial());
  cube.position.set(3, 2, -1);
  root.add(cube);

  const props = geometryMassProperties(root, { densityKgM3: 10 });
  close(props.volumeM3, 48);
  close(props.massKg, 480);
  close(props.centerOfMass.x, 3);
  close(props.centerOfMass.y, 2);
  close(props.centerOfMass.z, -1);
  close(props.principalInertia.x, 480 * (4 ** 2 + 6 ** 2) / 12);
  assert.equal(props.usedBoundsFallback, false);
});

test('multiple closed parts combine their volume-weighted centers of mass', () => {
  const root = new Group();
  const small = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  small.position.x = -4;
  const large = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
  large.position.x = 2;
  root.add(small, large);

  const props = geometryMassProperties(root, { densityKgM3: 100 });
  close(props.volumeM3, 9);
  close(props.centerOfMass.x, (-4 * 1 + 2 * 8) / 9);
  close(props.massKg, 900);
});

test('a known realistic weight derives density from geometry', () => {
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(0.5, 1, 2), new MeshBasicMaterial()));
  const props = geometryMassProperties(root, { massKg: 75, kind: 'staff' });
  close(props.volumeM3, 1);
  close(props.massKg, 75);
  close(props.densityKgM3, 75);
});

test('open geometry and invisible construction hitboxes degrade safely', () => {
  const root = new Group();
  const plane = new Mesh(new PlaneGeometry(4, 2), new MeshBasicMaterial());
  root.add(plane);
  const hidden = new Mesh(new BoxGeometry(100, 100, 100), new MeshBasicMaterial({ visible: false }));
  root.add(hidden);

  const props = geometryMassProperties(root, { densityKgM3: 5 });
  assert.equal(props.usedBoundsFallback, true);
  assert.ok(props.size.x <= 4.01 && props.size.y <= 2.01 && props.size.z < 0.01);
  assert.ok(props.massKg >= 0.05, 'degenerate art still receives a finite positive simulation mass');
});

test('an open off-origin triangle soup cannot masquerade as enclosed volume', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    1, 1, 1,
    3, 1, 1,
    1, 4, 2,
  ]), 3));
  const root = new Group();
  root.add(new Mesh(geometry, new MeshBasicMaterial()));
  const props = geometryMassProperties(root, { densityKgM3: 10 });
  assert.equal(props.usedBoundsFallback, true);
  assert.equal(props.closedMeshCount, 0);
  assert.equal(props.fallbackMeshCount, 1);
  close(props.volumeM3, 2 * 3 * 1);
  close(props.centerOfMass.x, 2);
  close(props.centerOfMass.y, 2.5);
  close(props.centerOfMass.z, 1.5);
});

test('category defaults use plausible SI material densities', () => {
  assert.equal(densityForKind('steel'), 7850);
  assert.ok(densityForKind('staff') > 900 && densityForKind('staff') < 1100);
  assert.ok(densityForKind('furnishing') < densityForKind('equipment'));
});
