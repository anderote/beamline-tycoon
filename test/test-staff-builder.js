// test/test-staff-builder.js
//
// Guards the staff figurine builder against the failures that would be
// invisible in a unit test but glaring in the game: figures planted at the
// wrong origin (shin-deep in the slab, or hovering), meshes that don't cast
// shadows, and role tells (hard hat vs hair) silently dropping out.
//
// THREE is a CDN global in the app, so the module reads it off `global` here.
// The stub records geometry dimensions and pivot translations, which is all
// the bounds math below needs — there are no rotations at build time.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildStaffFigure,
  disposeStaffFigure,
  staffFigureHeight,
  staffStyleHipHeight,
  STAFF_STYLES,
  STAFF_STYLE_LIST,
  STAFF_PALETTES,
  staffPalette,
  DEFAULT_STAFF_STYLE,
  POSES,
  applyPose,
} from '../src/renderer3d/builders/staff-builder.js';

// --- THREE stub ------------------------------------------------------------

class Vec3 {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { return this.set(s, s, s); }
}

class Obj3D {
  constructor() {
    this.position = new Vec3();
    this.rotation = new Vec3();
    this.scale = new Vec3().setScalar(1);
    this.children = [];
    this.parent = null;
    this.userData = {};
  }
  add(child) { child.parent = this; this.children.push(child); return this; }
  remove(child) {
    this.children = this.children.filter(c => c !== child);
    if (child.parent === this) child.parent = null;
    return this;
  }
}

class Group extends Obj3D {}

class Mesh extends Obj3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.isMesh = true;
    this.castShadow = false;
    this.receiveShadow = false;
  }
}

class BoxGeometry {
  constructor(w, h, d) { this.kind = 'box'; this.w = w; this.h = h; this.d = d; this.oy = 0; }
  translate(x, y) { this.oy += y; return this; }
  dispose() {}
}

class CylinderGeometry {
  constructor(rTop, rBot, h, segs) {
    this.kind = 'cyl';
    this.rTop = rTop; this.rBot = rBot; this.h = h; this.segs = segs;
    this.w = Math.max(rTop, rBot) * 2; this.d = this.w; this.oy = 0;
  }
  translate(x, y) { this.oy += y; return this; }
  dispose() {}
}

class MeshStandardMaterial {
  constructor(opts) { Object.assign(this, opts); }
  dispose() {}
}

// Minimal color with real RGB<->HSL, so the saturation multiplier is exercised
// rather than silently short-circuited.
class Color {
  constructor(css) {
    const hex = String(css).replace('#', '');
    this.r = parseInt(hex.slice(0, 2), 16) / 255;
    this.g = parseInt(hex.slice(2, 4), 16) / 255;
    this.b = parseInt(hex.slice(4, 6), 16) / 255;
  }
  getHSL(out) {
    const max = Math.max(this.r, this.g, this.b), min = Math.min(this.r, this.g, this.b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === this.r) h = (this.g - this.b) / d + (this.g < this.b ? 6 : 0);
      else if (max === this.g) h = (this.b - this.r) / d + 2;
      else h = (this.r - this.g) / d + 4;
      h /= 6;
    }
    out.h = h; out.s = s; out.l = l;
    return out;
  }
  setHSL(h, s, l) {
    const hue = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    if (s === 0) { this.r = this.g = this.b = l; return this; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    this.r = hue(p, q, h + 1 / 3);
    this.g = hue(p, q, h);
    this.b = hue(p, q, h - 1 / 3);
    return this;
  }
  getHexString() {
    const c = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return c(this.r) + c(this.g) + c(this.b);
  }
}

global.THREE = {
  Group, Mesh, BoxGeometry, CylinderGeometry, MeshStandardMaterial, Color,
};

// --- Helpers ---------------------------------------------------------------

const LOOK = {
  skin: '#d8a878',
  hair: '#123456',        // distinctive, so hair parts are identifiable
  coat: '#c6c8d4',
  collar: '#3d7dd8',
  trouser: '#2c4470',
  hardHat: false,
};

const look = (over) => ({ ...LOOK, ...over });

