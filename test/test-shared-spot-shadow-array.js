import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpotLight } from 'three/webgpu';
import {
  SharedSpotShadowArray,
  activeShadowPrefixLength,
} from '../src/renderer3d/lighting/shared-spot-shadow-array.js';

test('shared fixture shadows render only through the last assigned layer', () => {
  const lights = Array.from({ length: 12 }, () => ({ intensity: 0 }));
  lights[0].intensity = 1;
  assert.equal(activeShadowPrefixLength(lights, 12), 1,
    'the first placed light renders one camera, not the whole quality budget');

  lights[3].intensity = 1;
  assert.equal(activeShadowPrefixLength(lights, 12), 4,
    'a sparse layer keeps the positional prefix required by the texture array');

  lights[11].intensity = 1;
  assert.equal(activeShadowPrefixLength(lights, 6), 4,
    'lights outside the active quality budget cannot expand the pass');
});

test('shared fixture shadow array activates only the selected prefix of layers', () => {
  const lights = Array.from({ length: 6 }, () => {
    const light = new SpotLight();
    light.castShadow = true;
    light.shadow.needsUpdate = false;
    return light;
  });
  const array = new SharedSpotShadowArray(lights, 1024);

  array.setActiveCount(2);
  assert.equal(array.activeCount, 2);
  assert.deepEqual(lights.map((light) => light.shadow.needsUpdate),
    [true, true, false, false, false, false]);

  array.setMapSize(512);
  assert.equal(array.mapSize, 512);
  assert.deepEqual(lights.map((light) => light.shadow.needsUpdate),
    [true, true, false, false, false, false],
    'resizing cannot accidentally schedule inactive layers');

  array.setActiveCount(0);
  assert.deepEqual(lights.map((light) => light.shadow.needsUpdate),
    [false, false, false, false, false, false]);
  array.dispose();
  assert.equal(lights.every((light) => light.shadow.shadowNode === null), true);
});
