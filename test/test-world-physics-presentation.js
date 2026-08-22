import assert from 'node:assert/strict';
import { WorldPhysicsPresentation } from '../src/renderer3d/world-physics-presentation.js';

const originalRequestIdleCallback = globalThis.requestIdleCallback;
const originalCancelIdleCallback = globalThis.cancelIdleCallback;

try {
  let idleCallback = null;
  let cancelledHandle = null;
  globalThis.requestIdleCallback = (callback) => {
    idleCallback = callback;
    return 17;
  };
  globalThis.cancelIdleCallback = handle => { cancelledHandle = handle; };

  let worldCreates = 0;
  let debrisCreates = 0;
  let ragdollCreates = 0;
  const world = {
    ready: true,
    addGround() {},
    setTerrainMesh() {},
    dispose() {},
  };
  const presentation = new WorldPhysicsPresentation(
    { terrainMesh: () => ({ id: 'terrain' }) },
    {
      createWorld: () => ({
        async init() {
          worldCreates++;
          return world;
        },
      }),
      createDebris: () => {
        debrisCreates++;
        return { dispose() {} };
      },
      createRagdolls: () => {
        ragdollCreates++;
        return { dispose() {} };
      },
    },
  );

  presentation.attachStaff({ id: 'staff' }, { id: 'scene' });
  presentation.scheduleInit({ id: 'scene' });
  assert.equal(worldCreates, 0, 'scheduling physics does not load Rapier on the startup path');
  assert.equal(typeof idleCallback, 'function', 'physics initialization is queued for idle time');

  idleCallback();
  await presentation.initPromise;
  assert.equal(worldCreates, 1, 'idle initialization creates the physics world once');
  assert.equal(debrisCreates, 1, 'debris attaches after the world is ready');
  assert.equal(ragdollCreates, 1, 'staff attached before initialization receives ragdolls afterward');
  presentation.dispose();

  const cancelled = new WorldPhysicsPresentation({}, { createWorld: () => ({ init: async () => world }) });
  idleCallback = null;
  cancelled.scheduleInit({});
  cancelled.dispose();
  assert.equal(cancelledHandle, 17, 'dispose cancels deferred physics initialization');
  assert.equal(cancelled.world, null, 'cancelled initialization leaves no live physics world');

  let restored = 0;
  let supportsRemoved = 0;
  let unregistered = 0;
  const portableObject = {
    userData: {
      placeableId: 'eq_scope',
      placeableType: 'oscilloscope',
      physicsKind: 'equipment',
    },
  };
  const portableWorld = {
    ready: true,
    update() {},
    registerObject(object, options) {
      assert.equal(object, portableObject);
      assert.equal(options.active, false, 'portable body starts from its canonical fixed pose');
      return { id: options.id, body: { isSleeping: () => false } };
    },
    startDrop() {
      return { translation: { x: 4, y: 0.76, z: 5 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    },
    addTemporarySupport(options) {
      assert.equal(options.topY, 0.76, 'landing support uses the canonical surface height');
      return { id: 'support' };
    },
    restoreRecordPose() { restored++; },
    removeTemporarySupport() { supportsRemoved++; },
    unregisterObject() { unregistered++; },
    getStats() { return { ready: true, bodies: 1, joints: 0 }; },
    dispose() {},
  };
  const portablePresentation = new WorldPhysicsPresentation({
    equipmentMeshes: () => [portableObject],
  });
  portablePresentation.world = portableWorld;
  assert.equal(await portablePresentation.dropPortable('eq_scope', { maxDuration: 0.5 }), true,
    'portable registry item starts a physical drop');
  assert.equal(portablePresentation.stats().portableDrops, 1,
    'active presentation drop is observable');
  portablePresentation.update(0.5);
  assert.equal(portablePresentation.stats().portableDrops, 0,
    'drop finalizes at its bounded timeout');
  assert.equal(restored, 1, 'finalization restores canonical presentation state');
  assert.equal(supportsRemoved, 1, 'finalization removes the temporary support');
  assert.equal(unregistered, 1, 'finalization releases the temporary rigid body');
  portablePresentation.dispose();

  const emittedEffects = [];
  const incidentWorld = {
    ready: true,
    captureSnapshot: () => ({ id: 'before' }),
    explode: () => [],
  };
  const incidentPresentation = new WorldPhysicsPresentation({});
  incidentPresentation.world = incidentWorld;
  incidentPresentation.ensureBodies = () => {};
  incidentPresentation.explode(
    { x: 4, y: 1, z: 5 },
    { radius: 6, strength: 80, floorY: 0 },
    effect => emittedEffects.push(effect),
  );
  assert.equal(emittedEffects.length, 3,
    'an explosion emits ignition, fireball, and pressure-wave packets');
  assert.equal(emittedEffects.filter(effect => effect.physicalLight !== false).length, 1,
    'only the ignition packet borrows a bounded physical flash light');
  assert.ok(emittedEffects[2].horizontalScale > 1
      && emittedEffects[2].verticalScale < 1
      && emittedEffects[2].groundSpill === false,
  'the pressure packet expands as a flat wave instead of a third fireball');

  console.log('World physics presentation tests passed.');
} finally {
  if (originalRequestIdleCallback === undefined) delete globalThis.requestIdleCallback;
  else globalThis.requestIdleCallback = originalRequestIdleCallback;
  if (originalCancelIdleCallback === undefined) delete globalThis.cancelIdleCallback;
  else globalThis.cancelIdleCallback = originalCancelIdleCallback;
}
