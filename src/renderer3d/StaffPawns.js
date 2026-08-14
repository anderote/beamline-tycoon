// src/renderer3d/StaffPawns.js — little walking 3D people for hired staff.
//
// Each hired StaffMember gets a low-poly figurine built by
// builders/staff-builder.js: a lit, shadow-casting THREE.Group of boxes and
// faceted prisms, in the same 3D scene as the machines. (These used to be flat
// camera-facing sprites with a hard black outline, which read as a completely
// different art style; that whole path — canvas frames, texture swapping,
// SpriteMaterial — is gone.)
//
// Appearance is seeded from the staff id so pawns look the same across frames
// and reloads. Skin, hair, coat and the per-role accents all come from the
// builder's palette for the active style — currently the RCT2 set, sampled from
// the real sprite sheets, where the role color is worn as a full uniform rather
// than as a collar sliver. Technicians and engineers wear hard hats. A ±4%
// per-staff height jitter keeps a crowd from looking cloned. The figure's design
// lives entirely in the builder's style config; this file renders whatever
// DEFAULT_STAFF_STYLE currently points at and never hardcodes a color.
//
// Movement now goes through the subtile navigator (src/game/staff/nav.js):
// every walk — to a work station or just ambient wandering — is a path of
// subtile nodes, followed node-to-node, so pawns go around walls and through
// doors instead of in a straight line through them. The station index
// (src/game/staff/stations.js) supplies reservable work slots; a pawn walks
// to a slot's node, faces its facing, and adopts the slot's pose.
//
// Pawn motion is a pure function of `member.job` (src/game/staff/jobRunner.js)
// — see _syncJob, the one place this file reads it. The SIM decides what to
// do and for how long (assignJobs picks and reserves a station, tickJobs
// times the work and completes/abandons it); the renderer only walks the
// pawn there and reports arrival. Arrival reporting — flipping
// `job.phase` from 'travel' to 'work' once the pawn's feet actually land on
// the station — is the one place this file writes back to sim state (see
// _arriveAtPathEnd); everything else here only reads. A member with no job
// ambles: _chooseAmbientTarget picks a random reachable subtile and walks
// there, exactly like a job-driven walk mechanically, but never touches
// member.job at all. (An earlier version of this file drove pawns itself —
// grab any reachable station, hold it 20-60s, release, repeat — before the
// job board existed; that throwaway driver is gone.)
//
// Animation is fully procedural — no frames:
//   - Facing: the figure's front is +Z, so heading = atan2(dx, dz) points it
//     down its travel direction; group.rotation.y eases toward that with
//     shortest-angle wrapping so it never spins the long way round the ±π seam.
//   - Walk: the stride phase advances by DISTANCE TRAVELLED, not elapsed time,
//     so stride locks to speed and the feet never skate. Legs swing
//     amp*sin(phase), arms counter-phase, plus a body bob at twice the phase
//     frequency. Idle damps the swing smoothly to zero instead of snapping.
//   - Named poses (stand/walk/sit/benchWork/...) come from the builder's
//     applyPose(), which eases hip/knee/torso/arm/head targets; the walk
//     swing above composes ON TOP of that (walk's own pose targets are all
//     zero) rather than fighting it.
//
// Owned by ThreeRenderer: it forwards sync() on staffChanged / full refresh,
// update(dt) from the animation loop, and dispose() on teardown.
//
// THREE is a CDN global — do NOT import it.

import { sampleSurfaceYAt } from '../game/terrain.js';
import {
  getNavGrid, findPath, isReachable, worldToSubtile, subtileToWorld,
} from '../game/staff/nav.js';
import {
  getStationIndex, releaseStation, releaseAllFor,
} from '../game/staff/stations.js';
import { PLACEABLES } from '../data/placeables/index.js';
import {
  buildStaffFigure,
  disposeStaffFigure,
  staffPalette,
  staffStyleHipHeight,
  applyPose,
  DEFAULT_STAFF_STYLE,
} from './builders/staff-builder.js';

// Skin/hair/coat choices and the per-role accents both live in the builder,
// keyed by the style's palette, so a style change (e.g. RCT2's sampled palette
// and full-uniform role colors) lands here with no edits.
const PALETTE = staffPalette(DEFAULT_STAFF_STYLE);
const DEFAULT_ROLE = PALETTE.roles.operator;