/** Every mesh in the figure, with its accumulated world-space Y offset. */
function walkMeshes(node, baseY = 0, out = []) {
  for (const child of node.children) {
    const y = baseY + child.position.y;
    if (child.isMesh) {
      const g = child.geometry;
      out.push({
        mesh: child,
        yMin: y + g.oy - g.h / 2,
        yMax: y + g.oy + g.h / 2,
        width: g.w,
        color: child.material.color,
        kind: g.kind,
      });
    }
    walkMeshes(child, y, out);
  }
  return out;
}

function bounds(figure) {
  const parts = walkMeshes(figure.group);
  return {
    parts,
    min: Math.min(...parts.map(p => p.yMin)),
    max: Math.max(...parts.map(p => p.yMax)),
  };
}

// --- Tests -----------------------------------------------------------------

test('figure builds a group with head, torso, four limbs and their extremities', () => {
  const fig = buildStaffFigure(look(), STAFF_STYLES.osrsClassic);
  for (const key of ['group', 'body', 'head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
    assert.ok(fig[key], `figure is missing handle "${key}"`);
  }
  // 2 thighs + 2 shins + 2 boots + torso + collar + 2 arms + 2 hands + head
  // + hair cap + back-of-head panel = 15.
  assert.equal(fig.parts.length, 15, 'unexpected part count for the plain-hair build');
  assert.equal(walkMeshes(fig.group).length, 15, 'parts[] must list every mesh in the tree');
  assert.equal(fig.group.children.length, 1, 'group holds exactly the bob node');
});

test('the shin is a child of the thigh, pivoting at the knee, and the foot is a child of the shin', () => {
  const fig = buildStaffFigure(look(), STAFF_STYLES.osrsClassic);
  assert.ok(fig.leftShin, 'figure is missing leftShin');
  assert.ok(fig.rightShin, 'figure is missing rightShin');
  assert.equal(fig.leftShin.parent, fig.leftLeg, 'left shin should be a child of the left thigh');
  assert.equal(fig.rightShin.parent, fig.rightLeg, 'right shin should be a child of the right thigh');

  // The thigh now carries only the shin; the boot moved down to the shin.
  assert.equal(fig.leftLeg.children.length, 1, 'the thigh should carry only the shin');
  assert.equal(fig.leftLeg.children[0], fig.leftShin);
  assert.equal(fig.leftShin.children.length, 1, 'the shin should carry the boot');
  assert.equal(fig.leftShin.children[0].parent, fig.leftShin, 'the foot must be a child of the shin');
  assert.equal(fig.rightShin.children[0].parent, fig.rightShin);

  // Existing walk code rotates leftLeg.rotation.x directly and must keep
  // working unchanged with the shin sitting at zero rotation.
  assert.equal(fig.leftShin.rotation.x, 0, 'the knee starts at rest');
  assert.equal(fig.rightShin.rotation.x, 0);
});

test('long hair adds side panels', () => {
  const plain = buildStaffFigure(look(), STAFF_STYLES.osrsClassic);
  const longHair = buildStaffFigure(look({ longHair: true }), STAFF_STYLES.osrsClassic);
  assert.equal(longHair.parts.length, plain.parts.length + 2);
});

test('every mesh casts a shadow and none receive one', () => {
  for (const style of STAFF_STYLE_LIST) {
    for (const hardHat of [false, true]) {
      const fig = buildStaffFigure(look({ hardHat }), style);
      for (const p of walkMeshes(fig.group)) {
        assert.equal(p.mesh.castShadow, true, `${style.id}: a mesh does not cast a shadow`);
        assert.equal(p.mesh.receiveShadow, false, `${style.id}: a mesh receives shadows`);
      }
    }
  }
});

test('feet are planted at y=0 and the figure tops out at its style height', () => {
  // The regression most likely to bite: a wrong origin puts staff shin-deep in
  // the floor or floating above it.
  for (const style of STAFF_STYLE_LIST) {
    for (const hardHat of [false, true]) {
      for (const longHair of [false, true]) {
        const b = bounds(buildStaffFigure(look({ hardHat, longHair }), style));
        assert.ok(Math.abs(b.min) < 1e-9,
          `${style.id} (hat=${hardHat}): lowest point is ${b.min}, expected 0`);
        assert.ok(Math.abs(b.max - style.height) < 1e-9,
          `${style.id} (hat=${hardHat}): top is ${b.max}, expected ${style.height}`);
      }
    }
  }
  assert.equal(staffFigureHeight(), DEFAULT_STAFF_STYLE.height);
  assert.ok(Math.abs(DEFAULT_STAFF_STYLE.height - 1.35) < 1e-9,
    'default figure height should stay at the ~1.35 silhouette the sprites had');
});

test('role variation: hard hat replaces the hair cap, and the brim overhangs the head', () => {
  // Pinned to a style with saturation 1 and no face, so material colors come
  // through untinted and the only non-look colors up top are the hat's.
  const bare = buildStaffFigure(look({ hardHat: false }), STAFF_STYLES.osrsClassic);
  const hairParts = walkMeshes(bare.group).filter(p => p.color === LOOK.hair);
  assert.ok(hairParts.length >= 2, 'non-hard-hat roles should get hair parts');

  const hatted = buildStaffFigure(look({ hardHat: true }), STAFF_STYLES.osrsClassic);
  const hatMeshes = walkMeshes(hatted.group);
  assert.equal(hatMeshes.filter(p => p.color === LOOK.hair).length, 0,
    'a hard hat must replace the hair, not sit on top of it');

  // The hat is the two meshes sharing a color that appears nowhere in `look`.
  const lookColors = new Set(Object.values(LOOK).filter(v => typeof v === 'string'));
  const headTop = Math.max(...hatMeshes.map(p => p.yMax));
  const hat = hatMeshes.filter(p => !lookColors.has(p.color) && p.yMax > headTop * 0.8);
  assert.equal(hat.length, 2, 'hard hat should be a crown plus a brim');

  const head = hatMeshes.find(p => p.color === LOOK.skin && p.yMax > headTop * 0.8);
  const brim = hat.reduce((a, b) => (a.width > b.width ? a : b));
  assert.ok(brim.width > head.width, 'the brim must overhang the head to read as a hat');
});

test('style config drives limb construction', () => {
  const faceted = walkMeshes(buildStaffFigure(look(), STAFF_STYLES.osrsClassic).group);
  assert.ok(faceted.some(p => p.kind === 'cyl'), 'the faceted style should use cylinders');
  assert.ok(faceted.filter(p => p.kind === 'cyl').every(p => p.mesh.geometry.segs <= 6),
    'OSRS Classic limbs should stay at 6 facets');

  const blocky = walkMeshes(buildStaffFigure(look(), STAFF_STYLES.blockyMinifig).group);
  // The collar band is a ring in every style; limbs and torso are the boxes.
  assert.equal(blocky.filter(p => p.kind === 'cyl').length, 1,
    'the all-box style should only keep the collar ring as a cylinder');

  const smooth = walkMeshes(buildStaffFigure(look(), STAFF_STYLES.smoothSoft).group);
  assert.ok(smooth.filter(p => p.kind === 'cyl').every(p => p.mesh.geometry.segs === 12),
    'the smooth style should raise the segment count');
  assert.equal(smooth[0].mesh.material.flatShading, false);
  assert.equal(faceted[0].mesh.material.flatShading, true);

  const faced = buildStaffFigure(look(), STAFF_STYLES.facedScout);
  assert.equal(faced.parts.length, 17, 'the faced style adds two eye dabs');
  assert.equal(faced.head.children.length, 2, 'eye dabs ride on the head');
});

test('saturation multiplier shifts the palette without touching the base style', () => {
  const plain = buildStaffFigure(look(), STAFF_STYLES.osrsClassic);
  const bold = buildStaffFigure(look(), STAFF_STYLES.boldToon);
  assert.equal(plain.torso.material.color, LOOK.coat);
  assert.notEqual(bold.torso.material.color, LOOK.coat,
    'a saturation multiplier above 1 should repaint the coat');
});

test('height jitter scales the whole figure', () => {
  const fig = buildStaffFigure(look({ heightScale: 1.04 }));
  assert.ok(Math.abs(fig.group.scale.y - 1.04) < 1e-9);
  assert.equal(buildStaffFigure(look()).group.scale.y, 1, 'no jitter means no scaling');
});

test('geometries and materials are shared between figures', () => {
  const a = buildStaffFigure(look());
  const b = buildStaffFigure(look());
  assert.equal(a.torso.geometry, b.torso.geometry, 'geometry cache should be shared');
  assert.equal(a.torso.material, b.torso.material, 'material cache should be shared');
});

test('disposeStaffFigure detaches without freeing the shared caches', () => {
  const parent = new Group();
  const a = buildStaffFigure(look());
  const b = buildStaffFigure(look());
  parent.add(a.group);
  parent.add(b.group);
  const sharedGeo = a.torso.geometry;
  let disposed = false;
  sharedGeo.dispose = () => { disposed = true; };

  disposeStaffFigure(a);
  assert.equal(parent.children.length, 1, 'the figure should be detached from its parent');
  assert.equal(a.parts.length, 0, 'part references should be dropped');
  assert.equal(disposed, false, 'shared geometry must survive one pawn leaving');
  assert.equal(b.torso.geometry, sharedGeo, 'the other pawn still points at it');
});

test('the default style is one of the reviewable variants and drives the walk', () => {
  assert.ok(STAFF_STYLE_LIST.includes(DEFAULT_STAFF_STYLE));
  assert.equal(STAFF_STYLE_LIST.length, 7, 'the gallery expects seven variants');
  assert.equal(DEFAULT_STAFF_STYLE.id, 'rct2Peep');
  assert.ok(DEFAULT_STAFF_STYLE.swingAmp > 0, 'StaffPawns reads swingAmp off the style');
  for (const s of STAFF_STYLE_LIST) {
    assert.ok(s.id && s.name && s.note, `variant ${s.id} needs a name and a note`);
    assert.ok(STAFF_PALETTES[s.palette], `variant ${s.id} names a palette that exists`);
  }
});

test('every palette is complete, and the RCT2 one carries its sampled values', () => {
  for (const [id, pal] of Object.entries(STAFF_PALETTES)) {
    for (const key of ['skins', 'hairs', 'coats']) {
      assert.ok(Array.isArray(pal[key]) && pal[key].length > 0, `${id}.${key} must be non-empty`);
    }
    for (const key of ['hardHat', 'boot', 'eye']) {
      assert.match(pal[key], /^#[0-9a-f]{6}$/i, `${id}.${key} must be a hex color`);
    }
    for (const role of ['operator', 'technician', 'scientist', 'engineer']) {
      const r = pal.roles[role];
      assert.ok(r, `${id} is missing role ${role}`);
      assert.match(r.collar, /^#[0-9a-f]{6}$/i);
      assert.match(r.trouser, /^#[0-9a-f]{6}$/i);
      assert.equal(typeof r.hardHat, 'boolean');
    }
  }
  // Spot-check values read out of the sprite sheets, so a careless edit that
  // reverts to guessed colors gets caught.
  const rct2 = STAFF_PALETTES.rct2;
  assert.equal(rct2.roles.technician.collar, '#db4f00', 'sampled RCT2 orange');
  assert.equal(rct2.roles.engineer.collar, '#47af27', 'sampled RCT2 green');
  assert.equal(rct2.hardHat, '#f3cb1b', 'sampled RCT2 hard-hat yellow');
  assert.equal(rct2.boot, '#233333', 'RCT2 shadows land on teal-grey, not brown-black');
  // With the role color on the torso, every role shares one dark neutral leg
  // so the figure does not read as an unbroken colored column.
  const trousers = new Set(Object.values(rct2.roles).map(r => r.trouser));
  assert.equal(trousers.size, 1, 'RCT2 roles should share one trouser color');
  assert.equal([...trousers][0], '#3f5353');

  // The title-screen palette is the record of the pre-RCT2 look; the six
  // earlier variants render from it and must not drift.
  assert.deepEqual(STAFF_PALETTES.titleScreen.skins, ['#d8a878', '#b0784f', '#e8c9a2']);
  assert.equal(STAFF_PALETTES.titleScreen.roles.operator.collar, '#3d7dd8');

  // staffPalette() is the lookup StaffPawns and the gallery both go through.
  assert.equal(staffPalette(STAFF_STYLES.rct2Peep), rct2);
  assert.equal(staffPalette(STAFF_STYLES.osrsClassic), STAFF_PALETTES.titleScreen);
  assert.equal(staffPalette({ palette: 'nope' }), STAFF_PALETTES.titleScreen,
    'an unknown palette name should fall back, not crash');
});

test('rct2Peep wears the role color as a uniform and has a face', () => {
  const style = STAFF_STYLES.rct2Peep;
  assert.equal(style.roleUniform, true);
  assert.equal(style.face, true);
  assert.equal(style.mouth, true);
  assert.equal(style.flatShading, true, 'RCT2 sprites read as flat color');

  // Chibi: the head box alone is a much larger share of the figure than the
  // OSRS variants, and the legs are correspondingly shorter.
  assert.ok(style.headRatio > STAFF_STYLES.osrsClassic.headRatio,
    'RCT2 peeps have bigger heads than the OSRS build');
  assert.ok(style.legFrac < STAFF_STYLES.osrsClassic.legFrac,
    'RCT2 peeps have shorter legs than the OSRS build');
  assert.ok(style.height / (style.height * style.headRatio) < 4,
    'the figure should come in under 4 heads tall');

  const uni = buildStaffFigure(look(), style);
  const plain = buildStaffFigure(look(), STAFF_STYLES.facedScout);
  // The uniform recolors existing parts rather than adding any; the only extra
  // mesh over the faced build is the mouth dab.
  assert.equal(uni.parts.length, plain.parts.length + 1,
    'the uniform build should add only the mouth dab');

  // Torso and both arms share one uniform material, and it is not the coat's.
  assert.equal(uni.torso.material, uni.leftArm.material,
    'torso and arms must wear the same uniform material');
  assert.equal(uni.torso.material, uni.rightArm.material);
  assert.notEqual(uni.torso.material.color, LOOK.coat,
    'the torso must be the role color, not the lab-coat color');

  // Without the flag the torso goes back to being the coat.
  const accent = buildStaffFigure(look(), STAFF_STYLES.osrsClassic);
  assert.equal(accent.torso.material.color, LOOK.coat);

  // Feet still planted, top still at the style height, with all the extras on.
  const b = bounds(uni);
  assert.ok(Math.abs(b.min) < 1e-9, `rct2Peep sole at ${b.min}`);
  assert.ok(Math.abs(b.max - style.height) < 1e-9, `rct2Peep top at ${b.max}`);
});

test('face dabs scale with the head, and the mouth is opt-in', () => {
  const faced = buildStaffFigure(look(), STAFF_STYLES.facedScout);
  const peep = buildStaffFigure(look(), STAFF_STYLES.rct2Peep);
  assert.equal(faced.head.children.length, 2, 'two eyes, no mouth');
  assert.equal(peep.head.children.length, 3, 'two eyes plus a mouth');

  // Bigger head => proportionally bigger eyes, not pinpricks.
  const facedEye = faced.head.children[0].geometry.w;
  const peepEye = peep.head.children[0].geometry.w;
  assert.ok(peepEye > facedEye,
    `chibi eyes (${peepEye}) should be larger than standard (${facedEye})`);

  // The old H-relative formula must be preserved exactly for the baseline
  // headRatio, so facedScout's face is untouched by the rework.
  assert.ok(Math.abs(facedEye - STAFF_STYLES.facedScout.height * 0.033) < 1e-12,
    `facedScout eye width drifted: ${facedEye}`);
});

// --- Poses -------------------------------------------------------------

test('POSES defines all seven states with finite joint targets', () => {
  const expectedIds = ['stand', 'walk', 'sit', 'deskWork', 'benchWork', 'carry', 'push'];
  assert.deepEqual(Object.keys(POSES).sort(), expectedIds.sort());
  for (const [id, pose] of Object.entries(POSES)) {
    for (const joint of ['hip', 'knee', 'torsoLean', 'armL', 'armR', 'headTilt']) {
      assert.equal(typeof pose[joint], 'number', `${id}.${joint} must be a number`);
      assert.ok(Number.isFinite(pose[joint]), `${id}.${joint} must be finite`);
    }
  }
});

test('applyPose eases hip and knee toward sit, then back toward stand', () => {
  const fig = buildStaffFigure(look(), STAFF_STYLES.osrsClassic);

  applyPose(fig, 'sit', 1);
  // hip -pi/2, knee +pi/2: rotation.x = -pi/2 sends the hip-to-knee offset to
  // z = +sin(pi/2) (forward, since front is +Z — see the forward-kinematics
  // test below for the worked-out math and why the signs are this way round).
  assert.ok(Math.abs(fig.leftLeg.rotation.x - (-Math.PI / 2)) < 0.01,
    `hip should ease to ~-pi/2 sitting, got ${fig.leftLeg.rotation.x}`);
  assert.ok(Math.abs(fig.rightLeg.rotation.x - (-Math.PI / 2)) < 0.01);
  assert.ok(Math.abs(fig.leftShin.rotation.x - (Math.PI / 2)) < 0.01,
    `knee should ease to ~+pi/2 sitting, got ${fig.leftShin.rotation.x}`);
  assert.ok(Math.abs(fig.rightShin.rotation.x - (Math.PI / 2)) < 0.01);

  applyPose(fig, 'stand', 1);
  assert.ok(Math.abs(fig.leftLeg.rotation.x) < 0.01,
    `hip should ease back to ~0, got ${fig.leftLeg.rotation.x}`);
  assert.ok(Math.abs(fig.leftShin.rotation.x) < 0.01,
    `knee should ease back to ~0, got ${fig.leftShin.rotation.x}`);
});

test('walk and stand share identical (zero) targets, so a swing overlay never fights sit', () => {
  assert.deepEqual(POSES.walk, POSES.stand);
});

// Forward kinematics, worked out by hand — no THREE involved. This is the
// only way the headless suite can catch a joint-direction sign error: the
// THREE stub at the top of this file records geometry dimensions, not
// transforms, so a rotation.x with the wrong sign is invisible to every test
// above. This test caught a real bug: an earlier version of POSES.sit used
// hip: +PI/2, knee: -PI/2, which (verified against real three@0.160, not
// this stub) folds the legs to z = -0.5 — BEHIND the pawn, since front is
// +Z — instead of in front of it.
function rotateAboutX(v, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

/**
 * Hip-relative knee/foot offsets for a pose, replicating exactly what the
 * THREE scene graph computes: the thigh is a rest vector straight down
 * (0,-len,0) rotated by the hip; the shin is a child of the thigh, so its
 * rotation is the hip's PLUS its own (rotations about the same axis
 * compose additively for a chain of parent/child Object3Ds).
 */
function legForwardKinematics(pose, thighLen = 1, shinLen = 1) {
  const knee = rotateAboutX({ x: 0, y: -thighLen, z: 0 }, pose.hip);
  const shin = rotateAboutX({ x: 0, y: -shinLen, z: 0 }, pose.hip + pose.knee);
  const foot = { x: knee.x + shin.x, y: knee.y + shin.y, z: knee.z + shin.z };
  return { knee, foot };
}

test('sit and deskWork fold the legs forward (+Z), not backward; stand stays put', () => {
  for (const id of ['sit', 'deskWork']) {
    const { knee, foot } = legForwardKinematics(POSES[id]);
    assert.ok(knee.z > 0.1, `${id}: knee should project in front of the hip (+Z), got z=${knee.z}`);
    assert.ok(foot.z > 0.1, `${id}: foot should project in front of the hip (+Z), got z=${foot.z}`);
  }

  const stand = legForwardKinematics(POSES.stand);
  assert.ok(Math.abs(stand.knee.z) < 1e-9, `stand should keep the knee at z~0, got ${stand.knee.z}`);
  assert.ok(Math.abs(stand.foot.z) < 1e-9, `stand should keep the foot at z~0, got ${stand.foot.z}`);
});

test('staffStyleHipHeight sits between the floor and the top of the figure', () => {
  for (const style of STAFF_STYLE_LIST) {
    const hip = staffStyleHipHeight(style);
    assert.ok(hip > 0 && hip < style.height,
      `${style.id}: hip height ${hip} should be within (0, ${style.height})`);
  }
  assert.equal(staffStyleHipHeight(), staffStyleHipHeight(DEFAULT_STAFF_STYLE));
});
