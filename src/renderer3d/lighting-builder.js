// src/renderer3d/lighting-builder.js
// Geometry for the facility lighting fixtures (src/data/placeables/
// lighting.js). THREE is a CDN global — do NOT import it.
//
// This module owns geometry only. It does NOT emit light (no THREE.Light),
// does NOT ramp glow with time of day, and does NOT decide where a fixture
// sits in world space. Every fixture is built in a documented local-space
// convention so placement code can position/rotate the returned group without knowing
// anything about its internals:
//
//   - mount: 'ground'   — origin sits at the fixture's base (y=0, ground
//     level). The whole footprint centering + dir rotation is handled by
//     the caller (decoration-builder.js), exactly like any other decoration.
//   - mount: 'wall'     — origin is the wall-mounting point: the backplate
//     is flush with local z=0, fixture protrudes toward +z. Placement puts
//     this point on the wall edge at `def.light.emitterY` height and rotates
//     to match the chosen face.
//   - mount: 'overhead' — origin is the ceiling attachment point (top of the
//     stem/chain); the fixture hangs down into -y from there. Placement
//     translates this point to its authored mounting height above
//     the floor tile.
//   - mount: 'surface'  — origin sits on the supporting worktop. Stacking
//     supplies that worktop height; the fixture itself extends upward.
//
// Art direction: the lamp family (lamppost, doubleLamppost, bollardLight,
// highMastLight) and wallSconce share the lamppost's patina-teal cast iron —
// they are literally the same product line. bulkheadLight, floodLight and
// highBay are harder industrial hardware (grey / charcoal) — the same mix
// of "ornamental" vs. "utility" metal already present in the original
// lamppost/bollardLight/spotLight trio. ceilingPanel is pale office plastic.
//
// Every builder retains its glow material(s) on `group.userData.emitterMaterial`
// (a single THREE.Material, shared across multiple emitter meshes when a
// fixture has more than one, e.g. doubleLamppost's twin heads) so Task 6 can
// ramp `emissiveIntensity` with darkness. Solid/structural meshes get
// `castShadow = true` to keep catching the sun's shadow map, exactly like the
// decorations this replaces; glow/lens meshes never cast (fixtures don't
// shadow themselves, and they don't get a real light source until Task 9).
// Non-essential ornamental meshes are tagged `userData.lod = 'detail'` so
// ThreeRenderer's zoom-based LOD pass can drop them at a distance.

import {
  aimYaw,
  fixtureLightProjection,
  isAimedFixture,
  lightPoolRadius,
} from './fixture-light-math.js';
import { SOFT_GLOW_LAYER } from './glow-pipeline.js';

export { aimYaw, isAimedFixture } from './fixture-light-math.js';

const SUB = 0.5; // 1 sub-tile = 0.5 world units — must match decoration-builder.js

// A dim, deliberately "off" baseline. Task 6 (below) overwrites this every
// frame once darkness rises; this is what a fixture looks like at noon.
export const EMITTER_BASE_INTENSITY = 0.15;

/**
 * Compatibility wrapper used by existing callers/tests that only have a light
 * block. Production pool and real-light paths call fixtureLightProjection
 * directly with the authored mount and emitter height.
 * @param {number} [dir] - 0-3 quarter turns; ignored for non-cone shapes.
 * @returns {{rx:number, rz:number, offsetX:number, offsetZ:number}}
 */
export function poolFootprint(light, dir = 0) {
  if (!light) return { rx: 0, rz: 0, offsetX: 0, offsetZ: 0 };
  const def = { mount: 'ground', light: { emitterY: 1, ...light } };
  return fixtureLightProjection(def, { yaw: aimYaw(dir) }).groundFootprint;
}

// --- Real-light handoff (light-rig.js) --------------------------------------
// The rig (src/renderer3d/light-rig.js) hands its bounded shadow SpotLights
// to the nearest few fixtures on camera; every other fixture keeps the cheap
// painted pool below. The two systems meet through ONE tag —
// `group.userData.lightFixture` — stamped by decoration-builder.js from
// fixtureLightTag(). Keeping the tag pure (no THREE, no scene graph) is what
// lets the aim/height math be unit tested headlessly, and keeps the rig from
// having to know anything about LIGHTING_DEFS' schema.

/**
 * Height of the emitter ABOVE THE FIXTURE GROUP'S ORIGIN.
 *
 * NOT a copy of `def.light.emitterY`. emitterY is measured from the MOUNT
 * SURFACE, and each mount puts the group origin somewhere different (see this
 * file's header): a ground fixture's origin is on the floor, so the emitter
 * really is emitterY above it — but a wall fixture's origin IS the mounting
 * point at emitterY up the wall, and an overhead fixture's origin is the
 * ceiling attachment. Copying emitterY raw would hang a wall sconce's spot
 * ~2.1 m above its own geometry.
 *
 * Hanging fixtures may add sourceOffsetY because their group origin is the
 * ceiling attachment, not the glowing diffuser at the bottom of the housing.
 * fixtureLightProjection consumes the same correction, so real light and the
 * painted pool stay attached to the same visible source.
 */
function _emitterOffsetY(def) {
  const sourceOffsetY = def?.light?.sourceOffsetY ?? 0;
  return (def?.mount === 'ground' || def?.mount === 'surface')
    ? (def.light?.emitterY ?? 0) + sourceOffsetY
    : sourceOffsetY;
}

/**
 * The per-fixture data packet the light rig consumes. Pure (no THREE), so it
 * can be built at decoration-build time and asserted in Node.
 *
 * `coneDeg`/`radius` default to 0 rather than to some plausible cone — the rig
 * reads 0 as "this def didn't say", and falls back to its own tuning
 * constants, so a malformed def degrades to the generic spot instead of
 * silently inheriting a wrong-looking beam.
 *
 * @param {object} def - a LIGHTING_DEFS entry.
 * @param {{id?:*, dir?:number}} [placement] - the placement's id (the key the
 *   rig publishes suppression under — it must match the id in ThreeRenderer's
 *   `lightingGroup` registry) and 0-3 quarter-turn dir.
 * @returns {object|null} null when the def carries no light block.
 */
