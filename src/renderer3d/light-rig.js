// src/renderer3d/light-rig.js
//
// Real THREE lights, for the two things bloom/emissive materials can't fake:
// a lamppost casting an actual shadow, and an explosion actually brightening
// the wall behind it. Everything else (pipes glowing, screens glowing) stays
// on bloom (glow-pipeline.js) — this module is deliberately small.
//
// THE GOVERNING CONSTRAINT: adding or removing a light from a three.js scene
// forces a shader recompile across every lit material in the scene — a
// visible hitch. So every light here is allocated ONCE, at construction,
// parked at intensity 0, added to the scene exactly once, and never removed
// until dispose() tears the whole rig down. Every frame after that only ever
// MOVES, RETINTS, and FADES existing lights — including explosion flashes,
// which steal a parked slot rather than allocating a new light. This is what
// makes a 12-light rig (4 shadow spots + 8 plain points) plus on-demand
// flashes affordable: verify by watching renderer.info.programs.length while
// panning/flashing — it must not climb.
//
// Two emitter sources feed the rig, both found by tag rather than a separate
// registry (mirrors Task 3's userData.role === 'glow' ruling):
//   - "fixtures": placed lighting decorations tagged with
//     userData.lightFixture = lighting-builder.js's fixtureLightTag(def, {id,
//     dir}) at build time. DecorationBuilder.build() is the one and only site
//     that stamps it; the tag carries the fixture's real def-driven aim,
//     cone angle, throw and colour, so this module never imports the def
//     schema. These get the shadow-casting SpotLights.
//   - "glow" meshes: userData.role === 'glow' (component-builder.js's screens
//     / indicator lamps / hot cathodes). These get the non-shadow
//     PointLights, so equipment that's already emissive under bloom also
//     throws a little real light on what's next to it.
//
// THE LOD RELATIONSHIP WITH THE PAINTED POOLS (lighting-builder.js): every
// fixture gets a cheap painted floor pool, always. Only the nearest few get a
// real spot on top — and a fixture holding a real spot must have its painted
// pool faded out, or the same floor is lit twice. This module is the
// AUTHORITY on who holds a spot: it publishes a 0..1 weight per fixture id
// via getFixtureSuppression(), and the pool side consumes it
// (lighting-builder.js's applyPoolSuppression). The weight crossfades rather
// than switching, so spot intensity (×weight) and pool alpha (×1-weight) sum
// to roughly constant through a handover and the swap is not a visible pop.
// The failure mode this defends against is FLICKER at the LOD boundary, not
// brightness: see SPOT_RANK_SLACK / SPOT_MIN_HOLD_MS below.
//
// SpotLight over PointLight for fixtures: a shadow-casting PointLight needs a
// CUBE shadow map — six render passes per light per frame. A SpotLight needs
// one 2D map, and lampposts/wall lights point down anyway, so a spot is both
// cheaper and more truthful about the fixture. Shadow map size is 1024, not
// the sun's 4096 (ThreeRenderer._sunLight) — that's a global map covering the
// whole facility; these are small pools of light around one fixture each, and
// six of them at 4096 would be the actual "unshippable" scenario the task
// brief warns about.
//
// THREE is loaded as a CDN global (src/three-global.js) — do NOT import it.

// ---- Tuning constants ------------------------------------------------------
//
// renderer.toneMapping is left at three's default (NoToneMapping — see
// ThreeRenderer.js, which never sets it, and this task is forbidden from
// changing it) and outputColorSpace is untouched too, so there is no HDR
// tone-compression softening these values: anything too hot clips straight to
// white. Kept modest for that reason, in the same "start conservative, tune
// by eye" spirit as glow-pipeline.js's DEFAULT_STRENGTH/RADIUS/THRESHOLD —
// these are a first pass, not a measured result (nobody watched this render;
// see task-5-report.md).
const FIXTURE_SPOT_INTENSITY = 6;
const FIXTURE_SPOT_DISTANCE = 7;     // metres — a lamppost's real throw, not the whole yard
const FIXTURE_SPOT_ANGLE = Math.PI / 5.5; // half-angle; a downward cast, not a wide floodlight
const FIXTURE_SPOT_PENUMBRA = 0.55;  // soft cone edge — matches the pixel-scale render, not a hard theatrical spot
const FIXTURE_SPOT_DECAY = 2;        // physically-based inverse-square falloff (three's default)
const DEFAULT_FIXTURE_COLOR = 0xffc864; // warm sodium-lamp tint — matches decoration-builder.js's lamppost glow material

