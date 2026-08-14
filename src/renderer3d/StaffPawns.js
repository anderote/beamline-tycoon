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
// Wandering is deliberately dumb (no pathfinding): pawns amble in straight
// lines between nearby walkable tiles (tiles with floors placed —
// game.state.infraOccupied), pausing 2-6s between legs. Staff with a zone
// assignment bias their targets toward tiles of that zone type.
//
// Animation is fully procedural — no frames:
//   - Facing: the figure's front is +Z, so heading = atan2(dx, dz) points it
//     down its travel direction; group.rotation.y eases toward that with
//     shortest-angle wrapping so it never spins the long way round the ±π seam.
//   - Walk: the stride phase advances by DISTANCE TRAVELLED, not elapsed time,
//     so stride locks to speed and the feet never skate. Legs swing
//     amp*sin(phase), arms counter-phase, plus a body bob at twice the phase
//     frequency. Idle damps the swing smoothly to zero instead of snapping.
//
// Owned by ThreeRenderer: it forwards sync() on staffChanged / full refresh,
// update(dt) from the animation loop, and dispose() on teardown.
//
// THREE is a CDN global — do NOT import it.

import { sampleSurfaceYAt } from '../game/terrain.js';
import {
  buildStaffFigure,
  disposeStaffFigure,
  staffPalette,
  DEFAULT_STAFF_STYLE,
} from './builders/staff-builder.js';

// Skin/hair/coat choices and the per-role accents both live in the builder,
// keyed by the style's palette, so a style change (e.g. RCT2's sampled palette
// and full-uniform role colors) lands here with no edits.
const PALETTE = staffPalette(DEFAULT_STAFF_STYLE);
const DEFAULT_ROLE = PALETTE.roles.operator;

