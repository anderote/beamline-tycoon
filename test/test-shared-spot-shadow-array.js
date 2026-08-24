import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpotLight } from 'three/webgpu';
import {
  SharedSpotShadowArray,
  pendingShadowLayers,
} from '../src/renderer3d/lighting/shared-spot-shadow-array.js';

/**
 * Minimal stand-in for WebGPURenderer covering exactly what three's
 * RendererUtils.resetRendererAndSceneState touches plus the render-target
 * layer selection this class depends on. `renders` records (layer, camera)
 * per pass, which is the whole contract under test.
 */
function stubRenderer() {
  let layer = null;
  const renders = [];
  return {
    renders,
    backend: { isWebGPUBackend: true },
    shadowMap: { type: 1 },
    toneMapping: 0,
    toneMappingExposure: 1,
    outputColorSpace: 'srgb',
    autoClear: true,
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getRenderObjectFunction: () => null,
    setRenderObjectFunction() {},
    getPixelRatio: () => 1,
    setPixelRatio() {},
    getMRT: () => null,
    setMRT() {},
    getClearColor: (target) => target,
    getClearAlpha: () => 1,
    setClearColor() {},
    getScissorTest: () => false,
    setScissorTest() {},
    setRenderTarget(_target, activeCubeFace = 0) { layer = activeCubeFace; },
    render(_scene, camera) { renders.push({ layer, camera }); },
  };
}

function stubScene() {
  return { background: null, backgroundNode: null, overrideMaterial: null };
}

test('only lit, dirty layers are pending — a sparse assignment stays sparse', () => {
  const mk = (intensity, needsUpdate) => ({
    intensity,
    shadow: { needsUpdate, autoUpdate: false },
  });
  const lights = Array.from({ length: 12 }, () => mk(0, false));

  assert.deepEqual(pendingShadowLayers(lights, 12), [],
    'an unlit rig refreshes nothing at all');

  lights[0] = mk(1, true);
  lights[7] = mk(1, true);
  assert.deepEqual(pendingShadowLayers(lights, 12), [0, 7],
    'layer 7 is refreshed on its own — layers 1..6 are not dragged along with it');

  lights[7].shadow.needsUpdate = false;
  assert.deepEqual(pendingShadowLayers(lights, 12), [0],
    'a clean layer keeps the shadow it already has');

  lights[7].shadow.needsUpdate = true;
  assert.deepEqual(pendingShadowLayers(lights, 4), [0],
    'layers outside the active quality budget are never refreshed');

  lights[0].intensity = 0;
  assert.deepEqual(pendingShadowLayers(lights, 12), [7],
    'a dark fixture costs no shadow pass however dirty it is');
});

test('the pending cursor round-robins so a per-frame budget cannot starve a layer', () => {
  const lights = Array.from({ length: 4 }, () => ({
    intensity: 1,
    shadow: { needsUpdate: true, autoUpdate: false },
  }));
  assert.deepEqual(pendingShadowLayers(lights, 4, 0), [0, 1, 2, 3]);
  assert.deepEqual(pendingShadowLayers(lights, 4, 2), [2, 3, 0, 1],
    'resuming at the cursor reaches the high layers before revisiting the low ones');
  assert.deepEqual(pendingShadowLayers(lights, 4, 9), [1, 2, 3, 0],
    'the cursor wraps rather than running off the end');
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

test('a refresh renders one pass per dirty layer, into that layer, and clears only it', () => {
  const lights = Array.from({ length: 6 }, () => {
    const light = new SpotLight();
    light.castShadow = true;
    light.intensity = 1;
    light.shadow.needsUpdate = false;
    light.shadow.autoUpdate = false;
    return light;
  });
  const array = new SharedSpotShadowArray(lights, 512, { maxLayersPerFrame: 2 });
  // Stand in for the target the node builder would have created.
  array.shadowMap = { setSize() {}, dispose() {} };

  const renderer = stubRenderer();
  const renders = renderer.renders;
  const frame = { frameId: 1, renderer, scene: stubScene(), camera: { layers: { mask: 0xffffffff } } };

  lights[1].shadow.needsUpdate = true;
  lights[4].shadow.needsUpdate = true;
  array.updateBefore(frame);

  assert.deepEqual(renders.map((r) => r.layer), [1, 4],
    'each dirty layer gets its own single-camera pass targeting its own array layer');
  assert.equal(renders[0].camera, lights[1].shadow.camera,
    'a layer renders through its own shadow camera, not a shared ArrayCamera');
  assert.deepEqual(lights.map((l) => l.shadow.needsUpdate),
    [false, false, false, false, false, false]);

  // Same frame id: the node fires updateBefore once per light, and only the
  // first of those may do the work.
  renders.length = 0;
  lights[2].shadow.needsUpdate = true;
  array.updateBefore(frame);
  assert.deepEqual(renders, [], 'a second call within one frame is a no-op');

  array.dispose();
});

test('the per-frame layer budget caps a bulk invalidation without dropping layers', () => {
  const lights = Array.from({ length: 6 }, () => {
    const light = new SpotLight();
    light.castShadow = true;
    light.intensity = 1;
    light.shadow.needsUpdate = true;
    light.shadow.autoUpdate = false;
    return light;
  });
  const array = new SharedSpotShadowArray(lights, 512, { maxLayersPerFrame: 2 });
  array.shadowMap = { setSize() {}, dispose() {} };

  const renderer = stubRenderer();
  const scene = stubScene();
  const camera = { layers: { mask: 0xffffffff } };

  for (let frameId = 1; frameId <= 3; frameId++) {
    array.updateBefore({ frameId, renderer, scene, camera });
  }
  const rendered = renderer.renders.map((r) => r.layer);
  assert.equal(rendered.length, 6, 'two layers per frame, so six layers take three frames');
  assert.deepEqual([...rendered].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5],
    'every layer is refreshed exactly once — the cursor never strands one');
  assert.equal(lights.every((l) => l.shadow.needsUpdate === false), true);

  array.dispose();
});

test('saved renderer state belongs to one shadow array and is released on dispose', () => {
  const makeArray = () => {
    const light = new SpotLight();
    light.castShadow = true;
    light.intensity = 1;
    light.shadow.needsUpdate = true;
    light.shadow.autoUpdate = false;
    const array = new SharedSpotShadowArray([light], 512);
    array.shadowMap = { setSize() {}, dispose() {} };
    return array;
  };
  const first = makeArray();
  const second = makeArray();
  const camera = { layers: { mask: 0xffffffff } };

  first.updateBefore({ frameId: 1, renderer: stubRenderer(), scene: stubScene(), camera });
  second.updateBefore({ frameId: 1, renderer: stubRenderer(), scene: stubScene(), camera });

  assert.ok(first._rendererState);
  assert.ok(second._rendererState);
  assert.notEqual(first._rendererState, second._rendererState,
    'two renderer instances never share a module-global saved-state object');

  const secondState = second._rendererState;
  first.dispose();
  assert.equal(first._rendererState, null,
    'teardown releases references captured from the renderer and scene');
  assert.equal(second._rendererState, secondState,
    'disposing one array cannot clear another renderer instance state');
  second.dispose();
});
