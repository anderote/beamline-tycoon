// src/renderer3d/light-rig.js
//
// Real THREE lights, for the things bloom/emissive materials can't fake: a
// lamppost casting an actual shadow, an explosion brightening the wall behind
// it, or a live utility run tinting the floor and equipment beside it. Bloom
// still supplies the optical halo around the bright source; this rig supplies
// the light that lands on other surfaces.
//
// THE GOVERNING CONSTRAINT: adding or removing a light from a three.js scene
// forces a shader recompile across every lit material in the scene — a
// visible hitch. So every light here is allocated ONCE, at construction,
// parked at intensity 0, added to the scene exactly once, and never removed
// until dispose() tears the whole rig down. Every frame after that only ever
// MOVES, RETINTS, and FADES existing lights — including explosion flashes,
// which steal a parked slot rather than allocating a new light. This is what
// makes a bounded fixed rig plus on-demand flashes affordable. On the modern
// renderer, non-shadow spots are dynamically batched: their count can change
// without changing material programs, while a stable leading subset owns
// cached shadow maps.
//
// Two emitter sources feed the rig:
//   - "fixtures": entries from ThreeRenderer.lightingGroup, the same registry
//     used to build painted pools and halos. These get the pooled shadow-casting
//     SpotLights. There are
//     far more fixtures than spots, so the spots are an LOD over the painted
//     pools every fixture already has — see "Spot handover" below, which is
//     where the interesting logic lives.
//   - "glow" meshes: userData.role === 'glow' (component-builder.js's screens
//     / indicator lamps / hot cathodes), plus VisualEffectSystem's moving
//     effect proxies. They get the bounded non-shadow PointLight pool; all
//     unbounded visual glow remains instanced/emissive.
//
// SpotLight over PointLight for fixtures: a shadow-casting PointLight needs a
// CUBE shadow map — six render passes per light per frame. A SpotLight needs
// one 2D map, and lampposts/wall lights point down anyway, so a spot is both
// cheaper and more truthful about the fixture. Shadow map size is 1024, not
// the sun's 4096 (ThreeRenderer._sunLight) — that's a global map covering the
// whole facility; these are small pools of light around one fixture each, and
// several of them at 4096 would be the actual "unshippable" scenario the task
// brief warns about.
//
// THREE is loaded as a CDN global (src/three-global.js) — do NOT import it.
import { fixtureLightTag } from './lighting-builder.js';
import { fixtureLightProjection } from './fixture-light-math.js';
import { ShadowScheduler } from './shadow-scheduler.js';
import { fixtureDynamicFactor } from './light-dynamics.js';
import { getLightCookie } from './light-cookie.js';
import { SharedSpotShadowArray } from './lighting/shared-spot-shadow-array.js';
import { fixtureActivationFactor } from './fixture-activation.js';

// ---- Tuning constants ------------------------------------------------------
//
// ThreeRenderer uses AgX tone mapping, so these intensities can create a hot
// practical source without clipping immediately to white. They remain modest
// because dozens of overlapping fixtures still accumulate in HDR.
const FIXTURE_SPOT_INTENSITY = 6;
const FIXTURE_SPOT_DISTANCE = 7;     // metres — a lamppost's real throw, not the whole yard
const FIXTURE_SPOT_ANGLE = Math.PI / 5.5; // half-angle; a downward cast, not a wide floodlight
const FIXTURE_SPOT_PENUMBRA = 0.55;  // soft cone edge — matches the pixel-scale render, not a hard theatrical spot
const FIXTURE_SPOT_DECAY = 2;        // physically-based inverse-square falloff (three's default)
const DEFAULT_FIXTURE_COLOR = 0xffc864; // warm sodium-lamp tint — matches decoration-builder.js's lamppost glow material

const AMBIENT_POINT_INTENSITY = 3;
const AMBIENT_POINT_DISTANCE = 4.5;  // short throw — this is "the screen lights its own console", not room lighting
const AMBIENT_POINT_DECAY = 2;
const DEFAULT_GLOW_LIGHT_COLOR = 0x40e0ff; // llrfController's screen tint (component-builder.js) — a reasonable fallback

const FLASH_POINT_DISTANCE = 10;     // an explosion's throw is bigger than a console's ambient glow
const FLASH_POINT_DECAY = 2;
const DEFAULT_FLASH_DURATION_MS = 600;
const POINT_RANK_SLACK = 4;

// ---- Spot handover (the fixture LOD) ---------------------------------------
//
// There are two lighting systems and they are an LOD, not rivals: every
// fixture gets lighting-builder.js's cheap painted floor pool, and the nearest
// few also get one of the 4 real shadow spots here. THE CORRECTNESS CONDITION
// is that a fixture holding a real spot SUPPRESSES ITS OWN PAINTED POOL — the
// rig owns that decision and publishes it through getFixtureSuppression(),
// which lighting-builder.js's applyPoolSuppression consumes verbatim. Never
// let the pool builder infer "am I lit for real?" on its own: it would have
// to duplicate the ranking below, and the two answers would disagree for
// exactly the frames that matter (mid-crossfade).
//
// Naive "just take the nearest 4 every frame" is the failure mode this block
// exists to prevent: with two fixtures at nearly equal distance, one frame of
// camera drift swaps them, the outgoing pool pops back on, the incoming pool
// pops off, and panning slowly across a row of lampposts strobes. Three
// dampers, all needed:
//   - RANK SLACK: an incumbent isn't evicted the instant it falls out of the
//     top N, only once it falls out of the top N + slack. Pure ordering
//     jitter never crosses that band.
//   - MIN HOLD: even a genuine demotion waits out a minimum tenure, so a
//     fixture can't be picked up and dropped inside one gesture.
//   - CROSSFADE: handover is a weighted fade, and the SAME weight drives both
//     the real light's intensity and the painted pool's suppression, so the
//     two are complementary at every instant of the fade — total light on the
//     fixture stays roughly constant instead of dipping or doubling.
const SPOT_RANK_SLACK = 2;
const SPOT_MIN_HOLD_MS = 1200;
const SPOT_CROSSFADE_MS = 250;

