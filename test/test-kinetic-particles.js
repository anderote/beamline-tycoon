import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  particleCollisionWorld,
  stepKineticParticle,
} from '../src/renderer3d/kinetic-particles.js';
import { utilityConnectionSparkProfile } from '../src/renderer3d/spark-presentation.js';

function particle(overrides = {}) {
  return {
    x: 0, y: 1, z: 0,
    vx: 0, vy: 0, vz: 0,
    age: 0, lifetime: 2, radius: 0.05,
    gravity: 0, drag: 0, restitution: 0.6, friction: 0,
    ...overrides,
  };
}

test('kinetic pixels bounce from the floor instead of passing through it', () => {
  const p = particle({ y: 0.06, vy: -3 });
  const world = particleCollisionWorld({ floorY: 0 });
  assert.equal(stepKineticParticle(p, 0.02, world), true);
  assert.ok(p.y >= p.radius);
  assert.ok(p.vy > 0, 'downward velocity reflects upward with restitution');
});

test('kinetic pixels ricochet from authored scene boxes', () => {
  const p = particle({ x: 0.88, y: 0.5, vx: 5 });
  const world = particleCollisionWorld({
    floorY: -10,
    boxes: [{ min: { x: 1, y: 0, z: -1 }, max: { x: 1.2, y: 2, z: 1 } }],
  });
  stepKineticParticle(p, 0.03, world);
  assert.ok(p.x <= 0.95 + 1e-6, 'particle is separated to the near face');
  assert.ok(p.vx < 0, 'wall collision reverses horizontal velocity');
});

test('kinetic motion expires presentation-only particles by lifetime', () => {
  const p = particle({ lifetime: 0.05 });
  assert.equal(stepKineticParticle(p, 0.06, particleCollisionWorld()), false);
});

test('HV hookups emit more energetic pixels than ordinary power cords', () => {
  const endpoints = {
    start: { placeableId: 'source', portName: 'out' },
    end: { placeableId: 'load', portName: 'in' },
  };
  const hv = utilityConnectionSparkProfile({ ...endpoints, utilityType: 'hvCable' });
  const power = utilityConnectionSparkProfile({ ...endpoints, utilityType: 'powerCable' });
  assert.ok(hv.count > power.count && hv.speedMax > power.speedMax);
  assert.equal(utilityConnectionSparkProfile({ ...endpoints, utilityType: 'dataFiber' }), null);
  assert.equal(utilityConnectionSparkProfile({
    ...endpoints, utilityType: 'hvCable', buried: true,
  }), null, 'buried duct-bank work cannot throw visible room sparks');
});
