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

test('WebGPU array target cache is reset only when its rendered prefix grows', () => {
  const lights = Array.from({ length: 6 }, () => new SpotLight());
  const array = new SharedSpotShadowArray(lights, 1024);
  let disposeCalls = 0;
  array.shadowMap = { dispose() { disposeCalls++; }, setSize() {} };
  const webgpu = { backend: { isWebGPUBackend: true } };

  array._ensureRenderLayerCapacity(webgpu, 1);
  assert.equal(disposeCalls, 0, 'the first pass establishes capacity without disposing a fresh target');
  assert.equal(array._renderLayerCapacity, 1);

  array._ensureRenderLayerCapacity(webgpu, 1);
  array._ensureRenderLayerCapacity(webgpu, 2);
  assert.equal(disposeCalls, 1, 'growing from one layer to two invalidates the stale one-view descriptor');
  assert.equal(array._renderLayerCapacity, 2);

  array._ensureRenderLayerCapacity(webgpu, 1);
  assert.equal(disposeCalls, 1, 'shrinking reuses the already-cached prefix views');

  array._ensureRenderLayerCapacity(webgpu, 6);
  assert.equal(disposeCalls, 2, 'a later growth beyond capacity invalidates exactly once more');

  array.setMapSize(512);
  assert.equal(array._renderLayerCapacity, 0, 'resizing forgets views discarded with the old target');
  array._ensureRenderLayerCapacity(webgpu, 2);
  assert.equal(disposeCalls, 2, 'the first pass after a resize establishes a fresh capacity');

  array._ensureRenderLayerCapacity({ backend: { isWebGPUBackend: false } }, 7);
  assert.equal(disposeCalls, 2, 'the WebGL backend is not coupled to WebGPU descriptor caching');
});