export function fixtureLightTag(def, { id, dir = 0 } = {}) {
  const light = def?.light;
  if (!light) return null;
  const aimed = isAimedFixture(def);
  return {
    id,
    offsetY: _emitterOffsetY(def),
    color: light.color,
    intensity: light.intensity ?? 1,
    radius: lightPoolRadius(light),
    poolRadius: lightPoolRadius(light),
    shape: light.shape ?? 'point',
    coneDeg: light.coneDeg ?? 0,
    beamAngleDeg: light.beamAngleDeg ?? light.coneDeg ?? 0,
    tiltDeg: light.tiltDeg ?? 0,
    targetDistance: light.targetDistance ?? 0,
    maxGroundRange: light.maxGroundRange ?? 0,
    emitterY: light.emitterY ?? 0,
    sourceOffsetY: light.sourceOffsetY ?? 0,
    mount: def.mount ?? 'ground',
    penumbra: light.penumbra,
    sourceRadius: light.sourceRadius ?? 0.1,
    shadowSoftness: light.shadowSoftness ?? light.penumbra ?? 0.5,
    bloomProfile: light.bloomProfile ?? 'soft',
    volumeProfile: light.volumeProfile ?? 'none',
    dynamicProfile: light.dynamicProfile ?? 'steady',
    cookieProfile: light.cookieProfile ?? 'soft',
    aimed,
    aimYaw: aimed ? aimYaw(dir) : 0,
  };
}

function _dims(def) {
  return {
    footW: (def.subW ?? 1) * SUB,
    footL: (def.subL ?? 1) * SUB,
    totalH: (def.subH ?? 1) * SUB,
  };
}

function _mat(hex, opts = {}) {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6, metalness: 0.35, ...opts });
}

function _emitterMat(colorCss) {
  return new THREE.MeshStandardMaterial({
    color: colorCss,
    emissive: colorCss,
    emissiveIntensity: EMITTER_BASE_INTENSITY,
    roughness: 0.35,
  });
}

// --- Shared palettes -------------------------------------------------------
// Patina teal cast iron — the lamppost's original look, now shared by the
// whole "lamp" product line plus the warm wall sconce.
const TEAL_METAL = 0x3a5e5e;
const TEAL_FRAME = 0x24383a;
// Grey utility metal — caged/industrial fixtures.
const GREY_METAL = 0x48484a;
const GREY_FRAME = 0x35353a;
// Charcoal — hard-edged floods and high bays.
const CHARCOAL = 0x333336;
const CHARCOAL_FRAME = 0x232326;
// Pale office plastic — ceiling panel housing.
const PANEL_LIGHT = 0xc9ced4;

// --- Ground — lamp family ---------------------------------------------------

// Lamppost: patina-teal cast-iron post, stepped plinth, boxy lantern head.
// Ported from decoration-builder.js's original _lamppost, now parameterized
// by the def's own totalH/emitterY instead of a hardcoded ratio.
function _buildLamppost(def) {
  const { totalH } = _dims(def);
  const emitterY = def.light.emitterY;
  const group = new THREE.Group();
  const metalMat = _mat(TEAL_METAL);
  const frameMat = _mat(TEAL_FRAME, { roughness: 0.55, metalness: 0.4 });
  const glowMat = _emitterMat(def.light.color);

  const poleH = Math.max(emitterY - 0.29, totalH * 0.4);

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.2), metalMat);
  plinth.position.y = 0.045;
  plinth.castShadow = true;
  group.add(plinth);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.06, 8), metalMat);
  collar.position.y = 0.12;
  collar.userData.lod = 'detail';
  group.add(collar);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.038, poleH, 8), metalMat);
  pole.position.y = poleH / 2 + 0.15;
  pole.castShadow = true;
  group.add(pole);

  const topCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.05, 8), metalMat);
  topCollar.position.y = poleH + 0.15 + 0.025;
  topCollar.userData.lod = 'detail';
  group.add(topCollar);

  const lanternY = emitterY;
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.14), glowMat);
  glow.position.y = lanternY;
  group.add(glow);

  const capTop = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.18), frameMat);
  capTop.position.y = lanternY + 0.1;
  capTop.castShadow = true;
  group.add(capTop);

  const capBot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.17), frameMat);
  capBot.position.y = lanternY - 0.095;
  capBot.userData.lod = 'detail';
  group.add(capBot);

  const finial = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 4), frameMat);
  finial.position.y = lanternY + 0.15;
  finial.rotation.y = Math.PI / 4;
  finial.userData.lod = 'detail';
  group.add(finial);

  group.userData.emitterMaterial = glowMat;
  return group;
}

// Double lamppost: same pole family, twin lantern heads on a crossarm.
function _buildDoubleLamppost(def) {
  const emitterY = def.light.emitterY;
  const group = new THREE.Group();
  const metalMat = _mat(TEAL_METAL);
  const frameMat = _mat(TEAL_FRAME, { roughness: 0.55, metalness: 0.4 });
  const glowMat = _emitterMat(def.light.color);

  const poleH = Math.max(emitterY - 0.2, 1.2);

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.22), metalMat);
  plinth.position.y = 0.05;
  plinth.castShadow = true;
  group.add(plinth);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.042, poleH, 8), metalMat);
  pole.position.y = poleH / 2 + 0.1;
  pole.castShadow = true;
  group.add(pole);

  // Horizontal crossarm carrying a lantern at each end.
  const armY = poleH + 0.1;
  const crossarm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.03), frameMat);
  crossarm.position.y = armY;
  crossarm.castShadow = true;
  group.add(crossarm);

  for (const xs of [-1, 1]) {
    const dropY = armY - 0.06;
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.06, 6), metalMat);
    drop.position.set(xs * 0.12, armY - 0.03, 0);
    group.add(drop);

    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.12), glowMat);
    glow.position.set(xs * 0.12, dropY - 0.04, 0);
    group.add(glow);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.15), frameMat);
    cap.position.set(xs * 0.12, dropY + 0.03, 0);
    cap.castShadow = true;
    cap.userData.lod = 'detail';
    group.add(cap);
  }

  group.userData.emitterMaterial = glowMat;
  return group;
}

