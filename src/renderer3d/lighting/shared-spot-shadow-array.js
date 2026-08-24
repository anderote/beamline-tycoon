import {
  DepthTexture, GreaterEqualCompare, LessEqualCompare,
  RedFormat, RendererUtils, VSMShadowMap,
} from 'three/webgpu';
import {
  getShadowMaterial, getShadowRenderObjectFunction, NodeUpdateType, shadow,
} from 'three/tsl';

const { resetRendererAndSceneState, restoreRendererAndSceneState } = RendererUtils;

/**
 * Which layers are lit AND dirty, in round-robin order starting at `cursor`.
 *
 * Layers are refreshed individually now, so this returns a SET of layer
 * indices rather than a prefix length: a sparse assignment refreshes exactly
 * the sparse layers instead of everything below the highest one. The rotation
 * matters because a per-frame budget smaller than the pending count would
 * otherwise always spend itself on the lowest indices and starve the rest.
 */
export function pendingShadowLayers(lights, activeCount = lights.length, cursor = 0) {
  const count = Math.max(0, Math.min(lights.length, Math.floor(activeCount || 0)));
  const out = [];
  if (count === 0) return out;
  const start = ((Math.floor(cursor) % count) + count) % count;
  for (let step = 0; step < count; step++) {
    const i = (start + step) % count;
    const light = lights[i];
    if (!(light?.intensity > 0)) continue;
    const lightShadow = light.shadow;
    if (!lightShadow) continue;
    if (lightShadow.needsUpdate || lightShadow.autoUpdate) out.push(i);
  }
  return out;
}

/**
 * One depth-array texture shared by every fixture shadow.
 *
 * Each SpotLight still has its own projection matrix and shadow sampling node,
 * but all nodes bind the same texture and select their layer. That turns N
 * texture/sampler bindings into one and makes 12 cached fixture shadows fit a
 * normal WebGPU pipeline layout.
 *
 * REFRESH IS PER LAYER, AND THAT IS THE WHOLE DESIGN. This class used to
 * refresh the array as a single ArrayCamera pass covering every layer from 0
 * through the highest live one, which had three compounding problems:
 *
 *   * COST. One dirty fixture re-rendered the facility once per live layer.
 *     Measured on the Major Lab the moment twelve lampposts pushed the live
 *     prefix from 4 to 11: 504 draws / 30,768 triangles per refresh became
 *     2,321 draws / 119,900 triangles, and the light rig had no way to ask for
 *     less because all the layers shared one scheduler slot.
 *   * A RENDER-TARGET TEARDOWN MID-PLAY. Three's WebGPU backend caches a pass
 *     descriptor per render target, and the ArrayCamera path's cache key does
 *     not include the number of sub-cameras, so a pass that grew from four
 *     live layers to eleven had to dispose the whole 768x768x12 colour+depth
 *     array to invalidate it. That landed in the middle of a camera rotation:
 *     two texture allocations, three shader modules and five shadow pipelines
 *     inside one frame.
 *   * A VALIDATION FAILURE RIGHT AFTER IT. Once the pass widened, Dawn
 *     rejected every shadow draw ("bound with size 256 ... requires at least
 *     768 bytes", against renderBundleArrayCamera_*), because the camera-index
 *     uniform had been sized for the narrower pass. Fixture shadows silently
 *     stopped rendering — the frame got faster because the work was being
 *     thrown away.
 *
 * Rendering one layer at a time removes all three at once. Three keys its pass
 * descriptor cache on `activeCubeFace` (see WebGPUBackend._getRenderPassDescriptor),
 * so `setRenderTarget(target, layer)` yields a correctly cached single-layer
 * colour and depth view per layer, nothing ever has to grow, and no ArrayCamera
 * or render bundle is involved. Each pass clears only its own layer, so layers
 * that are not being refreshed keep the shadow they already had.
 */
