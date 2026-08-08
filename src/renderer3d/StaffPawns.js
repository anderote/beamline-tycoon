// src/renderer3d/StaffPawns.js — little walking pixel-people for hired staff.
//
// Each hired StaffMember gets a billboard THREE.Sprite with a canvas-drawn
// pixel-art person (7x13 px figure on a 9x15 canvas, NearestFilter so it
// stays crisp and chunky). The figure is a front-facing adaptation of the
// title-screen scientists (see TitleScreen._drawPerson): same proportions
// (3-wide head under a 1px hair cap, 5-wide x 6-tall off-white lab coat with
// a darker front-opening line, 3-tall trousers), same skin/hair/coat palette,
// and the same yellow hard hat (cap + brim) — worn here by technicians and
// engineers. Appearance is seeded from the staff id so pawns look the same
// across frames and reloads; roles stay distinguishable via tinted trousers
// plus a matching collar sliver at the top of the coat opening.
//
// Wandering is deliberately dumb (no pathfinding): pawns amble in straight
// lines between nearby walkable tiles (tiles with floors placed —
// game.state.infraOccupied), pausing 2-6s between legs, with a 2-frame walk
// animation while moving. Staff with a zone assignment bias their targets
// toward tiles of that zone type.
//
// Owned by ThreeRenderer: it forwards sync() on staffChanged / full refresh,
// update(dt) from the animation loop, and dispose() on teardown.
//
// THREE is a CDN global — do NOT import it.

import { sampleSurfaceYAt } from '../game/terrain.js';

// Role → outfit accents (trousers + collar sliver at the coat opening).
// Trousers stay in the title screen's dark-trouser family but tinted per
// role; the collar repeats the brighter accent so roles read at a glance.
const ROLE_STYLE = {
  operator:   { collar: '#3d7dd8', trouser: '#2c4470', hardHat: false },
  technician: { collar: '#e08a2e', trouser: '#6e4522', hardHat: true },
  scientist:  { collar: '#8a5fd0', trouser: '#463462', hardHat: false },
  engineer:   { collar: '#3aa864', trouser: '#25503a', hardHat: true },
};
const DEFAULT_STYLE = ROLE_STYLE.operator;

// Exact title-screen palette (TitleScreen._spawnPerson / _drawPerson).
const SKIN_TONES = ['#d8a878', '#b0784f', '#e8c9a2'];
const HAIR_COLORS = ['#3a2e28', '#6e6e78', '#8a5a2e', '#1e1e28'];
const COAT_COLORS = ['#c6c8d4', '#b7bcca', '#c9c5b4'];
const COAT_DARK = '#8f93a4';    // coat front-opening line
const HARD_HAT = '#d9b53a';
const EYE = '#1a1a22';

const OUTLINE = 'rgba(20,18,26,0.9)';

// Canvas: 9x15 with a 1px transparent margin around the 7x13 figure
// (margin stops NearestFilter edge bleed).
const TEX_W = 9;
const TEX_H = 15;

// Sprite world size — a bit less than one tile (tile = 2 world units).
// Chosen so the 13px figure covers the same world height as the previous
// 16px figure did (~1.2 units): pawns don't grow/shrink, pixels get chunkier.
const PAWN_H = 1.38;
const PAWN_W = PAWN_H * (TEX_W / TEX_H);

const WALK_SPEED_MIN = 0.9;   // world units / sec
const WALK_SPEED_VAR = 0.5;
const IDLE_MIN = 2, IDLE_MAX = 6; // seconds
const WALK_FPS = 5;           // 2-frame swap rate
const WANDER_RADIUS = 6;      // tiles (Chebyshev) for "nearby" targets
const ZONE_BIAS = 0.6;        // chance to head for the assigned zone

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

// --- Pixel person drawing --------------------------------------------------

/** Fill one figure-space pixel (figure origin is at canvas (1,1)). */
function px(ctx, x, y, w = 1, h = 1) {
  ctx.fillRect(x + 1, y + 1, w, h);
}

/**
 * Draw one animation frame of the figure onto a fresh canvas.
 * Mirrors the title screen's 2-frame walk: frame 0 = legs apart (also the
 * standing pose), frame 1 = legs together mid-stride.
 *
 * Figure layout (7w x 13h):
 *   y0        hair cap (or hard-hat cap)
 *   y1..y3    3x3 head (hard-hat brim overwrites y1)
 *   y4..y9    5-wide coat, COAT_DARK opening line down the centre
 *   y10..y12  trousers
 *   cols 0/6  coat-sleeve arms with skin hands, slight swing on frame 1
 */