// Bollard light: short squat cylinder with glowing top cap. Rescaled off
// emitterY (0.4 m — ankle height) rather than the old fixed 0.9 m body;
// now part of the teal lamp family instead of standalone grey metal.
function _buildBollardLight(def) {
  const emitterY = def.light.emitterY;
  const group = new THREE.Group();
  const metalMat = _mat(TEAL_METAL, { metalness: 0.5, roughness: 0.5 });
  const glowMat = _emitterMat(def.light.color);

  const capOffset = 0.06;
  const topOffset = 0.135;
  const bodyH = Math.max(emitterY - capOffset, 0.15);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, bodyH, 12), metalMat);
  body.position.y = bodyH / 2;
  body.castShadow = true;
  group.add(body);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 12), glowMat);
  cap.position.y = bodyH + capOffset;
  group.add(cap);

  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12), metalMat);
  top.position.y = bodyH + topOffset;
  top.userData.lod = 'detail';
  group.add(top);

  group.userData.emitterMaterial = glowMat;
  return group;
}

// High mast light: tall galvanized mast (same teal family) topped by a
// cross-bracket luminaire rack of four small heads — parking-lot mast look.
function _buildHighMastLight(def) {
  const { footW, footL } = _dims(def);
  const emitterY = def.light.emitterY;
  const group = new THREE.Group();
  const metalMat = _mat(TEAL_METAL);
  const frameMat = _mat(TEAL_FRAME, { roughness: 0.55, metalness: 0.4 });
  const glowMat = _emitterMat(def.light.color);

  const baseW = Math.min(footW, footL) * 0.5;
  const baseH = 0.18;
  const base = new THREE.Mesh(new THREE.BoxGeometry(baseW, baseH, baseW), metalMat);
  base.position.y = baseH / 2;
  base.castShadow = true;
  group.add(base);

  const rackY = emitterY;
  const poleH = Math.max(rackY - baseH - 0.15, 1);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, poleH, 10), metalMat);
  pole.position.y = baseH + poleH / 2;
  pole.castShadow = true;
  group.add(pole);

  // Cross-bracket rack at the top, four downward-facing heads.
  const rack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.5), frameMat);
  rack.position.y = rackY;
  rack.castShadow = true;
  rack.userData.lod = 'detail';
  group.add(rack);

  for (const [xs, zs] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), frameMat);
    head.position.set(xs * 0.2, rackY - 0.05, zs * 0.2);
    head.userData.lod = 'detail';
    group.add(head);

    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.015, 8), glowMat);
    glow.position.set(xs * 0.2, rackY - 0.09, zs * 0.2);
    group.add(glow);
  }

  group.userData.emitterMaterial = glowMat;
  return group;
}

// --- Ground — aimed flood ----------------------------------------------------

// Flood light: angled head on a short post, harsh near-white lens. Ported
// from the original _spotLight; charcoal utility housing rather than
// ornamental cast iron. Authored facing local +x — buildLightFixture yaws
// the whole group to the placement's aim direction.
function _buildFloodLight(def) {
  const emitterY = def.light.emitterY;
  const tilt = (def.light.tiltDeg ?? 35) * Math.PI / 180;
  const group = new THREE.Group();
  const metalMat = _mat(CHARCOAL, { roughness: 0.4, metalness: 0.8 });
  const glowMat = _emitterMat(def.light.color);

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.14), metalMat);
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  const postH = Math.max(emitterY - 0.15, 0.1);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, postH, 6), metalMat);
  post.position.y = 0.05 + postH / 2;
  post.userData.lod = 'detail';
  group.add(post);

  const headY = 0.05 + postH + 0.05;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 12), metalMat);
  head.position.set(0.04, headY, 0);
  // CylinderGeometry points along +Y. Rotate its axis onto the authored
  // forward-and-down beam direction; the old sign put the visible lens above
  // the head while the actual SpotLight aimed down.
  head.rotation.z = tilt + Math.PI;
  head.castShadow = true;
  group.add(head);

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.02, 12), glowMat);
  lens.position.set(0.04 + 0.1 * Math.sin(tilt), headY - 0.1 * Math.cos(tilt), 0);
  lens.rotation.z = tilt + Math.PI;
  group.add(lens);

  group.userData.emitterMaterial = glowMat;
  return group;
}

// --- Wall -------------------------------------------------------------------
// Origin = wall mounting point (backplate flush at local z=0, fixture
// protrudes to +z). Placement positions/rotates this to a wall face.

// Wall sconce: warm teal-family fixture — a bracket arm off a backplate
// holding a glowing glass shade, same product line as the lamppost.
function _buildWallSconce(def) {
  const group = new THREE.Group();
  const metalMat = _mat(TEAL_METAL);
  const frameMat = _mat(TEAL_FRAME, { roughness: 0.55, metalness: 0.4 });
  const glowMat = _emitterMat(def.light.color);

  const backplate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.02), metalMat);
  backplate.position.z = 0.01;
  backplate.castShadow = true;
  group.add(backplate);

  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6), metalMat);
  arm.rotation.x = Math.PI / 2;
  arm.position.z = 0.08;
  arm.userData.lod = 'detail';
  group.add(arm);

  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.12, 10), frameMat);
  shade.rotation.x = Math.PI / 2;
  shade.position.z = 0.15;
  shade.castShadow = true;
  group.add(shade);

  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10), glowMat);
  glow.rotation.x = Math.PI / 2;
  glow.position.z = 0.21;
  group.add(glow);

  group.userData.emitterMaterial = glowMat;
  return group;
}