export class SharedSpotShadowArray {
  /**
   * @param {Array<THREE.SpotLight>} lights the fixture spots, in layer order.
   * @param {number} [mapSize=1024] one square shadow map per layer.
   * @param {object} [options]
   * @param {number} [options.maxLayersPerFrame=2] hard ceiling on layers
   *        refreshed in one frame. The light rig's ShadowScheduler is the real
   *        cadence owner; this is the backstop for the bulk invalidations
   *        (setActiveCount, setMapSize) that the scheduler does not mediate,
   *        so a quality change spreads over a few frames instead of spiking.
   */
  constructor(lights, mapSize = 1024, options = {}) {
    this.lights = lights;
    this.mapSize = mapSize;
    this.shadowMap = null;
    this.depthTexture = null;
    this.activeCount = lights.length;
    this.maxLayersPerFrame = Math.max(1, Math.floor(options.maxLayersPerFrame ?? 2));
    this._lastFrameId = -1;
    this._cursor = 0;
    this._nodes = [];
    // RendererUtils allocates its snapshot only for `undefined`; `null` is
    // treated as an existing state object by Three r184.
    this._rendererState = undefined;

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
    if (this.shadowMap) this.shadowMap.setSize(this.mapSize, this.mapSize, this.lights.length);
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

  /** Backstop cadence for bulk invalidations; see the constructor. */
  setMaxLayersPerFrame(count) {
    this.maxLayersPerFrame = Math.max(1, Math.floor(count || 1));
  }

  updateBefore(frame) {
    if (!this.shadowMap || this._lastFrameId === frame.frameId) return;
    this._lastFrameId = frame.frameId;

    const pending = pendingShadowLayers(this.lights, this.activeCount, this._cursor);
    if (pending.length === 0) return;

    const { renderer, scene, camera } = frame;
    const shadowType = renderer.shadowMap.type;
    if (shadowType === VSMShadowMap) {
      console.warn('SharedSpotShadowArray does not support VSM; use PCF shadows.');
      return;
    }

    const layers = pending.slice(0, Math.min(pending.length, this.maxLayersPerFrame));
    this._cursor = (layers[layers.length - 1] + 1) % Math.max(1, this.activeCount);

    const currentRenderObjectFunction = renderer.getRenderObjectFunction();
    const currentMRT = renderer.getMRT();
    const useVelocity = currentMRT ? currentMRT.has('velocity') : false;

    this._rendererState = resetRendererAndSceneState(renderer, scene, this._rendererState);
    scene.overrideMaterial = getShadowMaterial(this.lights[0]);
    renderer.setClearColor(0x000000, 0);
    // Keep the array at full topology depth. Every layer index has to stay
    // addressable even while only a couple of them are being refreshed.
    this.shadowMap.setSize(this.mapSize, this.mapSize, this.lights.length);

    for (const layer of layers) {
      const light = this.lights[layer];
      const lightShadow = light.shadow;
      const previousLayerMask = lightShadow.camera.layers.mask;
      if ((lightShadow.camera.layers.mask & 0xFFFFFFFE) === 0) {
        lightShadow.camera.layers.mask = camera.layers.mask;
      }
      lightShadow.updateMatrices(light);
      // Per-light, not a shared reference: the render-object function bakes in
      // this shadow's bias/radius, and reusing lights[0]'s for every layer
      // gave every fixture the first fixture's depth offsets.
      renderer.setRenderObjectFunction(
        getShadowRenderObjectFunction(renderer, lightShadow, shadowType, useVelocity),
      );
      renderer.setRenderTarget(this.shadowMap, layer);
      renderer.render(scene, lightShadow.camera);
      lightShadow.camera.layers.mask = previousLayerMask;
      lightShadow.needsUpdate = false;
    }

    renderer.setRenderObjectFunction(currentRenderObjectFunction);
    restoreRendererAndSceneState(renderer, scene, this._rendererState);
  }

  dispose() {
    for (const light of this.lights) {
      light.shadow.shadowNode = null;
      light.shadow.map = null;
    }
    this.shadowMap?.dispose();
    this.shadowMap = null;
    this.depthTexture = null;
    this._rendererState = null;
    this._nodes.length = 0;
  }
}

export default SharedSpotShadowArray;
