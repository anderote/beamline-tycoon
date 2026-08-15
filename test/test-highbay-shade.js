// The high-bay reflector must hide the source from above. A thin capped
// cylinder used to put an emissive top face through the shade's lower cap,
// producing a large bloom blob on the back of the fixture.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE_REAL from 'three';

globalThis.THREE = THREE_REAL;

const { LIGHTING_DEFS } = await import('../src/data/placeables/lighting.js');
const { buildLightFixture } = await import('../src/renderer3d/lighting-builder.js');

test('high-bay diffuser is one-sided, downward-facing, and below its reflector', () => {
  const def = LIGHTING_DEFS.find(entry => entry.id === 'highBay');
  const fixture = buildLightFixture(def);
  const diffuser = fixture.children.find(child => child.userData.role === 'downwardDiffuser');
  const reflector = fixture.children.find(child =>
    child.geometry?.type === 'CylinderGeometry'
      && Math.abs(child.geometry.parameters.radiusBottom - 0.24) < 1e-9);

  assert.ok(diffuser, 'fixture publishes its directional diffuser');
  assert.ok(reflector, 'fixture retains its opaque bell reflector');
  assert.equal(diffuser.geometry.type, 'CircleGeometry',
    'the diffuser has no upward-facing cap');
  assert.equal(diffuser.material.side, THREE.FrontSide,
    'the diffuser stays one-sided');

  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(diffuser.quaternion);
  assert.ok(normal.y < -0.999,
    `the visible/emissive face points down (normal y=${normal.y})`);

  const reflectorBottom = reflector.position.y - reflector.geometry.parameters.height / 2;
  assert.ok(diffuser.position.y < reflectorBottom,
    'the diffuser is tucked below the reflector instead of intersecting its back');
});