// Bulkhead light: caged industrial diffuser — grey utility metal, distinct
// from the ornamental lamp family (same split the original bollard/spot
// pair already drew against the teal lamppost).
function _buildBulkheadLight(def) {
  const group = new THREE.Group();
  const metalMat = _mat(GREY_METAL, { metalness: 0.6 });
  const frameMat = _mat(GREY_FRAME, { metalness: 0.7 });
  const glowMat = _emitterMat(def.light.color);

  const backplate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.02), metalMat);
  backplate.position.z = 0.01;
  backplate.castShadow = true;
  group.add(backplate);

  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 12), glowMat);
  dome.rotation.x = Math.PI / 2;
  dome.position.z = 0.07;
  group.add(dome);

  // Wire cage: four thin struts around the dome.
  const strutGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.14, 5);
  for (const [xs, ys] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const strut = new THREE.Mesh(strutGeo, frameMat);
    strut.rotation.x = Math.PI / 2;
    strut.position.set(xs * 0.075, ys * 0.075, 0.07);
    strut.userData.lod = 'detail';
    group.add(strut);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.008, 6, 16), frameMat);
  ring.position.z = 0.12;
  ring.userData.lod = 'detail';
  group.add(ring);

  group.userData.emitterMaterial = glowMat;
  return group;
}

function _buildWallStripLight(def) {
  const group = new THREE.Group();
  const frameMat = _mat(GREY_FRAME, { metalness: 0.55, roughness: 0.42 });
  const glowMat = _emitterMat(def.light.color);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.025), frameMat);
  back.position.z = 0.012;
  back.castShadow = true;
  group.add(back);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.075, 0.045), glowMat);
  diffuser.position.z = 0.048;
  group.add(diffuser);
  group.userData.emitterMaterial = glowMat;
  return group;
}

function _buildEmergencyWallLight(def) {
  const group = new THREE.Group();
  const bodyMat = _mat(0x7f8589, { metalness: 0.35, roughness: 0.55 });
  const glowMat = _emitterMat(def.light.color);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.035), bodyMat);
  back.position.z = 0.018;
  back.castShadow = true;
  group.add(back);
  for (const x of [-0.07, 0.07]) {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.07, 10), bodyMat);
    head.rotation.x = Math.PI / 2;
    head.position.set(x, 0.025, 0.075);
    group.add(head);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.012, 10), glowMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(x, 0.025, 0.113);
    group.add(lens);
  }
  group.userData.emitterMaterial = glowMat;
  return group;
}

// --- Overhead ----------------------------------------------------------------
// Origin = ceiling attachment point (top of stem/chain); fixture hangs into
// -y from there. Placement translates this point to the authored height.

// Ceiling panel: pale office housing on a short chain.
function _buildCeilingPanel(def) {
  const group = new THREE.Group();
  const chainMat = _mat(0x8a8d90, { metalness: 0.6, roughness: 0.5 });
  const panelMat = _mat(PANEL_LIGHT, { roughness: 0.7, metalness: 0.1 });
  const glowMat = _emitterMat(def.light.color);

  const chainLen = 0.15;
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, chainLen, 6), chainMat);
  chain.position.y = -chainLen / 2;
  chain.userData.lod = 'detail';
  group.add(chain);

  const panelY = -chainLen - 0.02;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), panelMat);
  panel.position.y = panelY;
  panel.castShadow = true;
  group.add(panel);

  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.01, 0.34), glowMat);
  glow.position.y = panelY - 0.025;
  group.add(glow);

  group.userData.emitterMaterial = glowMat;
  return group;
}

// High bay: industrial bell-shaped reflector pointing straight down —
// charcoal utility housing, same family as the flood light.
function _buildHighBay(def) {
  const group = new THREE.Group();
  const metalMat = _mat(CHARCOAL, { roughness: 0.45, metalness: 0.7 });
  const frameMat = _mat(CHARCOAL_FRAME, { roughness: 0.5, metalness: 0.6 });
  const glowMat = _emitterMat(def.light.color);

  const bracketLen = 0.12;
  const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, bracketLen, 6), frameMat);
  bracket.position.y = -bracketLen / 2;
  bracket.userData.lod = 'detail';
  group.add(bracket);

  const bellY = -bracketLen - 0.08;
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.24, 0.16, 14), metalMat);
  bell.position.y = bellY;
  bell.castShadow = true;
  group.add(bell);

  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.015, 14), glowMat);
  glow.position.y = bellY - 0.08;
  group.add(glow);

  group.userData.emitterMaterial = glowMat;
  return group;
}

function _buildLinearPendant(def) {
  const group = new THREE.Group();
  const frameMat = _mat(GREY_FRAME, { metalness: 0.45, roughness: 0.48 });
  const glowMat = _emitterMat(def.light.color);
  for (const x of [-0.42, 0.42]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6), frameMat);
    cable.position.set(x, -0.09, 0);
    cable.userData.lod = 'detail';
    group.add(cable);
  }
  const housing = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.07, 0.16), frameMat);
  housing.position.y = -0.21;
  housing.castShadow = true;
  group.add(housing);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.012, 0.12), glowMat);
  diffuser.position.y = -0.251;
  group.add(diffuser);
  group.userData.emitterMaterial = glowMat;
  return group;
}

function _buildCleanroomPanel(def) {
  const group = new THREE.Group();
  const frameMat = _mat(PANEL_LIGHT, { roughness: 0.65, metalness: 0.12 });
  const glowMat = _emitterMat(def.light.color);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), frameMat);
  stem.position.y = -0.04;
  group.add(stem);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.055, 0.58), frameMat);
  housing.position.y = -0.105;
  housing.castShadow = true;
  group.add(housing);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.012, 0.5), glowMat);
  diffuser.position.y = -0.139;
  group.add(diffuser);
  group.userData.emitterMaterial = glowMat;
  return group;
}

