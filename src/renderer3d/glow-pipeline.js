// src/renderer3d/glow-pipeline.js
//
// Selective bloom post-processing. Standard three.js "darken non-bloomed"
// recipe: a bloom-only composer renders the scene with every material not
// tagged BLOOM_LAYER swapped to a shared black material, extracts/blurs the
// bright survivors, and a final composer renders the scene normally and
// additively composites the bloom buffer on top. Until something is put on
// BLOOM_LAYER (Task 3), the bloom-only pass sees an all-black scene, so its
// contribution is zero and this is a no-op over the direct render path.
//
// THREE core classes come off the global (see src/three-global.js) like the
// rest of renderer3d — but the postprocessing addons are never placed on
// that global, so they need real ESM imports. Verified working import path
// for three@0.160.0 (its exports map aliases "./addons/*" to
// "./examples/jsm/*"): 'three/addons/postprocessing/...'.
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Layer index glow meshes are assigned to (`mesh.layers.enable(BLOOM_LAYER)`).
// Object3Ds default to layer 0 only, so anything that never opts in is
// treated as non-bloom automatically. Task 3 tags glow materials with this;
// Task 5 reads it back off scene objects.
export const BLOOM_LAYER = 1;

// Conservative starting point (grounded industrial look, tuned at low-res
// pixel scale) — Task 3 tunes these by eye once real glow materials exist.
const DEFAULT_STRENGTH = 0.6;
const DEFAULT_RADIUS = 0.3;
const DEFAULT_THRESHOLD = 0.85;
// UnrealBloomPass hardcodes its internal LuminosityHighPassShader's
// `smoothWidth` uniform to 0.01 (a near-binary cliff at `threshold`) and
// doesn't expose it as a constructor argument — GlowPipeline sets it
// directly on `highPassUniforms` below. Widened from that default by Task 3:
// with real emissive glow materials in the scene (component-builder.js's
// `glow` role), several of them cross the 0.85 threshold partway through
// the day/night cycle as their emissiveIntensity scales with the night
// factor. At the default 0.01 width that crossing is a one-frame snap — the
// bloom halo popping on/off — instead of a fade. 0.3 turns that into a
// visible ramp (a bloom-eligible pixel needs luma within 0.3 of the
// threshold to be mid-ramp; see component-builder.js's glow-role comment for
// the specific crossing points this smooths). This is a shared knob: it
// softens the bloom knee for every object on BLOOM_LAYER, not just the glow
// role's screens/lamps — any future bloom source (Task 4/5) inherits the
// same wider, softer cutoff rather than a hard one.
const DEFAULT_SMOOTH_WIDTH = 0.3;

const MIX_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

// Additive composite of the normal render and the bloom-only render.
const MIX_FRAGMENT_SHADER = `
  uniform sampler2D baseTexture;
  uniform sampler2D bloomTexture;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D( baseTexture, vUv ) + vec4( 1.0 ) * texture2D( bloomTexture, vUv );
  }
`;

export class GlowPipeline {
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this._enabled = opts.enabled !== undefined ? !!opts.enabled : true;

    this._bloomLayerMask = new THREE.Layers();
    this._bloomLayerMask.set(BLOOM_LAYER);

    // Shared instance — every darkened object points at the same material,
    // never allocated per-object or per-frame.
    this._darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    // Cleared, not reallocated, every frame (see render()).
    this._materialCache = new Map();

    const size = renderer.getSize(new THREE.Vector2());

    // Bloom-only composer: renders the darkened scene, extracts bright
    // pixels above `threshold`, blurs them. Never drawn to screen directly.
    this._bloomComposer = new EffectComposer(renderer);
    this._bloomComposer.renderToScreen = false;
    this._bloomComposer.addPass(new RenderPass(scene, camera));
    this._bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      opts.strength ?? DEFAULT_STRENGTH,
      opts.radius ?? DEFAULT_RADIUS,
      opts.threshold ?? DEFAULT_THRESHOLD,
    );
    // See DEFAULT_SMOOTH_WIDTH above — not a constructor argument, so it's
    // set directly on the pass's own uniforms after construction.
    this._bloomPass.highPassUniforms['smoothWidth'].value = opts.smoothWidth ?? DEFAULT_SMOOTH_WIDTH;
    this._bloomComposer.addPass(this._bloomPass);

    // Final composer: renders the real scene, then additively blends the
    // bloom-only buffer on top and draws to the canvas.
    this._mixPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this._bloomComposer.readBuffer.texture },
        },
        vertexShader: MIX_VERTEX_SHADER,
        fragmentShader: MIX_FRAGMENT_SHADER,
      }),
      'baseTexture',
    );
    this._mixPass.needsSwap = true;

    this._finalComposer = new EffectComposer(renderer);
    this._finalComposer.addPass(new RenderPass(scene, camera));
    this._finalComposer.addPass(this._mixPass);
    // RenderPass writes into a non-null WebGLRenderTarget, which resolves to
    // LinearSRGBColorSpace (WebGLRenderer.js:1746) regardless of the
    // renderer's outputColorSpace — no sRGB OETF gets applied anywhere in
    // this chain unless something does it explicitly. A direct
    // renderer.render(scene, camera) call (render target null) applies that
    // conversion itself; this composer path does not, so without this pass
    // the composite blits raw linear values to the canvas and everything
    // renders washed out, independent of bloom. OutputPass applies the
    // renderer's outputColorSpace/toneMapping conversion and must be the
    // last pass so it — not the mix pass — is what renders to the canvas.
    this._finalComposer.addPass(new OutputPass());
  }

  get enabled() {
    return this._enabled;
  }

  setEnabled(v) {
    this._enabled = !!v;
  }

  setSize(w, h) {
    this._bloomComposer.setSize(w, h);
    this._finalComposer.setSize(w, h);
  }

  // Swap every non-bloom object's material for the shared black material,
  // caching the original so it can be restored after the bloom-only render.
  // Deliberately keyed on `.material` rather than `.isMesh` — the scene also
  // carries THREE.Line / THREE.LineSegments / THREE.Sprite objects (utility
  // line previews, grid overlays, HUD sprites) that are not meshes but do
  // have a material that could otherwise render at full brightness into the
  // bloom target and leak a false glow.
  _darkenNonBloomed(obj) {
    if (obj.material && this._bloomLayerMask.test(obj.layers) === false) {
      this._materialCache.set(obj, obj.material);
      obj.material = this._darkMaterial;
    }
  }

  _restoreMaterial(obj) {
    const cached = this._materialCache.get(obj);
    if (cached) obj.material = cached;
  }

  render() {
    if (!this._enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Shadow maps only need to be current for the normal render below; skip
    // recomputing them for the throwaway darkened pass.
    const prevShadowAutoUpdate = this.renderer.shadowMap.autoUpdate;
    this.renderer.shadowMap.autoUpdate = false;

    this._materialCache.clear();
    this.scene.traverse((obj) => this._darkenNonBloomed(obj));
    this._bloomComposer.render();
    this.scene.traverse((obj) => this._restoreMaterial(obj));

    this.renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;

    // Buffer identity flips each frame inside EffectComposer (RenderPass
    // swaps, UnrealBloomPass doesn't) — read readBuffer fresh rather than
    // caching a fixed renderTarget1/2 reference.
    this._mixPass.uniforms.bloomTexture.value = this._bloomComposer.readBuffer.texture;
    this._finalComposer.render();
  }

  dispose() {
    this._bloomComposer.dispose();
    this._finalComposer.dispose();
    this._darkMaterial.dispose();
    this._materialCache.clear();
  }
}