// ---- LOD hysteresis + crossfade -------------------------------------------
//
// "Nearest N" has no fixed distance threshold to put a deadband around, so
// the hysteresis is on RANK: an incumbent keeps its slot until it has fallen
// SPOT_RANK_SLACK places past the pool size. Two fixtures at nearly equal
// distance would otherwise trade the same slot every frame as the camera
// drifts, and each trade is a visible pop between "real shadow" and "painted
// pool". SPOT_MIN_HOLD_MS is the second axis: even a fixture that clearly
// lost the ranking keeps its slot for at least this long, which bounds the
// swap rate no matter how fast the camera moves. Both are measured on the
// rig's own dt-driven _clockMs, never performance.now() — this module stays
// testable without real timers.
const SPOT_RANK_SLACK = 2;
const SPOT_MIN_HOLD_MS = 1200;
// Crossfade duration for the suppression weight, in ms. Long enough that a
// residual boundary swap reads as a dissolve rather than a switch, short
// enough that a released slot frees up promptly (a slot stays claimed by its
// outgoing fixture until the weight hits 0 — otherwise that fixture would be
// lit by neither system for the length of the fade).
const SPOT_CROSSFADE_MS = 250;
const DEG2RAD = Math.PI / 180;
// three clamps SpotLight.angle to <= PI/2; stay just inside it so a
// coneDeg: 180 def can't produce a degenerate shadow frustum.
const MAX_SPOT_HALF_ANGLE = Math.PI / 2 - 0.01;

const AMBIENT_POINT_INTENSITY = 3;
const AMBIENT_POINT_DISTANCE = 4.5;  // short throw — this is "the screen lights its own console", not room lighting
const AMBIENT_POINT_DECAY = 2;
const DEFAULT_GLOW_LIGHT_COLOR = 0x40e0ff; // llrfController's screen tint (component-builder.js) — a reasonable fallback

const FLASH_POINT_DISTANCE = 10;     // an explosion's throw is bigger than a console's ambient glow
const FLASH_POINT_DECAY = 2;
const DEFAULT_FLASH_DURATION_MS = 600;