// --- Surface -----------------------------------------------------------------

function _buildDeskLamp(def) {
  const group = new THREE.Group();
  const metalMat = _mat(TEAL_METAL, { roughness: 0.5, metalness: 0.45 });
  const glowMat = _emitterMat(def.light.color);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.035, 12), metalMat);
  base.position.y = 0.018;
  base.castShadow = true;
  group.add(base);
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.25, 7), metalMat);
  lower.rotation.z = -0.38;
  lower.position.set(0.045, 0.16, 0);
  group.add(lower);
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 7), metalMat);
  upper.rotation.z = 0.58;
  upper.position.set(0.085, 0.36, 0);
  group.add(upper);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.11, 0.11, 12), metalMat);
  shade.rotation.z = Math.PI / 2 + 0.35;
  shade.position.set(0.18, 0.45, 0);
  shade.castShadow = true;
  group.add(shade);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 12), glowMat);
  lens.rotation.z = Math.PI / 2 + 0.35;
  lens.position.set(0.225, 0.432, 0);
  group.add(lens);
  group.userData.emitterMaterial = glowMat;
  return group;
}

function _buildPortableWorkLight(def) {
  const group = new THREE.Group();
  const frameMat = _mat(0xe0a52b, { roughness: 0.48, metalness: 0.32 });
  const bodyMat = _mat(CHARCOAL, { roughness: 0.4, metalness: 0.65 });
  const glowMat = _emitterMat(def.light.color);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.18), frameMat);
  base.position.y = 0.018;
  base.castShadow = true;
  group.add(base);
  const stand = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.014, 6, 14, Math.PI), frameMat);
  stand.rotation.x = Math.PI / 2;
  stand.position.y = 0.13;
  group.add(stand);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.19, 0.1), bodyMat);
  head.position.set(0.04, 0.3, 0);
  head.rotation.z = -0.45;
  head.castShadow = true;
  group.add(head);
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.15, 0.075), glowMat);
  lens.position.set(0.125, 0.26, 0);
  lens.rotation.z = -0.45;
  group.add(lens);
  group.userData.emitterMaterial = glowMat;
  return group;
}

// --- Dispatch ----------------------------------------------------------------

const BUILDERS = {
  lamppost: _buildLamppost,
  doubleLamppost: _buildDoubleLamppost,
  bollardLight: _buildBollardLight,
  highMastLight: _buildHighMastLight,
  floodLight: _buildFloodLight,
  wallSconce: _buildWallSconce,
  bulkheadLight: _buildBulkheadLight,
  wallStripLight: _buildWallStripLight,
  emergencyWallLight: _buildEmergencyWallLight,
  ceilingPanel: _buildCeilingPanel,
  highBay: _buildHighBay,
  linearPendant: _buildLinearPendant,
  cleanroomPanel: _buildCleanroomPanel,
  deskLamp: _buildDeskLamp,
  portableWorkLight: _buildPortableWorkLight,
};

/**
 * Build one lighting fixture's geometry.
 *
 * @param {object} def - a LIGHTING_DEFS entry (id, mount, light block, ...).
 * @param {{dir?:number, face?:string}} [placement] - opaque placement bag.
 *   `dir` (0-3 quarter turns) is read for ground/surface cone fixtures;
 *   wall-facing placement is applied by the caller.
 * @returns {THREE.Group}
 */
export function buildLightFixture(def, placement = {}) {
  const builder = BUILDERS[def.id];
  const group = builder ? builder(def) : _buildFallback(def);
  const emitterMaterial = group.userData.emitterMaterial;
  group.traverse((child) => {
    if (child.isMesh && child.material === emitterMaterial) {
      child.layers?.enable(SOFT_GLOW_LAYER);
      child.userData ||= {};
      child.userData.glowProfile = 'soft';
    }
  });
  if (isAimedFixture(def)) {
    group.rotation.y = aimYaw(placement.dir);
  }
  return group;
}

// Defensive fallback for an unrecognized id — should never trigger for the
// known fixtures, but keeps the renderer from throwing on a bad def.
function _buildFallback(def) {
  const { footW, footL, totalH } = _dims(def);
  const group = new THREE.Group();
  const mat = _mat(0x888888);
  const box = new THREE.Mesh(new THREE.BoxGeometry(footW * 0.6, totalH * 0.3, footL * 0.6), mat);
  box.position.y = totalH * 0.15;
  box.castShadow = true;
  group.add(box);
  const glowMat = _emitterMat(def.light?.color ?? '#ffffff');
  const glow = new THREE.Mesh(new THREE.BoxGeometry(footW * 0.3, 0.05, footL * 0.3), glowMat);
  glow.position.y = totalH * 0.3 + 0.03;
  group.add(glow);
  group.userData.emitterMaterial = glowMat;
  return group;
}

// --- Task 6: light pools + halos ---------------------------------------------
// The payoff layer: no THREE.Light involved (that's Task 9's real point
// lights). Everything here is a fake — an additive ground pool and a
// billboard sprite — cheap enough for sixty fixtures because the pools are
// merged into ONE mesh (buildLightPools) and rebuilt only when the fixture
// set changes, never per frame. Per-frame work is limited to three scalar
// ramps (see the darkness-ramp section below), driven by ThreeRenderer's
// this._darkness (day-night.js's dayNightGrade().darkness) so pools, halos
// and fixture emissive intensity switch on in lockstep.

// Small lift above the floor plane so the additive pool quad never z-fights
// the floor mesh it's tinting.
const POOL_Y_LIFT = 0.015;

