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
//   - "fixtures": placed decorations tagged userData.lightFixture = { offsetY,
//     color } at build time (decoration-builder.js's _lamppost is the first —
//     see its comment for why the tag lives on the group returned there).
//     These get the 4 shadow-casting SpotLights, pointed straight down.
//   - "glow" meshes: userData.role === 'glow' (component-builder.js's screens
//     / indicator lamps / hot cathodes). These get the 8 non-shadow
//     PointLights, so equipment that's already emissive under bloom also
//     throws a little real light on what's next to it.
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
   * @param {boolean} [opts.enabled=true]
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this._enabled = opts.enabled !== undefined ? !!opts.enabled : true;
    this._shadowSpotCount = opts.shadowSpotCount ?? 4;
    this._pointCount = opts.pointCount ?? 8;
    this._shadowMapSize = opts.shadowMapSize ?? 1024;

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
      this._spotSlots.push({ light, target, assignedRef: null });
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
      for (const s of this._spotSlots) { s.light.intensity = 0; s.assignedRef = null; }
      for (const p of this._pointSlots) {
        p.light.intensity = 0; p.assignedRef = null; p.flash = null;
      }
    }
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

    const camPos = (camera && camera.position) ? camera.position : this._tmpWorld.set(0, 0, 0);
    const nf = Number.isFinite(nightFactor) ? Math.max(0, Math.min(1, nightFactor)) : 0;
    this._assignSpots(camPos, nf);
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

  _assignSpots(camPos, nightFactor) {
    const n = this._spotSlots.length;
    const ranked = this._fixtureCandidates
      .map((obj) => ({ obj, dist: this._worldPos(obj).distanceTo(camPos) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, n);
    for (let i = 0; i < n; i++) {
      const slot = this._spotSlots[i];
      const cand = ranked[i];
      if (!cand) {
        slot.light.intensity = 0;
        slot.assignedRef = null;
        continue;
      }
      const fx = cand.obj.userData.lightFixture || {};
      const p = this._worldPos(cand.obj);
      const lx = p.x, ly = p.y + (fx.offsetY || 0), lz = p.z;
      slot.light.position.set(lx, ly, lz);
      slot.target.position.set(lx, 0, lz); // straight down — fixtures point down, per the brief
      slot.target.updateMatrixWorld();
      slot.light.color.set(fx.color != null ? fx.color : DEFAULT_FIXTURE_COLOR);
      slot.light.intensity = FIXTURE_SPOT_INTENSITY * nightFactor;
      slot.assignedRef = cand.obj;
    }
  }

  _assignPoints(camPos, nightFactor) {
    const freeSlots = this._pointSlots.filter((s) => !s.flash);
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
    // Prefer a slot that isn't currently flashing, oldest-idle first — a
    // slot that has never flashed carries lastUsedAt = -Infinity, so a cold
    // rig always fills its flash pool front-to-back before reusing anything.
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
