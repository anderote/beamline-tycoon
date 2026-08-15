// Real THREE regression for the wall-light leak: wall fixtures used to sit
// inside a 15 cm wall and their fallback pool could cross its back face.

import assert from 'node:assert/strict';
import * as Three from 'three';

globalThis.THREE = Three;
globalThis.document = {
  createElement() {
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        set fillStyle(_value) {},
      }),
    };
  },
};

const { buildLightPools } = await import('../src/renderer3d/lighting-builder.js');
const { fixtureMountY, wallFixturePose } = await import('../src/renderer3d/fixture-light-math.js');
const { LIGHTING_DEFS } = await import('../src/data/placeables/lighting.js');

const wallGroup = new Three.Group();
const wallMaterial = new Three.MeshBasicMaterial({ side: Three.FrontSide });
const wall = new Three.Mesh(new Three.BoxGeometry(20, 3, 0.075), wallMaterial);
wall.position.y = 1.5;
wall.castShadow = true;
wallGroup.add(wall);
wallGroup.updateMatrixWorld(true);

const def = LIGHTING_DEFS.find((entry) => entry.id === 'wallSconce');
const pose = wallFixturePose({ col: 0, row: 0, edge: 'n', off: 1 });
const fixtureGroup = new Three.Group();
fixtureGroup.position.set(pose.x, fixtureMountY(def, 0), pose.z);
fixtureGroup.rotation.y = pose.yaw;

const pool = buildLightPools([{ id: 'wall-light', def, group: fixtureGroup }], {
  occluders: wallGroup,
});
const positions = pool.geometry.attributes.position.array;
let minZ = Infinity;
for (let index = 2; index < positions.length; index += 3) minZ = Math.min(minZ, positions[index]);

assert.ok(pose.z > 0.0375,
  `fixture emitter is outside the office-wall slab (z=${pose.z})`);
assert.ok(minZ >= 0.01,
  `the wall-facing edge of the painted pool is clipped to the fixture side (min z=${minZ})`);
assert.equal(wallMaterial.side, Three.FrontSide,
  'the raycast-only double-sided override restores the visible wall material');

pool.geometry.dispose();
pool.material.dispose();
wall.geometry.dispose();
wallMaterial.dispose();