// Extra brightness baked into pool vertex colors (on top of each light's own
// `intensity`) — a global "how punchy do pools read" knob, independent of
// the runtime opacity ramp below.
export const POOL_COLOR_SCALE = 1.1;
// A real spotlight adds wall/object illumination and shadows, but its direct
// cone is not a replacement for the pool's cheap low-frequency bounce. Keep a
// calibrated remainder so slot handoff never collapses the fixture footprint.
export const REAL_LIGHT_POOL_REMAINDER = 0.22;

// Halo sprite size: a small fixed core plus a modest fraction of the
// fixture's pool radius, so a bollard's halo doesn't dwarf a high-mast's.
const HALO_BASE_SIZE = 0.28;
const HALO_SOURCE_FACTOR = 2.2;

// One small procedural radial-gradient texture, generated once and cached
// for the module's lifetime. Both the merged pool mesh and every halo
// sprite sample the SAME texture object — one extra GPU upload regardless
// of fixture count. IMPORTANT for callers: never dispose a pool/halo
// material's `.map` on rebuild, only the material itself (see ThreeRenderer's
// _clearLightGroup) — disposing this shared texture would blank every other
// lamp on the very next rebuild.
let _glowTextureCache = null;
function _glowTexture() {
  if (_glowTextureCache) return _glowTextureCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _glowTextureCache = new THREE.CanvasTexture(canvas);
  return _glowTextureCache;
}

/** Frees the cached glow texture. Call once, on full renderer teardown only. */
export function disposeLightGlowTexture() {
  if (_glowTextureCache) {
    _glowTextureCache.dispose();
    _glowTextureCache = null;
  }
}

/**
 * Wall materials render front-sided for good fill-rate, but a physical wall
 * must block light from either side. THREE's Mesh.raycast honours material
 * side, so temporarily make solid occluders double-sided while the static
 * pool geometry is traced, then restore their render material immediately.
 */
function makePoolOccludersDoubleSided(occluders) {
  const restore = [];
  const visit = (object) => {
    if (!object?.material || object.castShadow === false) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || material.transparent && (material.opacity ?? 1) < 0.98) continue;
      if (material.side === THREE.DoubleSide) continue;
      restore.push([material, material.side]);
      material.side = THREE.DoubleSide;
    }
  };
  for (const occluder of occluders) {
    if (typeof occluder?.traverse === 'function') occluder.traverse(visit);
    else visit(occluder);
  }
  return () => {
    for (const [material, side] of restore) material.side = side;
  };
}

/**
 * Merge every fixture's ground light pool into one additive mesh — the
 * failure mode this exists to avoid is sixty draw calls for sixty lamps.
 * Depth-tested but NOT depth-writing (material below), so overlapping pools
 * and the geometry standing in them are never occluded.
 *
 * highBay is `shape: 'cone'` but NOT aimed (it points straight down — see
 * isAimedFixture) — poolFootprint's ellipse only makes sense for a
 * horizontally-aimed cone, so any non-aimed cone is treated as a circle here
 * (falls back to a `point`-shaped footprint) rather than stretching its pool
 * in an arbitrary direction.
 *
 * The color attribute is RGBA (itemSize 4), not RGB: the alpha lane carries
 * per-quad SUPPRESSION (see applyPoolSuppression) so a fixture that has been
 * handed a real shadow spot can hide its own painted pool without splitting
 * the merged mesh back into per-fixture draw calls. Final on-screen alpha is
 * `material.opacity * vertexAlpha` — the darkness ramp stays entirely on
 * material.opacity (one write per frame for the whole facility) and the alpha
 * lane stays a pure (1 - weight), so neither has to know about the other.
 *
 * @param {Array<{id:*, def:object, group:THREE.Group}>} fixtures - ThreeRenderer.lightingGroup.
 * @param {{occluders?: THREE.Object3D|Array<THREE.Object3D>}} [opts] opaque
 * wall geometry. When present, each pool is traced against it once at rebuild
 * time, so the cheap fallback light never paints through a wall.
 * @returns {THREE.Mesh|null} null when there is nothing to draw.
 */
