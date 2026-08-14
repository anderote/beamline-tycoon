// src/renderer3d/lighting-builder.js
// Geometry for the nine facility lighting fixtures (src/data/placeables/
// lighting.js). THREE is a CDN global — do NOT import it.
//
// This module owns geometry only. It does NOT emit light (no THREE.Light),
// does NOT ramp glow with time of day (Task 6), and does NOT decide where a
// wall/overhead fixture sits on its wall edge or ceiling tile (Tasks 7/8).
// Every fixture is built in a documented local-space convention so those
// later tasks can position/rotate the returned group without knowing
// anything about its internals:
//
//   - mount: 'ground'   — origin sits at the fixture's base (y=0, ground
//     level). The whole footprint centering + dir rotation is handled by
//     the caller (decoration-builder.js), exactly like any other decoration.
//   - mount: 'wall'     — origin is the wall-mounting point: the backplate
//     is flush with local z=0, fixture protrudes toward +z. Task 7 places
//     this point on the wall edge at `def.light.emitterY` height and rotates
//     to match the chosen face.
//   - mount: 'overhead' — origin is the ceiling attachment point (top of the
//     stem/chain); the fixture hangs down into -y from there. Task 8
//     translates this point to wall height (1.5 m per the design doc) above
//     the floor tile.
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

const SUB = 0.5; // 1 sub-tile = 0.5 world units — must match decoration-builder.js

// A dim, deliberately "off" baseline. Task 6 overwrites this every frame
// once it lands; this default is what a fixture looks like before Task 6
// exists at all (i.e. right now), so it must not look lit at noon.
const EMITTER_BASE_INTENSITY = 0.15;

// --- Pure aim math — no THREE, safe to unit test directly in Node ---------

/**
 * Only ground-mounted cone fixtures are aimable by `dir`. Overhead cones
 * (highBay) point straight down regardless of dir — nothing to aim.
 */
export function isAimedFixture(def) {
  return def.mount === 'ground' && def.light?.shape === 'cone';
}

/**
 * Yaw for a placement `dir` (0-3 quarter turns), matching the codebase's
 * existing -dir * 90° convention (decorationPlacement.rotY, hover ghosts at
 * ThreeRenderer.js:2378/:2539).
 */
export function aimYaw(dir = 0) {
  return -((dir || 0) * (Math.PI / 2));
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
  head.rotation.z = -tilt;
  head.castShadow = true;
  group.add(head);

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.02, 12), glowMat);
  lens.position.set(0.04 + 0.1 * Math.sin(tilt), headY + 0.1 * Math.cos(tilt), 0);
  lens.rotation.z = -tilt + Math.PI / 2;
  group.add(lens);

  group.userData.emitterMaterial = glowMat;
  return group;
}

// --- Wall -------------------------------------------------------------------
// Origin = wall mounting point (backplate flush at local z=0, fixture
// protrudes to +z). Task 7 positions/rotates this to a wall face.

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

// --- Overhead ----------------------------------------------------------------
// Origin = ceiling attachment point (top of stem/chain); fixture hangs into
// -y from there. Task 8 translates this point to wall height (1.5 m).

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

// --- Dispatch ----------------------------------------------------------------

const BUILDERS = {
  lamppost: _buildLamppost,
  doubleLamppost: _buildDoubleLamppost,
  bollardLight: _buildBollardLight,
  highMastLight: _buildHighMastLight,
  floodLight: _buildFloodLight,
  wallSconce: _buildWallSconce,
  bulkheadLight: _buildBulkheadLight,
  ceilingPanel: _buildCeilingPanel,
  highBay: _buildHighBay,
};

/**
 * Build one lighting fixture's geometry.
 *
 * @param {object} def - a LIGHTING_DEFS entry (id, mount, light block, ...).
 * @param {{dir?:number, face?:string}} [placement] - opaque placement bag.
 *   `dir` (0-3 quarter turns) is read only for ground-mounted cone fixtures
 *   (floodLight); `face` is Task 7's, unused here.
 * @returns {THREE.Group}
 */
export function buildLightFixture(def, placement = {}) {
  const builder = BUILDERS[def.id];
  const group = builder ? builder(def) : _buildFallback(def);
  if (isAimedFixture(def)) {
    group.rotation.y = aimYaw(placement.dir);
  }
  return group;
}

// Defensive fallback for an unrecognized id — should never trigger for the
// nine known fixtures, but keeps the renderer from throwing on a bad def.
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
