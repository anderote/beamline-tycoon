// src/renderer3d/glow-pipeline.js
//
// Selective bloom post-processing for Three's node renderer. The world always
// uses WebGPURenderer now (native WebGPU or its forceWebGL WebGL2 backend), so
// the old WebGLRenderer/EffectComposer rollback path was unreachable while
// still pulling the entire classic Three graph into the startup bundle.
import { RenderPipeline } from 'three/webgpu';
import { mix, mrt, normalView, output, pass, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { CINEMATIC_LIGHTING } from './lighting-tuning.js';
import { normalizeTiltShiftSettings } from './tilt-shift-settings.js';

// Layer index glow meshes are assigned to (`mesh.layers.enable(BLOOM_LAYER)`).
// Object3Ds default to layer 0 only, so anything that never opts in is
// treated as non-bloom automatically. Task 3 tags glow materials with this;
// Task 5 reads it back off scene objects.
export const BLOOM_LAYER = 1;
export const SOFT_GLOW_LAYER = 2;

// Conservative starting point (grounded industrial look, tuned at low-res
// pixel scale) — Task 3 tunes these by eye once real glow materials exist.
const DEFAULT_STRENGTH = CINEMATIC_LIGHTING.bloom.strength;
const DEFAULT_RADIUS = CINEMATIC_LIGHTING.bloom.radius;
const DEFAULT_THRESHOLD = CINEMATIC_LIGHTING.bloom.threshold;
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
//
// TWO INDEPENDENT SOFTENERS, AND NEITHER ONE HINTS AT THE OTHER. Whoever
// retunes one of these will not find the other by reading the code around it:
//
//   1. this constant, which widens the luminance knee, and
//   2. dayNightGrade()'s `darkness` (src/renderer3d/day-night.js), which is
//      smoothstepped through a twilight band, so a glow surface APPROACHES
//      its crossing gradually instead of at a constant rate.
//
// They reinforce rather than duplicate: (1) softens the threshold in
// brightness space, (2) softens the approach in time. Drop either and glow
// surfaces snap on and off as the sun moves — the exact pop this replaced.
// If a future grading change makes `darkness` linear again, this needs to go
// wider to compensate, and vice versa.
const DEFAULT_SMOOTH_WIDTH = 0.3;
const SOFT_STRENGTH = 0.42;
const SOFT_RADIUS = 0.82;
const SOFT_THRESHOLD = 0.55;
const SOFT_SMOOTH_WIDTH = 0.45;

/**
 * TSL-native bloom for WebGPU and its WebGL2 fallback backend. It operates on
 * the HDR scene output, so emissive surfaces and genuinely hot highlights
 * bloom without material swapping or duplicate scene renders. This is both
 * cheaper and physically more coherent than the legacy layer trick.
 */
class ModernGlowPipeline {
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this._enabled = opts.enabled !== undefined ? !!opts.enabled : true;
    this._quality = opts.quality || { glowScale: 0.5, softGlow: true };
    this._tiltShift = normalizeTiltShiftSettings(opts.tiltShift);
    this._tiltStrength = uniform(this._tiltShift.strength);
    this._tiltFocus = uniform(this._tiltShift.focus);
    this._tiltBand = uniform(this._tiltShift.band);
    this._tiltBlur = null;
    this._tiltSource = null;
    this._tiltOutput = null;

    // The base pass publishes view normals alongside colour so GTAO can add
    // stable contact grounding beneath machines, walls, and pipework.
    this._scenePass = pass(scene, camera);
    this._contactAOEnabled = renderer.backend?.isWebGPUBackend === true;
    if (this._contactAOEnabled) this._scenePass.setMRT(mrt({ output, normal: normalView }));
    this._sceneColor = this._scenePass.getTextureNode('output');
    if (this._contactAOEnabled) {
      this._sceneNormal = this._scenePass.getTextureNode('normal');
      this._sceneDepth = this._scenePass.getTextureNode('depth');
      this._aoPass = ao(this._sceneDepth, this._sceneNormal, camera);
      this._aoPass.radius.value = CINEMATIC_LIGHTING.contactAO.radius;
      this._aoPass.thickness.value = CINEMATIC_LIGHTING.contactAO.thickness;
      this._aoPass.distanceFallOff.value = CINEMATIC_LIGHTING.contactAO.distanceFallOff;
      this._aoStrength = uniform(0.65);
      const aoFactor = mix(vec3(1), vec3(this._aoPass.getTextureNode().r), this._aoStrength);
      this._groundedSceneColor = this._sceneColor.mul(vec4(aoFactor, 1));
    } else {
      // SwiftShader and compatibility WebGL can spend minutes on one GTAO
      // frame. Analytic fixture/sun shadows still provide contact on this
      // fallback; reserve the screen-space pass for native WebGPU.
      this._groundedSceneColor = this._sceneColor;
    }

    // Modern bloom is selective too. One layer-filtered camera renders both
    // authored glow roles into a shared HDR source. Tight and broad bloom use
    // different thresholds/radii over that source, avoiding the old pair of
    // nearly-identical extra scene renders while keeping sunlit concrete out.
    this._selectiveBloomEnabled = renderer.backend?.isWebGPUBackend === true;
    if (this._selectiveBloomEnabled) {
      this._glowCamera = camera.clone();
      this._glowCamera.layers.set(BLOOM_LAYER);
      this._glowCamera.layers.enable(SOFT_GLOW_LAYER);
      this._glowScenePass = pass(scene, this._glowCamera);
      this._glowSource = this._glowScenePass.getTextureNode('output');
    } else {
      // Compatibility WebGL keeps the original scene pass; another filtered
      // copy can starve software GL and low-end GPUs.
      this._glowSource = this._sceneColor;
    }
    this._bloomPass = bloom(
      this._glowSource,
      opts.strength ?? DEFAULT_STRENGTH,
      opts.radius ?? DEFAULT_RADIUS,
      opts.threshold ?? DEFAULT_THRESHOLD,
    );
    this._bloomPass.smoothWidth.value = opts.smoothWidth ?? DEFAULT_SMOOTH_WIDTH;
    this._softGlowPass = bloom(
      this._glowSource,
      this._quality.softGlow ? (opts.softStrength ?? SOFT_STRENGTH) : 0,
      opts.softRadius ?? SOFT_RADIUS,
      opts.softThreshold ?? SOFT_THRESHOLD,
    );
    this._softGlowPass.smoothWidth.value = opts.softSmoothWidth ?? SOFT_SMOOTH_WIDTH;
    this._softStrength = opts.softStrength ?? SOFT_STRENGTH;

    // Build both graph shapes once. Runtime quality changes can then switch
    // between them without allocating a fresh chain of TSL AddNodes on every
    // toggle (and without leaving the soft bloom mip chain scheduled on low).
    this._outputWithoutSoftGlow = this._groundedSceneColor.add(this._bloomPass);
    this._outputWithSoftGlow = this._outputWithoutSoftGlow.add(this._softGlowPass);

    this._pipeline = new RenderPipeline(renderer);
    this.setQuality(this._quality);
  }

  get enabled() { return this._enabled; }

  setEnabled(value) {
    const next = !!value;
    if (next === this._enabled) return;
    this._enabled = next;
    this._updateOutputGraph();
  }

  get tiltShiftSettings() { return { ...this._tiltShift }; }

  setTiltShift(settings = {}) {
    const previousEnabled = this._tiltShift.enabled;
    this._tiltShift = normalizeTiltShiftSettings({ ...this._tiltShift, ...settings });
    this._tiltStrength.value = this._tiltShift.strength;
    this._tiltFocus.value = this._tiltShift.focus;
    this._tiltBand.value = this._tiltShift.band;
    if (previousEnabled !== this._tiltShift.enabled) this._updateOutputGraph();
    return this.tiltShiftSettings;
  }

  _disposeTiltBlur() {
    this._tiltBlur?.dispose();
    this._tiltBlur = null;
    this._tiltSource = null;
    this._tiltOutput = null;
  }

  _updateOutputGraph() {
    if (!this._pipeline) return;
    const sharpOutput = this._enabled
      ? (this._quality.softGlow ? this._outputWithSoftGlow : this._outputWithoutSoftGlow)
      : this._groundedSceneColor;
    let outputNode = sharpOutput;

    if (this._tiltShift.enabled) {
      if (this._tiltSource !== sharpOutput) {
        this._disposeTiltBlur();
        this._tiltSource = sharpOutput;
        // A half-resolution separable blur keeps the miniature effect
        // affordable. Screen-space banding is intentional: unlike physical
        // depth of field it stays predictable with an orthographic camera.
        this._tiltBlur = gaussianBlur(sharpOutput, this._tiltStrength, 3, {
          resolutionScale: 0.5,
        });
        const distanceFromFocus = uv().y.sub(this._tiltFocus).abs();
        const focusEdge = this._tiltBand.mul(0.5);
        const blurWeight = smoothstep(focusEdge, focusEdge.add(0.18), distanceFromFocus);
        this._tiltOutput = mix(sharpOutput, this._tiltBlur, blurWeight);
      }
      outputNode = this._tiltOutput;
    } else {
      this._disposeTiltBlur();
    }

    if (this._pipeline.outputNode !== outputNode) {
      this._pipeline.outputNode = outputNode;
      this._pipeline.needsUpdate = true;
    }
  }

  setQuality(quality = {}) {
    this._quality = { ...this._quality, ...quality };
    this._softGlowPass.strength.value = this._quality.softGlow ? this._softStrength : 0;
    // Omitting the node from output is important: setting strength to zero
    // alone still schedules its full mip-chain blur. Low quality now pays for
    // neither the broad bloom nor its work.
    // RenderPipeline does not observe outputNode assignments. The coordinator
    // chooses the correct glow/no-glow and tilt/no-tilt graph and invalidates
    // it only when that graph shape changes.
    this._updateOutputGraph();
    // Three r184's BloomNode owns fixed half-resolution mip chains and exposes
    // no resolution-scale control. Assigning a private `_resolutionScale`
    // property here looked like a quality setting but BloomNode never read it.
    // `glowScale` therefore remains a LegacyGlowPipeline-only control until
    // Three exposes a supported equivalent for the node pipeline.
    if (this._aoPass) {
      this._aoStrength.value = Math.max(0, Math.min(1, quality.contactAOStrength ?? 0.65));
      this._aoPass.samples.value = Math.max(4, Math.floor(quality.contactAOSamples ?? 12));
      this._aoPass.resolutionScale = Math.max(0.25, Math.min(1, quality.contactAOScale ?? 0.5));
    }
  }

  // RenderPipeline tracks the renderer drawing buffer and resizes its own
  // transient targets on render, so this API is intentionally a no-op.
  setSize() {}

  render({ skipPostProcessing = false } = {}) {
    if ((this._enabled || this._tiltShift.enabled) && !skipPostProcessing) {
      if (this._selectiveBloomEnabled) {
        this._glowCamera.copy(this.camera);
        this._glowCamera.layers.set(BLOOM_LAYER);
        this._glowCamera.layers.enable(SOFT_GLOW_LAYER);
      }
      this._pipeline.render();
    }
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._disposeTiltBlur();
    this._bloomPass.dispose();
    this._softGlowPass.dispose();
    this._aoPass?.dispose();
    this._glowScenePass?.dispose();
    this._scenePass.dispose();
    this._pipeline.dispose();
  }
}

export class GlowPipeline {
  constructor(renderer, scene, camera, opts = {}) {
    return new ModernGlowPipeline(renderer, scene, camera, opts);
  }
}