export function buildLightPools(fixtures, opts = {}) {
  if (!fixtures || !fixtures.length) return null;

  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  let vertCount = 0;
  let poolCount = 0;
  const tmpColor = new THREE.Color();
  // fixture id -> pool index. Built HERE, inline with the loop, rather than
  // derived afterwards by index-of-fixture: the two `continue`s below (no
  // light block; degenerate radius) mean pool index and fixture index are not
  // the same number, and an off-by-one here silently suppresses some OTHER
  // fixture's pool — a bug that looks like a rendering glitch, not a bug.
  const poolQuadByFixtureId = new Map();
  const poolVertexRanges = new Map();
  const occluders = opts.occluders
    ? (Array.isArray(opts.occluders) ? opts.occluders : [opts.occluders])
    : [];
  // 32 rays per fixture only run when walls or fixtures change. This is enough
  // to keep a curved pool smooth while making a 60-fixture facility a small,
  // one-off raycast batch rather than a per-frame lighting cost.
  const raycaster = occluders.length ? new THREE.Raycaster() : null;
  const rayOrigin = new THREE.Vector3();
  const rayTarget = new THREE.Vector3();
  const rayDelta = new THREE.Vector3();
  const RAY_SEGMENTS = 32;
  // A wall's render side is view-facing, not physics-facing. Keep the change
  // scoped to this one-off rebuild: the visible material is restored before
  // the renderer can draw another frame.
  const restoreOccluderSides = raycaster ? makePoolOccludersDoubleSided(occluders) : null;

  for (const fx of fixtures) {
    const def = fx.def;
    const light = def?.light;
    if (!light) continue;

    const projection = fixtureLightProjection(def, {
      origin: fx.group.position,
      yaw: fx.group.rotation.y || 0,
    });
    const { rx, rz, offsetX, offsetZ } = projection.groundFootprint;
    if (rx <= 0 || rz <= 0) continue;

    const floorY = projection.floorY + POOL_Y_LIFT;
    const cx = projection.emitter.x + offsetX;
    const cz = projection.emitter.z + offsetZ;

    tmpColor.set(light.color);
    const brightness = (light.intensity ?? 1) * POOL_COLOR_SCALE;
    const r = tmpColor.r * brightness, g = tmpColor.g * brightness, b = tmpColor.b * brightness;

    const corners = [
      [cx - rx, cz - rz, 0, 0],
      [cx + rx, cz - rz, 1, 0],
      [cx + rx, cz + rz, 1, 1],
      [cx - rx, cz + rz, 0, 1],
    ];
    const firstVertex = vertCount;
    if (!raycaster) {
      for (const [x, z, u, v] of corners) {
        positions.push(x, floorY, z);
        uvs.push(u, v);
        colors.push(r, g, b, 1); // alpha = 1: unsuppressed until the rig says otherwise
      }
      indices.push(vertCount, vertCount + 1, vertCount + 2, vertCount, vertCount + 2, vertCount + 3);
      if (fx.id != null) poolQuadByFixtureId.set(fx.id, poolCount);
      vertCount += 4;
    } else {
      // A fan centred on the emitter's ground projection. Every rim point is
      // raycast from the real emitter, not from the floor, so a tall wall
      // blocks the same line of sight as a real spotlight would.
      positions.push(cx, floorY, cz);
      uvs.push(0.5, 0.5);
      colors.push(r, g, b, 1);
      rayOrigin.set(projection.emitter.x, projection.emitter.y, projection.emitter.z);
      for (let i = 0; i < RAY_SEGMENTS; i++) {
        const angle = (i / RAY_SEGMENTS) * Math.PI * 2;
        const endX = cx + Math.cos(angle) * rx;
        const endZ = cz + Math.sin(angle) * rz;
        rayTarget.set(endX, floorY, endZ);
        rayDelta.subVectors(rayTarget, rayOrigin);
        const dist = rayDelta.length();
        rayDelta.multiplyScalar(1 / Math.max(dist, 1e-6));
        raycaster.set(rayOrigin, rayDelta);
        raycaster.near = 0.04;
        raycaster.far = Math.max(0, dist - 0.02);
        // Glass and decorative non-shadow casters should not turn into a
        // black occlusion wall. Match the shadow system's intent: only solid
        // meshes that cast shadows block the inexpensive indirect pool.
        const hit = raycaster.intersectObjects(occluders, true).find(({ object }) => {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          return object.castShadow !== false && materials.every((material) =>
            !material?.transparent || (material.opacity ?? 1) >= 0.98);
        });
        if (hit) {
          // Pull back very slightly so the additive edge neither leaks across
          // nor z-fights the wall face it was clipped against.
          rayTarget.copy(hit.point).addScaledVector(rayDelta, -0.025);
        }
        positions.push(rayTarget.x, floorY, rayTarget.z);
        uvs.push(0.5 + (rayTarget.x - cx) / (2 * rx), 0.5 + (rayTarget.z - cz) / (2 * rz));
        colors.push(r, g, b, 1);
      }
      for (let i = 0; i < RAY_SEGMENTS; i++) {
        const a = firstVertex + 1 + i;
        const bIdx = firstVertex + 1 + ((i + 1) % RAY_SEGMENTS);
        indices.push(firstVertex, a, bIdx);
      }
      if (fx.id != null) poolQuadByFixtureId.set(fx.id, poolCount);
      vertCount += RAY_SEGMENTS + 1;
    }
    if (fx.id != null) poolVertexRanges.set(fx.id, { start: firstVertex, count: vertCount - firstVertex });
    poolCount += 1;
  }
  restoreOccluderSides?.();

  if (vertCount === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);

  const material = new THREE.MeshBasicMaterial({
    map: _glowTexture(),
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    opacity: 0, // Task 6 ramp — ThreeRenderer sets this per frame from darkness.
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'lightPools';
  mesh.renderOrder = 5;
  // One mesh spans the whole facility — per-quad frustum culling isn't worth
  // computing a bounding volume for; just always draw it.
  mesh.frustumCulled = false;
  mesh.userData.poolQuadByFixtureId = poolQuadByFixtureId;
  // Change-detection cache for applyPoolSuppression, deliberately Float64.
  // Comparing the requested alpha against the geometry's own Float32 lane
  // would report a change EVERY frame for any weight not exactly
  // representable in single precision (0.2, 0.6, ...), so the cache would
  // never suppress a single upload — it would just add work. Keep the
  // requested double here and compare double-to-double.
  mesh.userData.poolQuadAlpha = new Float64Array(poolCount).fill(1);
  mesh.userData.poolVertexRanges = poolVertexRanges;
  return mesh;
}

/**
 * Hide the painted pools of fixtures that currently hold a REAL light.
 *
 * OWNERSHIP RULE: the light rig is authoritative about who holds a spot, and
 * this function is a pure consumer of that decision — it never decides
 * anything itself. The correctness condition for the whole two-system LOD is
 * that a fixture is lit by exactly one of them: painted pool OR real spot,
 * never both (that reads as a double-bright blob) and never neither (the
 * fixture goes dark mid-crossfade). So `suppression` is the rig's live map,
 * fixture id -> weight in [0,1] matching the spot's own crossfade weight, and
 * a pool's alpha is exactly `1 - weight`. Any fixture absent from the map is
 * unsuppressed.
 *
 * Writes are gated on the cache above: a static night with four steady spots
 * costs zero buffer uploads, not one per frame.
 *
 * @param {THREE.Mesh} poolMesh - a mesh from buildLightPools (anything else
 *   is ignored, so callers can hand it every child of the pool group).
 * @param {Map<*, number>|null} suppression - LightRig.getFixtureSuppression().
 */
export function applyPoolSuppression(poolMesh, suppression) {
  const attr = poolMesh?.geometry?.attributes?.color;
  const quadById = poolMesh?.userData?.poolQuadByFixtureId;
  const cache = poolMesh?.userData?.poolQuadAlpha;
  const ranges = poolMesh?.userData?.poolVertexRanges;
  if (!attr || attr.itemSize !== 4 || !quadById || !cache) return;

  let dirty = false;
  // Iterate the full pool map, not just the suppression map's keys — that's
  // what restores a pool the frame after its spot is handed to someone else.
  for (const [id, quad] of quadById) {
    if (!(quad >= 0) || quad >= cache.length) continue;
    let w = suppression ? (suppression.get(id) ?? 0) : 0;
    if (!Number.isFinite(w)) w = 0;
    const alpha = 1 - Math.max(0, Math.min(1, w)) * (1 - REAL_LIGHT_POOL_REMAINDER);
    if (cache[quad] === alpha) continue;
    cache[quad] = alpha;
    const range = ranges?.get(id);
    const base = range ? range.start : quad * 4;
    const count = range ? range.count : 4;
    for (let v = 0; v < count; v++) attr.array[(base + v) * 4 + 3] = alpha;
    dirty = true;
  }
  if (dirty) attr.needsUpdate = true;
}

/**
 * One soft additive billboard Sprite per non-overhead glowing emitter mesh (traversing
 * `group.userData.emitterMaterial` rather than hardcoding per-fixture-type
 * positions — this is what makes a doubleLamppost's two heads or a
 * highMastLight's four heads each get their own halo for free). Sprites
 * always face the camera at zero per-frame CPU cost (three.js bills them in
 * the vertex shader), so unlike the pools they don't need merging to stay
 * cheap at sixty fixtures.
 *
 * @param {Array<{id:*, def:object, group:THREE.Group}>} fixtures
 * @returns {THREE.Group} may be empty; always safe to add to the scene.
 */
export function buildLightHalos(fixtures) {
  const group = new THREE.Group();
  group.name = 'lightHalos';
  if (!fixtures || !fixtures.length) return group;

  const texture = _glowTexture();
  const worldPos = new THREE.Vector3();

  for (const fx of fixtures) {
    const light = fx.def?.light;
    const emitterMat = fx.group.userData.emitterMaterial;
    if (!light || !emitterMat) continue;

    // A billboard always faces the camera, so on a suspended fixture it reads
    // as a large, circular aura wrapped around the housing. Overhead lights
    // already have an emissive diffuser for a tight source glint, a projected
    // pool on the floor, a real downward SpotLight when one is available, and
    // a budgeted volumetric cone. Do not lay the omnidirectional billboard on
    // top of those directional cues.
    if (!fixtureUsesBillboardHalo(fx.def)) continue;

    const size = HALO_BASE_SIZE + (light.sourceRadius ?? 0.1) * HALO_SOURCE_FACTOR;
    fx.group.updateMatrixWorld(true);
    fx.group.traverse((child) => {
      if (!child.isMesh || child.material !== emitterMat) return;
      child.getWorldPosition(worldPos);
      const spriteMat = new THREE.SpriteMaterial({
        map: texture,
        color: light.color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0, // Task 6 ramp — ThreeRenderer sets this per frame from darkness.
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.layers?.enable(SOFT_GLOW_LAYER);
      sprite.position.copy(worldPos);
      sprite.scale.set(size, size, 1);
      sprite.renderOrder = 6;
      group.add(sprite);
    });
  }
  return group;
}

/** Suspended fixtures use a downward beam/pool instead of a camera-facing aura. */
export function fixtureUsesBillboardHalo(def) {
  return def?.mount !== 'overhead';
}

// --- Darkness ramp (Task 6) --------------------------------------------------
// Every visual channel that "switches a light on" reads the SAME darkness
// value (ThreeRenderer's this._darkness, ultimately day-night.js's
// dayNightGrade().darkness) through these four pure lerps, so pools, halos,
// fixture emissive intensity and window glass move in lockstep — do not
// invent a second darkness curve. Retune the end points here, not at the
// call sites. A new channel belongs in this block too.

export const EMITTER_MAX_INTENSITY = 2.6; // emissiveIntensity at full darkness (vs EMITTER_BASE_INTENSITY by day)
export const POOL_MAX_OPACITY = 0.55;     // merged pool mesh opacity at full darkness (0 by day)
export const HALO_MAX_OPACITY = 0.85;     // halo sprite opacity at full darkness (0 by day)
// Window-pane emissiveIntensity at full darkness (0 by day — glass is inert
// in sunlight). Higher than EMITTER_MAX_INTENSITY on purpose: a pane is a
// TRANSPARENT material, so its emissive contribution is scaled down by its
// own opacity (0.12–0.65 across the catalogue). A clear pane at 0.15 opacity
// needs the extra headroom to read as "lit from inside" at all.
export const GLASS_MAX_GLOW = 3.0;

function _lerp(a, b, t) { return a + (b - a) * t; }

/** Fixture emitter `emissiveIntensity` for a given darkness [0,1]. Pure. */
export function emitterIntensityForDarkness(darkness) {
  return _lerp(EMITTER_BASE_INTENSITY, EMITTER_MAX_INTENSITY, darkness);
}

/** Merged pool mesh opacity for a given darkness [0,1]. Pure. */
export function poolOpacityForDarkness(darkness) {
  return POOL_MAX_OPACITY * darkness;
}

/** Halo sprite opacity for a given darkness [0,1]. Pure. */
export function haloOpacityForDarkness(darkness) {
  return HALO_MAX_OPACITY * darkness;
}

/**
 * Window-glass `emissiveIntensity` for a given darkness [0,1]. Pure.
 * Lives here rather than in wall-builder.js so every darkness ramp in the
 * game shares one file of taste knobs — retune GLASS_MAX_GLOW above, not the
 * call site in ThreeRenderer._updateLightingRamp.
 */
export function glassGlowForDarkness(darkness) {
  return GLASS_MAX_GLOW * darkness;
}
