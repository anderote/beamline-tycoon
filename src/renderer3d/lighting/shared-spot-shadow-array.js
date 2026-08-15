import {
  ArrayCamera, DepthTexture, GreaterEqualCompare, LessEqualCompare,
  RedFormat, RendererUtils, VSMShadowMap,
} from 'three/webgpu';
import {
  getShadowMaterial, getShadowRenderObjectFunction, NodeUpdateType, shadow,
} from 'three/tsl';

const { resetRendererAndSceneState, restoreRendererAndSceneState } = RendererUtils;
let _rendererState;

/**
 * Texture-array layers are positional, so a gap cannot be filtered out. Render
 * only through the last live light: one newly placed fixture costs one shadow
 * camera, while a sparse assignment still preserves every layer index.
 */
export function activeShadowPrefixLength(lights, activeCount = lights.length) {
  let count = Math.max(0, Math.min(lights.length, Math.floor(activeCount || 0)));
  while (count > 0 && !(lights[count - 1]?.intensity > 0)) count--;
  return count;
}

/**
 * One depth-array texture shared by every fixture shadow.
 *
 * Each SpotLight still has its own projection matrix and shadow sampling node,
 * but all nodes bind the same texture and select their layer. That turns N
 * texture/sampler bindings into one and makes 12 cached fixture shadows fit a
 * normal WebGPU pipeline layout. The array is refreshed as one multiview pass
 * at the scheduler cadence, then reused between refreshes.
 */
export class SharedSpotShadowArray {
  constructor(lights, mapSize = 1024) {
    this.lights = lights;
    this.mapSize = mapSize;
    this.shadowMap = null;
    this.depthTexture = null;
    this.activeCount = lights.length;
    this._lastFrameId = -1;
    this._nodes = [];

    lights.forEach((light, layer) => {
      const node = shadow(light, light.shadow);
      node.depthLayer = layer;
      node.updateBeforeType = NodeUpdateType.RENDER;
      node.setupRenderTarget = (_shadow, builder) => this._setupRenderTarget(builder);
      node.updateBefore = (frame) => this.updateBefore(frame);
      // Individual analytic-light nodes may be rebuilt. They must not dispose
      // a render target shared by every other light; this class owns it.
      node.dispose = () => {};
      light.shadow.shadowNode = node;
      this._nodes.push(node);
    });
  }

  _setupRenderTarget(builder) {
    if (!this.shadowMap) {
      const depth = this.lights.length;
      this.depthTexture = new DepthTexture(
        this.mapSize, this.mapSize,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, depth,
      );
      this.depthTexture.name = 'FixtureShadowDepthArray';
      this.depthTexture.compareFunction = builder.renderer.reversedDepthBuffer
        ? GreaterEqualCompare
        : LessEqualCompare;
      this.shadowMap = builder.createRenderTarget(this.mapSize, this.mapSize, {
        format: RedFormat,
        depth,
      });
      this.shadowMap.texture.name = 'FixtureShadowArray';
      this.shadowMap.depthTexture = this.depthTexture;
      this.shadowMap.useArrayDepthTexture = true;
    }
    return { shadowMap: this.shadowMap, depthTexture: this.depthTexture };
  }

  setMapSize(size) {
    this.mapSize = Math.max(128, Math.floor(size || 1024));
    if (this.shadowMap) {
      this.shadowMap.setSize(this.mapSize, this.mapSize, this.lights.length);
    }
    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i].shadow.needsUpdate = i < this.activeCount;
    }
  }

  setActiveCount(count) {
    const next = Math.max(0, Math.min(this.lights.length, Math.floor(count || 0)));
    if (next === this.activeCount) return;
    this.activeCount = next;
    this._lastFrameId = -1;
    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i].shadow.needsUpdate = i < next;
    }
  }

  updateBefore(frame) {
    if (!this.shadowMap || this._lastFrameId === frame.frameId) return;
    this._lastFrameId = frame.frameId;

    const renderCount = activeShadowPrefixLength(this.lights, this.activeCount);
    if (renderCount === 0) return;
    const renderLights = this.lights.slice(0, renderCount);
    const needsUpdate = renderLights.some((light) => (
      light.intensity > 0 && (light.shadow.needsUpdate || light.shadow.autoUpdate)
    ));
    if (!needsUpdate) return;

    const { renderer, scene, camera } = frame;
    const shadowType = renderer.shadowMap.type;
    if (shadowType === VSMShadowMap) {
      console.warn('SharedSpotShadowArray does not support VSM; use PCF shadows.');
      return;
    }

    const cameras = [];
    const previousLayers = [];
    for (let i = 0; i < renderLights.length; i++) {
      const light = renderLights[i];
      const lightShadow = light.shadow;
      previousLayers.push(lightShadow.camera.layers.mask);
      if ((lightShadow.camera.layers.mask & 0xFFFFFFFE) === 0) {
        lightShadow.camera.layers.mask = camera.layers.mask;
      }
      lightShadow.updateMatrices(light);
      lightShadow.camera.userData.fixtureShadowLayer = i;
      cameras.push(lightShadow.camera);
    }

    const currentRenderObjectFunction = renderer.getRenderObjectFunction();
    const currentMRT = renderer.getMRT();
    const useVelocity = currentMRT ? currentMRT.has('velocity') : false;
    const referenceShadow = this.lights[0].shadow;

    _rendererState = resetRendererAndSceneState(renderer, scene, _rendererState);
    scene.overrideMaterial = getShadowMaterial(this.lights[0]);
    renderer.setRenderObjectFunction(
      getShadowRenderObjectFunction(renderer, referenceShadow, shadowType, useVelocity),
    );
    renderer.setClearColor(0x000000, 0);
    this.shadowMap.setSize(this.mapSize, this.mapSize, this.lights.length);
    renderer.setRenderTarget(this.shadowMap);
    renderer.render(scene, new ArrayCamera(cameras));
    renderer.setRenderObjectFunction(currentRenderObjectFunction);
    restoreRendererAndSceneState(renderer, scene, _rendererState);

    for (let i = 0; i < renderLights.length; i++) {
      const light = renderLights[i];
      light.shadow.camera.layers.mask = previousLayers[i];
      light.shadow.needsUpdate = false;
    }
  }

  dispose() {
    for (const light of this.lights) {
      light.shadow.shadowNode = null;
      light.shadow.map = null;
    }
    this.shadowMap?.dispose();
    this.shadowMap = null;
    this.depthTexture = null;
    this._nodes.length = 0;
  }
}

export default SharedSpotShadowArray;