function drawFrame(look, frame) {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const paint = (c) => { ctx.fillStyle = c; };

  // Head (3x3 skin), then eyes, then hair/hat over the top — same layering
  // as the title screen so the hat brim replaces the top skin row.
  paint(look.skin);
  px(ctx, 2, 1, 3, 3);
  paint(EYE);
  px(ctx, 2, 2, 1, 1); px(ctx, 4, 2, 1, 1);   // eyes
  if (look.hardHat) {
    paint(HARD_HAT);
    px(ctx, 2, 0, 3, 1);                       // cap
    px(ctx, 1, 1, 5, 1);                       // brim
  } else {
    paint(look.hair);
    if (look.longHair) {
      px(ctx, 1, 0, 5, 1);                     // wider cap connecting the sides
      px(ctx, 1, 1, 1, 2); px(ctx, 5, 1, 1, 2);
    } else {
      px(ctx, 2, 0, 3, 1);                     // hair cap
    }
  }

  // Lab coat (5w x 6t) with the darker front-opening line down the centre.
  paint(look.coat);
  px(ctx, 1, 4, 5, 6);
  paint(COAT_DARK);
  px(ctx, 3, 4, 1, 6);                         // coat opening
  paint(look.collar);
  px(ctx, 2, 4, 1, 1); px(ctx, 4, 4, 1, 1);   // role-tinted collar sliver

  // Arms (coat sleeves) + skin hands. Frame 1 swings them slightly.
  paint(look.coat);
  if (frame === 0) {
    px(ctx, 0, 4, 1, 5); px(ctx, 6, 4, 1, 5);
    paint(look.skin);
    px(ctx, 0, 9, 1, 1); px(ctx, 6, 9, 1, 1);
  } else {
    px(ctx, 0, 5, 1, 5); px(ctx, 6, 3, 1, 5);
    paint(look.skin);
    px(ctx, 0, 10, 1, 1); px(ctx, 6, 8, 1, 1);
  }

  // Trousers: apart (frame 0) / together (frame 1), like the title walk.
  paint(look.trouser);
  if (frame === 0) {
    px(ctx, 1, 10, 2, 3); px(ctx, 4, 10, 2, 3);
  } else {
    px(ctx, 2, 10, 3, 3);
  }

  return canvas;
}

/** Wrap a drawn frame with a 1px dark outline so pawns pop on light floors. */
function outlineFrame(figure) {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Silhouette, stamped at 4 offsets.
  const sil = document.createElement('canvas');
  sil.width = TEX_W; sil.height = TEX_H;
  const sctx = sil.getContext('2d');
  sctx.drawImage(figure, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = OUTLINE;
  sctx.fillRect(0, 0, TEX_W, TEX_H);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.drawImage(sil, dx, dy);
  }
  ctx.drawImage(figure, 0, 0);
  return canvas;
}

function makeTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
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

  _destroyPawn(pawn) {
    this.group.remove(pawn.sprite);
    pawn.sprite.material.dispose();
    pawn.texA.dispose();
    pawn.texB.dispose();
  }

  _addPawn(member) {
    const rng = mulberry32(hashString(member.id));
    const style = ROLE_STYLE[member.role] || DEFAULT_STYLE;
    const look = {
      skin: SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)],
      hair: HAIR_COLORS[Math.floor(rng() * HAIR_COLORS.length)],
      longHair: rng() < 0.4,
      coat: COAT_COLORS[Math.floor(rng() * COAT_COLORS.length)],
      collar: style.collar,
      trouser: style.trouser,
      hardHat: style.hardHat,
    };

    const texA = makeTexture(outlineFrame(drawFrame(look, 0)));
    const texB = makeTexture(outlineFrame(drawFrame(look, 1)));
    const mat = new THREE.SpriteMaterial({
      map: texA,
      transparent: true,
      alphaTest: 0.1,
      depthTest: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(PAWN_W, PAWN_H, 1);
    sprite.renderOrder = 6; // above floors/zone tints, below UI label sprites
    sprite.userData.staffId = member.id;

    const spawn = this._pickSpawn(member, rng);
    const pawn = {
      id: member.id,
      sprite,
      texA,
      texB,
      x: spawn.x,
      z: spawn.z,
      target: null,
      mode: 'idle',
      idleT: IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN),
      speed: WALK_SPEED_MIN + rng() * WALK_SPEED_VAR,
      animT: 0,
      frame: 0,
    };
    this._placeSprite(pawn);
    this.group.add(sprite);
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
      if (pawn.mode === 'idle') {
        pawn.idleT -= dt;
        if (pawn.idleT <= 0) {
          pawn.target = this._pickTarget(pawn, member);
          if (pawn.target) {
            pawn.mode = 'walk';
            pawn.animT = 0;
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
          pawn.x = pawn.target.x;
          pawn.z = pawn.target.z;
          pawn.mode = 'idle';
          pawn.idleT = IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
          pawn.frame = 0;
          pawn.sprite.material.map = pawn.texA;
        } else {
          pawn.x += (dx / dist) * step;
          pawn.z += (dz / dist) * step;
          pawn.animT += dt;
          const frame = Math.floor(pawn.animT * WALK_FPS) % 2;
          if (frame !== pawn.frame) {
            pawn.frame = frame;
            pawn.sprite.material.map = frame === 0 ? pawn.texA : pawn.texB;
          }
        }
      }
      this._placeSprite(pawn);
    }
  }

  _placeSprite(pawn) {
    const state = this.game?.state;
    const col = Math.floor(pawn.x / 2);
    const row = Math.floor(pawn.z / 2);
    // Concrete pads render as flat foundations at y=0 regardless of terrain
    // (see world-snapshot.buildFloors) — match that so feet stay on the slab.
    const isConcrete = state?.infraOccupied?.[col + ',' + row] === 'concrete';
    const groundY = isConcrete ? 0 : sampleSurfaceYAt(state, pawn.x, pawn.z);
    pawn.sprite.position.set(pawn.x, groundY + PAWN_H * 0.5 + 0.02, pawn.z);
  }
}