const WALK_SPEED_MIN = 0.9;   // world units / sec
const WALK_SPEED_VAR = 0.5;
const IDLE_MIN = 2, IDLE_MAX = 6; // seconds between ambient-wander actions
const WANDER_RADIUS = 6;      // tiles, for a random ambient-wander target
const WANDER_TRIES = 12;      // sampled candidates before giving up on wandering
const SPAWN_TRIES = 10;       // sampled candidates before giving up on a nice spawn tile
const ZONE_BIAS = 0.6;        // chance to head for the assigned zone

const HEIGHT_JITTER = 0.04;   // ±4% per-staff scale

// Stride: radians of walk phase per world unit travelled. One full cycle
// (2π) every ~1.1 units => a ~0.55-unit stride, about a quarter tile.
const PHASE_PER_UNIT = 2 * Math.PI / 1.1;
const SWING_AMP = DEFAULT_STAFF_STYLE.swingAmp;
const BOB_AMP = 0.022;        // world units of vertical body bob at full swing
// Exponential easing time constants (seconds to ~63% of the way there).
const TURN_TAU = 0.06;        // ~0.15s to settle a turn
const SWING_TAU = 0.10;       // idle damping of the limb swing

// Heading (radians) that faces each cardinal facing letter, given front is
// +Z and rotation.y = atan2(dx, dz) — same convention stations.js's
// FACING_DELTA uses (n: -Z/row, e: +X/col, s: +Z/row, w: -X/col).
const FACING_HEADING = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };

// Arrival tolerance, in world units, for "close enough" to a path node or
// amble target — small relative to a subtile (0.5 units).
const ARRIVE_EPS = 0.05;

// 1 subtile = 0.5 world units — same convention equipment-builder.js and
// component-builder.js each define locally for reading a def's `parts`
// coordinates (subtile units) into world space.
const SUB_UNIT = 0.5;

// --- Seeded appearance -----------------------------------------------------

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shortest signed angular difference from `from` to `to`, in (-π, π]. */
function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// --- StaffPawns ------------------------------------------------------------

export class StaffPawns {
  /**
   * @param {import('../game/Game.js').Game} game
   * @param {THREE.Scene} scene
   */
  constructor(game, scene) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'staffPawns';
    scene.add(this.group);
    this._scene = scene;