export class LightRig {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts]
   * @param {number} [opts.shadowSpotCount=4] fixture pool size — shadow-casting
   * @param {number} [opts.pointCount=8] non-shadow pool size — ambient glow + flashes
   * @param {number} [opts.shadowMapSize=1024] one dial for the whole spot pool,
   *        so a frame-budget complaint is a one-line change, not a rewrite.
   * @param {number} [opts.flashReserve=2] how many of the point slots the
   *        ambient glow pass may NOT claim. Without a reserve, a facility with
   *        eight-plus glowing screens keeps every point light permanently
   *        assigned, so the first explosion has to steal a lit console — the
   *        screen it stole from visibly blinks out at the exact moment the
   *        player's attention is elsewhere. Two idle slots means the common
   *        case (one or two simultaneous flashes) never disturbs the ambient
   *        pool at all.
   * @param {boolean} [opts.enabled=true]
   * @param {number} [opts.shadowHz=15] aggregate shadow-refresh queue rate;
   *        shared by every active fixture rather than multiplied per light.
   * @param {number} [opts.shadowUpdatesPerFrame=1] hard refresh budget for
   *        moving shadow casters and newly assigned fixtures.
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this._enabled = opts.enabled !== undefined ? !!opts.enabled : true;
    this._modernRenderer = opts.modernRenderer === true;
    this._shadowSpotCount = opts.shadowSpotCount ?? 4;
    this._hasIndependentFixtureBudget = opts.fixtureLightCount != null;
    this._fixtureLightCount = Math.max(
      this._shadowSpotCount,
      Math.floor(opts.fixtureLightCount ?? this._shadowSpotCount),
    );
    this._activeShadowSpotCount = Math.min(
      this._shadowSpotCount,
      Math.max(0, opts.activeShadowSpotCount ?? this._shadowSpotCount),
    );
    this._activeFixtureLightCount = Math.max(
      this._activeShadowSpotCount,
      Math.min(this._fixtureLightCount, Math.max(0, Math.floor(
        opts.activeFixtureLightCount ?? this._fixtureLightCount,
      ))),
    );
    this._pointCount = opts.pointCount ?? 8;
    this._shadowMapSize = opts.shadowMapSize ?? 1024;
    this._shadowHz = Math.max(0, opts.shadowHz ?? 15);
    this._shadowUpdatesPerFrame = Math.max(1, Math.floor(opts.shadowUpdatesPerFrame ?? 1));
    this._flashReserve = Math.max(0, Math.min(opts.flashReserve ?? 2, this._pointCount));

    // Internal clock, advanced by the dt passed to update() — not
    // performance.now(). Keeps "how long has this slot been idle" testable
    // without real timers, and ties flash decay to the same dt the rest of
    // the frame (tickFlow, staffPawns.update) already uses.
    this._clockMs = 0;

    // ---- Fixture spots: stable shadow leaders + dynamically batched tail --
    this._spotSlots = [];
    for (let i = 0; i < this._fixtureLightCount; i++) {
      const castsShadow = i < this._shadowSpotCount;
      const light = new THREE.SpotLight(
        DEFAULT_FIXTURE_COLOR, 0, FIXTURE_SPOT_DISTANCE,
        FIXTURE_SPOT_ANGLE, FIXTURE_SPOT_PENUMBRA, FIXTURE_SPOT_DECAY,
      );
      light.castShadow = castsShadow;
      // Shadow-capable slots stay in the immutable light topology, but a
      // lower quality tier can make their shadow contribution exactly zero.
      // This preserves their analytic PBR light without sampling an
      // unrefreshed layer or recompiling materials when quality changes.
      light.shadow.intensity = castsShadow && i < this._activeShadowSpotCount ? 1 : 0;
      light.map = castsShadow ? getLightCookie('soft') : null;
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = false;
      if (castsShadow) light.shadow.mapSize.set(this._shadowMapSize, this._shadowMapSize);
      light.shadow.camera.near = 0.2;
      // shadow.camera.far is DELIBERATELY not set here (and must not be set in
      // _applyFixtureSpot either — see the note there). SpotLightShadow's
      // updateMatrices does `const far = light.distance || camera.far` and
      // only calls updateProjectionMatrix() when it observes that value
      // CHANGE. Assigning camera.far by hand makes that comparison pass
      // silently, leaving the projection matrix stale — the shadow keeps being
      // rendered with the previous frustum. Set light.distance; three does the
      // rest.
      // A small local light at modest shadow-map resolution needs more bias
      // headroom than the sun's global 4096 map (ThreeRenderer._sunLight) —
      // its texels cover far less world space per pixel than you'd think
      // given the tight `far`, so shadow acne shows up sooner without it.
      light.shadow.bias = -0.0025;
      light.shadow.normalBias = 0.02;
      const target = new THREE.Object3D();
      scene.add(target);
      light.target = target;
      scene.add(light);
      // weight:     0..1 crossfade weight; drives BOTH this light's intensity
      //             and the held fixture's pool suppression.
      // releasing:  true once the fixture has been evicted but is still fading
      //             out — assignedRef is deliberately kept until weight hits
      //             0, otherwise the outgoing fixture is dark for the whole
      //             fade (no real light, and its pool already suppressed).
      // heldSinceMs: clock reading when assignedRef was last (re)assigned, for
      //             the min-hold test.
      this._spotSlots.push({
        light, target, assignedRef: null, weight: 0, releasing: false, heldSinceMs: 0,
        projection: null, castsShadow,
      });
    }
    this._sharedShadowArray = this._modernRenderer && this._shadowSpotCount > 0
      ? new SharedSpotShadowArray(
        this._spotSlots.slice(0, this._shadowSpotCount).map((slot) => slot.light),
        this._shadowMapSize,
        { maxLayersPerFrame: this._shadowUpdatesPerFrame },
      )
      : null;
    this._sharedShadowArray?.setActiveCount(this._activeShadowSpotCount);

    // ---- The non-shadow pool: ambient glow + flash target, allocated once
    this._pointSlots = [];
    for (let i = 0; i < this._pointCount; i++) {
      const light = new THREE.PointLight(0xffffff, 0, AMBIENT_POINT_DISTANCE, AMBIENT_POINT_DECAY);
      scene.add(light);
      // flash: null | { elapsedMs, durationMs, baseIntensity } — set by
      // flash(), advanced/cleared by _advanceFlashes(). While set, this slot
      // is off-limits to the ambient glow-assignment pass below.
      this._pointSlots.push({ light, assignedRef: null, flash: null, lastUsedAt: -Infinity });
    }

    // Candidate emitters (fixtures, glow-role meshes), refreshed from a scene
    // traversal only when markDirty() has been called since the last
    // refresh — ThreeRenderer marks only geometry/candidate-changing events,
    // so ticks and resource/UI updates do not retraverse a static facility.
    // Ranking + slot
    // assignment still runs every update() call (cheap: these arrays are a
    // handful to a few dozen entries, not the whole scene).
    this._fixtureRegistry = [];
    this._fixtureCandidates = [];
    this._glowCandidates = [];
    this._effectEmitterRegistry = [];
    this._candidatesDirty = true;

    // fixture id -> pool-suppression weight in [0,1]. Rebuilt IN PLACE every
    // update (clear + set, never reallocated) so ThreeRenderer can hold the
    // reference once and read it per frame without churning garbage. See
    // getFixtureSuppression.
    this._fixtureSuppression = new Map();
    this._nextFixtureSuppression = new Map();
    this._fixtureSuppressionRevision = 0;

    this._tmpWorld = new THREE.Vector3();
    this._tmpTarget = new THREE.Vector3();
    // Separate from _tmpWorld on purpose: _worldPos() overwrites _tmpWorld for
    // every candidate it ranks, so a camera-less fallback that parked its
    // origin in _tmpWorld would find "the camera" silently relocated to the
    // last fixture examined, and the whole ranking would collapse.
    this._tmpCam = new THREE.Vector3();
    this._viewFrustum = typeof THREE.Frustum === 'function' ? new THREE.Frustum() : null;
    this._viewProjection = typeof THREE.Matrix4 === 'function' ? new THREE.Matrix4() : null;
    this._viewSphere = typeof THREE.Sphere === 'function'
      ? new THREE.Sphere(new THREE.Vector3(), 1)
      : null;
    // One scheduler slot per shadow layer, whether or not the layers live in
    // one shared texture array. Collapsing the shared array onto a single slot
    // (as this used to) made every fixture share one dirty bit, so a single
    // reassignment refreshed all twelve layers at once — the spike the array
    // now exists to avoid. SharedSpotShadowArray refreshes layers
    // individually, so it wants exactly the same staggering the per-light
    // path always had.
    this._shadowScheduler = new ShadowScheduler(this._shadowSpotCount, {
      hz: this._shadowHz,
      maxUpdatesPerFrame: this._shadowUpdatesPerFrame,
    });
    this._shadowAssignmentKeys = new Array(this._shadowSpotCount).fill(null);
    this._shadowUpdatesLastFrame = 0;
    this._effectTimeMs = 0;
    this._fixtureRankCache = [];
    this._fixtureRankDirty = true;
    this._fixtureRankFocus = [NaN, NaN, NaN];
    this._fixtureRankCamera = null;
    this._fixtureRankWorld = new Float64Array(16);
    this._fixtureRankProjection = new Float64Array(16);
  }

  get enabled() {
    return this._enabled;
  }

  /** Invalidate the cached candidate lists — call on any world event that may
   * have placed/removed a fixture or a glow-role mesh. Traversal itself is
   * deferred to the next update() call, not run here. */
  markDirty() {
    this._candidatesDirty = true;
    this._fixtureRankDirty = true;
    this._shadowScheduler.markAllDirty();
  }

  /** Apply a quality budget without adding/removing lights. */
  setQuality(quality = {}) {
    const active = Math.max(0, Math.min(
      this._shadowSpotCount,
      Math.floor(quality.fixtureShadowCount ?? this._activeShadowSpotCount),
    ));
    const activeLights = this._hasIndependentFixtureBudget
      ? Math.max(active, Math.min(
        this._fixtureLightCount,
        Math.floor(quality.fixtureLightCount ?? this._activeFixtureLightCount),
      ))
      : active;
    this._activeFixtureLightCount = Math.max(active, activeLights);
    const mapSize = Math.max(128, Math.floor(quality.fixtureShadowMapSize ?? this._shadowMapSize));
    this._activeShadowSpotCount = active;
    for (let i = 0; i < this._shadowSpotCount; i++) {
      const shadow = this._spotSlots[i].light.shadow;
      shadow.intensity = i < active ? 1 : 0;
      if (i >= active) shadow.needsUpdate = false;
    }
    this._sharedShadowArray?.setActiveCount(active);
    this._shadowHz = Math.max(0, Number(quality.fixtureShadowHz ?? this._shadowHz));
    this._shadowUpdatesPerFrame = Math.max(1, Math.floor(
      quality.fixtureShadowUpdatesPerFrame ?? this._shadowUpdatesPerFrame,
    ));
    this._shadowScheduler.configure({
      hz: this._shadowHz,
      maxUpdatesPerFrame: this._shadowUpdatesPerFrame,
    });
    this._sharedShadowArray?.setMaxLayersPerFrame(this._shadowUpdatesPerFrame);
    if (mapSize !== this._shadowMapSize) {
      this._shadowMapSize = mapSize;
      for (const slot of this._spotSlots.slice(0, this._shadowSpotCount)) {
        slot.light.shadow.mapSize.set(mapSize, mapSize);
        if (slot.light.shadow.map && !this._modernRenderer) {
          slot.light.shadow.map.dispose();
          slot.light.shadow.map = null;
        }
      }
      this._sharedShadowArray?.setMapSize(mapSize);
    }
    for (let i = this._activeFixtureLightCount; i < this._spotSlots.length; i++) this._parkSpot(i);
    this._shadowScheduler.markAllDirty();
  }

  getStats() {
    const assignedAmbientPointLights = this._pointSlots
      .filter((slot) => !slot.flash && slot.assignedRef && slot.light.intensity > 0).length;
    const activePointFlashes = this._pointSlots.filter((slot) => slot.flash).length;
    return {
      allocatedFixtureLights: this._fixtureLightCount,
      activeFixtureLights: this._activeFixtureLightCount,
      assignedFixtureLights: this._spotSlots.slice(0, this._activeFixtureLightCount)
        .filter((slot) => slot.assignedRef && slot.light.intensity > 0).length,
      allocatedFixtureShadows: this._shadowSpotCount,
      activeFixtureShadows: this._activeShadowSpotCount,
      assignedFixtureShadows: this._spotSlots.slice(0, this._activeShadowSpotCount)
        .filter((slot) => slot.assignedRef && slot.light.intensity > 0).length,
      shadowUpdatesLastFrame: this._shadowUpdatesLastFrame,
      fixtureShadowQueuePending: this._shadowScheduler.pendingCount,
      fixtureShadowMapSize: this._shadowMapSize,
      fixtureShadowHz: this._shadowHz,
      fixtureShadowQueueHz: this._shadowHz,
      fixtureShadowUpdatesPerFrame: this._shadowUpdatesPerFrame,
      sharedFixtureShadowArray: !!this._sharedShadowArray,
      fixtureShadowArrayLayers: this._sharedShadowArray?.lights.length ?? 0,
      allocatedPointLights: this._pointCount,
      ambientPointLightCapacity: Math.max(0, this._pointCount - this._flashReserve),
      assignedAmbientPointLights,
      activePointFlashes,
    };
  }

  /** Supply the canonical [{id, def, group}] fixture registry. */
  setFixtureRegistry(fixtures) {
    this._fixtureRegistry = Array.isArray(fixtures) ? fixtures : [];
    this.markDirty();
  }

  /**
   * Supply VisualEffectSystem's fixed Object3D proxy array. Entries move and
   * toggle visibility in place, so no scene traversal or light allocation is
   * needed as effects animate.
   */
  setEffectEmitterRegistry(emitters) {
    this._effectEmitterRegistry = Array.isArray(emitters) ? emitters : [];
  }

  setEnabled(v) {
    this._enabled = !!v;
    if (!this._enabled) {
      // Zero immediately rather than waiting for the next update() — the
      // Options toggle should kill every light (and any flash in flight) on
      // the frame it's clicked, not fade out over the next tick.
      for (const s of this._spotSlots) {
        s.light.intensity = 0; s.light.shadow.needsUpdate = false;
        s.assignedRef = null; s.weight = 0; s.releasing = false;
      }
      for (const p of this._pointSlots) {
        p.light.intensity = 0; p.assignedRef = null; p.flash = null;
      }
      // Every fixture goes back to its painted pool on the same frame — the
      // toggle must never leave a fixture suppressed with nothing lighting it.
      if (this._fixtureSuppression.size) {
        this._fixtureSuppression.clear();
        this._fixtureSuppressionRevision++;
      }
    }
  }

  /**
   * fixture id -> [0,1] suppression weight for the painted floor pools, i.e.
   * "how much of this fixture's lighting is currently being done for real".
   * The returned Map is live and updated in place when the weights change —
   * read it, do not retain copies of its entries. Consumed by lighting-builder.js's
   * applyPoolSuppression; see the "Spot handover" block above for why this rig
   * (not the pool builder) owns the decision.
   */
  getFixtureSuppression() {
    return this._fixtureSuppression;
  }

  getFixtureSuppressionRevision() {
    return this._fixtureSuppressionRevision;
  }

  /**
   * @param {THREE.Camera} camera used for its frustum and as a focus fallback.
   * @param {number} nightFactor 0 (full day — fixtures dark) .. 1 (full
   *        night — fixtures at full intensity). NOT the same curve as
   *        component-builder.js's glow-role factor, which floors at 0.35 so
   *        screens never go fully dark at noon — a lit lamppost at noon is
   *        just silly, so fixtures (and the ambient glow pool) go all the
   *        way to 0.
   * @param {number} dt seconds since the last call.
   * @param {{x:number,y:number,z:number}|null} focusPoint world-space point at
   *        the center of the view. Passing the camera position here biases an
   *        isometric camera toward fixtures tens of metres behind the screen.
   */
  /**
   * @param {object} [options]
   * @param {boolean} [options.freezeAssignment=false] hold the current
   *        fixture-to-spot assignment instead of re-ranking. See _assignSpots.
   */
  update(camera, nightFactor, dt, focusPoint = null, effectTimeMs = null, options = {}) {
    const dtMs = Number.isFinite(dt) && dt > 0 ? dt * 1000 : 0;
    this._clockMs += dtMs;
    this._effectTimeMs = Number.isFinite(effectTimeMs) ? effectTimeMs : this._clockMs;
    this._advanceFlashes(dtMs);

    if (!this._enabled) {
      // Flashes were already cleared by setEnabled(false); nothing to do
      // here except keep the ambient pool at zero every frame the toggle is
      // off (a newly-placed lamppost mustn't light itself up mid-toggle).
      for (const s of this._spotSlots) {
        s.light.intensity = 0;
        s.light.shadow.needsUpdate = false;
      }
      for (const p of this._pointSlots) if (!p.flash) p.light.intensity = 0;
      if (this._fixtureSuppression.size) {
        this._fixtureSuppression.clear();
        this._fixtureSuppressionRevision++;
      }
      return;
    }

    // Captured before the flag is cleared: _assignSpots needs to know that
    // the world changed THIS frame, and by the time it runs the flag is gone.
    const candidatesChanged = this._candidatesDirty;
    if (this._candidatesDirty) {
      this._refreshCandidates();
      this._candidatesDirty = false;
    }

    const fallback = (camera && camera.position) ? camera.position : { x: 0, y: 0, z: 0 };
    const f = focusPoint || fallback;
    const focus = this._tmpCam.set(f.x || 0, f.y || 0, f.z || 0);
    this._prepareViewFrustum(camera);
    const nf = Number.isFinite(nightFactor) ? Math.max(0, Math.min(1, nightFactor)) : 0;
    this._assignSpots(
      focus, nf, dtMs, camera,
      options.freezeAssignment === true && !candidatesChanged,
    );
    this._scheduleShadows(nf, dtMs);
    this._assignPoints(focus, nf);
  }

  /**
   * Claim the longest-idle non-shadow point light, move it to `position`,
   * tint it `colorHex`, set it to `intensity`, and ramp it down to 0 over
   * `durationMs` on an ease-out curve. Steals the dimmest slot when every
   * slot is already flashing — never allocates a light. Ignores nightFactor
   * (an explosion is bright at noon) but is a no-op while setEnabled(false).
   * @returns {THREE.PointLight|null} the slot claimed, or null if disabled.
   */
  flash(position, colorHex, intensity, durationMs) {
    if (!this._enabled || !position) return null;
    const dur = Math.max(1, durationMs || DEFAULT_FLASH_DURATION_MS);
    const slot = this._pickFlashSlot();
    slot.flash = { elapsedMs: 0, durationMs: dur, baseIntensity: intensity };
    slot.light.distance = FLASH_POINT_DISTANCE;
    slot.light.decay = FLASH_POINT_DECAY;
    slot.light.position.set(position.x, position.y, position.z);
    slot.light.color.set(colorHex);
    slot.light.intensity = intensity;
    slot.assignedRef = null; // no longer tracking an ambient glow candidate
    slot.lastUsedAt = this._clockMs;
    return slot.light;
  }

  dispose() {
    const ownsSharedShadowMap = !!this._sharedShadowArray;
    this._sharedShadowArray?.dispose();
    for (const s of this._spotSlots) {
      if (!ownsSharedShadowMap && s.castsShadow && s.light.shadow && s.light.shadow.map) {
        s.light.shadow.map.dispose();
      }
      if (s.light.shadow) s.light.shadow.map = null;
      this.scene.remove(s.target);
      this.scene.remove(s.light);
    }
    for (const p of this._pointSlots) {
      this.scene.remove(p.light);
    }
    this._spotSlots = [];
    this._pointSlots = [];
    this._fixtureRegistry = [];
    this._fixtureCandidates = [];
    this._glowCandidates = [];
    this._effectEmitterRegistry = [];
  }

  // ---- internals ------------------------------------------------------

  _refreshCandidates() {
    const taggedFixtures = [];
    const glows = [];
    this.scene.traverse((obj) => {
      if (obj.userData && obj.userData.lightFixture) taggedFixtures.push(obj);
      if (obj.isMesh && obj.userData && obj.userData.role === 'glow'
          && obj.userData.ambientLight !== false) glows.push(obj);
    });
    const registryFixtures = this._fixtureRegistry.filter(
      (fx) => fx && fx.group && fx.def && fx.def.light,
    );
    // Registry entries are canonical in the renderer. Tagged objects remain
    // supported for isolated consumers and existing headless tests.
    this._fixtureCandidates = registryFixtures.length ? registryFixtures : taggedFixtures;
    this._glowCandidates = glows;
  }

  _worldPos(obj) {
    return (obj.group || obj).getWorldPosition(this._tmpWorld);
  }

  _prepareViewFrustum(camera) {
    if (!this._viewFrustum || !this._viewProjection || !camera?.projectionMatrix || !camera?.matrixWorldInverse) {
      this._frustumReady = false;
      return;
    }
    this._viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._viewFrustum.setFromProjectionMatrix(this._viewProjection);
    this._frustumReady = true;
  }

  _rankCandidates(candidates, focus, radiusFor = null) {
    return candidates.filter((obj) => obj && obj.visible !== false).map((obj, index) => {
      const p = this._worldPos(obj);
      const dx = p.x - focus.x, dy = p.y - focus.y, dz = p.z - focus.z;
      let visible = true;
      if (this._frustumReady) {
        const radius = Math.max(0.1, radiusFor ? radiusFor(obj) : 0.25);
        if (this._viewSphere) {
          this._viewSphere.center.set(p.x, p.y, p.z);
          this._viewSphere.radius = radius;
          visible = this._viewFrustum.intersectsSphere(this._viewSphere);
        } else {
          visible = this._viewFrustum.containsPoint(p);
        }
      }
      const id = obj.id ?? obj.userData?.lightFixture?.id ?? obj.uuid ?? index;
      return { obj, visible, distSq: dx * dx + dy * dy + dz * dz, id: String(id) };
    }).sort((a, b) =>
      (Number(b.visible) - Number(a.visible))
      || (a.distSq - b.distSq)
      || a.id.localeCompare(b.id));
  }

  /**
   * Decide which fixtures hold the real shadow spots this frame, fade them
   * in/out, and publish the matching pool suppression. Four ordered passes —
   * the ordering matters and is the reason this isn't one loop:
   *
   *   1. RANK every candidate by distance. `pool` is who deserves a spot;
   *      `slackPool` is who is allowed to KEEP one.
   *   2. INCUMBENTS: free any slot whose fade already finished, un-release a
   *      fixture that climbed back into the pool mid-fade (a player who pans
   *      away and immediately back must not see the light die and restart),
   *      and start releasing an incumbent that has both fallen out of the
   *      slack band and served its minimum tenure.
   *   3. FILL genuinely free slots (assignedRef === null) from the pool,
   *      skipping fixtures another slot still holds. Runs AFTER pass 2 so a
   *      slot freed this frame is immediately reusable.
   *   4. ADVANCE the crossfade and publish — intensity and suppression from
   *      the SAME weight, so the two systems stay complementary.
   */
  _assignSpots(camPos, nightFactor, dtMs, camera = null, freezeAssignment = false) {
    const n = this._activeFixtureLightCount;
    for (let i = n; i < this._spotSlots.length; i++) this._parkSpot(i);

    // --- 0. hold the assignment through a camera animation ---------------
    // Ranking reads the camera frustum, so a Q/E rotation reshuffles it every
    // frame: incumbents fall out of the slack band, crossfades start in both
    // directions, and the shadow assignment keys churn — which marks the
    // scheduler dirty and forces shadow refreshes on consecutive frames
    // instead of at the preset cadence. All of that is spent on a view the
    // player is not looking at yet, and it lands on the exact frames that can
    // least afford it. Hold the current assignment and re-rank once the camera
    // settles.
    //
    // Only steps 1-3 are skipped. Step 4 still runs, so an in-flight crossfade
    // finishes and every held light keeps tracking its fixture — freezing the
    // fade instead would leave the rig visibly mid-handover for the length of
    // the animation.
    //
    // NOTHING LATCHES HERE. `freezeAssignment` is recomputed from the
    // renderer's live animation flags every frame, so an interrupted rotation
    // (startFreeOrbit clears _viewRotating, endFreeOrbit clears _freeOrbiting)
    // releases the hold on the very next frame with no state to unwind. The
    // one thing a hold must never outlast is a fixture leaving the world —
    // update() already withholds the flag for a frame in which candidates
    // changed, because a light burning over a demolished lamppost is worse
    // than any amount of ranking churn. And a rig that has never ranked has
    // nothing to hold.
    const holdAssignment = freezeAssignment && this._fixtureRankCache.length > 0;

    // --- 1. rank ---------------------------------------------------------
    let rankDirty = !holdAssignment && (this._fixtureRankDirty
      || camPos.x !== this._fixtureRankFocus[0]
      || camPos.y !== this._fixtureRankFocus[1]
      || camPos.z !== this._fixtureRankFocus[2]
      || camera !== this._fixtureRankCamera);
    const world = camera?.matrixWorld?.elements;
    const projection = camera?.projectionMatrix?.elements;
    if (!holdAssignment && !rankDirty && world && projection) {
      for (let i = 0; i < 16; i++) {
        if (world[i] !== this._fixtureRankWorld[i]
          || projection[i] !== this._fixtureRankProjection[i]) {
          rankDirty = true;
          break;
        }
      }
    }
    if (rankDirty) {
      this._fixtureRankDirty = false;
      this._fixtureRankFocus[0] = camPos.x;
      this._fixtureRankFocus[1] = camPos.y;
      this._fixtureRankFocus[2] = camPos.z;
      this._fixtureRankCamera = camera;
      if (world && projection) {
        this._fixtureRankWorld.set(world);
        this._fixtureRankProjection.set(projection);
      }
      this._fixtureRankCache = this._rankCandidates(
        this._fixtureCandidates,
        camPos,
        (obj) => obj.def?.light?.poolRadius ?? obj.def?.light?.radius ?? 1,
      );
    }
    const ranked = this._fixtureRankCache;
    if (!holdAssignment) this._assignSlots(ranked, n);

    // --- 4. crossfade + publish ------------------------------------------
    this._advanceSpotCrossfades(n, dtMs, nightFactor);
  }

  /**
   * Steps 2 and 3 of the handover: release incumbents that have genuinely
   * fallen out of the pool, then fill the slots that frees. Split out of
   * _assignSpots so a camera animation can hold it while the crossfade in
   * _advanceSpotCrossfades keeps running.
   */
  _assignSlots(ranked, n) {
    const pool = new Set();
    for (let i = 0; i < Math.min(n, ranked.length); i++) pool.add(ranked[i].obj);
    const slackPool = new Set(pool);
    for (let i = n; i < Math.min(n + SPOT_RANK_SLACK, ranked.length); i++) {
      slackPool.add(ranked[i].obj);
    }

    // --- 2. incumbents ---------------------------------------------------
    // A fixture that has left the scene entirely (demolished, or its group
    // detached) is a different case from one that merely lost its ranking,
    // and must NOT wait out SPOT_MIN_HOLD_MS. The minimum tenure exists to
    // damp churn in the *ranking* — it is not a reason to keep a spot burning
    // over a lamppost the player just knocked down, which would hang a light
    // in the air at the demolished fixture's last world position for over a
    // second. Ranked only ever contains live candidates, so absence from
    // `present` is exactly "gone".
    const present = new Set(this._fixtureCandidates);
    const held = new Set();
    for (let si = 0; si < n; si++) {
      const slot = this._spotSlots[si];
      if (!slot.assignedRef) continue;
      if (slot.releasing && slot.weight <= 0) {
        // The fade finished on a previous frame; only now is the slot free.
        slot.assignedRef = null;
        slot.releasing = false;
        continue;
      }
      if (slot.releasing) {
        if (pool.has(slot.assignedRef)) {
          slot.releasing = false;      // climbed back in — fade straight back up
          slot.heldSinceMs = this._clockMs;
        }
      } else if (!present.has(slot.assignedRef)) {
        slot.releasing = true;         // gone from the scene — release now
      } else if (!slackPool.has(slot.assignedRef)
                 && (this._clockMs - slot.heldSinceMs) >= SPOT_MIN_HOLD_MS) {
        slot.releasing = true;
      }
      held.add(slot.assignedRef);
    }

    // --- 3. fill free slots ----------------------------------------------
    let next = 0;
    for (let si = 0; si < n; si++) {
      const slot = this._spotSlots[si];
      if (slot.assignedRef) continue;
      while (next < ranked.length && held.has(ranked[next].obj)) next++;
      if (next >= ranked.length || !pool.has(ranked[next].obj)) break;
      slot.assignedRef = ranked[next].obj;
      slot.releasing = false;
      slot.heldSinceMs = this._clockMs;
      held.add(ranked[next].obj);
      next++;
    }
  }

  /**
   * Step 4: advance every slot's crossfade weight and publish the pool
   * suppression that pairs with it. Runs every frame, including while the
   * assignment above is held, so a handover already in flight completes.
   */
  _advanceSpotCrossfades(n, dtMs, nightFactor) {
    const nextSuppression = this._nextFixtureSuppression;
    nextSuppression.clear();
    const step = SPOT_CROSSFADE_MS > 0 ? dtMs / SPOT_CROSSFADE_MS : 1;
    for (let si = 0; si < n; si++) {
      const slot = this._spotSlots[si];
      if (!slot.assignedRef) {
        slot.weight = 0;
        slot.light.intensity = 0;
        if (!slot.castsShadow) slot.light.visible = si === this._shadowSpotCount;
        continue;
      }
      if (slot.releasing) {
        slot.weight = Math.max(0, slot.weight - step);
        // Snap the float dust off the end of the ramp — 1 - 5*0.2 lands on
        // ~5e-17, and a weight that never reaches exactly 0 would keep the
        // slot held forever and keep the pool imperceptibly suppressed.
        if (slot.weight < 1e-9) slot.weight = 0;
      } else {
        slot.weight = Math.min(1, slot.weight + step);
      }
      const fx = slot.assignedRef;
      const tag = fx.def
        ? fixtureLightTag(fx.def, { id: fx.id, dir: 0 })
        : (fx.userData.lightFixture || {});
      if (fx.def) {
        // The registry carries the rendered group's actual rotation. Use it
        // directly so a rotated flood's real cone and painted ellipse agree.
        tag.aimYaw = fx.group.rotation?.y || 0;
      }
      this._applyFixtureSpot(slot, tag, nightFactor, fx.def || null);
      if (tag.id != null) {
        const prev = nextSuppression.get(tag.id) ?? 0;
        nextSuppression.set(tag.id, Math.max(prev, slot.weight));
      }
    }
    let suppressionChanged = nextSuppression.size !== this._fixtureSuppression.size;
    if (!suppressionChanged) {
      for (const [id, weight] of nextSuppression) {
        if (this._fixtureSuppression.get(id) !== weight) {
          suppressionChanged = true;
          break;
        }
      }
    }
    if (suppressionChanged) {
      this._fixtureSuppression.clear();
      for (const [id, weight] of nextSuppression) this._fixtureSuppression.set(id, weight);
      this._fixtureSuppressionRevision++;
    }
  }

  _parkSpot(index) {
    const slot = this._spotSlots[index];
    if (!slot) return;
    slot.light.intensity = 0;
    slot.light.shadow.needsUpdate = false;
    // DynamicLighting explicitly supports count changes without recompiling.
    // Keep one zero-intensity tail light visible so its SpotLight data node is
    // prewarmed even in an empty facility; all other parked tail slots vanish
    // from the GPU loop entirely.
    if (!slot.castsShadow) slot.light.visible = index === this._shadowSpotCount;
    slot.assignedRef = null;
    slot.weight = 0;
    slot.releasing = false;
    slot.projection = null;
    this._shadowAssignmentKeys[index] = null;
  }

  _scheduleShadows(nightFactor, dtMs) {
    const hasLitFixture = this._spotSlots.some((slot, index) =>
      index < this._activeShadowSpotCount && slot.assignedRef && slot.light.intensity > 0.01);
    for (let i = 0; i < this._shadowSpotCount; i++) {
      const slot = this._spotSlots[i];
      slot.light.shadow.needsUpdate = false;
      this._shadowAssignmentKeys[i] = i < this._activeShadowSpotCount
        && slot.assignedRef && slot.light.intensity > 0
        ? (slot.assignedRef.id ?? slot.assignedRef.userData?.lightFixture?.id ?? slot.assignedRef.uuid ?? i)
        : null;
    }
    const updates = this._shadowScheduler.step({
      activeCount: this._activeShadowSpotCount,
      enabled: this._enabled && hasLitFixture,
      dtMs,
      assignmentKeys: this._shadowAssignmentKeys,
    });
    for (const index of updates) this._spotSlots[index].light.shadow.needsUpdate = true;
    this._shadowUpdatesLastFrame = updates.length;
  }

  /**
   * Point one spot at one fixture. Reads only the pure tag
   * (lighting-builder.js's fixtureLightTag) plus the object's world position,
   * so a def's own radius/cone/tilt drive the real light instead of the
   * generic tuning constants — a bollard and a high-mast should not throw the
   * same beam.
   */
  _applyFixtureSpot(slot, tag, nightFactor, authoredDef = null) {
    const light = slot.light;
    light.visible = true;
    const p = this._worldPos(slot.assignedRef);
    const def = authoredDef || {
      mount: tag.mount || 'ground',
      light: {
        emitterY: tag.emitterY ?? tag.offsetY ?? 0,
        dayFloor: tag.dayFloor ?? 0,
        sourceOffsetX: tag.sourceOffsetX ?? 0,
        sourceOffsetZ: tag.sourceOffsetZ ?? 0,
        sourceOffsetY: tag.sourceOffsetY ?? 0,
        radius: tag.poolRadius ?? tag.radius ?? 0,
        shape: tag.shape,
        coneDeg: tag.coneDeg,
        beamAngleDeg: tag.beamAngleDeg,
        targetDistance: tag.targetDistance || undefined,
        maxGroundRange: tag.maxGroundRange || undefined,
        penumbra: tag.penumbra,
        sourceRadius: tag.sourceRadius,
        shadowSoftness: tag.shadowSoftness,
        dynamicProfile: tag.dynamicProfile,
        cookieProfile: tag.cookieProfile,
      },
    };
    const projection = fixtureLightProjection(def, {
      origin: { x: p.x, y: p.y, z: p.z },
      yaw: tag.aimYaw || 0,
      floorY: slot.assignedRef?.floorY,
    });

    light.position.set(projection.emitter.x, projection.emitter.y, projection.emitter.z);
    // Setting light.distance is the correct way to move SpotLightShadow's far
    // plane; Three observes it and refreshes the projection matrix itself.
    light.distance = projection.distance || FIXTURE_SPOT_DISTANCE;
    light.angle = projection.halfAngle || FIXTURE_SPOT_ANGLE;
    light.penumbra = projection.penumbra;
    if (slot.castsShadow) {
      light.shadow.radius = 1 + 3 * Math.max(0, Math.min(1, tag.shadowSoftness ?? 0.5));
    }
    // Fit bias to this cone's world-space texel size. A single fixed bias is
    // either too large for desk lights (floating shadows) or too small for a
    // high mast (acne); this keeps contact shadows stable across both.
    const shadowTexel = projection.distance / Math.max(128, this._shadowMapSize);
    if (slot.castsShadow) {
      light.shadow.bias = -Math.max(0.00035, Math.min(0.0015, shadowTexel * 0.12));
      light.shadow.normalBias = Math.max(0.004, Math.min(0.025, shadowTexel * 1.8));
      light.shadow.camera.near = Math.max(0.035, Math.min(0.15, projection.distance * 0.025));
    }
    slot.target.position.set(projection.target.x, projection.target.y, projection.target.z);
    slot.target.updateMatrixWorld();

    light.color.set(tag.color != null ? tag.color : DEFAULT_FIXTURE_COLOR);
    const dynamicFactor = fixtureDynamicFactor(
      tag.dynamicProfile, tag.id, this._effectTimeMs, nightFactor,
    );
    const activation = fixtureActivationFactor(def, nightFactor, {
      indoors: slot.assignedRef?.indoors === true,
    });
    if (slot.castsShadow) {
      const cookie = getLightCookie(tag.cookieProfile || 'soft');
      if (cookie) light.map = cookie;
    }
    light.intensity = FIXTURE_SPOT_INTENSITY * (tag.intensity ?? 1)
      * activation * slot.weight * dynamicFactor;
    slot.projection = projection;
  }

  _assignPoints(camPos, nightFactor) {
    // The head of the pool is the ambient glow's to claim; the tail
    // (_flashReserve slots) is kept idle for flash() — see the constructor's
    // note on why an explosion must not have to steal a lit console.
    const ambientLimit = Math.max(0, this._pointCount - this._flashReserve);
    const freeSlots = [];
    for (let i = 0; i < this._pointSlots.length; i++) {
      const s = this._pointSlots[i];
      if (s.flash) continue;
      if (i < ambientLimit) { freeSlots.push(s); continue; }
      s.light.intensity = 0;
      s.assignedRef = null;
    }
    const candidates = this._effectEmitterRegistry.length
      ? this._glowCandidates.concat(this._effectEmitterRegistry)
      : this._glowCandidates;
    const ranked = this._rankCandidates(candidates, camPos);
    const rankByObject = new Map(ranked.map((entry, index) => [entry.obj, { ...entry, index }]));
    const keepThrough = Math.min(ranked.length, freeSlots.length + POINT_RANK_SLACK);
    const claimed = new Set();

    // Preserve assignments while they remain visible and near the active
    // band. Tiny camera changes therefore do not make point lights jump among
    // otherwise-equivalent emitters.
    for (const slot of freeSlots) {
      const entry = rankByObject.get(slot.assignedRef);
      if (entry && entry.visible && entry.index < keepThrough) claimed.add(slot.assignedRef);
      else { slot.assignedRef = null; slot.light.intensity = 0; }
    }
    let next = 0;
    for (const slot of freeSlots) {
      if (slot.assignedRef) continue;
      while (next < ranked.length && (!ranked[next].visible || claimed.has(ranked[next].obj))) next++;
      const entry = ranked[next++];
      if (!entry || !entry.visible) continue;
      slot.assignedRef = entry.obj;
      claimed.add(entry.obj);
    }

    for (const slot of freeSlots) {
      const mesh = slot.assignedRef;
      if (!mesh) continue;
      const p = this._worldPos(mesh);
      // Moving effect proxies carry authored throw/tint/intensity. A glow-role
      // mesh has none and falls back to the tuned console-light constants.
      const utilityEmitter = mesh.userData && mesh.userData.effectLightEmitter;
      slot.light.distance = utilityEmitter?.distance ?? AMBIENT_POINT_DISTANCE;
      slot.light.decay = AMBIENT_POINT_DECAY;
      slot.light.position.set(p.x, p.y, p.z);
      const emissive = mesh.material && mesh.material.emissive;
      if (utilityEmitter?.color != null) slot.light.color.set(utilityEmitter.color);
      else if (emissive) slot.light.color.copy(emissive);
      else slot.light.color.set(DEFAULT_GLOW_LIGHT_COLOR);
      const daylightFloor = Math.max(0, Math.min(1, Number(utilityEmitter?.daylightFloor) || 0));
      const darknessScale = utilityEmitter?.preScaled
        ? 1 : daylightFloor + (1 - daylightFloor) * nightFactor;
      slot.light.intensity = AMBIENT_POINT_INTENSITY
        * (utilityEmitter?.intensity ?? 1) * darknessScale;
    }
  }

  _advanceFlashes(dtMs) {
    for (const slot of this._pointSlots) {
      const f = slot.flash;
      if (!f) continue;
      f.elapsedMs += dtMs;
      const t = Math.min(1, f.durationMs > 0 ? f.elapsedMs / f.durationMs : 1);
      // Ease-out decay: falls fast off the initial pop, tail lingers — an
      // explosion's flash, not a linear fade.
      const factor = (1 - t) * (1 - t);
      slot.light.intensity = f.baseIntensity * factor;
      if (t >= 1) {
        slot.flash = null;
        slot.light.intensity = 0;
        slot.assignedRef = null;
        slot.lastUsedAt = this._clockMs; // idle countdown starts now that it's free
      }
    }
  }

  _pickFlashSlot() {
    // Prefer the RESERVED TAIL — those slots are held idle precisely so a
    // flash never has to darken an ambient glow. Only when the reserve is
    // saturated does a flash spill into the ambient head, and only then can it
    // take a lit console away. Within each band: oldest-idle first — a slot
    // that has never flashed carries lastUsedAt = -Infinity, so a cold rig
    // fills its flash pool front-to-back before reusing anything.
    const ambientLimit = Math.max(0, this._pointCount - this._flashReserve);
    const oldestIdle = (from, to) => {
      let best = null;
      for (let i = from; i < to && i < this._pointSlots.length; i++) {
        const s = this._pointSlots[i];
        if (s.flash) continue;
        if (!best || s.lastUsedAt < best.lastUsedAt) best = s;
      }
      return best;
    };
    const reserved = oldestIdle(ambientLimit, this._pointSlots.length);
    if (reserved) return reserved;
    const ambient = oldestIdle(0, ambientLimit);
    if (ambient) return ambient;
    // Every slot is mid-flash: steal the dimmest one right now, not the one
    // closest to finishing — interrupting always kills the least-noticeable
    // burst rather than the one that was about to end anyway.
    let dimmest = this._pointSlots[0];
    for (const s of this._pointSlots) {
      if (s.light.intensity < dimmest.light.intensity) dimmest = s;
    }
    return dimmest;
  }
}

export default LightRig;