const WALK_SPEED_MIN = 0.9;   // world units / sec
const WALK_SPEED_VAR = 0.5;
const IDLE_MIN = 2, IDLE_MAX = 6; // seconds
const WANDER_RADIUS = 6;      // tiles (Chebyshev) for "nearby" targets
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

    // Walkable-tile cache, invalidated when the floor count changes or on sync().
    this._tiles = [];
    this._tilesCount = -1;
  }

  // --- Lifecycle -----------------------------------------------------------

  /** Create/remove pawns to match game.state.staffMembers. */
  sync() {
    const members = this.game?.state?.staffMembers || [];
    this._tilesCount = -1; // re-derive walkable tiles (floors may have changed)

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
   * Remove one pawn. Every geometry and material a figurine uses lives in the
   * builder's module-level cache and is shared with every other pawn on
   * screen, so disposeStaffFigure only detaches — nothing GPU-side is freed
   * here, and nothing should be.
   */
  _destroyPawn(pawn) {
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
      target: null,
      mode: 'idle',
      idleT: IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN),
      speed: WALK_SPEED_MIN + rng() * WALK_SPEED_VAR,
      heading: rng() * Math.PI * 2,
      phase: rng() * Math.PI * 2,   // desynchronise the crowd's stride
      swing: 0,
    };
    figure.group.rotation.y = pawn.heading;
    this._placeFigure(pawn);
    this.group.add(figure.group);
    this._pawns.set(member.id, pawn);
  }

  // --- Walkable tiles ------------------------------------------------------

  _walkableTiles() {
    const occ = this.game?.state?.infraOccupied || {};
    const keys = Object.keys(occ);
    if (keys.length !== this._tilesCount) {
      const tiles = [];
      for (const k of keys) {
        const comma = k.indexOf(',');
        tiles.push({ col: +k.slice(0, comma), row: +k.slice(comma + 1), key: k });
      }
      // Fallback: nothing built yet → amble on the grass near the origin.
      if (tiles.length === 0) {
        for (let c = -3; c <= 3; c++) {
          for (let r = -3; r <= 3; r++) tiles.push({ col: c, row: r, key: c + ',' + r });
        }
      }
      this._tiles = tiles;
      this._tilesCount = keys.length;
    }
    return this._tiles;
  }

  _tileCenterJittered(tile) {
    return {
      x: tile.col * 2 + 1 + (Math.random() - 0.5),
      z: tile.row * 2 + 1 + (Math.random() - 0.5),
    };
  }

  _pickSpawn(member, rng) {
    const tiles = this._walkableTiles();
    const zoneTiles = this._assignedZoneTiles(member, tiles);
    const pool = zoneTiles.length ? zoneTiles : tiles;
    const tile = pool[Math.floor(rng() * pool.length)];
    return this._tileCenterJittered(tile);
  }

  _assignedZoneTiles(member, tiles) {
    const zid = member?.assignment?.zoneId;
    if (!zid) return [];
    const zoneOcc = this.game?.state?.zoneOccupied || {};
    return tiles.filter(t => zoneOcc[t.key] === zid);
  }

  _pickTarget(pawn, member) {
    const tiles = this._walkableTiles();
    if (tiles.length === 0) return null;

    // Bias toward the assigned zone when one exists on the map.
    const zoneTiles = this._assignedZoneTiles(member, tiles);
    if (zoneTiles.length && Math.random() < ZONE_BIAS) {
      return this._tileCenterJittered(zoneTiles[Math.floor(Math.random() * zoneTiles.length)]);
    }

    // Otherwise a nearby walkable tile (Chebyshev radius), or anywhere.
    const col = Math.floor(pawn.x / 2);
    const row = Math.floor(pawn.z / 2);
    const near = tiles.filter(t =>
      Math.max(Math.abs(t.col - col), Math.abs(t.row - row)) <= WANDER_RADIUS);
    const pool = near.length ? near : tiles;
    return this._tileCenterJittered(pool[Math.floor(Math.random() * pool.length)]);
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

      if (pawn.mode === 'idle') {
        pawn.idleT -= dt;
        if (pawn.idleT <= 0) {
          pawn.target = this._pickTarget(pawn, member);
          if (pawn.target) {
            pawn.mode = 'walk';
          } else {
            pawn.idleT = IDLE_MIN;
          }
        }
      } else {
        const dx = pawn.target.x - pawn.x;
        const dz = pawn.target.z - pawn.z;
        const dist = Math.hypot(dx, dz);
        const step = pawn.speed * dt;
        if (dist <= step || dist < 0.05) {
          moved = dist;
          pawn.x = pawn.target.x;
          pawn.z = pawn.target.z;
          pawn.mode = 'idle';
          pawn.idleT = IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
        } else {
          moved = step;
          pawn.x += (dx / dist) * step;
          pawn.z += (dz / dist) * step;
          // Front face is +Z: rotating +Z by θ about Y gives (sinθ, 0, cosθ),
          // so θ = atan2(dx, dz) aims the figure ALONG travel, not away from it.
          pawn.heading += angleDelta(pawn.heading, Math.atan2(dx, dz))
            * (1 - Math.exp(-dt / TURN_TAU));
        }
      }

      this._animate(pawn, dt, moved);
      this._placeFigure(pawn);
    }
  }

  /**
   * Procedural walk. `moved` is the distance covered this frame — driving the
   * phase from it (rather than from dt) locks stride length to speed, so slow
   * pawns take slow steps instead of moonwalking.
   */
  _animate(pawn, dt, moved) {
    const walking = pawn.mode === 'walk';
    if (walking) pawn.phase += moved * PHASE_PER_UNIT;

    // Ease the swing amplitude in and out so stopping settles rather than snaps.
    const targetSwing = walking ? SWING_AMP : 0;
    pawn.swing += (targetSwing - pawn.swing) * (1 - Math.exp(-dt / SWING_TAU));

    const angle = pawn.swing * Math.sin(pawn.phase);
    const fig = pawn.figure;
    fig.leftLeg.rotation.x = angle;
    fig.rightLeg.rotation.x = -angle;
    fig.leftArm.rotation.x = -angle;   // arms counter-phase their same-side leg
    fig.rightArm.rotation.x = angle;

    // Bob at twice the stride frequency, phased so it never dips below 0 —
    // the figure rises off its planted foot rather than sinking into the slab.
    const bobScale = pawn.swing / (SWING_AMP || 1);
    fig.body.position.y = BOB_AMP * bobScale * 0.5 * (1 - Math.cos(2 * pawn.phase));

    fig.group.rotation.y = pawn.heading;
  }

  /** Stand the figurine on the ground. Its origin is at the feet. */
  _placeFigure(pawn) {
    const state = this.game?.state;
    const col = Math.floor(pawn.x / 2);
    const row = Math.floor(pawn.z / 2);
    // Concrete pads render as flat foundations at y=0 regardless of terrain
    // (see world-snapshot.buildFloors) — match that so feet stay on the slab.
    const isConcrete = state?.infraOccupied?.[col + ',' + row] === 'concrete';
    const groundY = isConcrete ? 0 : sampleSurfaceYAt(state, pawn.x, pawn.z);
    pawn.figure.group.position.set(pawn.x, groundY + 0.01, pawn.z);
  }
}