export class LightRig {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts]
   * @param {number} [opts.shadowSpotCount=4] fixture pool size — shadow-casting
   * @param {number} [opts.pointCount=8] non-shadow pool size — ambient glow + flashes
   * @param {number} [opts.shadowMapSize=1024] one dial for the whole spot pool,
   *        so a frame-budget complaint is a one-line change, not a rewrite.
   * @param {number} [opts.flashReserve=2] how many of the point slots ambient
   *        glow assignment is never allowed to claim. Without a reserve the
   *        two consumers of that pool fight: ambient glow fills every slot,
   *        so an explosion has to steal one — and an explosion big enough to
   *        need several can strip every ambient light out of the very scene
   *        it is lighting. Reserving a couple means the common case (one or
   *        two concurrent flashes) never steals at all, and ambient keeps
   *        pointCount - flashReserve slots permanently. Flashes may still
   *        overflow into the ambient region when the reserve is saturated —
   *        a barrage of explosions SHOULD outrank a console screen.
   * @param {boolean} [opts.enabled=true]
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this._enabled = opts.enabled !== undefined ? !!opts.enabled : true;
    this._shadowSpotCount = opts.shadowSpotCount ?? 4;
    this._pointCount = opts.pointCount ?? 8;
    this._shadowMapSize = opts.shadowMapSize ?? 1024;
    this._flashReserve = Math.max(0, Math.min(this._pointCount, opts.flashReserve ?? 2));

    // Internal clock, advanced by the dt passed to update() — not
    // performance.now(). Keeps "how long has this slot been idle" testable
    // without real timers, and ties flash decay to the same dt the rest of
    // the frame (tickFlow, staffPawns.update) already uses.
    this._clockMs = 0;

    // ---- The fixture pool: shadow-casting spots, allocated once ----------
    this._spotSlots = [];
    for (let i = 0; i < this._shadowSpotCount; i++) {
      const light = new THREE.SpotLight(
        DEFAULT_FIXTURE_COLOR, 0, FIXTURE_SPOT_DISTANCE,
        FIXTURE_SPOT_ANGLE, FIXTURE_SPOT_PENUMBRA, FIXTURE_SPOT_DECAY,
      );
      light.castShadow = true;
      light.shadow.mapSize.set(this._shadowMapSize, this._shadowMapSize);
      light.shadow.camera.near = 0.2;
      light.shadow.camera.far = FIXTURE_SPOT_DISTANCE;
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
      // fixtureId/weight/releasing/heldSinceMs are the LOD state machine:
      //   assignedRef  the fixture group this slot is currently bound to
      //   fixtureId    that fixture's placeable id — what the pool side keys on
      //   weight       0..1 crossfade; 1 = spot fully on, pool fully suppressed
      //   releasing    true once the slot has lost its ranking; it keeps its
      //                fixture (and keeps fading) until weight hits 0, and
      //                only then becomes free for someone else
      //   heldSinceMs  _clockMs at claim time, for SPOT_MIN_HOLD_MS
      this._spotSlots.push({
        light, target, assignedRef: null, fixtureId: null,
        weight: 0, releasing: false, heldSinceMs: -Infinity,
      });
    }

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
    // refresh — every game event does this today (ThreeRenderer wires it in
    // next to the existing _portMarkersDirty flag), so a static facility
    // costs one traversal total, not one per frame. Ranking + slot
    // assignment still runs every update() call (cheap: these arrays are a
    // handful to a few dozen entries, not the whole scene).
    this._fixtureCandidates = [];
    this._glowCandidates = [];
    this._candidatesDirty = true;

    this._tmpWorld = new THREE.Vector3();
    this._tmpTarget = new THREE.Vector3();
    // Separate from _tmpWorld on purpose: _worldPos() reuses _tmpWorld for
    // every candidate, so a camera-less fallback that aliased it would have
    // its "origin" overwritten by the first fixture measured against it, and
    // every distance after that would be garbage.
    this._tmpCam = new THREE.Vector3();

    // Published suppression weights, rebuilt in place once per _assignSpots.
    // Deliberately one long-lived Map rather than a fresh allocation per
    // frame — _updateLightingRamp reads it every rAF.
    this._suppression = new Map();
  }

  get enabled() {
    return this._enabled;
  }

  /** Invalidate the cached candidate lists — call on any world event that may
   * have placed/removed a fixture or a glow-role mesh. Traversal itself is
   * deferred to the next update() call, not run here. */
  markDirty() {
    this._candidatesDirty = true;
  }

  setEnabled(v) {
    this._enabled = !!v;
    if (!this._enabled) {
      // Zero immediately rather than waiting for the next update() — the
      // Options toggle should kill every light (and any flash in flight) on
      // the frame it's clicked, not fade out over the next tick.
      for (const s of this._spotSlots) {
        s.light.intensity = 0; s.assignedRef = null; s.fixtureId = null;
        s.weight = 0; s.releasing = false;
      }
      for (const p of this._pointSlots) {
        p.light.intensity = 0; p.assignedRef = null; p.flash = null;
      }
      // No spots means nothing to suppress: every painted pool comes straight
      // back on the same frame the real lights go away. Crossfading here
      // would be wrong — the player asked for the feature to be OFF.
      this._suppression.clear();
    }
  }

  /**
   * Per-fixture suppression weights: fixture id -> 0..1, where 1 means "this
   * fixture is fully served by a real spot, so its painted pool must be fully
   * off". Ids absent from the map are unsuppressed.
   *
   * The rig is authoritative here (see this file's header) — the pool side
   * only reads. The returned Map is the rig's own, rebuilt in place every
   * update(); callers must not mutate or retain it across frames.
   * @returns {Map<*, number>}
   */
  getFixtureSuppression() {
    return this._suppression;
  }

  /**
   * @param {THREE.Camera} camera used only for its .position — see the
   *        implementation note in _rankByDistance for why that's an accepted
   *        stand-in for the true pan target with this game's fixed-offset
   *        isometric camera.
   * @param {number} nightFactor 0 (full day — fixtures dark) .. 1 (full
   *        night — fixtures at full intensity). NOT the same curve as
   *        component-builder.js's glow-role factor, which floors at 0.35 so
   *        screens never go fully dark at noon — a lit lamppost at noon is
   *        just silly, so fixtures (and the ambient glow pool) go all the
   *        way to 0.
   * @param {number} dt seconds since the last call.
   */
  update(camera, nightFactor, dt) {
    const dtMs = Number.isFinite(dt) && dt > 0 ? dt * 1000 : 0;
    this._clockMs += dtMs;
    this._advanceFlashes(dtMs);

    if (!this._enabled) {
      // Flashes were already cleared by setEnabled(false); nothing to do
      // here except keep the ambient pool at zero every frame the toggle is
      // off (a newly-placed lamppost mustn't light itself up mid-toggle).
      for (const s of this._spotSlots) s.light.intensity = 0;
      for (const p of this._pointSlots) if (!p.flash) p.light.intensity = 0;
      return;
    }

    if (this._candidatesDirty) {
      this._refreshCandidates();
      this._candidatesDirty = false;
    }

    const camPos = (camera && camera.position) ? camera.position : this._tmpCam.set(0, 0, 0);
    const nf = Number.isFinite(nightFactor) ? Math.max(0, Math.min(1, nightFactor)) : 0;
    this._assignSpots(camPos, nf, dtMs);
    this._assignPoints(camPos, nf);
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
    for (const s of this._spotSlots) {
      if (s.light.shadow && s.light.shadow.map) s.light.shadow.map.dispose();
      this.scene.remove(s.target);
      this.scene.remove(s.light);
    }
    for (const p of this._pointSlots) {
      this.scene.remove(p.light);
    }
    this._spotSlots = [];
    this._pointSlots = [];
    this._fixtureCandidates = [];
    this._glowCandidates = [];
    // No spots left to suppress anything — a stale weight surviving teardown
    // would leave a pool permanently faded on the next renderer.
    this._suppression.clear();
  }

  // ---- internals ------------------------------------------------------

  _refreshCandidates() {
    const fixtures = [];
    const glows = [];
    this.scene.traverse((obj) => {
      if (obj.userData && obj.userData.lightFixture) fixtures.push(obj);
      else if (obj.isMesh && obj.userData && obj.userData.role === 'glow') glows.push(obj);
    });
    this._fixtureCandidates = fixtures;
    this._glowCandidates = glows;
  }

  // Ranks by distance to `camPos`, which is camera.position rather than the
  // true pan target the isometric camera looks at (ThreeRenderer keeps the
  // camera at a FIXED offset from that target — see its _panX/_panY-driven
  // camera.position.set calls). This is a budget allocator picking "roughly
  // the nearest N", not a precision computation: the fixed offset (tens of
  // units) barely perturbs relative ordering among candidates spread across
  // one facility, and update()'s signature only carries `camera` anyway.
  _worldPos(obj) {
    return obj.getWorldPosition(this._tmpWorld);
  }

  /**
   * The LOD allocator. Runs in four passes so that "who keeps a slot" is
   * decided before "who gets a free one", and the crossfade is applied last
   * to whatever the first three passes settled on.
   */
  _assignSpots(camPos, nightFactor, dtMs) {
    const slots = this._spotSlots;
    const n = slots.length;

    // Pass 0 — rank every candidate by camera distance. Rank, not distance,
    // is what the hysteresis is expressed in (see SPOT_RANK_SLACK).
    const ranked = this._fixtureCandidates
      .map((obj) => ({ obj, dist: this._worldPos(obj).distanceTo(camPos) }))
      .sort((a, b) => a.dist - b.dist);
    const rankOf = new Map();
    for (let i = 0; i < ranked.length; i++) rankOf.set(ranked[i].obj, i);

    // Pass 1 — incumbents. A slot loses its fixture only when the fixture has
    // fallen SPOT_RANK_SLACK places past the pool AND has been held at least
    // SPOT_MIN_HOLD_MS. A fixture that vanished from the scene entirely is
    // released regardless of how recently it was claimed.
    for (const slot of slots) {
      if (!slot.assignedRef) continue;
      const rank = rankOf.get(slot.assignedRef);
      if (rank === undefined) { slot.releasing = true; continue; }
      const heldLongEnough = (this._clockMs - slot.heldSinceMs) >= SPOT_MIN_HOLD_MS;
      if (rank < n + SPOT_RANK_SLACK || !heldLongEnough) {
        // Un-release: a fixture that dropped out and climbed back inside the
        // pool before its fade finished resumes from its current weight
        // rather than restarting at 0 — that partial fade is exactly the
        // thrash the hysteresis exists to hide.
        if (slot.releasing && rank < n) slot.releasing = false;
      } else {
        slot.releasing = true;
      }
    }

    // Pass 2 — fill genuinely free slots from the top of the ranking. A
    // releasing slot still has assignedRef set and is NOT free: handing it to
    // someone else mid-fade would leave the outgoing fixture lit by neither
    // system (its pool is still faded down) for the rest of the crossfade.
    const claimed = new Set();
    for (const s of slots) if (s.assignedRef) claimed.add(s.assignedRef);
    for (const slot of slots) {
      if (slot.assignedRef) continue;
      let cand = null;
      for (let i = 0; i < ranked.length && i < n; i++) {
        if (!claimed.has(ranked[i].obj)) { cand = ranked[i]; break; }
      }
      if (!cand) break;
      claimed.add(cand.obj);
      slot.assignedRef = cand.obj;
      slot.fixtureId = (cand.obj.userData.lightFixture || {}).id ?? null;
      slot.weight = 0;
      slot.releasing = false;
      slot.heldSinceMs = this._clockMs;
    }

    // Pass 3 — advance the crossfade and push the result at the actual lights.
    const step = dtMs > 0 ? dtMs / SPOT_CROSSFADE_MS : 0;
    this._suppression.clear();
    for (const slot of slots) {
      if (!slot.assignedRef) {
        slot.light.intensity = 0;
        slot.weight = 0;
        slot.fixtureId = null;
        continue;
      }
      if (slot.releasing) {
        slot.weight = Math.max(0, slot.weight - step);
        if (slot.weight <= 0) {
          slot.assignedRef = null;
          slot.fixtureId = null;
          slot.releasing = false;
          slot.light.intensity = 0;
          continue;
        }
      } else {
        slot.weight = Math.min(1, slot.weight + step);
      }
      this._applyFixtureSpot(slot, nightFactor);
      if (slot.fixtureId != null) this._suppression.set(slot.fixtureId, slot.weight);
    }
  }

  /**
   * Point one slot's spot at its assigned fixture, entirely from the
   * fixtureLightTag the builder stamped — position, aim, cone angle, throw,
   * colour and intensity all come off the def, with this module's constants
   * only as fallbacks for a tag that predates a field.
   */
  _applyFixtureSpot(slot, nightFactor) {
    const fx = slot.assignedRef.userData.lightFixture || {};
    const p = this._worldPos(slot.assignedRef);
    const lx = p.x, ly = p.y + (fx.offsetY || 0), lz = p.z;
    slot.light.position.set(lx, ly, lz);

    // Throw distance from the def's own pool radius, so the real cone covers
    // the same patch of floor the painted pool it replaces would have.
    // NOTE: do NOT also write light.shadow.camera.far here. three's
    // SpotLightShadow.updateMatrices derives far from light.distance and only
    // calls camera.updateProjectionMatrix() when it sees far change — setting
    // far by hand makes that check pass silently and leaves the shadow
    // frustum's projection matrix stale (verified in three@0.160.0).
    const throwDist = fx.radius > 0 ? fx.radius : FIXTURE_SPOT_DISTANCE;
    slot.light.distance = throwDist;

    // Cone half-angle from the def's FULL coneDeg. Non-cone fixtures keep the
    // module default — a lamppost's def has no cone to read.
    slot.light.angle = fx.shape === 'cone' && fx.coneDeg > 0
      ? Math.min(MAX_SPOT_HALF_ANGLE, (fx.coneDeg * DEG2RAD) / 2)
      : FIXTURE_SPOT_ANGLE;

    // Aim. Everything unaimed points straight down (lampposts, bollards, high
    // bays — they all do). An aimed ground cone (floodLight) is tilted off
    // vertical by tiltDeg toward its placement yaw, so it lands in FRONT of
    // the fixture — matching poolFootprint's forward-pushed ellipse, which is
    // the very pool this spot suppresses.
    if (fx.aimed) {
      const tilt = (fx.tiltDeg || 0) * DEG2RAD;
      const yaw = fx.aimYaw || 0;
      // Same aim convention as lighting-builder.js's _aimVector: dir 0 points
      // along +x.
      const ax = Math.cos(yaw), az = -Math.sin(yaw);
      const reach = Math.sin(tilt) * throwDist;
      slot.target.position.set(lx + ax * reach, ly - Math.cos(tilt) * throwDist, lz + az * reach);
    } else {
      slot.target.position.set(lx, ly - throwDist, lz);
    }
    slot.target.updateMatrixWorld();

    slot.light.color.set(fx.color != null ? fx.color : DEFAULT_FIXTURE_COLOR);
    // ×weight is the crossfade half that pairs with the pool's ×(1-weight).
    slot.light.intensity = FIXTURE_SPOT_INTENSITY * (fx.intensity ?? 1) * nightFactor * slot.weight;
  }

  _assignPoints(camPos, nightFactor) {
    // The tail `_flashReserve` slots are off-limits to ambient glow (see the
    // constructor's flashReserve doc): keeping a couple permanently idle is
    // what lets flash() claim one without ever taking a light away from the
    // scene it is about to illuminate.
    const ambientPool = this._pointSlots.slice(0, this._pointSlots.length - this._flashReserve);
    const freeSlots = ambientPool.filter((s) => !s.flash);
    // A reserved slot that ambient can't use must still be dark when it isn't
    // flashing, or it would keep whatever a previous flash left behind.
    for (let i = ambientPool.length; i < this._pointSlots.length; i++) {
      const s = this._pointSlots[i];
      if (!s.flash) { s.light.intensity = 0; s.assignedRef = null; }
    }
    const ranked = this._glowCandidates
      .map((mesh) => ({ mesh, dist: this._worldPos(mesh).distanceTo(camPos) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, freeSlots.length);
    for (let i = 0; i < freeSlots.length; i++) {
      const slot = freeSlots[i];
      const cand = ranked[i];
      if (!cand) {
        slot.light.intensity = 0;
        slot.assignedRef = null;
        continue;
      }
      const p = this._worldPos(cand.mesh);
      slot.light.distance = AMBIENT_POINT_DISTANCE;
      slot.light.decay = AMBIENT_POINT_DECAY;
      slot.light.position.set(p.x, p.y, p.z);
      const emissive = cand.mesh.material && cand.mesh.material.emissive;
      if (emissive) slot.light.color.copy(emissive);
      else slot.light.color.set(DEFAULT_GLOW_LIGHT_COLOR);
      slot.light.intensity = AMBIENT_POINT_INTENSITY * nightFactor;
      slot.assignedRef = cand.mesh;
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
    // Reserved slots first — that's what they're for, and taking one costs
    // the scene nothing because ambient glow was never allowed to use it.
    const reserveStart = this._pointSlots.length - this._flashReserve;
    const reserved = this._pointSlots.filter((s, i) => i >= reserveStart && !s.flash);
    if (reserved.length > 0) {
      reserved.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
      return reserved[0];
    }
    // Reserve saturated — fall back to any slot that isn't currently
    // flashing, oldest-idle first. This is where a flash finally does displace
    // an ambient glow light, and that's the intended priority: several
    // simultaneous explosions outrank a console screen. A slot that has never
    // flashed carries lastUsedAt = -Infinity, so a cold rig always fills its
    // flash pool front-to-back before reusing anything.
    const idle = this._pointSlots.filter((s) => !s.flash);
    if (idle.length > 0) {
      idle.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
      return idle[0];
    }
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