    /** @type {Map<string, object>} staffId → pawn record */
    this._pawns = new Map();
  }

  // --- Lifecycle -----------------------------------------------------------

  /** Create/remove pawns to match game.state.staffMembers. */
  sync() {
    const members = this.game?.state?.staffMembers || [];

    const seen = new Set();
    for (const m of members) {
      seen.add(m.id);
      if (!this._pawns.has(m.id)) this._addPawn(m);
    }
    for (const [id, pawn] of this._pawns) {
      if (!seen.has(id)) {
        this._destroyPawn(pawn);
        this._pawns.delete(id);
      }
    }
  }

  dispose() {
    for (const pawn of this._pawns.values()) this._destroyPawn(pawn);
    this._pawns.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  /**
   * Remove one pawn. Releases every station reservation it holds first — a
   * pawn deleted mid-job (fired, or dropped by a sync() that no longer sees
   * it in staffMembers) must never leave a slot reserved forever.
   *
   * Every geometry and material a figurine uses lives in the builder's
   * module-level cache and is shared with every other pawn on screen, so
   * disposeStaffFigure only detaches — nothing GPU-side is freed here, and
   * nothing should be.
   */
  _destroyPawn(pawn) {
    const state = this.game?.state;
    if (state) releaseAllFor(state, pawn.id);
    this.group.remove(pawn.figure.group);
    disposeStaffFigure(pawn.figure);
  }

  _addPawn(member) {
    const rng = mulberry32(hashString(member.id));
    const role = PALETTE.roles[member.profession] || DEFAULT_ROLE;
    const look = {
      skin: PALETTE.skins[Math.floor(rng() * PALETTE.skins.length)],
      hair: PALETTE.hairs[Math.floor(rng() * PALETTE.hairs.length)],
      longHair: rng() < 0.4,
      coat: PALETTE.coats[Math.floor(rng() * PALETTE.coats.length)],
      collar: role.collar,
      trouser: role.trouser,
      hardHat: role.hardHat,
      heightScale: 1 + (rng() * 2 - 1) * HEIGHT_JITTER,
    };

    const figure = buildStaffFigure(look, DEFAULT_STAFF_STYLE);
    figure.group.userData.staffId = member.id;

    const spawn = this._pickSpawn(member, rng);
    const pawn = {
      id: member.id,
      figure,
      x: spawn.x,
      z: spawn.z,
      mode: 'idle',
      idleT: IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN),
      speed: WALK_SPEED_MIN + rng() * WALK_SPEED_VAR,
      heading: rng() * Math.PI * 2,
      phase: rng() * Math.PI * 2,   // desynchronise the crowd's stride
      swing: 0,
      pose: 'stand',
      // Path-following state (see _beginPathWalk / _advancePathWalk).
      path: null,
      pathIndex: 0,
      pathNavRevision: 0,
      // navRevision last checked against the live station index while
      // 'working' (see _advanceWorking) — separate from pathNavRevision,
      // which only applies while actually walking.
      workNavRevision: 0,
      // Set while walking to or occupying a work station; null while
      // ambling with no job (see _syncJob/_chooseAmbientTarget). Also set
      // by a raw sendToStation caller outside the job system (see
      // jobTracking's own comment below and test-pawn-pathing.js).
      pendingStation: null,
      stationKey: null,
      // True while this pawn's stationKey/pendingStation/mode are being
      // driven by _syncJob off member.job, so the "job just went away"
      // branch there knows it owns that state and must clear it. False for
      // a pawn whose current station walk was started by a direct
      // sendToStation/setDestination call from outside the job system (a
      // seam Plan 2 built and test-pawn-pathing.js still exercises
      // directly) — _syncJob must never clobber tracking it didn't set up.
      jobTracking: false,
      // The (stationKey, navRevision) pair _syncJob last attempted to walk
      // toward for the CURRENT travel job, so a station that resolves but
      // is unreachable doesn't get a fresh findPath call every single
      // render frame — only when something in the world could plausibly
      // have changed. See _syncJob.
      jobAttemptKey: null,
      jobAttemptRevision: -1,
    };
    figure.group.rotation.y = pawn.heading;
    this._placeFigure(pawn);
    this.group.add(figure.group);
    this._pawns.set(member.id, pawn);
  }

  // --- Spawn / wander target picking (nav-based) ---------------------------
  //
  // These pick WHERE a pawn without a job goes (see _chooseAmbientTarget);
  // both route candidates through the navigator (nav.passable / isReachable)
  // rather than assuming every floor tile is walkable in a straight line,
  // the way the pre-nav version did.

  /**
   * A tile to spawn a new pawn on, biased toward its assigned zone when one
   * exists on the map. Falls back to the map origin's subtile when nothing
   * is built yet.
   */
  _pickSpawn(member, rng) {
    const state = this.game?.state;
    const floorKeys = Object.keys(state?.infraOccupied || {});
    const zid = member?.assignment?.zoneId;
    const zoneOcc = state?.zoneOccupied || {};
    const zoneKeys = zid ? floorKeys.filter(k => zoneOcc[k] === zid) : [];
    const pool = zoneKeys.length ? zoneKeys : floorKeys;

    const nav = state ? getNavGrid(state) : null;
    for (let i = 0; i < SPAWN_TRIES && pool.length; i++) {
      const [col, row] = pool[Math.floor(rng() * pool.length)].split(',').map(Number);
      const node = { col, row, subCol: Math.floor(rng() * 4), subRow: Math.floor(rng() * 4) };
      if (!nav || nav.passable.has(`${node.col},${node.row},${node.subCol},${node.subRow}`)) {
        return subtileToWorld(node);
      }
    }
    return subtileToWorld({ col: 0, row: 0, subCol: 0, subRow: 0 });
  }

  /**
   * A random reachable subtile to wander to, biased toward the pawn's
   * assigned zone when one exists. Returns null when nothing panned out in
   * WANDER_TRIES samples (e.g. the pawn is stranded on an island of one).
   */
  _pickTarget(pawn, member) {
    const state = this.game?.state;
    if (!state) return null;
    const nav = getNavGrid(state);
    const from = worldToSubtile(pawn.x, pawn.z);
    const zid = member?.assignment?.zoneId;
    const zoneOcc = state.zoneOccupied || {};
    const zoneKeys = zid ? Object.keys(zoneOcc).filter(k => zoneOcc[k] === zid) : null;

    for (let i = 0; i < WANDER_TRIES; i++) {
      let node;
      if (zoneKeys && zoneKeys.length && Math.random() < ZONE_BIAS) {
        const [col, row] = zoneKeys[Math.floor(Math.random() * zoneKeys.length)].split(',').map(Number);
        node = { col, row, subCol: (Math.random() * 4) | 0, subRow: (Math.random() * 4) | 0 };
      } else {
        node = {
          col: from.col + Math.round((Math.random() * 2 - 1) * WANDER_RADIUS),
          row: from.row + Math.round((Math.random() * 2 - 1) * WANDER_RADIUS),
          subCol: (Math.random() * 4) | 0, subRow: (Math.random() * 4) | 0,
        };
      }
      if (isReachable(nav, from, node)) return node;
    }
    return null;
  }

  // --- Public seams for Plan 3's job system --------------------------------

  /** Walk to a bare subtile node, with no station involved. Releases any
   * station reservation this pawn currently holds first. */
  setDestination(pawnId, node) {
    const pawn = this._pawns.get(pawnId);
    if (!pawn || !this.game?.state) return;
    this._releaseStationFor(pawn);
    this._beginPathWalk(pawn, node);
  }

  /** Walk to and occupy a StationRef the caller has already reserved.
   * Releases any different station this pawn currently holds first. */
  sendToStation(pawnId, stationRef) {
    const pawn = this._pawns.get(pawnId);
    if (!pawn || !this.game?.state) return;
    if (pawn.stationKey && pawn.stationKey !== stationRef.key) this._releaseStationFor(pawn);
    if (!this._beginStationWalk(pawn, stationRef)) {
      pawn.mode = 'idle';
      pawn.idleT = IDLE_MIN;
    }
  }

  // --- Job-driven movement (staff-professions-3, Task 3) -------------------
  //
  // The sim (jobRunner.js) decides what a member does and reserves whatever
  // station it needs; this file only ever WALKS the pawn and reports when it
  // gets there. _syncJob is the one method that reads member.job at all,
  // called first every update() frame, before anything mode-based runs —
  // see that method's own doc comment for the state machine it drives.

  /**
   * Reconcile this pawn's walk/pose state with `member.job`. Three cases:
   *
   *   - `job == null`: nothing to walk toward. If THIS method was the one
   *     driving the pawn's current station tracking (`pawn.jobTracking`),
   *     drop it and go idle — the job ended (completed, abandoned, needs
   *     preemption) sometime since the last frame, on the sim side, which
   *     already released any reservation via jobRunner.abandonJob; this
   *     never calls releaseStation itself; it only stops LOOKING like it's
   *     still en route to (or working) a slot nobody holds for it anymore.
   *     `jobTracking` is the guard against clobbering a pawn whose current
   *     station walk was started by a direct sendToStation/setDestination
   *     call from OUTSIDE the job system (a seam Plan 2 built and
   *     test-pawn-pathing.js still exercises directly with no `.job` on the
   *     member at all) — this method must never touch tracking it didn't
   *     set up itself.
   *   - `phase: 'travel'`: walk toward the job's station via the existing
   *     sendToStation seam (which does the actual reserving-caller-already-
   *     holds-it path-following) once per (stationKey, navRevision) pair —
   *     re-attempted only when the target or the world changes, not every
   *     frame, so an unreachable station doesn't cost a fresh findPath on
   *     every single render frame while jobRunner's own travel-budget
   *     backstop is what eventually gives up on it. A job with no
   *     `stationKey` (repair/commission — target-addressed, no StationRef;
   *     see jobs.js's header) has nothing resolvable to walk to here, so
   *     the pawn just holds position; jobRunner's travel budget (computed
   *     from the worst-case map distance for exactly this reason) is what
   *     eventually abandons a job that can never report arrival this way.
   *   - `phase: 'work'`: the pawn should be AT the station holding its
   *     pose. Ordinarily this is already true (this method's own travel
   *     handling walked it there and _arriveAtPathEnd flipped the phase on
   *     arrival), so the common case is a no-op; the explicit resolve+snap
   *     only fires on a mismatch (a freshly-synced pawn for a member whose
   *     job was already mid-work, or any other desync) rather than trusting
   *     the phase blindly.
   *
   * Never calls reserveStation/releaseStation — see this file's header for
   * why the sim, not the renderer, owns every reservation write.
   */
  _syncJob(pawn, member) {
    const state = this.game?.state;
    const job = member?.job || null;

    if (!job) {
      if (pawn.jobTracking) {
        pawn.jobTracking = false;
        pawn.stationKey = null;
        pawn.pendingStation = null;
        pawn.path = null;
        pawn.pathIndex = 0;
        pawn.mode = 'idle';
        pawn.idleT = IDLE_MIN;
      }
      return;
    }
    pawn.jobTracking = true;

    if (job.phase === 'work') {
      if (pawn.mode !== 'working' || pawn.stationKey !== job.stationKey) {
        const ref = (job.stationKey && state) ? getStationIndex(state).byKey[job.stationKey] : null;
        if (ref) this._snapToStation(pawn, ref);
        else { pawn.stationKey = null; pawn.pendingStation = null; pawn.mode = 'idle'; }
      }
      return;
    }

    // job.phase === 'travel'
    if (job.stationKey && pawn.mode === 'pathWalk' && pawn.stationKey === job.stationKey) return;

    const revision = state?.navRevision || 0;
    const attemptKey = job.stationKey || null;
    if (pawn.jobAttemptKey === attemptKey && pawn.jobAttemptRevision === revision) return;
    pawn.jobAttemptKey = attemptKey;
    pawn.jobAttemptRevision = revision;

    const ref = (job.stationKey && state) ? getStationIndex(state).byKey[job.stationKey] : null;
    if (ref) {
      this.sendToStation(pawn.id, ref);
    } else {
      pawn.stationKey = null;
      pawn.pendingStation = null;
      pawn.mode = 'idle';
    }
  }

  /** Teleport the pawn straight onto `ref`'s anchor/pose — used only by
   * _syncJob to resync a pawn whose job is already (or becomes) phase:
   * 'work' without this pawn having walked there itself. Ordinary arrival
   * goes through _arriveAtPathEnd instead, which is the one place that also
   * reports arrival back to the job (see that method). */
  _snapToStation(pawn, ref) {
    const world = subtileToWorld(ref.node);
    pawn.x = world.x;
    pawn.z = world.z;
    pawn.heading = FACING_HEADING[ref.facing] ?? pawn.heading;
    pawn.stationKey = ref.key;
    pawn.pendingStation = ref;
    pawn.mode = 'working';
    pawn.path = null;
    pawn.pathIndex = 0;
  }

  /**
   * No-job ambient wander: pick a random reachable subtile and walk there,
   * exactly like the old throwaway driver's fallback did. Only ever called
   * while member.job is null (see update()) — a member holding a job, even
   * one with nothing to walk toward yet (see _syncJob's target-addressed
   * case), stays put rather than wandering off from its assignment.
   */
  _chooseAmbientTarget(pawn, member) {
    if (!this.game?.state) { pawn.idleT = IDLE_MIN; return; }
    const target = this._pickTarget(pawn, member);
    if (target && this._beginPathWalk(pawn, target)) return;
    pawn.idleT = IDLE_MIN;
  }

  /**
   * Advance one frame of 'working'. No timer here — the sim (jobRunner's
   * tickJobs) owns work duration/progress/completion entirely; this only
   * re-checks the station is still live, so a station demolished AFTER a
   * pawn already arrived and sat down doesn't leave it frozen there forever
   * (jobRunner catches the same demolition on its own next tick and clears
   * member.job, but that can be up to one sim tick — not one render frame —
   * behind). Gated on navRevision having moved since the last check
   * (workNavRevision), not every frame — a station cannot vanish without
   * the revision moving, so this stays an infrequent O(1) lookup rather
   * than a per-frame getStationIndex() call for every seated/working pawn
   * in the facility.
   */
  _advanceWorking(pawn) {
    const state = this.game?.state;
    const revision = state?.navRevision || 0;
    if (revision === pawn.workNavRevision) return;
    pawn.workNavRevision = revision;
    if (!this._stationStillLive(state, pawn)) {
      this._releaseStationFor(pawn);
      pawn.mode = 'idle';
      pawn.idleT = IDLE_MIN;
    }
  }

  _releaseStationFor(pawn) {
    const state = this.game?.state;
    if (state && pawn.stationKey) releaseStation(state, pawn.stationKey, pawn.id);
    pawn.stationKey = null;
    pawn.pendingStation = null;
  }

  /**
   * Whether the station this pawn is walking to (or occupying) still exists
   * in the live index. True (vacuously) when the pawn isn't tracking a
   * station at all. getStationIndex() rebuilds — and prunes
   * state.stationReservations of dead keys — on every navRevision bump, so
   * this is an O(1) lookup against the current index, not a fresh scan.
   * A demolished station leaves its subtile passable (nothing there to
   * block it), so a path re-check alone can't catch this — the pawn would
   * happily path to, and "work", an empty tile without this check.
   */
  _stationStillLive(state, pawn) {
    if (!pawn.stationKey || !state) return true;
    return !!getStationIndex(state).byKey[pawn.stationKey];
  }

  // --- Path following --------------------------------------------------

  /** Compute a path to `node` and start following it. Returns false (and
   * touches nothing) when `node` isn't reachable right now. */
  _beginPathWalk(pawn, node) {
    const state = this.game.state;
    const nav = getNavGrid(state);
    const from = worldToSubtile(pawn.x, pawn.z);
    const path = findPath(nav, from, node);
    if (!path) return false;
    pawn.path = path;
    pawn.pathIndex = 0;
    pawn.pathNavRevision = state.navRevision || 0;
    pawn.mode = 'pathWalk';
    return true;
  }

  /** Like _beginPathWalk, but also stamps the pawn as walking toward (and
   * on arrival, occupying) `ref`. Rolls back pendingStation/stationKey on
   * failure so a failed walk never leaves the pawn thinking it has a job. */
  _beginStationWalk(pawn, ref) {
    pawn.pendingStation = ref;
    pawn.stationKey = ref.key;
    if (this._beginPathWalk(pawn, ref.node)) return true;
    pawn.pendingStation = null;
    pawn.stationKey = null;
    return false;
  }

  /**
   * Advance one frame of path-following. Re-paths first when navRevision has
   * moved since the path was computed (the building changed under the
   * pawn's feet); if the re-path comes back null, the destination is no
   * longer reachable at all, so the reservation is released and the pawn
   * goes idle rather than freezing mid-stride. `member` is threaded through
   * to _arriveAtPathEnd purely to report job arrival (see that method) —
   * null for an ambient wander with no member.job at all.
   */
  _advancePathWalk(pawn, member, dt) {
    const state = this.game.state;
    const revision = state.navRevision || 0;
    if (revision !== pawn.pathNavRevision) {
      // Check the STATION first, independent of path reachability: a
      // demolished station's subtile is still passable (nothing left there
      // to block it), so a route re-check alone would happily re-path the
      // pawn onto the now-empty tile and let it "work" thin air.
      if (!this._stationStillLive(state, pawn)) {
        this._releaseStationFor(pawn);
        pawn.path = null;
        pawn.pathIndex = 0;
        pawn.mode = 'idle';
        pawn.idleT = IDLE_MIN;
        return 0;
      }
      const finalNode = pawn.path[pawn.path.length - 1];
      const nav = getNavGrid(state);
      const from = worldToSubtile(pawn.x, pawn.z);
      const path = findPath(nav, from, finalNode);
      if (!path) {
        this._releaseStationFor(pawn);
        pawn.path = null;
        pawn.pathIndex = 0;
        pawn.mode = 'idle';
        pawn.idleT = IDLE_MIN;
        return 0;
      }
      pawn.path = path;
      pawn.pathIndex = 0;
      pawn.pathNavRevision = revision;
    }

    const node = pawn.path[pawn.pathIndex];
    const targetXZ = subtileToWorld(node);
    const dx = targetXZ.x - pawn.x;
    const dz = targetXZ.z - pawn.z;
    const dist = Math.hypot(dx, dz);
    const step = pawn.speed * dt;
    let moved = 0;

    if (dist <= step || dist < ARRIVE_EPS) {
      moved = dist;
      pawn.x = targetXZ.x;
      pawn.z = targetXZ.z;
      if (pawn.pathIndex < pawn.path.length - 1) {
        pawn.pathIndex++;
      } else {
        this._arriveAtPathEnd(pawn, member);
      }
    } else {
      moved = step;
      pawn.x += (dx / dist) * step;
      pawn.z += (dz / dist) * step;
      // Front face is +Z: rotating +Z by θ about Y gives (sinθ, 0, cosθ),
      // so θ = atan2(dx, dz) aims the figure ALONG travel, not away from it.
      pawn.heading += angleDelta(pawn.heading, Math.atan2(dx, dz))
        * (1 - Math.exp(-dt / TURN_TAU));
    }
    return moved;
  }

  /** The final path node was reached. Snaps to the station anchor and its
   * facing (no easing — "arrived" is a discrete event), or just goes idle
   * for a plain setDestination walk with no station attached. Re-checks the
   * station is still live first — it may have been demolished during the
   * walk without ever severing the ROUTE to its (now empty) subtile, which
   * is exactly the case _advancePathWalk's re-path check can't catch on its
   * own (see _stationStillLive). */
  _arriveAtPathEnd(pawn, member) {
    const state = this.game?.state;
    if (pawn.pendingStation) {
      if (!this._stationStillLive(state, pawn)) {
        this._releaseStationFor(pawn);
        pawn.mode = 'idle';
        pawn.idleT = IDLE_MIN;
        return;
      }
      const ref = pawn.pendingStation;
      const world = subtileToWorld(ref.node);
      pawn.x = world.x;
      pawn.z = world.z;
      pawn.heading = FACING_HEADING[ref.facing] ?? pawn.heading;
      pawn.mode = 'working';
      pawn.workNavRevision = state?.navRevision || 0;

      // Arrival reporting: the ONE place this file writes to sim state
      // (see this file's header). The sim owns everything about a job —
      // what it is, how long it takes, when it's done — but only the
      // renderer knows WHEN a pawn's feet have actually landed on the
      // station, so this is the sole signal that can flip travel -> work
      // and let jobRunner.tickJobs start accruing progress. Guarded on the
      // member still actually holding a 'travel' job at exactly this
      // station: a job can be abandoned (needs preemption, demolition,
      // travel timeout) on a sim tick that lands between this pawn's last
      // synced position and this arrival, so member.job may already be
      // null, or point somewhere else entirely, by the time the walk ends.
      if (member?.job?.phase === 'travel' && member.job.stationKey === ref.key) {
        member.job.phase = 'work';
      }
    } else {
      pawn.mode = 'idle';
      pawn.idleT = IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
    }
  }

  // --- Per-frame update ----------------------------------------------------

  update(dt) {
    if (!this._pawns.size) return;
    if (!(dt > 0) || dt > 0.5) dt = 0.016; // clamp tab-switch spikes

    const members = this.game?.state?.staffMembers || [];
    const byId = new Map(members.map(m => [m.id, m]));

    for (const pawn of this._pawns.values()) {
      const member = byId.get(pawn.id);
      let moved = 0;

      // Reconcile walk/pose state with member.job FIRST, before anything
      // mode-based below runs this frame — see _syncJob's own doc comment
      // for the three-way split (no job / travel / work) this drives.
      this._syncJob(pawn, member);

      if (pawn.mode === 'idle') {
        // Only a JOBLESS pawn ambles on its own timer — a member holding a
        // job, even one _syncJob couldn't find anything to walk toward for
        // (see its target-addressed-job case), stays put rather than
        // wandering off from its own assignment.
        if (!member?.job) {
          pawn.idleT -= dt;
          if (pawn.idleT <= 0) this._chooseAmbientTarget(pawn, member);
        }
      } else if (pawn.mode === 'pathWalk') {
        moved = this._advancePathWalk(pawn, member, dt);
      } else if (pawn.mode === 'working') {
        this._advanceWorking(pawn);
      }

      pawn.pose = this._poseFor(pawn);
      this._animate(pawn, dt, moved);
      this._placeFigure(pawn);

      // Report the pawn's own position back onto its member. This is the
      // ONLY other write this file makes to sim state (see the header and
      // _arriveAtPathEnd): jobRunner's findStation/eligibleFor/tie-break
      // all key off member.fromNode for reachability and distance, and
      // nothing else in the sim ever sets it — before this, it was simply
      // never populated, which is why every fromNode-gated runner path
      // (eat/rest job assignment, the travel-budget path-length estimate,
      // the nearest-station tie-break) sat dormant. Written every frame,
      // unconditionally, for every live pawn — cheap (a couple of divides)
      // and unconditionally correct, unlike job.phase which only ever
      // moves forward on a specific event.
      if (member) member.fromNode = worldToSubtile(pawn.x, pawn.z);
    }
  }

  _poseFor(pawn) {
    if (pawn.mode === 'pathWalk') return 'walk';
    if (pawn.mode === 'working') return pawn.pendingStation?.seated ? 'sit' : 'benchWork';
    return 'stand';
  }

  /**
   * Procedural walk. `moved` is the distance covered this frame — driving the
   * phase from it (rather than from dt) locks stride length to speed, so slow
   * pawns take slow steps instead of moonwalking. applyPose lays down the
   * pose's own joint targets first (walk/stand's are all zero); the swing
   * below composes ON TOP of that rather than overwriting it, which is what
   * lets a pawn ease from walk into sit without a discontinuity.
   */
  _animate(pawn, dt, moved) {
    const walking = pawn.mode === 'pathWalk';
    if (walking) pawn.phase += moved * PHASE_PER_UNIT;

    // Ease the swing amplitude in and out so stopping settles rather than snaps.
    const targetSwing = walking ? SWING_AMP : 0;
    pawn.swing += (targetSwing - pawn.swing) * (1 - Math.exp(-dt / SWING_TAU));

    applyPose(pawn.figure, pawn.pose, dt);

    const angle = pawn.swing * Math.sin(pawn.phase);
    const fig = pawn.figure;
    fig.leftLeg.rotation.x += angle;
    fig.rightLeg.rotation.x += -angle;
    fig.leftArm.rotation.x += -angle;   // arms counter-phase their same-side leg
    fig.rightArm.rotation.x += angle;

    // Bob at twice the stride frequency, phased so it never dips below 0 —
    // the figure rises off its planted foot rather than sinking into the slab.
    const bobScale = pawn.swing / (SWING_AMP || 1);
    fig.body.position.y = BOB_AMP * bobScale * 0.5 * (1 - Math.cos(2 * pawn.phase));

    fig.group.rotation.y = pawn.heading;
  }

  /** Stand the figurine on the ground. Its origin is at the feet — a seated
   * pawn instead raises the whole group so the hip lands at the CHAIR's own
   * seat height (see _seatedYOffset); the builder itself never moves parts
   * to fake sitting. */
  _placeFigure(pawn) {
    const state = this.game?.state;
    const col = Math.floor(pawn.x / 2);
    const row = Math.floor(pawn.z / 2);
    // Concrete pads render as flat foundations at y=0 regardless of terrain
    // (see world-snapshot.buildFloors) — match that so feet stay on the slab.
    const isConcrete = state?.infraOccupied?.[col + ',' + row] === 'concrete';
    const groundY = isConcrete ? 0 : sampleSurfaceYAt(state, pawn.x, pawn.z);
    const seated = pawn.mode === 'working' && !!pawn.pendingStation?.seated;
    const yOffset = seated ? this._seatedYOffset(state, pawn.pendingStation) : 0.01;
    pawn.figure.group.position.set(pawn.x, groundY + yOffset, pawn.z);
  }

  /**
   * The group's Y offset for a seated pawn. The rig BAKES IN the hip's
   * local height (buildStaffFigure places the thigh mesh at local y=hipY;
   * sit only ROTATES the thigh/shin about that fixed pivot, per
   * staffStyleHipHeight's doc comment — pose rotation never moves it). So
   * the hip's world Y is always `group.position.y + hipY`, and lifting the
   * group by hipY (an earlier version of this method did) puts the hip at
   * 2x hip height instead of at the chair. The correct lift is the
   * DIFFERENCE between the chair's own seat height and the rig's baked-in
   * hip height: `seatY*SUB_UNIT - hipY`, so hip world Y comes out to
   * exactly the chair's seat height. Clamped to >= 0 so a stool shorter
   * than the rig's hip height never sinks the pawn's feet into the floor —
   * the hip then rests at its own natural (standing) height instead, no
   * lower.
   */
  _seatedYOffset(state, ref) {
    const chairDef = this._resolveChairDef(state, ref?.seatPlaceableId);
    const seatY = chairDef?.seat?.seatY;
    if (typeof seatY !== 'number') return 0; // no seat data resolvable — sit at the rig's own hip height rather than re-introduce the old double-hip bug
    const hipY = staffStyleHipHeight(DEFAULT_STAFF_STYLE);
    return Math.max(0, seatY * SUB_UNIT - hipY);
  }

  /** Resolve a placed chair instance's id back to its PLACEABLES def. */
  _resolveChairDef(state, seatPlaceableId) {
    if (!state || !seatPlaceableId) return null;
    const idx = state.placeableIndex?.[seatPlaceableId];
    const entry = idx !== undefined ? state.placeables?.[idx] : undefined;
    return entry ? PLACEABLES[entry.type] : null;
  }
}
